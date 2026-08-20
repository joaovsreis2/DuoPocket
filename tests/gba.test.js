'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { GbaMemory } = require('../src/emulator/gba/memory');
const { Arm7tdmi } = require('../src/emulator/gba/cpu');
const { GbaPpu } = require('../src/emulator/gba/ppu');

function romWithWords(words) {
  const rom = new Uint8Array(0x200);
  words.forEach((word, index) => { rom[index * 4] = word & 255; rom[index * 4 + 1] = word >>> 8; rom[index * 4 + 2] = word >>> 16; rom[index * 4 + 3] = word >>> 24; });
  return rom;
}

test('barramento GBA mapeia ROM, EWRAM e VRAM', () => {
  const memory = new GbaMemory(Uint8Array.from([0x12, 0x34, 0x56, 0x78]));
  assert.equal(memory.read32(0x08000000), 0x78563412);
  memory.write32(0x02000000, 0xaabbccdd);
  assert.equal(memory.read32(0x02000000), 0xaabbccdd);
  memory.write16(0x06000000, 0x7fff);
  assert.equal(memory.read16(0x06000000), 0x7fff);
});

test('ARM7TDMI executa MOV, ADD e STR/LDR imediatos', () => {
  const memory = new GbaMemory(romWithWords([0xe3a00001, 0xe2801002, 0xe58d1000, 0xe59d2000]));
  const cpu = new Arm7tdmi(memory);
  cpu.r[13] = 0x02000000;
  cpu.step(); cpu.step(); cpu.step(); cpu.step();
  assert.equal(cpu.r[0], 1);
  assert.equal(cpu.r[1], 3);
  assert.equal(cpu.r[2], 3);
});

test('ARM7TDMI executa instruções Thumb básicas', () => {
  const rom = new Uint8Array(0x40); rom[0] = 0x05; rom[1] = 0x20; rom[2] = 0x03; rom[3] = 0x30;
  const memory = new GbaMemory(rom); // MOVS r0,#5; ADDS r0,#3
  const cpu = new Arm7tdmi(memory); cpu.thumb = true;
  cpu.step(); cpu.step();
  assert.equal(cpu.r[0], 8);
});

test('BX preserva corretamente o estado ARM ou Thumb do destino', () => {
  const memory = new GbaMemory(romWithWords([0xe12fff10]));
  const cpu = new Arm7tdmi(memory); cpu.r[0] = 0x08000020; cpu.step();
  assert.equal(cpu.r[15], 0x08000020); assert.equal(cpu.thumb, false);
  cpu.reset(); cpu.r[0] = 0x08000021; cpu.step();
  assert.equal(cpu.r[15], 0x08000020); assert.equal(cpu.thumb, true);
});

test('STMDB/LDMIA atualiza a pilha com a ordem correta', () => {
  const memory = new GbaMemory(romWithWords([0xe92d0003, 0xe8bd0003]));
  const cpu = new Arm7tdmi(memory); cpu.r[13] = 0x02000020; cpu.r[0] = 0x11111111; cpu.r[1] = 0x22222222;
  cpu.step(); assert.equal(cpu.r[13], 0x02000018); assert.equal(memory.read32(0x02000018), 0x11111111); assert.equal(memory.read32(0x0200001c), 0x22222222);
  cpu.r[0] = 0; cpu.r[1] = 0; cpu.step(); assert.equal(cpu.r[0], 0x11111111); assert.equal(cpu.r[1], 0x22222222); assert.equal(cpu.r[13], 0x02000020);
});

test('BL Thumb retorna para a instrução seguinte e SWI Thumb é tratado', () => {
  const rom = new Uint8Array(0x40);
  rom[0] = 0x00; rom[1] = 0xf0; rom[2] = 0x02; rom[3] = 0xf8; // BL +4
  rom[8] = 0x08; rom[9] = 0xdf; rom[10] = 0x70; rom[11] = 0x47; // SWI Sqrt; BX LR
  const cpu = new Arm7tdmi(new GbaMemory(rom)); cpu.thumb = true; cpu.r[0] = 81;
  cpu.step(); cpu.step(); assert.equal(cpu.r[15], 0x08000008); assert.equal(cpu.r[14], 0x08000005);
  cpu.step(); assert.equal(cpu.r[0], 9); cpu.step(); assert.equal(cpu.r[15], 0x08000004);
});

