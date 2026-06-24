import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { Connection, PaneNode, Theme } from '../../shared/types'
import { resolveStartupCommand } from '../../shared/profiles'
import { debounce } from './debounce'

const THEMES: Record<Theme, { background: string; foreground: string; cursor: string; cursorAccent: string; selectionBackground: string }> = {
  dark: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    cursorAccent: '#1e1e1e',
    selectionBackground: '#3a4a63'
  },
  light: {
    background: '#ffffff',
    foreground: '#1f1f1f',
    cursor: '#1f1f1f',
    cursorAccent: '#ffffff',
    selectionBackground: '#b3d4fc'
  }
}
let currentTheme: Theme = 'dark'

/** Switch all live terminals (and future ones) to the given theme. */
export function setTheme(theme: Theme): void {
  currentTheme = theme
  reg.forEach((e) => {
    e.term.options.theme = THEMES[theme]
  })
}

// A pane's terminal lives HERE, not in the React tree, so layout changes (split,
// collapse, tab/workspace switch) can move its DOM around without ever tearing down
// the xterm or its ssh/tmux connection. The React <TerminalPane> is a thin shell that
// attaches this terminal's container and reads its status for overlays.

const BACKOFF_MS = [2000, 4000, 8000, 15000, 30000]

export interface PaneStatus {
  connecting: boolean
  disconnected: boolean
  reconnectAttempt: number
}

interface Entry {
  term: XTerm
  fit: FitAddon
  search: SearchAddon
  webgl: WebglAddon | null
  container: HTMLDivElement
  ro: ResizeObserver
  status: PaneStatus // replaced (new object) on every change so React can diff it
  created: boolean // createPane has been called at least once
  connecting: boolean // a create is in flight
  reconnectTimer: ReturnType<typeof setTimeout> | null
  pane: PaneNode
  connection: Connection
  listeners: Set<() => void>
  offData: () => void
  offExit: () => void
  onFind: (() => void) | null
}

const reg = new Map<string, Entry>()
let focusedPaneId: string | null = null

/** The pane whose terminal currently has focus (for the ⌘W "close pane" shortcut). */
export function getFocusedPaneId(): string | null {
  return focusedPaneId && reg.has(focusedPaneId) ? focusedPaneId : null
}

function notify(e: Entry): void {
  e.listeners.forEach((cb) => cb())
}

function doConnect(paneId: string): void {
  const e = reg.get(paneId)
  if (!e || e.connecting) return
  const { term, fit, container } = e
  if (!container.clientWidth || !container.clientHeight) return
  try {
    fit.fit()
  } catch {
    /* transient */
  }
  e.created = true
  e.connecting = true
  e.status = { connecting: true, disconnected: false, reconnectAttempt: e.status.reconnectAttempt }
  notify(e)
  window.lanni.createPane({
    ptyId: paneId,
    tmuxSession: e.pane.tmuxSession,
    connection: e.connection,
    cwd: e.pane.cwd,
    // Resolve the per-pane id-based resume command (claude/codex with an id); shell /
    // custom / not-yet-assigned panes pass through unchanged. Works for ssh too.
    startupCommand: resolveStartupCommand(e.pane),
    cols: term.cols,
    rows: term.rows
  })
  term.focus()
}

