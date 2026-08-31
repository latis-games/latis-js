import { PLAYER_CSS } from "./css.js";
import {
  songUrl,
  isSafariFamily,
  skipKind,
  deckReady,
  clamp01,
  wrapIndex,
  AUDIO_VIS_HIDE,
  fillLogSpectrum,
} from "./lib.js";

const VOL_KEY = "lmp.volume";
const DEFAULT_VOL = 0.55;
const SKIP_FADE_SEC = 0.45;
const END_FADE_SEC = 4;
const PRELOAD_SEC = 10;
const EQ_SEGS = 8;
const EQ_MIN_BARS = 8;
const EQ_MAX_BARS = 64;

const ICONS = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2.2v14H6V5zm3.4 7 8.6 6.2V5.8L9.4 12z"/></svg>',
  play: '<svg class="lmp-icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5L8 5.5z"/></svg>',
  pause: '<svg class="lmp-icon-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.4v14H7V5zm6.6 0H17v14h-3.4V5z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.8 5H18v14h-2.2V5zM6 18.2V5.8L14.6 12 6 18.2z"/></svg>',
  speaker: '<svg class="lmp-icon-speaker" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.8v12.4L7.2 14.5H4V9.5zm11.1 1.1a3.2 3.2 0 0 1 0 2.8l-1.3-.7a1.7 1.7 0 0 0 0-1.4l1.3-.7zm1.9-2.3a6.2 6.2 0 0 1 0 7.4l-1.3-.8a4.7 4.7 0 0 0 0-5.8l1.3-.8z"/></svg>',
  speakerOff: '<svg class="lmp-icon-speaker-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.8v12.4L7.2 14.5H4V9.5zm15.7-3.2 1.4 1.4-3.2 3.2 3.2 3.2-1.4 1.4-3.2-3.2-3.2 3.2-1.4-1.4 3.2-3.2-3.2-3.2 1.4-1.4 3.2 3.2 3.2-3.2z"/></svg>',
};

function loadVol() {
  try {
    const raw = localStorage.getItem(VOL_KEY);
    if (raw == null || raw === "") return DEFAULT_VOL;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? clamp01(n) : DEFAULT_VOL;
  } catch {
    return DEFAULT_VOL;
  }
}

function saveVol(v) {
  try { localStorage.setItem(VOL_KEY, String(v)); } catch { /* private mode */ }
}

function injectCss() {
  if (typeof document === "undefined") return;
  if (document.getElementById("lmp-css")) return;
  const style = document.createElement("style");
  style.id = "lmp-css";
  style.textContent = PLAYER_CSS;
  document.head.appendChild(style);
}

function makeAudio() {
  const el = document.createElement("audio");
  el.className = "lmp-audio";
  el.setAttribute("playsinline", "true");
  el.setAttribute("webkit-playsinline", "true");
  el.setAttribute("preload", "auto");
  el.setAttribute("aria-hidden", "true");
  // controls so UA audio:not([controls]){display:none} does not match.
  el.setAttribute("controls", "");
  el.playsInline = true;
  el.controls = true;
  el.loop = false;
  el.muted = false;
  el.style.cssText = AUDIO_VIS_HIDE;
  el.style.setProperty("display", "block", "important");
  return el;
}

function setSrc(node, url) {
  if (!node || !url) return;
  if (node.dataset.lmpSrc === url && (node.getAttribute("src") || node.currentSrc)) return;
  node.dataset.lmpSrc = url;
  node.preload = "auto";
  node.src = url;
  node.setAttribute("src", url);
}

function disarmLoop(node) {
  node.loop = false;
  node.removeAttribute("loop");
}

function setDeckVol(node, v) {
  try { node.volume = clamp01(v); } catch { /* iOS may ignore */ }
}

function warmUrl(url) {
  if (!url) return;
  try { fetch(url, { cache: "force-cache", credentials: "same-origin" }).catch(function () {}); } catch { /* ignore */ }
}

/**
 * Mount a generic AAC-LC player into `rootEl`.
 * @param {HTMLElement} rootEl
 * @param {{ mediaBase?: string, songs?: string[] }} [opts]
 */
