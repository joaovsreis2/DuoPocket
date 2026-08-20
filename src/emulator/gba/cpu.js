'use strict';

const U32 = (value) => value >>> 0;
const S32 = (value) => value | 0;

class Arm7tdmi {
  constructor(memory) {
    this.memory = memory;
    this.r = new Uint32Array(16);
    this.cpsr = 0x1f;
    this.cycles = 0;
    this.reset();
  }

  reset() {
    this.r.fill(0);
    this.r[13] = 0x03007f00;
    this.r[14] = 0;
    this.r[15] = 0x08000000;
    this.cpsr = 0x1f; // supervisor, ARM state, flags clear
    this.cycles = 0;
  }

  get thumb() { return (this.cpsr & 0x20) !== 0; }
  set thumb(value) { this.cpsr = value ? (this.cpsr | 0x20) : (this.cpsr & ~0x20); }
  get n() { return (this.cpsr >>> 31) & 1; }
  get z() { return (this.cpsr >>> 30) & 1; }
  get c() { return (this.cpsr >>> 29) & 1; }
  get v() { return (this.cpsr >>> 28) & 1; }
  setFlags(n, z, c = this.c, v = this.v) {
    this.cpsr = (this.cpsr & 0x0fffffff) | (n ? 0x80000000 : 0) | (z ? 0x40000000 : 0) | (c ? 0x20000000 : 0) | (v ? 0x10000000 : 0);
  }

  condition(cond) {
    switch (cond) {
      case 0: return this.z === 1;
      case 1: return this.z === 0;
      case 2: return this.c === 1;
      case 3: return this.c === 0;
      case 4: return this.n === 1;
      case 5: return this.n === 0;
      case 6: return this.v === 1;
      case 7: return this.v === 0;
      case 8: return this.c === 1 && this.z === 0;
      case 9: return this.c === 0 || this.z === 1;
      case 10: return this.n === this.v;
      case 11: return this.n !== this.v;
      case 12: return this.z === 0 && this.n === this.v;
      case 13: return this.z === 1 || this.n !== this.v;
      case 14: return true;
      default: return false;
    }
  }

  add(a, b, carry = 0, set = true) {
    const result = U32(a + b + carry);
    const unsignedCarry = (a >>> 0) + (b >>> 0) + carry > 0xffffffff;
    const overflow = ((~(a ^ b) & (a ^ result)) >>> 31) !== 0;
    if (set) this.setFlags(result >>> 31, result === 0, unsignedCarry, overflow);
    return result;
  }

  sub(a, b, carry = 1, set = true) {
    const result = U32(a - b - (1 - carry));
    const noBorrow = (a >>> 0) >= ((b >>> 0) + (1 - carry));
    const overflow = (((a ^ b) & (a ^ result)) >>> 31) !== 0;
    if (set) this.setFlags(result >>> 31, result === 0, noBorrow, overflow);
    return result;
  }

  shift(value, type, amount, carryIn = this.c) {
    value >>>= 0;
    if (!amount) return { value, carry: carryIn };
    if (type === 0) return { value: U32(value << amount), carry: (value >>> (32 - amount)) & 1 };
    if (type === 1) return { value: value >>> amount, carry: (value >>> (amount - 1)) & 1 };
    if (type === 2) return { value: U32(S32(value) >> amount), carry: (value >>> (amount - 1)) & 1 };
    const rotate = amount % 32 || 32;
    return { value: U32((value >>> rotate) | (value << (32 - rotate))), carry: (value >>> (rotate - 1)) & 1 };
  }

  armOperand(instr) {
    if (instr & 0x02000000) {
      const imm = instr & 0xff;
      const rotate = ((instr >>> 8) & 0xf) * 2;
      const value = rotate ? U32((imm >>> rotate) | (imm << (32 - rotate))) : imm;
      return { value, carry: rotate ? (value >>> 31) : this.c };
    }
    const rm = instr & 15;
    const value = rm === 15 ? U32(this.r[rm] + 4) : this.r[rm];
    const type = (instr >>> 5) & 3;
    const amount = (instr >>> 7) & 31;
    return this.shift(value, type, amount, this.c);
  }

  step() {
    if (this.thumb) return this.stepThumb();
    const pc = this.r[15] >>> 0;
    const instr = this.memory.read32(pc);
    this.r[15] = U32(pc + 4);
    const before = this.cycles;
    this.stepArmInstruction(instr >>> 0);
    this.memory.tick(this.cycles - before);
    return this.cycles;
  }

