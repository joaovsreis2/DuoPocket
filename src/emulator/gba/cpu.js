'use strict';

const U32 = (value) => value >>> 0;
const S32 = (value) => value | 0;

class Arm7tdmi {
  constructor(memory) {
    this.memory = memory;
    this.r = new Uint32Array(16);
    this.cpsr = 0x1f;
    this.cycles = 0;
    this.clockScale = 1;
    this.irqContext = null;
    this.irqReturn = 0x01fffffc;
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
    if (type === 0) { if (amount > 32) return { value: 0, carry: 0 }; if (amount === 32) return { value: 0, carry: value & 1 }; return { value: U32(value << amount), carry: (value >>> (32 - amount)) & 1 }; }
    if (type === 1) { if (amount > 32) return { value: 0, carry: 0 }; if (amount === 32) return { value: 0, carry: value >>> 31 }; return { value: value >>> amount, carry: (value >>> (amount - 1)) & 1 }; }
    if (type === 2) { if (amount >= 32) return { value: (value >>> 31) ? 0xffffffff : 0, carry: value >>> 31 }; return { value: U32(S32(value) >> amount), carry: (value >>> (amount - 1)) & 1 }; }
    const rotate = amount & 31; if (!rotate) return { value, carry: value >>> 31 };
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
    let amount; if (instr & 0x10) amount = this.r[(instr >>> 8) & 15] & 0xff; else { amount = (instr >>> 7) & 31; if (!amount && type) { if (type === 3) return { value: U32((this.c << 31) | (value >>> 1)), carry: value & 1 }; amount = 32; } }
    return this.shift(value, type, amount, this.c);
  }

