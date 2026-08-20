'use strict';

// Barramento GBA independente. Nenhum núcleo externo é usado aqui.
const REGION = Object.freeze({
  EWRAM: 0x02000000,
  IWRAM: 0x03000000,
  IO: 0x04000000,
  PAL: 0x05000000,
  VRAM: 0x06000000,
  OAM: 0x07000000,
  ROM: 0x08000000
});

function little16(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8)) & 0xffff;
}

class GbaMemory {
  constructor(rom, save) {
    this.rom = Uint8Array.from(rom || []);
    this.ewram = new Uint8Array(0x40000);
    this.iwram = new Uint8Array(0x8000);
    this.io = new Uint8Array(0x400);
    this.palette = new Uint8Array(0x400);
    this.vram = new Uint8Array(0x18000);
    this.oam = new Uint8Array(0x400);
    this.sram = new Uint8Array(0x20000); this.sram.fill(0xff);
    this.flashBank = 0; this.flashState = 0; this.flashIdMode = false;
    if (save) this.sram.set(Uint8Array.from(save).subarray(0, this.sram.length));
    this.scanlineCycles = 0;
    this.scanline = 0;
    this.timerRemainder = [0, 0, 0, 0];
    this.timerReload = [0, 0, 0, 0];
    this.io[0x00] = 0x00; // estado inicial do LCD; a ROM escolhe o modo gráfico
    this.io[0x30] = 0xff; this.io[0x31] = 0x03; // KEYINPUT: botões soltos
  }

  region(address) {
    const a = address >>> 0;
    if (a >= REGION.EWRAM && a < REGION.EWRAM + 0x40000) return [this.ewram, a - REGION.EWRAM];
    if (a >= REGION.IWRAM && a < REGION.IWRAM + 0x8000) return [this.iwram, a - REGION.IWRAM];
    if (a >= REGION.IO && a < REGION.IO + 0x400) return [this.io, a - REGION.IO];
    if (a >= REGION.PAL && a < REGION.PAL + 0x400) return [this.palette, a - REGION.PAL];
    if (a >= REGION.VRAM && a < REGION.VRAM + 0x18000) return [this.vram, a - REGION.VRAM];
    if (a >= REGION.OAM && a < REGION.OAM + 0x400) return [this.oam, a - REGION.OAM];
    if (a >= 0x0e000000 && a < 0x0e010000) return [this.sram, a - 0x0e000000];
    return null;
  }

  read8(address) {
    const a = address >>> 0;
    if (a >= REGION.ROM && a < 0x0e000000 && this.rom.length) return this.rom[(a - REGION.ROM) % this.rom.length];
    if (a >= REGION.EWRAM && a < REGION.EWRAM + 0x40000) return this.ewram[a - REGION.EWRAM];
    if (a >= REGION.IWRAM && a < REGION.IWRAM + 0x8000) return this.iwram[a - REGION.IWRAM];
    if (a >= REGION.IO && a < REGION.IO + 0x400) return this.io[a - REGION.IO];
    if (a >= REGION.PAL && a < REGION.PAL + 0x400) return this.palette[a - REGION.PAL];
    if (a >= REGION.VRAM && a < REGION.VRAM + 0x18000) return this.vram[a - REGION.VRAM];
    if (a >= REGION.OAM && a < REGION.OAM + 0x400) return this.oam[a - REGION.OAM];
    if (a >= 0x0e000000 && a < 0x0e010000) { const offset = a - 0x0e000000; if (this.flashIdMode && offset < 2) return offset ? 0x13 : 0x62; return this.sram[this.flashBank * 0x10000 + offset]; }
    return 0;
  }

  read16(address) {
    const a = address & ~1;
    return this.read8(a) | (this.read8(a + 1) << 8);
  }

  read32(address) {
    const a = address & ~3;
    return (this.read8(a) | (this.read8(a + 1) << 8) | (this.read8(a + 2) << 16) | (this.read8(a + 3) << 24)) >>> 0;
  }

