/**
 * Progressive world plate.
 *
 * Markup (filenames only; resolved under ./assets/):
 *   <latis-asset id="world" src="island.webp" full="island-full.webp" preload />
 *
 * `src` is the boot inner (center inner×inner of grid×grid; defaults 2 of 4).
 * `full` is the upgrade pack. Omitted → single plate (today’s island.webp bind).
 * `grid` / `inner` default to 4 / 2 — omit unless a title overrides.
 *
 * One logical plate: board/shore UV stay in full-plate space. While only the
 * inner is bound, island samples remap so the center crop fills the inner
 * texture: tex = (uv − offset) / scale, offset = (grid − inner) / (2 · grid).
 * When island-full.webp arrives nothing jumps.
 *
 * latis-loader (separate repo) should preload only `src` for #world and may
 * leave full/grid/inner on the element. Engine reads the tag or bindWorld().
 */

import { applyRotToLocal } from "./camera.js";

export const DEFAULT_ASSETS_BASE = "./assets/";
export const DEFAULT_GRID = 4;
export const DEFAULT_INNER = 2;
export const DEFAULT_FADE_MS = 200;
export const DEFAULT_FADE_RATE = 0.01;
export const WORLD_BANNER_TEXT = "Loading map…";

let _world = null;

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(v, fallback, lo, hi) {
  const n = Math.round(num(v, fallback));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function isImageLike(v) {
  if (!v || typeof v === "string") return false;
  if (typeof Image !== "undefined" && v instanceof Image) return true;
  const w = v.width || v.naturalWidth || 0;
  const h = v.height || v.naturalHeight || 0;
  return w > 0 && h > 0 && typeof v !== "function";
}

function joinBase(base, name) {
  const left = String(base || DEFAULT_ASSETS_BASE);
  const prefix = left.endsWith("/") ? left : left + "/";
  return prefix + String(name).replace(/^\/+/, "");
}

/** Filename → URL. Paths and absolute URLs pass through. */
export function resolveAssetUrl(name, assetsBase = DEFAULT_ASSETS_BASE) {
  if (name == null) return "";
  const raw = String(name).trim();
  if (!raw) return "";
  if (/^(https?:|data:|blob:|file:)/i.test(raw)) return raw;
  if (raw.startsWith("/") || raw.startsWith("./") || raw.startsWith("../")) return raw;
  return joinBase(assetsBase, raw);
}

/** Center crop of a grid×grid plate. Defaults 2 of 4 → offset 0.25, scale 0.5. */
export function worldUvRect(grid = DEFAULT_GRID, inner = DEFAULT_INNER) {
  const g = clampInt(grid, DEFAULT_GRID, 1, 64);
  let n = clampInt(inner, DEFAULT_INNER, 1, 64);
  if (n > g) n = g;
  const scale = n / g;
  const offset = (g - n) / (2 * g);
  return { grid: g, inner: n, offset, scale, min: offset, max: offset + scale };
}

/** Logical plate UV → inner-texture UV. Identity when scale is 1. */
export function remapWorldUv(u, v, rect) {
  const o = rect && rect.offset != null ? Number(rect.offset) : 0;
  const s = rect && rect.scale != null ? Number(rect.scale) : 1;
  const den = s === 0 ? 1e-6 : s;
  return { x: (Number(u) - o) / den, y: (Number(v) - o) / den };
}

export function normalizeWorldSpec(opts = {}) {
  const assetsBase = opts.assetsBase || DEFAULT_ASSETS_BASE;
  const loIn = opts.lo != null ? opts.lo : (opts.src != null ? opts.src : (opts.loUrl || ""));
  const hiIn = opts.hi != null ? opts.hi : (opts.full != null ? opts.full : (opts.hiUrl || ""));
  const grid = opts.grid == null || opts.grid === "" ? DEFAULT_GRID : clampInt(opts.grid, DEFAULT_GRID, 1, 64);
  let inner = opts.inner == null || opts.inner === "" ? DEFAULT_INNER : clampInt(opts.inner, DEFAULT_INNER, 1, 64);
  if (inner > grid) inner = grid;
  let fadeMs = opts.fadeMs == null || opts.fadeMs === "" ? DEFAULT_FADE_MS : num(opts.fadeMs, DEFAULT_FADE_MS);
  if (fadeMs < 0) fadeMs = 0;
  let fadeRate = opts.fadeRate == null || opts.fadeRate === "" ? DEFAULT_FADE_RATE : num(opts.fadeRate, DEFAULT_FADE_RATE);
  if (fadeRate < 0) fadeRate = 0;
  const loUrl = isImageLike(loIn) ? "" : resolveAssetUrl(loIn, assetsBase);
  const hiUrl = isImageLike(hiIn) ? "" : resolveAssetUrl(hiIn, assetsBase);
  const progressive = !!(hiIn && (hiUrl || isImageLike(hiIn)));
  const uv = progressive ? worldUvRect(grid, inner) : worldUvRect(1, 1);
  return {
    lo: loIn,
    hi: hiIn || "",
    loUrl,
    hiUrl,
    grid,
    inner,
    fadeMs,
    fadeRate,
    assetsBase,
    progressive,
    uv,
    preload: !!opts.preload,
  };
}

function worldEl(root) {
  if (!root) return null;
  if (root.getAttribute && (root.id === "world" || root.tagName === "LATIS-ASSET")) {
    if (root.id === "world") return root;
  }
  if (typeof root.querySelector === "function") {
    return root.querySelector("latis-asset#world") || root.querySelector("#world");
  }
  if (typeof root.getElementById === "function") {
    return root.getElementById("world");
  }
  return null;
}

function attr(el, name) {
  if (!el || typeof el.getAttribute !== "function") return "";
  const v = el.getAttribute(name);
  return v == null ? "" : v;
}

/**
 * Read <latis-asset id="world">. Returns a spec or null if the tag is missing.
 * Filenames resolve under assetsBase (default ./assets/).
 */
export function readWorldAsset(root, opts = {}) {
  const doc = root && (root.querySelector || root.getAttribute || root.getElementById)
    ? root
    : (typeof document !== "undefined" ? document : null);
  const el = worldEl(doc);
  if (!el) return null;
  const src = attr(el, "src") || attr(el, "lo");
  if (!src && !attr(el, "full") && !attr(el, "hi")) return null;
  const base = opts.assetsBase
    || attr(el, "base")
    || (doc && doc.documentElement && typeof doc.documentElement.getAttribute === "function"
      && doc.documentElement.getAttribute("data-latis-assets"))
    || (typeof document !== "undefined" && document.documentElement
      && document.documentElement.getAttribute
      && document.documentElement.getAttribute("data-latis-assets"))
    || DEFAULT_ASSETS_BASE;
  const gridRaw = attr(el, "grid");
  const innerRaw = attr(el, "inner");
  const fadeRaw = attr(el, "fade") || attr(el, "fade-ms") || attr(el, "fadems");
  return normalizeWorldSpec({
    lo: src,
    hi: attr(el, "full") || attr(el, "hi"),
    grid: gridRaw === "" ? undefined : gridRaw,
    inner: innerRaw === "" ? undefined : innerRaw,
    fadeMs: fadeRaw === "" ? undefined : fadeRaw,
    assetsBase: base || DEFAULT_ASSETS_BASE,
    preload: typeof el.hasAttribute === "function" ? el.hasAttribute("preload") : false,
    el,
  });
}

/** Drop ImageBitmap / HTMLImageElement so the inner plate can GC. */
export function releaseWorldImage(img) {
  if (!img) return;
  try {
    if (typeof img.close === "function") img.close();
  } catch { /* ignore */ }
  try {
    if (typeof img.src === "string") img.src = "";
  } catch { /* ignore */ }
}

export function loadWorldImage(src) {
  if (!src) return Promise.reject(new Error("world image missing"));
  if (isImageLike(src)) return Promise.resolve(src);
  if (typeof Image === "undefined") {
    return Promise.reject(new Error("Image unavailable"));
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    const done = () => resolve(img);
    img.onload = () => {
      if (typeof img.decode === "function") img.decode().then(done).catch(done);
      else done();
    };
    img.onerror = () => reject(new Error("image " + src));
    img.src = src;
  });
}

