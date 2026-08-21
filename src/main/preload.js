'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('duopocket', {
  getState: () => ipcRenderer.invoke('app:state'),
  chooseFiles: () => ipcRenderer.invoke('library:choose-files'),
  chooseFolder: () => ipcRenderer.invoke('library:choose-folder'),
  importPaths: (paths) => ipcRenderer.invoke('library:import-paths', paths),
  filePath: (file) => webUtils.getPathForFile(file),
  toggleFavorite: (id) => ipcRenderer.invoke('library:toggle-favorite', id),
  remove: (id) => ipcRenderer.invoke('library:remove', id),
  reveal: (id) => ipcRenderer.invoke('library:reveal', id),
  launch: (id) => ipcRenderer.invoke('game:launch', id),
  openEmulator: (engine) => ipcRenderer.invoke('emulator:open', engine),
  getRom: () => ipcRenderer.invoke('game:rom'),
  saveRom: (bytes) => ipcRenderer.invoke('game:save', bytes),
  onBeforeGameClose: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('game:before-close', handler);
    return () => ipcRenderer.removeListener('game:before-close', handler);
  },
  gameCloseReady: () => ipcRenderer.invoke('game:close-ready')
});