export async function mountPlayer(rootEl, opts) {
  if (!rootEl) throw new Error("latis-music-player: root element required");
  const mediaBase = (opts && opts.mediaBase) || "/media/";
  const songs = ((opts && opts.songs) || []).filter(function (t) { return t != null && String(t).trim() !== ""; }).map(String);

  injectCss();
  rootEl.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "lmp-player" + (songs.length ? "" : " is-empty");
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", "Now playing");

  const elA = makeAudio();
  const elB = makeAudio();
  wrap.appendChild(elA);
  wrap.appendChild(elB);

  const eqWrap = document.createElement("div");
  eqWrap.className = "lmp-eq-wrap";
  eqWrap.setAttribute("aria-hidden", "true");
  const eqCanvas = document.createElement("canvas");
  eqCanvas.className = "lmp-eq";
  eqCanvas.width = 280;
  eqCanvas.height = 48;
  eqWrap.appendChild(eqCanvas);
  wrap.appendChild(eqWrap);

  const titleEl = document.createElement("p");
  titleEl.className = "lmp-title";
  wrap.appendChild(titleEl);

  const controls = document.createElement("div");
  controls.className = "lmp-controls";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "lmp-prev";
  prevBtn.setAttribute("aria-label", "Previous track");
  prevBtn.innerHTML = ICONS.prev;
  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "lmp-play";
  playBtn.setAttribute("aria-label", "Play");
  playBtn.innerHTML = ICONS.play + ICONS.pause;
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "lmp-next";
  nextBtn.setAttribute("aria-label", "Next track");
  nextBtn.innerHTML = ICONS.next;
  const muteBtn = document.createElement("button");
  muteBtn.type = "button";
  muteBtn.className = "lmp-mute";
  muteBtn.setAttribute("aria-pressed", "false");
  muteBtn.setAttribute("aria-label", "Mute");
  muteBtn.innerHTML = ICONS.speaker + ICONS.speakerOff;
  controls.appendChild(prevBtn);
  controls.appendChild(playBtn);
  controls.appendChild(nextBtn);
  controls.appendChild(muteBtn);
  wrap.appendChild(controls);

  const volWrap = document.createElement("div");
  volWrap.className = "lmp-vol-wrap";
  const volInput = document.createElement("input");
  volInput.className = "lmp-vol";
  volInput.type = "range";
  volInput.min = "0";
  volInput.max = "100";
  volInput.step = "1";
  volInput.setAttribute("aria-label", "Volume");
  const volPctEl = document.createElement("span");
  volPctEl.className = "lmp-vol-pct";
  volPctEl.hidden = true;
  volWrap.appendChild(volInput);
  volWrap.appendChild(volPctEl);
  wrap.appendChild(volWrap);

  rootEl.appendChild(wrap);

  const safari = isSafariFamily();
  let el = elA;
  let other = elB;
  let index = 0;
  let wantPlay = false;
  let muted = false;
  let vol = loadVol();
  if (!Number.isFinite(vol) || vol <= 0.2) {
    vol = DEFAULT_VOL;
    saveVol(vol);
  }
  let playedOnce = false;
  let advancing = false;
  let ignoreEnded = false;
  let incomingUnlocked = false;
  let incomingIndex = -1;
  let fading = false;
  let fadeMode = "cross";
  let fadeSec = SKIP_FADE_SEC;
  let fadeOutAmt = 1;
  let fadeInAmt = 0;
  let fadeStart = 0;
  let fadeRaf = 0;
  let fadeInStarted = false;
  let warmedNext = -1;
  let destroyed = false;

  let audioCtx = null;
  let analyser = null;
  let freqBins = null;
  let hooked = new WeakSet();
  let graphWired = false;

  let eqCtx = null;
  let eqRafOn = false;
  let eqBarCount = 16;
  let eqLevels = new Float32Array(eqBarCount);
  let lastEqEnergy = 0;

  function urlOf(i) {
    return songUrl(mediaBase, songs[i] || "");
  }

  function emitTitle() {
    const t = songs[index] || "";
    titleEl.textContent = t || (songs.length ? "" : "No tracks");
  }

  function outputLevel() {
    return muted ? 0 : vol;
  }

  function applyDeckVolumes() {
    const out = outputLevel();
    const a = fading ? fadeOutAmt : 1;
    const b = fading ? fadeInAmt : 0;
    setDeckVol(el, out * a);
    setDeckVol(other, out * b);
  }

  function applyOutput() {
    applyDeckVolumes();
    const shown = muted ? 0 : vol;
    const pctNum = Math.round(shown * 100);
    if (document.activeElement !== volInput) volInput.value = String(pctNum);
    wrap.style.setProperty("--lmp-vol", pctNum + "%");
    volPctEl.textContent = pctNum + "%";
    wrap.classList.toggle("is-muted", muted);
    muteBtn.classList.toggle("is-muted", muted);
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
  }

  function isAudible() {
    return wantPlay && !el.paused && !el.ended && !!(el.getAttribute("src") || el.currentSrc);
  }

  function syncPlayUi() {
    const playing = wantPlay && !el.paused;
    playBtn.classList.toggle("is-playing", playing);
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  function hookDeck(node) {
    if (safari || !audioCtx || !analyser) return;
    if (hooked.has(node)) return;
    try {
      const src = audioCtx.createMediaElementSource(node);
      src.connect(analyser);
      hooked.add(node);
    } catch {
      /* already hooked or element not ready */
    }
  }

  function unlockGraph() {
    if (safari) return;
    if (!playedOnce) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      if (!audioCtx) audioCtx = new AC();
      if (!analyser) {
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.32;
        freqBins = new Uint8Array(analyser.frequencyBinCount);
      }
      hookDeck(el);
      if (!graphWired) {
        analyser.connect(audioCtx.destination);
        graphWired = true;
      }
    } catch (err) {
      console.warn("lmp graph", err);
    }
    if (audioCtx && audioCtx.state === "suspended") {
      try { audioCtx.resume(); } catch { /* gesture may still resume */ }
    }
    applyOutput();
  }

  function afterElementPlay() {
    playedOnce = true;
    unlockGraph();
    applyOutput();
    syncPlayUi();
    kickEq();
  }

  function unlockIncoming() {
    if (incomingUnlocked) return;
    incomingUnlocked = true;
    try {
      other.muted = true;
      other.volume = 0;
      const p = other.play();
      function done() {
        try { other.pause(); } catch { /* ignore */ }
        other.muted = false;
        try { other.currentTime = 0; } catch { /* ignore */ }
      }
      if (p && typeof p.then === "function") p.then(done).catch(done);
      else done();
    } catch {
      incomingUnlocked = false;
    }
  }

  function play() {
    if (!songs.length) return;
    wantPlay = true;
    muted = false;
    el.muted = false;
    if (!Number.isFinite(vol) || vol <= 0) {
      vol = DEFAULT_VOL;
      saveVol(vol);
    }
    try { el.volume = vol; } catch { /* iOS may ignore */ }
    const url = urlOf(index);
    if (url) setSrc(el, url);
    disarmLoop(el);
    unlockIncoming();
    const p = el.play();
    if (p && typeof p.then === "function") {
      p.then(afterElementPlay).catch(function (err) {
        console.warn("lmp play() failed", err);
        syncPlayUi();
      });
    } else if (!el.paused) {
      afterElementPlay();
    }
    applyOutput();
    syncPlayUi();
  }

  function stopFade(keepIncoming) {
    fading = false;
    if (fadeRaf) {
      try { cancelAnimationFrame(fadeRaf); } catch { /* ignore */ }
      fadeRaf = 0;
    }
    fadeOutAmt = 1;
    fadeInAmt = 0;
    incomingIndex = -1;
    if (!keepIncoming) {
      try { other.pause(); } catch { /* ignore */ }
      try { other.removeAttribute("src"); other.removeAttribute("data-lmp-src"); other.src = ""; delete other.dataset.lmpSrc; } catch { /* ignore */ }
    }
  }

  function finishCrossfade() {
    if (!fading) return;
    fading = false;
    if (fadeRaf) {
      try { cancelAnimationFrame(fadeRaf); } catch { /* ignore */ }
      fadeRaf = 0;
    }
    try { el.pause(); } catch { /* ignore */ }
    try { el.currentTime = 0; } catch { /* ignore */ }
    const outgoing = el;
    el = other;
    other = outgoing;
    try { other.pause(); } catch { /* ignore */ }
    try { other.removeAttribute("src"); other.removeAttribute("data-lmp-src"); other.src = ""; delete other.dataset.lmpSrc; } catch { /* ignore */ }
    fadeOutAmt = 1;
    fadeInAmt = 0;
    if (incomingIndex >= 0) index = incomingIndex;
    incomingIndex = -1;
    warmedNext = -1;
    ignoreEnded = true;
    window.setTimeout(function () { ignoreEnded = false; }, 400);
    hookDeck(el);
    emitTitle();
    applyOutput();
    syncPlayUi();
    kickEq();
  }

  function tickFade() {
    fadeRaf = 0;
    if (!fading) return;
    const span = fadeMode === "fade" ? fadeSec * 2 : fadeSec;
    const k = Math.min(1, Math.max(0, (performance.now() - fadeStart) / (span * 1000)));
    if (fadeMode === "fade") {
      if (k < 0.5) {
        fadeOutAmt = 1 - k * 2;
        fadeInAmt = 0;
      } else {
        fadeOutAmt = 0;
        fadeInAmt = (k - 0.5) * 2;
        if (!fadeInStarted) {
          fadeInStarted = true;
          const p = other.play();
          if (p && typeof p.then === "function") {
            p.catch(function () { /* unlock from the skip tap may still apply */ });
          }
        }
      }
    } else {
      fadeOutAmt = 1 - k;
      fadeInAmt = k;
    }
    applyDeckVolumes();
    if (k >= 1) {
      finishCrossfade();
      return;
    }
    fadeRaf = requestAnimationFrame(tickFade);
  }

  function armIncoming(i) {
    const n = wrapIndex(i, songs.length);
    incomingIndex = n;
    const url = urlOf(n);
    setSrc(other, url);
    warmUrl(url);
  }

  function startSkipFade(nextIndex, kind, seconds) {
    if (!songs.length) return;
    armIncoming(nextIndex);
    fading = true;
    fadeMode = kind === "fade" ? "fade" : "cross";
    fadeSec = seconds || SKIP_FADE_SEC;
    fadeStart = performance.now();
    fadeOutAmt = 1;
    fadeInAmt = 0;
    fadeInStarted = fadeMode !== "fade";
    other.muted = false;
    setDeckVol(other, 0);
    hookDeck(other);
    const p = other.play();
    function parkIncoming() {
      if (fadeMode !== "fade") return;
      try { other.pause(); } catch { /* ignore */ }
      try { other.currentTime = 0; } catch { /* ignore */ }
    }
    if (p && typeof p.then === "function") {
      p.then(parkIncoming).catch(function () {
        stopFade(false);
        loadTrack(nextIndex, true);
      });
    } else {
      parkIncoming();
    }
    tickFade();
  }

  function pause() {
    wantPlay = false;
    ignoreEnded = true;
    disarmLoop(el);
    stopFade(false);
    try { el.pause(); } catch { /* ignore */ }
    try { other.pause(); } catch { /* ignore */ }
    window.setTimeout(function () { ignoreEnded = false; }, 400);
    syncPlayUi();
    kickEq();
  }

  function loadTrack(i, autoplay) {
    if (!songs.length) {
      emitTitle();
      return;
    }
    stopFade(false);
    index = wrapIndex(i, songs.length);
    disarmLoop(el);
    const url = urlOf(index);
    setSrc(el, url);
    try { el.currentTime = 0; } catch { /* ignore */ }
    emitTitle();
    if (autoplay) play();
    else {
      try { el.pause(); } catch { /* ignore */ }
      syncPlayUi();
    }
  }

  function skip(delta) {
    if (!songs.length || advancing) return;
    const next = wrapIndex(index + delta, songs.length);
    const playing = wantPlay && !el.paused;
    const url = urlOf(next);
    const ready = deckReady(other, url);
    const kind = skipKind(playing, ready);
    if (kind === "paused") {
      loadTrack(next, false);
      return;
    }
    advancing = true;
    try {
      startSkipFade(next, kind, SKIP_FADE_SEC);
    } finally {
      advancing = false;
    }
  }

  function trackActuallyEnded() {
    if (el.ended) return true;
    const d = el.duration;
    return Number.isFinite(d) && d > 1 && el.currentTime >= d - 0.05;
  }

  function maybeAdvanceEnded() {
    if (ignoreEnded || advancing || fading || !wantPlay) return;
    if (el.paused && !el.ended) return;
    if (!trackActuallyEnded()) return;
    const next = wrapIndex(index + 1, songs.length);
    const ready = deckReady(other, urlOf(next));
    startSkipFade(next, skipKind(true, ready), END_FADE_SEC);
  }

  function setVolume(v) {
    vol = clamp01(v);
    if (vol > 0) muted = false;
    else muted = true;
    saveVol(vol);
    applyOutput();
    kickEq();
  }

  function setMuted(on) {
    muted = !!on;
    if (!muted && vol <= 0) {
      vol = DEFAULT_VOL;
      saveVol(vol);
    }
    applyOutput();
    kickEq();
  }

  function syncEqSize() {
    const rect = eqWrap.getBoundingClientRect();
    const cssW = Math.max(0, rect.width || eqWrap.clientWidth || 0);
    const cssH = Math.max(0, rect.height || eqWrap.clientHeight || 28);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.max(1, Math.round(cssW * dpr));
    const ph = Math.max(1, Math.round(cssH * dpr));
    if (eqCanvas.width !== pw) eqCanvas.width = pw;
    if (eqCanvas.height !== ph) eqCanvas.height = ph;
    const next = Math.max(EQ_MIN_BARS, Math.min(EQ_MAX_BARS, Math.floor(cssW / 4)));
    if (next !== eqBarCount) {
      const old = eqLevels;
      eqBarCount = next;
      eqLevels = new Float32Array(eqBarCount);
      if (old) eqLevels.set(old.subarray(0, Math.min(old.length, eqBarCount)));
    }
  }

  function ledColor(segFromBottom) {
    const t = EQ_SEGS <= 1 ? 0 : segFromBottom / (EQ_SEGS - 1);
    const a = 0.55 + t * 0.35;
    return "rgba(255,255,255," + a.toFixed(3) + ")";
  }

  function eqIsLive() {
    return wantPlay && !el.paused && !el.ended && !muted;
  }

  function paintEq(live) {
    if (!eqCtx) eqCtx = eqCanvas.getContext("2d");
    const ctx = eqCtx;
    const bars = eqBarCount;
    const w = eqCanvas.width;
    const h = eqCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const gapY = Math.max(1, Math.round(h * 0.03));
    const cell = Math.max(2, Math.floor((h - gapY * (EQ_SEGS - 1)) / EQ_SEGS));
    const y0 = Math.max(0, Math.floor((h - (EQ_SEGS * cell + (EQ_SEGS - 1) * gapY)) * 0.5));
    const gapX = Math.max(1, Math.round(Math.min(w, h) * 0.025));
    const usable = Math.max(0, w - gapX * Math.max(0, bars - 1));
    const baseW = Math.max(1, Math.floor(usable / Math.max(1, bars)));
    let extra = Math.max(0, usable - baseW * bars);
    let x = 0;
    for (let i = 0; i < bars; i++) {
      const colW = baseW + (extra > 0 ? 1 : 0);
      if (extra > 0) extra -= 1;
      const lit = live ? Math.round(eqLevels[i] * EQ_SEGS) : 0;
      for (let s = 0; s < EQ_SEGS; s++) {
        const y = y0 + (EQ_SEGS - 1 - s) * (cell + gapY);
        ctx.fillStyle = s < lit ? ledColor(s) : "rgba(255,255,255,0.10)";
        ctx.fillRect(x, y, colW, cell);
      }
      x += colW + gapX;
    }
  }

  function clearEq() {
    if (eqLevels) eqLevels.fill(0);
    lastEqEnergy = 0;
    syncEqSize();
    paintEq(false);
  }

  function timePulse(i, bars, t) {
    const u = bars <= 1 ? 0 : i / (bars - 1);
    const a = 0.38 + 0.42 * Math.sin(t * 4.2 + u * 3.1);
    const b = 0.28 + 0.5 * Math.sin(t * 6.8 + u * 5.7);
    const c = 0.18 * Math.sin(t * 2.1 + i);
    return Math.min(1, Math.max(0, a * 0.5 + b * 0.38 + c));
  }

  function drawEq() {
    eqRafOn = false;
    if (destroyed) return;
    syncEqSize();
    if (!eqIsLive()) {
      clearEq();
      return;
    }
    const bars = eqBarCount;
    if (!safari && analyser && freqBins) {
      analyser.getByteFrequencyData(freqBins);
      fillLogSpectrum(freqBins, eqLevels);
    } else {
      const t = performance.now() / 1000;
      for (let i = 0; i < bars; i++) {
        const target = timePulse(i, bars, t);
        eqLevels[i] += (target - eqLevels[i]) * 0.35;
      }
    }
    let energy = 0;
    for (let i = 0; i < bars; i++) energy += eqLevels[i];
    lastEqEnergy = energy / Math.max(1, bars);
    paintEq(true);
    eqRafOn = true;
    requestAnimationFrame(drawEq);
  }

  function kickEq() {
    if (eqIsLive()) {
      if (!eqRafOn) requestAnimationFrame(drawEq);
    } else {
      clearEq();
    }
  }

  function warmNext() {
    if (songs.length < 2) return;
    const n = wrapIndex(index + 1, songs.length);
    if (warmedNext === n) return;
    warmedNext = n;
    armIncoming(n);
  }

  function bindDeck(node) {
    node.addEventListener("canplay", function () {
      if (node !== el) return;
      if (wantPlay && el.paused) {
        const p = el.play();
        if (p && typeof p.then === "function") p.then(afterElementPlay).catch(function () { syncPlayUi(); });
      }
    });
    node.addEventListener("ended", function () {
      if (node !== el) return;
      maybeAdvanceEnded();
      syncPlayUi();
      kickEq();
    });
    node.addEventListener("timeupdate", function () {
      if (node !== el || advancing || !wantPlay || el.paused || fading) return;
      const d = el.duration;
      if (!Number.isFinite(d) || d <= 1) return;
      const left = d - el.currentTime;
      if (left <= PRELOAD_SEC) warmNext();
      if (left <= END_FADE_SEC + 0.05 && songs.length > 1) {
        const next = wrapIndex(index + 1, songs.length);
        startSkipFade(next, skipKind(true, deckReady(other, urlOf(next))), END_FADE_SEC);
      } else if (el.ended || left <= 0.05) {
        maybeAdvanceEnded();
      }
    });
    node.addEventListener("play", function () {
      if (node !== el && !fading) return;
      disarmLoop(node);
      syncPlayUi();
      kickEq();
    });
    node.addEventListener("pause", function () {
      if (node !== el) return;
      syncPlayUi();
      kickEq();
    });
  }

  bindDeck(elA);
  bindDeck(elB);

  function showScrub() {
    volPctEl.hidden = false;
    volPctEl.textContent = Math.round((muted ? 0 : vol) * 100) + "%";
  }
  function hideScrub() {
    volPctEl.hidden = true;
  }

  volInput.addEventListener("pointerdown", showScrub);
  volInput.addEventListener("touchstart", showScrub, { passive: true });
  volInput.addEventListener("input", function () {
    setVolume(Number(volInput.value) / 100);
    showScrub();
  });
  volInput.addEventListener("pointerup", hideScrub);
  volInput.addEventListener("pointercancel", hideScrub);
  volInput.addEventListener("touchend", hideScrub);
  volInput.addEventListener("change", hideScrub);

  let lastSkip = 0;
  function skipFromTap(delta) {
    const now = Date.now();
    if (now - lastSkip < 280) return;
    lastSkip = now;
    skip(delta);
  }
  prevBtn.addEventListener("click", function () { skipFromTap(-1); });
  nextBtn.addEventListener("click", function () { skipFromTap(1); });

  let lastToggle = 0;
  playBtn.addEventListener("click", function (e) {
    if (e) e.stopPropagation();
    const now = Date.now();
    if (now - lastToggle < 280) return;
    lastToggle = now;
    if (wantPlay && (!el.paused || fading)) pause();
    else play();
  });

  muteBtn.addEventListener("click", function () { setMuted(!muted); });

  ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "click"].forEach(function (ev) {
    wrap.addEventListener(ev, function (e) { e.stopPropagation(); });
  });
  wrap.querySelectorAll("button").forEach(function (btn) {
    btn.addEventListener("click", function () { btn.blur(); });
    btn.addEventListener("keydown", function (e) {
      if (e.code === "Space" || e.key === " ") e.preventDefault();
    });
  });

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(function () {
      syncEqSize();
      if (!eqIsLive()) paintEq(false);
    }).observe(eqWrap);
  }

  if (songs[0]) {
    const u0 = urlOf(0);
    setSrc(el, u0);
    warmUrl(u0);
  }
  emitTitle();
  applyOutput();
  kickEq();

  return {
    play,
    pause,
    kickOff: play,
    next() { skip(1); },
    prev() { skip(-1); },
    title() { return songs[index] || ""; },
    isPlaying() { return isAudible(); },
    beat() { return lastEqEnergy; },
    _bound: true,
    destroy() {
      destroyed = true;
      pause();
      if (audioCtx) {
        try { audioCtx.close(); } catch { /* ignore */ }
        audioCtx = null;
      }
      rootEl.innerHTML = "";
    },
  };
}

export default { mountPlayer };
