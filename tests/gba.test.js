'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { GbaMemory } = require('../src/emulator/gba/memory');
const { Arm7tdmi } = require('../src/emulator/gba/cpu');
const { GbaPpu } = require('../src/emulator/gba/ppu');
const { DuoGba } = require('../src/emulator/gba/gba');

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

test('barramento GBA espelha RAM, paleta, VRAM e OAM como o hardware', () => {
  const memory = new GbaMemory(new Uint8Array());
  memory.write32(0x02000000, 0x11223344);
  memory.write32(0x03000000, 0x55667788);
  memory.write16(0x05000000, 0x1234);
  memory.write16(0x06010000, 0x5678);
  memory.write16(0x07000000, 0x9abc);
  assert.equal(memory.read32(0x02040000), 0x11223344);
  assert.equal(memory.read32(0x03008000), 0x55667788);
  assert.equal(memory.read16(0x05000400), 0x1234);
  assert.equal(memory.read16(0x06018000), 0x5678);
  assert.equal(memory.read16(0x07000400), 0x9abc);
});

test('KEYINPUT inicia com todos os botões soltos', () => {
  const memory = new GbaMemory(new Uint8Array()); assert.equal(memory.read16(0x04000130), 0x03ff);
});

test('registradores affine iniciam com matriz identidade, como após a BIOS', () => {
  const memory = new GbaMemory(new Uint8Array());
  assert.equal(memory.read16(0x04000020), 0x0100); assert.equal(memory.read16(0x04000026), 0x0100);
  assert.equal(memory.read16(0x04000030), 0x0100); assert.equal(memory.read16(0x04000036), 0x0100);
  memory.write16(0x04000020, 0); memory.registerRamReset(0x80); assert.equal(memory.read16(0x04000020), 0x0100);
});

test('save state restaura CPU, memória e botões', () => {
  const gba = new DuoGba(new Uint8Array()); gba.cpu.r[3] = 123; gba.memory.write32(0x02000000, 0x12345678); gba.setButton('a', true); const state = gba.saveState(); gba.cpu.r[3] = 0; gba.memory.write32(0x02000000, 0); gba.setButton('a', false); gba.loadState(state); assert.equal(gba.cpu.r[3], 123); assert.equal(gba.memory.read32(0x02000000), 0x12345678); assert.equal(gba.memory.read16(0x04000130) & 1, 0);
});

