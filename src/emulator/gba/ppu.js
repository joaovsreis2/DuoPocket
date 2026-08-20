'use strict';

class GbaPpu {
  constructor(memory) { this.memory = memory; this.width = 240; this.height = 160; this.frame = new Uint32Array(this.width * this.height); this.lastVideoRevision = -1; this.windowMaskCache = null; this.colorLut = new Uint32Array(0x8000); for (let color = 0; color < this.colorLut.length; color++) { const r = (color & 31) * 255 / 31; const g = ((color >>> 5) & 31) * 255 / 31; const b = ((color >>> 10) & 31) * 255 / 31; this.colorLut[color] = (255 << 24) | (b << 16) | (g << 8) | r; } }

  color15(value) {
    return this.colorLut[value & 0x7fff];
  }

  render() {
    if (this.lastVideoRevision === this.memory.videoRevision) return this.frame;
    this.lastVideoRevision = this.memory.videoRevision;
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
    const memory = this.memory; const io = memory.io; const vram = memory.vram; const palette = memory.palette;
    const read16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8); const read32 = (bytes, offset) => (read16(bytes, offset) | (read16(bytes, offset + 2) << 16)) >>> 0;
    const displayControl = read16(io, 0); const spriteLines = (displayControl & 0x9000) ? this.buildSpriteLines() : null; const bg = []; const scrollX = []; const scrollY = [];
    for (let n = 0; n < 4; n++) { bg.push(read16(io, 8 + n * 2)); scrollX.push(read16(io, 0x10 + n * 4)); scrollY.push(read16(io, 0x12 + n * 4)); }
    let windowMasks = null; const windowEnabled = displayControl & 0xe000;
    if (windowEnabled) {
      const inside = (coordinate, packed) => { const start = packed >>> 8; const end = packed & 0xff; return start <= end ? coordinate >= start && coordinate < end : coordinate >= start || coordinate < end; };
      const win0X = read16(io, 0x40); const win1X = read16(io, 0x42); const win0Y = read16(io, 0x44); const win1Y = read16(io, 0x46); const winIn0 = io[0x48] & 0x3f; const winIn1 = io[0x49] & 0x3f; const winOut = io[0x4a] & 0x3f; const objOut = io[0x4b] & 0x3f;
      const cacheKey = `${displayControl & 0xe000}:${win0X}:${win1X}:${win0Y}:${win1Y}:${winIn0}:${winIn1}:${winOut}:${objOut}`;
      if (!(displayControl & 0x8000) && this.windowMaskCache?.key === cacheKey) windowMasks = this.windowMaskCache.masks;
      else { windowMasks = new Uint8Array(240 * 160); for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) { let mask = winOut; if ((displayControl & 0x2000) && inside(x, win0X) && inside(y, win0Y)) mask = winIn0; else if ((displayControl & 0x4000) && inside(x, win1X) && inside(y, win1Y)) mask = winIn1; else if ((displayControl & 0x8000) && spriteLines && this.spritePixel(x, y, 4, spriteLines.window[y], Boolean(displayControl & 0x40)) >= 0) mask = objOut; windowMasks[y * 240 + x] = mask; } if (!(displayControl & 0x8000)) this.windowMaskCache = { key: cacheKey, masks: windowMasks }; }
    }
    const dimensions = [[256, 256], [512, 256], [256, 512], [512, 512]]; const bgInfo = bg.map((control, n) => { const dim = dimensions[(control >>> 14) & 3]; return { control, priority: control & 3, width: dim[0], height: dim[1], mapBase: ((control >>> 8) & 31) * 0x800, charBase: ((control >>> 2) & 3) * 0x4000, color8: Boolean(control & 0x80), scrollX: scrollX[n], scrollY: scrollY[n] }; }); const signed16 = (value) => (value << 16) >> 16; const signed28 = (value) => (value << 4) >> 4; const affine = {};
    for (let n = 2; n < 4; n++) { const register = n === 2 ? 0x20 : 0x30; affine[n] = { pa: signed16(read16(io, register)), pb: signed16(read16(io, register + 2)), pc: signed16(read16(io, register + 4)), pd: signed16(read16(io, register + 6)), x: signed28(read32(io, register + 8)), y: signed28(read32(io, register + 12)) }; }
    const bgPixel = (n, x, y) => {
      const info = bgInfo[n]; const worldX = (x + info.scrollX) & (info.width - 1); const worldY = (y + info.scrollY) & (info.height - 1); const tileX = worldX >>> 3; const tileY = worldY >>> 3; const screenBlock = (tileX >>> 5) + (tileY >>> 5) * (info.width >>> 8); const mapOffset = info.mapBase + screenBlock * 0x800 + ((tileY & 31) * 32 + (tileX & 31)) * 2; const entry = read16(vram, mapOffset); const tile = entry & 0x3ff; const px = (entry & 0x0400) ? 7 - (worldX & 7) : worldX & 7; const py = (entry & 0x0800) ? 7 - (worldY & 7) : worldY & 7; let paletteIndex;
      if (info.color8) { paletteIndex = vram[info.charBase + tile * 64 + py * 8 + px]; if (!paletteIndex) return -1; } else { const packed = vram[info.charBase + tile * 32 + py * 4 + (px >>> 1)]; const nibble = (px & 1) ? packed >>> 4 : packed & 15; if (!nibble) return -1; paletteIndex = nibble + ((entry >>> 12) & 15) * 16; } return read16(palette, paletteIndex * 2);
    };
    const affinePixel = (n, x, y) => { const control = bg[n]; const matrix = affine[n]; const size = 128 << ((control >>> 14) & 3); let worldX = (matrix.x + matrix.pa * x + matrix.pb * y) >> 8; let worldY = (matrix.y + matrix.pc * x + matrix.pd * y) >> 8; if (control & 0x2000) { worldX = ((worldX % size) + size) % size; worldY = ((worldY % size) + size) % size; } else if (worldX < 0 || worldY < 0 || worldX >= size || worldY >= size) return -1; const mapBase = ((control >>> 8) & 31) * 0x800; const charBase = ((control >>> 2) & 3) * 0x4000; const tile = vram[mapBase + (worldY >>> 3) * (size >>> 3) + (worldX >>> 3)]; const paletteIndex = vram[charBase + tile * 64 + (worldY & 7) * 8 + (worldX & 7)]; return paletteIndex ? read16(palette, paletteIndex * 2) : -1; };
    const blendControl = read16(io, 0x50); const effect = (blendControl >>> 6) & 3; const amount = Math.min(16, read16(io, 0x54) & 31); const applyBrightness = (color, layer) => { if (!(blendControl & (1 << layer)) || effect < 2) return color; let red = color & 31; let green = (color >>> 5) & 31; let blue = (color >>> 10) & 31; if (effect === 2) { red += ((31 - red) * amount) >> 4; green += ((31 - green) * amount) >> 4; blue += ((31 - blue) * amount) >> 4; } else { red -= (red * amount) >> 4; green -= (green * amount) >> 4; blue -= (blue * amount) >> 4; } return red | (green << 5) | (blue << 10); };
    const backdrop = read16(palette, 0); const lut = this.colorLut; const oneDimensional = Boolean(displayControl & 0x40);
    for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) { const offset = y * 240 + x; const windowMask = windowMasks ? windowMasks[offset] : 0x3f; let best = 4; let selectedLayer = 5; let color = backdrop; for (let n = 0; n < 4; n++) { if (!(displayControl & (0x0100 << n)) || !(windowMask & (1 << n)) || (mode === 1 && n === 3) || (mode === 2 && n < 2)) continue; const isAffine = (mode === 1 && n === 2) || (mode === 2 && n >= 2); const pixel = isAffine ? affinePixel(n, x, y) : bgPixel(n, x, y); if (pixel < 0 || bgInfo[n].priority >= best) continue; best = bgInfo[n].priority; selectedLayer = n; color = pixel; } const visibleSprites = spriteLines?.visible[y]; if (visibleSprites?.length && (windowMask & 0x10)) { const sprite = this.spritePixel(x, y, best, visibleSprites, oneDimensional); if (sprite >= 0) { color = sprite; selectedLayer = 4; } } if ((windowMask & 0x20) && effect >= 2) color = applyBrightness(color, selectedLayer); this.frame[offset] = lut[color & 0x7fff]; }
    return this.frame;
  }

  bgPixel(index, control, x, y) {
    const dimensions = [[256, 256], [512, 256], [256, 512], [512, 512]][(control >>> 14) & 3];
    const scrollX = this.memory.read16(0x04000010 + index * 4); const scrollY = this.memory.read16(0x04000012 + index * 4);
    const worldX = (x + scrollX) % dimensions[0]; const worldY = (y + scrollY) % dimensions[1];
    const mapBase = ((control >>> 8) & 31) * 0x800; const charBase = ((control >>> 2) & 3) * 0x4000; const color8 = Boolean(control & 0x80);
    const tileX = worldX >>> 3; const tileY = worldY >>> 3; const screenBlock = (tileX >>> 5) + (tileY >>> 5) * (dimensions[0] >>> 8); const mapIndex = ((tileY & 31) * 32 + (tileX & 31)) * 2;
    const entry = this.memory.read16(0x06000000 + mapBase + screenBlock * 0x800 + mapIndex); const tile = entry & 0x3ff;
    const px = (entry & 0x0400) ? 7 - (worldX & 7) : (worldX & 7); const py = (entry & 0x0800) ? 7 - (worldY & 7) : (worldY & 7); let paletteIndex;
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
    const sizes = [[[8, 8], [16, 8], [8, 16]], [[16, 16], [32, 8], [8, 32]], [[32, 32], [32, 16], [16, 32]], [[64, 64], [64, 32], [32, 64]]]; const oam = this.memory.oam; const read16 = (offset) => oam[offset] | (oam[offset + 1] << 8);
    const lines = { visible: Array.from({ length: 160 }, () => []), window: Array.from({ length: 160 }, () => []) };
    for (let i = 0; i < 128; i++) {
      const base = i * 8; const attr0 = read16(base); const attr1 = read16(base + 2); const attr2 = read16(base + 4);
      const objectMode = (attr0 >>> 10) & 3; if (objectMode === 3) continue;
      const affine = Boolean(attr0 & 0x0100); if (!affine && (attr0 & 0x0200)) continue;
      const shape = (attr0 >>> 14) & 3; const sizeIndex = (attr1 >>> 14) & 3; const dim = sizes[sizeIndex]?.[shape] || [8, 8]; const sx = attr1 & 0x1ff; const sy = attr0 & 0xff;
      const box = affine && (attr0 & 0x0200) ? [dim[0] * 2, dim[1] * 2] : dim; const sprite = { attr0, attr1, attr2, dim, box, affine, sx: sx >= 256 ? sx - 512 : sx, sy: sy >= 160 ? sy - 256 : sy };
      const target = objectMode === 2 ? lines.window : lines.visible; for (let y = Math.max(0, sprite.sy); y < Math.min(160, sprite.sy + box[1]); y++) target[y].push(sprite);
    }
    return lines;
  }

  windowMask(displayControl, spriteLines, x, y) {
    if (!(displayControl & 0xe000)) return 0x3f;
    const inside = (coordinate, packed) => { const start = packed >>> 8; const end = packed & 0xff; return start <= end ? coordinate >= start && coordinate < end : coordinate >= start || coordinate < end; };
    if ((displayControl & 0x2000) && inside(x, this.memory.read16(0x04000040)) && inside(y, this.memory.read16(0x04000044))) return this.memory.read8(0x04000048) & 0x3f;
    if ((displayControl & 0x4000) && inside(x, this.memory.read16(0x04000042)) && inside(y, this.memory.read16(0x04000046))) return this.memory.read8(0x04000049) & 0x3f;
    if ((displayControl & 0x8000) && spriteLines && this.spritePixel(x, y, 4, spriteLines.window[y], Boolean(displayControl & 0x40)) >= 0) return this.memory.read8(0x0400004b) & 0x3f;
    return this.memory.read8(0x0400004a) & 0x3f;
  }

  applyBrightness(color, layer) {
    const control = this.memory.read16(0x04000050); const effect = (control >>> 6) & 3; if (!(control & (1 << layer)) || effect < 2) return color;
    const amount = Math.min(16, this.memory.read16(0x04000054) & 31); let red = color & 31; let green = (color >>> 5) & 31; let blue = (color >>> 10) & 31;
    if (effect === 2) { red += ((31 - red) * amount) >> 4; green += ((31 - green) * amount) >> 4; blue += ((31 - blue) * amount) >> 4; }
    else { red -= (red * amount) >> 4; green -= (green * amount) >> 4; blue -= (blue * amount) >> 4; }
    return red | (green << 5) | (blue << 10);
  }

  spritePixel(x, y, bgPriority, sprites, oneDimensional) {
    const vram = this.memory.vram; const oam = this.memory.oam; const palette = this.memory.palette; const read16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
    for (const sprite of sprites) {
      const { attr0, attr1, attr2, dim, box } = sprite; const priority = (attr2 >>> 10) & 3; if (priority > bgPriority) continue;
      let px = x - sprite.sx; let py = y - sprite.sy; if (px < 0 || py < 0 || px >= box[0] || py >= box[1]) continue;
      if (sprite.affine) { const matrix = (attr1 >>> 9) & 31; const base = matrix * 32; const signed = (value) => (value << 16) >> 16; const pa = signed(read16(oam, base + 6)); const pb = signed(read16(oam, base + 14)); const pc = signed(read16(oam, base + 22)); const pd = signed(read16(oam, base + 30)); const dx = px - (box[0] >> 1); const dy = py - (box[1] >> 1); px = ((pa * dx + pb * dy) >> 8) + (dim[0] >> 1); py = ((pc * dx + pd * dy) >> 8) + (dim[1] >> 1); if (px < 0 || py < 0 || px >= dim[0] || py >= dim[1]) continue; }
      else { if (attr1 & 0x1000) px = dim[0] - 1 - px; if (attr1 & 0x2000) py = dim[1] - 1 - py; }
      const color8 = Boolean(attr0 & 0x2000); const tile = attr2 & 0x3ff; const tileX = px >>> 3; const tileY = py >>> 3; const factor = color8 ? 2 : 1; const tilesWide = dim[0] >>> 3; const tileNumber = tile + tileY * (oneDimensional ? tilesWide * factor : 32) + tileX * factor; const dataOffset = 0x10000 + tileNumber * 32 + (py & 7) * (color8 ? 8 : 4) + (color8 ? (px & 7) : ((px & 7) >>> 1)); const data = vram[dataOffset]; const paletteIndex = color8 ? data : ((data >>> ((px & 1) * 4)) & 15) + ((attr2 >>> 12) & 15) * 16; if (!paletteIndex) continue; return read16(palette, (0x100 + paletteIndex) * 2);
    }
    return -1;
  }
}

module.exports = { GbaPpu };
