import { useEffect, useReducer, useRef, useState } from 'react'
import type { Connection, PaneNode } from '../../shared/types'
import { PROFILE_COMMANDS, profileOf, type ProfileKey } from '../../shared/profiles'
import { useStore } from '../store'
import * as registry from '../lib/terminalRegistry'

export function TerminalPane({
  pane,
  connection,
  active,
  wsId,
  tabId
}: {
  pane: PaneNode
  connection: Connection
  active: boolean
  wsId: string
  tabId: string
}): JSX.Element {
  const splitPane = useStore((s) => s.splitPane)
  const closePane = useStore((s) => s.closePane)
  const setPaneStartup = useStore((s) => s.setPaneStartup)
  const hostRef = useRef<HTMLDivElement>(null)
  const [, force] = useReducer((c: number) => c + 1, 0)
  const [findOpen, setFindOpen] = useState(false)
  const [findTerm, setFindTerm] = useState('')
  const findInputRef = useRef<HTMLInputElement>(null)

  // Mount the pane's persistent terminal DOM into our host. The terminal itself
  // (xterm + ssh/tmux connection) lives in the registry and survives this component
  // unmounting/remounting (e.g. when a split reparents it) — so no reconnect.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const entry = registry.acquire(pane, connection)
    host.appendChild(entry.container)
    const unsub = registry.subscribe(pane.id, force)
    registry.setFindHandler(pane.id, () => setFindOpen(true))
    return () => {
      registry.setFindHandler(pane.id, null)
      unsub()
      if (entry.container.parentElement === host) host.removeChild(entry.container)
    }
  }, [pane.id])

  // Keep the registry's copy of pane/connection current (cwd, profile, etc. can change).
  useEffect(() => {
    registry.acquire(pane, connection)
  }, [pane, connection])

  // Connect on first activation; resync size on later activations.
  useEffect(() => {
    if (active) registry.activate(pane.id)
  }, [active, pane.id, pane.cwd, pane.startupCommand])

  useEffect(() => {
    if (findOpen) findInputRef.current?.focus()
  }, [findOpen])

  const status = registry.getStatus(pane.id)

  return (
    <div className="term-wrap">
      <div className="pane-toolbar">
        <select
          className="pane-profile"
          title="Run on connect (auto-resumes after reboot)"
          value={profileOf(pane.startupCommand)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const key = e.target.value as ProfileKey | 'custom'
            if (key === 'custom') return
            setPaneStartup(wsId, tabId, pane.id, PROFILE_COMMANDS[key])
          }}
        >
          <option value="shell">sh</option>
          <option value="claude">claude</option>
          <option value="codex">codex</option>
          {profileOf(pane.startupCommand) === 'custom' && <option value="custom">custom</option>}
        </select>
        <button title="Find (⌘F)" onClick={() => setFindOpen((v) => !v)}>
          ⌕
        </button>
        <button title="Split right" onClick={() => splitPane(wsId, tabId, pane.id, 'horizontal')}>
          ⬌
        </button>
        <button title="Split down" onClick={() => splitPane(wsId, tabId, pane.id, 'vertical')}>
          ⬍
        </button>
        <button
          title={pane.isMain ? 'Close main pane (⌘W)' : 'Close pane (⌘W)'}
          onClick={() => {
            if (pane.isMain && !window.confirm("This is the workspace's main session. Close it anyway?")) return
            closePane(wsId, tabId, pane.id)
          }}
        >
          ✕
        </button>
      </div>

      {findOpen && (
        <div className="find-box">
          <input
            ref={findInputRef}
            value={findTerm}
            placeholder="Find"
            onChange={(e) => {
              setFindTerm(e.target.value)
              registry.search(pane.id, e.target.value, false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') registry.search(pane.id, findTerm, e.shiftKey)
              if (e.key === 'Escape') setFindOpen(false)
            }}
          />
          <button title="Previous" onClick={() => registry.search(pane.id, findTerm, true)}>
            ↑
          </button>
          <button title="Next" onClick={() => registry.search(pane.id, findTerm, false)}>
            ↓
          </button>
          <button title="Close" onClick={() => setFindOpen(false)}>
            ✕
          </button>
        </div>
      )}

      <div className="term-host" ref={hostRef} />

      {status.reconnectAttempt > 0 && (
        <div className="term-overlay">
          <div>
            Reconnecting to {connection.host}… <span className="dim">(attempt {status.reconnectAttempt})</span>
          </div>
          <button className="ghost" onClick={() => registry.cancelReconnect(pane.id)}>
            Cancel
          </button>
        </div>
      )}
      {status.connecting && status.reconnectAttempt === 0 && connection.kind === 'ssh' && (
        <div className="term-overlay">Connecting to {connection.host}…</div>
      )}
      {status.disconnected && status.reconnectAttempt === 0 && (
        <div className="term-overlay">
          <div className="overlay-msg">Disconnected</div>
          <button className="primary" onClick={() => registry.reconnect(pane.id)}>
            Reconnect
          </button>
        </div>
      )}
    </div>
  )
}