  step() {
    if (this.irqContext && (this.r[15] >>> 0) === this.irqReturn) { const context = this.irqContext; this.r.set(context.registers); this.cpsr = context.cpsr; this.irqContext = null; }
    if (!this.irqContext && !(this.cpsr & 0x80) && this.memory.pendingInterrupt()) this.enterInterrupt();
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
    const handler = this.memory.read32(0x03007ffc) >>> 0;
    if (!handler) return;
    this.irqContext = { registers: Uint32Array.from(this.r), cpsr: this.cpsr };
    this.r[14] = this.irqReturn | (handler & 1);
    this.r[15] = handler & ~1;
    this.thumb = Boolean(handler & 1);
    this.cpsr |= 0x80;
    this.cycles += 3;
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
      if (instr & 0x01000000) this.r[14] = this.r[15] >>> 0;
      this.r[15] = U32(this.r[15] + 4 + offset);
      this.cycles += 3; return;
    }
    if ((instr & 0x0fbf0fff) === 0x010f0000) { this.r[(instr >>> 12) & 15] = this.cpsr >>> 0; this.cycles++; return; }
    if ((instr & 0x0db0fff0) === 0x0120f000 || (instr & 0x0db0f000) === 0x0320f000) { const immediate = Boolean(instr & 0x02000000); const value = immediate ? this.armOperand(instr).value : this.r[instr & 15]; this.writePsr(value, (instr >>> 16) & 15); this.cycles++; return; }
    if ((instr & 0x0f8000f0) === 0x00800090) { const signed = Boolean(instr & 0x00400000); const accumulate = Boolean(instr & 0x00200000); const set = Boolean(instr & 0x00100000); const rdHi = (instr >>> 16) & 15; const rdLo = (instr >>> 12) & 15; const rm = instr & 15; const rs = (instr >>> 8) & 15; let result = signed ? BigInt(S32(this.r[rm])) * BigInt(S32(this.r[rs])) : BigInt(this.r[rm]) * BigInt(this.r[rs]); if (accumulate) result += (BigInt(this.r[rdHi]) << 32n) | BigInt(this.r[rdLo]); result &= 0xffffffffffffffffn; this.r[rdLo] = Number(result & 0xffffffffn); this.r[rdHi] = Number((result >> 32n) & 0xffffffffn); if (set) this.setFlags(this.r[rdHi] >>> 31, result === 0n); this.cycles += 3; return; }
    if ((instr & 0x0fb00ff0) === 0x01000090) { const byte = Boolean(instr & 0x00400000); const rn = (instr >>> 16) & 15; const rd = (instr >>> 12) & 15; const rm = instr & 15; const address = this.r[rn]; const old = byte ? this.memory.read8(address) : this.memory.read32(address); if (byte) this.memory.write8(address, this.r[rm]); else this.memory.write32(address, this.r[rm]); this.r[rd] = old; this.cycles += 4; return; }
    if ((instr & 0x0e000090) === 0x00000090 && (instr & 0x0fc000f0) !== 0x00000090) { this.armHalfwordTransfer(instr); return; }
    if ((instr & 0x0c000000) === 0x04000000) { this.armLoadStore(instr); return; }
    if ((instr & 0x0e000000) === 0x08000000) { this.armBlockTransfer(instr); return; }
    if ((instr & 0x0fc000f0) === 0x00000090) {
      const rd = (instr >>> 16) & 15; const rn = (instr >>> 12) & 15; const rm = instr & 15; const rs = (instr >>> 8) & 15;
      this.r[rd] = U32(Math.imul(this.r[rm], this.r[rs]) + ((instr & 0x00200000) ? this.r[rn] : 0)); if (instr & 0x00100000) this.setFlags(this.r[rd] >>> 31, this.r[rd] === 0);
      this.cycles += 2; return;
    }
    if ((instr & 0x0f000000) === 0x0f000000) { this.handleSwi(instr & 0xff); return; }
    if ((instr & 0x0c000000) === 0) { this.armDataProcessing(instr); return; }
    this.cycles += 1;
  }

  writePsr(value, fields) { let mask = 0; if (fields & 1) mask |= 0x000000ff; if (fields & 2) mask |= 0x0000ff00; if (fields & 4) mask |= 0x00ff0000; if (fields & 8) mask |= 0xff000000; this.cpsr = U32((this.cpsr & ~mask) | (value & mask)); }

  handleSwi(code) {
    // BIOS calls used by commercial games. These are deterministic local
    // implementations; the real BIOS is intentionally not redistributed.
    switch (code) {
      case 0x00: { // SoftReset
        const elapsed = this.cycles; this.r.fill(0); this.r[13] = 0x03007f00; this.r[15] = 0x08000000; this.cpsr = 0x1f; this.cycles = elapsed + 4; return;
      }
      case 0x01: { // RegisterRamReset
        this.memory.registerRamReset(this.r[0] & 0xff); this.cycles += 4; return;
      }
      case 0x06: { // Div
        const numerator = S32(this.r[0]); const denominator = S32(this.r[1]);
        if (denominator) { const quotient = (numerator / denominator) | 0; this.r[0] = U32(quotient); this.r[1] = U32(numerator - quotient * denominator); this.r[3] = U32(Math.abs(quotient)); }
        this.cycles += 4; return;
      }
      case 0x08: { // Sqrt
        this.r[0] = Math.floor(Math.sqrt(this.r[0] >>> 0)) >>> 0; this.cycles += 4; return;
      }
      case 0x09: { // ArcTan2 (fixed-point approximation)
        const tangent = ((this.r[0] << 16) >> 16) / 16384; this.r[0] = Math.round(Math.atan(tangent) * 32768 / Math.PI) & 0xffff; this.cycles += 4; return;
      }
      case 0x0a: { const x = (this.r[0] << 16) >> 16; const y = (this.r[1] << 16) >> 16; this.r[0] = Math.round(Math.atan2(y, x) * 32768 / Math.PI) & 0xffff; this.cycles += 4; return; }
      case 0x0b: { // CpuSet: unidades de halfword ou word
        const source = this.r[0] >>> 0; const destination = this.r[1] >>> 0; const count = this.r[2] & 0x1fffff; const fill = Boolean(this.r[2] & 0x01000000); const wordMode = Boolean(this.r[2] & 0x04000000); const width = wordMode ? 4 : 2; const fixed = wordMode ? this.memory.read32(source) : this.memory.read16(source);
        for (let i = 0; i < count; i++) { const value = fill ? fixed : (wordMode ? this.memory.read32(source + i * width) : this.memory.read16(source + i * width)); if (wordMode) this.memory.write32(destination + i * width, value); else this.memory.write16(destination + i * width, value); }
        this.cycles += count; return;
      }
      case 0x0c: { // CpuFastSet: blocos de oito words
        const source = this.r[0] >>> 0; const destination = this.r[1] >>> 0; const words = (this.r[2] & 0x1fffff) & ~7; const fill = Boolean(this.r[2] & 0x01000000); const fixed = this.memory.read32(source);
        for (let i = 0; i < words; i++) this.memory.write32(destination + i * 4, fill ? fixed : this.memory.read32(source + i * 4));
        this.cycles += words; return;
      }
      case 0x0e: this.bgAffineSet(this.r[0] >>> 0, this.r[1] >>> 0, this.r[2] >>> 0); return;
      case 0x0f: this.objAffineSet(this.r[0] >>> 0, this.r[1] >>> 0, this.r[2] >>> 0, this.r[3] >>> 0); return;
      case 0x10: this.bitUnpack(this.r[0] >>> 0, this.r[1] >>> 0, this.r[2] >>> 0); return;
      case 0x11: // LZ77UnCompWram
      case 0x12: { // LZ77UnCompVram
        this.lz77Uncompress(this.r[0] >>> 0, this.r[1] >>> 0); return;
      }
      case 0x13: this.huffmanUncompress(this.r[0] >>> 0, this.r[1] >>> 0); return;
      case 0x14: // RLUnCompWram
      case 0x15: this.rlUncompress(this.r[0] >>> 0, this.r[1] >>> 0); return;
      case 0x16: // Diff8bitUnFilterWram
      case 0x17: this.diff8Unfilter(this.r[0] >>> 0, this.r[1] >>> 0); return;
      case 0x18: this.diff16Unfilter(this.r[0] >>> 0, this.r[1] >>> 0); return;
      case 0x05: // VBlankIntrWait
      case 0x04: // IntrWait
      case 0x02: // Halt
      case 0x03: // Stop
      default: this.cycles += 4; return;
    }
  }

  lz77Uncompress(source, destination) {
    const header = this.memory.read32(source); const length = header >>> 8; source = U32(source + 4); const output = new Uint8Array(length); let position = 0;
    while (position < length) {
      const flags = this.memory.read8(source++);
      for (let bit = 7; bit >= 0 && position < length; bit--) {
        if (!(flags & (1 << bit))) output[position++] = this.memory.read8(source++);
        else { const first = this.memory.read8(source++); const second = this.memory.read8(source++); const count = (first >>> 4) + 3; const distance = ((first & 15) << 8) + second + 1; for (let i = 0; i < count && position < length; i++) { const from = position - distance; output[position++] = from >= 0 ? output[from] : 0; } }
      }
    }
    for (let index = 0; index < output.length; index++) this.memory.write8(destination + index, output[index]);
    this.cycles += Math.max(4, output.length);
  }

  writeBiosOutput(destination, output) { for (let index = 0; index < output.length; index++) this.memory.write8(destination + index, output[index]); this.cycles += Math.max(4, output.length); }

  affineParameters(scaleX, scaleY, angle) { const radians = ((angle >>> 8) & 0xff) * Math.PI * 2 / 256; const cosine = Math.cos(radians); const sine = Math.sin(radians); const sx = scaleX || 0x100; const sy = scaleY || 0x100; return { pa: Math.trunc(cosine * 65536 / sx), pb: Math.trunc(-sine * 65536 / sx), pc: Math.trunc(sine * 65536 / sy), pd: Math.trunc(cosine * 65536 / sy) }; }

  bgAffineSet(source, destination, count) { for (let index = 0; index < count; index++, source += 20, destination += 16) { const texX = S32(this.memory.read32(source)); const texY = S32(this.memory.read32(source + 4)); const scrX = (this.memory.read16(source + 8) << 16) >> 16; const scrY = (this.memory.read16(source + 10) << 16) >> 16; const scaleX = this.memory.read16(source + 12); const scaleY = this.memory.read16(source + 14); const angle = this.memory.read16(source + 16); const { pa, pb, pc, pd } = this.affineParameters(scaleX, scaleY, angle); this.memory.write16(destination, pa); this.memory.write16(destination + 2, pb); this.memory.write16(destination + 4, pc); this.memory.write16(destination + 6, pd); this.memory.write32(destination + 8, U32(texX - pa * scrX - pb * scrY)); this.memory.write32(destination + 12, U32(texY - pc * scrX - pd * scrY)); } this.cycles += Math.max(4, count * 8); }

  objAffineSet(source, destination, count, offset) { for (let index = 0; index < count; index++, source += 8, destination += offset * 4) { const scaleX = this.memory.read16(source); const scaleY = this.memory.read16(source + 2); const angle = this.memory.read16(source + 4); const { pa, pb, pc, pd } = this.affineParameters(scaleX, scaleY, angle); this.memory.write16(destination, pa); this.memory.write16(destination + offset, pb); this.memory.write16(destination + offset * 2, pc); this.memory.write16(destination + offset * 3, pd); } this.cycles += Math.max(4, count * 4); }

  bitUnpack(source, destination, info) { const sourceLength = this.memory.read16(info); const sourceWidth = this.memory.read8(info + 2); const destinationWidth = this.memory.read8(info + 3); const offsetControl = this.memory.read32(info + 4); const addZero = Boolean(offsetControl & 0x80000000); const offset = offsetControl & 0x7fffffff; const sourceMask = (1 << sourceWidth) - 1; let outputWord = 0; let outputBits = 0; for (let byteIndex = 0; byteIndex < sourceLength; byteIndex++) { const packed = this.memory.read8(source + byteIndex); for (let bit = 0; bit < 8; bit += sourceWidth) { let value = (packed >>> bit) & sourceMask; if (value || addZero) value = U32(value + offset); if (destinationWidth === 32) { this.memory.write32(destination, value); destination += 4; } else { outputWord = U32(outputWord | (value << outputBits)); outputBits += destinationWidth; if (outputBits >= 32) { this.memory.write32(destination, outputWord); destination += 4; outputWord = 0; outputBits = 0; } } } } if (outputBits) this.memory.write32(destination, outputWord); this.cycles += Math.max(4, sourceLength); }

  rlUncompress(source, destination) {
    const length = this.memory.read32(source) >>> 8; source = U32(source + 4); const output = new Uint8Array(length); let position = 0;
    while (position < length) { const control = this.memory.read8(source++); const compressed = Boolean(control & 0x80); const count = (control & 0x7f) + (compressed ? 3 : 1); if (compressed) { const value = this.memory.read8(source++); for (let i = 0; i < count && position < length; i++) output[position++] = value; } else for (let i = 0; i < count && position < length; i++) output[position++] = this.memory.read8(source++); }
    this.writeBiosOutput(destination, output);
  }

  diff8Unfilter(source, destination) {
    const length = this.memory.read32(source) >>> 8; source = U32(source + 4); const output = new Uint8Array(length); if (length) output[0] = this.memory.read8(source++); for (let index = 1; index < length; index++) output[index] = (output[index - 1] + this.memory.read8(source++)) & 0xff; this.writeBiosOutput(destination, output);
  }

  diff16Unfilter(source, destination) {
    const length = this.memory.read32(source) >>> 8; source = U32(source + 4); const output = new Uint8Array(length); let previous = this.memory.read16(source); source += 2; if (length >= 2) { output[0] = previous; output[1] = previous >>> 8; } for (let index = 2; index + 1 < length; index += 2) { previous = (previous + this.memory.read16(source)) & 0xffff; source += 2; output[index] = previous; output[index + 1] = previous >>> 8; } this.writeBiosOutput(destination, output);
  }

  huffmanUncompress(source, destination) {
    const header = this.memory.read32(source); const length = header >>> 8; const bitsPerSymbol = header & 15; const treeSize = this.memory.read8(source + 4); const tree = U32(source + 5); let stream = U32((tree + (treeSize + 1) * 2 + 3) & ~3); const symbols = []; let word = 0; let bitsLeft = 0;
    while (symbols.length * bitsPerSymbol < length * 8) { let nodeAddress = tree; while (true) { const node = this.memory.read8(nodeAddress); if (!bitsLeft) { word = this.memory.read32(stream); stream += 4; bitsLeft = 32; } const right = Boolean(word & 0x80000000); word = U32(word << 1); bitsLeft--; const child = nodeAddress + ((node & 0x3f) + 1) * 2 + (right ? 1 : 0); const leaf = node & (right ? 0x80 : 0x40); if (leaf) { symbols.push(this.memory.read8(child)); break; } nodeAddress = child; } }
    const output = new Uint8Array(length); if (bitsPerSymbol === 4) for (let index = 0; index < symbols.length && (index >> 1) < length; index++) output[index >> 1] |= (symbols[index] & 15) << ((index & 1) * 4); else for (let index = 0; index < length; index++) output[index] = symbols[index] || 0; this.writeBiosOutput(destination, output);
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
    else address = U32(base - Math.max(0, regs.length - 1) * 4), step = 4;
    for (const reg of regs) {
      if (l) this.r[reg] = this.memory.read32(address); else this.memory.write32(address, this.r[reg]);
      address = U32(address + step);
    }
    if (w) this.r[rn] = u ? U32(base + regs.length * 4) : U32(base - regs.length * 4);
    this.cycles += 1 + regs.length;
  }

  armDataProcessing(instr) {
    const opcode = (instr >>> 21) & 15; const set = (instr >>> 20) & 1; const rn = (instr >>> 16) & 15; const rd = (instr >>> 12) & 15;
    const shifted = this.armOperand(instr); const operand = shifted.value; const a = rn === 15 ? U32(this.r[rn] + 4) : this.r[rn]; let result = 0;
    switch (opcode) {
      case 0: result = a & operand; break; case 1: result = a ^ operand; break; case 2: result = this.sub(a, operand, 1, set); break;
      case 3: result = this.sub(operand, a, 1, set); break; case 4: result = this.add(a, operand, 0, set); break;
      case 5: result = this.add(a, operand, this.c, set); break; case 6: result = this.sub(a, operand, this.c, set); break;
      case 7: result = this.sub(operand, a, this.c, set); break; case 8: result = a & operand; this.setFlags(result >>> 31, result === 0, shifted.carry); break;
      case 9: result = a ^ operand; this.setFlags(result >>> 31, result === 0, shifted.carry); break; case 10: this.sub(a, operand, 1, true); break;
      case 11: this.add(a, operand, 0, true); break; case 12: result = a | operand; break;
      case 13: result = operand; break; case 14: result = a & ~operand; break; case 15: result = ~operand; break;
      default: return;
    }
    if (opcode < 8 || opcode === 12 || opcode === 13 || opcode === 14 || opcode === 15) {
      if (set) { const logical = opcode === 0 || opcode === 1 || opcode >= 12; this.setFlags(result >>> 31, result === 0, logical ? shifted.carry : this.c, this.v); }
      if (![8, 9, 10, 11].includes(opcode)) this.r[rd] = U32(result);
    }
    this.cycles += 1;
  }

  stepThumb() {
    const pc = this.r[15] >>> 0; const instr = this.memory.read16(pc); this.r[15] = U32(pc + 2); const before = this.cycles; this.stepThumbInstruction(instr); this.memory.tick((this.cycles - before) * this.clockScale); return this.cycles;
  }

  stepThumbInstruction(instr) {
    const op = instr >>> 11;
    if ((instr & 0xff00) === 0xdf00) { this.handleSwi(instr & 0xff); return; }
    if ((instr & 0xf800) === 0x1800) { // add/sub register/immediate
      const sub = (instr >>> 9) & 1; const immediate = (instr >>> 10) & 1; const rn = (instr >>> 3) & 7; const rd = instr & 7;
      const value = immediate ? ((instr >>> 6) & 7) : this.r[(instr >>> 6) & 7]; this.r[rd] = sub ? this.sub(this.r[rn], value) : this.add(this.r[rn], value); this.cycles++; return;
    }
    if ((instr & 0xe000) === 0x0000) { const type = (instr >>> 11) & 3; let amount = (instr >>> 6) & 31; if (!amount && type) amount = 32; const rs = (instr >>> 3) & 7; const rd = instr & 7; const out = this.shift(this.r[rs], type, amount); this.r[rd] = out.value; this.setFlags(out.value >>> 31, out.value === 0, out.carry); this.cycles++; return; }
    if ((instr & 0xe000) === 0x2000) { const opcode = (instr >>> 11) & 3; const rd = (instr >>> 8) & 7; const value = instr & 0xff; if (opcode === 0) this.r[rd] = value; else if (opcode === 1) this.sub(this.r[rd], value); else if (opcode === 2) this.r[rd] = this.add(this.r[rd], value); else this.r[rd] = this.sub(this.r[rd], value); this.cycles++; return; }
    if ((instr & 0xfc00) === 0x4000) {
      const opcode = (instr >>> 6) & 15; const rd = instr & 7; const rs = (instr >>> 3) & 7; const a = this.r[rd]; const b = this.r[rs]; let out; let shifted;
      switch (opcode) {
        case 0: out = a & b; break;
        case 1: out = a ^ b; break;
        case 2: shifted = this.shift(a, 0, b & 0xff); out = shifted.value; break;
        case 3: shifted = this.shift(a, 1, b & 0xff); out = shifted.value; break;
        case 4: shifted = this.shift(a, 2, b & 0xff); out = shifted.value; break;
        case 5: this.r[rd] = this.add(a, b, this.c); this.cycles++; return;
        case 6: this.r[rd] = this.sub(a, b, this.c); this.cycles++; return;
        case 7: shifted = this.shift(a, 3, b & 0xff); out = shifted.value; break;
        case 8: out = a & b; this.setFlags(out >>> 31, out === 0); this.cycles++; return;
        case 9: this.r[rd] = this.sub(0, b); this.cycles++; return;
        case 10: this.sub(a, b); this.cycles++; return;
        case 11: this.add(a, b); this.cycles++; return;
        case 12: out = a | b; break;
        case 13: out = U32(a * b); break;
        case 14: out = a & ~b; break;
        case 15: out = ~b; break;
      }
      this.r[rd] = U32(out); this.setFlags(out >>> 31, out === 0, shifted ? shifted.carry : this.c); this.cycles++; return;
    }
    if ((instr & 0xfc00) === 0x4400) { const opcode = (instr >>> 8) & 3; const rd = (instr & 7) | ((instr >>> 4) & 8); const rs = (instr >>> 3) & 15; if (opcode === 0) this.r[rd] = this.add(this.r[rd], this.r[rs]); else if (opcode === 1) this.sub(this.r[rd], this.r[rs]); else if (opcode === 2) this.r[rd] = this.r[rs]; else { const target = this.r[rs] >>> 0; this.r[15] = target & ~1; this.thumb = Boolean(target & 1); } this.cycles += 2; return; }
    if ((instr & 0xf800) === 0x4800) { const rd = (instr >>> 8) & 7; const address = ((((this.r[15] + 2) & ~3) + ((instr & 0xff) << 2))) >>> 0; this.r[rd] = this.memory.read32(address); this.cycles += 2; return; }
    if ((instr & 0xf000) === 0x5000 || (instr & 0xe000) === 0x6000 || (instr & 0xf000) === 0x8000 || (instr & 0xf000) === 0x9000) { this.thumbLoadStore(instr); return; }
    if ((instr & 0xf000) === 0xa000) { const rd = (instr >>> 8) & 7; const base = (instr & 0x0800) ? this.r[13] : U32((this.r[15] + 2) & ~3); this.r[rd] = U32(base + ((instr & 0xff) << 2)); this.cycles++; return; }
    if ((instr & 0xff00) === 0xb000) { const amount = (instr & 0x7f) << 2; this.r[13] = (instr & 0x80) ? U32(this.r[13] - amount) : U32(this.r[13] + amount); this.cycles++; return; }
    if ((instr & 0xf600) === 0xb400) { const pop = instr & 0x0800; const include = instr & 0x0100; let sp = this.r[13]; if (!pop) { let count = include ? 1 : 0; for (let i = 0; i < 8; i++) if (instr & (1 << i)) count++; sp = U32(sp - count * 4); let address = sp; for (let i = 0; i < 8; i++) if (instr & (1 << i)) { this.memory.write32(address, this.r[i]); address += 4; } if (include) this.memory.write32(address, this.r[14]); } else { for (let i = 0; i < 8; i++) if (instr & (1 << i)) { this.r[i] = this.memory.read32(sp); sp += 4; } if (include) { const target = this.memory.read32(sp); this.r[15] = target & ~1; this.thumb = Boolean(target & 1); sp += 4; } } this.r[13] = sp; this.cycles += 2; return; }
    if ((instr & 0xf000) === 0xc000) { const load = Boolean(instr & 0x0800); const rb = (instr >>> 8) & 7; const list = instr & 0xff; let address = this.r[rb] >>> 0; let count = 0; for (let i = 0; i < 8; i++) if (list & (1 << i)) { if (load) this.r[i] = this.memory.read32(address); else this.memory.write32(address, this.r[i]); address = U32(address + 4); count++; } if (count) this.r[rb] = address; this.cycles += 1 + count; return; }
    if ((instr & 0xf000) === 0xd000) { const cond = (instr >>> 8) & 15; let offset = (instr & 0xff) << 1; if (offset & 0x100) offset |= 0xfffffe00; if (cond !== 0xf && this.condition(cond)) this.r[15] = U32(this.r[15] + 2 + offset); this.cycles += 2; return; }
    if ((instr & 0xf800) === 0xe000) { let offset = (instr & 0x7ff) << 1; if (offset & 0x800) offset |= 0xfffff000; this.r[15] = U32(this.r[15] + 2 + offset); this.cycles += 2; return; }
    if ((instr & 0xf800) === 0xf000) { let offset = (instr & 0x7ff) << 12; if (offset & 0x400000) offset |= 0xff800000; this.r[14] = U32(this.r[15] + 2 + offset); this.cycles += 1; return; }
    if ((instr & 0xf800) === 0xf800) { const offset = (instr & 0x7ff) << 1; const target = U32(this.r[14] + offset); this.r[14] = U32(this.r[15] | 1); this.r[15] = target; this.cycles += 3; return; }
    this.cycles++;
  }

  thumbLoadStore(instr) {
    const rd = instr & 7;
    if ((instr & 0xf000) === 0x5000) {
      const op = (instr >>> 9) & 7; const rb = (instr >>> 3) & 7; const ro = (instr >>> 6) & 7; const address = U32(this.r[rb] + this.r[ro]);
      if (op === 0) this.memory.write32(address, this.r[rd]); else if (op === 1) this.memory.write16(address, this.r[rd]); else if (op === 2) this.memory.write8(address, this.r[rd]); else if (op === 3) this.r[rd] = U32((this.memory.read8(address) << 24) >> 24); else if (op === 4) this.r[rd] = this.memory.read32(address); else if (op === 5) this.r[rd] = this.memory.read16(address); else if (op === 6) this.r[rd] = this.memory.read8(address); else this.r[rd] = U32((this.memory.read16(address) << 16) >> 16);
      this.cycles += 2; return;
    }
    if ((instr & 0xf000) === 0x9000) { const load = Boolean(instr & 0x0800); const spRd = (instr >>> 8) & 7; const address = U32(this.r[13] + ((instr & 0xff) << 2)); if (load) this.r[spRd] = this.memory.read32(address); else this.memory.write32(address, this.r[spRd]); this.cycles += 2; return; }
    if ((instr & 0xf000) === 0x8000) { const load = Boolean(instr & 0x0800); const rb = (instr >>> 3) & 7; const address = U32(this.r[rb] + (((instr >>> 6) & 0x1f) << 1)); if (load) this.r[rd] = this.memory.read16(address); else this.memory.write16(address, this.r[rd]); this.cycles += 2; return; }
    const load = Boolean(instr & 0x0800); const byte = Boolean(instr & 0x1000); const rb = (instr >>> 3) & 7; const offset = ((instr >>> 6) & 0x1f) << (byte ? 0 : 2); const address = U32(this.r[rb] + offset); if (load) this.r[rd] = byte ? this.memory.read8(address) : this.memory.read32(address); else if (byte) this.memory.write8(address, this.r[rd]); else this.memory.write32(address, this.r[rd]); this.cycles += 2;
  }
}

module.exports = { Arm7tdmi };
