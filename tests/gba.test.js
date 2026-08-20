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

test('PPU desenha um pixel no modo 3', () => {
  const memory = new GbaMemory(new Uint8Array(0x40));
  memory.write16(0x04000000, 3);
  memory.write16(0x06000000, 0x001f);
  const frame = new GbaPpu(memory).render();
  assert.equal(frame[0] & 0xff, 255);
  assert.equal((frame[0] >>> 8) & 0xff, 0);
});

test('ROM ARM mínima executa escrita de vídeo pelo barramento', () => {
  const words = [0xe59f0018, 0xe3a01003, 0xe58d1000, 0xe59f2010, 0xe3a0301f, 0xe5823000, 0xeafffffe, 0, 0x04000000, 0x06000000];
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
