import { useEffect, useRef, useState } from 'react'
import type { PaneNode } from '../shared/types'
import { useStore } from './store'
import { collectPanes } from './lib/layoutTree'
import * as registry from './lib/terminalRegistry'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { LayoutView } from './components/LayoutView'

export function App(): JSX.Element {
  const loaded = useStore((s) => s.loaded)
  const init = useStore((s) => s.init)
  const workspaces = useStore((s) => s.workspaces)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const tmuxOk = useStore((s) => s.tmuxOk)
  const theme = useStore((s) => s.theme)

  // Workspaces that have been opened at least once. We keep their terminals mounted
  // (just hidden) so switching back is instant and the ssh/tmux connection is NOT
  // torn down and re-established. Bounded to visited workspaces so we don't eagerly
  // open every connection (or spin up an xterm/WebGL context) on launch.
  const [visited, setVisited] = useState<Set<string>>(() => new Set())
  const visitedRef = useRef(visited)
  visitedRef.current = visited

  useEffect(() => {
    init()
  }, [init])

  // Apply the theme to the app chrome (CSS vars) and to every terminal.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    registry.setTheme(theme)
  }, [theme])

  useEffect(() => {
    if (activeWorkspaceId && !visitedRef.current.has(activeWorkspaceId)) {
      setVisited((prev) => new Set(prev).add(activeWorkspaceId))
    }
  }, [activeWorkspaceId])

  // ⌘W (from the app menu) closes the currently focused pane.
  useEffect(() => {
    return window.lanni.onMenuClosePane(() => {
      const state = useStore.getState()
      const focused = registry.getFocusedPaneId()
      let found: { wsId: string; tabId: string; pane: PaneNode } | null = null
      for (const w of state.workspaces) {
        for (const t of w.tabs) {
          const p = collectPanes(t.layout).find((x) => (focused ? x.id === focused : false))
          if (p) {
            found = { wsId: w.id, tabId: t.id, pane: p }
            break
          }
        }
        if (found) break
      }
      if (!found) {
        // Fallback: the active workspace's active tab, first pane.
        const w = state.workspaces.find((x) => x.id === state.activeWorkspaceId) ?? state.workspaces[0]
        const t = w?.tabs.find((x) => x.id === w.activeTabId) ?? w?.tabs[0]
        const p = t ? collectPanes(t.layout)[0] : undefined
        if (w && t && p) found = { wsId: w.id, tabId: t.id, pane: p }
      }
      if (!found) return
      if (found.pane.isMain && !window.confirm("This is the workspace's main session. Close it anyway?")) return
      state.closePane(found.wsId, found.tabId, found.pane.id)
    })
  }, [])

  // Persist the codex session id main captured for a local codex pane, so it resumes
  // its own conversation by id on the next reconnect.
  useEffect(() => {
    return window.lanni.onCodexSessionCaptured((paneId, sessionId) => {
      useStore.getState().setCodexSessionId(paneId, sessionId)
    })
  }, [])

  if (!loaded) return <div className="loading">Loading…</div>

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0]

  return (
    <div className="app">
      <Sidebar />
      <div className="workspace">
        {!tmuxOk && (
          <div className="banner">
            tmux not found on PATH — run <code>brew install tmux</code> and restart.
          </div>
        )}
        {activeWs && <TabBar workspace={activeWs} />}
        <div className="panes">
          {workspaces.map((w) => {
            const wsActive = !!activeWs && w.id === activeWs.id
            // Render (and thus keep connected) the active workspace and any already-visited one.
            if (!wsActive && !visited.has(w.id)) return null
            return (
              <div
                key={w.id}
                className="ws-surface"
                style={{ display: wsActive ? 'block' : 'none' }}
              >
                {w.tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className="tab-surface"
                    style={{ display: tab.id === w.activeTabId ? 'block' : 'none' }}
                  >
                    <LayoutView
                      node={tab.layout}
                      connection={w.connection}
                      active={wsActive && tab.id === w.activeTabId}
                      wsId={w.id}
                      tabId={tab.id}
                    />
                  </div>
                ))}
                {w.tabs.length === 0 && wsActive && (
                  <div className="empty">No tabs — press + to open one.</div>
                )}
              </div>
            )
          })}
          {!activeWs && <div className="empty">No workspace.</div>}
        </div>
      </div>
    </div>
  )
}
