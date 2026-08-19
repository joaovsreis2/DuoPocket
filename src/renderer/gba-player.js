'use strict';

const { DuoGba } = require('../emulator/gba/gba');
const canvas = document.querySelector('#screen'); const ctx = canvas.getContext('2d', { alpha: false }); const image = ctx.createImageData(240, 160); const emulator = { value: null }; let running = true;

function paint(frame) { for (let i = 0; i < frame.length; i++) { const color = frame[i] >>> 0; image.data[i * 4] = color & 255; image.data[i * 4 + 1] = (color >>> 8) & 255; image.data[i * 4 + 2] = (color >>> 16) & 255; image.data[i * 4 + 3] = 255; } ctx.putImageData(image, 0, 0); }
function loop() { if (running && emulator.value) paint(emulator.value.runFrame()); requestAnimationFrame(loop); }
function keyName(event) { return ({ z: 'a', x: 'b', Enter: 'start', Shift: 'select', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', a: 'l', s: 'r' })[event.key]; }
window.addEventListener('keydown', (event) => { const key = keyName(event); if (key && emulator.value) { event.preventDefault(); emulator.value.setButton(key, true); } }); window.addEventListener('keyup', (event) => { const key = keyName(event); if (key && emulator.value) { event.preventDefault(); emulator.value.setButton(key, false); } });
document.querySelectorAll('[data-key]').forEach((button) => { const key = button.dataset.key; button.addEventListener('pointerdown', () => emulator.value?.setButton(key, true)); button.addEventListener('pointerup', () => emulator.value?.setButton(key, false)); button.addEventListener('pointerleave', () => emulator.value?.setButton(key, false)); });
document.querySelector('#pause').addEventListener('click', (event) => { running = !running; event.currentTarget.textContent = running ? 'Pausar' : 'Continuar'; }); document.querySelector('#reset').addEventListener('click', () => emulator.value?.reset());

async function init() { const payload = await window.duopocket.getRom(); if (!payload) { document.querySelector('#status').textContent = 'ROM indisponível'; return; } emulator.value = new DuoGba(payload.rom, payload.save); document.querySelector('#status').textContent = 'ARM7TDMI · vídeo próprio · SRAM'; loop(); setInterval(() => emulator.value && window.duopocket.saveRom(emulator.value.getSave()), 5000); }
init().catch((error) => { console.error(error); document.querySelector('#status').textContent = 'Erro ao carregar ROM'; });
