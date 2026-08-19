'use strict';

class GbaPpu {
  constructor(memory) { this.memory = memory; this.width = 240; this.height = 160; this.frame = new Uint32Array(this.width * this.height); }

  color15(value) {
    const r = (value & 31) * 255 / 31; const g = ((value >>> 5) & 31) * 255 / 31; const b = ((value >>> 10) & 31) * 255 / 31;
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }

  render() {
    const mode = this.memory.read16(0x04000000) & 7;
    if (mode === 3) return this.renderMode3();
    if (mode === 4) return this.renderMode4();
    return this.renderMode0();
  }

  renderMode3() {
    for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) this.frame[y * 240 + x] = this.color15(this.memory.read16(0x06000000 + ((y * 240 + x) << 1)));
    return this.frame;
  }

  renderMode4() {
    const page = (this.memory.read16(0x04000000) & 0x10) ? 0xa000 : 0;
    for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) this.frame[y * 240 + x] = this.color15(this.memory.readPalette(this.memory.read8(0x06000000 + page + y * 240 + x)));
    return this.frame;
  }

  renderMode0() {
    // BG0 4/8bpp tile map: suficiente para os primeiros homebrews e testes.
    const control = this.memory.read16(0x04000008); const charBase = ((control >>> 2) & 3) * 0x4000; const mapBase = ((control >>> 8) & 31) * 0x800; const color8 = Boolean(control & 0x80); const hFlip = Boolean(control & 0x4000); const vFlip = Boolean(control & 0x8000);
    const scrollX = this.memory.read16(0x04000010); const scrollY = this.memory.read16(0x04000012);
    for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) {
      const worldX = (x + scrollX) & 255; const worldY = (y + scrollY) & 255; const tileX = worldX >>> 3; const tileY = worldY >>> 3; const entry = this.memory.read16(0x06000000 + mapBase + tileY * 32 * 2 + tileX * 2); const tile = entry & 0x3ff; const fx = Boolean(entry & 0x4000) ^ hFlip; const fy = Boolean(entry & 0x8000) ^ vFlip; const px = fx ? 7 - (worldX & 7) : worldX & 7; const py = fy ? 7 - (worldY & 7) : worldY & 7; let index;
      if (color8) index = this.memory.read8(0x06000000 + charBase + tile * 64 + py * 8 + px); else { const packed = this.memory.read8(0x06000000 + charBase + tile * 32 + py * 4 + (px >>> 1)); const nibble = (px & 1) ? packed >>> 4 : packed & 15; index = nibble + ((entry >>> 12) & 15) * 16; }
      this.frame[y * 240 + x] = this.color15(this.memory.readPalette(index));
    }
    return this.frame;
  }
}

module.exports = { GbaPpu };