/** Get-or-create the terminal for a pane, refreshing its latest pane/connection. */
export function acquire(pane: PaneNode, connection: Connection): Entry {
  const existing = reg.get(pane.id)
  if (existing) {
    existing.pane = pane
    existing.connection = connection
    return existing
  }

  const term = new XTerm({
    fontFamily: 'Menlo, Monaco, "SF Mono", monospace',
    fontSize: 13,
    cursorBlink: true,
    allowProposedApi: true,
    scrollback: 10000,
    // tmux mouse mode owns plain drags (for scroll); hold Option to drag-select locally.
    macOptionClickForcesSelection: true,
    theme: THEMES[currentTheme]
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const unicode = new Unicode11Addon()
  term.loadAddon(unicode)
  term.unicode.activeVersion = '11'
  const search = new SearchAddon()
  term.loadAddon(search)
  term.loadAddon(new WebLinksAddon((_ev, uri) => window.lanni.openExternal(uri)))

  const container = document.createElement('div')
  container.className = 'term-pane'
  container.addEventListener('focusin', () => {
    focusedPaneId = pane.id
  })
  term.open(container)

  let webgl: WebglAddon | null = null
  try {
    webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      try {
        webgl?.dispose()
      } catch {
        /* noop */
      }
      webgl = null
    })
    term.loadAddon(webgl)
  } catch (err) {
    console.warn('[term] WebGL renderer unavailable, using canvas/DOM', err)
  }

  const e: Entry = {
    term,
    fit,
    search,
    webgl,
    container,
    ro: null as unknown as ResizeObserver,
    status: { connecting: false, disconnected: false, reconnectAttempt: 0 },
    created: false,
    connecting: false,
    reconnectTimer: null,
    pane,
    connection,
    listeners: new Set(),
    offData: () => {},
    offExit: () => {},
    onFind: null
  }
  reg.set(pane.id, e)

  e.offData = window.lanni.onData((id, data) => {
    if (id !== pane.id) return
    e.connecting = false
    if (e.reconnectTimer) {
      clearTimeout(e.reconnectTimer)
      e.reconnectTimer = null
    }
    if (e.status.connecting || e.status.disconnected || e.status.reconnectAttempt) {
      e.status = { connecting: false, disconnected: false, reconnectAttempt: 0 }
      notify(e)
    }
    term.write(data)
  })
  e.offExit = window.lanni.onExit((id) => {
    if (id !== pane.id) return
    e.connecting = false
    if (e.connection.kind === 'ssh') {
      // Server likely rebooted/dropped — retry with backoff until it returns.
      const attempt = e.status.reconnectAttempt + 1
      e.status = { connecting: false, disconnected: false, reconnectAttempt: attempt }
      e.reconnectTimer = setTimeout(() => doConnect(pane.id), BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)])
    } else {
      e.status = { connecting: false, disconnected: true, reconnectAttempt: 0 }
    }
    notify(e)
  })
  term.onData((d) => window.lanni.sendInput(pane.id, d))
  term.onResize(({ cols, rows }) => window.lanni.resizePane(pane.id, cols, rows))
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type === 'keydown' && ev.metaKey && ev.key.toLowerCase() === 'f') {
      e.onFind?.()
      return false
    }
    return true
  })

  const doFit = debounce(() => {
    if (container.offsetParent !== null && container.clientWidth > 0 && container.clientHeight > 0) {
      try {
        fit.fit()
      } catch {
        /* transient layout race */
      }
    }
  }, 50)
  e.ro = new ResizeObserver(doFit)
  e.ro.observe(container)

  // Copy-on-select: a local (Option-drag / keyboard) selection auto-copies to the
  // system clipboard. tmux's own drag-selections don't fire this (they aren't xterm
  // selections), so this only catches the local ones we want on the clipboard.
  const copySelection = debounce(() => {
    const sel = term.getSelection()
    if (sel) window.lanni.copyText(sel)
  }, 150)
  term.onSelectionChange(copySelection)

  return e
}

/** Called when a pane becomes visible/active: connect on first show, else resync size. */
export function activate(paneId: string): void {
  const e = reg.get(paneId)
  if (!e) return
  requestAnimationFrame(() => {
    if (!reg.has(paneId)) return
    if (!e.container.clientWidth || !e.container.clientHeight) return
    if (!e.created) {
      doConnect(paneId)
    } else if (e.status.reconnectAttempt > 0) {
      doConnect(paneId) // resume a reconnect that stalled while hidden
    } else if (!e.status.disconnected) {
      try {
        e.fit.fit()
      } catch {
        /* transient */
      }
      window.lanni.resizePane(paneId, e.term.cols, e.term.rows)
      e.term.focus()
    }
  })
}

export function reconnect(paneId: string): void {
  const e = reg.get(paneId)
  if (!e) return
  if (e.reconnectTimer) {
    clearTimeout(e.reconnectTimer)
    e.reconnectTimer = null
  }
  doConnect(paneId)
}

export function cancelReconnect(paneId: string): void {
  const e = reg.get(paneId)
  if (!e) return
  if (e.reconnectTimer) {
    clearTimeout(e.reconnectTimer)
    e.reconnectTimer = null
  }
  e.status = { connecting: false, disconnected: true, reconnectAttempt: 0 }
  notify(e)
}

export function subscribe(paneId: string, cb: () => void): () => void {
  const e = reg.get(paneId)
  if (!e) return () => {}
  e.listeners.add(cb)
  return () => {
    e.listeners.delete(cb)
  }
}

export function getStatus(paneId: string): PaneStatus {
  return reg.get(paneId)?.status ?? { connecting: false, disconnected: false, reconnectAttempt: 0 }
}

export function getContainer(paneId: string): HTMLDivElement | null {
  return reg.get(paneId)?.container ?? null
}

export function search(paneId: string, term: string, previous: boolean): void {
  const e = reg.get(paneId)
  if (!e || !term) return
  if (previous) e.search.findPrevious(term, { incremental: false })
  else e.search.findNext(term, { incremental: true })
}

export function setFindHandler(paneId: string, fn: (() => void) | null): void {
  const e = reg.get(paneId)
  if (e) e.onFind = fn
}

/** Permanently destroy a pane's terminal + connection (on explicit close only). */
export function destroy(paneId: string): void {
  const e = reg.get(paneId)
  if (!e) return
  if (e.reconnectTimer) clearTimeout(e.reconnectTimer)
  e.offData()
  e.offExit()
  e.ro.disconnect()
  try {
    e.webgl?.dispose()
  } catch {
    /* noop */
  }
  try {
    e.term.dispose()
  } catch {
    /* noop */
  }
  e.container.remove()
  reg.delete(paneId)
  if (focusedPaneId === paneId) focusedPaneId = null
}
