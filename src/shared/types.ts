// ---------------------------------------------------------------------------
// Persisted domain model
// ---------------------------------------------------------------------------

export type ConnectionKind = 'local' | 'ssh'

export interface Connection {
  kind: ConnectionKind
  /** ssh destination: an alias from ~/.ssh/config or `user@host`. */
  host?: string
  /** Pointer to a macOS Keychain entry holding the secret (M2). Never the secret itself. */
  keychainRef?: string
}

/** A leaf in the layout tree — one terminal backed by one tmux session. */
export interface PaneNode {
  type: 'pane'
  id: string
  tmuxSession: string
  /** Working dir to (re)create the session in. */
  cwd?: string
  /** Command to run on a FRESH session (e.g. `claude --continue`). '' = plain shell. */
  startupCommand?: string
  /** Free-text scratchpad shown beside this pane (persisted, scrolls independently). */
  notes?: string
  /** Whether the scratchpad is expanded. Undefined/false = collapsed. */
  notesOpen?: boolean
  /** The workspace's primary pane: holds the AI session and is protected on close. */
  isMain?: boolean
}

/** An interior node — a horizontal or vertical split of child nodes. */
export interface SplitNode {
  type: 'split'
  orientation: 'horizontal' | 'vertical'
  /** One ratio per child, summing to ~1. */
  ratios: number[]
  children: LayoutNode[]
}

export type LayoutNode = PaneNode | SplitNode

export interface Tab {
  id: string
  title: string
  layout: LayoutNode
}

export interface Workspace {
  id: string
  name: string
  connection: Connection
  /** Default startupCommand inherited by new tabs/panes in this workspace. */
  defaultStartup?: string
  /** Project directory new panes start in (seed for pane.cwd; auto-capture refines it). */
  directory?: string
  activeTabId: string | null
  tabs: Tab[]
}

/**
 * Versioned persisted document. Window geometry is stored separately by the
 * main process (electron-window-state). Multi-window is deferred (M4); for now
 * a single window owns all workspaces.
 */
export type Theme = 'dark' | 'light'

export interface PersistedState {
  version: number
  theme?: Theme
  activeWorkspaceId: string | null
  workspaces: Workspace[]
}

// ---------------------------------------------------------------------------
// PTY-host protocol (main <-> utilityProcess)
// ---------------------------------------------------------------------------

export interface PtyCreateRequest {
  ptyId: string
  tmuxSession: string
  connection: Connection
  cwd?: string
  startupCommand?: string
  cols: number
  rows: number
}

export interface SshProbeResult {
  reachable: boolean
  tmux: boolean
  message?: string
}

/** Resolved spawn command sent from main to the pty-host. */
export interface PtySpawnSpec {
  ptyId: string
  file: string
  args: string[]
  cwd?: string
  env: Record<string, string>
  cols: number
  rows: number
}

export type HostInbound =
  | ({ type: 'create' } & PtySpawnSpec)
  | { type: 'input'; ptyId: string; data: string }
  | { type: 'resize'; ptyId: string; cols: number; rows: number }
  | { type: 'kill'; ptyId: string }

export type HostOutbound =
  | { type: 'spawned'; ptyId: string; pid: number }
  | { type: 'data'; ptyId: string; data: string }
  | { type: 'exit'; ptyId: string; exitCode: number; error?: string }

// ---------------------------------------------------------------------------
// Renderer-facing API (exposed on window.lanni via the preload contextBridge)
// ---------------------------------------------------------------------------

export interface LanniApi {
  createPane(req: PtyCreateRequest): Promise<boolean>
  sendInput(ptyId: string, data: string): void
  resizePane(ptyId: string, cols: number, rows: number): void
  /** Detach the pty; if killSession, also `tmux kill-session` so it does not persist. */
  disposePane(ptyId: string, killSession?: boolean): void
  onData(cb: (ptyId: string, data: string) => void): () => void
  onExit(cb: (ptyId: string, exitCode: number) => void): () => void
  loadState(): Promise<PersistedState | null>
  saveState(state: PersistedState): void
  checkTmux(): Promise<{ ok: boolean; version?: string }>
  listSshHosts(): Promise<string[]>
  probeSsh(host: string): Promise<SshProbeResult>
  openExternal(url: string): void
  /** Write text to the system clipboard (copy-on-select). */
  copyText(text: string): void
  /** Fired when the user presses ⌘W (close the focused pane). */
  onMenuClosePane(cb: () => void): () => void
}
