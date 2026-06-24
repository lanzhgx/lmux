// Pane "profiles" map a friendly tool name to the command lanni runs on a FRESH
// tmux session (first open or after a remote reboot). These resume commands are
// safe to run unconditionally: each starts a new session if there's nothing to
// resume, and both are scoped to the current directory.
export const PROFILE_COMMANDS = {
  shell: '',
  claude: 'claude --continue',
  // A new codex pane starts a fresh session; paste its id into the pane's id field to
  // make it restorable. Legacy panes created earlier may carry `codex resume --last`.
  codex: 'codex'
} as const

export type ProfileKey = keyof typeof PROFILE_COMMANDS

/** Classify a stored startupCommand back into a profile key (for the UI). */
export function profileOf(cmd?: string): ProfileKey | 'custom' {
  if (!cmd || !cmd.trim()) return 'shell'
  if (cmd === PROFILE_COMMANDS.claude) return 'claude'
  if (cmd === PROFILE_COMMANDS.codex || cmd === 'codex resume --last') return 'codex'
  return 'custom'
}

// Lowercase-hex UUID (defends the command string we interpolate into; lmux mints
// these via crypto.randomUUID so they always match, but validate before use anyway).
const UUID_RE = /^[0-9a-fA-F-]{36}$/

interface PaneSession {
  startupCommand?: string
  claudeSessionId?: string
  codexSessionId?: string
}

/**
 * Resolve the command run on a FRESH session from a pane's profile + its session id.
 * When the pane has an id for its tool it resumes THAT conversation by id (works local
 * AND ssh, since the command runs wherever the pane does). With no id it falls back to
 * the plain stored command, so shell / custom / not-yet-assigned panes are unchanged.
 */
export function resolveStartupCommand(pane: PaneSession): string {
  const cmd = pane.startupCommand || ''
  const profile = profileOf(cmd)
  if (profile === 'claude' && pane.claudeSessionId && UUID_RE.test(pane.claudeSessionId)) {
    const u = pane.claudeSessionId
    // Resume our conversation if its transcript exists; otherwise create it with that
    // id. On the next reconnect --resume succeeds, avoiding claude's "id already in
    // use" error. Wrapped in `sh -c` so the glob is POSIX-evaluated (zsh would print
    // "no matches found" and bash `nullglob` would wrongly take the resume branch).
    return `sh -c 'if ls "$HOME"/.claude/projects/*/${u}.jsonl >/dev/null 2>&1; then claude --resume ${u}; else claude --session-id ${u}; fi'`
  }
  if (profile === 'codex' && pane.codexSessionId && UUID_RE.test(pane.codexSessionId)) {
    // Resume this pane's pasted session; if it's gone, start fresh. Braces keep the
    // `||` from binding to a preceding `cd` if that ever fails.
    return `{ codex resume ${pane.codexSessionId} || codex; }`
  }
  return cmd
}
