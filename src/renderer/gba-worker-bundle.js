"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/emulator/gba/memory.js
  var require_memory = __commonJS({
    "src/emulator/gba/memory.js"(exports, module) {
      "use strict";
      var REGION = Object.freeze({
        EWRAM: 33554432,
        IWRAM: 50331648,
        IO: 67108864,
        PAL: 83886080,
        VRAM: 100663296,
        OAM: 117440512,
        ROM: 134217728
      });
      function little16(bytes, offset) {
        return (bytes[offset] | bytes[offset + 1] << 8) & 65535;
      }
      var GbaMemory = class {
        constructor(rom, save) {
          this.rom = Uint8Array.from(rom || []);
          this.ewram = new Uint8Array(262144);
          this.iwram = new Uint8Array(32768);
          this.io = new Uint8Array(1024);
          this.palette = new Uint8Array(1024);
          this.vram = new Uint8Array(98304);
          this.oam = new Uint8Array(1024);
          this.sram = new Uint8Array(131072);
          this.sram.fill(255);
          this.flashBank = 0;
          this.flashState = 0;
          this.flashIdMode = false;
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
          this.writeIo16(67108896, 256);
          this.writeIo16(67108902, 256);
          this.writeIo16(67108912, 256);
          this.writeIo16(67108918, 256);
          this.writeIo16(67109e3, 512);
          this.writeIo16(67109168, 1023);
          this.writeIo16(67109172, 32768);
        }
        region(address) {
          const a = address >>> 0;
          if (a >= REGION.EWRAM && a < REGION.IWRAM) return [this.ewram, a - REGION.EWRAM & 262143];
          if (a >= REGION.IWRAM && a < REGION.IO) return [this.iwram, a - REGION.IWRAM & 32767];
          if (a >= REGION.IO && a < REGION.IO + 1024) return [this.io, a - REGION.IO];
          if (a >= REGION.PAL && a < REGION.VRAM) return [this.palette, a - REGION.PAL & 1023];
          if (a >= REGION.VRAM && a < REGION.OAM) {
            let offset = a - REGION.VRAM & 131071;
            if (offset >= 98304) offset -= 32768;
            return [this.vram, offset];
          }
          if (a >= REGION.OAM && a < REGION.ROM) return [this.oam, a - REGION.OAM & 1023];
          if (a >= 234881024 && a < 268435456) return [this.sram, a - 234881024 & 65535];
          return null;
        }
        read8(address) {
          const a = address >>> 0;
          if (a >= REGION.ROM && a < 234881024 && this.rom.length) return this.rom[(a - REGION.ROM) % this.rom.length];
          if (a >= REGION.EWRAM && a < REGION.IWRAM) return this.ewram[a - REGION.EWRAM & 262143];
          if (a >= REGION.IWRAM && a < REGION.IO) return this.iwram[a - REGION.IWRAM & 32767];
          if (a >= REGION.IO && a < REGION.IO + 1024) return this.io[a - REGION.IO];
          if (a >= REGION.PAL && a < REGION.VRAM) return this.palette[a - REGION.PAL & 1023];
          if (a >= REGION.VRAM && a < REGION.OAM) {
            let offset = a - REGION.VRAM & 131071;
            if (offset >= 98304) offset -= 32768;
            return this.vram[offset];
          }
          if (a >= REGION.OAM && a < REGION.ROM) return this.oam[a - REGION.OAM & 1023];
          if (a >= 234881024 && a < 268435456) {
            const offset = a - 234881024 & 65535;
            if (this.flashIdMode && offset < 2) return offset ? 19 : 98;
            return this.sram[this.flashBank * 65536 + offset];
          }
          return 0;
        }
        read16(address) {
          const a = address & ~1;
          if (a >= REGION.ROM && a < 234881024 && this.rom.length) {
            const offset = (a - REGION.ROM) % this.rom.length;
            return this.rom[offset] | this.rom[(offset + 1) % this.rom.length] << 8;
          }
          if (a >= REGION.EWRAM && a < REGION.IWRAM) return little16(this.ewram, a - REGION.EWRAM & 262143);
          if (a >= REGION.IWRAM && a < REGION.IO) return little16(this.iwram, a - REGION.IWRAM & 32767);
          if (a >= REGION.IO && a < REGION.IO + 1024) return little16(this.io, a - REGION.IO);
          if (a >= REGION.PAL && a < REGION.VRAM) return little16(this.palette, a - REGION.PAL & 1023);
          if (a >= REGION.VRAM && a < REGION.OAM) {
            let offset = a - REGION.VRAM & 131071;
            if (offset >= 98304) offset -= 32768;
            return little16(this.vram, offset);
          }
          if (a >= REGION.OAM && a < REGION.ROM) return little16(this.oam, a - REGION.OAM & 1023);
          return this.read8(a) | this.read8(a + 1) << 8;
        }
        read32(address) {
          const a = address & ~3;
          let bytes;
          let offset;
          if (a >= REGION.ROM && a < 234881024 && this.rom.length) {
            bytes = this.rom;
            offset = (a - REGION.ROM) % bytes.length;
            if (offset + 3 >= bytes.length) return (this.read16(a) | this.read16(a + 2) << 16) >>> 0;
          } else if (a >= REGION.EWRAM && a < REGION.IWRAM) {
            bytes = this.ewram;
            offset = a - REGION.EWRAM & 262143;
          } else if (a >= REGION.IWRAM && a < REGION.IO) {
            bytes = this.iwram;
            offset = a - REGION.IWRAM & 32767;
          } else if (a >= REGION.IO && a < REGION.IO + 1024) {
            bytes = this.io;
            offset = a - REGION.IO;
          } else if (a >= REGION.PAL && a < REGION.VRAM) {
            bytes = this.palette;
            offset = a - REGION.PAL & 1023;
          } else if (a >= REGION.VRAM && a < REGION.OAM) {
            bytes = this.vram;
            offset = a - REGION.VRAM & 131071;
            if (offset >= 98304) offset -= 32768;
          } else if (a >= REGION.OAM && a < REGION.ROM) {
            bytes = this.oam;
            offset = a - REGION.OAM & 1023;
          }
          if (bytes) return (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0;
          return (this.read16(a) | this.read16(a + 2) << 16) >>> 0;
        }
        write8(address, value) {
          const a = address >>> 0;
          const byte = value & 255;
          if (a >= 67109024 && a < 67109032) {
            this.pushAudioFifo(a < 67109028 ? 0 : 1, byte);
            return;
          }
          if (a >= 234881024 && a < 268435456) {
            this.writeFlash(a - 234881024 & 65535, byte);
            return;
          }
          if (a >= REGION.ROM) return;
          const videoWrite = (bytes, offset) => {
            if (bytes[offset] !== byte) {
              bytes[offset] = byte;
              this.videoRevision++;
            }
          };
          if (a >= REGION.EWRAM && a < REGION.IWRAM) this.ewram[a - REGION.EWRAM & 262143] = byte;
          else if (a >= REGION.IWRAM && a < REGION.IO) this.iwram[a - REGION.IWRAM & 32767] = byte;
          else if (a >= REGION.IO && a < REGION.IO + 1024) {
            const offset = a - REGION.IO;
            if (offset < 2 || offset >= 8 && offset < 86) videoWrite(this.io, offset);
            else this.io[offset] = byte;
          } else if (a >= REGION.PAL && a < REGION.VRAM) videoWrite(this.palette, a - REGION.PAL & 1023);
          else if (a >= REGION.VRAM && a < REGION.OAM) {
            let offset = a - REGION.VRAM & 131071;
            if (offset >= 98304) offset -= 32768;
            videoWrite(this.vram, offset);
          } else if (a >= REGION.OAM && a < REGION.ROM) videoWrite(this.oam, a - REGION.OAM & 1023);
        }
        writeFlash(offset, value) {
          if (this.flashState === 3) {
            this.sram[this.flashBank * 65536 + offset] &= value;
            this.flashState = 0;
            return;
          }
          if (this.flashState === 4) {
            if (offset === 0) this.flashBank = value & 1;
            this.flashState = 0;
            return;
          }
          if (value === 240) {
            this.flashState = 0;
            this.flashIdMode = false;
            return;
          }
          if (this.flashState === 5) {
            this.flashState = offset === 21845 && value === 170 ? 6 : 0;
            return;
          }
          if (this.flashState === 6) {
            this.flashState = offset === 10922 && value === 85 ? 7 : 0;
            return;
          }
          if (this.flashState === 7) {
            if (offset === 21845 && value === 16) this.sram.fill(255);
            else if (value === 48) {
              const start = this.flashBank * 65536 + (offset & ~4095);
              this.sram.fill(255, start, start + 4096);
            }
            this.flashState = 0;
            return;
          }
          if (this.flashState === 0) {
            if (offset === 21845 && value === 170) this.flashState = 1;
            return;
          }
          if (this.flashState === 1) {
            this.flashState = offset === 10922 && value === 85 ? 2 : 0;
            return;
          }
          if (this.flashState === 2) {
            this.flashState = 0;
            if (offset !== 21845) return;
            if (value === 144) this.flashIdMode = true;
            else if (value === 160) this.flashState = 3;
            else if (value === 176) this.flashState = 4;
            else if (value === 128) this.flashState = 5;
          }
        }
        write16(address, value) {
          const a = address & ~1;
          if (a === 67109378) {
            this.writeIo16(a, this.read16(a) & ~(value & 16383));
            return;
          }
          const timerData = a >= 67109120 && a <= 67109132 && (a - 67109120) % 4 === 0;
          const timerControl = a >= 67109122 && a <= 67109134 && (a - 67109122) % 4 === 0;
          const dmaControl = a >= 67109050 && a <= 67109086 && (a - 67109040) % 12 === 10;
          const oldControl = timerControl || dmaControl ? this.read16(a) : 0;
          this.write8(a, value);
          this.write8(a + 1, value >>> 8);
          if (timerData) this.timerReload[a - 67109120 >> 2] = value & 65535;
          if (timerControl && !(oldControl & 128) && value & 128) {
            const index = a - 67109122 >> 2;
            this.writeIo16(a - 2, this.timerReload[index]);
            this.timerRemainder[index] = 0;
          }
          if (a === 67108994) this.applySoundControl(value);
          if (dmaControl) this.updateDmaControl(Math.floor((a - 67109040) / 12), oldControl, value);
        }
        write32(address, value) {
          const a = address & ~3;
          const dmaControlWrite = a >= 67109048 && a <= 67109084 && (a - 67109048) % 12 === 0;
          const oldControl = dmaControlWrite ? this.read16(a + 2) : 0;
          this.write8(a, value);
          this.write8(a + 1, value >>> 8);
          this.write8(a + 2, value >>> 16);
          this.write8(a + 3, value >>> 24);
          if (a === 67108992) this.applySoundControl(value >>> 16);
          if (dmaControlWrite) this.updateDmaControl(Math.floor((a - 67109048) / 12), oldControl, value >>> 16);
        }
        tick(cycles) {
          this.scanlineCycles += cycles;
          while (this.scanlineCycles >= 1232) {
            this.scanlineCycles -= 1232;
            this.scanline = (this.scanline + 1) % 228;
            this.io[6] = this.scanline;
            const displayStatus = little16(this.io, 4) & ~3;
            const vblank = this.scanline >= 160;
            const hblank = 0;
            this.writeIo16(67108868, displayStatus | (vblank ? 1 : 0) | hblank);
            if (this.scanline === 160) for (let channel = 0; channel < 4; channel++) this.performDma(channel, 1);
            if (this.scanline === 160 && displayStatus & 8) this.writeIo16(67109378, this.read16(67109378) | 1);
          }
          for (let index = 0; index < 4; index++) {
            const control = little16(this.io, 258 + index * 4);
            if (!(control & 128) || index && control & 4) continue;
            const divider = [1, 64, 256, 1024][control & 3];
            const total = this.timerRemainder[index] + cycles;
            const ticks = Math.floor(total / divider);
            this.timerRemainder[index] = total % divider;
            if (ticks) this.incrementTimer(index, ticks);
          }
          this.generateAudio(cycles);
        }
        incrementTimer(index, ticks) {
          if (index > 3 || ticks <= 0) return;
          const address = 67109120 + index * 4;
          const ioOffset = 256 + index * 4;
          const control = little16(this.io, ioOffset + 2);
          if (!(control & 128)) return;
          let value = little16(this.io, ioOffset);
          let overflows = 0;
          while (ticks > 0) {
            const untilOverflow = 65536 - value;
            if (ticks < untilOverflow) {
              value += ticks;
              ticks = 0;
            } else {
              ticks -= untilOverflow;
              value = this.timerReload[index];
              overflows++;
            }
          }
          this.writeIo16(address, value);
          if (overflows) this.clockAudioFifos(index, overflows);
          if (overflows && control & 64) this.writeIo16(67109378, little16(this.io, 514) | 1 << 3 + index);
          if (overflows && index < 3 && (little16(this.io, ioOffset + 6) & 132) === 132) this.incrementTimer(index + 1, overflows);
        }
        writeIo16(address, value) {
          const offset = address - REGION.IO & 1022;
          this.io[offset] = value & 255;
          this.io[offset + 1] = value >>> 8 & 255;
        }
        pushAudioFifo(index, value) {
          const fifo = this.audioFifos[index];
          if (fifo.length >= 32) return;
          fifo.data[fifo.head + fifo.length & 31] = value << 24 >> 24;
          fifo.length++;
        }
        resetAudioFifo(index) {
          const fifo = this.audioFifos[index];
          fifo.head = 0;
          fifo.length = 0;
          this.directSound[index] = 0;
        }
        applySoundControl(value) {
          if (value & 2048) this.resetAudioFifo(0);
          if (value & 32768) this.resetAudioFifo(1);
          this.writeIo16(67108994, value & ~34816);
          this.serviceAudioDma(0);
          this.serviceAudioDma(1);
        }
        clockAudioFifos(timer2, overflows) {
          const control = little16(this.io, 130);
          for (let count = 0; count < overflows; count++) for (let index = 0; index < 2; index++) {
            const selectedTimer = index ? control >>> 14 & 1 : control >>> 10 & 1;
            if (selectedTimer !== timer2) continue;
            const fifo = this.audioFifos[index];
            if (fifo.length) {
              this.directSound[index] = fifo.data[fifo.head];
              fifo.head = fifo.head + 1 & 31;
              fifo.length--;
            } else this.directSound[index] = 0;
            if (fifo.length <= 16) this.serviceAudioDma(index);
          }
        }
        generateAudio(cycles) {
          const master = little16(this.io, 132) & 128;
          const control = little16(this.io, 130);
          if (!master || !(control & 13056)) {
            this.audioCycleRemainder = 0;
            return;
          }
          const total = this.audioCycleRemainder + cycles;
          const frames = Math.floor(total / 512);
          this.audioCycleRemainder = total % 512;
          if (!frames) return;
          const volumeA = control & 4 ? 1 : 0.5;
          const volumeB = control & 8 ? 1 : 0.5;
          let left = 0;
          let right = 0;
          if (control & 512) left += this.directSound[0] * volumeA;
          if (control & 256) right += this.directSound[0] * volumeA;
          if (control & 8192) left += this.directSound[1] * volumeB;
          if (control & 4096) right += this.directSound[1] * volumeB;
          const leftSample = Math.max(-32768, Math.min(32767, Math.round(left * 128)));
          const rightSample = Math.max(-32768, Math.min(32767, Math.round(right * 128)));
          for (let frame = 0; frame < frames && this.audioFrameCount < 32768; frame++) {
            const offset = this.audioFrameCount++ * 2;
            this.audioSamples[offset] = leftSample;
            this.audioSamples[offset + 1] = rightSample;
          }
        }
        takeAudio() {
          const samples = this.audioSamples.slice(0, this.audioFrameCount * 2);
          this.audioFrameCount = 0;
          return { sampleRate: 32768, samples };
        }
        updateDmaControl(channel, oldControl, newControl) {
          if (!(newControl & 32768)) {
            this.dmaEnabled[channel] = false;
            return;
          }
          if (!(oldControl & 32768)) {
            const base = 67109040 + channel * 12;
            this.dmaSource[channel] = this.read32(base);
            this.dmaDestination[channel] = this.read32(base + 4);
            this.dmaInitialDestination[channel] = this.dmaDestination[channel];
            this.dmaEnabled[channel] = true;
            const timing = newControl >>> 12 & 3;
            if (timing === 0) this.performDma(channel, 0);
            else if (timing === 3) {
              this.serviceAudioDma(0);
              this.serviceAudioDma(1);
            }
          }
        }
        serviceAudioDma(index) {
          const destination = index ? 67109028 : 67109024;
          for (let channel = 1; channel <= 2; channel++) {
            const base = 67109040 + channel * 12;
            const control = this.read16(base + 10);
            const configuredDestination = this.dmaEnabled[channel] ? this.dmaDestination[channel] : this.read32(base + 4);
            if ((control & 45056) === 45056 && (configuredDestination & ~3) === destination) this.performDma(channel, 3);
          }
        }
        performDma(channel, trigger = 0) {
          if (channel < 0 || channel > 3) return;
          const base = 67109040 + channel * 12;
          const source = this.read32(base);
          const destination = this.read32(base + 4);
          const control = this.read16(base + 10);
          const timing = control >>> 12 & 3;
          if (!(control & 32768) || timing !== trigger) return;
          if (!this.dmaEnabled[channel]) {
            this.dmaSource[channel] = source;
            this.dmaDestination[channel] = destination;
            this.dmaInitialDestination[channel] = destination;
            this.dmaEnabled[channel] = true;
          }
          const fifoTransfer = timing === 3 && channel < 3 && ((this.dmaDestination[channel] & ~3) === 67109024 || (this.dmaDestination[channel] & ~3) === 67109028);
          const max = channel === 3 ? 65536 : 16384;
          const count = fifoTransfer ? 4 : this.read16(base + 8) || max;
          const width = fifoTransfer ? 4 : control & 1024 ? 4 : 2;
          const sourceMode = control >>> 7 & 3;
          const destinationMode = fifoTransfer ? 2 : control >>> 5 & 3;
          let src = this.dmaSource[channel];
          let dst = this.dmaDestination[channel];
          for (let i = 0; i < count; i++) {
            if (width === 4) this.write32(dst, this.read32(src));
            else this.write16(dst, this.read16(src));
            if (sourceMode !== 2) src = src + (sourceMode === 1 ? -width : width) >>> 0;
            if (destinationMode !== 2) dst = dst + (destinationMode === 1 ? -width : width) >>> 0;
          }
          this.dmaSource[channel] = src;
          this.dmaDestination[channel] = destinationMode === 3 && control & 512 && timing !== 0 ? this.dmaInitialDestination[channel] : dst;
          if (control & 16384) this.writeIo16(67109378, little16(this.io, 514) | 1 << 8 + channel);
          if (!(control & 512) || timing === 0) {
            this.writeIo16(base + 10, control & 32767);
            this.dmaEnabled[channel] = false;
          }
        }
        setButtons(mask) {
          const activeLow = ~mask & 1023;
          this.io[304] = activeLow & 255;
          this.io[305] = activeLow >>> 8;
        }
        getSave() {
          return Uint8Array.from(this.sram);
        }
        pendingInterrupt() {
          return Boolean(little16(this.io, 520) & 1 && little16(this.io, 512) & little16(this.io, 514));
        }
        registerRamReset(mask) {
          if (mask & 1) this.ewram.fill(0);
          if (mask & 2) this.iwram.fill(0);
          if (mask & 4) {
            this.palette.fill(0);
            this.videoRevision++;
          }
          if (mask & 8) {
            this.vram.fill(0);
            this.videoRevision++;
          }
          if (mask & 16) {
            this.oam.fill(0);
            this.videoRevision++;
          }
          if (mask & 224) {
            const keys = this.read16(67109168);
            this.initializeIoDefaults();
            this.writeIo16(67109168, keys || 1023);
          }
        }
        readPalette(index) {
          return little16(this.palette, (index & 511) * 2);
        }
      };
      module.exports = { GbaMemory, REGION };
    }
  });

  // src/emulator/gba/cpu.js
  var require_cpu = __commonJS({
    "src/emulator/gba/cpu.js"(exports, module) {
      "use strict";
      var U32 = (value) => value >>> 0;
      var S32 = (value) => value | 0;
      var Arm7tdmi = class {
        constructor(memory) {
          this.memory = memory;
          this.r = new Uint32Array(16);
          this.cpsr = 31;
          this.cycles = 0;
          this.clockScale = 1;
          this.irqContext = null;
          this.irqReturn = 33554428;
          this.reset();
        }
        reset() {
          this.r.fill(0);
          this.r[13] = 50364160;
          this.r[14] = 0;
          this.r[15] = 134217728;
          this.cpsr = 31;
          this.cycles = 0;
        }
        get thumb() {
          return (this.cpsr & 32) !== 0;
        }
        set thumb(value) {
          this.cpsr = value ? this.cpsr | 32 : this.cpsr & ~32;
        }
        get n() {
          return this.cpsr >>> 31 & 1;
        }
        get z() {
          return this.cpsr >>> 30 & 1;
        }
        get c() {
          return this.cpsr >>> 29 & 1;
        }
        get v() {
          return this.cpsr >>> 28 & 1;
        }
        setFlags(n, z, c = this.c, v = this.v) {
          this.cpsr = this.cpsr & 268435455 | (n ? 2147483648 : 0) | (z ? 1073741824 : 0) | (c ? 536870912 : 0) | (v ? 268435456 : 0);
        }
        condition(cond) {
          switch (cond) {
            case 0:
              return this.z === 1;
            case 1:
              return this.z === 0;
            case 2:
              return this.c === 1;
            case 3:
              return this.c === 0;
            case 4:
              return this.n === 1;
            case 5:
              return this.n === 0;
            case 6:
              return this.v === 1;
            case 7:
              return this.v === 0;
            case 8:
              return this.c === 1 && this.z === 0;
            case 9:
              return this.c === 0 || this.z === 1;
            case 10:
              return this.n === this.v;
            case 11:
              return this.n !== this.v;
            case 12:
              return this.z === 0 && this.n === this.v;
            case 13:
              return this.z === 1 || this.n !== this.v;
            case 14:
              return true;
            default:
              return false;
          }
        }
        add(a, b, carry = 0, set = true) {
          const result = U32(a + b + carry);
          const unsignedCarry = (a >>> 0) + (b >>> 0) + carry > 4294967295;
          const overflow = (~(a ^ b) & (a ^ result)) >>> 31 !== 0;
          if (set) this.setFlags(result >>> 31, result === 0, unsignedCarry, overflow);
          return result;
        }
        sub(a, b, carry = 1, set = true) {
          const result = U32(a - b - (1 - carry));
          const noBorrow = a >>> 0 >= (b >>> 0) + (1 - carry);
          const overflow = ((a ^ b) & (a ^ result)) >>> 31 !== 0;
          if (set) this.setFlags(result >>> 31, result === 0, noBorrow, overflow);
          return result;
        }
        shift(value, type, amount, carryIn = this.c) {
          value >>>= 0;
          if (!amount) return { value, carry: carryIn };
          if (type === 0) {
            if (amount > 32) return { value: 0, carry: 0 };
            if (amount === 32) return { value: 0, carry: value & 1 };
            return { value: U32(value << amount), carry: value >>> 32 - amount & 1 };
          }
          if (type === 1) {
            if (amount > 32) return { value: 0, carry: 0 };
            if (amount === 32) return { value: 0, carry: value >>> 31 };
            return { value: value >>> amount, carry: value >>> amount - 1 & 1 };
          }
          if (type === 2) {
            if (amount >= 32) return { value: value >>> 31 ? 4294967295 : 0, carry: value >>> 31 };
            return { value: U32(S32(value) >> amount), carry: value >>> amount - 1 & 1 };
          }
          const rotate = amount & 31;
          if (!rotate) return { value, carry: value >>> 31 };
          return { value: U32(value >>> rotate | value << 32 - rotate), carry: value >>> rotate - 1 & 1 };
        }
        readWord(address) {
          const word = this.memory.read32(address);
          const rotate = (address & 3) << 3;
          return rotate ? U32(word >>> rotate | word << 32 - rotate) : word;
        }
        armOperand(instr) {
          if (instr & 33554432) {
            const imm = instr & 255;
            const rotate = (instr >>> 8 & 15) * 2;
            const value2 = rotate ? U32(imm >>> rotate | imm << 32 - rotate) : imm;
            return { value: value2, carry: rotate ? value2 >>> 31 : this.c };
          }
          const rm = instr & 15;
          const value = rm === 15 ? U32(this.r[rm] + 4) : this.r[rm];
          const type = instr >>> 5 & 3;
          let amount;
          if (instr & 16) amount = this.r[instr >>> 8 & 15] & 255;
          else {
            amount = instr >>> 7 & 31;
            if (!amount && type) {
              if (type === 3) return { value: U32(this.c << 31 | value >>> 1), carry: value & 1 };
              amount = 32;
            }
          }
          return this.shift(value, type, amount, this.c);
        }
        step() {
          if (this.irqContext && this.r[15] >>> 0 === this.irqReturn) {
            const context = this.irqContext;
            this.r.set(context.registers);
            this.cpsr = context.cpsr;
            this.irqContext = null;
          }
          if (!this.irqContext && !(this.cpsr & 128) && this.memory.pendingInterrupt()) this.enterInterrupt();
          if (this.thumb) return this.stepThumb();
          const pc = this.r[15] >>> 0;
          const instr = this.memory.read32(pc);
          this.r[15] = U32(pc + 4);
          const before = this.cycles;
          this.stepArmInstruction(instr >>> 0);
          this.memory.tick((this.cycles - before) * this.clockScale);
          return this.cycles;
        }
        enterInterrupt() {
          const handler = this.memory.read32(50364412) >>> 0;
          if (!handler) return;
          this.irqContext = { registers: Uint32Array.from(this.r), cpsr: this.cpsr };
          this.r[14] = this.irqReturn | handler & 1;
          this.r[15] = handler & ~1;
          this.thumb = Boolean(handler & 1);
          this.cpsr |= 128;
          this.cycles += 3;
        }
        stepArmInstruction(instr) {
          const cond = instr >>> 28;
          if (!this.condition(cond)) {
            this.cycles += 1;
            return;
          }
          if ((instr & 268435440) === 19922704) {
            const target = this.r[instr & 15] >>> 0;
            this.r[15] = target & ~1;
            this.thumb = Boolean(target & 1);
            this.cycles += 3;
            return;
          }
          if ((instr & 234881024) === 167772160) {
            let offset = (instr & 16777215) << 2;
            if (offset & 33554432) offset |= 4227858432;
            if (instr & 16777216) this.r[14] = this.r[15] >>> 0;
            this.r[15] = U32(this.r[15] + 4 + offset);
            this.cycles += 3;
            return;
          }
          if ((instr & 264179711) === 17760256) {
            this.r[instr >>> 12 & 15] = this.cpsr >>> 0;
            this.cycles++;
            return;
          }
          if ((instr & 229703664) === 18935808 || (instr & 229699584) === 52490240) {
            const immediate = Boolean(instr & 33554432);
            const value = immediate ? this.armOperand(instr).value : this.r[instr & 15];
            this.writePsr(value, instr >>> 16 & 15);
            this.cycles++;
            return;
          }
          if ((instr & 260047088) === 8388752) {
            const signed = Boolean(instr & 4194304);
            const accumulate = Boolean(instr & 2097152);
            const set = Boolean(instr & 1048576);
            const rdHi = instr >>> 16 & 15;
            const rdLo = instr >>> 12 & 15;
            const rm = instr & 15;
            const rs = instr >>> 8 & 15;
            let result = signed ? BigInt(S32(this.r[rm])) * BigInt(S32(this.r[rs])) : BigInt(this.r[rm]) * BigInt(this.r[rs]);
            if (accumulate) result += BigInt(this.r[rdHi]) << 32n | BigInt(this.r[rdLo]);
            result &= 0xffffffffffffffffn;
            this.r[rdLo] = Number(result & 0xffffffffn);
            this.r[rdHi] = Number(result >> 32n & 0xffffffffn);
            if (set) this.setFlags(this.r[rdHi] >>> 31, result === 0n);
            this.cycles += 3;
            return;
          }
          if ((instr & 263196656) === 16777360) {
            const byte = Boolean(instr & 4194304);
            const rn = instr >>> 16 & 15;
            const rd = instr >>> 12 & 15;
            const rm = instr & 15;
            const address = this.r[rn];
            const old = byte ? this.memory.read8(address) : this.readWord(address);
            if (byte) this.memory.write8(address, this.r[rm]);
            else this.memory.write32(address, this.r[rm]);
            this.r[rd] = old;
            this.cycles += 4;
            return;
          }
          if ((instr & 234881168) === 144 && (instr & 264241392) !== 144) {
            this.armHalfwordTransfer(instr);
            return;
          }
          if ((instr & 201326592) === 67108864) {
            this.armLoadStore(instr);
            return;
          }
          if ((instr & 234881024) === 134217728) {
            this.armBlockTransfer(instr);
            return;
          }
          if ((instr & 264241392) === 144) {
            const rd = instr >>> 16 & 15;
            const rn = instr >>> 12 & 15;
            const rm = instr & 15;
            const rs = instr >>> 8 & 15;
            this.r[rd] = U32(Math.imul(this.r[rm], this.r[rs]) + (instr & 2097152 ? this.r[rn] : 0));
            if (instr & 1048576) this.setFlags(this.r[rd] >>> 31, this.r[rd] === 0);
            this.cycles += 2;
            return;
          }
          if ((instr & 251658240) === 251658240) {
            this.handleSwi(instr & 255);
            return;
          }
          if ((instr & 201326592) === 0) {
            this.armDataProcessing(instr);
            return;
          }
          this.cycles += 1;
        }
        writePsr(value, fields) {
          let mask = 0;
          if (fields & 1) mask |= 255;
          if (fields & 2) mask |= 65280;
          if (fields & 4) mask |= 16711680;
          if (fields & 8) mask |= 4278190080;
          this.cpsr = U32(this.cpsr & ~mask | value & mask);
        }
        handleSwi(code) {
          switch (code) {
            case 0: {
              const elapsed = this.cycles;
              this.r.fill(0);
              this.r[13] = 50364160;
              this.r[15] = 134217728;
              this.cpsr = 31;
              this.cycles = elapsed + 4;
              return;
            }
            case 1: {
              this.memory.registerRamReset(this.r[0] & 255);
              this.cycles += 4;
              return;
            }
            case 6: {
              const numerator = S32(this.r[0]);
              const denominator = S32(this.r[1]);
              if (denominator) {
                const quotient = numerator / denominator | 0;
                this.r[0] = U32(quotient);
                this.r[1] = U32(numerator - quotient * denominator);
                this.r[3] = U32(Math.abs(quotient));
              }
              this.cycles += 4;
              return;
            }
            case 8: {
              this.r[0] = Math.floor(Math.sqrt(this.r[0] >>> 0)) >>> 0;
              this.cycles += 4;
              return;
            }
            case 9: {
              const tangent = (this.r[0] << 16 >> 16) / 16384;
              this.r[0] = Math.round(Math.atan(tangent) * 32768 / Math.PI) & 65535;
              this.cycles += 4;
              return;
            }
            case 10: {
              const x = this.r[0] << 16 >> 16;
              const y = this.r[1] << 16 >> 16;
              this.r[0] = Math.round(Math.atan2(y, x) * 32768 / Math.PI) & 65535;
              this.cycles += 4;
              return;
            }
            case 11: {
              const source = this.r[0] >>> 0;
              const destination = this.r[1] >>> 0;
              const count = this.r[2] & 2097151;
              const fill = Boolean(this.r[2] & 16777216);
              const wordMode = Boolean(this.r[2] & 67108864);
              const width = wordMode ? 4 : 2;
              const fixed = wordMode ? this.memory.read32(source) : this.memory.read16(source);
              for (let i = 0; i < count; i++) {
                const value = fill ? fixed : wordMode ? this.memory.read32(source + i * width) : this.memory.read16(source + i * width);
                if (wordMode) this.memory.write32(destination + i * width, value);
                else this.memory.write16(destination + i * width, value);
              }
              this.cycles += count;
              return;
            }
            case 12: {
              const source = this.r[0] >>> 0;
              const destination = this.r[1] >>> 0;
              const words = this.r[2] & 2097151 & ~7;
              const fill = Boolean(this.r[2] & 16777216);
              const fixed = this.memory.read32(source);
              for (let i = 0; i < words; i++) this.memory.write32(destination + i * 4, fill ? fixed : this.memory.read32(source + i * 4));
              this.cycles += words;
              return;
            }
            case 14:
              this.bgAffineSet(this.r[0] >>> 0, this.r[1] >>> 0, this.r[2] >>> 0);
              return;
            case 15:
              this.objAffineSet(this.r[0] >>> 0, this.r[1] >>> 0, this.r[2] >>> 0, this.r[3] >>> 0);
              return;
            case 16:
              this.bitUnpack(this.r[0] >>> 0, this.r[1] >>> 0, this.r[2] >>> 0);
              return;
            case 17:
            // LZ77UnCompWram
            case 18: {
              this.lz77Uncompress(this.r[0] >>> 0, this.r[1] >>> 0);
              return;
            }
            case 19:
              this.huffmanUncompress(this.r[0] >>> 0, this.r[1] >>> 0);
              return;
            case 20:
            // RLUnCompWram
            case 21:
              this.rlUncompress(this.r[0] >>> 0, this.r[1] >>> 0);
              return;
            case 22:
            // Diff8bitUnFilterWram
            case 23:
              this.diff8Unfilter(this.r[0] >>> 0, this.r[1] >>> 0);
              return;
            case 24:
              this.diff16Unfilter(this.r[0] >>> 0, this.r[1] >>> 0);
              return;
            case 5:
            // VBlankIntrWait
            case 4:
            // IntrWait
            case 2:
            // Halt
            case 3:
            // Stop
            default:
              this.cycles += 4;
              return;
          }
        }
        lz77Uncompress(source, destination) {
          const header = this.memory.read32(source);
          const length = header >>> 8;
          source = U32(source + 4);
          const output = new Uint8Array(length);
          let position = 0;
          while (position < length) {
            const flags = this.memory.read8(source++);
            for (let bit = 7; bit >= 0 && position < length; bit--) {
              if (!(flags & 1 << bit)) output[position++] = this.memory.read8(source++);
              else {
                const first = this.memory.read8(source++);
                const second = this.memory.read8(source++);
                const count = (first >>> 4) + 3;
                const distance = ((first & 15) << 8) + second + 1;
                for (let i = 0; i < count && position < length; i++) {
                  const from = position - distance;
                  output[position++] = from >= 0 ? output[from] : 0;
                }
              }
            }
          }
          for (let index = 0; index < output.length; index++) this.memory.write8(destination + index, output[index]);
          this.cycles += Math.max(4, output.length);
        }
        writeBiosOutput(destination, output) {
          for (let index = 0; index < output.length; index++) this.memory.write8(destination + index, output[index]);
          this.cycles += Math.max(4, output.length);
        }
        affineParameters(scaleX, scaleY, angle) {
          const radians = (angle >>> 8 & 255) * Math.PI * 2 / 256;
          const cosine = Math.cos(radians);
          const sine = Math.sin(radians);
          const sx = scaleX || 256;
          const sy = scaleY || 256;
          return { pa: Math.trunc(cosine * 65536 / sx), pb: Math.trunc(-sine * 65536 / sx), pc: Math.trunc(sine * 65536 / sy), pd: Math.trunc(cosine * 65536 / sy) };
        }
        bgAffineSet(source, destination, count) {
          for (let index = 0; index < count; index++, source += 20, destination += 16) {
            const texX = S32(this.memory.read32(source));
            const texY = S32(this.memory.read32(source + 4));
            const scrX = this.memory.read16(source + 8) << 16 >> 16;
            const scrY = this.memory.read16(source + 10) << 16 >> 16;
            const scaleX = this.memory.read16(source + 12);
            const scaleY = this.memory.read16(source + 14);
            const angle = this.memory.read16(source + 16);
            const { pa, pb, pc, pd } = this.affineParameters(scaleX, scaleY, angle);
            this.memory.write16(destination, pa);
            this.memory.write16(destination + 2, pb);
            this.memory.write16(destination + 4, pc);
            this.memory.write16(destination + 6, pd);
            this.memory.write32(destination + 8, U32(texX - pa * scrX - pb * scrY));
            this.memory.write32(destination + 12, U32(texY - pc * scrX - pd * scrY));
          }
          this.cycles += Math.max(4, count * 8);
        }
        objAffineSet(source, destination, count, offset) {
          for (let index = 0; index < count; index++, source += 8, destination += offset * 4) {
            const scaleX = this.memory.read16(source);
            const scaleY = this.memory.read16(source + 2);
            const angle = this.memory.read16(source + 4);
            const { pa, pb, pc, pd } = this.affineParameters(scaleX, scaleY, angle);
            this.memory.write16(destination, pa);
            this.memory.write16(destination + offset, pb);
            this.memory.write16(destination + offset * 2, pc);
            this.memory.write16(destination + offset * 3, pd);
          }
          this.cycles += Math.max(4, count * 4);
        }
        bitUnpack(source, destination, info) {
          const sourceLength = this.memory.read16(info);
          const sourceWidth = this.memory.read8(info + 2);
          const destinationWidth = this.memory.read8(info + 3);
          const offsetControl = this.memory.read32(info + 4);
          const addZero = Boolean(offsetControl & 2147483648);
          const offset = offsetControl & 2147483647;
          const sourceMask = (1 << sourceWidth) - 1;
          let outputWord = 0;
          let outputBits = 0;
          for (let byteIndex = 0; byteIndex < sourceLength; byteIndex++) {
            const packed = this.memory.read8(source + byteIndex);
            for (let bit = 0; bit < 8; bit += sourceWidth) {
              let value = packed >>> bit & sourceMask;
              if (value || addZero) value = U32(value + offset);
              if (destinationWidth === 32) {
                this.memory.write32(destination, value);
                destination += 4;
              } else {
                outputWord = U32(outputWord | value << outputBits);
                outputBits += destinationWidth;
                if (outputBits >= 32) {
                  this.memory.write32(destination, outputWord);
                  destination += 4;
                  outputWord = 0;
                  outputBits = 0;
                }
              }
            }
          }
          if (outputBits) this.memory.write32(destination, outputWord);
          this.cycles += Math.max(4, sourceLength);
        }
        rlUncompress(source, destination) {
          const length = this.memory.read32(source) >>> 8;
          source = U32(source + 4);
          const output = new Uint8Array(length);
          let position = 0;
          while (position < length) {
            const control = this.memory.read8(source++);
            const compressed = Boolean(control & 128);
            const count = (control & 127) + (compressed ? 3 : 1);
            if (compressed) {
              const value = this.memory.read8(source++);
              for (let i = 0; i < count && position < length; i++) output[position++] = value;
            } else for (let i = 0; i < count && position < length; i++) output[position++] = this.memory.read8(source++);
          }
          this.writeBiosOutput(destination, output);
        }
        diff8Unfilter(source, destination) {
          const length = this.memory.read32(source) >>> 8;
          source = U32(source + 4);
          const output = new Uint8Array(length);
          if (length) output[0] = this.memory.read8(source++);
          for (let index = 1; index < length; index++) output[index] = output[index - 1] + this.memory.read8(source++) & 255;
          this.writeBiosOutput(destination, output);
        }
        diff16Unfilter(source, destination) {
          const length = this.memory.read32(source) >>> 8;
          source = U32(source + 4);
          const output = new Uint8Array(length);
          let previous = this.memory.read16(source);
          source += 2;
          if (length >= 2) {
            output[0] = previous;
            output[1] = previous >>> 8;
          }
          for (let index = 2; index + 1 < length; index += 2) {
            previous = previous + this.memory.read16(source) & 65535;
            source += 2;
            output[index] = previous;
            output[index + 1] = previous >>> 8;
          }
          this.writeBiosOutput(destination, output);
        }
        huffmanUncompress(source, destination) {
          const header = this.memory.read32(source);
          const length = header >>> 8;
          const bitsPerSymbol = header & 15;
          const treeSize = this.memory.read8(source + 4);
          const tree = U32(source + 5);
          let stream = U32(tree + (treeSize + 1) * 2 + 3 & ~3);
          const symbols = [];
          let word = 0;
          let bitsLeft = 0;
          while (symbols.length * bitsPerSymbol < length * 8) {
            let nodeAddress = tree;
            while (true) {
              const node = this.memory.read8(nodeAddress);
              if (!bitsLeft) {
                word = this.memory.read32(stream);
                stream += 4;
                bitsLeft = 32;
              }
              const right = Boolean(word & 2147483648);
              word = U32(word << 1);
              bitsLeft--;
              const child = nodeAddress + ((node & 63) + 1) * 2 + (right ? 1 : 0);
              const leaf = node & (right ? 128 : 64);
              if (leaf) {
                symbols.push(this.memory.read8(child));
                break;
              }
              nodeAddress = child;
            }
          }
          const output = new Uint8Array(length);
          if (bitsPerSymbol === 4) for (let index = 0; index < symbols.length && index >> 1 < length; index++) output[index >> 1] |= (symbols[index] & 15) << (index & 1) * 4;
          else for (let index = 0; index < length; index++) output[index] = symbols[index] || 0;
          this.writeBiosOutput(destination, output);
        }
        armLoadStore(instr) {
          const i = instr >>> 25 & 1;
          const p = instr >>> 24 & 1;
          const u = instr >>> 23 & 1;
          const b = instr >>> 22 & 1;
          const w = instr >>> 21 & 1;
          const l = instr >>> 20 & 1;
          const rn = instr >>> 16 & 15;
          const rd = instr >>> 12 & 15;
          const base = rn === 15 ? U32(this.r[rn] + 4) : this.r[rn];
          const offset = i ? this.shift(this.r[instr & 15], instr >>> 5 & 3, instr >>> 7 & 31).value : instr & 4095;
          const adjusted = u ? U32(base + offset) : U32(base - offset);
          const address = p ? adjusted : base;
          if (l) this.r[rd] = b ? this.memory.read8(address) : this.readWord(address);
          else if (b) this.memory.write8(address, this.r[rd]);
          else this.memory.write32(address, this.r[rd]);
          if (!p || w) this.r[rn] = adjusted;
          this.cycles += l ? 3 : 2;
        }
        armHalfwordTransfer(instr) {
          const p = instr >>> 24 & 1;
          const u = instr >>> 23 & 1;
          const i = instr >>> 22 & 1;
          const w = instr >>> 21 & 1;
          const l = instr >>> 20 & 1;
          const rn = instr >>> 16 & 15;
          const rd = instr >>> 12 & 15;
          const kind = instr >>> 5 & 3;
          const base = rn === 15 ? U32(this.r[rn] + 4) : this.r[rn];
          const immediate = instr >>> 4 & 240 | instr & 15;
          const offset = i ? immediate : this.r[instr & 15];
          const adjusted = u ? U32(base + offset) : U32(base - offset);
          const address = p ? adjusted : base;
          if (l) {
            if (kind === 1) this.r[rd] = this.memory.read16(address);
            else if (kind === 2) this.r[rd] = this.memory.read8(address) << 24 >> 24;
            else this.r[rd] = this.memory.read16(address) << 16 >> 16;
          } else this.memory.write16(address, this.r[rd]);
          if (!p || w) this.r[rn] = adjusted;
          this.cycles += 3;
        }
        armBlockTransfer(instr) {
          const l = instr >>> 20 & 1;
          const w = instr >>> 21 & 1;
          const u = instr >>> 23 & 1;
          const p = instr >>> 24 & 1;
          const rn = instr >>> 16 & 15;
          const base = this.r[rn] >>> 0;
          let address;
          const regs = [];
          for (let i = 0; i < 16; i++) if (instr & 1 << i) regs.push(i);
          let step = 4;
          if (u) address = U32(base + (p ? 4 : 0));
          else if (p) address = U32(base - regs.length * 4), step = 4;
          else address = U32(base - Math.max(0, regs.length - 1) * 4), step = 4;
          for (const reg of regs) {
            if (l) this.r[reg] = this.memory.read32(address);
            else this.memory.write32(address, this.r[reg]);
            address = U32(address + step);
          }
          if (w) this.r[rn] = u ? U32(base + regs.length * 4) : U32(base - regs.length * 4);
          this.cycles += 1 + regs.length;
        }
        armDataProcessing(instr) {
          const opcode = instr >>> 21 & 15;
          const set = instr >>> 20 & 1;
          const rn = instr >>> 16 & 15;
          const rd = instr >>> 12 & 15;
          const shifted = this.armOperand(instr);
          const operand = shifted.value;
          const a = rn === 15 ? U32(this.r[rn] + 4) : this.r[rn];
          let result = 0;
          switch (opcode) {
            case 0:
              result = a & operand;
              break;
            case 1:
              result = a ^ operand;
              break;
            case 2:
              result = this.sub(a, operand, 1, set);
              break;
            case 3:
              result = this.sub(operand, a, 1, set);
              break;
            case 4:
              result = this.add(a, operand, 0, set);
              break;
            case 5:
              result = this.add(a, operand, this.c, set);
              break;
            case 6:
              result = this.sub(a, operand, this.c, set);
              break;
            case 7:
              result = this.sub(operand, a, this.c, set);
              break;
            case 8:
              result = a & operand;
              this.setFlags(result >>> 31, result === 0, shifted.carry);
              break;
            case 9:
              result = a ^ operand;
              this.setFlags(result >>> 31, result === 0, shifted.carry);
              break;
            case 10:
              this.sub(a, operand, 1, true);
              break;
            case 11:
              this.add(a, operand, 0, true);
              break;
            case 12:
              result = a | operand;
              break;
            case 13:
              result = operand;
              break;
            case 14:
              result = a & ~operand;
              break;
            case 15:
              result = ~operand;
              break;
            default:
              return;
          }
          if (opcode < 8 || opcode === 12 || opcode === 13 || opcode === 14 || opcode === 15) {
            if (set) {
              const logical = opcode === 0 || opcode === 1 || opcode >= 12;
              this.setFlags(result >>> 31, result === 0, logical ? shifted.carry : this.c, this.v);
            }
            if (![8, 9, 10, 11].includes(opcode)) this.r[rd] = U32(result);
          }
          this.cycles += 1;
        }
        stepThumb() {
          const pc = this.r[15] >>> 0;
          const instr = this.memory.read16(pc);
          this.r[15] = U32(pc + 2);
          const before = this.cycles;
          this.stepThumbInstruction(instr);
          this.memory.tick((this.cycles - before) * this.clockScale);
          return this.cycles;
        }
        stepThumbInstruction(instr) {
          const op = instr >>> 11;
          if ((instr & 65280) === 57088) {
            this.handleSwi(instr & 255);
            return;
          }
          if ((instr & 63488) === 6144) {
            const sub = instr >>> 9 & 1;
            const immediate = instr >>> 10 & 1;
            const rn = instr >>> 3 & 7;
            const rd = instr & 7;
            const value = immediate ? instr >>> 6 & 7 : this.r[instr >>> 6 & 7];
            this.r[rd] = sub ? this.sub(this.r[rn], value) : this.add(this.r[rn], value);
            this.cycles++;
            return;
          }
          if ((instr & 57344) === 0) {
            const type = instr >>> 11 & 3;
            let amount = instr >>> 6 & 31;
            if (!amount && type) amount = 32;
            const rs = instr >>> 3 & 7;
            const rd = instr & 7;
            const out = this.shift(this.r[rs], type, amount);
            this.r[rd] = out.value;
            this.setFlags(out.value >>> 31, out.value === 0, out.carry);
            this.cycles++;
            return;
          }
          if ((instr & 57344) === 8192) {
            const opcode = instr >>> 11 & 3;
            const rd = instr >>> 8 & 7;
            const value = instr & 255;
            if (opcode === 0) this.r[rd] = value;
            else if (opcode === 1) this.sub(this.r[rd], value);
            else if (opcode === 2) this.r[rd] = this.add(this.r[rd], value);
            else this.r[rd] = this.sub(this.r[rd], value);
            this.cycles++;
            return;
          }
          if ((instr & 64512) === 16384) {
            const opcode = instr >>> 6 & 15;
            const rd = instr & 7;
            const rs = instr >>> 3 & 7;
            const a = this.r[rd];
            const b = this.r[rs];
            let out;
            let shifted;
            switch (opcode) {
              case 0:
                out = a & b;
                break;
              case 1:
                out = a ^ b;
                break;
              case 2:
                shifted = this.shift(a, 0, b & 255);
                out = shifted.value;
                break;
              case 3:
                shifted = this.shift(a, 1, b & 255);
                out = shifted.value;
                break;
              case 4:
                shifted = this.shift(a, 2, b & 255);
                out = shifted.value;
                break;
              case 5:
                this.r[rd] = this.add(a, b, this.c);
                this.cycles++;
                return;
              case 6:
                this.r[rd] = this.sub(a, b, this.c);
                this.cycles++;
                return;
              case 7:
                shifted = this.shift(a, 3, b & 255);
                out = shifted.value;
                break;
              case 8:
                out = a & b;
                this.setFlags(out >>> 31, out === 0);
                this.cycles++;
                return;
              case 9:
                this.r[rd] = this.sub(0, b);
                this.cycles++;
                return;
              case 10:
                this.sub(a, b);
                this.cycles++;
                return;
              case 11:
                this.add(a, b);
                this.cycles++;
                return;
              case 12:
                out = a | b;
                break;
              case 13:
                out = U32(a * b);
                break;
              case 14:
                out = a & ~b;
                break;
              case 15:
                out = ~b;
                break;
            }
            this.r[rd] = U32(out);
            this.setFlags(out >>> 31, out === 0, shifted ? shifted.carry : this.c);
            this.cycles++;
            return;
          }
          if ((instr & 64512) === 17408) {
            const opcode = instr >>> 8 & 3;
            const rd = instr & 7 | instr >>> 4 & 8;
            const rs = instr >>> 3 & 15;
            if (opcode === 0) this.r[rd] = this.add(this.r[rd], this.r[rs]);
            else if (opcode === 1) this.sub(this.r[rd], this.r[rs]);
            else if (opcode === 2) this.r[rd] = this.r[rs];
            else {
              const target = this.r[rs] >>> 0;
              this.r[15] = target & ~1;
              this.thumb = Boolean(target & 1);
            }
            this.cycles += 2;
            return;
          }
          if ((instr & 63488) === 18432) {
            const rd = instr >>> 8 & 7;
            const address = (this.r[15] + 2 & ~3) + ((instr & 255) << 2) >>> 0;
            this.r[rd] = this.readWord(address);
            this.cycles += 2;
            return;
          }
          if ((instr & 61440) === 20480 || (instr & 57344) === 24576 || (instr & 61440) === 32768 || (instr & 61440) === 36864) {
            this.thumbLoadStore(instr);
            return;
          }
          if ((instr & 61440) === 40960) {
            const rd = instr >>> 8 & 7;
            const base = instr & 2048 ? this.r[13] : U32(this.r[15] + 2 & ~3);
            this.r[rd] = U32(base + ((instr & 255) << 2));
            this.cycles++;
            return;
          }
          if ((instr & 65280) === 45056) {
            const amount = (instr & 127) << 2;
            this.r[13] = instr & 128 ? U32(this.r[13] - amount) : U32(this.r[13] + amount);
            this.cycles++;
            return;
          }
          if ((instr & 62976) === 46080) {
            const pop = instr & 2048;
            const include = instr & 256;
            let sp = this.r[13];
            if (!pop) {
              let count = include ? 1 : 0;
              for (let i = 0; i < 8; i++) if (instr & 1 << i) count++;
              sp = U32(sp - count * 4);
              let address = sp;
              for (let i = 0; i < 8; i++) if (instr & 1 << i) {
                this.memory.write32(address, this.r[i]);
                address += 4;
              }
              if (include) this.memory.write32(address, this.r[14]);
            } else {
              for (let i = 0; i < 8; i++) if (instr & 1 << i) {
                this.r[i] = this.memory.read32(sp);
                sp += 4;
              }
              if (include) {
                const target = this.memory.read32(sp);
                this.r[15] = target & ~1;
                this.thumb = Boolean(target & 1);
                sp += 4;
              }
            }
            this.r[13] = sp;
            this.cycles += 2;
            return;
          }
          if ((instr & 61440) === 49152) {
            const load = Boolean(instr & 2048);
            const rb = instr >>> 8 & 7;
            const list = instr & 255;
            let address = this.r[rb] >>> 0;
            let count = 0;
            for (let i = 0; i < 8; i++) if (list & 1 << i) {
              if (load) this.r[i] = this.memory.read32(address);
              else this.memory.write32(address, this.r[i]);
              address = U32(address + 4);
              count++;
            }
            if (count) this.r[rb] = address;
            this.cycles += 1 + count;
            return;
          }
          if ((instr & 61440) === 53248) {
            const cond = instr >>> 8 & 15;
            let offset = (instr & 255) << 1;
            if (offset & 256) offset |= 4294966784;
            if (cond !== 15 && this.condition(cond)) this.r[15] = U32(this.r[15] + 2 + offset);
            this.cycles += 2;
            return;
          }
          if ((instr & 63488) === 57344) {
            let offset = (instr & 2047) << 1;
            if (offset & 2048) offset |= 4294963200;
            this.r[15] = U32(this.r[15] + 2 + offset);
            this.cycles += 2;
            return;
          }
          if ((instr & 63488) === 61440) {
            let offset = (instr & 2047) << 12;
            if (offset & 4194304) offset |= 4286578688;
            this.r[14] = U32(this.r[15] + 2 + offset);
            this.cycles += 1;
            return;
          }
          if ((instr & 63488) === 63488) {
            const offset = (instr & 2047) << 1;
            const target = U32(this.r[14] + offset);
            this.r[14] = U32(this.r[15] | 1);
            this.r[15] = target;
            this.cycles += 3;
            return;
          }
          this.cycles++;
        }
        thumbLoadStore(instr) {
          const rd = instr & 7;
          if ((instr & 61440) === 20480) {
            const op = instr >>> 9 & 7;
            const rb2 = instr >>> 3 & 7;
            const ro = instr >>> 6 & 7;
            const address2 = U32(this.r[rb2] + this.r[ro]);
            if (op === 0) this.memory.write32(address2, this.r[rd]);
            else if (op === 1) this.memory.write16(address2, this.r[rd]);
            else if (op === 2) this.memory.write8(address2, this.r[rd]);
            else if (op === 3) this.r[rd] = U32(this.memory.read8(address2) << 24 >> 24);
            else if (op === 4) this.r[rd] = this.readWord(address2);
            else if (op === 5) this.r[rd] = this.memory.read16(address2);
            else if (op === 6) this.r[rd] = this.memory.read8(address2);
            else this.r[rd] = U32(this.memory.read16(address2) << 16 >> 16);
            this.cycles += 2;
            return;
          }
          if ((instr & 61440) === 36864) {
            const load2 = Boolean(instr & 2048);
            const spRd = instr >>> 8 & 7;
            const address2 = U32(this.r[13] + ((instr & 255) << 2));
            if (load2) this.r[spRd] = this.readWord(address2);
            else this.memory.write32(address2, this.r[spRd]);
            this.cycles += 2;
            return;
          }
          if ((instr & 61440) === 32768) {
            const load2 = Boolean(instr & 2048);
            const rb2 = instr >>> 3 & 7;
            const address2 = U32(this.r[rb2] + ((instr >>> 6 & 31) << 1));
            if (load2) this.r[rd] = this.memory.read16(address2);
            else this.memory.write16(address2, this.r[rd]);
            this.cycles += 2;
            return;
          }
          const load = Boolean(instr & 2048);
          const byte = Boolean(instr & 4096);
          const rb = instr >>> 3 & 7;
          const offset = (instr >>> 6 & 31) << (byte ? 0 : 2);
          const address = U32(this.r[rb] + offset);
          if (load) this.r[rd] = byte ? this.memory.read8(address) : this.readWord(address);
          else if (byte) this.memory.write8(address, this.r[rd]);
          else this.memory.write32(address, this.r[rd]);
          this.cycles += 2;
        }
      };
      module.exports = { Arm7tdmi };
    }
  });

  // src/emulator/gba/ppu.js
  var require_ppu = __commonJS({
    "src/emulator/gba/ppu.js"(exports, module) {
      "use strict";
      var GbaPpu = class {
        constructor(memory) {
          this.memory = memory;
          this.width = 240;
          this.height = 160;
          this.frame = new Uint32Array(this.width * this.height);
          this.lastVideoRevision = -1;
          this.windowMaskCache = null;
          this.colorLut = new Uint32Array(32768);
          for (let color = 0; color < this.colorLut.length; color++) {
            const r = (color & 31) * 255 / 31;
            const g = (color >>> 5 & 31) * 255 / 31;
            const b = (color >>> 10 & 31) * 255 / 31;
            this.colorLut[color] = 255 << 24 | b << 16 | g << 8 | r;
          }
        }
        color15(value) {
          return this.colorLut[value & 32767];
        }
        render() {
          if (this.lastVideoRevision === this.memory.videoRevision) return this.frame;
          this.lastVideoRevision = this.memory.videoRevision;
          const displayControl = this.memory.read16(67108864);
          const mode = displayControl & 7;
          if (displayControl & 128) {
            this.frame.fill(this.color15(32767));
            return this.frame;
          }
          if (mode === 3) return this.renderMode3();
          if (mode === 4) return this.renderMode4();
          if (mode === 5) return this.renderMode5();
          return this.renderMode0(mode);
        }
        renderMode3() {
          for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) this.frame[y * 240 + x] = this.color15(this.memory.read16(100663296 + (y * 240 + x << 1)));
          return this.frame;
        }
        renderMode4() {
          const page = this.memory.read16(67108864) & 16 ? 40960 : 0;
          for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) this.frame[y * 240 + x] = this.color15(this.memory.readPalette(this.memory.read8(100663296 + page + y * 240 + x)));
          return this.frame;
        }
        renderMode5() {
          const page = this.memory.read16(67108864) & 16 ? 40960 : 0;
          const backdrop = this.color15(this.memory.readPalette(0));
          this.frame.fill(backdrop);
          for (let y = 0; y < 128; y++) for (let x = 0; x < 160; x++) this.frame[y * 240 + x] = this.color15(this.memory.read16(100663296 + page + (y * 160 + x << 1)));
          return this.frame;
        }
        renderMode0(mode = 0) {
          const memory = this.memory;
          const io = memory.io;
          const vram = memory.vram;
          const palette = memory.palette;
          const read16 = (bytes, offset) => bytes[offset] | bytes[offset + 1] << 8;
          const read32 = (bytes, offset) => (read16(bytes, offset) | read16(bytes, offset + 2) << 16) >>> 0;
          const displayControl = read16(io, 0);
          const spriteLines = displayControl & 36864 ? this.buildSpriteLines() : null;
          const bg = [];
          const scrollX = [];
          const scrollY = [];
          for (let n = 0; n < 4; n++) {
            bg.push(read16(io, 8 + n * 2));
            scrollX.push(read16(io, 16 + n * 4));
            scrollY.push(read16(io, 18 + n * 4));
          }
          let windowMasks = null;
          const windowEnabled = displayControl & 57344;
          if (windowEnabled) {
            const inside = (coordinate, packed) => {
              const start = packed >>> 8;
              const end = packed & 255;
              return start <= end ? coordinate >= start && coordinate < end : coordinate >= start || coordinate < end;
            };
            const win0X = read16(io, 64);
            const win1X = read16(io, 66);
            const win0Y = read16(io, 68);
            const win1Y = read16(io, 70);
            const winIn0 = io[72] & 63;
            const winIn1 = io[73] & 63;
            const winOut = io[74] & 63;
            const objOut = io[75] & 63;
            const cacheKey = `${displayControl & 57344}:${win0X}:${win1X}:${win0Y}:${win1Y}:${winIn0}:${winIn1}:${winOut}:${objOut}`;
            if (!(displayControl & 32768) && this.windowMaskCache?.key === cacheKey) windowMasks = this.windowMaskCache.masks;
            else {
              windowMasks = new Uint8Array(240 * 160);
              for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) {
                let mask = winOut;
                if (displayControl & 8192 && inside(x, win0X) && inside(y, win0Y)) mask = winIn0;
                else if (displayControl & 16384 && inside(x, win1X) && inside(y, win1Y)) mask = winIn1;
                else if (displayControl & 32768 && spriteLines && this.spritePixel(x, y, 4, spriteLines.window[y], Boolean(displayControl & 64)) >= 0) mask = objOut;
                windowMasks[y * 240 + x] = mask;
              }
              if (!(displayControl & 32768)) this.windowMaskCache = { key: cacheKey, masks: windowMasks };
            }
          }
          const dimensions = [[256, 256], [512, 256], [256, 512], [512, 512]];
          const bgInfo = bg.map((control, n) => {
            const dim = dimensions[control >>> 14 & 3];
            return { control, priority: control & 3, width: dim[0], height: dim[1], mapBase: (control >>> 8 & 31) * 2048, charBase: (control >>> 2 & 3) * 16384, color8: Boolean(control & 128), scrollX: scrollX[n], scrollY: scrollY[n] };
          });
          const signed16 = (value) => value << 16 >> 16;
          const signed28 = (value) => value << 4 >> 4;
          const affine = {};
          for (let n = 2; n < 4; n++) {
            const register = n === 2 ? 32 : 48;
            affine[n] = { pa: signed16(read16(io, register)), pb: signed16(read16(io, register + 2)), pc: signed16(read16(io, register + 4)), pd: signed16(read16(io, register + 6)), x: signed28(read32(io, register + 8)), y: signed28(read32(io, register + 12)) };
          }
          const bgPixel = (n, x, y) => {
            const info = bgInfo[n];
            const worldX = x + info.scrollX & info.width - 1;
            const worldY = y + info.scrollY & info.height - 1;
            const tileX = worldX >>> 3;
            const tileY = worldY >>> 3;
            const screenBlock = (tileX >>> 5) + (tileY >>> 5) * (info.width >>> 8);
            const mapOffset = info.mapBase + screenBlock * 2048 + ((tileY & 31) * 32 + (tileX & 31)) * 2;
            const entry = read16(vram, mapOffset);
            const tile = entry & 1023;
            const px = entry & 1024 ? 7 - (worldX & 7) : worldX & 7;
            const py = entry & 2048 ? 7 - (worldY & 7) : worldY & 7;
            let paletteIndex;
            if (info.color8) {
              paletteIndex = vram[info.charBase + tile * 64 + py * 8 + px];
              if (!paletteIndex) return -1;
            } else {
              const packed = vram[info.charBase + tile * 32 + py * 4 + (px >>> 1)];
              const nibble = px & 1 ? packed >>> 4 : packed & 15;
              if (!nibble) return -1;
              paletteIndex = nibble + (entry >>> 12 & 15) * 16;
            }
            return read16(palette, paletteIndex * 2);
          };
          const affinePixel = (n, x, y) => {
            const control = bg[n];
            const matrix = affine[n];
            const size = 128 << (control >>> 14 & 3);
            let worldX = matrix.x + matrix.pa * x + matrix.pb * y >> 8;
            let worldY = matrix.y + matrix.pc * x + matrix.pd * y >> 8;
            if (control & 8192) {
              worldX = (worldX % size + size) % size;
              worldY = (worldY % size + size) % size;
            } else if (worldX < 0 || worldY < 0 || worldX >= size || worldY >= size) return -1;
            const mapBase = (control >>> 8 & 31) * 2048;
            const charBase = (control >>> 2 & 3) * 16384;
            const tile = vram[mapBase + (worldY >>> 3) * (size >>> 3) + (worldX >>> 3)];
            const paletteIndex = vram[charBase + tile * 64 + (worldY & 7) * 8 + (worldX & 7)];
            return paletteIndex ? read16(palette, paletteIndex * 2) : -1;
          };
          const blendControl = read16(io, 80);
          const effect = blendControl >>> 6 & 3;
          const amount = Math.min(16, read16(io, 84) & 31);
          const applyBrightness = (color, layer) => {
            if (!(blendControl & 1 << layer) || effect < 2) return color;
            let red = color & 31;
            let green = color >>> 5 & 31;
            let blue = color >>> 10 & 31;
            if (effect === 2) {
              red += (31 - red) * amount >> 4;
              green += (31 - green) * amount >> 4;
              blue += (31 - blue) * amount >> 4;
            } else {
              red -= red * amount >> 4;
              green -= green * amount >> 4;
              blue -= blue * amount >> 4;
            }
            return red | green << 5 | blue << 10;
          };
          const backdrop = read16(palette, 0);
          const lut = this.colorLut;
          const oneDimensional = Boolean(displayControl & 64);
          const alpha = read16(io, 82);
          const eva = Math.min(16, alpha & 31);
          const evb = Math.min(16, alpha >>> 8 & 31);
          const blend = (first, second) => {
            const red = Math.min(31, (first & 31) * eva + (second & 31) * evb >> 4);
            const green = Math.min(31, (first >>> 5 & 31) * eva + (second >>> 5 & 31) * evb >> 4);
            const blue = Math.min(31, (first >>> 10 & 31) * eva + (second >>> 10 & 31) * evb >> 4);
            return red | green << 5 | blue << 10;
          };
          const before = (priority, rank, otherPriority, otherRank) => priority < otherPriority || priority === otherPriority && rank < otherRank;
          for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) {
            const offset = y * 240 + x;
            const windowMask = windowMasks ? windowMasks[offset] : 63;
            let topColor = backdrop;
            let topLayer = 5;
            let topPriority = 4;
            let topRank = 6;
            let secondColor = 0;
            let secondLayer = -1;
            let secondPriority = 5;
            let secondRank = 7;
            const insert = (color2, layer, priority, rank) => {
              if (before(priority, rank, topPriority, topRank)) {
                secondColor = topColor;
                secondLayer = topLayer;
                secondPriority = topPriority;
                secondRank = topRank;
                topColor = color2;
                topLayer = layer;
                topPriority = priority;
                topRank = rank;
              } else if (before(priority, rank, secondPriority, secondRank)) {
                secondColor = color2;
                secondLayer = layer;
                secondPriority = priority;
                secondRank = rank;
              }
            };
            for (let n = 0; n < 4; n++) {
              if (!(displayControl & 256 << n) || !(windowMask & 1 << n) || mode === 1 && n === 3 || mode === 2 && n < 2) continue;
              const isAffine = mode === 1 && n === 2 || mode === 2 && n >= 2;
              const pixel = isAffine ? affinePixel(n, x, y) : bgPixel(n, x, y);
              if (pixel >= 0) insert(pixel, n, bgInfo[n].priority, n + 1);
            }
            let semiTransparentObject = false;
            const visibleSprites = spriteLines?.visible[y];
            if (visibleSprites?.length && windowMask & 16) {
              const sprite = this.spriteSample(x, y, 4, visibleSprites, oneDimensional);
              if (sprite >= 0) {
                const priority = sprite >>> 15 & 3;
                const objectMode = sprite >>> 17 & 3;
                insert(sprite & 32767, 4, priority, 0);
                semiTransparentObject = topLayer === 4 && objectMode === 1;
              }
            }
            let color = topColor;
            const effectsEnabled = Boolean(windowMask & 32);
            const secondTarget = secondLayer >= 0 && Boolean(blendControl & 1 << 8 + secondLayer);
            if (effectsEnabled && secondTarget && (semiTransparentObject || effect === 1 && blendControl & 1 << topLayer)) color = blend(topColor, secondColor);
            else if (effectsEnabled && effect >= 2) color = applyBrightness(topColor, topLayer);
            this.frame[offset] = lut[color & 32767];
          }
          return this.frame;
        }
        bgPixel(index, control, x, y) {
          const dimensions = [[256, 256], [512, 256], [256, 512], [512, 512]][control >>> 14 & 3];
          const scrollX = this.memory.read16(67108880 + index * 4);
          const scrollY = this.memory.read16(67108882 + index * 4);
          const worldX = (x + scrollX) % dimensions[0];
          const worldY = (y + scrollY) % dimensions[1];
          const mapBase = (control >>> 8 & 31) * 2048;
          const charBase = (control >>> 2 & 3) * 16384;
          const color8 = Boolean(control & 128);
          const tileX = worldX >>> 3;
          const tileY = worldY >>> 3;
          const screenBlock = (tileX >>> 5) + (tileY >>> 5) * (dimensions[0] >>> 8);
          const mapIndex = ((tileY & 31) * 32 + (tileX & 31)) * 2;
          const entry = this.memory.read16(100663296 + mapBase + screenBlock * 2048 + mapIndex);
          const tile = entry & 1023;
          const px = entry & 1024 ? 7 - (worldX & 7) : worldX & 7;
          const py = entry & 2048 ? 7 - (worldY & 7) : worldY & 7;
          let paletteIndex;
          if (color8) {
            paletteIndex = this.memory.read8(100663296 + charBase + tile * 64 + py * 8 + px);
            if (!paletteIndex) return -1;
          } else {
            const packed = this.memory.read8(100663296 + charBase + tile * 32 + py * 4 + (px >>> 1));
            const nibble = px & 1 ? packed >>> 4 : packed & 15;
            if (!nibble) return -1;
            paletteIndex = nibble + (entry >>> 12 & 15) * 16;
          }
          return this.memory.readPalette(paletteIndex);
        }
        affineBgPixel(index, control, x, y) {
          const register = index === 2 ? 67108896 : 67108912;
          const signed16 = (value) => value << 16 >> 16;
          const signed28 = (value) => value << 4 >> 4;
          const pa = signed16(this.memory.read16(register));
          const pb = signed16(this.memory.read16(register + 2));
          const pc = signed16(this.memory.read16(register + 4));
          const pd = signed16(this.memory.read16(register + 6));
          const refX = signed28(this.memory.read32(register + 8));
          const refY = signed28(this.memory.read32(register + 12));
          const size = 128 << (control >>> 14 & 3);
          let worldX = refX + pa * x + pb * y >> 8;
          let worldY = refY + pc * x + pd * y >> 8;
          if (control & 8192) {
            worldX = (worldX % size + size) % size;
            worldY = (worldY % size + size) % size;
          } else if (worldX < 0 || worldY < 0 || worldX >= size || worldY >= size) return -1;
          const mapBase = (control >>> 8 & 31) * 2048;
          const charBase = (control >>> 2 & 3) * 16384;
          const mapWidth = size >>> 3;
          const tile = this.memory.read8(100663296 + mapBase + (worldY >>> 3) * mapWidth + (worldX >>> 3));
          const paletteIndex = this.memory.read8(100663296 + charBase + tile * 64 + (worldY & 7) * 8 + (worldX & 7));
          return paletteIndex ? this.memory.readPalette(paletteIndex) : -1;
        }
        buildSpriteLines() {
          const sizes = [[[8, 8], [16, 8], [8, 16]], [[16, 16], [32, 8], [8, 32]], [[32, 32], [32, 16], [16, 32]], [[64, 64], [64, 32], [32, 64]]];
          const oam = this.memory.oam;
          const read16 = (offset) => oam[offset] | oam[offset + 1] << 8;
          const lines = { visible: Array.from({ length: 160 }, () => []), window: Array.from({ length: 160 }, () => []) };
          for (let i = 0; i < 128; i++) {
            const base = i * 8;
            const attr0 = read16(base);
            const attr1 = read16(base + 2);
            const attr2 = read16(base + 4);
            const objectMode = attr0 >>> 10 & 3;
            if (objectMode === 3) continue;
            const affine = Boolean(attr0 & 256);
            if (!affine && attr0 & 512) continue;
            const shape = attr0 >>> 14 & 3;
            const sizeIndex = attr1 >>> 14 & 3;
            const dim = sizes[sizeIndex]?.[shape] || [8, 8];
            const sx = attr1 & 511;
            const sy = attr0 & 255;
            const box = affine && attr0 & 512 ? [dim[0] * 2, dim[1] * 2] : dim;
            const sprite = { attr0, attr1, attr2, objectMode, dim, box, affine, sx: sx >= 256 ? sx - 512 : sx, sy: sy >= 160 ? sy - 256 : sy };
            const target = objectMode === 2 ? lines.window : lines.visible;
            for (let y = Math.max(0, sprite.sy); y < Math.min(160, sprite.sy + box[1]); y++) target[y].push(sprite);
          }
          return lines;
        }
        windowMask(displayControl, spriteLines, x, y) {
          if (!(displayControl & 57344)) return 63;
          const inside = (coordinate, packed) => {
            const start = packed >>> 8;
            const end = packed & 255;
            return start <= end ? coordinate >= start && coordinate < end : coordinate >= start || coordinate < end;
          };
          if (displayControl & 8192 && inside(x, this.memory.read16(67108928)) && inside(y, this.memory.read16(67108932))) return this.memory.read8(67108936) & 63;
          if (displayControl & 16384 && inside(x, this.memory.read16(67108930)) && inside(y, this.memory.read16(67108934))) return this.memory.read8(67108937) & 63;
          if (displayControl & 32768 && spriteLines && this.spritePixel(x, y, 4, spriteLines.window[y], Boolean(displayControl & 64)) >= 0) return this.memory.read8(67108939) & 63;
          return this.memory.read8(67108938) & 63;
        }
        applyBrightness(color, layer) {
          const control = this.memory.read16(67108944);
          const effect = control >>> 6 & 3;
          if (!(control & 1 << layer) || effect < 2) return color;
          const amount = Math.min(16, this.memory.read16(67108948) & 31);
          let red = color & 31;
          let green = color >>> 5 & 31;
          let blue = color >>> 10 & 31;
          if (effect === 2) {
            red += (31 - red) * amount >> 4;
            green += (31 - green) * amount >> 4;
            blue += (31 - blue) * amount >> 4;
          } else {
            red -= red * amount >> 4;
            green -= green * amount >> 4;
            blue -= blue * amount >> 4;
          }
          return red | green << 5 | blue << 10;
        }
        spriteSample(x, y, bgPriority, sprites, oneDimensional) {
          const vram = this.memory.vram;
          const oam = this.memory.oam;
          const palette = this.memory.palette;
          const read16 = (bytes, offset) => bytes[offset] | bytes[offset + 1] << 8;
          let selected = -1;
          let selectedPriority = 4;
          for (const sprite of sprites) {
            const { attr0, attr1, attr2, objectMode, dim, box } = sprite;
            const priority = attr2 >>> 10 & 3;
            if (priority > bgPriority || priority >= selectedPriority) continue;
            let px = x - sprite.sx;
            let py = y - sprite.sy;
            if (px < 0 || py < 0 || px >= box[0] || py >= box[1]) continue;
            if (sprite.affine) {
              const matrix = attr1 >>> 9 & 31;
              const base = matrix * 32;
              const signed = (value) => value << 16 >> 16;
              const pa = signed(read16(oam, base + 6));
              const pb = signed(read16(oam, base + 14));
              const pc = signed(read16(oam, base + 22));
              const pd = signed(read16(oam, base + 30));
              const dx = px - (box[0] >> 1);
              const dy = py - (box[1] >> 1);
              px = (pa * dx + pb * dy >> 8) + (dim[0] >> 1);
              py = (pc * dx + pd * dy >> 8) + (dim[1] >> 1);
              if (px < 0 || py < 0 || px >= dim[0] || py >= dim[1]) continue;
            } else {
              if (attr1 & 4096) px = dim[0] - 1 - px;
              if (attr1 & 8192) py = dim[1] - 1 - py;
            }
            const color8 = Boolean(attr0 & 8192);
            const tile = color8 ? attr2 & 1022 : attr2 & 1023;
            const tileX = px >>> 3;
            const tileY = py >>> 3;
            const factor = color8 ? 2 : 1;
            const tilesWide = dim[0] >>> 3;
            const tileNumber = tile + tileY * (oneDimensional ? tilesWide * factor : 32) + tileX * factor;
            const dataOffset = 65536 + tileNumber * 32 + (py & 7) * (color8 ? 8 : 4) + (color8 ? px & 7 : (px & 7) >>> 1);
            const data = vram[dataOffset];
            const pixel = color8 ? data : data >>> (px & 1) * 4 & 15;
            if (!pixel) continue;
            const paletteIndex = color8 ? pixel : pixel + (attr2 >>> 12 & 15) * 16;
            selected = read16(palette, (256 + paletteIndex) * 2) | priority << 15 | objectMode << 17;
            selectedPriority = priority;
          }
          return selected;
        }
        spritePixel(x, y, bgPriority, sprites, oneDimensional) {
          const sample = this.spriteSample(x, y, bgPriority, sprites, oneDimensional);
          return sample < 0 ? -1 : sample & 32767;
        }
      };
      module.exports = { GbaPpu };
    }
  });

  // src/emulator/gba/gba.js
  var require_gba = __commonJS({
    "src/emulator/gba/gba.js"(exports, module) {
      "use strict";
      var { GbaMemory } = require_memory();
      var { Arm7tdmi } = require_cpu();
      var { GbaPpu } = require_ppu();
      var DuoGba2 = class {
        constructor(rom, save) {
          this.memory = new GbaMemory(rom, save);
          this.cpu = new Arm7tdmi(this.memory);
          this.cpu.clockScale = 4;
          this.ppu = new GbaPpu(this.memory);
          this.frameCycles = 280896;
          this.pressedButtons = 0;
          this.paused = false;
          this.idleRegisters = new Uint32Array(15);
          this.idlePcs = new Uint32Array(9);
        }
        reset() {
          this.cpu.reset();
          this.paused = false;
        }
        runFrame(render = true) {
          if (this.paused) return this.ppu.frame;
          const target = this.cpu.cycles + Math.ceil(this.frameCycles / this.cpu.clockScale);
          while (this.cpu.cycles < target) {
            const registers = this.idleRegisters;
            const pcs = this.idlePcs;
            let pcCount = 0;
            for (let index = 0; index < 15; index++) registers[index] = this.cpu.r[index];
            for (let step = 0; step < 256 && this.cpu.cycles < target; step++) {
              if (pcCount < 9) {
                const pc = this.cpu.r[15] >>> 0;
                let known = false;
                for (let index = 0; index < pcCount; index++) if (pcs[index] === pc) {
                  known = true;
                  break;
                }
                if (!known) pcs[pcCount++] = pc;
              }
              this.cpu.step();
            }
            let unchanged = true;
            for (let index = 0; index < 15; index++) if (registers[index] !== this.cpu.r[index]) {
              unchanged = false;
              break;
            }
            const idle = pcCount <= 8 && !this.memory.pendingInterrupt() && unchanged;
            if (idle && this.cpu.cycles < target) {
              const remaining = target - this.cpu.cycles;
              const advance = Math.min(remaining, Math.ceil((1232 - this.memory.scanlineCycles) / this.cpu.clockScale));
              this.cpu.cycles += advance;
              this.memory.tick(advance * this.cpu.clockScale);
            }
          }
          return render ? this.ppu.render() : this.ppu.frame;
        }
        setButton(button, down) {
          const bit = { a: 0, b: 1, select: 2, start: 3, right: 4, left: 5, up: 6, down: 7, r: 8, l: 9 }[button];
          if (bit === void 0) return;
          if (down) this.pressedButtons |= 1 << bit;
          else this.pressedButtons &= ~(1 << bit);
          this.memory.setButtons(this.pressedButtons);
        }
        takeAudio() {
          return this.memory.takeAudio();
        }
        getSave() {
          return this.memory.getSave();
        }
        saveState() {
          return { cpu: { r: Uint32Array.from(this.cpu.r), cpsr: this.cpu.cpsr, cycles: this.cpu.cycles, irqContext: this.cpu.irqContext ? { registers: Uint32Array.from(this.cpu.irqContext.registers), cpsr: this.cpu.irqContext.cpsr } : null }, memory: { ewram: Uint8Array.from(this.memory.ewram), iwram: Uint8Array.from(this.memory.iwram), io: Uint8Array.from(this.memory.io), palette: Uint8Array.from(this.memory.palette), vram: Uint8Array.from(this.memory.vram), oam: Uint8Array.from(this.memory.oam), sram: Uint8Array.from(this.memory.sram), scanlineCycles: this.memory.scanlineCycles, scanline: this.memory.scanline, timerRemainder: [...this.memory.timerRemainder], timerReload: [...this.memory.timerReload], dmaSource: [...this.memory.dmaSource], dmaDestination: [...this.memory.dmaDestination], dmaInitialDestination: [...this.memory.dmaInitialDestination], dmaEnabled: [...this.memory.dmaEnabled], audioFifos: this.memory.audioFifos.map((fifo) => ({ data: Int8Array.from(fifo.data), head: fifo.head, length: fifo.length })), directSound: [...this.memory.directSound], audioCycleRemainder: this.memory.audioCycleRemainder, flashBank: this.memory.flashBank, flashState: this.memory.flashState, flashIdMode: this.memory.flashIdMode }, pressedButtons: this.pressedButtons };
        }
        loadState(state) {
          const cpu = state.cpu;
          const memory = state.memory;
          this.cpu.r.set(cpu.r);
          this.cpu.cpsr = cpu.cpsr;
          this.cpu.cycles = cpu.cycles;
          this.cpu.irqContext = cpu.irqContext ? { registers: Uint32Array.from(cpu.irqContext.registers), cpsr: cpu.irqContext.cpsr } : null;
          for (const name of ["ewram", "iwram", "io", "palette", "vram", "oam", "sram"]) this.memory[name].set(memory[name]);
          this.memory.scanlineCycles = memory.scanlineCycles;
          this.memory.scanline = memory.scanline;
          this.memory.timerRemainder = [...memory.timerRemainder];
          this.memory.timerReload = [...memory.timerReload];
          this.memory.dmaSource = memory.dmaSource ? [...memory.dmaSource] : [0, 0, 0, 0];
          this.memory.dmaDestination = memory.dmaDestination ? [...memory.dmaDestination] : [0, 0, 0, 0];
          this.memory.dmaInitialDestination = memory.dmaInitialDestination ? [...memory.dmaInitialDestination] : [0, 0, 0, 0];
          this.memory.dmaEnabled = memory.dmaEnabled ? [...memory.dmaEnabled] : [false, false, false, false];
          if (memory.audioFifos) this.memory.audioFifos = memory.audioFifos.map((fifo) => ({ data: Int8Array.from(fifo.data), head: fifo.head, length: fifo.length }));
          else this.memory.audioFifos = Array.from({ length: 2 }, () => ({ data: new Int8Array(32), head: 0, length: 0 }));
          this.memory.directSound = memory.directSound ? [...memory.directSound] : [0, 0];
          this.memory.audioCycleRemainder = memory.audioCycleRemainder || 0;
          this.memory.audioFrameCount = 0;
          this.memory.flashBank = memory.flashBank;
          this.memory.flashState = memory.flashState;
          this.memory.flashIdMode = memory.flashIdMode;
          this.pressedButtons = state.pressedButtons || 0;
          return this;
        }
      };
      module.exports = { DuoGba: DuoGba2 };
    }
  });

  // src/renderer/gba-worker.js
  var { DuoGba } = require_gba();
  var FRAME_MS = 1e3 / 59.7275;
  var emulator = null;
  var running = true;
  var speed = 1;
  var nextFrameAt = 0;
  var timer = null;
  var lastPaintAt = 0;
  var statsStartedAt = 0;
  var emulatedFrames = 0;
  function schedule(delay = 0) {
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }
  function run() {
    if (!emulator || !running) {
      nextFrameAt = performance.now() + FRAME_MS;
      schedule(FRAME_MS);
      return;
    }
    const started = performance.now();
    const draw = speed === 1 || started - lastPaintAt >= FRAME_MS;
    const result = emulator.runFrame(draw);
    const audio = emulator.takeAudio();
    emulatedFrames++;
    if (draw) {
      const frame = Uint32Array.from(result);
      postMessage({ type: "frame", pixels: frame.buffer }, [frame.buffer]);
      lastPaintAt = performance.now();
    }
    if (speed === 1 && audio.samples.length) postMessage({ type: "audio", samples: audio.samples.buffer, sampleRate: audio.sampleRate }, [audio.samples.buffer]);
    const now = performance.now();
    if (now - statsStartedAt >= 1e3) {
      const fps = emulatedFrames * 1e3 / (now - statsStartedAt);
      postMessage({ type: "stats", fps, speed });
      statsStartedAt = now;
      emulatedFrames = 0;
    }
    nextFrameAt = Math.max(nextFrameAt + FRAME_MS / speed, now);
    schedule(Math.max(0, nextFrameAt - performance.now()));
  }
  self.onmessage = (event) => {
    const message = event.data || {};
    if (message.type === "init") {
      emulator = new DuoGba(new Uint8Array(message.rom), message.save ? new Uint8Array(message.save) : null);
      nextFrameAt = performance.now();
      lastPaintAt = 0;
      statsStartedAt = nextFrameAt;
      emulatedFrames = 0;
      postMessage({ type: "ready" });
      schedule();
    } else if (message.type === "button") emulator?.setButton(message.key, message.down);
    else if (message.type === "pause") running = !message.paused;
    else if (message.type === "speed") {
      speed = [1, 2, 4].includes(Number(message.value)) ? Number(message.value) : 1;
      nextFrameAt = performance.now();
    } else if (message.type === "reset") emulator?.reset();
    else if (message.type === "save" && emulator) {
      const save = emulator.getSave();
      postMessage({ type: "save", bytes: save.buffer, requestId: message.requestId }, [save.buffer]);
    }
  };
})();
