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
