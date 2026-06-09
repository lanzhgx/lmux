import { create } from 'zustand'
import type { Connection, PaneNode, PersistedState, Tab, Theme, Workspace } from '../shared/types'
import { genId, sessionName } from '../shared/ids'
import {
  collectPanes,
  removePaneFromTree,
  setRatiosAtPath,
  splitPaneInTree,
  updatePane
} from './lib/layoutTree'
import { destroy as destroyTerminal } from './lib/terminalRegistry'
import type { LayoutNode, SplitNode } from '../shared/types'

const STATE_VERSION = 1

function makePane(wsId: string, tabId: string, startup?: string, initialCwd?: string, isMain?: boolean): PaneNode {
  const id = genId('p')
  return {
    type: 'pane',
    id,
    tmuxSession: sessionName(wsId, tabId, id),
    startupCommand: startup || undefined,
    cwd: initialCwd || undefined,
    isMain: isMain || undefined
  }
}
function makeTab(wsId: string, title: string, startup?: string, initialCwd?: string, isMain?: boolean): Tab {
  const id = genId('t')
  return { id, title, layout: makePane(wsId, id, startup, initialCwd, isMain) }
}
function makeWorkspace(name: string, connection: Connection, defaultStartup?: string, directory?: string): Workspace {
  const id = genId('w')
  // The initial pane is the workspace's MAIN pane: it gets the AI command + isMain.
  const tab = makeTab(id, 'shell', defaultStartup, directory, true)
  return {
    id,
    name,
    connection,
    defaultStartup: defaultStartup || undefined,
    directory: directory || undefined,
    activeTabId: tab.id,
    tabs: [tab]
  }
}

export interface NewWorkspaceOpts {
  name?: string
  connection: Connection
  defaultStartup?: string
  directory?: string
}

const SESSION_RE = /^[A-Za-z0-9_-]+$/

function isValidLayout(n: unknown): n is LayoutNode {
  if (!n || typeof n !== 'object') return false
  const node = n as Record<string, unknown>
  if (node.type === 'pane') {
    return (
      typeof node.id === 'string' &&
      typeof node.tmuxSession === 'string' &&
      SESSION_RE.test(node.tmuxSession) &&
      (node.cwd === undefined || typeof node.cwd === 'string') &&
      (node.startupCommand === undefined || typeof node.startupCommand === 'string') &&
      (node.isMain === undefined || typeof node.isMain === 'boolean')
    )
  }
  if (node.type === 'split') {
    return (
      (node.orientation === 'horizontal' || node.orientation === 'vertical') &&
      Array.isArray(node.children) &&
      node.children.length > 0 &&
      Array.isArray(node.ratios) &&
      node.children.every(isValidLayout)
    )
  }
  return false
}

/**
 * Validate + repair a persisted document before it hydrates the store. Drops
 * malformed workspaces/tabs (so a hand-edited or stale file can't crash the
 * renderer) and clamps activeTabId/activeWorkspaceId to existing ids. Returns null
 * if nothing usable survives (caller then starts fresh).
 */
function sanitize(persisted: unknown): { workspaces: Workspace[]; activeWorkspaceId: string | null } | null {
  const p = persisted as { workspaces?: unknown; activeWorkspaceId?: unknown } | null
  if (!p || !Array.isArray(p.workspaces)) return null
  const workspaces: Workspace[] = []
  for (const raw of p.workspaces) {
    const w = raw as Record<string, unknown>
    const conn = w?.connection as { kind?: unknown; host?: unknown } | undefined
    if (
      !w ||
      typeof w.id !== 'string' ||
      typeof w.name !== 'string' ||
      !conn ||
      (conn.kind !== 'local' && conn.kind !== 'ssh') ||
      !Array.isArray(w.tabs)
    ) {
      continue
    }
    const tabs: Tab[] = []
    for (const rawTab of w.tabs) {
      const t = rawTab as Record<string, unknown>
      if (t && typeof t.id === 'string' && typeof t.title === 'string' && isValidLayout(t.layout)) {
        tabs.push({ id: t.id, title: t.title, layout: t.layout as LayoutNode })
      }
    }
    if (tabs.length === 0) continue
    const connection: Connection =
      conn.kind === 'ssh' ? { kind: 'ssh', host: typeof conn.host === 'string' ? conn.host : '' } : { kind: 'local' }
    const activeTabId =
      typeof w.activeTabId === 'string' && tabs.some((t) => t.id === w.activeTabId)
        ? (w.activeTabId as string)
        : tabs[0].id
    const defaultStartup = typeof w.defaultStartup === 'string' ? (w.defaultStartup as string) : undefined
    const directory = typeof w.directory === 'string' ? (w.directory as string) : undefined
    workspaces.push({ id: w.id, name: w.name, connection, defaultStartup, directory, activeTabId, tabs })
  }
  if (workspaces.length === 0) return null
  const ids = new Set(workspaces.map((w) => w.id))
  const activeWorkspaceId =
    typeof p.activeWorkspaceId === 'string' && ids.has(p.activeWorkspaceId) ? p.activeWorkspaceId : workspaces[0].id
  return { workspaces, activeWorkspaceId }
}

