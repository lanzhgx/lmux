import { useEffect, useState } from 'react'
import { PROFILE_COMMANDS } from '../../shared/profiles'

/**
 * Asks what a new pane/tab should run: a new Claude or Codex session, a custom
 * command, or a plain terminal. Returns the startup command string ('' = shell).
 * Used for both splitting a pane and opening a new tab.
 */
export function SessionTypeDialog({
  open,
  title,
  onClose,
  onChoose
}: {
  open: boolean
  title: string
  onClose: () => void
  onChoose: (startup: string) => void
}): JSX.Element | null {
  const [custom, setCustom] = useState('')
  useEffect(() => {
    if (open) setCustom('')
  }, [open])
  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>

        <div className="split-choices">
          <button className="split-choice" onClick={() => onChoose(PROFILE_COMMANDS.claude)}>
            <strong>Claude</strong>
            <span>Start a new Claude session (restorable by id).</span>
          </button>
          <button className="split-choice" onClick={() => onChoose(PROFILE_COMMANDS.codex)}>
            <strong>Codex</strong>
            <span>Start a new Codex session (paste its id in the corner to restore).</span>
          </button>
          <button className="split-choice" onClick={() => onChoose('')}>
            <strong>Terminal</strong>
            <span>Plain shell, cd into the project folder.</span>
          </button>
        </div>

        <label className="field">
          <span>Or a custom command to start a session</span>
          <div className="custom-row">
            <input
              value={custom}
              placeholder="e.g. claude --model opus, or any command"
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && custom.trim() && onChoose(custom.trim())}
            />
            <button className="primary" disabled={!custom.trim()} onClick={() => onChoose(custom.trim())}>
              Use
            </button>
          </div>
        </label>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