function scheduleIdle(fn) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
      else fn();
    }, { timeout: 250 });
    return;
  }
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(fn);
    return;
  }
  fn();
}

/** Visible plate AABB in image UV (y = 0 at the top). Same cover mapping as the water shader. */
export function viewportImageUvBounds(cam = {}, viewport = {}) {
  const w = Math.max(1, num(viewport.w, 1));
  const h = Math.max(1, num(viewport.h, 1));
  const zoom = Math.max(num(cam.zoom, 1), 1e-6);
  const panX = num(cam.panX, 0);
  const panY = num(cam.panY, 0);
  const rot = num(cam.rot, 0);
  const side = Math.max(w, h);
  const originX = (w - side) * 0.5;
  const originY = (h - side) * 0.5;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const pts = [[0, 0], [w, 0], [0, h], [w, h]];
  for (let i = 0; i < pts.length; i++) {
    const lx = (pts[i][0] - originX) / side;
    const ly = (pts[i][1] - originY) / side;
    const r = applyRotToLocal(lx - 0.5, ly - 0.5, rot);
    const iuvx = r.x / zoom + 0.5 - panX;
    const iuvy = r.y / zoom + 0.5 - panY;
    const u = iuvx;
    const v = 1 - iuvy;
    if (u < minX) minX = u;
    if (u > maxX) maxX = u;
    if (v < minY) minY = v;
    if (v > maxY) maxY = v;
  }
  return { minX, minY, maxX, maxY };
}

