'use strict';

const { GbaMemory } = require('./memory');
const { Arm7tdmi } = require('./cpu');
const { GbaPpu } = require('./ppu');

class DuoGba {
  constructor(rom, save) { this.memory = new GbaMemory(rom, save); this.cpu = new Arm7tdmi(this.memory); this.cpu.clockScale = 4; this.ppu = new GbaPpu(this.memory); this.frameCycles = 280896; this.pressedButtons = 0; this.paused = false; }
  reset() { this.cpu.reset(); this.paused = false; }
  runFrame(render = true) {
    if (this.paused) return this.ppu.frame;
    // O interpretador conta o custo-base das instruções; o barramento real do
    // GBA acrescenta esperas de ROM/VRAM. Três clocks de hardware por ciclo-base
    // mantém o orçamento de CPU compatível com jogos comerciais e evita executar
    // loops ociosos muito além do VBlank seguinte.
    const target = this.cpu.cycles + Math.ceil(this.frameCycles / this.cpu.clockScale);
    while (this.cpu.cycles < target) {
      const registers = Array.from(this.cpu.r.subarray(0, 15)); const pcs = new Set();
      for (let step = 0; step < 256 && this.cpu.cycles < target; step++) { pcs.add(this.cpu.r[15] >>> 0); this.cpu.step(); }
      const idle = pcs.size <= 8 && !this.memory.pendingInterrupt() && registers.every((value, index) => value === this.cpu.r[index]);
      if (idle && this.cpu.cycles < target) { const remaining = target - this.cpu.cycles; const advance = Math.min(remaining, Math.ceil((1232 - this.memory.scanlineCycles) / this.cpu.clockScale)); this.cpu.cycles += advance; this.memory.tick(advance * this.cpu.clockScale); }
    }
    return render ? this.ppu.render() : this.ppu.frame;
  }
  setButton(button, down) { const bit = { a: 0, b: 1, select: 2, start: 3, right: 4, left: 5, up: 6, down: 7, r: 8, l: 9 }[button]; if (bit === undefined) return; if (down) this.pressedButtons |= 1 << bit; else this.pressedButtons &= ~(1 << bit); this.memory.setButtons(this.pressedButtons); }
  getSave() { return this.memory.getSave(); }
  saveState() { return { cpu: { r: Uint32Array.from(this.cpu.r), cpsr: this.cpu.cpsr, cycles: this.cpu.cycles, irqContext: this.cpu.irqContext ? { registers: Uint32Array.from(this.cpu.irqContext.registers), cpsr: this.cpu.irqContext.cpsr } : null }, memory: { ewram: Uint8Array.from(this.memory.ewram), iwram: Uint8Array.from(this.memory.iwram), io: Uint8Array.from(this.memory.io), palette: Uint8Array.from(this.memory.palette), vram: Uint8Array.from(this.memory.vram), oam: Uint8Array.from(this.memory.oam), sram: Uint8Array.from(this.memory.sram), scanlineCycles: this.memory.scanlineCycles, scanline: this.memory.scanline, timerRemainder: [...this.memory.timerRemainder], timerReload: [...this.memory.timerReload], flashBank: this.memory.flashBank, flashState: this.memory.flashState, flashIdMode: this.memory.flashIdMode }, pressedButtons: this.pressedButtons }; }
  loadState(state) { const cpu = state.cpu; const memory = state.memory; this.cpu.r.set(cpu.r); this.cpu.cpsr = cpu.cpsr; this.cpu.cycles = cpu.cycles; this.cpu.irqContext = cpu.irqContext ? { registers: Uint32Array.from(cpu.irqContext.registers), cpsr: cpu.irqContext.cpsr } : null; for (const name of ['ewram', 'iwram', 'io', 'palette', 'vram', 'oam', 'sram']) this.memory[name].set(memory[name]); this.memory.scanlineCycles = memory.scanlineCycles; this.memory.scanline = memory.scanline; this.memory.timerRemainder = [...memory.timerRemainder]; this.memory.timerReload = [...memory.timerReload]; this.memory.flashBank = memory.flashBank; this.memory.flashState = memory.flashState; this.memory.flashIdMode = memory.flashIdMode; this.pressedButtons = state.pressedButtons || 0; return this; }
}

module.exports = { DuoGba };
