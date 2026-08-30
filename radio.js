const DEFAULT_TRACKS = [];

function isTesla() {
  try { return /Tesla/i.test(navigator.userAgent || ""); }
  catch { return false; }
}

function canPlayOpus() {
  if (isTesla()) return false;
  try {
    const a = document.createElement("audio");
    const ogg = a.canPlayType("audio/ogg; codecs=opus") || a.canPlayType("audio/ogg; codecs=\"opus\"");
    const webm = a.canPlayType("audio/webm; codecs=opus");
    return !!(ogg || webm);
  } catch {
    return false;
  }
}

function resolveSrc(t, opusOk) {
  if (!t) return "";
  if (opusOk && t.opus) return t.opus;
  return t.mp3 || t.src || "";
}

const DEFAULT_VOL = 0.55;
const VOL_KEY = "latis.musicVolume";

function clamp(v) {
  return Math.min(1, Math.max(0, v));
}

function loadNum(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === "") return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function save(key, v) {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    /* private mode */
  }
}

function trackUrl(src) {
  try {
    return new URL(src, location.href).href;
  } catch {
    return src;
  }
}

function warmUrl(src) {
  if (!src) return;
  const url = trackUrl(src);
  try {
    fetch(url, { cache: "force-cache", credentials: "same-origin" }).catch(function () {});
  } catch {
    /* ignore */
  }
}