  stepArmInstruction(instr) {
    const cond = instr >>> 28;
    if (!this.condition(cond)) { this.cycles += 1; return; }
    if ((instr & 0x0ffffff0) === 0x012fff10) {
      const target = this.r[instr & 15] >>> 0;
      this.r[15] = target & ~1;
      this.thumb = Boolean(target & 1); this.cycles += 3; return;
    }
    if ((instr & 0x0e000000) === 0x0a000000) {
      let offset = (instr & 0x00ffffff) << 2;
      if (offset & 0x02000000) offset |= 0xfc000000;
      if (instr & 0x01000000) this.r[14] = U32(this.r[15] - 4);
      this.r[15] = U32(this.r[15] + 4 + offset);
      this.cycles += 3; return;
    }
    if ((instr & 0x0e000090) === 0x00000090 && (instr & 0x0fc000f0) !== 0x00000090) { this.armHalfwordTransfer(instr); return; }
    if ((instr & 0x0c000000) === 0x04000000) { this.armLoadStore(instr); return; }
    if ((instr & 0x0e000000) === 0x08000000) { this.armBlockTransfer(instr); return; }
    if ((instr & 0x0fc000f0) === 0x00000090) {
      const rd = (instr >>> 16) & 15; const rm = instr & 15; const rs = (instr >>> 8) & 15;
      this.r[rd] = U32(this.r[rm] * this.r[rs]); if (instr & 0x00100000) this.setFlags(this.r[rd] >>> 31, this.r[rd] === 0);
      this.cycles += 2; return;
    }
    if ((instr & 0x0f000000) === 0x0f000000) { this.handleSwi(instr & 0xff); return; }
    if ((instr & 0x0c000000) === 0) { this.armDataProcessing(instr); return; }
    this.cycles += 1;
  }

  handleSwi(code) {
    // BIOS calls used by commercial games. These are deterministic local
    // implementations; the real BIOS is intentionally not redistributed.
    switch (code) {
      case 0x06: { // Div
        const numerator = S32(this.r[0]); const denominator = S32(this.r[1]);
        if (denominator) { const quotient = (numerator / denominator) | 0; this.r[0] = U32(quotient); this.r[1] = U32(numerator - quotient * denominator); this.r[3] = U32(Math.abs(quotient)); }
        this.cycles += 4; return;
      }
      case 0x08: { // Sqrt
        this.r[0] = Math.floor(Math.sqrt(this.r[0] >>> 0)) >>> 0; this.cycles += 4; return;
      }
      case 0x09: { // ArcTan2 (fixed-point approximation)
        const x = S32(this.r[0]); const y = S32(this.r[1]); this.r[0] = Math.round(Math.atan2(y, x) * 32768 / Math.PI) & 0xffff; this.cycles += 4; return;
      }
      case 0x0b: // CpuSet
      case 0x0c: { // CpuFastSet
        const source = this.r[0] >>> 0; const destination = this.r[1] >>> 0; const count = this.r[2] & 0x1fffff; const words = code === 0x0c ? (count & 0x1fffff) * 8 : (count & 0x1fffff); const fill = (this.r[2] & 0x01000000) !== 0; const word = this.memory.read32(source);
        for (let i = 0; i < words; i++) this.memory.write32(destination + i * 4, fill ? word : this.memory.read32(source + i * 4));
        this.cycles += words; return;
      }
      case 0x0e: // BgAffineSet / no-op fallback
      case 0x05: // VBlankIntrWait
      case 0x04: // IntrWait
      case 0x01: // RegisterRamReset
      case 0x02: // Halt
      case 0x03: // Stop
      case 0x00: // SoftReset
      default: this.cycles += 4; return;
    }
  }

  armLoadStore(instr) {
    const i = (instr >>> 25) & 1; const p = (instr >>> 24) & 1; const u = (instr >>> 23) & 1;
    const b = (instr >>> 22) & 1; const w = (instr >>> 21) & 1; const l = (instr >>> 20) & 1;
    const rn = (instr >>> 16) & 15; const rd = (instr >>> 12) & 15;
    const base = rn === 15 ? U32(this.r[rn] + 4) : this.r[rn];
    const offset = i ? this.shift(this.r[instr & 15], (instr >>> 5) & 3, (instr >>> 7) & 31).value : (instr & 0xfff);
    const adjusted = u ? U32(base + offset) : U32(base - offset);
    const address = p ? adjusted : base;
    if (l) this.r[rd] = b ? this.memory.read8(address) : this.memory.read32(address);
    else if (b) this.memory.write8(address, this.r[rd]) ; else this.memory.write32(address, this.r[rd]);
    if (!p || w) this.r[rn] = adjusted;
    this.cycles += l ? 3 : 2;
  }

