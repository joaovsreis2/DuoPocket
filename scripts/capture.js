'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const root = path.resolve(__dirname, '..');

app.whenReady().then(async () => {
  ipcMain.handle('app:state', () => ({
    ok: true,
    games: [],
    emulators: {
      mgba: { version: '0.10.5', ready: true },
      melonds: { version: '1.1', ready: true }
    }
  }));

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#EDF1F2',
    webPreferences: {
      preload: path.join(root, 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  await window.loadFile(path.join(root, 'src', 'renderer', 'index.html'), { query: { demo: '1' } });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const image = await window.webContents.capturePage();
  const targetDir = path.join(root, 'artifacts');
  await fs.mkdir(targetDir, { recursive: true });
  const target = path.join(targetDir, 'interface.png');
  await fs.writeFile(target, image.toPNG());
  process.stdout.write(`${target}\n`);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
