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
        constructor(rom) {
          this.rom = Uint8Array.from(rom || []);
          this.ewram = new Uint8Array(262144);
          this.iwram = new Uint8Array(32768);
          this.io = new Uint8Array(1024);
          this.palette = new Uint8Array(1024);
          this.vram = new Uint8Array(98304);
          this.oam = new Uint8Array(1024);
          this.io[0] = 3;
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
          return null;
        }
        read8(address) {
          const a = address >>> 0;
          if (a >= REGION.ROM && a < 234881024 && this.rom.length) return this.rom[(a - REGION.ROM) % this.rom.length];
          const target = this.region(a);
          return target ? target[0][target[1] % target[0].length] : 0;
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
          if (a >= REGION.ROM) return;
          const target = this.region(a);
          if (target) target[0][target[1] % target[0].length] = value & 255;
        }
        write16(address, value) {
          const a = address & ~1;
          this.write8(a, value);
          this.write8(a + 1, value >>> 8);
        }
        write32(address, value) {
          const a = address & ~3;
          this.write8(a, value);
          this.write8(a + 1, value >>> 8);
          this.write8(a + 2, value >>> 16);
          this.write8(a + 3, value >>> 24);
        }
        setButtons(mask) {
          const activeLow = ~mask & 1023;
          this.io[304] = activeLow & 255;
          this.io[305] = activeLow >>> 8;
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
          if (instr & 33554432) return { value: instr & 4095, carry: this.c };
          const rm = instr & 15;
          const value = rm === 15 ? U32(this.r[rm] + 4) : this.r[rm];
          const type = instr >>> 5 & 3;
          const amount = instr >>> 7 & 31;
          return this.shift(value, type, amount, this.c);
        }
        step() {
          if (this.thumb) return this.stepThumb();
          const pc = this.r[15] >>> 0;
          const instr = this.memory.read32(pc);
          this.r[15] = U32(pc + 4);
          this.stepArmInstruction(instr >>> 0);
          return this.cycles;
        }
        stepArmInstruction(instr) {
          const cond = instr >>> 28;
          if (!this.condition(cond)) {
            this.cycles += 1;
            return;
          }
          if ((instr & 268435440) === 19922704) {
            this.r[15] = this.r[instr & 15] & ~1;
            this.thumb = true;
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
            this.cycles += 4;
            return;
          }
          if ((instr & 201326592) === 0) {
            this.armDataProcessing(instr);
            return;
          }
          this.cycles += 1;
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
          let address = this.r[rn];
          const regs = [];
          for (let i = 0; i < 16; i++) if (instr & 1 << i) regs.push(i);
          if (u && p) address += 4;
          else if (!u && !p) address -= regs.length * 4;
          for (const reg of regs) {
            if (l) this.r[reg] = this.memory.read32(address);
            else this.memory.write32(address, this.r[reg]);
            address = u ? U32(address + 4) : U32(address - 4);
          }
          if (w) this.r[rn] = u ? U32(this.r[rn] + regs.length * 4) : U32(this.r[rn] - regs.length * 4);
          this.cycles += 1 + regs.length;
        }
        armDataProcessing(instr) {
          const opcode = instr >>> 21 & 15;
          const set = instr >>> 20 & 1;
          const rn = instr >>> 16 & 15;
          const rd = instr >>> 12 & 15;
          const operand = this.armOperand(instr).value;
          const a = this.r[rn];
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
          this.stepThumbInstruction(instr);
          return this.cycles;
        }
        stepThumbInstruction(instr) {
          const op = instr >>> 11;
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
            let out = a;
            switch (opcode) {
              case 0:
                out = a & b;
                break;
              case 1:
                out = a ^ b;
                break;
              case 2:
                out = this.shift(a, 0, b & 31).value;
                break;
              case 3:
                out = this.shift(a, 1, b & 31).value;
                break;
              case 4:
                out = this.add(a, b);
                break;
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
              default:
                break;
            }
            this.r[rd] = U32(out);
            this.setFlags(out >>> 31, out === 0);
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
              this.r[15] = this.r[rs] & ~1;
              this.thumb = true;
            }
            this.cycles += 2;
            return;
          }
          if ((instr & 63488) === 18432) {
            const rd = instr >>> 8 & 7;
            const address = (this.r[15] & ~2) + 2 + ((instr & 255) << 2) >>> 0;
            this.r[rd] = this.memory.read32(address);
            this.cycles += 2;
            return;
          }
          if ((instr & 61952) === 20480 || (instr & 57344) === 24576 || (instr & 61440) === 36864) {
            this.thumbLoadStore(instr);
            return;
          }
          if ((instr & 62976) === 46080) {
            const pop = instr & 2048;
            const include = instr & 256;
            let sp = this.r[13];
            if (!pop) {
              if (include) this.memory.write32(sp - 4, this.r[14]);
              for (let i = 7; i >= 0; i--) if (instr & 1 << i) {
                sp -= 4;
                this.memory.write32(sp, this.r[i]);
              }
            } else {
              for (let i = 0; i < 8; i++) if (instr & 1 << i) {
                this.r[i] = this.memory.read32(sp);
                sp += 4;
              }
              if (include) {
                this.r[15] = this.memory.read32(sp) & ~1;
                sp += 4;
              }
            }
            this.r[13] = sp;
            this.cycles += 2;
            return;
          }
          if ((instr & 61440) === 53248) {
            const cond = instr >>> 8 & 15;
            let offset = (instr & 255) << 1;
            if (offset & 256) offset |= 4294966784;
            if (cond !== 15 && this.condition(cond)) this.r[15] = U32(this.r[15] + offset);
            this.cycles += 2;
            return;
          }
          if ((instr & 63488) === 57344) {
            let offset = (instr & 2047) << 1;
            if (offset & 2048) offset |= 4294963200;
            this.r[15] = U32(this.r[15] + offset);
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
            this.r[14] = U32(this.r[15] - 2 | 1);
            this.r[15] = target;
            this.cycles += 3;
            return;
          }
          this.cycles++;
        }
        thumbLoadStore(instr) {
          const l = instr >>> 11 & 1;
          const byte = instr >>> 12 & 1;
          const rd = instr & 7;
          const rb = instr >>> 3 & 7;
          let offset;
          if ((instr & 61952) === 20480) offset = this.r[instr >>> 6 & 7];
          else if ((instr & 57344) === 24576) offset = (instr >>> 6 & 31) << (byte ? 0 : 2);
          else {
            offset = (instr & 255) << 2;
          }
          const address = U32(this.r[rb] + offset);
          if (l) this.r[rd] = byte ? this.memory.read8(address) : this.memory.read32(address);
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
          const control = this.memory.read16(67108872);
          const charBase = (control >>> 2 & 3) * 16384;
          const mapBase = (control >>> 8 & 31) * 2048;
          const color8 = Boolean(control & 128);
          const hFlip = Boolean(control & 16384);
          const vFlip = Boolean(control & 32768);
          const scrollX = this.memory.read16(67108880);
          const scrollY = this.memory.read16(67108882);
          for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) {
            const worldX = x + scrollX & 255;
            const worldY = y + scrollY & 255;
            const tileX = worldX >>> 3;
            const tileY = worldY >>> 3;
            const entry = this.memory.read16(100663296 + mapBase + tileY * 32 * 2 + tileX * 2);
            const tile = entry & 1023;
            const fx = Boolean(entry & 16384) ^ hFlip;
            const fy = Boolean(entry & 32768) ^ vFlip;
            const px = fx ? 7 - (worldX & 7) : worldX & 7;
            const py = fy ? 7 - (worldY & 7) : worldY & 7;
            let index;
            if (color8) index = this.memory.read8(100663296 + charBase + tile * 64 + py * 8 + px);
            else {
              const packed = this.memory.read8(100663296 + charBase + tile * 32 + py * 4 + (px >>> 1));
              const nibble = px & 1 ? packed >>> 4 : packed & 15;
              index = nibble + (entry >>> 12 & 15) * 16;
            }
            this.frame[y * 240 + x] = this.color15(this.memory.readPalette(index));
          }
          return this.frame;
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
        constructor(rom) {
          this.memory = new GbaMemory(rom);
          this.cpu = new Arm7tdmi(this.memory);
          this.ppu = new GbaPpu(this.memory);
          this.frameCycles = 280896;
          this.paused = false;
        }
        reset() {
          this.cpu.reset();
          this.paused = false;
        }
        runFrame() {
          if (this.paused) return this.ppu.frame;
          const target = this.cpu.cycles + this.frameCycles;
          while (this.cpu.cycles < target) this.cpu.step();
          return this.ppu.render();
        }
        setButton(button, down) {
          const bit = { a: 0, b: 1, select: 2, start: 3, right: 4, left: 5, up: 6, down: 7, r: 8, l: 9 }[button];
          if (bit === void 0) return;
          const mask = this.memory.read16(67109168);
          this.memory.setButtons(down ? mask & ~(1 << bit) : mask | 1 << bit);
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
    const rom = await window.duopocket.getRom();
    if (!rom) {
      document.querySelector("#status").textContent = "ROM indispon\xEDvel";
      return;
    }
    emulator.value = new DuoGba(rom);
    document.querySelector("#status").textContent = "ARM7TDMI \xB7 v\xEDdeo pr\xF3prio";
    loop();
  }
  init().catch((error) => {
    console.error(error);
    document.querySelector("#status").textContent = "Erro ao carregar ROM";
  });
})();
