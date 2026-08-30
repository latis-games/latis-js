/**
 * Game host. Owns the Latis grid, turn, phase, and shared chrome.
 * GPU pick lives in renderer.js. Titles do not build radio/score/layout.
 *
 * Layout modes (skin.host or createGame({ host })):
 *   "board"   (default for 2D/grid: Triki, Mash, nonograms)
 *             Desktop 3-col: logo/status left, square board CENTERED and as
 *             TALL as possible, radio right, ionic.games bottom-right.
 *             Mobile stacked, board first.
 *   "overlay" (isometric / 3D / city / hop: Chain Tycoon)
 *             Playfield is FULL SCREEN. Chrome panels FLOAT over the board
 *             (left radio, right Turn/Level/Timer/Score, wordmark top-left).
 *             Do not carve the world into columns.
 */

import { startRenderer } from "./renderer.js";
import { mountChrome, applyChrome, setScoreHud, setTimerHud } from "./chrome.js";
import { initRadio } from "./radio.js";
import { classifyStroke, isLine, twoLinesAreCross, majorityCell, pathLength, strokeFitsCell } from "./draw.js";
import { applyPanToBox, screenToIslandUV } from "./camera.js";

mountChrome();

function wrapEngine(engine) {
  return {
    cols: () => engine.cols(),
    rows: () => engine.rows(),
    len: () => engine.len(),
    cell: (i) => engine.cell(i),
    cells() {
      const n = engine.len();
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = engine.cell(i);
      return out;
    },
    set: (i, v) => engine.set(i, v),
    place: (i, player) => engine.place(i, player),
    kInARow: (k) => Array.from(engine.kInARow(k)),
    full: () => engine.full(),
    clear: () => engine.clear(),
    reset: () => engine.reset(),
    neighbors: (i) => Array.from(engine.neighbors(i)),
  };
}

