'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const SYSTEMS = Object.freeze({
  '.gb': { id: 'gb', name: 'Game Boy', engine: 'mgba', titleOffset: 0x134, titleLength: 15 },
  '.gbc': { id: 'gbc', name: 'Game Boy Color', engine: 'mgba', titleOffset: 0x134, titleLength: 15 },
  '.gba': { id: 'gba', name: 'Game Boy Advance', engine: 'mgba', titleOffset: 0xa0, titleLength: 12 },
  '.nds': { id: 'nds', name: 'Nintendo DS', engine: 'melonds', titleOffset: 0x00, titleLength: 12 }
});

const COVER_PALETTES = [
  ['#3452D1', '#AFC2FF'],
  ['#FA685B', '#FFC4B8'],
  ['#1D7A72', '#A8DED3'],
  ['#8052A8', '#D9BDEA'],
  ['#B57221', '#F2D39D'],
  ['#27324C', '#B8C4DB']
];

function supportedExtensions() {
  return Object.keys(SYSTEMS);
}

function isSupported(filePath) {
  return Boolean(SYSTEMS[path.extname(filePath).toLowerCase()]);
}

function cleanHeaderTitle(buffer) {
  return buffer
    .toString('latin1')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
}

function titleFromFilename(filePath) {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayTitle(title) {
  if (!title || title !== title.toUpperCase()) return title;
  const keepUpper = new Set(['DS', 'GB', 'GBC', 'GBA', 'RPG', 'II', 'III', 'IV', 'V', 'VI']);
  return title
    .toLowerCase()
    .split(/(\s+)/)
    .map((word) => {
      const upper = word.toUpperCase();
      if (keepUpper.has(upper)) return upper;
      return /^[a-zà-ÿ]/i.test(word) ? word[0].toUpperCase() + word.slice(1) : word;
    })
    .join('');
}

function gameId(filePath) {
  return crypto
    .createHash('sha1')
    .update(path.resolve(filePath).toLocaleLowerCase('en-US'))
    .digest('hex');
}

function paletteFor(id) {
  const index = Number.parseInt(id.slice(0, 6), 16) % COVER_PALETTES.length;
  return COVER_PALETTES[index];
}

async function readRomMetadata(filePath) {
  const resolved = path.resolve(filePath);
  const extension = path.extname(resolved).toLowerCase();
  const system = SYSTEMS[extension];
  if (!system) throw new Error(`Formato não suportado: ${extension || 'sem extensão'}`);

  const stat = await fsp.stat(resolved);
  if (!stat.isFile()) throw new Error('O caminho selecionado não é um arquivo.');

  const handle = await fsp.open(resolved, 'r');
  let title = '';
  try {
    const header = Buffer.alloc(system.titleLength);
    await handle.read(header, 0, system.titleLength, system.titleOffset);
    title = cleanHeaderTitle(header);
  } finally {
    await handle.close();
  }

  const id = gameId(resolved);
  return {
    id,
    title: displayTitle(title || titleFromFilename(resolved)),
    fileName: path.basename(resolved),
    path: resolved,
    extension,
    system: system.id,
    systemName: system.name,
    engine: system.engine,
    size: stat.size,
    palette: paletteFor(id)
  };
}

async function scanDirectory(directory, limit = 20000) {
  const matches = [];

  async function walk(current) {
    if (matches.length >= limit) return;
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (matches.length >= limit) return;
      if (entry.name.startsWith('.')) continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && isSupported(target)) matches.push(target);
    }
  }

  await walk(path.resolve(directory));
  return matches;
}

class LibraryStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version: 1, games: [] };
  }

  async load() {
    try {
      const raw = await fsp.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.games)) this.data = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Biblioteca ignorada por estar inválida:', error.message);
    }
    return this.list();
  }

  list() {
    return this.data.games.map((game) => ({ ...game, available: fs.existsSync(game.path) }));
  }

  get(id) {
    return this.data.games.find((game) => game.id === id) || null;
  }

  async importPaths(paths) {
    const imported = [];
    const rejected = [];

    for (const filePath of [...new Set(paths)]) {
      try {
        const metadata = await readRomMetadata(filePath);
        const existingIndex = this.data.games.findIndex((game) => game.id === metadata.id);
        if (existingIndex >= 0) {
          this.data.games[existingIndex] = { ...this.data.games[existingIndex], ...metadata };
          imported.push(this.data.games[existingIndex]);
          continue;
        }
        const game = {
          ...metadata,
          favorite: false,
          importedAt: new Date().toISOString(),
          lastPlayed: null,
          playCount: 0
        };
        this.data.games.push(game);
        imported.push(game);
      } catch (error) {
        rejected.push({ path: filePath, reason: error.message });
      }
    }

    if (imported.length) await this.save();
    return { imported, rejected, games: this.list() };
  }

  async toggleFavorite(id) {
    const game = this.get(id);
    if (!game) throw new Error('Jogo não encontrado na biblioteca.');
    game.favorite = !game.favorite;
    await this.save();
    return this.list();
  }

  async remove(id) {
    const before = this.data.games.length;
    this.data.games = this.data.games.filter((game) => game.id !== id);
    if (this.data.games.length === before) throw new Error('Jogo não encontrado na biblioteca.');
    await this.save();
    return this.list();
  }

  async markPlayed(id) {
    const game = this.get(id);
    if (!game) throw new Error('Jogo não encontrado na biblioteca.');
    game.lastPlayed = new Date().toISOString();
    game.playCount = (game.playCount || 0) + 1;
    await this.save();
    return this.list();
  }

  async save() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    await fsp.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }
}

module.exports = {
  LibraryStore,
  SYSTEMS,
  displayTitle,
  isSupported,
  readRomMetadata,
  scanDirectory,
  supportedExtensions
};
