// Short, tmux-safe ids (alphanumeric only — tmux session names dislike '.'/':').
export const genId = (prefix: string): string =>
  prefix + Math.random().toString(36).slice(2, 9)

// A real UUID for a claude conversation id (`claude --session-id` requires one).
// Available in the renderer (Web Crypto) and in Node.
export const genUuid = (): string => crypto.randomUUID()

// Deterministic tmux session name for a pane. Stable across app restarts because
// it is derived from persisted workspace/tab/pane ids.
export const sessionName = (wsId: string, tabId: string, paneId: string): string =>
  `lanni-${wsId}-${tabId}-${paneId}`
