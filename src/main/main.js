'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const { LibraryStore, isSupported, scanDirectory } = require('./library');

const EMULATORS = Object.freeze({
  mgba: { name: 'DuoGBA próprio', version: '0.1.0-alpha', own: true },
  melonds: { name: 'melonDS', version: '1.1', relativeExe: path.join('melonDS', 'melonDS.exe') }
});

let mainWindow;
let library;
const gbaWindows = new Map();

function projectRoot() {
  return path.resolve(__dirname, '..', '..');
}

function emulatorsRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'emulators')
    : path.join(projectRoot(), 'vendor', 'emulators');
}

function emulatorPath(engine) {
  const definition = EMULATORS[engine];
  if (!definition) throw new Error('Emulador desconhecido.');
  if (definition.own) return null;
  return path.join(emulatorsRoot(), definition.relativeExe);
}

function emulatorStatus() {
  return Object.fromEntries(
    Object.entries(EMULATORS).map(([id, emulator]) => {
      const executable = emulatorPath(id);
      return [id, { ...emulator, ready: emulator.own ? true : fs.existsSync(executable) }];
    })
  );
}

function launchExecutable(executable, args = []) {
  if (!fs.existsSync(executable)) {
    throw new Error('O componente de emulação não foi encontrado. Reinstale o DuoPocket.');
  }
  const child = spawn(executable, args, {
    cwd: path.dirname(executable),
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 650,
    show: false,
    backgroundColor: '#EDF1F2',
    icon: path.join(projectRoot(), 'assets', 'icons', 'app-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const loadOptions = process.env.DUOPOCKET_CAPTURE === '1' ? { query: { demo: '1' } } : {};
  await mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), loadOptions);
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

async function openGbaWindow(game) {
  const existing = gbaWindows.get(game.id);
  if (existing && !existing.isDestroyed()) { existing.focus(); return existing; }
  const gbaWindow = new BrowserWindow({
    width: 940,
    height: 720,
    minWidth: 600,
    minHeight: 520,
    backgroundColor: '#171922',
    title: `DuoGBA · ${game.title}`,
    icon: path.join(projectRoot(), 'assets', 'icons', 'app-256.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  gbaWindows.set(game.id, gbaWindow);
  gbaWindow.on('closed', () => gbaWindows.delete(game.id));
  await gbaWindow.loadFile(path.join(__dirname, '..', 'renderer', 'gba.html'));
  return gbaWindow;
}

function replyError(error) {
  console.error(error);
  return { ok: false, error: error.message || 'Não foi possível concluir a ação.' };
}

function registerIpc() {
  ipcMain.handle('app:state', async () => ({
    ok: true,
    games: library.list(),
    emulators: emulatorStatus(),
    version: app.getVersion()
  }));

  ipcMain.handle('library:choose-files', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Adicionar jogos',
        buttonLabel: 'Adicionar à biblioteca',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Jogos compatíveis', extensions: ['gb', 'gbc', 'gba', 'nds'] },
          { name: 'Game Boy e Game Boy Advance', extensions: ['gb', 'gbc', 'gba'] },
          { name: 'Nintendo DS', extensions: ['nds'] }
        ]
      });
      if (result.canceled) return { ok: true, canceled: true, games: library.list() };
      return { ok: true, ...(await library.importPaths(result.filePaths)) };
    } catch (error) {
      return replyError(error);
    }
  });

  ipcMain.handle('library:choose-folder', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Importar uma pasta de jogos',
        buttonLabel: 'Examinar pasta',
        properties: ['openDirectory']
      });
      if (result.canceled) return { ok: true, canceled: true, games: library.list() };
      const files = await scanDirectory(result.filePaths[0]);
      return { ok: true, scanned: files.length, ...(await library.importPaths(files)) };
    } catch (error) {
      return replyError(error);
    }
  });

  ipcMain.handle('library:import-paths', async (_event, paths) => {
    try {
      if (!Array.isArray(paths)) throw new Error('Nenhum arquivo válido foi recebido.');
      const safePaths = paths.filter((item) => typeof item === 'string' && isSupported(item));
      return { ok: true, ...(await library.importPaths(safePaths)) };
    } catch (error) {
      return replyError(error);
    }
  });

  ipcMain.handle('library:toggle-favorite', async (_event, id) => {
    try {
      return { ok: true, games: await library.toggleFavorite(id) };
    } catch (error) {
      return replyError(error);
    }
  });

  ipcMain.handle('library:remove', async (_event, id) => {
    try {
      return { ok: true, games: await library.remove(id) };
    } catch (error) {
      return replyError(error);
    }
  });

  ipcMain.handle('library:reveal', async (_event, id) => {
    try {
      const game = library.get(id);
      if (!game) throw new Error('Jogo não encontrado na biblioteca.');
      shell.showItemInFolder(game.path);
      return { ok: true };
    } catch (error) {
      return replyError(error);
    }
  });

  ipcMain.handle('game:launch', async (_event, id) => {
    try {
      const game = library.get(id);
      if (!game) throw new Error('Jogo não encontrado na biblioteca.');
      if (!fs.existsSync(game.path)) throw new Error('A ROM foi movida ou removida. Importe o arquivo novamente.');
      if (game.engine === 'mgba' && game.system === 'gba') await openGbaWindow(game);
      else if (game.engine === 'mgba') throw new Error('O núcleo próprio para Game Boy e Game Boy Color ainda está em desenvolvimento.');
      else launchExecutable(emulatorPath(game.engine), [game.path]);
      const games = await library.markPlayed(id);
      return { ok: true, games };
    } catch (error) {
      return replyError(error);
    }
  });

  ipcMain.handle('emulator:open', async (_event, engine) => {
    try {
      if (engine === 'mgba') return { ok: true, own: true };
      launchExecutable(emulatorPath(engine));
      return { ok: true };
    } catch (error) {
      return replyError(error);
    }
  });

  ipcMain.handle('game:rom', async (event) => {
    try {
      const game = [...gbaWindows.entries()].find(([, win]) => win.webContents.id === event.sender.id)?.[0];
      const entry = game ? library.get(game) : null;
      if (!entry || !fs.existsSync(entry.path)) throw new Error('ROM não encontrada.');
      const savePath = `${entry.path}.sav`;
      let save = null;
      try { save = await require('node:fs/promises').readFile(savePath); } catch {}
      return { rom: await require('node:fs/promises').readFile(entry.path), save };
    } catch (error) {
      console.error(error);
      return null;
    }
  });

  ipcMain.handle('game:save', async (event, bytes) => {
    try {
      const game = [...gbaWindows.entries()].find(([, win]) => win.webContents.id === event.sender.id)?.[0];
      const entry = game ? library.get(game) : null;
      if (!entry || !bytes) return { ok: false };
      await require('node:fs/promises').writeFile(`${entry.path}.sav`, Buffer.from(bytes));
      return { ok: true };
    } catch (error) { return replyError(error); }
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId('br.com.tntfitness.duopocket');
  Menu.setApplicationMenu(null);
  library = new LibraryStore(path.join(app.getPath('userData'), 'library.json'));
  await library.load();
  registerIpc();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
