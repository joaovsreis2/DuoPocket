'use strict';

const { GbaMemory } = require('./memory');
const { Arm7tdmi } = require('./cpu');
const { GbaPpu } = require('./ppu');

class DuoGba {
  constructor(rom, save) { this.memory = new GbaMemory(rom, save); this.cpu = new Arm7tdmi(this.memory); this.ppu = new GbaPpu(this.memory); this.clockScale = 16; this.cpu.clockScale = this.clockScale; this.frameCycles = Math.ceil(280896 / this.clockScale); this.paused = false; }
  reset() { this.cpu.reset(); this.paused = false; }
  runFrame() { if (this.paused) return this.ppu.frame; const target = this.cpu.cycles + this.frameCycles; while (this.cpu.cycles < target) this.cpu.step(); return this.ppu.render(); }
  setButton(button, down) { const bit = { a: 0, b: 1, select: 2, start: 3, right: 4, left: 5, up: 6, down: 7, r: 8, l: 9 }[button]; if (bit === undefined) return; const mask = this.memory.read16(0x04000130); this.memory.setButtons(down ? (mask & ~(1 << bit)) : (mask | (1 << bit))); }
  getSave() { return this.memory.getSave(); }
}

module.exports = { DuoGba };
