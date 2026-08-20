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
          this.io[0] = 0;
          this.io[48] = 255;
          this.io[49] = 3;
        }
        region(address) {
          const a = address >>> 0;
          if (a >= REGION.EWRAM && a < REGION.EWRAM + 262144) return [this.ewram, a - REGION.EWRAM];
          if (a >= REGION.IWRAM && a < REGION.IWRAM + 32768) return [this.iwram, a - REGION.IWRAM];
          if (a >= REGION.IO && a < REGION.IO + 1024) return [this.io, a - REGION.IO];
          if (a >= REGION.PAL && a < REGION.PAL + 1024) return [this.palette, a - REGION.PAL];
          if (a >= REGION.VRAM && a < REGION.VRAM + 98304) return [this.vram, a - REGION.VRAM];
          if (a >= REGION.OAM && a < REGION.OAM + 1024) return [this.oam, a - REGION.OAM];
          if (a >= 234881024 && a < 234946560) return [this.sram, a - 234881024];
          return null;
        }
        read8(address) {
          const a = address >>> 0;
          if (a >= REGION.ROM && a < 234881024 && this.rom.length) return this.rom[(a - REGION.ROM) % this.rom.length];
          if (a >= REGION.EWRAM && a < REGION.EWRAM + 262144) return this.ewram[a - REGION.EWRAM];
          if (a >= REGION.IWRAM && a < REGION.IWRAM + 32768) return this.iwram[a - REGION.IWRAM];
          if (a >= REGION.IO && a < REGION.IO + 1024) return this.io[a - REGION.IO];
          if (a >= REGION.PAL && a < REGION.PAL + 1024) return this.palette[a - REGION.PAL];
          if (a >= REGION.VRAM && a < REGION.VRAM + 98304) return this.vram[a - REGION.VRAM];
          if (a >= REGION.OAM && a < REGION.OAM + 1024) return this.oam[a - REGION.OAM];
          if (a >= 234881024 && a < 234946560) {
            const offset = a - 234881024;
            if (this.flashIdMode && offset < 2) return offset ? 19 : 98;
            return this.sram[this.flashBank * 65536 + offset];
          }
          return 0;
        }
        read16(address) {
          const a = address & ~1;
          return this.read8(a) | this.read8(a + 1) << 8;
        }
        read32(address) {
          const a = address & ~3;
          return (this.read8(a) | this.read8(a + 1) << 8 | this.read8(a + 2) << 16 | this.read8(a + 3) << 24) >>> 0;
        }
        write8(address, value) {
          const a = address >>> 0;
          const byte = value & 255;
          if (a >= 234881024 && a < 234946560) {
            this.writeFlash(a - 234881024, byte);
            return;
          }
          if (a >= REGION.ROM) return;
          if (a >= REGION.EWRAM && a < REGION.EWRAM + 262144) this.ewram[a - REGION.EWRAM] = byte;
          else if (a >= REGION.IWRAM && a < REGION.IWRAM + 32768) this.iwram[a - REGION.IWRAM] = byte;
          else if (a >= REGION.IO && a < REGION.IO + 1024) this.io[a - REGION.IO] = byte;
          else if (a >= REGION.PAL && a < REGION.PAL + 1024) this.palette[a - REGION.PAL] = byte;
          else if (a >= REGION.VRAM && a < REGION.VRAM + 98304) this.vram[a - REGION.VRAM] = byte;
          else if (a >= REGION.OAM && a < REGION.OAM + 1024) this.oam[a - REGION.OAM] = byte;
        }
        writeFlash(offset, value) {
          if (value === 240) {
            this.flashState = 0;
            this.flashIdMode = false;
            return;
          }
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
          const oldControl = timerControl ? this.read16(a) : 0;
          this.write8(a, value);
          this.write8(a + 1, value >>> 8);
          if (timerData) this.timerReload[a - 67109120 >> 2] = value & 65535;
          if (timerControl && !(oldControl & 128) && value & 128) {
            const index = a - 67109122 >> 2;
            this.writeIo16(a - 2, this.timerReload[index]);
            this.timerRemainder[index] = 0;
          }
          if (a >= 67109050 && a <= 67109084 && (a - 67109040) % 12 === 10) this.performDma(Math.floor((a - 67109040) / 12));
        }
        write32(address, value) {
          const a = address & ~3;
          this.write8(a, value);
          this.write8(a + 1, value >>> 8);
          this.write8(a + 2, value >>> 16);
          this.write8(a + 3, value >>> 24);
          if (a >= 67109048 && a <= 67109084 && (a - 67109048) % 12 === 0) this.performDma(Math.floor((a - 67109048) / 12));
        }
        tick(cycles) {
          this.scanlineCycles += cycles;
          while (this.scanlineCycles >= 1232) {
            this.scanlineCycles -= 1232;
            this.scanline = (this.scanline + 1) % 228;
            this.io[6] = this.scanline;
            const displayStatus = this.read16(67108868) & ~3;
            const vblank = this.scanline >= 160;
            const hblank = 0;
            this.writeIo16(67108868, displayStatus | (vblank ? 1 : 0) | hblank);
            if (this.scanline === 160) for (let channel = 0; channel < 4; channel++) this.performDma(channel, 1);
            if (this.scanline === 160 && displayStatus & 8) this.writeIo16(67109378, this.read16(67109378) | 1);
          }
          for (let index = 0; index < 4; index++) {
            const control = this.read16(67109122 + index * 4);
            if (!(control & 128) || index && control & 4) continue;
            const divider = [1, 64, 256, 1024][control & 3];
            const total = this.timerRemainder[index] + cycles;
            const ticks = Math.floor(total / divider);
            this.timerRemainder[index] = total % divider;
            if (ticks) this.incrementTimer(index, ticks);
          }
        }
        incrementTimer(index, ticks) {
          if (index > 3 || ticks <= 0) return;
          const address = 67109120 + index * 4;
          const control = this.read16(address + 2);
          if (!(control & 128)) return;
          let value = this.read16(address);
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
          if (overflows && control & 64) this.writeIo16(67109378, this.read16(67109378) | 1 << 3 + index);
          if (overflows && index < 3 && (this.read16(address + 6) & 132) === 132) this.incrementTimer(index + 1, overflows);
        }
        writeIo16(address, value) {
          const offset = address - REGION.IO & 1022;
          this.io[offset] = value & 255;
          this.io[offset + 1] = value >>> 8 & 255;
        }
        performDma(channel, trigger = 0) {
          if (channel < 0 || channel > 3) return;
          const base = 67109040 + channel * 12;
          const source = this.read32(base);
          const destination = this.read32(base + 4);
          const control = this.read16(base + 10);
          const timing = control >>> 12 & 3;
          if (!(control & 32768) || timing !== trigger) return;
          const max = channel === 3 ? 65536 : 16384;
          const count = this.read16(base + 8) || max;
          const width = control & 1024 ? 4 : 2;
          const sourceMode = control >>> 7 & 3;
          const destinationMode = control >>> 5 & 3;
          let src = source;
          let dst = destination;
          for (let i = 0; i < count; i++) {
            if (width === 4) this.write32(dst, this.read32(src));
            else this.write16(dst, this.read16(src));
            if (sourceMode !== 2) src = src + (sourceMode === 1 ? -width : width) >>> 0;
            if (destinationMode !== 2) dst = dst + (destinationMode === 1 ? -width : width) >>> 0;
          }
          if (!(control & 512) || timing === 0) this.writeIo16(base + 10, control & 32767);
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
          return Boolean(this.read16(67109384) & 1 && this.read16(67109376) & this.read16(67109378));
        }
        registerRamReset(mask) {
          if (mask & 1) this.ewram.fill(0);
          if (mask & 2) this.iwram.fill(0);
          if (mask & 4) this.palette.fill(0);
          if (mask & 8) this.vram.fill(0);
          if (mask & 16) this.oam.fill(0);
          if (mask & 224) {
            const keys = this.read16(67109168);
            this.io.fill(0);
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
          if (type === 0) return { value: U32(value << amount), carry: value >>> 32 - amount & 1 };
          if (type === 1) return { value: value >>> amount, carry: value >>> amount - 1 & 1 };
          if (type === 2) return { value: U32(S32(value) >> amount), carry: value >>> amount - 1 & 1 };
          const rotate = amount % 32 || 32;
          return { value: U32(value >>> rotate | value << 32 - rotate), carry: value >>> rotate - 1 & 1 };
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
          const amount = instr >>> 7 & 31;
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
            if (instr & 16777216) this.r[14] = U32(this.r[15] - 4);
            this.r[15] = U32(this.r[15] + 4 + offset);
            this.cycles += 3;
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
            const rm = instr & 15;
            const rs = instr >>> 8 & 15;
            this.r[rd] = U32(this.r[rm] * this.r[rs]);
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
              const x = S32(this.r[0]);
              const y = S32(this.r[1]);
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
              const words = (this.r[2] & 2097151) * 8;
              const fill = Boolean(this.r[2] & 16777216);
              const fixed = this.memory.read32(source);
              for (let i = 0; i < words; i++) this.memory.write32(destination + i * 4, fill ? fixed : this.memory.read32(source + i * 4));
              this.cycles += words;
              return;
            }
            case 17:
            // LZ77UnCompWram
            case 18: {
              this.lz77Uncompress(this.r[0] >>> 0, this.r[1] >>> 0);
              return;
            }
            case 14:
            // BgAffineSet / no-op fallback
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
          if (l) this.r[rd] = b ? this.memory.read8(address) : this.memory.read32(address);
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
          else address = U32(base - 4), step = -4;
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
          const operand = this.armOperand(instr).value;
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
              this.setFlags(result >>> 31, result === 0);
              break;
            case 9:
              result = a ^ operand;
              this.setFlags(result >>> 31, result === 0);
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
            if (set) this.setFlags(result >>> 31, result === 0);
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
            const amount = instr >>> 6 & 31;
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
            this.r[rd] = this.memory.read32(address);
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
            else if (op === 4) this.r[rd] = this.memory.read32(address2);
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
            if (load2) this.r[spRd] = this.memory.read32(address2);
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
          if (load) this.r[rd] = byte ? this.memory.read8(address) : this.memory.read32(address);
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
        }
        color15(value) {
          const r = (value & 31) * 255 / 31;
          const g = (value >>> 5 & 31) * 255 / 31;
          const b = (value >>> 10 & 31) * 255 / 31;
          return 255 << 24 | b << 16 | g << 8 | r;
        }
        render() {
          const mode = this.memory.read16(67108864) & 7;
          if (mode === 3) return this.renderMode3();
          if (mode === 4) return this.renderMode4();
          return this.renderMode0();
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
        renderMode0() {
          const displayControl = this.memory.read16(67108864);
          const spriteLines = displayControl & 4096 ? this.buildSpriteLines() : null;
          const bg = [];
          for (let n = 0; n < 4; n++) bg.push(this.memory.read16(67108872 + n * 2));
          for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) {
            let best = 4;
            let color = this.memory.readPalette(0);
            for (let n = 0; n < 4; n++) {
              if (!(displayControl & 256 << n)) continue;
              const control = bg[n];
              const pixel = this.bgPixel(n, control, x, y);
              if (!pixel || (control & 3) > best) continue;
              best = control & 3;
              color = pixel;
            }
            if (spriteLines) {
              const sprite = this.spritePixel(x, y, best, spriteLines[y]);
              if (sprite) color = sprite;
            }
            this.frame[y * 240 + x] = this.color15(color);
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
          const px = entry & 16384 ? 7 - (worldX & 7) : worldX & 7;
          const py = entry & 32768 ? 7 - (worldY & 7) : worldY & 7;
          let paletteIndex;
          if (color8) {
            paletteIndex = this.memory.read8(100663296 + charBase + tile * 64 + py * 8 + px);
            if (!paletteIndex) return 0;
          } else {
            const packed = this.memory.read8(100663296 + charBase + tile * 32 + py * 4 + (px >>> 1));
            const nibble = px & 1 ? packed >>> 4 : packed & 15;
            if (!nibble) return 0;
            paletteIndex = nibble + (entry >>> 12 & 15) * 16;
          }
          return this.memory.readPalette(paletteIndex);
        }
        buildSpriteLines() {
          const sizes = [[[8, 8], [16, 8], [8, 16]], [[16, 16], [32, 8], [8, 32]], [[32, 32], [32, 16], [16, 32]], [[64, 64], [64, 32], [32, 64]]];
          const lines = Array.from({ length: 160 }, () => []);
          for (let i = 127; i >= 0; i--) {
            const base = 117440512 + i * 8;
            const attr0 = this.memory.read16(base);
            const attr1 = this.memory.read16(base + 2);
            const attr2 = this.memory.read16(base + 4);
            if (attr0 & 512 || (attr0 & 768) === 768) continue;
            const shape = attr0 >>> 14 & 3;
            const sizeIndex = attr1 >>> 14 & 3;
            const dim = sizes[sizeIndex]?.[shape] || [8, 8];
            const sx = attr1 & 511;
            const sy = attr0 & 255;
            const sprite = { attr0, attr1, attr2, dim, sx: sx >= 256 ? sx - 512 : sx, sy: sy >= 160 ? sy - 256 : sy };
            for (let y = Math.max(0, sprite.sy); y < Math.min(160, sprite.sy + dim[1]); y++) lines[y].push(sprite);
          }
          return lines;
        }
        spritePixel(x, y, bgPriority, sprites) {
          for (const sprite of sprites) {
            const { attr0, attr1, attr2, dim } = sprite;
            let px = x - sprite.sx;
            let py = y - sprite.sy;
            if (px < 0 || py < 0 || px >= dim[0] || py >= dim[1]) continue;
            if (attr1 & 4096) px = dim[0] - 1 - px;
            if (attr1 & 8192) py = dim[1] - 1 - py;
            const color8 = Boolean(attr0 & 8192);
            const tile = attr2 & 1023;
            const tileX = px >>> 3;
            const tileY = py >>> 3;
            const tilesWide = dim[0] >>> 3;
            const tileNumber = tile + tileY * (color8 ? tilesWide * 2 : tilesWide) + tileX * (color8 ? 2 : 1);
            const data = color8 ? this.memory.read8(100728832 + tileNumber * 32 + (py & 7) * 8 + (px & 7)) : this.memory.read8(100728832 + tileNumber * 32 + (py & 7) * 4 + ((px & 7) >>> 1));
            const paletteIndex = color8 ? data : (data >>> (px & 1) * 4 & 15) + (attr2 >>> 12 & 15) * 16;
            if (!paletteIndex) continue;
            return this.memory.readPalette(512 + paletteIndex);
          }
          return 0;
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
          this.ppu = new GbaPpu(this.memory);
          this.frameCycles = 280896;
          this.pressedButtons = 0;
          this.paused = false;
        }
        reset() {
          this.cpu.reset();
          this.paused = false;
        }
        runFrame() {
          if (this.paused) return this.ppu.frame;
          const target = this.cpu.cycles + this.frameCycles;
          while (this.cpu.cycles < target) {
            const registers = Array.from(this.cpu.r.subarray(0, 15));
            const pcs = /* @__PURE__ */ new Set();
            for (let step = 0; step < 256 && this.cpu.cycles < target; step++) {
              pcs.add(this.cpu.r[15] >>> 0);
              this.cpu.step();
            }
            const idle = pcs.size <= 8 && !this.memory.pendingInterrupt() && registers.every((value, index) => value === this.cpu.r[index]);
            if (idle && this.cpu.cycles < target) {
              const remaining = target - this.cpu.cycles;
              const advance = Math.min(remaining, 1232 - this.memory.scanlineCycles);
              this.cpu.cycles += advance;
              this.memory.tick(advance);
            }
          }
          return this.ppu.render();
        }
        setButton(button, down) {
          const bit = { a: 0, b: 1, select: 2, start: 3, right: 4, left: 5, up: 6, down: 7, r: 8, l: 9 }[button];
          if (bit === void 0) return;
          if (down) this.pressedButtons |= 1 << bit;
          else this.pressedButtons &= ~(1 << bit);
          this.memory.setButtons(this.pressedButtons);
        }
        getSave() {
          return this.memory.getSave();
        }
      };
      module.exports = { DuoGba: DuoGba2 };
    }
  });

  // src/renderer/gba-player.js
  var { DuoGba } = require_gba();
  var canvas = document.querySelector("#screen");
  var ctx = canvas.getContext("2d", { alpha: false });
  var image = ctx.createImageData(240, 160);
  var emulator = { value: null };
  var running = true;
  function paint(frame) {
    for (let i = 0; i < frame.length; i++) {
      const color = frame[i] >>> 0;
      image.data[i * 4] = color & 255;
      image.data[i * 4 + 1] = color >>> 8 & 255;
      image.data[i * 4 + 2] = color >>> 16 & 255;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  function loop() {
    if (running && emulator.value) paint(emulator.value.runFrame());
    requestAnimationFrame(loop);
  }
  function keyName(event) {
    return { z: "a", x: "b", Enter: "start", Shift: "select", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", a: "l", s: "r" }[event.key];
  }
  window.addEventListener("keydown", (event) => {
    const key = keyName(event);
    if (key && emulator.value) {
      event.preventDefault();
      emulator.value.setButton(key, true);
    }
  });
  window.addEventListener("keyup", (event) => {
    const key = keyName(event);
    if (key && emulator.value) {
      event.preventDefault();
      emulator.value.setButton(key, false);
    }
  });
  document.querySelectorAll("[data-key]").forEach((button) => {
    const key = button.dataset.key;
    button.addEventListener("pointerdown", () => emulator.value?.setButton(key, true));
    button.addEventListener("pointerup", () => emulator.value?.setButton(key, false));
    button.addEventListener("pointerleave", () => emulator.value?.setButton(key, false));
  });
  document.querySelector("#pause").addEventListener("click", (event) => {
    running = !running;
    event.currentTarget.textContent = running ? "Pausar" : "Continuar";
  });
  document.querySelector("#reset").addEventListener("click", () => emulator.value?.reset());
  async function init() {
    const payload = await window.duopocket.getRom();
    if (!payload) {
      document.querySelector("#status").textContent = "ROM indispon\xEDvel";
      return;
    }
    emulator.value = new DuoGba(payload.rom, payload.save);
    document.querySelector("#status").textContent = "ARM7TDMI \xB7 v\xEDdeo pr\xF3prio \xB7 Flash 1M";
    loop();
    setInterval(() => emulator.value && window.duopocket.saveRom(emulator.value.getSave()), 5e3);
  }
  init().catch((error) => {
    console.error(error);
    document.querySelector("#status").textContent = "Erro ao carregar ROM";
  });
})();