/** True when the view overlaps the unloaded outer ring of an inner-only plate. */
export function viewportTouchesOuter(cam, viewport, rect) {
  if (!rect || !(rect.scale < 1)) return false;
  const b = viewportImageUvBounds(cam, viewport);
  const margin = 0.012;
  if (b.minX < rect.min - margin) return true;
  if (b.maxX > rect.max + margin) return true;
  if (b.minY < rect.min - margin) return true;
  if (b.maxY > rect.max + margin) return true;
  return false;
}

function userExploring(cam) {
  if (!cam) return false;
  if (cam.panUser || cam.zoomUser) return true;
  return Math.abs(num(cam.panX, 0)) > 0.008 || Math.abs(num(cam.panY, 0)) > 0.008;
}

export function setWorldBanner(show, text = WORLD_BANNER_TEXT) {
  if (typeof document === "undefined" || !document.createElement) return null;
  let el = document.getElementById("world-loading");
  if (!show) {
    if (el) {
      el.hidden = true;
      el.setAttribute("aria-hidden", "true");
    }
    return el;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "world-loading";
    el.setAttribute("role", "status");
    const stage = document.getElementById("stage") || document.body;
    if (stage) stage.appendChild(el);
  }
  el.textContent = text;
  el.hidden = false;
  el.setAttribute("aria-hidden", "false");
  return el;
}

export function getWorld() {
  return _world;
}

/**
 * Bind a progressive (or single) world plate.
 * @param {object} opts
 * @param {string|CanvasImageSource} [opts.lo] boot / inner
 * @param {string|CanvasImageSource} [opts.hi] upgrade / full plate
 * @param {number} [opts.grid=4]
 * @param {number} [opts.inner=2]
 * @param {number} [opts.fadeMs=200]
 * @param {number} [opts.fadeRate=0.01] blend step per rAF/frame
 * @param {string} [opts.assetsBase="./assets/"]
 */
