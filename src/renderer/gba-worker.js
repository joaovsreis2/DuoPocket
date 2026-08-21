'use strict';

const { DuoGba } = require('../emulator/gba/gba');

const FRAME_MS = 1000 / 59.7275;
let emulator = null;
let running = true;
let speed = 1;
let nextFrameAt = 0;
let timer = null;
let lastPaintAt = 0;
let statsStartedAt = 0;
let emulatedFrames = 0;

function schedule(delay = 0) {
  clearTimeout(timer);
  timer = setTimeout(run, delay);
}

function run() {
  if (!emulator || !running) { nextFrameAt = performance.now() + FRAME_MS; schedule(FRAME_MS); return; }
  const started = performance.now();
  const draw = speed === 1 || started - lastPaintAt >= FRAME_MS;
  const result = emulator.runFrame(draw);
  const audio = emulator.takeAudio();
  emulatedFrames++;
  if (draw) { const frame = Uint32Array.from(result); postMessage({ type: 'frame', pixels: frame.buffer }, [frame.buffer]); lastPaintAt = performance.now(); }
  if (speed === 1 && audio.samples.length) postMessage({ type: 'audio', samples: audio.samples.buffer, sampleRate: audio.sampleRate }, [audio.samples.buffer]);
  const now = performance.now();
  if (now - statsStartedAt >= 1000) { const fps = emulatedFrames * 1000 / (now - statsStartedAt); postMessage({ type: 'stats', fps, speed }); statsStartedAt = now; emulatedFrames = 0; }
  nextFrameAt = Math.max(nextFrameAt + FRAME_MS / speed, now);
  schedule(Math.max(0, nextFrameAt - performance.now()));
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'init') {
    emulator = new DuoGba(new Uint8Array(message.rom), message.save ? new Uint8Array(message.save) : null);
    nextFrameAt = performance.now(); lastPaintAt = 0; statsStartedAt = nextFrameAt; emulatedFrames = 0;
    postMessage({ type: 'ready' });
    schedule();
  } else if (message.type === 'button') emulator?.setButton(message.key, message.down);
  else if (message.type === 'pause') running = !message.paused;
  else if (message.type === 'speed') { speed = [1, 2, 4].includes(Number(message.value)) ? Number(message.value) : 1; nextFrameAt = performance.now(); }
  else if (message.type === 'reset') emulator?.reset();
  else if (message.type === 'save' && emulator) { const save = emulator.getSave(); postMessage({ type: 'save', bytes: save.buffer, requestId: message.requestId }, [save.buffer]); }
};