  armHalfwordTransfer(instr) {
    const p = (instr >>> 24) & 1; const u = (instr >>> 23) & 1; const i = (instr >>> 22) & 1; const w = (instr >>> 21) & 1; const l = (instr >>> 20) & 1;
    const rn = (instr >>> 16) & 15; const rd = (instr >>> 12) & 15; const kind = (instr >>> 5) & 3; const base = rn === 15 ? U32(this.r[rn] + 4) : this.r[rn];
    const immediate = ((instr >>> 4) & 0xf0) | (instr & 0xf); const offset = i ? immediate : this.r[instr & 15]; const adjusted = u ? U32(base + offset) : U32(base - offset); const address = p ? adjusted : base;
    if (l) { if (kind === 1) this.r[rd] = this.memory.read16(address); else if (kind === 2) this.r[rd] = (this.memory.read8(address) << 24) >> 24; else this.r[rd] = (this.memory.read16(address) << 16) >> 16; }
    else this.memory.write16(address, this.r[rd]);
    if (!p || w) this.r[rn] = adjusted;
    this.cycles += 3;
  }

  armBlockTransfer(instr) {
    const l = (instr >>> 20) & 1; const w = (instr >>> 21) & 1; const u = (instr >>> 23) & 1; const p = (instr >>> 24) & 1;
    const rn = (instr >>> 16) & 15; const base = this.r[rn] >>> 0; let address; const regs = [];
    for (let i = 0; i < 16; i++) if (instr & (1 << i)) regs.push(i);
    let step = 4;
    if (u) address = U32(base + (p ? 4 : 0));
    else if (p) address = U32(base - regs.length * 4), step = 4;
    else address = U32(base - 4), step = -4;
    for (const reg of regs) {
      if (l) this.r[reg] = this.memory.read32(address); else this.memory.write32(address, this.r[reg]);
      address = U32(address + step);
    }
    if (w) this.r[rn] = u ? U32(base + regs.length * 4) : U32(base - regs.length * 4);
    this.cycles += 1 + regs.length;
  }

  armDataProcessing(instr) {
    const opcode = (instr >>> 21) & 15; const set = (instr >>> 20) & 1; const rn = (instr >>> 16) & 15; const rd = (instr >>> 12) & 15;
    const operand = this.armOperand(instr).value; const a = this.r[rn]; let result = 0;
    switch (opcode) {
      case 0: result = a & operand; break; case 1: result = a ^ operand; break; case 2: result = this.sub(a, operand, 1, set); break;
      case 3: result = this.sub(operand, a, 1, set); break; case 4: result = this.add(a, operand, 0, set); break;
      case 5: result = this.add(a, operand, this.c, set); break; case 6: result = this.sub(a, operand, this.c, set); break;
      case 7: result = this.sub(operand, a, this.c, set); break; case 8: result = a & operand; this.setFlags(result >>> 31, result === 0); break;
      case 9: result = a ^ operand; this.setFlags(result >>> 31, result === 0); break; case 10: this.sub(a, operand, 1, true); break;
      case 11: this.add(a, operand, 0, true); break; case 12: result = a | operand; break;
      case 13: result = operand; break; case 14: result = a & ~operand; break; case 15: result = ~operand; break;
      default: return;
    }
    if (opcode < 8 || opcode === 12 || opcode === 13 || opcode === 14 || opcode === 15) {
      if (set) this.setFlags(result >>> 31, result === 0);
      if (![8, 9, 10, 11].includes(opcode)) this.r[rd] = U32(result);
    }
    this.cycles += 1;
  }

  stepThumb() {
    const pc = this.r[15] >>> 0; const instr = this.memory.read16(pc); this.r[15] = U32(pc + 2); const before = this.cycles; this.stepThumbInstruction(instr); this.memory.tick(this.cycles - before); return this.cycles;
  }

