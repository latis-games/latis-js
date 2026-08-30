/** Shared zoom + pan + rot. State on window.__latisCamera only. */

const DEFAULT_ZOOM_MIN = 1;
const DEFAULT_ZOOM_MAX = 2.4;

function win() {
  return typeof window !== "undefined" ? window : null;
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function getCamera() {
  const w = win();
  if (!w) return { zoom: 1, panX: 0, panY: 0, rot: 0, zoomUser: false, panUser: false };
  const c = w.__latisCamera || {};
  return {
    zoom: num(c.zoom, 1),
    panX: num(c.panX, 0),
    panY: num(c.panY, 0),
    rot: num(c.rot, 0),
    zoomUser: !!c.zoomUser,
    panUser: !!c.panUser,
  };
}

export function writeCamera(partial) {
  const w = win();
  if (!w) return getCamera();
  w.__latisCamera = Object.assign(w.__latisCamera || {}, partial);
  return getCamera();
}

function skinZoomMin(skin) {
  return skin && skin.zoomMin != null ? Number(skin.zoomMin) : DEFAULT_ZOOM_MIN;
}

function skinZoomMax(skin) {
  return skin && skin.zoomMax != null ? Number(skin.zoomMax) : DEFAULT_ZOOM_MAX;
}

function skinTallQuery(skin) {
  return (skin && skin.tallQuery) || "(orientation: portrait), (max-width: 700px)";
}

export function viewportSize() {
  const w = win();
  if (!w) return { w: 0, h: 0 };
  const el = w.document && (w.document.getElementById("stage") || w.document.getElementById("mount"));
  if (el) {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }
  return { w: w.innerWidth || 0, h: w.innerHeight || 0 };
}

/** Cover zoom. Tall auto-fit unless the player pinched / ctrl-wheeled. */
export function playfieldZoom(vw, vh, skin) {
  if (skin && typeof skin.playfieldZoom === "function") return skin.playfieldZoom(vw, vh);
  const zoomMin = skinZoomMin(skin);
  const zoomMax = skinZoomMax(skin);
  const islandFit = skin && skin.islandFit != null ? Number(skin.islandFit) : 1;
  const sandTarget = skin && skin.sandTarget != null ? Number(skin.sandTarget) : 0.92;
  const inset = (skin && skin.inset) || { left: 0, right: 0, top: 0, bottom: 0 };
  const cam = getCamera();
  if (cam.zoomUser && Number.isFinite(cam.zoom)) {
    return Math.min(zoomMax, Math.max(zoomMin, cam.zoom));
  }
  const w = win();
  let tall = false;
  try { tall = !!(w && w.matchMedia && w.matchMedia(skinTallQuery(skin)).matches); } catch { /* ignore */ }
  if (tall && vw > 1 && vh > 1) {
    const sandFrac = 1 - (inset.left || 0) - (inset.right || 0);
    if (sandFrac <= 0) return 1;
    const targetW = vw * sandTarget;
    const z = targetW / (Math.max(vw, vh) * islandFit * sandFrac);
    return Math.min(zoomMax, Math.max(zoomMin, z));
  }
  if (Number.isFinite(cam.zoom) && cam.zoom > 0) return Math.min(zoomMax, Math.max(zoomMin, cam.zoom));
  return 1;
}

export function currentZoom(skin) {
  const { w, h } = viewportSize();
  return playfieldZoom(w, h, skin);
}

export function clampPan(panX, panY, vw, vh, zoom) {
  const side = Math.max(vw, vh, 1);
  const z = Math.max(1e-6, Number(zoom) || 1);
  const maxX = Math.max(0, 0.5 - vw / (2 * side * z));
  const maxY = Math.max(0, 0.5 - vh / (2 * side * z));
  return {
    panX: Math.min(maxX, Math.max(-maxX, num(panX, 0))),
    panY: Math.min(maxY, Math.max(-maxY, num(panY, 0))),
  };
}

export function setZoom(z, skin) {
  const next = Math.min(skinZoomMax(skin), Math.max(skinZoomMin(skin), num(z, 1)));
  const { w, h } = viewportSize();
  const cam = getCamera();
  const pan = clampPan(cam.panX, cam.panY, w, h, next);
  return writeCamera({ zoom: next, panX: pan.panX, panY: pan.panY });
}

export function setPan(panX, panY, skin) {
  const { w, h } = viewportSize();
  const z = currentZoom(skin);
  const pan = clampPan(panX, panY, w, h, z);
  return writeCamera({ panX: pan.panX, panY: pan.panY, panUser: true });
}

export function addPan(dx, dy, skin) {
  const cam = getCamera();
  return setPan(cam.panX + dx, cam.panY + dy, skin);
}

function wrapRot(r) {
  const pi = Math.PI;
  let x = (num(r, 0) + pi) % (pi * 2);
  if (x < 0) x += pi * 2;
  return x - pi;
}

export function setRot(r) {
  return writeCamera({ rot: wrapRot(r) });
}

export function addRot(d) {
  return setRot(getCamera().rot + num(d, 0));
}

/** Shader lookup rotation: (c x - s y, s x + c y). */
export function applyRotToLocal(x, y, rot) {
  const c = Math.cos(num(rot, 0));
  const s = Math.sin(num(rot, 0));
  return { x: c * x - s * y, y: s * x + c * y };
}

/**
 * Screen click → island UV. Same as the water shader so strokes land on cells:
 * rotate around cover/screen center, then existing zoom+pan box.
 */
export function screenToIslandUV(clientX, clientY, rect, box) {
  if (!rect) return null;
  const cam = getCamera();
  const w = rect.width;
  const h = rect.height;
  const cover = Math.max(w, h, 1);
  const originX = (w - cover) * 0.5;
  const originY = (h - cover) * 0.5;
  // Cover local, screen Y-down → shader Y-up (same as renderer.js / gpu.js).
  const lx = (clientX - rect.left - originX) / cover;
  const ly = (clientY - rect.top - originY) / cover;
  const r = applyRotToLocal(lx - 0.5, 0.5 - ly, num(box && box.rot != null ? box.rot : cam.rot, 0));
  const zoom = Math.max(num(box && box.zoom != null ? box.zoom : cam.zoom, 1), 1e-6);
  const panX = num(box && box.panX != null ? box.panX : cam.panX, 0);
  const panY = num(box && box.panY != null ? box.panY : cam.panY, 0);
  const iuvx = r.x / zoom + 0.5 - panX;
  const iuvy = r.y / zoom + 0.5 - panY;
  // Photo / carve / cells: y = 0 at the top of the island image.
  return { x: iuvx, y: 1 - iuvy };
}

/** Two-finger pinch zooms. Never pans. */
export function applyTwoFingerGesture(a, b, skin) {
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  const pdist = Math.hypot(a.px - b.px, a.py - b.py);
  let zoomed = false;
  if (pdist > 0 && dist !== pdist) {
    writeCamera({ zoomUser: true });
    setZoom(currentZoom(skin) * (dist / pdist), skin);
    zoomed = true;
  }
  return {
    zoomed,
    panned: false,
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    dx: 0,
    dy: 0,
    dist,
    pdist,
  };
}

/** Hits and paint share one cover box. Shader iuv -= pan; box origin += pan * side. */
export function applyPanToBox(box) {
  if (!box) return { side: 0, ox: 0, oy: 0, w: 0, h: 0, zoom: 1, panX: 0, panY: 0, rot: 0 };
  const cam = getCamera();
  const side = num(box.side, 0);
  return Object.assign({}, box, {
    ox: num(box.ox, 0) + cam.panX * side,
    oy: num(box.oy, 0) + cam.panY * side,
    panX: cam.panX,
    panY: cam.panY,
    rot: cam.rot,
    zoom: box.zoom != null ? box.zoom : cam.zoom,
  });
}

export function defaultPlayfieldBox(el, skin) {
  if (!el) return applyPanToBox({ side: 0, ox: 0, oy: 0, w: 0, h: 0, zoom: 1 });
  const rect = el.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const zoom = playfieldZoom(w, h, skin);
  const fit = skin && skin.islandFit != null ? Number(skin.islandFit) : 1;
  const side = Math.max(w, h) * fit * zoom;
  return applyPanToBox({ side, ox: (w - side) / 2, oy: (h - side) / 2, w, h, zoom });
}

/**
 * Engine pan. One mapping for every title. Not a per-game invert.
 * Shader samples iuv -= pan. A/Left adds +panX, D/Right adds -panX.
 * W/Up [0,-1], S/Down [0,+1]. Arrows are the same vectors as WASD.
 */
export const PAN_KEY_DELTA = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [1, 0], ArrowLeft: [1, 0],
  KeyD: [-1, 0], ArrowRight: [-1, 0],
};

