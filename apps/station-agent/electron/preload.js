// MES Missioner Electron — preload script (safe IPC bridge)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  platform: process.platform,

  // Event listeners from main process
  onSyncRestart: (cb) => ipcRenderer.on('sync-restart', cb),
  onDbClear: (cb) => ipcRenderer.on('db-clear', cb),

  // Cleanup
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
