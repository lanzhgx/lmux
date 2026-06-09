import { useState } from 'react'
import type { Workspace } from '../../shared/types'
import { useStore } from '../store'
import { collectPanes } from '../lib/layoutTree'

export function TabBar({ workspace }: { workspace: Workspace }): JSX.Element {
  const setActiveTab = useStore((s) => s.setActiveTab)
  const addTab = useStore((s) => s.addTab)
  const closeTab = useStore((s) => s.closeTab)
  const renameTab = useStore((s) => s.renameTab)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const commit = (): void => {
    if (editingId && draft.trim()) renameTab(workspace.id, editingId, draft.trim())
    setEditingId(null)
  }

  return (
    <div className="tabbar">
      {workspace.tabs.map((t) => {
        const hasMain = collectPanes(t.layout).some((p) => p.isMain)
        return (
          <div
            key={t.id}
            className={`tab ${t.id === workspace.activeTabId ? 'active' : ''}`}
            onClick={() => setActiveTab(workspace.id, t.id)}
            title={hasMain ? `${t.title} (main session) — double-click to rename` : `${t.title} — double-click to rename`}
          >
            {hasMain && (
              <span className="tab-pin" title="Main session">
                ●
              </span>
            )}
            {editingId === t.id ? (
              <input
                className="tab-edit"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit()
                  if (e.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <span
                className="tab-title"
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setEditingId(t.id)
                  setDraft(t.title)
                }}
              >
                {t.title}
              </span>
            )}
            <button
              className="tab-close"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation()
                if (hasMain && !window.confirm("This tab holds the workspace's main session. Close it anyway?")) return
                closeTab(workspace.id, t.id)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
      <button className="tab-add" title="New tab" onClick={() => addTab(workspace.id)}>
        +
      </button>
    </div>
  )
}
