# lmux

A desktop terminal multiplexer (Electron + React + xterm.js) where **every terminal
is backed by a tmux session**, so quitting and reopening the app reconnects to your
live sessions — locally or over SSH. (Internal/repo name: `lanni`.)

## Features

- **Workspace sidebar** — create / switch / rename (double-click) / delete / drag-to-reorder.
- **Tabs per workspace** — each tab is an independent terminal.
- **Split panes** — split any pane right (`⬌`) or down (`⬍`) via its hover toolbar;
  draggable dividers; each pane is its own tmux session.
- **Per-workspace SSH** — "New workspace" prompts Local vs SSH; SSH hosts autocomplete
  from `~/.ssh/config`. Auth uses your existing keys / ssh-agent (no passwords stored).
- **Auto-reconnect** — workspaces, tabs and split layout persist to
  `~/Library/Application Support/lanni/workspace.json`; on relaunch every pane
  reattaches to its tmux session (`tmux new-session -A`). A dropped SSH pane shows a
  **Reconnect** button.
- **Resize-friendly** — debounced `ResizeObserver → fit → pty.resize → tmux`, so it
  reflows cleanly when you move the window to a vertical monitor.
- **In-terminal search** (`⌘F` or the `⌕` button) and **clickable links**.

## Requirements

- macOS, Node 20+, and `tmux` (`brew install tmux`). For SSH workspaces, the remote
  host needs `tmux` on its default `PATH`.

## Run

```bash
npm install      # postinstall rebuilds node-pty for Electron's ABI
npm run dev
```

## Build a .dmg

```bash
npm run package  # -> dist/lanni-<version>-arm64.dmg  (unsigned)
```

The build is unsigned, so the first launch needs a one-time **right-click → Open**.

## Architecture

Three processes (the VS Code terminal model):

- **main** (`src/main`) — window, IPC, persistence (`store.ts`), local (`tmux.ts`) and
  SSH (`ssh.ts`) command builders. Forks the pty-host. Whitelists session names /
  ssh hosts at the spawn boundary.
- **pty-host** (`src/pty-host`) — an Electron `utilityProcess` running `node-pty`;
  isolates terminal IO from the UI.
- **renderer** (`src/renderer`) — React + xterm.js. State in zustand: workspaces →
  tabs → a recursive split-layout tree.

Each pane maps to a tmux session named `lanni-<workspaceId>-<tabId>-<paneId>`.
Closing a tab/pane kills its session; quitting the app leaves sessions alive so they
can be reattached next launch.

## Note on this machine's toolchain

`xcode-select` points at an old Xcode 15 (clang 15), which can't compile native
modules against the macOS 26 SDK (`__builtin_ctzg` errors). The `rebuild` /
`postinstall` / `package` scripts set `DEVELOPER_DIR=/Library/Developer/CommandLineTools`
(clang 21) to work around it. A permanent global fix:
`sudo xcode-select -s /Library/Developer/CommandLineTools`.