  write8(address, value) {
    const a = address >>> 0;
    const byte = value & 0xff;
    if (a >= 0x0e000000 && a < 0x0e010000) { this.writeFlash(a - 0x0e000000, byte); return; }
    if (a >= REGION.ROM) return;
    if (a >= REGION.EWRAM && a < REGION.EWRAM + 0x40000) this.ewram[a - REGION.EWRAM] = byte;
    else if (a >= REGION.IWRAM && a < REGION.IWRAM + 0x8000) this.iwram[a - REGION.IWRAM] = byte;
    else if (a >= REGION.IO && a < REGION.IO + 0x400) this.io[a - REGION.IO] = byte;
    else if (a >= REGION.PAL && a < REGION.PAL + 0x400) this.palette[a - REGION.PAL] = byte;
    else if (a >= REGION.VRAM && a < REGION.VRAM + 0x18000) this.vram[a - REGION.VRAM] = byte;
    else if (a >= REGION.OAM && a < REGION.OAM + 0x400) this.oam[a - REGION.OAM] = byte;
  }

  writeFlash(offset, value) {
    if (value === 0xf0) { this.flashState = 0; this.flashIdMode = false; return; }
    if (this.flashState === 3) { this.sram[this.flashBank * 0x10000 + offset] &= value; this.flashState = 0; return; }
    if (this.flashState === 4) { if (offset === 0) this.flashBank = value & 1; this.flashState = 0; return; }
    if (this.flashState === 5) { this.flashState = offset === 0x5555 && value === 0xaa ? 6 : 0; return; }
    if (this.flashState === 6) { this.flashState = offset === 0x2aaa && value === 0x55 ? 7 : 0; return; }
    if (this.flashState === 7) {
      if (offset === 0x5555 && value === 0x10) this.sram.fill(0xff);
      else if (value === 0x30) { const start = this.flashBank * 0x10000 + (offset & ~0xfff); this.sram.fill(0xff, start, start + 0x1000); }
      this.flashState = 0; return;
    }
    if (this.flashState === 0) { if (offset === 0x5555 && value === 0xaa) this.flashState = 1; return; }
    if (this.flashState === 1) { this.flashState = offset === 0x2aaa && value === 0x55 ? 2 : 0; return; }
    if (this.flashState === 2) {
      this.flashState = 0;
      if (offset !== 0x5555) return;
      if (value === 0x90) this.flashIdMode = true;
      else if (value === 0xa0) this.flashState = 3;
      else if (value === 0xb0) this.flashState = 4;
      else if (value === 0x80) this.flashState = 5;
    }
  }

  write16(address, value) {
    const a = address & ~1;
    if (a === 0x04000202) { this.writeIo16(a, this.read16(a) & ~(value & 0x3fff)); return; }
    const timerData = a >= 0x04000100 && a <= 0x0400010c && ((a - 0x04000100) % 4) === 0;
    const timerControl = a >= 0x04000102 && a <= 0x0400010e && ((a - 0x04000102) % 4) === 0;
    const oldControl = timerControl ? this.read16(a) : 0;
    this.write8(a, value); this.write8(a + 1, value >>> 8);
    if (timerData) this.timerReload[(a - 0x04000100) >> 2] = value & 0xffff;
    if (timerControl && !(oldControl & 0x80) && (value & 0x80)) { const index = (a - 0x04000102) >> 2; this.writeIo16(a - 2, this.timerReload[index]); this.timerRemainder[index] = 0; }
    if (a >= 0x040000ba && a <= 0x040000dc && ((a - 0x040000b0) % 12) === 10) this.performDma(Math.floor((a - 0x040000b0) / 12));
  }

  write32(address, value) {
    const a = address & ~3;
    this.write8(a, value); this.write8(a + 1, value >>> 8); this.write8(a + 2, value >>> 16); this.write8(a + 3, value >>> 24);
    if (a >= 0x040000b8 && a <= 0x040000dc && ((a - 0x040000b8) % 12) === 0) this.performDma(Math.floor((a - 0x040000b8) / 12));
  }

