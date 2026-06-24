import { useEffect, useState } from 'react'
import type { PaneNode } from '../../shared/types'
import { PROFILE_COMMANDS, profileOf, type ProfileKey } from '../../shared/profiles'
import { useStore } from '../store'

const TYPES: { key: ProfileKey | 'custom'; label: string }[] = [
  { key: 'shell', label: 'Terminal' },
  { key: 'claude', label: 'Claude' },
  { key: 'codex', label: 'Codex' },
  { key: 'custom', label: 'Custom' }
]
const CODEX_FIND =
  "ls -t ~/.codex/sessions/**/rollout-*.jsonl | head -1 | sed -E 's/.*-([0-9a-f-]{36})\\.jsonl$/\\1/'"
const CLAUDE_FIND = "basename \"$(ls -t \"$HOME/.claude/projects/$(pwd -P|sed 's#/#-#g')\"/*.jsonl | head -1)\" .jsonl"

/**
 * Top-right control for a pane's session: choose its type (Terminal / Claude / Codex /
 * Custom) and set how it restores. Claude/Codex edit a session id (lmux fills claude's,
 * the user pastes codex's); Custom edits the full restore command. Applied on the next
 * session (re)start. All four types are always available (unlike the old dropdown).
 */
export function RestorePopover({ pane, wsId, tabId }: { pane: PaneNode; wsId: string; tabId: string }): JSX.Element {
  const setPaneStartup = useStore((s) => s.setPaneStartup)
  const setPaneSessionId = useStore((s) => s.setPaneSessionId)
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<ProfileKey | 'custom'>('shell')
  const [id, setId] = useState('')
  const [cmd, setCmd] = useState('')

  // Initialize the draft from the pane each time the popover opens.
  useEffect(() => {
    if (!open) return
    const cur = profileOf(pane.startupCommand)
    setType(cur)
    setId(cur === 'codex' ? pane.codexSessionId ?? '' : pane.claudeSessionId ?? '')
    setCmd(cur === 'custom' ? pane.startupCommand ?? '' : '')
  }, [open])

  function pick(t: ProfileKey | 'custom'): void {
    setType(t)
    if (t === 'codex') setId(pane.codexSessionId ?? '')
    else if (t === 'claude') setId(pane.claudeSessionId ?? '')
    else if (t === 'custom') setCmd(profileOf(pane.startupCommand) === 'custom' ? pane.startupCommand ?? '' : cmd)
  }

  function save(): void {
    if (type === 'shell') setPaneStartup(wsId, tabId, pane.id, '')
    else if (type === 'custom') setPaneStartup(wsId, tabId, pane.id, cmd.trim())
    else {
      // setPaneStartup mints a claude id when switching INTO claude; then apply any id
      // the user typed (blank claude id keeps the freshly-minted one).
      setPaneStartup(wsId, tabId, pane.id, type === 'claude' ? PROFILE_COMMANDS.claude : PROFILE_COMMANDS.codex)
      if (id.trim()) setPaneSessionId(wsId, tabId, pane.id, id.trim())
    }
    setOpen(false)
  }

  const saveDisabled = type === 'custom' && !cmd.trim()

  return (
    <>
      <button title="Session settings" className={open ? 'on' : ''} onClick={() => setOpen((v) => !v)}>
        #
      </button>
      {open && (
        <>
          <div className="popover-backdrop" onMouseDown={() => setOpen(false)} />
          <div className="restore-popover" onMouseDown={(e) => e.stopPropagation()}>
            <div className="restore-types">
              {TYPES.map((t) => (
                <button
                  key={t.key}
                  className={`restore-type ${type === t.key ? 'on' : ''}`}
                  onClick={() => pick(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {type === 'shell' && <div className="restore-hint">Plain terminal — nothing to restore.</div>}

            {(type === 'claude' || type === 'codex') && (
              <>
                <div className="restore-title">{type === 'claude' ? 'Claude' : 'Codex'} session id</div>
                <textarea
                  className="restore-input"
                  rows={2}
                  value={id}
                  placeholder={type === 'claude' ? 'auto-created if left blank' : 'paste codex session id (UUID)'}
                  spellCheck={false}
                  onChange={(e) => setId(e.target.value)}
                />
                {type === 'claude' && (
                  <div className="restore-hint">
                    lmux creates and resumes this id. Paste a different id to adopt an existing conversation. Find one:{' '}
                    <code>{CLAUDE_FIND}</code>
                  </div>
                )}
                {type === 'codex' && (
                  <div className="restore-hint">
                    Codex makes its own id. Run this in the pane to get it, then paste: <code>{CODEX_FIND}</code>
                  </div>
                )}
              </>
            )}

            {type === 'custom' && (
              <>
                <div className="restore-title">Custom command</div>
                <textarea
                  className="restore-input"
                  rows={3}
                  value={cmd}
                  placeholder="command run when this pane (re)starts"
                  spellCheck={false}
                  onChange={(e) => setCmd(e.target.value)}
                />
              </>
            )}

            <div className="restore-actions">
              <button className="ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="primary" disabled={saveDisabled} onClick={save}>
                Save
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
