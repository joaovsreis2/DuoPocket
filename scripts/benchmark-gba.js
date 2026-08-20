'use strict';

const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const { DuoGba } = require('../src/emulator/gba/gba');

const file = process.argv[2];
const frames = Number(process.env.DUO_BENCH_FRAMES || 300);
if (!file) throw new Error('Informe a ROM local para o benchmark.');
const emulator = new DuoGba(fs.readFileSync(file));
function writeBmp(fileName, frame) { const pixels = Buffer.from(frame.buffer); const header = Buffer.alloc(54); header.write('BM'); header.writeUInt32LE(54 + pixels.length, 2); header.writeUInt32LE(54, 10); header.writeUInt32LE(40, 14); header.writeInt32LE(240, 18); header.writeInt32LE(-160, 22); header.writeUInt16LE(1, 26); header.writeUInt16LE(32, 28); header.writeUInt32LE(pixels.length, 34); fs.writeFileSync(fileName, Buffer.concat([header, pixels])); }
const started = performance.now();
const samples = [];
for (let frame = 0; frame < frames; frame++) {
  if (process.env.DUO_BENCH_PRESS_START && frame === 300) emulator.setButton('start', true);
  if (process.env.DUO_BENCH_PRESS_START && frame === 302) emulator.setButton('start', false);
  const image = emulator.runFrame();
  if ((frame + 1) % 300 === 0) samples.push({ frame: frame + 1, pc: `0x${emulator.cpu.r[15].toString(16)}`, thumb: emulator.cpu.thumb, dispcnt: `0x${emulator.memory.read16(0x04000000).toString(16)}`, colors: new Set(image).size });
}
const elapsed = performance.now() - started;
const pc = emulator.cpu.r[15] >>> 0;
samples.push({ ppuIo: Array.from({ length: 44 }, (_, index) => emulator.memory.read16(0x04000000 + index * 2)) });
if (process.env.DUO_BENCH_BMP) { writeBmp(process.env.DUO_BENCH_BMP, emulator.ppu.frame); if (process.env.DUO_BENCH_LAYERS) { const original = emulator.memory.read16(0x04000000); for (let layer = 0; layer < 5; layer++) { emulator.memory.write16(0x04000000, (original & 0x00ff) | (layer < 4 ? 0x0100 << layer : 0x1000)); writeBmp(process.env.DUO_BENCH_BMP.replace('.bmp', `-${layer}.bmp`), emulator.ppu.render()); } emulator.memory.write16(0x04000000, original); } }
process.stdout.write(JSON.stringify({ frames, elapsedMs: Math.round(elapsed), fps: Number((frames * 1000 / elapsed).toFixed(2)), pc: `0x${pc.toString(16)}`, thumb: emulator.cpu.thumb, instructionBytes: Array.from({ length: 16 }, (_, index) => emulator.memory.read8(pc + index)), registers: Array.from(emulator.cpu.r, value => `0x${value.toString(16)}`), samples }));
