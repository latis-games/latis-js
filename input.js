/** Title-facing input. Pointer tap/drag, adjacent swipe, keyboard, pinch-zoom. No pan. */

import { addPan, currentZoom, viewportSize, getCamera, applyTwoFingerGesture, bindCamera } from "./camera.js";

function cellFromBox(ev, el, box, cols, rows, inset) {
  if (!el || !box || !box.side) return -1;
  const rect = el.getBoundingClientRect();
  const ins = inset || { left: 0, right: 0, top: 0, bottom: 0 };
  const x0 = box.ox + (ins.left || 0) * box.side;
  const y0 = box.oy + (ins.top || 0) * box.side;
  const bw = box.side * (1 - (ins.left || 0) - (ins.right || 0));
  const bh = box.side * (1 - (ins.top || 0) - (ins.bottom || 0));
  if (bw <= 0 || bh <= 0) return -1;
  const x = ev.clientX - rect.left - x0;
  const y = ev.clientY - rect.top - y0;
  if (x < 0 || y < 0 || x > bw || y > bh) return -1;
  const c = Math.min(cols - 1, Math.max(0, (x / bw * cols) | 0));
  const r = Math.min(rows - 1, Math.max(0, (y / bh * rows) | 0));
  return r * cols + c;
}

function adjacent(a, b, cols) {
  if (a < 0 || b < 0) return false;
  const ac = a % cols, ar = (a / cols) | 0;
  const bc = b % cols, br = (b / cols) | 0;
  return Math.abs(ac - bc) + Math.abs(ar - br) === 1;
}

/**
 * Subscribe with `on(type, fn)`. Types: tap, drag, swipe, key, pan, zoom.
 * Left-click / one-finger stay with the title (tap/drag/swipe).
 */