test('PUSH/POP Thumb preserva registradores e endereço de retorno', () => {
  const rom = new Uint8Array(0x40); rom[0] = 0xf0; rom[1] = 0xb5; rom[2] = 0xf0; rom[3] = 0xbc; rom[4] = 0x00; rom[5] = 0xbd;
  const memory = new GbaMemory(rom); const cpu = new Arm7tdmi(memory); cpu.thumb = true; cpu.r[13] = 0x02000040; cpu.r[14] = 0x08000021;
  for (let i = 4; i <= 7; i++) cpu.r[i] = 0x100 + i;
  cpu.step(); assert.equal(cpu.r[13], 0x0200002c); for (let i = 4; i <= 7; i++) cpu.r[i] = 0;
  cpu.step(); cpu.step(); assert.equal(cpu.r[4], 0x104); assert.equal(cpu.r[7], 0x107); assert.equal(cpu.r[15], 0x08000020); assert.equal(cpu.thumb, true); assert.equal(cpu.r[13], 0x02000040);
});

test('LDMIA/STMIA Thumb copia blocos e atualiza registradores-base', () => {
  const rom = new Uint8Array(0x40); rom[0] = 0x03; rom[1] = 0xcb; rom[2] = 0x03; rom[3] = 0xc2;
  const memory = new GbaMemory(rom); memory.write32(0x02000000, 0x11111111); memory.write32(0x02000004, 0x22222222);
  const cpu = new Arm7tdmi(memory); cpu.thumb = true; cpu.r[3] = 0x02000000; cpu.r[2] = 0x02000020;
  cpu.step(); cpu.step(); assert.equal(cpu.r[3], 0x02000008); assert.equal(cpu.r[2], 0x02000028); assert.equal(memory.read32(0x02000020), 0x11111111); assert.equal(memory.read32(0x02000024), 0x22222222);
});

test('branch condicional Thumb usa PC visível com avanço de quatro bytes', () => {
  const rom = new Uint8Array(0x40); rom[0] = 0x00; rom[1] = 0x20; rom[2] = 0x00; rom[3] = 0x28; rom[4] = 0x00; rom[5] = 0xd0;
  const cpu = new Arm7tdmi(new GbaMemory(rom)); cpu.thumb = true; cpu.step(); cpu.step(); cpu.step();
  assert.equal(cpu.r[15], 0x08000008);
});

test('ALU Thumb implementa ASR, ADC, SBC, ROR, TST e NEG', () => {
  const rom = new Uint8Array(0x40); const ops = [0x4108, 0x4148, 0x4188, 0x41c8, 0x4208, 0x4248]; ops.forEach((op, i) => { rom[i * 2] = op; rom[i * 2 + 1] = op >>> 8; });
  const cpu = new Arm7tdmi(new GbaMemory(rom)); cpu.thumb = true; cpu.r[0] = 0xfffffff0; cpu.r[1] = 1;
  cpu.step(); assert.equal(cpu.r[0], 0xfffffff8); cpu.step(); assert.equal(cpu.r[0], 0xfffffff9); cpu.step(); assert.equal(cpu.r[0], 0xfffffff7);
  cpu.step(); assert.equal(cpu.r[0], 0xfffffffb); cpu.step(); assert.equal(cpu.z, 0); cpu.step(); assert.equal(cpu.r[0], 0xffffffff);
});

test('LDR/STR Thumb relativo ao SP não corrompe outros registradores-base', () => {
  const rom = new Uint8Array(0x40); rom[0] = 0x01; rom[1] = 0x90; rom[2] = 0x01; rom[3] = 0x99;
  const memory = new GbaMemory(rom); const cpu = new Arm7tdmi(memory); cpu.thumb = true; cpu.r[13] = 0x02000020; cpu.r[0] = 0x12345678; cpu.r[1] = 0;
  cpu.step(); cpu.step(); assert.equal(memory.read32(0x02000024), 0x12345678); assert.equal(cpu.r[1], 0x12345678); assert.equal(cpu.r[13], 0x02000020);
});

test('BIOS CpuSet respeita cópia de 16 bits sem sobrescrever bytes vizinhos', () => {
  const memory = new GbaMemory(new Uint8Array(0x40)); const cpu = new Arm7tdmi(memory); memory.write16(0x02000000, 0x1234); memory.write16(0x02000012, 0xabcd);
  cpu.r[0] = 0x02000000; cpu.r[1] = 0x02000010; cpu.r[2] = 1; cpu.handleSwi(0x0b);
  assert.equal(memory.read16(0x02000010), 0x1234); assert.equal(memory.read16(0x02000012), 0xabcd);
});

test('LDR literal Thumb usa PC+4 alinhado em quatro bytes', () => {
  const rom = new Uint8Array(0x40); rom[0] = 0x00; rom[1] = 0x48; rom[4] = 0x78; rom[5] = 0x56; rom[6] = 0x34; rom[7] = 0x12;
  const cpu = new Arm7tdmi(new GbaMemory(rom)); cpu.thumb = true; cpu.step(); assert.equal(cpu.r[0], 0x12345678);
});

