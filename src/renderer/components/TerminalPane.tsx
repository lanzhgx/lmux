import { useEffect, useReducer, useRef, useState } from 'react'
import type { Connection, PaneNode } from '../../shared/types'
import { useStore } from '../store'
import * as registry from '../lib/terminalRegistry'
import { SessionTypeDialog } from './SessionTypeDialog'
import { RestorePopover } from './RestorePopover'

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
  const setPaneNotes = useStore((s) => s.setPaneNotes)
  const togglePaneNotes = useStore((s) => s.togglePaneNotes)
  const hostRef = useRef<HTMLDivElement>(null)
  const [, force] = useReducer((c: number) => c + 1, 0)
  const [findOpen, setFindOpen] = useState(false)
  const [findTerm, setFindTerm] = useState('')
  const findInputRef = useRef<HTMLInputElement>(null)
  // While set, the session-type chooser asks what the new (split) pane should run.
  const [pendingSplit, setPendingSplit] = useState<'horizontal' | 'vertical' | null>(null)

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
        <button title="Find (⌘F)" onClick={() => setFindOpen((v) => !v)}>
          ⌕
        </button>
        <button
          title="Notes panel"
          className={pane.notesOpen ? 'on' : ''}
          onClick={() => togglePaneNotes(wsId, tabId, pane.id)}
        >
          ✎
        </button>
        <RestorePopover pane={pane} wsId={wsId} tabId={tabId} />
        <button title="Split right" onClick={() => setPendingSplit('horizontal')}>
          ⬌
        </button>
        <button title="Split down" onClick={() => setPendingSplit('vertical')}>
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

      <SessionTypeDialog
        open={pendingSplit !== null}
        title="New pane"
        onClose={() => setPendingSplit(null)}
        onChoose={(startup) => {
          if (pendingSplit) splitPane(wsId, tabId, pane.id, pendingSplit, startup || undefined)
          setPendingSplit(null)
        }}
      />

      <div className={pane.notesOpen ? 'term-host with-notes' : 'term-host'} ref={hostRef} />

      {pane.notesOpen && (
        <div className="pane-notes">
          <div className="pane-notes-header">
            <span>Notes</span>
            <button title="Collapse notes" onClick={() => togglePaneNotes(wsId, tabId, pane.id)}>
              ✕
            </button>
          </div>
          <textarea
            className="pane-notes-text"
            value={pane.notes ?? ''}
            placeholder="Scratchpad — type here while the terminal scrolls on its own."
            spellCheck={false}
            onChange={(e) => setPaneNotes(wsId, tabId, pane.id, e.target.value)}
          />
        </div>
      )}

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
