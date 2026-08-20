'use strict';

const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const v8 = require('node:v8');
const { DuoGba } = require('../src/emulator/gba/gba');

const file = process.argv[2];
const frames = Number(process.env.DUO_BENCH_FRAMES || 300);
if (!file) throw new Error('Informe a ROM local para o benchmark.');
const envList = (name) => { const parsed = JSON.parse(process.env[name] || '[]'); return Array.isArray(parsed) ? parsed : [parsed]; };
const emulator = new DuoGba(fs.readFileSync(file));
if (process.env.DUO_STATE_IN) emulator.loadState(v8.deserialize(fs.readFileSync(process.env.DUO_STATE_IN)));
const trace = process.env.DUO_TRACE ? { swi: {}, dma: [], writes: {} } : null;
if (trace) {
  const originalSwi = emulator.cpu.handleSwi.bind(emulator.cpu);
  emulator.cpu.handleSwi = (code) => {
    const key = `0x${code.toString(16).padStart(2, '0')}`;
    const item = trace.swi[key] || { count: 0, calls: [] };
    item.count++;
    if (item.calls.length < 16) item.calls.push({ pc: `0x${emulator.cpu.r[15].toString(16)}`, r: Array.from(emulator.cpu.r.slice(0, 4), value => `0x${value.toString(16)}`) });
    trace.swi[key] = item;
    return originalSwi(code);
  };
  const originalDma = emulator.memory.performDma.bind(emulator.memory);
  emulator.memory.performDma = (channel, trigger = 0) => {
    const base = 0x040000b0 + channel * 12;
    const control = emulator.memory.read16(base + 10);
    if ((control & 0x8000) && ((control >>> 12) & 3) === trigger && trace.dma.length < 64) trace.dma.push({ channel, trigger, source: `0x${emulator.memory.read32(base).toString(16)}`, destination: `0x${emulator.memory.read32(base + 4).toString(16)}`, count: emulator.memory.read16(base + 8), control: `0x${control.toString(16)}`, pc: `0x${emulator.cpu.r[15].toString(16)}` });
    return originalDma(channel, trigger);
  };
  for (const width of [8, 16, 32]) {
    const name = `write${width}`; const original = emulator.memory[name].bind(emulator.memory);
    emulator.memory[name] = (address, value) => {
      const a = address >>> 0; let region = null;
      if (a >= 0x04000020 && a < 0x04000040) region = 'affineIo';
      else if (a >= 0x05000000 && a < 0x05000400) region = 'palette';
      else if (a >= 0x06000000 && a < 0x06018000) region = 'vram';
      else if (a >= 0x07000000 && a < 0x07000400) region = 'oam';
      if (region) {
        const item = trace.writes[region] || { count: 0, calls: [] }; item.count++;
        if (item.calls.length < 32) item.calls.push({ width, address: `0x${a.toString(16)}`, value: `0x${(value >>> 0).toString(16)}`, pc: `0x${emulator.cpu.r[15].toString(16)}` }); trace.writes[region] = item;
      }
      return original(address, value);
    };
  }
}
const scriptedEvents = new Map(); for (const item of envList('DUO_BENCH_EVENTS')) { const list = scriptedEvents.get(item.frame) || []; list.push(item); scriptedEvents.set(item.frame, list); }
function writeBmp(fileName, frame) { const pixels = Buffer.alloc(frame.length * 4); for (let index = 0; index < frame.length; index++) { const color = frame[index] >>> 0; pixels[index * 4] = (color >>> 16) & 255; pixels[index * 4 + 1] = (color >>> 8) & 255; pixels[index * 4 + 2] = color & 255; pixels[index * 4 + 3] = 255; } const header = Buffer.alloc(54); header.write('BM'); header.writeUInt32LE(54 + pixels.length, 2); header.writeUInt32LE(54, 10); header.writeUInt32LE(40, 14); header.writeInt32LE(240, 18); header.writeInt32LE(-160, 22); header.writeUInt16LE(1, 26); header.writeUInt16LE(32, 28); header.writeUInt32LE(pixels.length, 34); fs.writeFileSync(fileName, Buffer.concat([header, pixels])); }
const started = performance.now();
const samples = [];
for (let frame = 0; frame < frames; frame++) {
  for (const event of scriptedEvents.get(frame) || []) emulator.setButton(event.key, event.down);
  if (process.env.DUO_BENCH_PRESS_START && frame === 300) emulator.setButton('start', true);
  if (process.env.DUO_BENCH_PRESS_START && frame === 302) emulator.setButton('start', false);
  if (process.env.DUO_BENCH_FULL_FLOW && frame === 700) emulator.setButton('start', true);
  if (process.env.DUO_BENCH_FULL_FLOW && frame === 702) emulator.setButton('start', false);
  if (process.env.DUO_BENCH_FULL_FLOW && frame === 900) emulator.setButton('a', true);
  if (process.env.DUO_BENCH_FULL_FLOW && frame === 902) emulator.setButton('a', false);
  if (process.env.DUO_BENCH_FULL_FLOW && frame === 1100) emulator.setButton('a', true);
  if (process.env.DUO_BENCH_FULL_FLOW && frame === 1102) emulator.setButton('a', false);
  if (process.env.DUO_BENCH_FULL_FLOW && frame === 1400) emulator.setButton('b', true);
  if (process.env.DUO_BENCH_FULL_FLOW && frame === 1402) emulator.setButton('b', false);
  if (process.env.DUO_BENCH_FULL_FLOW && frame === 1700) emulator.setButton('b', true);
  if (process.env.DUO_BENCH_FULL_FLOW && frame === 1702) emulator.setButton('b', false);
  if (process.env.DUO_BENCH_FULL_FLOW && frame === 2000) emulator.setButton('b', true);
  if (process.env.DUO_BENCH_FULL_FLOW && frame === 2002) emulator.setButton('b', false);
  const image = emulator.runFrame(Boolean(process.env.DUO_RENDER_EVERY_FRAME) || (frame + 1) % 300 === 0 || frame === frames - 1);
  if ((frame + 1) % 300 === 0) samples.push({ frame: frame + 1, pc: `0x${emulator.cpu.r[15].toString(16)}`, thumb: emulator.cpu.thumb, dispcnt: `0x${emulator.memory.read16(0x04000000).toString(16)}`, colors: new Set(image).size });
}
if (process.env.DUO_PATCH) {
  for (const item of envList('DUO_PATCH')) emulator.memory[`write${item.width || 16}`](item.address >>> 0, item.value >>> 0);
  emulator.ppu.render();
}
const elapsed = performance.now() - started;
const pc = emulator.cpu.r[15] >>> 0;
if (process.env.DUO_STATE_OUT) fs.writeFileSync(process.env.DUO_STATE_OUT, v8.serialize(emulator.saveState()));
samples.push({ oamActive: Array.from({ length: 128 }, (_, index) => ({ index, a0: emulator.memory.read16(0x07000000 + index * 8), a1: emulator.memory.read16(0x07000002 + index * 8), a2: emulator.memory.read16(0x07000004 + index * 8) })).filter(item => (item.a0 & 0x0300) !== 0x0200).slice(0, 32) });
samples.push({ ppuIo: Array.from({ length: 44 }, (_, index) => emulator.memory.read16(0x04000000 + index * 2)), heap: [0x02000000, 0x02020000, 0x02020004, 0x02020008, 0x0202000c].map(address => `0x${emulator.memory.read32(address).toString(16)}`) });
if (process.env.DUO_DUMP) samples.push({ memory: envList('DUO_DUMP').map(item => ({ address: `0x${(item.address >>> 0).toString(16)}`, bytes: Array.from({ length: item.length }, (_, index) => emulator.memory.read8((item.address >>> 0) + index)) })) });
if (process.env.DUO_STATS) samples.push({ memoryStats: envList('DUO_STATS').map(item => { const bytes = Array.from({ length: item.length }, (_, index) => emulator.memory.read8((item.address >>> 0) + index)); return { address: `0x${(item.address >>> 0).toString(16)}`, length: item.length, nonzero: bytes.reduce((count, value) => count + Boolean(value), 0), firstNonzero: bytes.findIndex(Boolean), lastNonzero: bytes.findLastIndex(Boolean), checksum: bytes.reduce((sum, value) => (sum + value) >>> 0, 0) }; }) });
if (process.env.DUO_BENCH_BMP) { writeBmp(process.env.DUO_BENCH_BMP, emulator.ppu.frame); if (process.env.DUO_BENCH_LAYERS) { const original = emulator.memory.read16(0x04000000); for (let layer = 0; layer < 5; layer++) { emulator.memory.write16(0x04000000, (original & 0x00ff) | (layer < 4 ? 0x0100 << layer : 0x1000)); writeBmp(process.env.DUO_BENCH_BMP.replace('.bmp', `-${layer}.bmp`), emulator.ppu.render()); } emulator.memory.write16(0x04000000, original); } }
process.stdout.write(JSON.stringify({ frames, elapsedMs: Math.round(elapsed), fps: Number((frames * 1000 / elapsed).toFixed(2)), pc: `0x${pc.toString(16)}`, thumb: emulator.cpu.thumb, instructionBytes: Array.from({ length: 16 }, (_, index) => emulator.memory.read8(pc + index)), registers: Array.from(emulator.cpu.r, value => `0x${value.toString(16)}`), samples, trace }));
