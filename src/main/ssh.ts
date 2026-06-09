import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SshProbeResult } from '../shared/types'
import { shq, tmuxAttachScript } from './tmux'

// Keepalive + first-connect behaviour applied to every ssh invocation. We pass these
// as -o options rather than editing the user's ~/.ssh/config (non-invasive). Auth is
// left entirely to the user's keys / ssh-agent.
const KEEPALIVE = ['-o', 'ServerAliveInterval=60', '-o', 'ServerAliveCountMax=3']
const FIRST_CONNECT = ['-o', 'StrictHostKeyChecking=accept-new']

/**
 * Interactive ssh that lands in a remote tmux session. `-tt` forces a remote pty
 * (tmux needs one). Same command on create and reconnect — idempotent via tmux `-A`.
 */
export function sshTmuxCommand(
  host: string,
  session: string,
  cwd?: string,
  startup?: string
): { file: string; args: string[] } {
  return {
    file: 'ssh',
    args: ['-tt', ...KEEPALIVE, ...FIRST_CONNECT, '-o', 'ConnectTimeout=12', host, tmuxAttachScript(session, cwd, startup)]
  }
}

/** Kill a remote session (deliberate tab close). BatchMode so it never blocks on a prompt. */
export function killRemoteSession(host: string, session: string, env: NodeJS.ProcessEnv): void {
  execFile(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, `tmux kill-session -t ${shq(session)}`],
    { env },
    () => {}
  )
}

/** Host aliases from ~/.ssh/config (for new-workspace autocomplete). Wildcards excluded. */
export function listSshHosts(): string[] {
  try {
    const txt = readFileSync(join(homedir(), '.ssh', 'config'), 'utf8')
    const hosts: string[] = []
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*Host\s+(.+?)\s*$/i)
      if (!m) continue
      for (const h of m[1].split(/\s+/)) {
        if (h && !h.includes('*') && !h.includes('?') && !h.startsWith('!')) hosts.push(h)
      }
    }
    return Array.from(new Set(hosts)).sort()
  } catch {
    return []
  }
}

/**
 * Probe a host on workspace creation: is it reachable (keys only, no prompts) and is
 * tmux installed there? Surfaces problems early instead of inside a dead terminal.
 */
export function probeSsh(host: string, env: NodeJS.ProcessEnv): Promise<SshProbeResult> {
  return new Promise((resolve) => {
    execFile(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        ...FIRST_CONNECT,
        host,
        'command -v tmux >/dev/null 2>&1 && echo TMUX_OK || echo TMUX_MISSING'
      ],
      { env, timeout: 15000 },
      (err, stdout, stderr) => {
        const out = String(stdout)
        if (out.includes('TMUX_OK')) resolve({ reachable: true, tmux: true })
        else if (out.includes('TMUX_MISSING'))
          resolve({ reachable: true, tmux: false, message: 'Connected, but tmux is not installed on the remote.' })
        else
          resolve({
            reachable: false,
            tmux: false,
            message: String(stderr).trim().split('\n').pop() || (err ? err.message : 'Could not connect.')
          })
      }
    )
  })
}
