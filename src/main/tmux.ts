import { execFile } from 'node:child_process'

/** Single-quote a string for safe inclusion in a /bin/sh or remote-shell command. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * The connect snippet, run identically on first open and every reconnect. The
 * remote/local shell decides what happened:
 *   - session SURVIVED  -> just reattach (claude/codex still running, nothing lost)
 *   - session is GONE    -> recreate it in `cwd`, run `startup` (e.g. `claude
 *                           --continue`) to auto-resume, then attach
 * This makes recovery automatic after a reboot without the client having to detect
 * it. `exec` hands the tty straight to tmux so winsize/signals propagate.
 *
 * `session`/`cwd`/`startup` are single-quoted: session names round-trip through a
 * user-editable workspace.json (main also whitelists the name), and startup may be a
 * user-supplied custom command.
 *
 * Used both locally (wrapped in `/bin/sh -c`) and remotely (passed to `ssh`).
 */
// Build a shell-safe `cd` target. Absolute paths use tmux's own `-c`; a `~`/relative
// dir can't go through `tmux -c` (it won't expand `~`), so it becomes a `cd` typed
// into the shell, which DOES expand `~` (the leading `~` is left unquoted on purpose).
function cdArg(dir: string): string {
  if (dir === '~') return '~'
  if (dir.startsWith('~/')) return '~/' + shq(dir.slice(2))
  return shq(dir)
}

export function tmuxAttachScript(session: string, cwd?: string, startup?: string): string {
  const s = shq(session)
  const isAbs = !!cwd && cwd.startsWith('/')
  const startFlag = isAbs ? ` -c ${shq(cwd as string)}` : ''
  const cdCmd = cwd && !isAbs ? `cd ${cdArg(cwd)}` : ''
  const start = startup && startup.trim() ? startup.trim() : ''
  // Run the startup command IN the project dir: `cd <dir> && <startup>` (or just one).
  const full = start ? (cdCmd ? `${cdCmd} && ${start}` : start) : cdCmd
  const startupLine = full ? `tmux send-keys -t ${s} ${shq(full)} Enter; ` : ''
  // Enable mouse for THIS session (not -g) so touchpad scroll works: TUIs like claude
  // get the wheel and scroll their own view; plain shells scroll tmux's output history,
  // instead of the wheel being turned into arrow keys (which scrolled command history).
  const mouse = `tmux set-option -t ${s} mouse on >/dev/null 2>&1; `
  return (
    `if tmux has-session -t ${s} 2>/dev/null; then ` +
    mouse +
    `exec tmux -u attach -d -t ${s}; ` +
    `else ` +
    `tmux -u new-session -d -s ${s}${startFlag}; ` +
    `tmux set-option -t ${s} status off >/dev/null 2>&1; ` +
    mouse +
    startupLine +
    `exec tmux -u attach -d -t ${s}; ` +
    `fi`
  )
}

export function localTmuxCommand(session: string, cwd?: string, startup?: string): { file: string; args: string[] } {
  return { file: '/bin/sh', args: ['-c', tmuxAttachScript(session, cwd, startup)] }
}

/** Kill a local session so a deliberately-closed tab does not leave an orphan. */
export function killLocalSession(session: string, env: NodeJS.ProcessEnv): void {
  execFile('/bin/sh', ['-c', `tmux kill-session -t ${shq(session)}`], { env }, () => {})
}

export function checkTmux(env: NodeJS.ProcessEnv): Promise<{ ok: boolean; version?: string }> {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', 'tmux -V'], { env }, (err, stdout) => {
      if (err) resolve({ ok: false })
      else resolve({ ok: true, version: String(stdout).trim() })
    })
  })
}
