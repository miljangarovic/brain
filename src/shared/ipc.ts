export const IPC = {
  workspaceLoad: 'workspace:load',
  workspaceSave: 'workspace:save',
  ptyCreate: 'pty:create',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit'
} as const