test('BIOS SoftReset retorna ao início da ROM sem zerar ciclos', () => {
  const memory = new GbaMemory(new Uint8Array(0x40)); const cpu = new Arm7tdmi(memory); cpu.cycles = 100; cpu.thumb = true; cpu.r[15] = 0x08123456; cpu.handleSwi(0x00);
  assert.equal(cpu.r[15], 0x08000000); assert.equal(cpu.thumb, false); assert.equal(cpu.cycles, 104);
});

test('VBlank solicita IRQ e escrita em IF reconhece bits para limpar', () => {
  const memory = new GbaMemory(new Uint8Array(0x40)); memory.write16(0x04000004, 0x0008); memory.write16(0x04000200, 1); memory.write16(0x04000208, 1); memory.tick(1232 * 160);
  assert.equal(memory.read16(0x04000202) & 1, 1); assert.equal(memory.pendingInterrupt(), true); memory.write16(0x04000202, 1); assert.equal(memory.pendingInterrupt(), false);
});

test('data processing ARM lê PC como endereço da instrução mais oito', () => {
  const memory = new GbaMemory(romWithWords([0xe28fe000])); const cpu = new Arm7tdmi(memory); cpu.step(); assert.equal(cpu.r[14], 0x08000008);
});

test('BIOS LZ77 descompacta literais e referências para VRAM', () => {
  const rom = new Uint8Array(0x40); rom.set([0x10, 0x08, 0x00, 0x00, 0x10, 65, 66, 67, 0x20, 0x02], 0);
  const memory = new GbaMemory(rom); const cpu = new Arm7tdmi(memory); cpu.r[0] = 0x08000000; cpu.r[1] = 0x06000000; cpu.handleSwi(0x12);
  assert.deepEqual(Array.from(memory.vram.slice(0, 8)), [65, 66, 67, 65, 66, 67, 65, 66]);
});

test('PPU desenha um pixel no modo 3', () => {
  const memory = new GbaMemory(new Uint8Array(0x40));
  memory.write16(0x04000000, 3);
  memory.write16(0x06000000, 0x001f);
  const frame = new GbaPpu(memory).render();
  assert.equal(frame[0] & 0xff, 255);
  assert.equal((frame[0] >>> 8) & 0xff, 0);
});

test('PPU desenha BG3 de 256 cores no modo 0', () => {
  const memory = new GbaMemory(new Uint8Array());
  memory.write16(0x04000000, 0x0800); // BG3 habilitado
  memory.write16(0x0400000e, 0x0780); // 256 cores, mapa no bloco 7
  memory.write16(0x06003800, 1);
  memory.write8(0x06000040, 2); // primeiro pixel do tile 1
  memory.write16(0x05000004, 0x001f);
  const frame = new GbaPpu(memory).render();
  assert.notEqual(frame[0], frame[1]);
});

test('ROM ARM mínima executa escrita de vídeo pelo barramento', () => {
  const words = [0xe59f0018, 0xe3a01003, 0xe5801000, 0xe59f2010, 0xe3a0301f, 0xe5823000, 0xeafffffe, 0, 0x04000000, 0x06000000];
  const memory = new GbaMemory(romWithWords(words));
  const cpu = new Arm7tdmi(memory);
  for (let i = 0; i < 6; i++) cpu.step();
  assert.equal(memory.read16(0x04000000), 3);
  assert.equal(memory.read16(0x06000000), 0x1f);
});

test('DMA imediato copia palavras para VRAM e VCOUNT avança por scanline', () => {
  const memory = new GbaMemory(new Uint8Array(0x40));
  memory.write32(0x02000000, 0x11223344);
  memory.write32(0x040000b0, 0x02000000);
  memory.write32(0x040000b4, 0x06000000);
  memory.write16(0x040000b8, 1);
  memory.write16(0x040000ba, 0x8400);
  assert.equal(memory.read32(0x06000000), 0x11223344);
  memory.tick(1232);
  assert.equal(memory.read8(0x04000006), 1);
});

test('DMA inicia quando contagem e controle são escritos juntos em 32 bits', () => {
  const memory = new GbaMemory(new Uint8Array(0x40)); memory.write32(0x02000000, 0x89abcdef); memory.write32(0x040000d4, 0x02000000); memory.write32(0x040000d8, 0x03000000); memory.write32(0x040000dc, 0x84000001);
  assert.equal(memory.read32(0x03000000), 0x89abcdef);
});
