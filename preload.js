// Exposes a small, safe API to the page as window.desktop.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  open: () => ipcRenderer.invoke('file:open'),
  readFile: p => ipcRenderer.invoke('file:read', p),
  save: (p, data) => ipcRenderer.invoke('file:save', p, data),
  saveAs: (data, name) => ipcRenderer.invoke('file:save-as', data, name),
  askSaveChanges: () => ipcRenderer.invoke('dialog:save-changes'),
  getStartupFile: () => ipcRenderer.invoke('app:startup-file'),
  setDirty: v => ipcRenderer.send('app:set-dirty', !!v),
  setTitle: t => ipcRenderer.send('app:set-title', t),
  closeNow: () => ipcRenderer.send('app:close-now'),
  pathForFile: f => { try { return webUtils.getPathForFile(f); } catch (e) { return ''; } },
  onMenu: cb => ipcRenderer.on('menu', (_e, action, arg) => cb(action, arg))
});