export function createInput(opts = {}) {
  const listeners = new Map();
  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => off(type, fn);
  }
  function off(type, fn) {
    const set = listeners.get(type);
    if (set) set.delete(fn);
  }
  function emit(type, data) {
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of set) {
      try { fn(data); } catch (err) { console.warn("input", type, err); }
    }
  }

  const w = typeof window !== "undefined" ? window : null;
  const clean = [];
  if (!w) return { on, off, emit, dispose() {} };

  const el = opts.el || w.document.getElementById("stage") || w.document.body;
  const cols = () => (opts.cols != null ? opts.cols : (opts.settings && opts.settings.cols) || 0);
  const rows = () => (opts.rows != null ? opts.rows : (opts.settings && opts.settings.rows) || 0);
  const inset = () => opts.inset || (opts.skin && opts.skin.inset) || { left: 0, right: 0, top: 0, bottom: 0 };
  const boxOf = () => {
    if (typeof opts.playfieldBox === "function") return opts.playfieldBox(el);
    return null;
  };
  const cellAt = (ev) => {
    if (typeof opts.cellAt === "function") return opts.cellAt(ev);
    const box = boxOf();
    const c = cols();
    const r = rows();
    if (!box || !c || !r) return -1;
    return cellFromBox(ev, el, box, c, r, inset());
  };

  let drag = null;
  const activePtrs = new Set();
  const onDown = (ev) => {
    activePtrs.add(ev.pointerId);
    if (ev.pointerType === "touch" && (ev.isPrimary === false || activePtrs.size >= 2)) {
      if (drag && drag.kind === "draw") {
        emit("drag", { type: "cancel", x: ev.clientX, y: ev.clientY, event: ev });
        drag = null;
      }
      return;
    }
    if (ev.button != null && ev.button !== 0) return;
    if (ev.target && ev.target.closest && ev.target.closest("#radio, #score-card, #timer-card, #chrome-title, #ionic-mark")) return;
    drag = {
      kind: "draw",
      id: ev.pointerId,
      x: ev.clientX,
      y: ev.clientY,
      cell: cellAt(ev),
      moved: false,
    };
    emit("drag", { type: "start", x: ev.clientX, y: ev.clientY, cell: drag.cell, event: ev });
  };
  const onMove = (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    emit("drag", { type: "move", x: ev.clientX, y: ev.clientY, cell: cellAt(ev), event: ev });
  };
  const onUp = (ev) => {
    activePtrs.delete(ev.pointerId);
    if (!drag || ev.pointerId !== drag.id) return;
    const start = drag;
    drag = null;
    const cell = cellAt(ev);
    emit("drag", { type: "end", x: ev.clientX, y: ev.clientY, cell, event: ev });
    if (!start.moved) {
      emit("tap", { x: ev.clientX, y: ev.clientY, cell, event: ev });
    }
    const c = cols();
    if (c && start.cell >= 0 && cell >= 0 && start.cell !== cell && adjacent(start.cell, cell, c)) {
      emit("swipe", { from: start.cell, to: cell, event: ev });
    }
  };
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  clean.push(() => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
  });

  const fingers = new Map();
  const onTouchStart = (ev) => {
    for (const t of ev.changedTouches) fingers.set(t.identifier, { x: t.clientX, y: t.clientY });
    if (ev.touches.length >= 2 && drag && drag.kind === "draw") {
      emit("drag", { type: "cancel", event: ev });
      drag = null;
    }
  };
  const onTouchMove = (ev) => {
    if (ev.touches.length < 2) {
      for (const t of ev.changedTouches) fingers.set(t.identifier, { x: t.clientX, y: t.clientY });
      return;
    }
    ev.preventDefault();
    if (drag && drag.kind === "draw") {
      emit("drag", { type: "cancel", event: ev });
      drag = null;
    }
    const pts = [];
    for (const t of ev.touches) {
      const prev = fingers.get(t.identifier);
      pts.push({ x: t.clientX, y: t.clientY, px: prev ? prev.x : t.clientX, py: prev ? prev.y : t.clientY });
      fingers.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    if (pts.length < 2) return;
    const a = pts[0];
    const b = pts[1];
    // bindCamera already owns the gesture when mounted; do not double-apply.
    const gest = bindCamera._on ? null : applyTwoFingerGesture(a, b, opts.skin);
    const cx = gest ? gest.cx : (a.x + b.x) / 2;
    const cy = gest ? gest.cy : (a.y + b.y) / 2;
    const dx = gest ? gest.dx : (a.x + b.x) / 2 - (a.px + b.px) / 2;
    const dy = gest ? gest.dy : (a.y + b.y) / 2 - (a.py + b.py) / 2;
    if (gest && gest.zoomed) emit("zoom", { type: "pinch", camera: getCamera(), dist: gest.dist, pdist: gest.pdist });
  };
  const onTouchEnd = (ev) => {
    for (const t of ev.changedTouches) fingers.delete(t.identifier);
  };
  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("touchmove", onTouchMove, { passive: false });
  el.addEventListener("touchend", onTouchEnd);
  el.addEventListener("touchcancel", onTouchEnd);
  clean.push(() => {
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
    el.removeEventListener("touchcancel", onTouchEnd);
  });

  const down = new Set();
  const onKey = (ev) => {
    if (ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA" || ev.target.isContentEditable)) return;
    if (ev.type === "keydown") down.add(ev.key);
    else down.delete(ev.key);
    emit("key", {
      type: ev.type === "keydown" ? "down" : "up",
      key: ev.key,
      code: ev.code,
      repeat: !!ev.repeat,
      keys: new Set(down),
      event: ev,
    });
  };
  w.addEventListener("keydown", onKey);
  w.addEventListener("keyup", onKey);
  clean.push(() => {
    w.removeEventListener("keydown", onKey);
    w.removeEventListener("keyup", onKey);
  });

  return {
    on,
    off,
    emit,
    dispose() { for (const fn of clean) fn(); clean.length = 0; listeners.clear(); },
  };
}

export function bindInput(el, handlers = {}, opts = {}) {
  const input = createInput(Object.assign({ el }, opts));
  const offs = [];
  for (const [type, fn] of Object.entries(handlers)) {
    if (typeof fn === "function") offs.push(input.on(type, fn));
  }
  return {
    input,
    dispose() {
      for (const off of offs) off();
      input.dispose();
    },
  };
}

export { cellFromBox, adjacent };
