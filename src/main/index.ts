import { app, BrowserWindow, ipcMain, Menu, shell, utilityProcess } from 'electron'
import { join } from 'node:path'
import windowStateKeeper from 'electron-window-state'
import { Ch } from '../shared/channels'
import type { Connection, HostOutbound, PersistedState, PtyCreateRequest, PtySpawnSpec } from '../shared/types'
import { checkTmux, killLocalSession, localTmuxCommand } from './tmux'
import { killRemoteSession, listSshHosts, probeSsh, sshTmuxCommand } from './ssh'
import { flushState, loadState, saveStateDebounced } from './store'

// Whitelists enforced at the spawn boundary — workspace.json is user-editable, so
// these values are treated as untrusted even though the app generates them cleanly.
const SESSION_RE = /^[A-Za-z0-9_-]+$/
const HOST_RE = /^[A-Za-z0-9._@:%+-]+$/

let mainWindow: BrowserWindow | null = null
let ptyHost: Electron.UtilityProcess | null = null

// Per-pty metadata so a dispose can target the right tmux session / host.
const ptyMeta = new Map<string, { connection: Connection; tmuxSession: string }>()

// Pin state to a stable folder (before app 'ready') so renaming the app's display
// name never orphans saved workspaces — userData would otherwise follow productName.
app.setPath('userData', join(app.getPath('appData'), 'lanni'))

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v
  // GUI-launched apps inherit a thin PATH; make sure Homebrew tmux is reachable.
  env.PATH = `/opt/homebrew/bin:/usr/local/bin:${env.PATH ?? ''}`
  env.TERM = 'xterm-256color'
  // Never let the spawned tmux think it is nested inside the app's own session.
  delete env.TMUX
  delete env.TMUX_PANE
  return env
}

function startPtyHost(): void {
  ptyHost = utilityProcess.fork(join(__dirname, 'ptyHost.js'), [], {
    stdio: 'pipe',
    serviceName: 'lanni-pty-host'
  })
  ptyHost.stdout?.on('data', (d) => console.log('[pty-host]', d.toString().trimEnd()))
  ptyHost.stderr?.on('data', (d) => console.error('[pty-host]', d.toString().trimEnd()))
  ptyHost.on('message', (msg: HostOutbound) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (msg.type === 'data') mainWindow.webContents.send(Ch.ptyData, msg.ptyId, msg.data)
    else if (msg.type === 'exit') {
      console.log(`[pty] exit ${msg.ptyId} code=${msg.exitCode}`)
      mainWindow.webContents.send(Ch.ptyExit, msg.ptyId, msg.exitCode)
    }
    else if (msg.type === 'spawned') console.log(`[pty-host] spawned ${msg.ptyId} pid=${msg.pid}`)
  })
  ptyHost.on('exit', (code) => console.error(`[pty-host] exited code=${code}`))
}

function buildSpawnSpec(req: PtyCreateRequest): PtySpawnSpec {
  const cmd =
    req.connection.kind === 'ssh' && req.connection.host
      ? sshTmuxCommand(req.connection.host, req.tmuxSession, req.cwd, req.startupCommand)
      : localTmuxCommand(req.tmuxSession, req.cwd, req.startupCommand)
  return { ptyId: req.ptyId, file: cmd.file, args: cmd.args, env: childEnv(), cols: req.cols, rows: req.rows }
}

function registerIpc(): void {
  ipcMain.handle(Ch.ptyCreate, (_e, req: PtyCreateRequest) => {
    // Reject anything that could break out of the shell command we build.
    if (!SESSION_RE.test(req.tmuxSession)) {
      console.error('[main] rejected invalid tmux session name:', req.tmuxSession)
      return false
    }
    if (req.connection.kind === 'ssh') {
      const host = req.connection.host ?? ''
      if (!HOST_RE.test(host) || host.startsWith('-')) {
        console.error('[main] rejected invalid ssh host:', host)
        return false
      }
    }
    ptyMeta.set(req.ptyId, { connection: req.connection, tmuxSession: req.tmuxSession })
    ptyHost?.postMessage({ type: 'create', ...buildSpawnSpec(req) })
    return true
  })
  ipcMain.on(Ch.ptyInput, (_e, ptyId: string, data: string) =>
    ptyHost?.postMessage({ type: 'input', ptyId, data })
  )
  ipcMain.on(Ch.ptyResize, (_e, ptyId: string, cols: number, rows: number) =>
    ptyHost?.postMessage({ type: 'resize', ptyId, cols, rows })
  )
  ipcMain.on(Ch.ptyDispose, (_e, ptyId: string, killSession: boolean) => {
    ptyHost?.postMessage({ type: 'kill', ptyId })
    const meta = ptyMeta.get(ptyId)
    if (killSession && meta) {
      if (meta.connection.kind === 'ssh' && meta.connection.host)
        killRemoteSession(meta.connection.host, meta.tmuxSession, childEnv())
      else killLocalSession(meta.tmuxSession, childEnv())
    }
    ptyMeta.delete(ptyId)
  })
  ipcMain.handle(Ch.stateLoad, (): PersistedState | null => loadState())
  ipcMain.on(Ch.stateSave, (_e, state: PersistedState) => saveStateDebounced(state))
  ipcMain.handle(Ch.tmuxCheck, () => checkTmux(childEnv()))
  ipcMain.handle(Ch.sshListHosts, () => listSshHosts())
  ipcMain.handle(Ch.sshProbe, (_e, host: string) => probeSsh(host, childEnv()))
  ipcMain.on(Ch.openExternal, (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url) // only open web links
  })
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const sendFocused = (channel: string): void => BrowserWindow.getFocusedWindow()?.webContents.send(channel)
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' }, // copy/paste/select-all for the terminal
    {
      label: 'Terminal',
      submenu: [
        // ⌘W closes the focused PANE (not the window). Defining it here also removes
        // the default window-close ⌘W binding.
        { label: 'Close Pane', accelerator: 'CmdOrCtrl+W', click: () => sendFocused(Ch.menuClosePane) }
      ]
    },
    { label: 'Window', submenu: [{ role: 'minimize' as const }, { role: 'zoom' as const }] },
    { role: 'viewMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  const win = windowStateKeeper({ defaultWidth: 1280, defaultHeight: 860 })
  mainWindow = new BrowserWindow({
    x: win.x,
    y: win.y,
    width: win.width,
    height: win.height,
    minWidth: 480,
    minHeight: 320,
    backgroundColor: '#1e1e1e',
    title: 'lmux',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.manage(mainWindow)

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) mainWindow.loadURL(rendererUrl)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  console.log('[main] ready; userData =', app.getPath('userData'))
  buildMenu()
  startPtyHost()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  flushState()
  ptyHost?.kill()
})
