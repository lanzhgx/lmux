// IPC channel names shared between main and preload. Keep as the single source
// of truth so renderer/main never drift on a magic string.
export const Ch = {
  // renderer -> main
  ptyCreate: 'pty:create',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyDispose: 'pty:dispose',
  stateLoad: 'state:load',
  stateSave: 'state:save',
  tmuxCheck: 'tmux:check',
  sshListHosts: 'ssh:list-hosts',
  sshProbe: 'ssh:probe',
  openExternal: 'open-external',
  copyText: 'clipboard:write',
  // main -> renderer
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  menuClosePane: 'menu:close-pane'
} as const
