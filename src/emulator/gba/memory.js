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
    this.sram = new Uint8Array(0x10000);
    if (save) this.sram.set(Uint8Array.from(save).subarray(0, this.sram.length));
    this.scanlineCycles = 0;
    this.scanline = 0;
    this.timerRemainder = [0, 0, 0, 0];
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
    const target = this.region(a);
    return target ? target[0][target[1] % target[0].length] : 0;
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
    if (a >= REGION.ROM) return;
    const target = this.region(a);
    if (target) target[0][target[1] % target[0].length] = value & 0xff;
  }

  write16(address, value) {
    const a = address & ~1;
    if (a === 0x04000202) { this.writeIo16(a, this.read16(a) & ~(value & 0x3fff)); return; }
    this.write8(a, value); this.write8(a + 1, value >>> 8);
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
    for (let index = 0; index < 4; index++) {
      const base = 0x100 + index * 4; const control = this.read16(0x04000102 + index * 4); if (!(control & 0x80)) continue;
      const divider = [1, 64, 256, 1024][(control >>> 0) & 3]; const ticks = Math.floor((this.timerRemainder[index] + cycles) / divider); this.timerRemainder[index] = (this.timerRemainder[index] + cycles) % divider;
      if (!ticks) continue;
      const value = this.read16(0x04000000 + base); const next = value + ticks;
      if (next > 0xffff) this.writeIo16(0x04000000 + base, 0); else this.writeIo16(0x04000000 + base, next);
    }
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
