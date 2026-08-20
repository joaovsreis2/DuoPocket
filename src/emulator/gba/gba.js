'use strict';

const { GbaMemory } = require('./memory');
const { Arm7tdmi } = require('./cpu');
const { GbaPpu } = require('./ppu');

class DuoGba {
  constructor(rom, save) { this.memory = new GbaMemory(rom, save); this.cpu = new Arm7tdmi(this.memory); this.ppu = new GbaPpu(this.memory); this.frameCycles = 280896; this.pressedButtons = 0; this.paused = false; }
  reset() { this.cpu.reset(); this.paused = false; }
  runFrame() {
    if (this.paused) return this.ppu.frame;
    const target = this.cpu.cycles + this.frameCycles;
    while (this.cpu.cycles < target) {
      const registers = Array.from(this.cpu.r.subarray(0, 15)); const pcs = new Set();
      for (let step = 0; step < 256 && this.cpu.cycles < target; step++) { pcs.add(this.cpu.r[15] >>> 0); this.cpu.step(); }
      const idle = pcs.size <= 8 && !this.memory.pendingInterrupt() && registers.every((value, index) => value === this.cpu.r[index]);
      if (idle && this.cpu.cycles < target) { const remaining = target - this.cpu.cycles; const advance = Math.min(remaining, 1232 - this.memory.scanlineCycles); this.cpu.cycles += advance; this.memory.tick(advance); }
    }
    return this.ppu.render();
  }
  setButton(button, down) { const bit = { a: 0, b: 1, select: 2, start: 3, right: 4, left: 5, up: 6, down: 7, r: 8, l: 9 }[button]; if (bit === undefined) return; if (down) this.pressedButtons |= 1 << bit; else this.pressedButtons &= ~(1 << bit); this.memory.setButtons(this.pressedButtons); }
  getSave() { return this.memory.getSave(); }
}

module.exports = { DuoGba };