interface Store {
  loaded: boolean
  tmuxOk: boolean
  tmuxVersion?: string
  theme: Theme
  activeWorkspaceId: string | null
  workspaces: Workspace[]
  init: () => Promise<void>
  toggleTheme: () => void
  addWorkspace: (opts?: NewWorkspaceOpts) => void
  setActiveWorkspace: (id: string) => void
  renameWorkspace: (id: string, name: string) => void
  deleteWorkspace: (id: string) => void
  moveWorkspace: (fromId: string, toId: string) => void
  addTab: (wsId: string) => void
  closeTab: (wsId: string, tabId: string) => void
  setActiveTab: (wsId: string, tabId: string) => void
  renameTab: (wsId: string, tabId: string, title: string) => void
  splitPane: (wsId: string, tabId: string, paneId: string, orientation: SplitNode['orientation']) => void
  closePane: (wsId: string, tabId: string, paneId: string) => void
  setRatios: (wsId: string, tabId: string, path: number[], ratios: number[]) => void
  setPaneStartup: (wsId: string, tabId: string, paneId: string, startupCommand: string) => void
}

export const useStore = create<Store>((set, get) => {
  // Send immediately on each mutation (these are discrete user actions, not a
  // high-frequency stream). Main debounces the disk write and flushes it on quit,
  // so there is no renderer-side timer that could be lost when the window closes.
  const save = (): void => {
    const { activeWorkspaceId, workspaces, theme } = get()
    const state: PersistedState = { version: STATE_VERSION, theme, activeWorkspaceId, workspaces }
    window.lanni.saveState(state)
  }

  return {
    loaded: false,
    tmuxOk: true,
    theme: 'dark',
    activeWorkspaceId: null,
    workspaces: [],

    async init() {
      const [persisted, tmux] = await Promise.all([window.lanni.loadState(), window.lanni.checkTmux()])
      const theme: Theme = persisted?.theme === 'light' ? 'light' : 'dark'
      const clean = sanitize(persisted)
      if (clean) {
        set({
          workspaces: clean.workspaces,
          activeWorkspaceId: clean.activeWorkspaceId,
          loaded: true,
          theme,
          tmuxOk: tmux.ok,
          tmuxVersion: tmux.version
        })
      } else {
        const ws = makeWorkspace('local', { kind: 'local' })
        set({
          workspaces: [ws],
          activeWorkspaceId: ws.id,
          loaded: true,
          theme,
          tmuxOk: tmux.ok,
          tmuxVersion: tmux.version
        })
        save()
      }
    },

    toggleTheme() {
      set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' }))
      save()
    },

    addWorkspace(opts) {
      const connection: Connection = opts?.connection ?? { kind: 'local' }
      const fallback =
        connection.kind === 'ssh' ? connection.host || 'ssh' : `local ${get().workspaces.length + 1}`
      const name = opts?.name?.trim() || fallback
      const ws = makeWorkspace(name, connection, opts?.defaultStartup, opts?.directory?.trim() || undefined)
      set((s) => ({ workspaces: [...s.workspaces, ws], activeWorkspaceId: ws.id }))
      save()
    },

    setActiveWorkspace(id) {
      set({ activeWorkspaceId: id })
      save()
    },

    renameWorkspace(id, name) {
      set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name } : w)) }))
      save()
    },

    deleteWorkspace(id) {
      const w = get().workspaces.find((x) => x.id === id)
      if (w) {
        for (const t of w.tabs)
          for (const p of collectPanes(t.layout)) {
            window.lanni.disposePane(p.id, true)
            destroyTerminal(p.id)
          }
      }
      set((s) => {
        const workspaces = s.workspaces.filter((x) => x.id !== id)
        let activeWorkspaceId = s.activeWorkspaceId
        if (activeWorkspaceId === id) activeWorkspaceId = workspaces.length ? workspaces[0].id : null
        return { workspaces, activeWorkspaceId }
      })
      save()
    },

    moveWorkspace(fromId, toId) {
      set((s) => {
        const arr = [...s.workspaces]
        const from = arr.findIndex((w) => w.id === fromId)
        const to = arr.findIndex((w) => w.id === toId)
        if (from < 0 || to < 0 || from === to) return {}
        const [moved] = arr.splice(from, 1)
        arr.splice(to, 0, moved)
        return { workspaces: arr }
      })
      save()
    },

    addTab(wsId) {
      set((s) => ({
        workspaces: s.workspaces.map((w) => {
          if (w.id !== wsId) return w
          // New tabs are secondary: cd into the project dir, plain shell (no AI resume).
          const tab = makeTab(w.id, `shell ${w.tabs.length + 1}`, undefined, w.directory, false)
          return { ...w, tabs: [...w.tabs, tab], activeTabId: tab.id }
        })
      }))
      save()
    },

    closeTab(wsId, tabId) {
      const w = get().workspaces.find((x) => x.id === wsId)
      const tab = w?.tabs.find((t) => t.id === tabId)
      if (tab) {
        // Closing a tab is deliberate -> kill its tmux sessions so they don't orphan.
        for (const pane of collectPanes(tab.layout)) {
          window.lanni.disposePane(pane.id, true)
          destroyTerminal(pane.id)
        }
      }
      set((s) => ({
        workspaces: s.workspaces.map((ws) => {
          if (ws.id !== wsId) return ws
          const tabs = ws.tabs.filter((t) => t.id !== tabId)
          let activeTabId = ws.activeTabId
          if (activeTabId === tabId) activeTabId = tabs.length ? tabs[tabs.length - 1].id : null
          return { ...ws, tabs, activeTabId }
        })
      }))
      save()
    },

    setActiveTab(wsId, tabId) {
      set((s) => ({
        workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, activeTabId: tabId } : w))
      }))
      save()
    },

    renameTab(wsId, tabId, title) {
      set((s) => ({
        workspaces: s.workspaces.map((w) =>
          w.id !== wsId ? w : { ...w, tabs: w.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)) }
        )
      }))
      save()
    },

    splitPane(wsId, tabId, paneId, orientation) {
      set((s) => ({
        workspaces: s.workspaces.map((w) =>
          w.id !== wsId
            ? w
            : {
                ...w,
                tabs: w.tabs.map((t) =>
                  t.id !== tabId
                    ? t
                    : { ...t, layout: splitPaneInTree(t.layout, paneId, orientation, makePane(wsId, tabId, undefined, w.directory, false)) }
                )
              }
        )
      }))
      save()
    },

    closePane(wsId, tabId, paneId) {
      // Deliberate close -> kill this pane's tmux session.
      window.lanni.disposePane(paneId, true)
      destroyTerminal(paneId)
      set((s) => ({
        workspaces: s.workspaces.map((w) => {
          if (w.id !== wsId) return w
          const tabs: Tab[] = []
          for (const t of w.tabs) {
            if (t.id !== tabId) {
              tabs.push(t)
              continue
            }
            const layout = removePaneFromTree(t.layout, paneId)
            if (layout) tabs.push({ ...t, layout }) // else: last pane gone -> drop the tab
          }
          let activeTabId = w.activeTabId
          if (activeTabId && !tabs.find((t) => t.id === activeTabId)) {
            activeTabId = tabs.length ? tabs[tabs.length - 1].id : null
          }
          return { ...w, tabs, activeTabId }
        })
      }))
      save()
    },

    setRatios(wsId, tabId, path, ratios) {
      set((s) => ({
        workspaces: s.workspaces.map((w) =>
          w.id !== wsId
            ? w
            : { ...w, tabs: w.tabs.map((t) => (t.id !== tabId ? t : { ...t, layout: setRatiosAtPath(t.layout, path, ratios) })) }
        )
      }))
      save()
    },

    setPaneStartup(wsId, tabId, paneId, startupCommand) {
      const cmd = startupCommand || undefined
      set((s) => ({
        workspaces: s.workspaces.map((w) =>
          w.id !== wsId
            ? w
            : {
                ...w,
                tabs: w.tabs.map((t) => (t.id !== tabId ? t : { ...t, layout: updatePane(t.layout, paneId, { startupCommand: cmd }) }))
              }
        )
      }))
      save()
    }
  }
})
