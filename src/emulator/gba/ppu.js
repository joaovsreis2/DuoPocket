'use strict';

class GbaPpu {
  constructor(memory) { this.memory = memory; this.width = 240; this.height = 160; this.frame = new Uint32Array(this.width * this.height); }

  color15(value) {
    const r = (value & 31) * 255 / 31; const g = ((value >>> 5) & 31) * 255 / 31; const b = ((value >>> 10) & 31) * 255 / 31;
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }

  render() {
    const displayControl = this.memory.read16(0x04000000); const mode = displayControl & 7;
    if (displayControl & 0x80) { this.frame.fill(this.color15(0x7fff)); return this.frame; }
    if (mode === 3) return this.renderMode3();
    if (mode === 4) return this.renderMode4();
    if (mode === 5) return this.renderMode5();
    return this.renderMode0(mode);
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

  renderMode5() {
    const page = (this.memory.read16(0x04000000) & 0x10) ? 0xa000 : 0; const backdrop = this.color15(this.memory.readPalette(0));
    this.frame.fill(backdrop);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 160; x++) this.frame[y * 240 + x] = this.color15(this.memory.read16(0x06000000 + page + ((y * 160 + x) << 1)));
    return this.frame;
  }

  renderMode0(mode = 0) {
    const displayControl = this.memory.read16(0x04000000);
    const spriteLines = (displayControl & 0x1000) ? this.buildSpriteLines() : null;
    const bg = [];
    for (let n = 0; n < 4; n++) bg.push(this.memory.read16(0x04000008 + n * 2));
    for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) {
      let best = 4; let color = this.memory.readPalette(0);
      for (let n = 0; n < 4; n++) {
        if (!(displayControl & (0x0100 << n))) continue;
        const control = bg[n];
        if ((mode === 1 && n === 3) || (mode === 2 && n < 2)) continue;
        const affine = (mode === 1 && n === 2) || (mode === 2 && n >= 2); const pixel = affine ? this.affineBgPixel(n, control, x, y) : this.bgPixel(n, control, x, y); if (pixel < 0 || (control & 3) >= best) continue;
        best = control & 3; color = pixel;
      }
      if (spriteLines) { const sprite = this.spritePixel(x, y, best, spriteLines[y], Boolean(displayControl & 0x40)); if (sprite >= 0) color = sprite; }
      this.frame[y * 240 + x] = this.color15(color);
    }
    return this.frame;
  }

  bgPixel(index, control, x, y) {
    const dimensions = [[256, 256], [512, 256], [256, 512], [512, 512]][(control >>> 14) & 3];
    const scrollX = this.memory.read16(0x04000010 + index * 4); const scrollY = this.memory.read16(0x04000012 + index * 4);
    const worldX = (x + scrollX) % dimensions[0]; const worldY = (y + scrollY) % dimensions[1];
    const mapBase = ((control >>> 8) & 31) * 0x800; const charBase = ((control >>> 2) & 3) * 0x4000; const color8 = Boolean(control & 0x80);
    const tileX = worldX >>> 3; const tileY = worldY >>> 3; const screenBlock = (tileX >>> 5) + (tileY >>> 5) * (dimensions[0] >>> 8); const mapIndex = ((tileY & 31) * 32 + (tileX & 31)) * 2;
    const entry = this.memory.read16(0x06000000 + mapBase + screenBlock * 0x800 + mapIndex); const tile = entry & 0x3ff;
    const px = (entry & 0x4000) ? 7 - (worldX & 7) : (worldX & 7); const py = (entry & 0x8000) ? 7 - (worldY & 7) : (worldY & 7); let paletteIndex;
    if (color8) { paletteIndex = this.memory.read8(0x06000000 + charBase + tile * 64 + py * 8 + px); if (!paletteIndex) return -1; }
    else { const packed = this.memory.read8(0x06000000 + charBase + tile * 32 + py * 4 + (px >>> 1)); const nibble = (px & 1) ? packed >>> 4 : packed & 15; if (!nibble) return -1; paletteIndex = nibble + ((entry >>> 12) & 15) * 16; }
    return this.memory.readPalette(paletteIndex);
  }

  affineBgPixel(index, control, x, y) {
    const register = index === 2 ? 0x04000020 : 0x04000030; const signed16 = (value) => (value << 16) >> 16; const signed28 = (value) => (value << 4) >> 4;
    const pa = signed16(this.memory.read16(register)); const pb = signed16(this.memory.read16(register + 2)); const pc = signed16(this.memory.read16(register + 4)); const pd = signed16(this.memory.read16(register + 6)); const refX = signed28(this.memory.read32(register + 8)); const refY = signed28(this.memory.read32(register + 12));
    const size = 128 << ((control >>> 14) & 3); let worldX = (refX + pa * x + pb * y) >> 8; let worldY = (refY + pc * x + pd * y) >> 8;
    if (control & 0x2000) { worldX = ((worldX % size) + size) % size; worldY = ((worldY % size) + size) % size; } else if (worldX < 0 || worldY < 0 || worldX >= size || worldY >= size) return -1;
    const mapBase = ((control >>> 8) & 31) * 0x800; const charBase = ((control >>> 2) & 3) * 0x4000; const mapWidth = size >>> 3; const tile = this.memory.read8(0x06000000 + mapBase + (worldY >>> 3) * mapWidth + (worldX >>> 3)); const paletteIndex = this.memory.read8(0x06000000 + charBase + tile * 64 + (worldY & 7) * 8 + (worldX & 7));
    return paletteIndex ? this.memory.readPalette(paletteIndex) : -1;
  }

  buildSpriteLines() {
    const sizes = [[[8, 8], [16, 8], [8, 16]], [[16, 16], [32, 8], [8, 32]], [[32, 32], [32, 16], [16, 32]], [[64, 64], [64, 32], [32, 64]]];
    const lines = Array.from({ length: 160 }, () => []);
    for (let i = 0; i < 128; i++) {
      const base = 0x07000000 + i * 8; const attr0 = this.memory.read16(base); const attr1 = this.memory.read16(base + 2); const attr2 = this.memory.read16(base + 4);
      const objectMode = (attr0 >>> 10) & 3; if (objectMode === 2 || objectMode === 3) continue;
      const affine = Boolean(attr0 & 0x0100); if (!affine && (attr0 & 0x0200)) continue;
      const shape = (attr0 >>> 14) & 3; const sizeIndex = (attr1 >>> 14) & 3; const dim = sizes[sizeIndex]?.[shape] || [8, 8]; const sx = attr1 & 0x1ff; const sy = attr0 & 0xff;
      const box = affine && (attr0 & 0x0200) ? [dim[0] * 2, dim[1] * 2] : dim; const sprite = { attr0, attr1, attr2, dim, box, affine, sx: sx >= 256 ? sx - 512 : sx, sy: sy >= 160 ? sy - 256 : sy };
      for (let y = Math.max(0, sprite.sy); y < Math.min(160, sprite.sy + box[1]); y++) lines[y].push(sprite);
    }
    return lines;
  }

  spritePixel(x, y, bgPriority, sprites, oneDimensional) {
    for (const sprite of sprites) {
      const { attr0, attr1, attr2, dim, box } = sprite; const priority = (attr2 >>> 10) & 3; if (priority > bgPriority) continue;
      let px = x - sprite.sx; let py = y - sprite.sy; if (px < 0 || py < 0 || px >= box[0] || py >= box[1]) continue;
      if (sprite.affine) { const matrix = (attr1 >>> 9) & 31; const base = 0x07000000 + matrix * 32; const signed = (value) => (value << 16) >> 16; const pa = signed(this.memory.read16(base + 6)); const pb = signed(this.memory.read16(base + 14)); const pc = signed(this.memory.read16(base + 22)); const pd = signed(this.memory.read16(base + 30)); const dx = px - (box[0] >> 1); const dy = py - (box[1] >> 1); px = ((pa * dx + pb * dy) >> 8) + (dim[0] >> 1); py = ((pc * dx + pd * dy) >> 8) + (dim[1] >> 1); if (px < 0 || py < 0 || px >= dim[0] || py >= dim[1]) continue; }
      else { if (attr1 & 0x1000) px = dim[0] - 1 - px; if (attr1 & 0x2000) py = dim[1] - 1 - py; }
      const color8 = Boolean(attr0 & 0x2000); const tile = attr2 & 0x3ff; const tileX = px >>> 3; const tileY = py >>> 3; const factor = color8 ? 2 : 1; const tilesWide = dim[0] >>> 3; const tileNumber = tile + tileY * (oneDimensional ? tilesWide * factor : 32) + tileX * factor; const data = color8 ? this.memory.read8(0x06010000 + tileNumber * 32 + (py & 7) * 8 + (px & 7)) : this.memory.read8(0x06010000 + tileNumber * 32 + (py & 7) * 4 + ((px & 7) >>> 1)); const paletteIndex = color8 ? data : ((data >>> ((px & 1) * 4)) & 15) + ((attr2 >>> 12) & 15) * 16; if (!paletteIndex) continue; return this.memory.readPalette(0x200 + paletteIndex);
    }
    return -1;
  }
}

module.exports = { GbaPpu };