  stepThumbInstruction(instr) {
    const op = instr >>> 11;
    if ((instr & 0xf800) === 0x1800) { // add/sub register/immediate
      const sub = (instr >>> 9) & 1; const immediate = (instr >>> 10) & 1; const rn = (instr >>> 3) & 7; const rd = instr & 7;
      const value = immediate ? ((instr >>> 6) & 7) : this.r[(instr >>> 6) & 7]; this.r[rd] = sub ? this.sub(this.r[rn], value) : this.add(this.r[rn], value); this.cycles++; return;
    }
    if ((instr & 0xe000) === 0x0000) { const type = (instr >>> 11) & 3; const amount = (instr >>> 6) & 31; const rs = (instr >>> 3) & 7; const rd = instr & 7; const out = this.shift(this.r[rs], type, amount); this.r[rd] = out.value; this.setFlags(out.value >>> 31, out.value === 0, out.carry); this.cycles++; return; }
    if ((instr & 0xe000) === 0x2000) { const opcode = (instr >>> 11) & 3; const rd = (instr >>> 8) & 7; const value = instr & 0xff; if (opcode === 0) this.r[rd] = value; else if (opcode === 1) this.sub(this.r[rd], value); else if (opcode === 2) this.r[rd] = this.add(this.r[rd], value); else this.r[rd] = this.sub(this.r[rd], value); this.cycles++; return; }
    if ((instr & 0xfc00) === 0x4000) { const opcode = (instr >>> 6) & 15; const rd = instr & 7; const rs = (instr >>> 3) & 7; const a = this.r[rd]; const b = this.r[rs]; let out = a; switch (opcode) { case 0: out = a & b; break; case 1: out = a ^ b; break; case 2: out = this.shift(a, 0, b & 31).value; break; case 3: out = this.shift(a, 1, b & 31).value; break; case 4: out = this.add(a, b); break; case 10: this.sub(a, b); this.cycles++; return; case 11: this.add(a, b); this.cycles++; return; case 12: out = a | b; break; case 13: out = U32(a * b); break; case 14: out = a & ~b; break; case 15: out = ~b; break; default: break; } this.r[rd] = U32(out); this.setFlags(out >>> 31, out === 0); this.cycles++; return; }
    if ((instr & 0xfc00) === 0x4400) { const opcode = (instr >>> 8) & 3; const rd = (instr & 7) | ((instr >>> 4) & 8); const rs = (instr >>> 3) & 15; if (opcode === 0) this.r[rd] = this.add(this.r[rd], this.r[rs]); else if (opcode === 1) this.sub(this.r[rd], this.r[rs]); else if (opcode === 2) this.r[rd] = this.r[rs]; else { const target = this.r[rs] >>> 0; this.r[15] = target & ~1; this.thumb = Boolean(target & 1); } this.cycles += 2; return; }
    if ((instr & 0xf800) === 0x4800) { const rd = (instr >>> 8) & 7; const address = ((this.r[15] & ~2) + 2 + ((instr & 0xff) << 2)) >>> 0; this.r[rd] = this.memory.read32(address); this.cycles += 2; return; }
    if ((instr & 0xf200) === 0x5000 || (instr & 0xe000) === 0x6000 || (instr & 0xf000) === 0x9000) { this.thumbLoadStore(instr); return; }
    if ((instr & 0xf600) === 0xb400) { const pop = instr & 0x0800; const include = instr & 0x0100; let sp = this.r[13]; if (!pop) { if (include) this.memory.write32(sp - 4, this.r[14]); for (let i = 7; i >= 0; i--) if (instr & (1 << i)) { sp -= 4; this.memory.write32(sp, this.r[i]); } } else { for (let i = 0; i < 8; i++) if (instr & (1 << i)) { this.r[i] = this.memory.read32(sp); sp += 4; } if (include) { this.r[15] = this.memory.read32(sp) & ~1; sp += 4; } } this.r[13] = sp; this.cycles += 2; return; }
    if ((instr & 0xf000) === 0xd000) { const cond = (instr >>> 8) & 15; let offset = (instr & 0xff) << 1; if (offset & 0x100) offset |= 0xfffffe00; if (cond !== 0xf && this.condition(cond)) this.r[15] = U32(this.r[15] + offset); this.cycles += 2; return; }
    if ((instr & 0xf800) === 0xe000) { let offset = (instr & 0x7ff) << 1; if (offset & 0x800) offset |= 0xfffff000; this.r[15] = U32(this.r[15] + offset); this.cycles += 2; return; }
    if ((instr & 0xf800) === 0xf000) { let offset = (instr & 0x7ff) << 12; if (offset & 0x400000) offset |= 0xff800000; this.r[14] = U32(this.r[15] + 2 + offset); this.cycles += 1; return; }
    if ((instr & 0xf800) === 0xf800) { const offset = (instr & 0x7ff) << 1; const target = U32(this.r[14] + offset); this.r[14] = U32((this.r[15] - 2) | 1); this.r[15] = target; this.cycles += 3; return; }
    this.cycles++;
  }

  thumbLoadStore(instr) {
    const l = (instr >>> 11) & 1; const byte = (instr >>> 12) & 1; const rd = instr & 7; const rb = (instr >>> 3) & 7; let offset;
    if ((instr & 0xf200) === 0x5000) offset = this.r[(instr >>> 6) & 7]; else if ((instr & 0xe000) === 0x6000) offset = ((instr >>> 6) & 0x1f) << (byte ? 0 : 2); else { offset = (instr & 0xff) << 2; }
    const address = U32(this.r[rb] + offset); if (l) this.r[rd] = byte ? this.memory.read8(address) : this.memory.read32(address); else if (byte) this.memory.write8(address, this.r[rd]); else this.memory.write32(address, this.r[rd]); this.cycles += 2;
  }
}

module.exports = { Arm7tdmi };