test('um frame avança exatamente 280896 clocks do hardware', () => {
  const gba = new DuoGba(new Uint8Array()); let hardwareCycles = 0; const tick = gba.memory.tick.bind(gba.memory); gba.memory.tick = (cycles) => { hardwareCycles += cycles; tick(cycles); }; gba.runFrame(false); assert.equal(hardwareCycles, 280896);
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

test('STMDA armazena registradores em endereços ascendentes', () => {
  const memory = new GbaMemory(romWithWords([0xe8240007])); const cpu = new Arm7tdmi(memory); cpu.r[0] = 1; cpu.r[1] = 2; cpu.r[2] = 3; cpu.r[4] = 0x02000008; cpu.step(); assert.equal(memory.read32(0x02000000), 1); assert.equal(memory.read32(0x02000004), 2); assert.equal(memory.read32(0x02000008), 3); assert.equal(cpu.r[4], 0x01fffffc);
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

test('BIOS CpuFastSet conta words e não multiplica o comprimento por oito', () => {
  const memory = new GbaMemory(new Uint8Array()); const cpu = new Arm7tdmi(memory); for (let index = 0; index < 12; index++) memory.write32(0x02000000 + index * 4, index + 1); cpu.r[0] = 0x02000000; cpu.r[1] = 0x02000100; cpu.r[2] = 8; cpu.handleSwi(0x0c); assert.equal(memory.read32(0x0200011c), 8); assert.equal(memory.read32(0x02000120), 0);
});

test('BIOS BgAffineSet produz matriz identidade e origem ajustada', () => {
  const memory = new GbaMemory(new Uint8Array()); const cpu = new Arm7tdmi(memory); memory.write32(0x02000000, 10 << 8); memory.write32(0x02000004, 20 << 8); memory.write16(0x02000008, 2); memory.write16(0x0200000a, 3); memory.write16(0x0200000c, 0x100); memory.write16(0x0200000e, 0x100); cpu.r[0] = 0x02000000; cpu.r[1] = 0x02000100; cpu.r[2] = 1; cpu.handleSwi(0x0e); assert.equal(memory.read16(0x02000100), 0x100); assert.equal(memory.read16(0x02000106), 0x100); assert.equal(memory.read32(0x02000108), 8 << 8); assert.equal(memory.read32(0x0200010c), 17 << 8);
});

test('BIOS BitUnPack expande pixels compactados e aplica offset', () => {
  const memory = new GbaMemory(new Uint8Array()); const cpu = new Arm7tdmi(memory); memory.write8(0x02000000, 0b11100100); memory.write16(0x02000010, 1); memory.write8(0x02000012, 2); memory.write8(0x02000013, 8); memory.write32(0x02000014, 1); cpu.r[0] = 0x02000000; cpu.r[1] = 0x02000100; cpu.r[2] = 0x02000010; cpu.handleSwi(0x10); assert.deepEqual(Array.from(memory.ewram.slice(0x100, 0x104)), [0, 2, 3, 4]);
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

test('BL ARM retorna para a instrução imediatamente seguinte', () => {
  const memory = new GbaMemory(romWithWords([0xeb000002, 0xe3a01002, 0, 0, 0xe3a00001, 0xe12fff1e])); const cpu = new Arm7tdmi(memory); cpu.step(); cpu.step(); cpu.step(); cpu.step(); assert.equal(cpu.r[0], 1); assert.equal(cpu.r[1], 2); assert.equal(cpu.r[15], 0x08000008);
});

test('ARM executa MLA, UMULL e acesso ao CPSR', () => {
  const memory = new GbaMemory(romWithWords([0xe0203291, 0xe0810392, 0xe128f004, 0xe10f5000])); const cpu = new Arm7tdmi(memory); cpu.r[1] = 4; cpu.r[2] = 3; cpu.r[3] = 2; cpu.r[4] = 0xa0000000; cpu.step(); assert.equal(cpu.r[0], 14); cpu.step(); assert.equal(cpu.r[0], 6); assert.equal(cpu.r[1], 0); cpu.step(); cpu.step(); assert.equal((cpu.r[5] & 0xf0000000) >>> 0, 0xa0000000);
});

test('shifts ARM e Thumb tratam deslocamento imediato zero como 32', () => {
  const memory = new GbaMemory(romWithWords([0xe1b00021])); const cpu = new Arm7tdmi(memory); cpu.r[1] = 0x80000000; cpu.step(); assert.equal(cpu.r[0], 0); assert.equal(cpu.c, 1);
  cpu.thumb = true; cpu.r[15] = 0x02000000; memory.write16(0x02000000, 0x0808); cpu.r[1] = 0x80000000; cpu.step(); assert.equal(cpu.r[0], 0); assert.equal(cpu.c, 1);
});

test('BIOS LZ77 descompacta literais e referências para VRAM', () => {
  const rom = new Uint8Array(0x40); rom.set([0x10, 0x08, 0x00, 0x00, 0x10, 65, 66, 67, 0x20, 0x02], 0);
  const memory = new GbaMemory(rom); const cpu = new Arm7tdmi(memory); cpu.r[0] = 0x08000000; cpu.r[1] = 0x06000000; cpu.handleSwi(0x12);
  assert.deepEqual(Array.from(memory.vram.slice(0, 8)), [65, 66, 67, 65, 66, 67, 65, 66]);
});

test('BIOS descompacta RLE e filtros diferenciais', () => {
  const rom = new Uint8Array(0x40); rom.set([0x30, 6, 0, 0, 0x82, 7, 0, 9], 0); rom.set([0x80, 4, 0, 0, 1, 2, 0xff, 1], 0x10);
  const memory = new GbaMemory(rom); const cpu = new Arm7tdmi(memory); cpu.r[0] = 0x08000000; cpu.r[1] = 0x02000000; cpu.handleSwi(0x14); assert.deepEqual(Array.from(memory.ewram.slice(0, 6)), [7, 7, 7, 7, 7, 9]);
  cpu.r[0] = 0x08000010; cpu.r[1] = 0x02000010; cpu.handleSwi(0x16); assert.deepEqual(Array.from(memory.ewram.slice(0x10, 0x14)), [1, 3, 2, 3]);
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

test('PPU preserva preto opaco e forced blank branco', () => {
  const memory = new GbaMemory(new Uint8Array()); memory.write16(0x04000000, 0x0100); memory.write16(0x04000008, 0x0100); memory.write16(0x06000800, 1); memory.write8(0x06000020, 1); memory.write16(0x05000000, 0x001f); memory.write16(0x05000002, 0x0000);
  const ppu = new GbaPpu(memory); const frame = ppu.render(); assert.notEqual(frame[0], frame[1]);
  memory.write16(0x04000000, 0x0080); assert.equal(ppu.render()[0] >>> 0, ppu.color15(0x7fff) >>> 0);
});

test('PPU desenha fundo afim no modo 2 e bitmap no modo 5', () => {
  const memory = new GbaMemory(new Uint8Array()); const ppu = new GbaPpu(memory);
  memory.write16(0x04000000, 0x0402); memory.write16(0x0400000c, 0x0100); memory.write16(0x04000020, 0x0100); memory.write16(0x04000026, 0x0100); memory.write8(0x06000800, 1); memory.write8(0x06000040, 2); memory.write16(0x05000004, 0x03e0);
  assert.notEqual(ppu.render()[0], ppu.render()[1]);
  memory.write16(0x04000000, 5); memory.write16(0x06000000, 0x7c00); assert.equal((ppu.render()[0] >>> 16) & 0xff, 255);
});

test('PPU respeita máscara de janela e brilho do GBA', () => {
  const memory = new GbaMemory(new Uint8Array()); const ppu = new GbaPpu(memory); memory.write16(0x05000000, 0x0000); memory.write16(0x04000050, 0x00a0); memory.write16(0x04000054, 16);
  const bright = ppu.render()[0]; assert.equal(bright >>> 0, ppu.color15(0x7fff) >>> 0);
  memory.write16(0x04000000, 0x2100); memory.write16(0x04000040, 0x00f0); memory.write16(0x04000044, 0x00a0); memory.write16(0x04000048, 0); memory.write16(0x04000050, 0); memory.write16(0x04000008, 0x0100); memory.write16(0x06000800, 1); memory.write8(0x06000020, 1); memory.write16(0x05000002, 0x001f);
  assert.equal(ppu.render()[0] >>> 0, ppu.color15(0) >>> 0);
});

test('PPU usa a metade OBJ da paleta para sprites', () => {
  const memory = new GbaMemory(new Uint8Array()); const ppu = new GbaPpu(memory); memory.write16(0x04000000, 0x1040); memory.write16(0x07000000, 0); memory.write16(0x07000002, 0); memory.write16(0x07000004, 0); memory.write8(0x06010000, 1); memory.write16(0x05000002, 0x001f); memory.write16(0x05000202, 0x7c00); assert.equal(ppu.render()[0], ppu.color15(0x7c00));
});

test('PPU trata índice zero como transparente em qualquer banco OBJ', () => {
  const memory = new GbaMemory(new Uint8Array()); const ppu = new GbaPpu(memory);
  memory.write16(0x04000000, 0x1000); memory.write16(0x05000000, 0x001f); memory.write16(0x05000220, 0x03e0);
  memory.write16(0x07000000, 0); memory.write16(0x07000002, 0); memory.write16(0x07000004, 0x1000);
  memory.write8(0x06010000, 0);
  assert.equal(ppu.render()[0], ppu.color15(0x001f));
});

test('PPU mistura primeira e segunda camadas com BLDALPHA', () => {
  const memory = new GbaMemory(new Uint8Array()); const ppu = new GbaPpu(memory);
  memory.write16(0x04000000, 0x0300); memory.write16(0x04000008, 0x0100); memory.write16(0x0400000a, 0x0201);
  memory.write16(0x06000800, 1); memory.write16(0x06001000, 0x1001); memory.write8(0x06000020, 0x11);
  memory.write16(0x05000002, 0x001f); memory.write16(0x05000022, 0x7c00);
  memory.write16(0x04000050, 0x0241); memory.write16(0x04000052, 0x0808);
  const color = ppu.render()[0]; assert.equal(color & 0xff, 123); assert.equal((color >>> 16) & 0xff, 123);
});

test('PPU invalida o quadro quando muda a seleção de BG no DISPCNT', () => {
  const memory = new GbaMemory(new Uint8Array()); const ppu = new GbaPpu(memory);
  memory.write16(0x04000008, 0x0100); memory.write16(0x0400000a, 0x0200); memory.write16(0x06000800, 1); memory.write16(0x06001000, 0x1001); memory.write8(0x06000020, 0x11); memory.write16(0x05000002, 0x001f); memory.write16(0x05000022, 0x7c00);
  memory.write16(0x04000000, 0x0100); assert.equal(ppu.render()[0], ppu.color15(0x001f));
  memory.write16(0x04000000, 0x0200); assert.equal(ppu.render()[0], ppu.color15(0x7c00));
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

test('DMA3 inicia ao escrever controle de 16 bits em 0x040000DE', () => {
  const memory = new GbaMemory(new Uint8Array()); memory.write32(0x02000000, 0x76543210); memory.write32(0x040000d4, 0x02000000); memory.write32(0x040000d8, 0x06000000); memory.write16(0x040000dc, 1); memory.write16(0x040000de, 0x8400); assert.equal(memory.read32(0x06000000), 0x76543210);
});

test('Direct Sound consome FIFO por timer e repõe dados com DMA especial', () => {
  const memory = new GbaMemory(new Uint8Array()); for (let index = 0; index < 64; index++) memory.write8(0x02000000 + index, 0x7f);
  memory.write16(0x04000082, 0x0304); memory.write16(0x04000084, 0x0080);
  memory.write32(0x040000bc, 0x02000000); memory.write32(0x040000c0, 0x040000a0); memory.write32(0x040000c4, 0xb6000004);
  assert.equal(memory.audioFifos[0].length, 16); assert.equal(memory.dmaSource[1], 0x02000010);
  memory.write16(0x04000100, 0xfe00); memory.write16(0x04000102, 0x0080); memory.tick(512);
  const audio = memory.takeAudio(); assert.equal(audio.sampleRate, 32768); assert.deepEqual(Array.from(audio.samples), [16256, 16256]); assert.equal(memory.audioFifos[0].length, 31); assert.equal(memory.dmaSource[1], 0x02000020);
});

test('Flash 1M identifica, grava e troca bancos de 64 KiB', () => {
  const memory = new GbaMemory(new Uint8Array());
  const command = (value) => { memory.write8(0x0e005555, 0xaa); memory.write8(0x0e002aaa, 0x55); memory.write8(0x0e005555, value); };
  command(0x90); assert.equal(memory.read8(0x0e000000), 0x62); assert.equal(memory.read8(0x0e000001), 0x13); memory.write8(0x0e000000, 0xf0);
  command(0xa0); memory.write8(0x0e000123, 0x5a); assert.equal(memory.read8(0x0e000123), 0x5a);
  command(0xb0); memory.write8(0x0e000000, 1); assert.equal(memory.read8(0x0e000123), 0xff);
  command(0xa0); memory.write8(0x0e000123, 0xa5); assert.equal(memory.read8(0x0e000123), 0xa5);
  command(0xb0); memory.write8(0x0e000000, 0); assert.equal(memory.read8(0x0e000123), 0x5a); assert.equal(memory.getSave().length, 0x20000);
});

test('timers recarregam, geram IRQ e operam em cascata', () => {
  const memory = new GbaMemory(new Uint8Array());
  memory.write16(0x04000100, 0xfffe); memory.write16(0x04000104, 0xffff);
  memory.write16(0x04000106, 0x0084); memory.write16(0x04000102, 0x00c0);
  memory.tick(2);
  assert.equal(memory.read16(0x04000100), 0xfffe);
  assert.equal(memory.read16(0x04000104), 0xffff);
  assert.equal(memory.read16(0x04000202) & 0x0008, 0x0008);
  memory.tick(2);
  assert.equal(memory.read16(0x04000104), 0xffff);
});
