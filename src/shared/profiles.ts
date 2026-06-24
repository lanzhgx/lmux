// Pane "profiles" map a friendly tool name to the command lanni runs on a FRESH
// tmux session (first open or after a remote reboot). These resume commands are
// safe to run unconditionally: each starts a new session if there's nothing to
// resume, and both are scoped to the current directory.
export const PROFILE_COMMANDS = {
  shell: '',
  claude: 'claude --continue',
  codex: 'codex resume --last'
} as const

export type ProfileKey = keyof typeof PROFILE_COMMANDS

/** Classify a stored startupCommand back into a profile key (for the UI). */
export function profileOf(cmd?: string): ProfileKey | 'custom' {
  if (!cmd || !cmd.trim()) return 'shell'
  if (cmd === PROFILE_COMMANDS.claude) return 'claude'
  if (cmd === PROFILE_COMMANDS.codex) return 'codex'
  return 'custom'
}

// Lowercase-hex UUID (defends the command string we interpolate into; lmux mints
// these via crypto.randomUUID so they always match, but validate before use anyway).
const UUID_RE = /^[0-9a-fA-F-]{36}$/

interface PaneSession {
  startupCommand?: string
  claudeSessionId?: string
  codexSessionId?: string
  codexOwned?: boolean
}

/**
 * Resolve the actual command run on a FRESH session from a pane's profile + ids.
 * LOCAL panes that own an AI session resume their OWN conversation by id; everything
 * else (ssh, shell, custom, and legacy panes with no id) is returned unchanged so
 * existing `claude --continue` / `codex resume --last` behaviour is preserved.
 */
export function resolveStartupCommand(pane: PaneSession, isLocal: boolean): string {
  const cmd = pane.startupCommand || ''
  if (!isLocal) return cmd
  const profile = profileOf(cmd)
  if (profile === 'claude' && pane.claudeSessionId && UUID_RE.test(pane.claudeSessionId)) {
    const u = pane.claudeSessionId
    // Resume our conversation if it exists (glob is encoding-independent and unique
    // because the id is lmux-minted); otherwise create it with that id. On the next
    // reconnect --resume succeeds. Avoids claude's "id already in use" error.
    // Wrapped in `sh -c` so the glob is evaluated by POSIX sh, NOT the interactive
    // shell: zsh would print "no matches found" on first run and bash `nullglob`
    // would wrongly take the resume branch. sh does neither.
    return `sh -c 'if ls "$HOME"/.claude/projects/*/${u}.jsonl >/dev/null 2>&1; then claude --resume ${u}; else claude --session-id ${u}; fi'`
  }
  if (profile === 'codex' && pane.codexOwned) {
    if (pane.codexSessionId && UUID_RE.test(pane.codexSessionId)) {
      // Resume this pane's captured session; if it's gone, start fresh (NOT
      // `resume --last`, which could adopt another pane's session). Braces keep the
      // `||` from binding to a preceding `cd` if that ever fails.
      return `{ codex resume ${pane.codexSessionId} || codex; }`
    }
    return 'codex' // first run: bare codex; main captures the auto-generated id
  }
  return cmd
}

/** True when a LOCAL codex pane is owned but hasn't captured its session id yet. */
export function needsCodexCapture(pane: PaneSession, isLocal: boolean): boolean {
  return (
    isLocal &&
    profileOf(pane.startupCommand) === 'codex' &&
    !!pane.codexOwned &&
    !(pane.codexSessionId && UUID_RE.test(pane.codexSessionId))
  )
}