  tick(cycles) {
    this.scanlineCycles += cycles;
    while (this.scanlineCycles >= 1232) {
      this.scanlineCycles -= 1232;
      this.scanline = (this.scanline + 1) % 228;
      this.io[0x06] = this.scanline;
      const displayStatus = this.read16(0x04000004) & ~3;
      const vblank = this.scanline >= 160;
      const hblank = 0;
      this.writeIo16(0x04000004, displayStatus | (vblank ? 1 : 0) | hblank);
      if (this.scanline === 160) for (let channel = 0; channel < 4; channel++) this.performDma(channel, 1);
      if (this.scanline === 160 && (displayStatus & 0x0008)) this.writeIo16(0x04000202, this.read16(0x04000202) | 0x0001);
    }
    for (let index = 0; index < 4; index++) { const control = this.read16(0x04000102 + index * 4); if (!(control & 0x80) || (index && (control & 4))) continue; const divider = [1, 64, 256, 1024][control & 3]; const total = this.timerRemainder[index] + cycles; const ticks = Math.floor(total / divider); this.timerRemainder[index] = total % divider; if (ticks) this.incrementTimer(index, ticks); }
  }

  incrementTimer(index, ticks) {
    if (index > 3 || ticks <= 0) return;
    const address = 0x04000100 + index * 4; const control = this.read16(address + 2); if (!(control & 0x80)) return;
    let value = this.read16(address); let overflows = 0;
    while (ticks > 0) { const untilOverflow = 0x10000 - value; if (ticks < untilOverflow) { value += ticks; ticks = 0; } else { ticks -= untilOverflow; value = this.timerReload[index]; overflows++; } }
    this.writeIo16(address, value);
    if (overflows && (control & 0x40)) this.writeIo16(0x04000202, this.read16(0x04000202) | (1 << (3 + index)));
    if (overflows && index < 3 && (this.read16(address + 6) & 0x84) === 0x84) this.incrementTimer(index + 1, overflows);
  }

  writeIo16(address, value) {
    const offset = (address - REGION.IO) & 0x3fe;
    this.io[offset] = value & 0xff; this.io[offset + 1] = (value >>> 8) & 0xff;
  }

  performDma(channel, trigger = 0) {
    if (channel < 0 || channel > 3) return;
    const base = 0x040000b0 + channel * 12;
    const source = this.read32(base); const destination = this.read32(base + 4); const control = this.read16(base + 10);
    const timing = (control >>> 12) & 3;
    if (!(control & 0x8000) || timing !== trigger) return;
    const max = channel === 3 ? 0x10000 : 0x4000; const count = this.read16(base + 8) || max; const width = control & 0x0400 ? 4 : 2; const sourceMode = (control >>> 7) & 3; const destinationMode = (control >>> 5) & 3; let src = source; let dst = destination;
    for (let i = 0; i < count; i++) {
      if (width === 4) this.write32(dst, this.read32(src)); else this.write16(dst, this.read16(src));
      if (sourceMode !== 2) src = (src + (sourceMode === 1 ? -width : width)) >>> 0;
      if (destinationMode !== 2) dst = (dst + (destinationMode === 1 ? -width : width)) >>> 0;
    }
    if (!(control & 0x0200) || timing === 0) this.writeIo16(base + 10, control & 0x7fff);
  }

  setButtons(mask) {
    const activeLow = (~mask) & 0x03ff;
    this.io[0x130] = activeLow & 0xff;
    this.io[0x131] = activeLow >>> 8;
  }

  getSave() { return Uint8Array.from(this.sram); }

  pendingInterrupt() { return Boolean((this.read16(0x04000208) & 1) && (this.read16(0x04000200) & this.read16(0x04000202))); }

  registerRamReset(mask) {
    if (mask & 0x01) this.ewram.fill(0);
    if (mask & 0x02) this.iwram.fill(0);
    if (mask & 0x04) this.palette.fill(0);
    if (mask & 0x08) this.vram.fill(0);
    if (mask & 0x10) this.oam.fill(0);
    if (mask & 0xe0) { const keys = this.read16(0x04000130); this.io.fill(0); this.writeIo16(0x04000130, keys || 0x03ff); }
  }

  readPalette(index) {
    return little16(this.palette, (index & 0x1ff) * 2);
  }
}

module.exports = { GbaMemory, REGION };