export async function createGame({ Engine, context, rules, settings, skin, host } = {}) {
  const mode = host || (skin && skin.host) || (settings && settings.host) || "board";
  const stamped = applyChrome(skin, settings, mode);
  const playlist = (skin && skin.playlist) || (settings && settings.playlist) || (stamped && stamped.playlist) || [];
  const radio = initRadio(playlist);
  const Ctor = Engine || (context && context.loadKernel && (await context.loadKernel()));
  if (!Ctor) throw new Error("LatisEngine missing — pass Engine or context.loadKernel");
  let engine = new Ctor(settings.cols, settings.rows);
  let board = wrapEngine(engine);
  const hitEl = (context && context.hitEl) || document.getElementById("hit");
  const inset = (skin && skin.inset) || { left: 0, right: 0, top: 0, bottom: 0 };
  function playfieldBox(el) {
    if (skin && typeof skin.squarePlayfield === "function") return applyPanToBox(skin.squarePlayfield(el));
    if (!el) return { side: 0, ox: 0, oy: 0, w: 0, h: 0, zoom: 1 };
    const rect = el.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const zoom = skin && typeof skin.playfieldZoom === "function" ? skin.playfieldZoom(w, h) : 1;
    const fit = skin && skin.islandFit != null ? Number(skin.islandFit) : 1;
    const side = Math.max(w, h) * fit * zoom;
    return applyPanToBox({ side, ox: (w - side) / 2, oy: (h - side) / 2, w, h, zoom });
  }

  let turn = settings.first;
  let phase = "play";
  let winner = 0;
  let winLine = [];
  let aiBusy = false;
  let aiTimer = 0;
  let restartArmed = false;
  let transitioning = false;
  let winGrowRaf = 0;
  let firstPiece = false;
  let sideLocked = false;
  const HS_KEY = (settings && settings.scoreKey) || "latis.highScore";
  let score = 0;
  let highScore = 0;
  try {
    const raw = localStorage.getItem(HS_KEY);
    const n = raw == null ? 0 : parseInt(raw, 10);
    if (Number.isFinite(n)) highScore = Math.max(0, n);
  } catch { /* private mode */ }
  let timerStart = 0;
  let timerAccum = 0;
  let timerRaf = 0;
  setScoreHud(score, highScore);
  setTimerHud(0);
  window.__latisCamera = window.__latisCamera || {};
  if (window.__latisCamera.carveFade == null) window.__latisCamera.carveFade = 1;

  function elapsedSec() {
    if (!timerStart) return timerAccum;
    return timerAccum + (performance.now() - timerStart) / 1000;
  }
  function tickTimer() {
    timerRaf = window.requestAnimationFrame(tickTimer);
    setTimerHud(elapsedSec());
  }
  function startTimer() {
    if (timerStart) return;
    timerStart = performance.now();
    if (!timerRaf) timerRaf = window.requestAnimationFrame(tickTimer);
  }
  function stopTimer() {
    if (timerStart) {
      timerAccum = elapsedSec();
      timerStart = 0;
    }
  }
  function resetTimer() {
    timerStart = 0;
    timerAccum = 0;
    setTimerHud(0);
  }
  function persistHigh() {
    if (score > highScore) {
      highScore = score;
      try { localStorage.setItem(HS_KEY, String(highScore)); } catch { /* ignore */ }
    }
    setScoreHud(score, highScore);
  }
  function awardOutcome() {
    const sec = elapsedSec();
    if (phase === "win" && winner === settings.human) {
      const sizeBonus = Math.max(0, 6 - settings.cols) * 400;
      const timeBonus = Math.max(0, 90 - Math.floor(sec)) * 8;
      score += 2000 + sizeBonus + timeBonus;
    } else if (phase === "draw") {
      score += 150;
    }
    persistHigh();
  }

  function snapshot() {
    return {
      cells: board.cells(),
      turn,
      phase,
      winner,
      winLine: winLine.slice(),
      aiBusy,
      cols: settings.cols,
      rows: settings.rows,
    };
  }

  function resolveOutcome() {
    const line = rules.winLine(board, settings.winK);
    if (line.length) {
      phase = "win";
      winner = board.cell(line[0]);
      winLine = line;
      return;
    }
    if (rules.draw(board, settings.winK)) {
      phase = "draw";
      winner = 0;
      winLine = [];
      return;
    }
    winLine = [];
    winner = 0;
  }

  let renderer = null;

  function paint() {
    if (renderer) return renderer.draw(snapshot());
    return skin.draw(snapshot());
  }

  function resetSides() {
    settings.human = 1;
    settings.cpu = 2;
    settings.first = 1;
    sideLocked = false;
  }

  /** First mark picks the human side. Engine: 1 = X, 2 = O. Human always first. */
  function claimSide(mark) {
    if (sideLocked) return;
    if (mark === "O") {
      settings.human = 2;
      settings.cpu = 1;
      settings.first = 2;
    } else {
      settings.human = 1;
      settings.cpu = 2;
      settings.first = 1;
    }
    turn = settings.human;
    sideLocked = true;
  }

  function place(i, player) {
    if (phase !== "play") return false;
    if (!rules.legal(board, i)) return false;
    if (!rules.apply(board, i, player)) return false;
    if (!firstPiece) {
      firstPiece = true;
      startTimer();
      if (context.onFirstPiece) context.onFirstPiece();
    }
    resolveOutcome();
    if (phase === "play") {
      turn = player === settings.human ? settings.cpu : settings.human;
    } else {
      stopTimer();
      awardOutcome();
    }
    return true;
  }

  function queueAi() {
    if (phase !== "play" || turn !== settings.cpu) return;
    aiBusy = true;
    paint();
    if (aiTimer) window.clearTimeout(aiTimer);
    aiTimer = window.setTimeout(() => {
      aiTimer = 0;
      const i = rules.aiPick(board, settings);
      if (i >= 0 && phase === "play") place(i, settings.cpu);
      aiBusy = false;
      paint();
      if (phase !== "play") armRestart();
    }, 280);
  }

  function boardCap() {
    return settings.maxCols || settings.maxRows || 10;
  }

  function setCarveFade(v) {
    window.__latisCamera = window.__latisCamera || {};
    window.__latisCamera.carveFade = v;
  }

  function inputBlocked() {
    return restartArmed || transitioning || aiBusy;
  }

  function musicPlaying() {
    return !!(radio && radio.isPlaying && radio.isPlaying());
  }

  function toggleMusicAndTimer() {
    if (musicPlaying()) {
      if (radio.pause) radio.pause();
      if (settings.pauseTimerOnSpace === true) stopTimer();
      return;
    }
    if (radio && radio.play) radio.play();
    if (settings.pauseTimerOnSpace === true && phase === "play" && turn === settings.human) startTimer();
  }

  function cancelWinTransition() {
    if (winGrowRaf) {
      window.cancelAnimationFrame(winGrowRaf);
      winGrowRaf = 0;
    }
    transitioning = false;
  }

  function resizeBoard(n) {
    n = Math.max(3, n | 0);
    if (n === settings.cols && n === settings.rows) {
      board.reset();
      return;
    }
    settings.cols = n;
    settings.rows = n;
    engine = new Ctor(n, n);
    board = wrapEngine(engine);
    rebuildHits();
    if (skin.layoutHit) skin.layoutHit();
  }

  function humanPlace(i) {
    if (inputBlocked() || phase !== "play" || turn !== settings.human) return;
    if (!place(i, settings.human)) return;
    paint();
    if (phase !== "play") {
      if (winner === settings.human) startWinGrow();
      else armRestart();
      return;
    }
    queueAi();
  }

  function growAfterHumanWin() {
    const cap = boardCap();
    if (settings.cols >= cap) return false;
    resizeBoard(Math.min(cap, settings.cols + 1));
    return true;
  }

  function resetBoard() {
    cancelWinTransition();
    if (aiTimer) {
      window.clearTimeout(aiTimer);
      aiTimer = 0;
    }
    aiBusy = false;
    if (skin.clearDraft) skin.clearDraft();
    setCarveFade(1);
    const campaign = phase === "won" || (phase === "win" && winner === settings.human && settings.cols >= boardCap());
    if (campaign) resizeBoard(3);
    else board.reset();
    turn = settings.first;
    phase = "play";
    winner = 0;
    winLine = [];
    firstPiece = false;
    resetSides();
    turn = settings.first;
    resetTimer();
    persistHigh();
    if (skin.clearMarks) skin.clearMarks();
    const painted = paint();
    if (phase === "play" && turn === settings.human) startTimer();
    return painted;
  }

  function startWinGrow() {
    cancelWinTransition();
    transitioning = true;
    const t0 = performance.now();
    const humanWon = phase === "win" && winner === settings.human;
    const campaign = humanWon && settings.cols >= boardCap();
    let swapped = false;
    setCarveFade(1);

    function applySwap() {
      if (swapped) return;
      swapped = true;
      setCarveFade(0);
      if (skin.clearDraft) skin.clearDraft();
      if (skin.clearMarks) skin.clearMarks();
      if (campaign) {
        board.reset();
        winLine = [];
        phase = "won";
        winner = settings.human;
      } else if (humanWon) {
        growAfterHumanWin();
        turn = settings.first;
        phase = "play";
        winner = 0;
        winLine = [];
        firstPiece = false;
        resetTimer();
        startTimer();
        persistHigh();
      } else {
        board.reset();
        turn = settings.first;
        phase = "play";
        winner = 0;
        winLine = [];
        firstPiece = false;
        resetTimer();
        persistHigh();
      }
      if (skin.layoutHit) skin.layoutHit();
    }

    function tick(now) {
      const t = now - t0;
      if (t < 600) {
        setCarveFade(1);
      } else if (t < 1500) {
        setCarveFade(Math.max(0, 1 - (t - 600) / 900));
      } else {
        applySwap();
        if (t < 2400) {
          setCarveFade(Math.min(1, (t - 1500) / 900));
        } else {
          setCarveFade(1);
          winGrowRaf = 0;
          transitioning = false;
          if (campaign) armRestart();
          paint();
          return;
        }
      }
      paint();
      winGrowRaf = window.requestAnimationFrame(tick);
    }
    winGrowRaf = window.requestAnimationFrame(tick);
  }

  function armRestart() {
    if (restartArmed) return;
    restartArmed = true;
    const restart = (ev) => {
      if (ev && ev.type === "keydown" && (ev.metaKey || ev.ctrlKey || ev.altKey)) return;
      const t = ev && ev.target;
      if (t && t.closest && t.closest("#radio")) return;
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      ev?.stopImmediatePropagation?.();
      window.removeEventListener("pointerdown", restart, true);
      window.removeEventListener("keydown", restart, true);
      resetBoard();
      window.setTimeout(() => {
        restartArmed = false;
      }, 0);
    };
    window.setTimeout(() => {
      window.addEventListener("pointerdown", restart, true);
      window.addEventListener("keydown", restart, true);
    }, 0);
  }

  function seedWin() {
    board.reset();
    const human = settings.human;
    const cpu = settings.cpu;
    board.set(0, human);
    board.set(1, human);
    board.set(2, human);
    board.set(3, cpu);
    board.set(4, cpu);
    turn = settings.human;
    phase = "play";
    winner = 0;
    winLine = [];
    sideLocked = true;
    firstPiece = true;
    resolveOutcome();
    return paint();
  }

  function rebuildHits() {
    if (!hitEl) return;
    hitEl.replaceChildren();
    const n = settings.cols * settings.rows;
    for (let i = 0; i < n; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.i = String(i);
      btn.setAttribute("aria-label", `Cell ${i + 1}`);
      btn.style.pointerEvents = "none";
      hitEl.appendChild(btn);
    }
  }


  function uvFromEvent(ev) {
    // Same cover mapping as renderer.js: rotate around center, then zoom+pan box.
    const el = document.getElementById("stage") || document.getElementById("mount") || hitEl;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const box = playfieldBox(el);
    if (box.side <= 0) return null;
    return screenToIslandUV(ev.clientX, ev.clientY, rect, box);
  }

  function bindSandDraw() {
    const stage = document.getElementById("stage") || hitEl;
    if (!stage || stage.dataset.drawBound === "1") return;
    stage.dataset.drawBound = "1";
    stage.style.pointerEvents = "auto";
    const mount = document.getElementById("mount");
    if (mount) mount.style.pointerEvents = "none";
    const canvases = stage.querySelectorAll("#board-webgl, #board-2d, #board-webgpu");
    canvases.forEach((c) => { c.style.pointerEvents = "none"; });
    if (hitEl) hitEl.style.pointerEvents = "none";
    let pts = [];
    let drawing = false;
    let pending = null;
    let pendingTimer = 0;
    const activePointers = new Map();
    let drawPointerId = null;

    function cameraGesture(ev) {
      if (activePointers.size >= 2) return true;
      if (ev && ev.pointerType === "touch") {
        if (ev.isPrimary === false) return true;
        if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 1 && activePointers.size > 1) return true;
      }
      return false;
    }

    function releaseDrawCapture() {
      if (drawPointerId == null) return;
      try { stage.releasePointerCapture(drawPointerId); } catch { /* ignore */ }
      drawPointerId = null;
    }

    function cancelDrawForCamera() {
      const had = drawing || pts.length || pending;
      drawing = false;
      releaseDrawCapture();
      if (had) dropStroke();
    }

    const flushDraft = () => {
      const strokes = [];
      if (pending && pending.pts) strokes.push({ points: pending.pts });
      if (pts.length) strokes.push({ points: pts });
      if (skin.setDraft) skin.setDraft(strokes);
      if (renderer && renderer.draw) renderer.draw(snapshot());
    };

    const persistStrokes = (i, strokes) => {
      if (i < 0 || !skin.setMark) return;
      const list = (strokes || []).filter((s) => s && s.length > 1);
      if (list.length) skin.setMark(i, { strokes: list.map((s) => ({ points: s })) });
    };

    const commitCell = (i, firstMark, strokes) => {
      if (pendingTimer) {
        window.clearTimeout(pendingTimer);
        pendingTimer = 0;
      }
      pending = null;
      const keep = strokes || [];
      pts = [];
      if (i < 0) {
        if (skin.clearDraft) skin.clearDraft();
        if (renderer && renderer.draw) renderer.draw(snapshot());
        return;
      }
      if (!sideLocked && firstMark) claimSide(firstMark);
      persistStrokes(i, keep);
      if (skin.clearDraft) skin.clearDraft();
      humanPlace(i);
    };

    const dropStroke = () => {
      pts = [];
      pending = null;
      if (pendingTimer) {
        window.clearTimeout(pendingTimer);
        pendingTimer = 0;
      }
      if (skin.clearDraft) skin.clearDraft();
      if (renderer && renderer.draw) renderer.draw(snapshot());
    };

    const finishStroke = () => {
      const kind = classifyStroke(pts);
      const cell = majorityCell(pts, inset, settings.cols, settings.rows);
      if (kind === "unknown" || cell < 0) {
        dropStroke();
        return;
      }
      if (kind !== "tap" && !strokeFitsCell(pts, cell, inset, settings.cols, settings.rows)) {
        dropStroke();
        return;
      }
      const firstMark = (m) => (sideLocked ? null : m);
      const playingO = sideLocked && settings.human === 2;
      const isXStroke = kind === "X" || kind === "line"
        || (pending && pending.kind === "line" && kind !== "O" && kind !== "tap");

      // First mark was O: they are O. Never accept an X / two-slash.
      if (playingO && isXStroke) {
        dropStroke();
        return;
      }

      if (pending && pending.kind === "line" && (kind === "line" || kind === "X" || (kind !== "O" && isLine(pts)))) {
        if (kind === "line" || kind === "X" || twoLinesAreCross(pending.pts, pts) || isLine(pts)) {
          if (playingO) {
            dropStroke();
            return;
          }
          commitCell(pending.cell >= 0 ? pending.cell : cell, firstMark("X"), [pending.pts, pts.slice()]);
          return;
        }
      }

      if (kind === "tap") {
        commitCell(cell, firstMark("X"), []);
        return;
      }
      if (kind === "O") {
        commitCell(cell, firstMark("O"), [pts.slice()]);
        return;
      }
      if (kind === "X") {
        if (playingO) {
          dropStroke();
          return;
        }
        commitCell(cell, firstMark("X"), [pts.slice()]);
        return;
      }
      if (kind === "line") {
        if (playingO) {
          dropStroke();
          return;
        }
        pending = { pts: pts.slice(), cell, kind: "line" };
        pts = [];
        if (pendingTimer) window.clearTimeout(pendingTimer);
        pendingTimer = window.setTimeout(() => {
          pendingTimer = 0;
          const held = pending;
          pending = null;
          if (sideLocked && settings.human === 2) {
            if (skin.clearDraft) skin.clearDraft();
            if (renderer && renderer.draw) renderer.draw(snapshot());
            return;
          }
          if (held) {
            if (held.cell < 0 || !strokeFitsCell(held.pts, held.cell, inset, settings.cols, settings.rows)) {
              if (skin.clearDraft) skin.clearDraft();
              if (renderer && renderer.draw) renderer.draw(snapshot());
              return;
            }
            commitCell(held.cell, firstMark("X"), [held.pts]);
          }
        }, 1100);
        flushDraft();
        return;
      }
      dropStroke();
    };

    stage.addEventListener("pointerdown", (ev) => {
      activePointers.set(ev.pointerId, { type: ev.pointerType, primary: ev.isPrimary });
      if (cameraGesture(ev)) {
        cancelDrawForCamera();
        return;
      }
      if (ev.button != null && ev.button !== 0) return;
      if (ev.pointerType === "touch" && ev.isPrimary === false) return;
      if (inputBlocked() || phase !== "play" || turn !== settings.human) return;
      const t = ev.target;
      if (t && t.closest && t.closest("#radio, #score-card, #timer-card, #chrome-title, #ionic-mark")) return;
      const uv = uvFromEvent(ev);
      if (!uv) return;
      if (pendingTimer) {
        window.clearTimeout(pendingTimer);
        pendingTimer = 0;
      }
      drawing = true;
      drawPointerId = ev.pointerId;
      pts = [uv];
      // Do not capture: capture+lostpointercapture on overlay chrome drops the stroke.
      // #stage is full-bleed; window pointerup finishes if the pointer is released off-stage.
      if (ev.cancelable) ev.preventDefault();
      flushDraft();
    });
    stage.addEventListener("pointermove", (ev) => {
      if (activePointers.has(ev.pointerId)) {
        activePointers.set(ev.pointerId, { type: ev.pointerType, primary: ev.isPrimary });
      }
      if (cameraGesture(ev)) {
        cancelDrawForCamera();
        return;
      }
      if (!drawing) return;
      const uv = uvFromEvent(ev);
      if (!uv) return;
      const last = pts[pts.length - 1];
      if (!last || pathLength([last, uv]) > 0.002) pts.push(uv);
      flushDraft();
    });
    const end = (ev) => {
      activePointers.delete(ev.pointerId);
      if (!drawing) return;
      if (drawPointerId != null && ev.pointerId !== drawPointerId) return;
      drawing = false;
      releaseDrawCapture();
      finishStroke();
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener("touchstart", (ev) => {
      if (ev.touches && ev.touches.length >= 2) cancelDrawForCamera();
    }, { passive: true });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  bindSandDraw();
  if (hitEl) rebuildHits();
  {
    const kick = (ev) => {
      const t = ev && ev.target;
      if (t && t.closest && t.closest("#radio")) return;
      if (!radio || !radio.play) return;
      if (radio.isPlaying && radio.isPlaying()) return;
      radio.play();
    };
    // Not once: a click during GPU load may play() before src is ready.
    // Later gestures retry. Skip #radio so the play button owns those taps.
    window.addEventListener("pointerdown", kick, { capture: true });
    window.addEventListener("keydown", kick, { once: true });
    window.addEventListener("keydown", function (ev) {
      if (ev.code !== "Space" && ev.key !== " ") return;
      const tag = ev.target && ev.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (ev.target && ev.target.isContentEditable)) return;
      ev.preventDefault();
      // Space toggles music only. Do not freeze marks or the timer.
      if (musicPlaying()) {
        if (radio && radio.pause) radio.pause();
      } else if (radio && radio.play) {
        radio.play();
      }
    }, true);
  }

  function mountBackground(slot, el) {
    if (!el) return null;
    el.replaceChildren();
    if (!slot) {
      el.style.background = "#000000";
      return { kind: "empty" };
    }
    if (slot.color && !slot.fragment) {
      el.style.background = slot.color;
      return { kind: "solid", color: slot.color };
    }
    if (slot.fragment) {
      try {
        const { ShaderMount } = slot.ShaderMount ? { ShaderMount: slot.ShaderMount } : {};
        if (slot.mount) return slot.mount(el);
        el.style.background = slot.fallbackColor || "#000000";
      } catch (err) {
        console.warn("background shader", err);
        el.style.background = slot.fallbackColor || "#000000";
      }
    }
    return { kind: slot.kind || "solid" };
  }

  const bgEl = context.bgEl || document.getElementById("bg-mount");
  const fgEl = context.mountEl || document.getElementById("mount");
  mountBackground(skin.background, bgEl);
  if (skin.layoutHit) skin.layoutHit();
  renderer = await startRenderer({
    mountEl: fgEl,
    hitEl,
    skin,
    settings,
  });
  if (skin.publishSeed) skin.publishSeed(seedWin);
  paint();
  if (phase === "play" && turn === settings.human) startTimer();

  return {
    get engine() {
      return engine;
    },
    get board() {
      return board;
    },
    place: humanPlace,
    reset: resetBoard,
    snapshot,
    seedWin,
  };
}
