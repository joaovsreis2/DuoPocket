'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LibraryStore, readRomMetadata, scanDirectory } = require('../src/main/library');

async function tempWorkspace(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'duopocket-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function romFile(directory, name, title, offset, size = 1024) {
  const target = path.join(directory, name);
  const buffer = Buffer.alloc(size);
  buffer.write(title, offset, 'latin1');
  await fs.writeFile(target, buffer);
  return target;
}

test('lê título e sistema de uma ROM de GBA', async (t) => {
  const directory = await tempWorkspace(t);
  const target = await romFile(directory, 'fallback.gba', 'POCKET QUEST', 0xa0);
  const game = await readRomMetadata(target);

  assert.equal(game.title, 'Pocket Quest');
  assert.equal(game.system, 'gba');
  assert.equal(game.engine, 'mgba');
  assert.equal(game.available, undefined);
});

test('lê título e sistema de uma ROM de Nintendo DS', async (t) => {
  const directory = await tempWorkspace(t);
  const target = await romFile(directory, 'fallback.nds', 'TOUCH WORLD', 0x00);
  const game = await readRomMetadata(target);

  assert.equal(game.title, 'Touch World');
  assert.equal(game.system, 'nds');
  assert.equal(game.engine, 'melonds');
});

test('varre subpastas e ignora arquivos não suportados', async (t) => {
  const directory = await tempWorkspace(t);
  const nested = path.join(directory, 'colecao');
  await fs.mkdir(nested);
  await romFile(directory, 'one.gb', 'ONE', 0x134);
  await romFile(nested, 'two.nds', 'TWO', 0x00);
  await fs.writeFile(path.join(directory, 'notes.txt'), 'não é jogo');

  const matches = await scanDirectory(directory);
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((item) => path.extname(item)).sort(), ['.gb', '.nds']);
});

test('persiste favoritos, sessões e remoção sem apagar a ROM', async (t) => {
  const directory = await tempWorkspace(t);
  const rom = await romFile(directory, 'library.gbc', 'COLOR TALE', 0x134);
  const storePath = path.join(directory, 'data', 'library.json');
  const store = new LibraryStore(storePath);
  await store.load();

  const result = await store.importPaths([rom]);
  assert.equal(result.imported.length, 1);
  const id = result.imported[0].id;

  await store.toggleFavorite(id);
  await store.markPlayed(id);
  assert.equal(store.get(id).favorite, true);
  assert.equal(store.get(id).playCount, 1);

  const reloaded = new LibraryStore(storePath);
  await reloaded.load();
  assert.equal(reloaded.get(id).playCount, 1);
  await reloaded.remove(id);
  assert.equal(reloaded.list().length, 0);
  assert.equal(await fs.readFile(rom).then(() => true), true);
});
