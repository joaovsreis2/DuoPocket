'use strict';

const { DuoGba } = require('../emulator/gba/gba');

const FRAME_MS = 1000 / 59.7275;
let emulator = null;
let running = true;
let nextFrameAt = 0;
let timer = null;

function schedule(delay = 0) {
  clearTimeout(timer);
  timer = setTimeout(run, delay);
}

function run() {
  if (!emulator || !running) { nextFrameAt = performance.now() + FRAME_MS; schedule(FRAME_MS); return; }
  const frame = Uint32Array.from(emulator.runFrame(true));
  postMessage({ type: 'frame', pixels: frame.buffer }, [frame.buffer]);
  nextFrameAt = Math.max(nextFrameAt + FRAME_MS, performance.now());
  schedule(Math.max(0, nextFrameAt - performance.now()));
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'init') {
    emulator = new DuoGba(new Uint8Array(message.rom), message.save ? new Uint8Array(message.save) : null);
    nextFrameAt = performance.now();
    postMessage({ type: 'ready' });
    schedule();
  } else if (message.type === 'button') emulator?.setButton(message.key, message.down);
  else if (message.type === 'pause') running = !message.paused;
  else if (message.type === 'reset') emulator?.reset();
  else if (message.type === 'save' && emulator) { const save = emulator.getSave(); postMessage({ type: 'save', bytes: save.buffer }, [save.buffer]); }
};
