import { contextBridge, ipcRenderer } from 'electron'
import { Ch } from '../shared/channels'
import type { LanniApi, PersistedState, PtyCreateRequest } from '../shared/types'

const api: LanniApi = {
  createPane: (req: PtyCreateRequest) => ipcRenderer.invoke(Ch.ptyCreate, req),
  sendInput: (ptyId, data) => ipcRenderer.send(Ch.ptyInput, ptyId, data),
  resizePane: (ptyId, cols, rows) => ipcRenderer.send(Ch.ptyResize, ptyId, cols, rows),
  disposePane: (ptyId, killSession = false) => ipcRenderer.send(Ch.ptyDispose, ptyId, killSession),
  onData: (cb) => {
    const fn = (_e: unknown, ptyId: string, data: string): void => cb(ptyId, data)
    ipcRenderer.on(Ch.ptyData, fn)
    return () => ipcRenderer.removeListener(Ch.ptyData, fn)
  },
  onExit: (cb) => {
    const fn = (_e: unknown, ptyId: string, exitCode: number): void => cb(ptyId, exitCode)
    ipcRenderer.on(Ch.ptyExit, fn)
    return () => ipcRenderer.removeListener(Ch.ptyExit, fn)
  },
  loadState: () => ipcRenderer.invoke(Ch.stateLoad),
  saveState: (state: PersistedState) => ipcRenderer.send(Ch.stateSave, state),
  checkTmux: () => ipcRenderer.invoke(Ch.tmuxCheck),
  listSshHosts: () => ipcRenderer.invoke(Ch.sshListHosts),
  probeSsh: (host: string) => ipcRenderer.invoke(Ch.sshProbe, host),
  openExternal: (url: string) => ipcRenderer.send(Ch.openExternal, url),
  copyText: (text: string) => ipcRenderer.send(Ch.copyText, text),
  onMenuClosePane: (cb) => {
    const fn = (): void => cb()
    ipcRenderer.on(Ch.menuClosePane, fn)
    return () => ipcRenderer.removeListener(Ch.menuClosePane, fn)
  },
  onCodexSessionCaptured: (cb) => {
    const fn = (_e: unknown, paneId: string, sessionId: string): void => cb(paneId, sessionId)
    ipcRenderer.on(Ch.codexSessionCaptured, fn)
    return () => ipcRenderer.removeListener(Ch.codexSessionCaptured, fn)
  }
}

contextBridge.exposeInMainWorld('lanni', api)
