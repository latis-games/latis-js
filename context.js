import { LatisEngine } from "./engine.js";

let kernelPromise = null;

export async function loadKernel() {
  if (!kernelPromise) kernelPromise = Promise.resolve(LatisEngine);
  return kernelPromise;
}

export function trikiContext() {
  return {
    mountEl: document.getElementById("mount"),
    bgEl: document.getElementById("bg-mount"),
    hitEl: document.getElementById("hit"),
    statusEl: document.getElementById("status"),
    hintEl: document.getElementById("hint"),
    get radio() {
      return window.__latisRadio;
    },
    loadKernel,
    onFirstPiece() {
      const radio = window.__latisRadio;
      if (radio && radio.play) radio.play();
    },
  };
}

export const hostContext = trikiContext;
