"use strict";
(() => {
  // src/renderer/gba-player.js
  var canvas = document.querySelector("#screen");
  var ctx = canvas.getContext("2d", { alpha: false });
  var image = ctx.createImageData(240, 160);
  var imageWords = new Uint32Array(image.data.buffer);
  var status = document.querySelector("#status");
  var speedControl = document.querySelector("#speed");
  var worker = null;
  var running = true;
  var speed = 1;
  var audioContext = null;
  var audioGain = null;
  var audioNextTime = 0;
  function paint(frame) {
    imageWords.set(frame);
    ctx.putImageData(image, 0, 0);
  }
  function ensureAudio() {
    if (!audioContext) {
      audioContext = new AudioContext({ latencyHint: "interactive" });
      audioGain = audioContext.createGain();
      audioGain.gain.value = 0.75;
      audioGain.connect(audioContext.destination);
    }
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {
    });
  }
  function playAudio(samples, sampleRate) {
    if (!audioContext || audioContext.state !== "running" || speed !== 1 || !samples.length) return;
    const frames = samples.length >>> 1;
    const buffer = audioContext.createBuffer(2, frames, sampleRate || 32768);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let index = 0; index < frames; index++) {
      left[index] = samples[index * 2] / 32768;
      right[index] = samples[index * 2 + 1] / 32768;
    }
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioGain);
    const now = audioContext.currentTime;
    if (audioNextTime < now || audioNextTime > now + 0.25) audioNextTime = now + 0.04;
    source.start(audioNextTime);
    audioNextTime += frames / buffer.sampleRate;
  }
  function keyName(event) {
    return { z: "a", x: "b", Enter: "start", Shift: "select", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", a: "l", s: "r" }[event.key];
  }
  function button(key, down) {
    worker?.postMessage({ type: "button", key, down });
  }
  function setSpeed(value) {
    speed = [1, 2, 4].includes(Number(value)) ? Number(value) : 1;
    speedControl.value = String(speed);
    audioNextTime = 0;
    worker?.postMessage({ type: "speed", value: speed });
  }
  window.addEventListener("keydown", (event) => {
    ensureAudio();
    if (event.key.toLowerCase() === "f" && !event.repeat && event.target?.tagName !== "SELECT") {
      event.preventDefault();
      setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1);
      return;
    }
    const key = keyName(event);
    if (key) {
      event.preventDefault();
      button(key, true);
    }
  });
  window.addEventListener("keyup", (event) => {
    const key = keyName(event);
    if (key) {
      event.preventDefault();
      button(key, false);
    }
  });
  window.addEventListener("pointerdown", ensureAudio, { capture: true });
  document.querySelectorAll("[data-key]").forEach((control) => {
    const key = control.dataset.key;
    control.addEventListener("pointerdown", () => button(key, true));
    control.addEventListener("pointerup", () => button(key, false));
    control.addEventListener("pointercancel", () => button(key, false));
    control.addEventListener("pointerleave", () => button(key, false));
  });
  document.querySelector("#pause").addEventListener("click", (event) => {
    running = !running;
    worker?.postMessage({ type: "pause", paused: !running });
    event.currentTarget.textContent = running ? "Pausar" : "Continuar";
  });
  document.querySelector("#reset").addEventListener("click", () => worker?.postMessage({ type: "reset" }));
  speedControl.addEventListener("change", () => setSpeed(speedControl.value));
  async function init() {
    const payload = await window.duopocket.getRom();
    if (!payload) {
      status.textContent = "ROM indispon\xEDvel";
      return;
    }
    worker = new Worker("./gba-worker-bundle.js");
    worker.onmessage = async (event) => {
      const message = event.data || {};
      if (message.type === "frame") paint(new Uint32Array(message.pixels));
      else if (message.type === "audio") playAudio(new Int16Array(message.samples), message.sampleRate);
      else if (message.type === "ready") status.textContent = "ARM7TDMI \xB7 iniciando \xB7 1\xD7 \xB7 \xE1udio \xB7 Flash 1M";
      else if (message.type === "stats") status.textContent = `ARM7TDMI \xB7 ${message.fps.toFixed(0)} FPS \xB7 ${message.speed}\xD7 \xB7 \xE1udio \xB7 Flash 1M`;
      else if (message.type === "save") {
        await window.duopocket.saveRom(new Uint8Array(message.bytes));
        if (message.requestId === "close") await window.duopocket.gameCloseReady();
      }
    };
    worker.onerror = (error) => {
      console.error(error);
      status.textContent = "Erro no n\xFAcleo GBA";
    };
    const rom = Uint8Array.from(payload.rom);
    const save = payload.save ? Uint8Array.from(payload.save) : null;
    worker.postMessage({ type: "init", rom: rom.buffer, save: save?.buffer || null }, save ? [rom.buffer, save.buffer] : [rom.buffer]);
    setInterval(() => worker?.postMessage({ type: "save", requestId: "periodic" }), 5e3);
    window.duopocket.onBeforeGameClose(() => {
      if (worker) worker.postMessage({ type: "save", requestId: "close" });
      else window.duopocket.gameCloseReady();
    });
  }
  init().catch((error) => {
    console.error(error);
    status.textContent = "Erro ao carregar ROM";
  });
})();
