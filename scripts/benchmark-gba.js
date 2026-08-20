'use strict';

const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const { DuoGba } = require('../src/emulator/gba/gba');

const file = process.argv[2];
const frames = Number(process.env.DUO_BENCH_FRAMES || 300);
if (!file) throw new Error('Informe a ROM local para o benchmark.');
const emulator = new DuoGba(fs.readFileSync(file));
const started = performance.now();
for (let frame = 0; frame < frames; frame++) emulator.runFrame();
const elapsed = performance.now() - started;
process.stdout.write(JSON.stringify({ frames, elapsedMs: Math.round(elapsed), fps: Number((frames * 1000 / elapsed).toFixed(2)), pc: `0x${emulator.cpu.r[15].toString(16)}` }));
