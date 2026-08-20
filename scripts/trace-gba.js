'use strict';

const fs = require('node:fs');
const { GbaMemory } = require('../src/emulator/gba/memory');
const { Arm7tdmi } = require('../src/emulator/gba/cpu');
const { GbaPpu } = require('../src/emulator/gba/ppu');

const romPath = process.argv[2];
if (!romPath) throw new Error('Informe o caminho da ROM.');
const memory = new GbaMemory(fs.readFileSync(romPath));
const cpu = new Arm7tdmi(memory);
const traceCount = Number(process.argv[3] || 0);
const maxSteps = traceCount || Number(process.env.DUO_TRACE_STEPS || 2_000_000);
const visits = new Map();
let ioWrites = 0; let vramWrites = 0; let lastPc = cpu.r[15];
const recent = []; let invalidJump = null;
const watchedWrites = [];
const r5Changes = []; let previousR5 = cpu.r[5];
const handlerWrites = [];
const originalWrite8 = memory.write8.bind(memory);
memory.write8 = (address, value) => {
  const a = address >>> 0;
  if (a >= 0x03007e24 && a <= 0x03007e27) { watchedWrites.push({ pc: `0x${lastPc.toString(16)}`, address: `0x${a.toString(16)}`, value: value & 0xff, sp: `0x${cpu.r[13].toString(16)}` }); if (watchedWrites.length > 40) watchedWrites.shift(); }
  if ((a >= 0x03003580 && a < 0x03003700) || (a >= 0x03007ffc && a < 0x03008000) || (a >= 0x0300310c && a < 0x03003110)) { handlerWrites.push({ pc: `0x${lastPc.toString(16)}`, address: `0x${a.toString(16)}`, value: value & 0xff }); if (handlerWrites.length > 160) handlerWrites.shift(); }
  if (a >= 0x04000000 && a < 0x04000400) ioWrites++;
  if (a >= 0x06000000 && a < 0x06018000) vramWrites++;
  originalWrite8(address, value);
};

for (let index = 0; index < maxSteps; index++) {
  lastPc = cpu.r[15] >>> 0;
  const currentOpcode = cpu.thumb ? memory.read16(lastPc) : memory.read32(lastPc);
  const validPc = (lastPc >= 0x08000000 && lastPc < 0x0e000000) || (lastPc >= 0x02000000 && lastPc < 0x03008000) || (cpu.irqContext && lastPc === cpu.irqReturn);
  const emptyRamExecution = currentOpcode === 0 && lastPc >= 0x02000000 && lastPc < 0x03008000;
  if ((!validPc || emptyRamExecution) && index > 0) { invalidJump = { index, pc: `0x${lastPc.toString(16).padStart(8, '0')}`, emptyRamExecution, recent }; break; }
  recent.push({ pc: `0x${lastPc.toString(16).padStart(8, '0')}`, op: `0x${(cpu.thumb ? memory.read16(lastPc) : memory.read32(lastPc)).toString(16)}`, thumb: cpu.thumb, lr: `0x${cpu.r[14].toString(16)}`, sp: `0x${cpu.r[13].toString(16)}`, r0: `0x${cpu.r[0].toString(16)}`, r1: `0x${cpu.r[1].toString(16)}`, r2: `0x${cpu.r[2].toString(16)}`, r3: `0x${cpu.r[3].toString(16)}`, r4: `0x${cpu.r[4].toString(16)}`, r5: `0x${cpu.r[5].toString(16)}`, r6: `0x${cpu.r[6].toString(16)}`, r7: `0x${cpu.r[7].toString(16)}` }); if (recent.length > 24) recent.shift();
  if (traceCount) console.log(`${index.toString().padStart(4)} ${cpu.thumb ? 'T' : 'A'} 0x${lastPc.toString(16).padStart(8, '0')} 0x${(cpu.thumb ? memory.read16(lastPc) : memory.read32(lastPc)).toString(16).padStart(cpu.thumb ? 4 : 8, '0')}`);
  visits.set(lastPc, (visits.get(lastPc) || 0) + 1);
  cpu.step();
  if (cpu.r[5] !== previousR5) { r5Changes.push({ pc: `0x${lastPc.toString(16)}`, op: `0x${currentOpcode.toString(16)}`, from: `0x${previousR5.toString(16)}`, to: `0x${cpu.r[5].toString(16)}` }); if (r5Changes.length > 60) r5Changes.shift(); previousR5 = cpu.r[5]; }
  if (!Number.isFinite(cpu.cycles)) throw new Error(`Ciclos inválidos em ${lastPc.toString(16)}`);
}

const hottest = [...visits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([pc, count]) => ({ pc: `0x${pc.toString(16).padStart(8, '0')}`, count }));
const nonZeroVram = memory.vram.reduce((count, value) => count + (value !== 0), 0);
const frame = new GbaPpu(memory).render(); const frameColors = new Set(frame); const nonBackdropPixels = frame.reduce((count, color) => count + (color !== frame[0]), 0);
const paletteNonZero = memory.palette.reduce((count, value) => count + (value !== 0), 0); const bg0cnt = memory.read16(0x04000008); const charBase = ((bg0cnt >>> 2) & 3) * 0x4000; const mapBase = ((bg0cnt >>> 8) & 31) * 0x800; const mapNonZero = memory.vram.slice(mapBase, mapBase + 0x800).reduce((count, value) => count + (value !== 0), 0); const tileNonZero = memory.vram.slice(charBase, charBase + 0x4000).reduce((count, value) => count + (value !== 0), 0);
hottest.unshift({ diagnostic3: { bg3Map: Array.from({ length: 16 }, (_, index) => memory.read16(0x0600f800 + index * 2)), bg3Tiles: Array.from(memory.vram.slice(0xc000, 0xc080)) } });
hottest.unshift({ diagnostic: { charBase, mapBase, tileNonZero, bgControls: Array.from({ length: 4 }, (_, index) => memory.read16(0x04000008 + index * 2)), tileBytes: Array.from(memory.vram.slice(charBase + 32, charBase + 64)), mapWords: Array.from({ length: 16 }, (_, index) => memory.read16(0x06000000 + mapBase + index * 2)), paletteWords: Array.from({ length: 16 }, (_, index) => memory.read16(0x05000000 + index * 2)) } });
console.log(JSON.stringify({ lastPc: `0x${lastPc.toString(16).padStart(8, '0')}`, thumb: cpu.thumb, cycles: cpu.cycles, registers: Array.from(cpu.r, value => `0x${value.toString(16)}`), dispcnt: `0x${memory.read16(0x04000000).toString(16)}`, bg0cnt: `0x${memory.read16(0x04000008).toString(16)}`, irq: { dispstat: memory.read16(0x04000004), ie: memory.read16(0x04000200), if: memory.read16(0x04000202), ime: memory.read16(0x04000208), handler: `0x${memory.read32(0x03007ffc).toString(16)}`, handlerBytes: Array.from({ length: 32 }, (_, index) => memory.read8(0x03003580 + index)), handlerWrites }, ioWrites, vramWrites, nonZeroVram, mapNonZero, paletteNonZero, frameColors: frameColors.size, nonBackdropPixels, watchedWrites, r5Changes, invalidJump, hottest }, null, 2));