/** Q clockwise, E counterclockwise. Same mapping for every title. */
export const ROT_KEY_DELTA = { KeyQ: -1, KeyE: 1 };

/**
 * Two-finger trackpad + Safari pinch + mobile pinch zoom.
 * WASD/arrows pan; island follows the key (see PAN_KEY_DELTA).
 * Q/E rotate the cay (Q CW, E CCW). No mouse/trackpad pan. Mouse stays click-and-draw.
 */
export function bindCamera({ skin, onChange } = {}) {
  const w = win();
  if (!w || bindCamera._on) return;
  bindCamera._on = true;
  bindCamera._skin = skin || null;
  writeCamera({ panX: 0, panY: 0, panUser: false, rot: getCamera().rot || 0 });
  setZoom(currentZoom(skin), skin);

  const notify = () => {
    if (typeof onChange === "function") onChange(getCamera());
  };

  let safariPinch = false;
  let safariStartZoom = 1;

  const onWheel = (ev) => {
    ev.preventDefault();
    if (safariPinch) return;
    const s = bindCamera._skin || skin;
    const factor = Math.exp(-ev.deltaY * 0.00115);
    writeCamera({ zoomUser: true });
    setZoom(currentZoom(s) * factor, s);
    notify();
  };
  w.addEventListener("wheel", onWheel, { passive: false });

  const onGestureStart = (ev) => {
    ev.preventDefault();
    safariPinch = true;
    const s = bindCamera._skin || skin;
    safariStartZoom = currentZoom(s);
  };
  const onGestureChange = (ev) => {
    ev.preventDefault();
    const s = bindCamera._skin || skin;
    writeCamera({ zoomUser: true });
    setZoom(safariStartZoom * ev.scale, s);
    notify();
  };
  const onGestureEnd = () => {
    safariPinch = false;
  };
  w.addEventListener("gesturestart", onGestureStart, { passive: false });
  w.addEventListener("gesturechange", onGestureChange, { passive: false });
  w.addEventListener("gestureend", onGestureEnd);
  w.addEventListener("gesturecancel", onGestureEnd);

  const held = new Set();
  const PAN_KEYS = PAN_KEY_DELTA;
  // Screen Y-down: +rot looks CCW. Q is clockwise (island follows Q to the right).
  const ROT_KEYS = ROT_KEY_DELTA;
  let panRaf = 0;
  const stepPan = () => {
    panRaf = 0;
    let dx = 0, dy = 0, dRot = 0;
    for (const code of held) {
      const v = PAN_KEYS[code];
      if (v) { dx += v[0]; dy += v[1]; }
      const rv = ROT_KEYS[code];
      if (rv) dRot += rv;
    }
    if (!dx && !dy && !dRot) return;
    const s = bindCamera._skin || skin;
    if (dx || dy) {
      // Same R as the water shader so keys stay screen-aligned after Q/E.
      const r = applyRotToLocal(dx, dy, getCamera().rot);
      addPan(r.x * 0.012, r.y * 0.012, s);
    }
    if (dRot) addRot(dRot * 0.018);
    notify();
    panRaf = w.requestAnimationFrame(stepPan);
  };
  const onKeyDown = (ev) => {
    if (!PAN_KEYS[ev.code] && !ROT_KEYS[ev.code]) return;
    const tag = ev.target && ev.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (ev.target && ev.target.isContentEditable)) return;
    ev.preventDefault();
    held.add(ev.code);
    if (!panRaf) panRaf = w.requestAnimationFrame(stepPan);
  };
  const onKeyUp = (ev) => {
    held.delete(ev.code);
  };
  w.addEventListener("keydown", onKeyDown);
  w.addEventListener("keyup", onKeyUp);

  const fingers = new Map();
  const onTouchStart = (ev) => {
    for (const t of ev.changedTouches) fingers.set(t.identifier, { x: t.clientX, y: t.clientY });
  };
  const onTouchMove = (ev) => {
    if (fingers.size < 2 && ev.touches.length < 2) {
      for (const t of ev.changedTouches) fingers.set(t.identifier, { x: t.clientX, y: t.clientY });
      return;
    }
    ev.preventDefault();
    const s = bindCamera._skin || skin;
    const pts = [];
    for (const t of ev.touches) {
      const prev = fingers.get(t.identifier);
      pts.push({ x: t.clientX, y: t.clientY, px: prev ? prev.x : t.clientX, py: prev ? prev.y : t.clientY });
      fingers.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    if (pts.length < 2) return;
    applyTwoFingerGesture(pts[0], pts[1], s);
    notify();
  };
  const onTouchEnd = (ev) => {
    for (const t of ev.changedTouches) fingers.delete(t.identifier);
  };
  w.addEventListener("touchstart", onTouchStart, { passive: true });
  w.addEventListener("touchmove", onTouchMove, { passive: false });
  w.addEventListener("touchend", onTouchEnd);
  w.addEventListener("touchcancel", onTouchEnd);

  const relayout = () => {
    const s = bindCamera._skin || skin;
    if (!getCamera().zoomUser) setZoom(currentZoom(s), s);
    else {
      const cam = getCamera();
      setPan(cam.panX, cam.panY, s);
    }
    notify();
  };
  w.addEventListener("resize", relayout);
  try {
    const mq = w.matchMedia(skinTallQuery(skin));
    if (mq.addEventListener) mq.addEventListener("change", relayout);
    else if (mq.addListener) mq.addListener(relayout);
  } catch { /* ignore */ }
}

export { skinZoomMin, skinZoomMax, skinTallQuery };