export function bindWorld(opts = {}) {
  if (opts && typeof opts.warmLo === "function" && typeof opts.sample === "function") {
    _world = opts;
    return opts;
  }
  const spec = normalizeWorldSpec(opts);
  const world = {
    spec,
    lo: isImageLike(spec.lo) ? spec.lo : null,
    hi: isImageLike(spec.hi) ? spec.hi : null,
    mix: 0,
    readyToUpload: false,
    hiUploaded: false,
    hiFailed: false,
    loReleased: false,
    promoted: false,
    banner: false,
    fadeStart: 0,
    fadeFrames: 0,
    _loPromise: null,
    _hiPromise: null,

    get progressive() {
      return spec.progressive;
    },

    async warmLo() {
      if (world.lo) return world.lo;
      if (world._loPromise) return world._loPromise;
      const src = isImageLike(spec.lo) ? spec.lo : spec.loUrl;
      if (!src) return null;
      world._loPromise = loadWorldImage(src).then((img) => {
        world.lo = img;
        return img;
      });
      return world._loPromise;
    },

    prefetchHi() {
      if (!spec.progressive) return Promise.resolve(null);
      if (world.hi) {
        if (!world.readyToUpload && !world.hiUploaded) {
          scheduleIdle(() => { world.readyToUpload = true; });
        }
        return Promise.resolve(world.hi);
      }
      if (world._hiPromise) return world._hiPromise;
      const src = isImageLike(spec.hi) ? spec.hi : spec.hiUrl;
      if (!src) return Promise.resolve(null);
      world._hiPromise = loadWorldImage(src).then((img) => {
        world.hi = img;
        scheduleIdle(() => { world.readyToUpload = true; });
        return img;
      }).catch((err) => {
        world.hiFailed = true;
        world.banner = false;
        setWorldBanner(false);
        console.warn("world full plate", err);
        return null;
      });
      return world._hiPromise;
    },

    markHiUploaded(now) {
      world.hiUploaded = true;
      world.readyToUpload = false;
      world.fadeStart = num(now, (typeof performance !== "undefined" && performance.now) ? performance.now() : 0);
      world.fadeFrames = 0;
      world.mix = spec.fadeRate <= 0 ? 1 : 0;
      world.banner = false;
      setWorldBanner(false);
      if (world.mix >= 1) world.releaseInner();
    },

    releaseInner() {
      if (world.loReleased && !world.lo) return;
      const img = world.lo;
      world.lo = null;
      world.loReleased = true;
      world._loPromise = null;
      if (isImageLike(spec.lo)) spec.lo = spec.loUrl || "";
      releaseWorldImage(img);
    },

    markPromoted() {
      world.promoted = true;
      if (!world.loReleased) world.releaseInner();
    },

    tick() {
      if (world.hiUploaded && world.mix < 1) {
        if (spec.fadeRate <= 0) world.mix = 1;
        else {
          world.fadeFrames += 1;
          world.mix = Math.min(1, world.fadeFrames * spec.fadeRate);
        }
        if (world.mix >= 1) world.releaseInner();
      }
      return world.sample();
    },

    explore(cam, viewport) {
      if (!spec.progressive || world.hiUploaded || world.mix >= 1 || world.hiFailed) {
        if (world.banner) {
          world.banner = false;
          setWorldBanner(false);
        }
        return false;
      }
      const outer = viewportTouchesOuter(cam, viewport, spec.uv);
      const show = !!(outer && userExploring(cam));
      if (show !== world.banner) {
        world.banner = show;
        setWorldBanner(show);
      }
      return show;
    },

    sample() {
      const inner = spec.progressive && world.mix < 1 && !world.promoted ? spec.uv : { offset: 0, scale: 1 };
      return {
        lo: world.lo,
        hi: world.hi,
        mix: world.mix,
        progressive: spec.progressive,
        offsetX: inner.offset,
        offsetY: inner.offset,
        scaleX: inner.scale,
        scaleY: inner.scale,
        offsetHiX: 0,
        offsetHiY: 0,
        scaleHiX: 1,
        scaleHiY: 1,
        uploadHi: !!(world.hi && world.readyToUpload && !world.hiUploaded),
        promoteFull: !!(world.hi && world.hiUploaded && world.mix >= 1 && !world.promoted),
        bindFullOnly: !!world.promoted,
        loReleased: !!world.loReleased,
      };
    },
  };

  if (world.lo && spec.progressive && world.hi) {
    scheduleIdle(() => { world.readyToUpload = true; });
  }

  _world = world;
  return world;
}

/** Resolve #world, skin.world, or skin.islandUrl. Existing single-plate titles stay on islandUrl. */
export function resolveWorld(skin) {
  if (skin && skin.world && typeof skin.world.warmLo === "function") {
    _world = skin.world;
    return skin.world;
  }
  const assetsBase = (skin && skin.assetsBase)
    || (typeof document !== "undefined" && document.documentElement
      && document.documentElement.getAttribute
      && document.documentElement.getAttribute("data-latis-assets"))
    || DEFAULT_ASSETS_BASE;
  if (skin && skin.world) {
    return bindWorld(Object.assign({ assetsBase }, skin.world));
  }
  if (typeof document !== "undefined") {
    const spec = readWorldAsset(document, { assetsBase });
    if (spec && (spec.lo || spec.loUrl)) return bindWorld(spec);
  }
  if (skin && skin.islandUrl) {
    return bindWorld({ lo: skin.islandUrl, assetsBase });
  }
  return bindWorld({ assetsBase });
}

export function paintWorldPlate(ctx, world, ox, oy, side, fallback) {
  if (!ctx || side <= 0) return;
  const s = world && typeof world.sample === "function" ? world.sample() : null;
  if (s && s.hi && (s.bindFullOnly || s.mix >= 1)) {
    ctx.drawImage(s.hi, ox, oy, side, side);
    return;
  }
  const lo = (s && s.lo) || (s && s.loReleased ? null : fallback);
  if (lo) {
    const o = s ? s.offsetX : 0;
    const sc = s ? s.scaleX : 1;
    ctx.drawImage(lo, ox + o * side, oy + o * side, sc * side, sc * side);
  }
  if (s && s.hi && s.mix > 0) {
    ctx.save();
    ctx.globalAlpha = s.mix;
    ctx.drawImage(s.hi, ox, oy, side, side);
    ctx.restore();
  }
}