export function initRadio(tracks) {
  let TRACKS = (tracks && tracks.length) ? tracks : DEFAULT_TRACKS;
  let useOpus = canPlayOpus();
  function srcOf(t) { return resolveSrc(t, useOpus); }
  if (window.__latisRadio && window.__latisRadio._bound) {
    if (typeof window.__latisRadio.setTracks === "function") window.__latisRadio.setTracks(TRACKS);
    else window.__latisRadio.tracks = TRACKS;
    const cover = document.getElementById("radio-cover");
    const t0 = TRACKS[window.__latisRadio.index() || 0] || TRACKS[0];
    if (cover && t0 && t0.cover) {
      cover.src = t0.cover;
      cover.alt = t0.title || "";
    }
    return window.__latisRadio;
  }
  let el = document.getElementById("latis-bgm") || document.getElementById("triki-bgm");
  if (!el) {
    el = document.createElement("audio");
    el.id = "latis-bgm";
    el.setAttribute("playsinline", "true");
    el.setAttribute("webkit-playsinline", "true");
    el.setAttribute("preload", "auto");
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none";
    document.body.prepend(el);
  }
  let elB = document.getElementById("latis-bgm-b");
  if (!elB) {
    elB = document.createElement("audio");
    elB.id = "latis-bgm-b";
    elB.setAttribute("playsinline", "true");
    elB.setAttribute("webkit-playsinline", "true");
    elB.setAttribute("preload", "auto");
    elB.setAttribute("aria-hidden", "true");
    elB.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none";
    document.body.prepend(elB);
  }
  elB.playsInline = true;
  elB.loop = false;
  elB.muted = false;
  const bar = document.getElementById("radio");
  const titleEl = document.getElementById("radio-title");
  const coverEl = document.getElementById("radio-cover");
  const eqWrap = document.getElementById("radio-eq-wrap");
  const eqCanvas = document.getElementById("radio-eq");
  const volInput = document.getElementById("radio-vol");
  const volPctEl = document.getElementById("radio-vol-pct");
  const prevBtn = document.getElementById("radio-prev");
  const nextBtn = document.getElementById("radio-next");
  const playBtn = document.getElementById("radio-play");
  const muteBtn = document.getElementById("radio-mute");
  // Never return null when we can play. #radio UI is optional.

  let vol = clamp(loadNum(VOL_KEY, DEFAULT_VOL));
  if (!Number.isFinite(vol) || vol <= 0.2) {
    vol = DEFAULT_VOL;
    save(VOL_KEY, vol);
  }
  let muted = false;
  let index = 0;
  let wantPlay = false;
  let kickedOff = false;
  let audioCtx = null;
  let gainNode = null;
  let mediaSource = null;
  let analyser = null;
  let freqBins = null;
  let timeBins = null;
  let eqLevels = null;
  let lastEqEnergy = 0;
  let beatEnv = 0;
  let bassFloor = 0.08;
  let advancing = false;
  const FADE_SEC = 4;
  const PRELOAD_SEC = 10;
  let fading = false;
  let fadeOutAmt = 1;
  let fadeInAmt = 0;
  let fadeStart = 0;
  let fadeRaf = 0;
  let incomingIndex = -1;
  let incomingUnlocked = false;

  function beatLevel() {
    if (!isAudible() || !analyser || !freqBins) {
      beatEnv += (0 - beatEnv) * 0.12;
      return beatEnv;
    }
    analyser.getByteFrequencyData(freqBins);
    if (timeBins) analyser.getByteTimeDomainData(timeBins);
    const k = Math.min(5, freqBins.length);
    let bass = 0;
    for (let i = 0; i < k; i++) bass += freqBins[i];
    bass = (bass / k) / 255;
    bassFloor += (bass - bassFloor) * 0.035;
    let hit = (bass - bassFloor * 1.02) / 0.18;
    if (timeBins) {
      let peak = 0;
      for (let i = 0; i < timeBins.length; i++) {
        const v = Math.abs(timeBins[i] - 128) / 128;
        if (v > peak) peak = v;
      }
      hit = Math.max(hit, (peak - 0.12) / 0.4);
    }
    hit = Math.min(1, Math.max(0, hit));
    if (hit > beatEnv) beatEnv += (hit - beatEnv) * 0.78;
    else beatEnv += (hit - beatEnv) * 0.12;
    return beatEnv;
  }

  function emitCover() {
    const t = TRACKS[index] || TRACKS[0];
    if (!coverEl || !t) return;
    const src = t.cover || "";
    if (src) {
      coverEl.src = src;
      coverEl.setAttribute("src", src);
    }
    coverEl.alt = t.title || "";
  }

  function emitTitle() {
    const t = TRACKS[index] || TRACKS[0];
    if (titleEl) titleEl.textContent = t ? t.title : "";
    emitCover();
  }

  el.playsInline = true;
  el.setAttribute("playsinline", "true");
  el.setAttribute("webkit-playsinline", "true");
  el.muted = false;
  el.preload = TRACKS.length ? "auto" : "none";
  if (TRACKS[0]) {
    const u0 = srcOf(TRACKS[0]);
    el.src = u0;
    el.setAttribute("src", u0);
    warmUrl(u0);
  }

  function disarmLoop() {
    el.loop = false;
    el.removeAttribute("loop");
  }
  disarmLoop();

  function outputLevel() {
    return muted ? 0 : vol;
  }

  function hasTrackSrc() {
    return !!(el.getAttribute("src") || el.currentSrc);
  }

  function isAudible() {
    return wantPlay && !el.paused && !el.ended && hasTrackSrc();
  }

  let playedOnce = false;

  function unlockGraph() {
    if (!playedOnce) return;
    if (!hasTrackSrc()) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && !mediaSource) {
      try {
        if (!audioCtx) audioCtx = new AC();
        if (!gainNode) gainNode = audioCtx.createGain();
        if (!analyser) {
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.32;
          freqBins = new Uint8Array(analyser.frequencyBinCount);
          timeBins = new Uint8Array(analyser.fftSize);
        }
        mediaSource = audioCtx.createMediaElementSource(el);
        mediaSource.connect(analyser);
        analyser.connect(gainNode);
        gainNode.connect(audioCtx.destination);
      } catch (err) {
        console.warn("latis BGM graph", err);
        // Element already playing — keep that path. Do not rebuild src.
        mediaSource = mediaSource || null;
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      try {
        audioCtx.resume();
      } catch {
        /* Safari may still resume via the gesture */
      }
    }
    applyOutput();
  }

  function setDeckVol(node, v) {
    try { node.volume = clamp(v); } catch { /* iOS may ignore */ }
  }

  function applyDeckVolumes() {
    const out = outputLevel();
    const a = fading ? fadeOutAmt : 1;
    const b = fading ? fadeInAmt : 0;
    setDeckVol(el, out * a);
    setDeckVol(elB, out * b);
    if (gainNode) {
      const g = gainNode.gain;
      const gv = out * a;
      if (audioCtx) {
        try { g.setValueAtTime(gv, audioCtx.currentTime); }
        catch { g.value = gv; }
      } else {
        g.value = gv;
      }
    }
  }

  function applyOutput() {
    applyDeckVolumes();
    const shown = muted ? 0 : vol;
    const pctNum = Math.round(shown * 100);
    if (volInput && document.activeElement !== volInput) {
      volInput.value = String(pctNum);
    }
    if (volInput) volInput.style.setProperty("--vol-pct", pctNum + "%");
    if (volPctEl) volPctEl.textContent = pctNum + "%";
    if (bar) bar.classList.toggle("muted", muted);
    if (muteBtn) {
      muteBtn.classList.toggle("is-muted", muted);
      muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
      muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
    }
  }

  function syncPlayUi() {
    const playing = wantPlay && !el.paused;
    if (playBtn) {
      playBtn.classList.toggle("playing", playing);
      playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    }
  }

  function afterElementPlay() {
    playedOnce = true;
    kickedOff = true;
    unlockGraph();
    applyOutput();
    syncPlayUi();
    syncEqMotion();
  }

  function retryPlayIfWanted() {
    if (!wantPlay || !el.paused) return;
    const p = el.play();
    if (p && typeof p.then === "function") {
      p.then(afterElementPlay).catch(function () {
        syncPlayUi();
      });
    } else if (!el.paused) {
      afterElementPlay();
    }
  }

  function play() {
    if (!TRACKS.length) return;
    wantPlay = true;
    muted = false;
    el.muted = false;
    if (!Number.isFinite(vol) || vol <= 0) {
      vol = DEFAULT_VOL;
      save(VOL_KEY, vol);
    }
    try {
      el.volume = vol;
    } catch {
      /* iOS may ignore */
    }
    if (!hasTrackSrc()) {
      const t = TRACKS[index] || TRACKS[0];
      const url = srcOf(t);
      if (url) {
        el.preload = "auto";
        el.src = url;
        el.setAttribute("src", url);
      }
    }
    disarmLoop();
    // Immediate play() in the user-gesture stack. Do not call load() or
    // create AudioContext / MediaElementSource first (unlockGraph is
    // gated by playedOnce after a successful play).
    unlockIncoming();
    const p = el.play();
    if (p && typeof p.then === "function") {
      p.then(afterElementPlay).catch(function (err) {
        if (useOpus) {
          useOpus = false;
          const t = TRACKS[index] || TRACKS[0];
          const url = srcOf(t);
          el.preload = "auto";
          el.src = url;
          el.setAttribute("src", url);
          const p2 = el.play();
          if (p2 && typeof p2.then === "function") {
            p2.then(afterElementPlay).catch(function (err2) {
              console.warn("latis BGM play() failed", err2);
              syncPlayUi();
            });
          }
          return;
        }
        console.warn("latis BGM play() failed", err);
        syncPlayUi();
      });
    } else {
      setTimeout(afterElementPlay, 50);
    }
    applyOutput();
    syncPlayUi();
  }

  let ignoreEnded = false;

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
      try { elB.pause(); } catch { /* ignore */ }
      try { elB.removeAttribute("src"); elB.src = ""; } catch { /* ignore */ }
    }
  }

  function hookDeck(node) {
    if (!audioCtx || !analyser || !gainNode) return;
    try {
      const src = audioCtx.createMediaElementSource(node);
      src.connect(analyser);
    } catch {
      /* already hooked or element not ready */
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
    el = elB;
    elB = outgoing;
    try { elB.pause(); } catch { /* ignore */ }
    try { elB.removeAttribute("src"); elB.src = ""; } catch { /* ignore */ }
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
    syncEqMotion();
  }

  function tickFade() {
    fadeRaf = 0;
    if (!fading) return;
    const k = Math.min(1, Math.max(0, (performance.now() - fadeStart) / (FADE_SEC * 1000)));
    fadeOutAmt = 1 - k;
    fadeInAmt = k;
    applyDeckVolumes();
    if (k >= 1) {
      finishCrossfade();
      return;
    }
    fadeRaf = requestAnimationFrame(tickFade);
  }

  function armIncoming() {
    if (TRACKS.length < 2) return;
    const n = (index + 1) % TRACKS.length;
    incomingIndex = n;
    const url = srcOf(TRACKS[n]);
    const cur = elB.getAttribute("src") || "";
    if (cur !== url) {
      elB.preload = "auto";
      elB.src = url;
      elB.setAttribute("src", url);
    }
    warmUrl(url);
    emitCoverSoon(n);
  }

  function emitCoverSoon(n) {
    const t = TRACKS[n];
    if (coverEl && t && t.cover) {
      coverEl.src = t.cover;
      coverEl.alt = t.title || "";
    }
    if (titleEl && t) titleEl.textContent = t.title || "";
  }

  function startCrossfade() {
    if (fading || !wantPlay || TRACKS.length < 2) return;
    armIncoming();
    fading = true;
    fadeStart = performance.now();
    fadeOutAmt = 1;
    fadeInAmt = 0;
    elB.muted = false;
    setDeckVol(elB, 0);
    hookDeck(elB);
    const p = elB.play();
    if (p && typeof p.then === "function") {
      p.catch(function () {
        stopFade(false);
        playNext(true);
      });
    }
    tickFade();
  }

  function unlockIncoming() {
    if (incomingUnlocked) return;
    incomingUnlocked = true;
    try {
      elB.muted = true;
      elB.volume = 0;
      const p = elB.play();
      function done() {
        try { elB.pause(); } catch { /* ignore */ }
        elB.muted = false;
        try { elB.currentTime = 0; } catch { /* ignore */ }
      }
      if (p && typeof p.then === "function") p.then(done).catch(done);
      else done();
    } catch {
      incomingUnlocked = false;
    }
  }

  function pause() {
    wantPlay = false;
    ignoreEnded = true;
    disarmLoop();
    stopFade(false);
    try {
      el.pause();
    } catch {
      /* ignore */
    }
    try { elB.pause(); } catch { /* ignore */ }
    window.setTimeout(function () {
      ignoreEnded = false;
    }, 400);
    syncPlayUi();
    syncEqMotion();
  }

  function loadTrack(i, autoplay) {
    if (!TRACKS.length) {
      emitTitle();
      return;
    }
    stopFade(false);
    index = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;
    const t = TRACKS[index];
    disarmLoop();
    const url = srcOf(t);
    el.preload = "auto";
    el.src = url;
    el.setAttribute("src", url);
    try {
      el.load();
    } catch {
      /* ignore */
    }
    disarmLoop();
    emitTitle();
    if (autoplay) play();
    else syncPlayUi();
  }

  function playNext(autoplay) {
    if (advancing) return;
    advancing = true;
    try {
      loadTrack(index + 1, autoplay);
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
    if (ignoreEnded) return;
    if (advancing) return;
    if (fading) return;
    if (!wantPlay) return;
    if (el.paused && !el.ended) return;
    if (!trackActuallyEnded()) return;
    playNext(true);
  }

  function setVolume(v) {
    vol = clamp(Number(v));
    if (!Number.isFinite(vol)) vol = DEFAULT_VOL;
    if (vol > 0) muted = false;
    else muted = true;
    save(VOL_KEY, vol);
    applyOutput();
    syncEqMotion();
  }

  function setMuted(on) {
    muted = !!on;
    if (!muted && vol <= 0) {
      vol = DEFAULT_VOL;
      save(VOL_KEY, vol);
    }
    applyOutput();
    syncEqMotion();
  }

  const EQ_SEGS = 8;
  const EQ_MIN_BARS = 8;
  const EQ_MAX_BARS = 64;
  let eqBarCount = 16;
  eqLevels = new Float32Array(eqBarCount);

  function syncEqSize() {
    if (!eqCanvas) return;
    const box = eqWrap || eqCanvas;
    const rect = box.getBoundingClientRect();
    const cssW = Math.max(0, rect.width || box.clientWidth || 0);
    const cssH = Math.max(0, rect.height || box.clientHeight || 28);
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

  let eqCtx = null;
  let eqRafOn = false;

  function eqIsLive() {
    return wantPlay && !el.paused && !el.ended && !muted;
  }

  function paintEq(live) {
    if (!eqCanvas) return;
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
        if (s < lit) {
          ctx.fillStyle = ledColor(s);
          ctx.fillRect(x, y, colW, cell);
        } else {
          ctx.fillStyle = "rgba(255,255,255,0.10)";
          ctx.fillRect(x, y, colW, cell);
        }
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

  function drawEq() {
    eqRafOn = false;
    syncEqSize();
    if (!eqIsLive()) {
      clearEq();
      return;
    }
    const bars = eqBarCount;
    if (analyser && freqBins) {
      analyser.getByteFrequencyData(freqBins);
      const n = freqBins.length;
      let energy = 0;
      for (let i = 0; i < bars; i++) {
        const u = bars <= 1 ? 0 : i / (bars - 1);
        const a = Math.floor(u * n * 0.78);
        const b = Math.max(a + 1, Math.floor(((i + 1) / bars) * n * 0.78));
        let sum = 0;
        for (let k = a; k < b && k < n; k++) sum += freqBins[k];
        let target = (sum / Math.max(1, b - a)) / 255;
        if (u > 0.18 && u < 0.38) target *= 1.25;
        if (u > 0.58 && u < 0.78) target *= 1.18;
        eqLevels[i] += (Math.min(1, Math.max(0, target)) - eqLevels[i]) * 0.5;
        energy += eqLevels[i];
      }
      lastEqEnergy = energy / Math.max(1, bars);
    }
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

  function syncEqMotion() {
    kickEq();
  }

  let warmedNext = -1;
  function warmNext() {
    const n = (index + 1) % TRACKS.length;
    if (warmedNext === n) return;
    warmedNext = n;
    armIncoming();
  }

  function bindTitleOnly() {
    emitTitle();
    try { el.preload = TRACKS.length ? "auto" : "none"; } catch { /* ignore */ }
  }



  applyOutput();
  bindTitleOnly();
  syncEqMotion();
  if (eqWrap && typeof ResizeObserver !== "undefined") {
    new ResizeObserver(function () {
      syncEqSize();
      if (!eqIsLive()) paintEq(false);
    }).observe(eqWrap);
  }

  function bindDeck(node) {
    node.addEventListener("canplay", function () {
      if (node !== el) return;
      retryPlayIfWanted();
    });
    node.addEventListener("loadeddata", function () {
      if (node !== el) return;
      retryPlayIfWanted();
    });
    node.addEventListener("ended", function () {
      if (node !== el) return;
      maybeAdvanceEnded();
      syncPlayUi();
      syncEqMotion();
    });
    node.addEventListener("timeupdate", function () {
      if (node !== el) return;
      if (advancing || !wantPlay || el.paused) return;
      if (fading) return;
      const d = el.duration;
      if (!Number.isFinite(d) || d <= 1) return;
      const left = d - el.currentTime;
      if (left <= PRELOAD_SEC) warmNext();
      if (left <= FADE_SEC + 0.05 && TRACKS.length > 1) startCrossfade();
      else if (el.ended || left <= 0.05) maybeAdvanceEnded();
    });
    node.addEventListener("error", function () {
      if (node !== el) return;
      if (!useOpus) return;
      useOpus = false;
      warmedNext = -1;
      loadTrack(index, wantPlay);
    });
    node.addEventListener("play", function () {
      if (node !== el && !fading) return;
      disarmLoop();
      syncPlayUi();
      syncEqMotion();
    });
    node.addEventListener("pause", function () {
      if (node !== el) return;
      syncPlayUi();
      syncEqMotion();
    });
  }
  bindDeck(el);
  bindDeck(elB);

  function showScrub() {
    if (eqWrap) eqWrap.classList.add("is-scrubbing");
    if (bar) bar.classList.add("is-scrubbing");
    const volWrap = document.getElementById("radio-vol-wrap");
    if (volWrap) volWrap.classList.add("is-scrubbing");
    if (volPctEl) {
      volPctEl.hidden = false;
      volPctEl.textContent = Math.round((muted ? 0 : vol) * 100) + "%";
    }
  }
  function hideScrub() {
    if (eqWrap) eqWrap.classList.remove("is-scrubbing");
    if (bar) bar.classList.remove("is-scrubbing");
    const volWrap = document.getElementById("radio-vol-wrap");
    if (volWrap) volWrap.classList.remove("is-scrubbing");
    if (volPctEl) volPctEl.hidden = true;
  }
  if (volInput) {
    const showPct = function () {
      showScrub();
      if (volPctEl) volPctEl.textContent = volInput.value + "%";
    };
    volInput.addEventListener("pointerdown", showPct);
    volInput.addEventListener("touchstart", showPct, { passive: true });
    volInput.addEventListener("input", function () {
      setVolume(Number(volInput.value) / 100);
      showPct();
    });
    volInput.addEventListener("pointerup", hideScrub);
    volInput.addEventListener("pointercancel", hideScrub);
    volInput.addEventListener("touchend", hideScrub);
    volInput.addEventListener("change", hideScrub);
  }
  if (prevBtn) prevBtn.addEventListener("click", function () { loadTrack(index - 1, wantPlay); });
  if (nextBtn) nextBtn.addEventListener("click", function () { playNext(wantPlay); });
  let lastToggle = 0;
  function togglePlay(e) {
    if (e) e.stopPropagation();
    const now = Date.now();
    if (now - lastToggle < 280) return;
    lastToggle = now;
    if (wantPlay && (!el.paused || fading)) pause();
    else play();
  }
  if (playBtn) {
    // Click only. Window-capture kick ignores #radio; pointerdown+click
    // used to fight (kick plays, then togglePlay pauses).
    playBtn.addEventListener("click", togglePlay);
  }
  if (coverEl) {
    coverEl.style.cursor = "pointer";
    coverEl.addEventListener("pointerdown", function (e) {
      e.stopPropagation();
      if (!wantPlay || el.paused) play();
    });
  }
  if (muteBtn) {
    let dragged = false;
    const volFromX = function (x) {
      const box = (eqWrap || muteBtn).getBoundingClientRect();
      return Math.max(0, Math.min(1, (x - box.left) / Math.max(1, box.width)));
    };
    muteBtn.addEventListener("pointerdown", function (e) {
      dragged = false;
      try { muteBtn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    muteBtn.addEventListener("pointermove", function (e) {
      if (e.buttons === 0) return;
      if (!dragged && Math.abs(e.movementX) + Math.abs(e.movementY) < 2) return;
      dragged = true;
      setVolume(volFromX(e.clientX));
      showScrub();
    });
    muteBtn.addEventListener("pointerup", hideScrub);
    muteBtn.addEventListener("pointercancel", hideScrub);
    muteBtn.addEventListener("click", function (e) {
      if (dragged) {
        e.preventDefault();
        e.stopPropagation();
        dragged = false;
        return;
      }
      setMuted(!muted);
    });
  }

  if (bar) {
    ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "click"].forEach(function (ev) {
      bar.addEventListener(ev, function (e) {
        e.stopPropagation();
      });
    });
    bar.querySelectorAll("button").forEach(function (btn) {
      btn.addEventListener("click", function () { btn.blur(); });
      btn.addEventListener("keydown", function (e) {
        if (e.code === "Space" || e.key === " ") e.preventDefault();
      });
    });
  }

  const api = {
    tracks: TRACKS,
    _bound: true,
    setTracks(next) {
      TRACKS = (next && next.length) ? next : DEFAULT_TRACKS;
      this.tracks = TRACKS;
      emitTitle();
      if (TRACKS[index] && !hasTrackSrc()) {
        const url = srcOf(TRACKS[index]);
        el.preload = "auto";
        el.src = url;
        el.setAttribute("src", url);
        warmUrl(url);
      }
    },
    kickOff() {
      if (isAudible()) return;
      play();
    },
    play,
    pause,
    isPlaying() { return isAudible(); },
    get wantPlay() { return wantPlay; },
    title() { return (TRACKS[index] || TRACKS[0] || {}).title || ""; },
    index() { return index; },
    beat() { return beatLevel(); },
  };
  window.__latisRadio = api;
  return api;
}
