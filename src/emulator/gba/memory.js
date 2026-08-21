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
    this.dmaSource = [0, 0, 0, 0];
    this.dmaDestination = [0, 0, 0, 0];
    this.dmaInitialDestination = [0, 0, 0, 0];
    this.dmaEnabled = [false, false, false, false];
    this.audioFifos = Array.from({ length: 2 }, () => ({ data: new Int8Array(32), head: 0, length: 0 }));
    this.directSound = [0, 0];
    this.audioCycleRemainder = 0;
    this.audioSamples = new Int16Array(32768 * 2);
    this.audioFrameCount = 0;
    this.videoRevision = 0;
    this.initializeIoDefaults();
  }

  initializeIoDefaults() {
    this.io.fill(0);
    // A BIOS deixa as matrizes affine em identidade. Jogos comerciais, incluindo
    // FireRed, dependem desse estado após RegisterRamReset em vez de regravar PA/PD.
    this.writeIo16(0x04000020, 0x0100); this.writeIo16(0x04000026, 0x0100);
    this.writeIo16(0x04000030, 0x0100); this.writeIo16(0x04000036, 0x0100);
    this.writeIo16(0x04000088, 0x0200); // SOUNDBIAS
    this.writeIo16(0x04000130, 0x03ff); // KEYINPUT: botões soltos
    this.writeIo16(0x04000134, 0x8000); // RCNT
  }

  region(address) {
    const a = address >>> 0;
    if (a >= REGION.EWRAM && a < REGION.IWRAM) return [this.ewram, (a - REGION.EWRAM) & 0x3ffff];
    if (a >= REGION.IWRAM && a < REGION.IO) return [this.iwram, (a - REGION.IWRAM) & 0x7fff];
    if (a >= REGION.IO && a < REGION.IO + 0x400) return [this.io, a - REGION.IO];
    if (a >= REGION.PAL && a < REGION.VRAM) return [this.palette, (a - REGION.PAL) & 0x3ff];
    if (a >= REGION.VRAM && a < REGION.OAM) { let offset = (a - REGION.VRAM) & 0x1ffff; if (offset >= 0x18000) offset -= 0x8000; return [this.vram, offset]; }
    if (a >= REGION.OAM && a < REGION.ROM) return [this.oam, (a - REGION.OAM) & 0x3ff];
    if (a >= 0x0e000000 && a < 0x10000000) return [this.sram, (a - 0x0e000000) & 0xffff];
    return null;
  }

  read8(address) {
    const a = address >>> 0;
    if (a >= REGION.ROM && a < 0x0e000000 && this.rom.length) return this.rom[(a - REGION.ROM) % this.rom.length];
    if (a >= REGION.EWRAM && a < REGION.IWRAM) return this.ewram[(a - REGION.EWRAM) & 0x3ffff];
    if (a >= REGION.IWRAM && a < REGION.IO) return this.iwram[(a - REGION.IWRAM) & 0x7fff];
    if (a >= REGION.IO && a < REGION.IO + 0x400) return this.io[a - REGION.IO];
    if (a >= REGION.PAL && a < REGION.VRAM) return this.palette[(a - REGION.PAL) & 0x3ff];
    if (a >= REGION.VRAM && a < REGION.OAM) { let offset = (a - REGION.VRAM) & 0x1ffff; if (offset >= 0x18000) offset -= 0x8000; return this.vram[offset]; }
    if (a >= REGION.OAM && a < REGION.ROM) return this.oam[(a - REGION.OAM) & 0x3ff];
    if (a >= 0x0e000000 && a < 0x10000000) { const offset = (a - 0x0e000000) & 0xffff; if (this.flashIdMode && offset < 2) return offset ? 0x13 : 0x62; return this.sram[this.flashBank * 0x10000 + offset]; }
    return 0;
  }

  read16(address) {
    const a = address & ~1;
    if (a >= REGION.ROM && a < 0x0e000000 && this.rom.length) { const offset = (a - REGION.ROM) % this.rom.length; return this.rom[offset] | (this.rom[(offset + 1) % this.rom.length] << 8); }
    if (a >= REGION.EWRAM && a < REGION.IWRAM) return little16(this.ewram, (a - REGION.EWRAM) & 0x3ffff);
    if (a >= REGION.IWRAM && a < REGION.IO) return little16(this.iwram, (a - REGION.IWRAM) & 0x7fff);
    if (a >= REGION.IO && a < REGION.IO + 0x400) return little16(this.io, a - REGION.IO);
    if (a >= REGION.PAL && a < REGION.VRAM) return little16(this.palette, (a - REGION.PAL) & 0x3ff);
    if (a >= REGION.VRAM && a < REGION.OAM) { let offset = (a - REGION.VRAM) & 0x1ffff; if (offset >= 0x18000) offset -= 0x8000; return little16(this.vram, offset); }
    if (a >= REGION.OAM && a < REGION.ROM) return little16(this.oam, (a - REGION.OAM) & 0x3ff);
    return this.read8(a) | (this.read8(a + 1) << 8);
  }

  read32(address) {
    const a = address & ~3;
    let bytes; let offset;
    if (a >= REGION.ROM && a < 0x0e000000 && this.rom.length) { bytes = this.rom; offset = (a - REGION.ROM) % bytes.length; if (offset + 3 >= bytes.length) return (this.read16(a) | (this.read16(a + 2) << 16)) >>> 0; }
    else if (a >= REGION.EWRAM && a < REGION.IWRAM) { bytes = this.ewram; offset = (a - REGION.EWRAM) & 0x3ffff; }
    else if (a >= REGION.IWRAM && a < REGION.IO) { bytes = this.iwram; offset = (a - REGION.IWRAM) & 0x7fff; }
    else if (a >= REGION.IO && a < REGION.IO + 0x400) { bytes = this.io; offset = a - REGION.IO; }
    else if (a >= REGION.PAL && a < REGION.VRAM) { bytes = this.palette; offset = (a - REGION.PAL) & 0x3ff; }
    else if (a >= REGION.VRAM && a < REGION.OAM) { bytes = this.vram; offset = (a - REGION.VRAM) & 0x1ffff; if (offset >= 0x18000) offset -= 0x8000; }
    else if (a >= REGION.OAM && a < REGION.ROM) { bytes = this.oam; offset = (a - REGION.OAM) & 0x3ff; }
    if (bytes) return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
    return (this.read16(a) | (this.read16(a + 2) << 16)) >>> 0;
  }

  write8(address, value) {
    const a = address >>> 0;
    const byte = value & 0xff;
    if (a >= 0x040000a0 && a < 0x040000a8) { this.pushAudioFifo(a < 0x040000a4 ? 0 : 1, byte); return; }
    if (a >= 0x0e000000 && a < 0x10000000) { this.writeFlash((a - 0x0e000000) & 0xffff, byte); return; }
    if (a >= REGION.ROM) return;
    const videoWrite = (bytes, offset) => { if (bytes[offset] !== byte) { bytes[offset] = byte; this.videoRevision++; } };
    if (a >= REGION.EWRAM && a < REGION.IWRAM) this.ewram[(a - REGION.EWRAM) & 0x3ffff] = byte;
    else if (a >= REGION.IWRAM && a < REGION.IO) this.iwram[(a - REGION.IWRAM) & 0x7fff] = byte;
    else if (a >= REGION.IO && a < REGION.IO + 0x400) { const offset = a - REGION.IO; if (offset < 2 || (offset >= 8 && offset < 0x56)) videoWrite(this.io, offset); else this.io[offset] = byte; }
    else if (a >= REGION.PAL && a < REGION.VRAM) videoWrite(this.palette, (a - REGION.PAL) & 0x3ff);
    else if (a >= REGION.VRAM && a < REGION.OAM) { let offset = (a - REGION.VRAM) & 0x1ffff; if (offset >= 0x18000) offset -= 0x8000; videoWrite(this.vram, offset); }
    else if (a >= REGION.OAM && a < REGION.ROM) videoWrite(this.oam, (a - REGION.OAM) & 0x3ff);
  }

  writeFlash(offset, value) {
    // Depois do comando A0, o próximo byte é sempre dado. 0xF0 só reinicia o
    // chip no modo de comandos; tratá-lo antes daqui impedia o FireRed de
    // gravar qualquer byte 0xF0 e fazia a verificação do save falhar.
    if (this.flashState === 3) { this.sram[this.flashBank * 0x10000 + offset] &= value; this.flashState = 0; return; }
    if (this.flashState === 4) { if (offset === 0) this.flashBank = value & 1; this.flashState = 0; return; }
    if (value === 0xf0) { this.flashState = 0; this.flashIdMode = false; return; }
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
    const dmaControl = a >= 0x040000ba && a <= 0x040000de && ((a - 0x040000b0) % 12) === 10;
    const oldControl = timerControl || dmaControl ? this.read16(a) : 0;
    this.write8(a, value); this.write8(a + 1, value >>> 8);
    if (timerData) this.timerReload[(a - 0x04000100) >> 2] = value & 0xffff;
    if (timerControl && !(oldControl & 0x80) && (value & 0x80)) { const index = (a - 0x04000102) >> 2; this.writeIo16(a - 2, this.timerReload[index]); this.timerRemainder[index] = 0; }
    if (a === 0x04000082) this.applySoundControl(value);
    if (dmaControl) this.updateDmaControl(Math.floor((a - 0x040000b0) / 12), oldControl, value);
  }

  write32(address, value) {
    const a = address & ~3;
    const dmaControlWrite = a >= 0x040000b8 && a <= 0x040000dc && ((a - 0x040000b8) % 12) === 0;
    const oldControl = dmaControlWrite ? this.read16(a + 2) : 0;
    this.write8(a, value); this.write8(a + 1, value >>> 8); this.write8(a + 2, value >>> 16); this.write8(a + 3, value >>> 24);
    if (a === 0x04000080) this.applySoundControl(value >>> 16);
    if (dmaControlWrite) this.updateDmaControl(Math.floor((a - 0x040000b8) / 12), oldControl, value >>> 16);
  }

  tick(cycles) {
    this.scanlineCycles += cycles;
    while (this.scanlineCycles >= 1232) {
      this.scanlineCycles -= 1232;
      this.scanline = (this.scanline + 1) % 228;
      this.io[0x06] = this.scanline;
      const displayStatus = little16(this.io, 0x04) & ~3;
      const vblank = this.scanline >= 160;
      const hblank = 0;
      this.writeIo16(0x04000004, displayStatus | (vblank ? 1 : 0) | hblank);
      if (this.scanline === 160) for (let channel = 0; channel < 4; channel++) this.performDma(channel, 1);
      if (this.scanline === 160 && (displayStatus & 0x0008)) this.writeIo16(0x04000202, this.read16(0x04000202) | 0x0001);
    }
    for (let index = 0; index < 4; index++) { const control = little16(this.io, 0x102 + index * 4); if (!(control & 0x80) || (index && (control & 4))) continue; const divider = [1, 64, 256, 1024][control & 3]; const total = this.timerRemainder[index] + cycles; const ticks = Math.floor(total / divider); this.timerRemainder[index] = total % divider; if (ticks) this.incrementTimer(index, ticks); }
    this.generateAudio(cycles);
  }

  incrementTimer(index, ticks) {
    if (index > 3 || ticks <= 0) return;
    const address = 0x04000100 + index * 4; const ioOffset = 0x100 + index * 4; const control = little16(this.io, ioOffset + 2); if (!(control & 0x80)) return;
    let value = little16(this.io, ioOffset); let overflows = 0;
    while (ticks > 0) { const untilOverflow = 0x10000 - value; if (ticks < untilOverflow) { value += ticks; ticks = 0; } else { ticks -= untilOverflow; value = this.timerReload[index]; overflows++; } }
    this.writeIo16(address, value);
    if (overflows) this.clockAudioFifos(index, overflows);
    if (overflows && (control & 0x40)) this.writeIo16(0x04000202, little16(this.io, 0x202) | (1 << (3 + index)));
    if (overflows && index < 3 && (little16(this.io, ioOffset + 6) & 0x84) === 0x84) this.incrementTimer(index + 1, overflows);
  }

  writeIo16(address, value) {
    const offset = (address - REGION.IO) & 0x3fe;
    this.io[offset] = value & 0xff; this.io[offset + 1] = (value >>> 8) & 0xff;
  }

  pushAudioFifo(index, value) {
    const fifo = this.audioFifos[index];
    if (fifo.length >= 32) return;
    fifo.data[(fifo.head + fifo.length) & 31] = (value << 24) >> 24;
    fifo.length++;
  }

  resetAudioFifo(index) {
    const fifo = this.audioFifos[index]; fifo.head = 0; fifo.length = 0; this.directSound[index] = 0;
  }

  applySoundControl(value) {
    if (value & 0x0800) this.resetAudioFifo(0);
    if (value & 0x8000) this.resetAudioFifo(1);
    this.writeIo16(0x04000082, value & ~0x8800);
    this.serviceAudioDma(0); this.serviceAudioDma(1);
  }

  clockAudioFifos(timer, overflows) {
    const control = little16(this.io, 0x82);
    for (let count = 0; count < overflows; count++) for (let index = 0; index < 2; index++) {
      const selectedTimer = index ? (control >>> 14) & 1 : (control >>> 10) & 1;
      if (selectedTimer !== timer) continue;
      const fifo = this.audioFifos[index];
      if (fifo.length) { this.directSound[index] = fifo.data[fifo.head]; fifo.head = (fifo.head + 1) & 31; fifo.length--; } else this.directSound[index] = 0;
      if (fifo.length <= 16) this.serviceAudioDma(index);
    }
  }

  generateAudio(cycles) {
    const master = little16(this.io, 0x84) & 0x80; const control = little16(this.io, 0x82);
    if (!master || !(control & 0x3300)) { this.audioCycleRemainder = 0; return; }
    const total = this.audioCycleRemainder + cycles; const frames = Math.floor(total / 512); this.audioCycleRemainder = total % 512;
    if (!frames) return;
    const volumeA = control & 0x0004 ? 1 : 0.5; const volumeB = control & 0x0008 ? 1 : 0.5;
    let left = 0; let right = 0;
    if (control & 0x0200) left += this.directSound[0] * volumeA;
    if (control & 0x0100) right += this.directSound[0] * volumeA;
    if (control & 0x2000) left += this.directSound[1] * volumeB;
    if (control & 0x1000) right += this.directSound[1] * volumeB;
    const leftSample = Math.max(-32768, Math.min(32767, Math.round(left * 128))); const rightSample = Math.max(-32768, Math.min(32767, Math.round(right * 128)));
    for (let frame = 0; frame < frames && this.audioFrameCount < 32768; frame++) { const offset = this.audioFrameCount++ * 2; this.audioSamples[offset] = leftSample; this.audioSamples[offset + 1] = rightSample; }
  }

  takeAudio() {
    const samples = this.audioSamples.slice(0, this.audioFrameCount * 2); this.audioFrameCount = 0;
    return { sampleRate: 32768, samples };
  }

  updateDmaControl(channel, oldControl, newControl) {
    if (!(newControl & 0x8000)) { this.dmaEnabled[channel] = false; return; }
    if (!(oldControl & 0x8000)) {
      const base = 0x040000b0 + channel * 12; this.dmaSource[channel] = this.read32(base); this.dmaDestination[channel] = this.read32(base + 4); this.dmaInitialDestination[channel] = this.dmaDestination[channel]; this.dmaEnabled[channel] = true;
      const timing = (newControl >>> 12) & 3;
      if (timing === 0) this.performDma(channel, 0);
      else if (timing === 3) { this.serviceAudioDma(0); this.serviceAudioDma(1); }
    }
  }

  serviceAudioDma(index) {
    const destination = index ? 0x040000a4 : 0x040000a0;
    for (let channel = 1; channel <= 2; channel++) { const base = 0x040000b0 + channel * 12; const control = this.read16(base + 10); const configuredDestination = this.dmaEnabled[channel] ? this.dmaDestination[channel] : this.read32(base + 4); if ((control & 0xb000) === 0xb000 && (configuredDestination & ~3) === destination) this.performDma(channel, 3); }
  }

  performDma(channel, trigger = 0) {
    if (channel < 0 || channel > 3) return;
    const base = 0x040000b0 + channel * 12;
    const source = this.read32(base); const destination = this.read32(base + 4); const control = this.read16(base + 10);
    const timing = (control >>> 12) & 3;
    if (!(control & 0x8000) || timing !== trigger) return;
    if (!this.dmaEnabled[channel]) { this.dmaSource[channel] = source; this.dmaDestination[channel] = destination; this.dmaInitialDestination[channel] = destination; this.dmaEnabled[channel] = true; }
    const fifoTransfer = timing === 3 && channel < 3 && ((this.dmaDestination[channel] & ~3) === 0x040000a0 || (this.dmaDestination[channel] & ~3) === 0x040000a4);
    const max = channel === 3 ? 0x10000 : 0x4000; const count = fifoTransfer ? 4 : (this.read16(base + 8) || max); const width = fifoTransfer ? 4 : (control & 0x0400 ? 4 : 2); const sourceMode = (control >>> 7) & 3; const destinationMode = fifoTransfer ? 2 : (control >>> 5) & 3; let src = this.dmaSource[channel]; let dst = this.dmaDestination[channel];
    for (let i = 0; i < count; i++) {
      if (width === 4) this.write32(dst, this.read32(src)); else this.write16(dst, this.read16(src));
      if (sourceMode !== 2) src = (src + (sourceMode === 1 ? -width : width)) >>> 0;
      if (destinationMode !== 2) dst = (dst + (destinationMode === 1 ? -width : width)) >>> 0;
    }
    this.dmaSource[channel] = src; this.dmaDestination[channel] = destinationMode === 3 && (control & 0x0200) && timing !== 0 ? this.dmaInitialDestination[channel] : dst;
    if (control & 0x4000) this.writeIo16(0x04000202, little16(this.io, 0x202) | (1 << (8 + channel)));
    if (!(control & 0x0200) || timing === 0) { this.writeIo16(base + 10, control & 0x7fff); this.dmaEnabled[channel] = false; }
  }

  setButtons(mask) {
    const activeLow = (~mask) & 0x03ff;
    this.io[0x130] = activeLow & 0xff;
    this.io[0x131] = activeLow >>> 8;
  }

  getSave() { return Uint8Array.from(this.sram); }

  pendingInterrupt() { return Boolean((little16(this.io, 0x208) & 1) && (little16(this.io, 0x200) & little16(this.io, 0x202))); }

  registerRamReset(mask) {
    if (mask & 0x01) this.ewram.fill(0);
    if (mask & 0x02) this.iwram.fill(0);
    if (mask & 0x04) { this.palette.fill(0); this.videoRevision++; }
    if (mask & 0x08) { this.vram.fill(0); this.videoRevision++; }
    if (mask & 0x10) { this.oam.fill(0); this.videoRevision++; }
    if (mask & 0xe0) { const keys = this.read16(0x04000130); this.initializeIoDefaults(); this.writeIo16(0x04000130, keys || 0x03ff); }
  }

  readPalette(index) {
    return little16(this.palette, (index & 0x1ff) * 2);
  }
}

module.exports = { GbaMemory, REGION };
