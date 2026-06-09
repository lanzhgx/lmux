import { useEffect, useRef, useState } from 'react'
import type { ConnectionKind, SshProbeResult } from '../../shared/types'
import { PROFILE_COMMANDS, type ProfileKey } from '../../shared/profiles'
import type { NewWorkspaceOpts } from '../store'

export function NewWorkspaceDialog({
  open,
  onClose,
  onCreate
}: {
  open: boolean
  onClose: () => void
  onCreate: (opts: NewWorkspaceOpts) => void
}): JSX.Element | null {
  const [kind, setKind] = useState<ConnectionKind>('local')
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [profile, setProfile] = useState<ProfileKey | 'custom'>('shell')
  const [customCmd, setCustomCmd] = useState('')
  const [directory, setDirectory] = useState('')
  const [hosts, setHosts] = useState<string[]>([])
  const [probe, setProbe] = useState<{ state: 'idle' | 'testing' | 'done'; result?: SshProbeResult }>({
    state: 'idle'
  })
  const nameRef = useRef<HTMLInputElement>(null)

  // Reset + load ~/.ssh/config hosts each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setKind('local')
    setName('')
    setHost('')
    setProfile('shell')
    setCustomCmd('')
    setDirectory('')
    setProbe({ state: 'idle' })
    window.lanni.listSshHosts().then(setHosts)
    setTimeout(() => nameRef.current?.focus(), 0)
  }, [open])

  if (!open) return null

  const canCreate = kind === 'local' || host.trim().length > 0

  const defaultStartup = profile === 'custom' ? customCmd.trim() : PROFILE_COMMANDS[profile]

  function submit(): void {
    if (!canCreate) return
    onCreate({
      name,
      connection: kind === 'ssh' ? { kind: 'ssh', host: host.trim() } : { kind: 'local' },
      defaultStartup: defaultStartup || undefined,
      directory: directory.trim() || undefined
    })
  }

  async function test(): Promise<void> {
    if (!host.trim()) return
    setProbe({ state: 'testing' })
    const result = await window.lanni.probeSsh(host.trim())
    setProbe({ state: 'done', result })
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">New workspace</div>

        <div className="seg">
          <button className={kind === 'local' ? 'on' : ''} onClick={() => setKind('local')}>
            Local
          </button>
          <button className={kind === 'ssh' ? 'on' : ''} onClick={() => setKind('ssh')}>
            SSH
          </button>
        </div>

        <label className="field">
          <span>Name {kind === 'ssh' ? '(optional)' : ''}</span>
          <input
            ref={nameRef}
            value={name}
            placeholder={kind === 'ssh' ? host || 'remote' : 'local'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>

        {kind === 'ssh' && (
          <>
            <label className="field">
              <span>Host (from ~/.ssh/config or user@host)</span>
              <input
                value={host}
                list="ssh-hosts"
                placeholder="build-box"
                onChange={(e) => {
                  setHost(e.target.value)
                  setProbe({ state: 'idle' })
                }}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
              <datalist id="ssh-hosts">
                {hosts.map((h) => (
                  <option key={h} value={h} />
                ))}
              </datalist>
            </label>

            <div className="probe-row">
              <button className="ghost" disabled={!host.trim() || probe.state === 'testing'} onClick={test}>
                {probe.state === 'testing' ? 'Testing…' : 'Test connection'}
              </button>
              {probe.state === 'done' && probe.result && (
                <span className={`probe ${probe.result.reachable && probe.result.tmux ? 'ok' : 'warn'}`}>
                  {probe.result.reachable && probe.result.tmux
                    ? '✓ reachable, tmux present'
                    : probe.result.message || 'unreachable'}
                </span>
              )}
            </div>
          </>
        )}

        <label className="field">
          <span>Directory (optional — where the command runs)</span>
          <input
            value={directory}
            placeholder="~/projects/api"
            onChange={(e) => setDirectory(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>

        <label className="field">
          <span>Run on connect (auto-resumes after a reboot)</span>
          <select value={profile} onChange={(e) => setProfile(e.target.value as ProfileKey | 'custom')}>
            <option value="shell">Shell</option>
            <option value="claude">Claude — claude --continue</option>
            <option value="codex">Codex — codex resume --last</option>
            <option value="custom">Custom…</option>
          </select>
        </label>
        {profile === 'custom' && (
          <label className="field">
            <span>Custom command</span>
            <input
              value={customCmd}
              placeholder="e.g. claude --continue"
              onChange={(e) => setCustomCmd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!canCreate} onClick={submit}>
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
