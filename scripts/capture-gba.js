'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

function smokeRom() {
  const rom = Buffer.alloc(0x80);
  const words = [0xe59f0018, 0xe3a01003, 0xe5801000, 0xe59f2010, 0xe3a0301f, 0xe5823000, 0xeafffffe, 0, 0x04000000, 0x06000000];
  words.forEach((word, index) => rom.writeUInt32LE(word >>> 0, index * 4));
  return rom;
}

app.whenReady().then(async () => {
  ipcMain.handle('game:rom', () => smokeRom());
  const root = path.resolve(__dirname, '..');
  const window = new BrowserWindow({ width: 940, height: 720, show: false, backgroundColor: '#171922', webPreferences: { preload: path.join(root, 'src', 'main', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await window.loadFile(path.join(root, 'src', 'renderer', 'gba.html'));
  await new Promise((resolve) => setTimeout(resolve, 800));
  const image = await window.webContents.capturePage();
  const output = path.join(root, 'artifacts', 'gba-core.png');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, image.toPNG());
  process.stdout.write(`${output}\n`);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
