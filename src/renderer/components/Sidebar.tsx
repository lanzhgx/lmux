import { useState } from 'react'
import { useStore } from '../store'
import { NewWorkspaceDialog } from './NewWorkspaceDialog'

export function Sidebar(): JSX.Element {
  const workspaces = useStore((s) => s.workspaces)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const setActiveWorkspace = useStore((s) => s.setActiveWorkspace)
  const addWorkspace = useStore((s) => s.addWorkspace)
  const renameWorkspace = useStore((s) => s.renameWorkspace)
  const deleteWorkspace = useStore((s) => s.deleteWorkspace)
  const moveWorkspace = useStore((s) => s.moveWorkspace)
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  function commitRename(): void {
    if (editingId && draft.trim()) renameWorkspace(editingId, draft.trim())
    setEditingId(null)
  }

  return (
    <div className="sidebar">
      <div className="sidebar-brand">lmux</div>
      <div className="sidebar-list">
        {workspaces.map((w) => (
          <div
            key={w.id}
            className={`ws ${w.id === activeWorkspaceId ? 'active' : ''} ${w.id === dragOverId ? 'drag-over' : ''}`}
            title={w.connection.kind === 'ssh' ? `ssh: ${w.connection.host}` : 'local'}
            draggable={editingId !== w.id}
            onClick={() => setActiveWorkspace(w.id)}
            onDragStart={() => setDragId(w.id)}
            onDragOver={(e) => {
              e.preventDefault()
              if (dragId && dragId !== w.id) setDragOverId(w.id)
            }}
            onDragLeave={() => setDragOverId((cur) => (cur === w.id ? null : cur))}
            onDrop={(e) => {
              e.preventDefault()
              if (dragId && dragId !== w.id) moveWorkspace(dragId, w.id)
              setDragId(null)
              setDragOverId(null)
            }}
          >
            <span className={`ws-dot ${w.connection.kind}`} />
            {editingId === w.id ? (
              <input
                className="ws-edit"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <span
                className="ws-name"
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setEditingId(w.id)
                  setDraft(w.name)
                }}
              >
                {w.name}
              </span>
            )}
            <button
              className="ws-del"
              title="Delete workspace"
              onClick={(e) => {
                e.stopPropagation()
                if (window.confirm(`Delete workspace "${w.name}"? This kills its tmux sessions.`)) {
                  deleteWorkspace(w.id)
                }
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button className="ws-add" onClick={() => setDialogOpen(true)}>
        + workspace
      </button>
      <button className="theme-toggle" onClick={toggleTheme} title="Toggle light / dark">
        {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
      </button>
      <NewWorkspaceDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={(opts) => {
          addWorkspace(opts)
          setDialogOpen(false)
        }}
      />
    </div>
  )
}
