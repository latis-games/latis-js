import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ASSETS_BASE,
  DEFAULT_FADE_MS,
  DEFAULT_GRID,
  DEFAULT_INNER,
  bindWorld,
  normalizeWorldSpec,
  readWorldAsset,
  remapWorldUv,
  resolveAssetUrl,
  resolveWorld,
  viewportImageUvBounds,
  viewportTouchesOuter,
  worldUvRect,
} from "./world.js";

function fakeImg(n) {
  return { width: n, height: n };
}

function fakeAsset(attrs) {
  const map = Object.assign({}, attrs);
  return {
    id: "world",
    tagName: "LATIS-ASSET",
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(map, name);
    },
  };
}

test("resolveAssetUrl joins filenames under ./assets/", () => {
  assert.equal(resolveAssetUrl("island.webp"), "./assets/island.webp");
  assert.equal(resolveAssetUrl("island-full.webp"), "./assets/island-full.webp");
  assert.equal(resolveAssetUrl("island.webp", "./art/"), "./art/island.webp");
  assert.equal(resolveAssetUrl("./assets/island.webp"), "./assets/island.webp");
  assert.equal(resolveAssetUrl("/abs/island.webp"), "/abs/island.webp");
  assert.equal(resolveAssetUrl("https://cdn.example/island.webp"), "https://cdn.example/island.webp");
  assert.equal(resolveAssetUrl(""), "");
});

test("worldUvRect defaults are center 2×2 of 4×4", () => {
  const d = worldUvRect();
  assert.equal(d.grid, 4);
  assert.equal(d.inner, 2);
  assert.equal(d.offset, 0.25);
  assert.equal(d.scale, 0.5);
  assert.equal(d.min, 0.25);
  assert.equal(d.max, 0.75);
  const ident = worldUvRect(1, 1);
  assert.equal(ident.offset, 0);
  assert.equal(ident.scale, 1);
});

test("remapWorldUv keeps the board center and maps the inner crop to 0..1", () => {
  const rect = worldUvRect(4, 2);
  const mid = remapWorldUv(0.5, 0.5, rect);
  assert.ok(Math.abs(mid.x - 0.5) < 1e-12);
  assert.ok(Math.abs(mid.y - 0.5) < 1e-12);
  const lo = remapWorldUv(0.25, 0.25, rect);
  assert.ok(Math.abs(lo.x) < 1e-12);
  assert.ok(Math.abs(lo.y) < 1e-12);
  const hi = remapWorldUv(0.75, 0.75, rect);
  assert.ok(Math.abs(hi.x - 1) < 1e-12);
  assert.ok(Math.abs(hi.y - 1) < 1e-12);
  const board = remapWorldUv(0.342, 0.5, rect);
  assert.ok(board.x > 0 && board.x < 1);
  const ident = remapWorldUv(0.342, 0.5, worldUvRect(1, 1));
  assert.ok(Math.abs(ident.x - 0.342) < 1e-12);
});

test("normalizeWorldSpec defaults grid/inner and treats missing full as a single plate", () => {
  const single = normalizeWorldSpec({ lo: "island.webp" });
  assert.equal(single.grid, DEFAULT_GRID);
  assert.equal(single.inner, DEFAULT_INNER);
  assert.equal(single.fadeMs, DEFAULT_FADE_MS);
  assert.equal(single.assetsBase, DEFAULT_ASSETS_BASE);
  assert.equal(single.loUrl, "./assets/island.webp");
  assert.equal(single.progressive, false);
  assert.equal(single.uv.offset, 0);
  assert.equal(single.uv.scale, 1);

  const prog = normalizeWorldSpec({ lo: "island.webp", hi: "island-full.webp" });
  assert.equal(prog.progressive, true);
  assert.equal(prog.hiUrl, "./assets/island-full.webp");
  assert.equal(prog.uv.offset, 0.25);
  assert.equal(prog.uv.scale, 0.5);
  assert.equal(prog.grid, 4);
  assert.equal(prog.inner, 2);
});

test("readWorldAsset uses markup filenames and omits grid/inner defaults", () => {
  const el = fakeAsset({ src: "island.webp", full: "island-full.webp", preload: "" });
  const spec = readWorldAsset(el);
  assert.ok(spec);
  assert.equal(spec.loUrl, "./assets/island.webp");
  assert.equal(spec.hiUrl, "./assets/island-full.webp");
  assert.equal(spec.grid, 4);
  assert.equal(spec.inner, 2);
  assert.equal(spec.progressive, true);
  assert.equal(spec.preload, true);

  const only = readWorldAsset(fakeAsset({ src: "island.webp" }));
  assert.equal(only.progressive, false);
  assert.equal(only.loUrl, "./assets/island.webp");
  assert.equal(only.uv.scale, 1);

  const override = readWorldAsset(fakeAsset({ src: "island.webp", full: "island-full.webp", grid: "8", inner: "4" }));
  assert.equal(override.grid, 8);
  assert.equal(override.inner, 4);
  assert.equal(override.uv.offset, 0.25);
  assert.equal(override.uv.scale, 0.5);
});

test("viewportTouchesOuter is false at rest and true when panning into the ring", () => {
  const rect = worldUvRect(4, 2);
  const view = { w: 800, h: 800 };
  assert.equal(viewportTouchesOuter({ zoom: 2, panX: 0, panY: 0 }, view, rect), false);
  assert.equal(viewportTouchesOuter({ zoom: 1, panX: 0, panY: 0 }, view, rect), true);
  assert.equal(viewportTouchesOuter({ zoom: 1.6, panX: 0.22, panY: 0 }, view, rect), true);
  const ident = worldUvRect(1, 1);
  assert.equal(viewportTouchesOuter({ zoom: 1, panX: 0.4, panY: 0 }, view, ident), false);
});

test("viewportImageUvBounds matches cover mapping at zoom 1", () => {
  const b = viewportImageUvBounds({ zoom: 1, panX: 0, panY: 0 }, { w: 400, h: 400 });
  assert.ok(Math.abs(b.minX) < 1e-9);
  assert.ok(Math.abs(b.minY) < 1e-9);
  assert.ok(Math.abs(b.maxX - 1) < 1e-9);
  assert.ok(Math.abs(b.maxY - 1) < 1e-9);
});

test("bindWorld boots on lo, prefetches hi, fades after upload", async () => {
  const lo = fakeImg(32);
  const hi = fakeImg(64);
  const w = bindWorld({ lo, hi, fadeMs: 100 });
  assert.equal(w.progressive, true);
  assert.equal(await w.warmLo(), lo);
  await w.prefetchHi();
  assert.equal(w.hi, hi);
  assert.equal(w.sample().uploadHi, true);
  assert.equal(w.sample().offsetX, 0.25);
  assert.equal(w.sample().scaleX, 0.5);
  w.markHiUploaded(1000);
  assert.equal(w.tick(1000).mix, 0);
  const mid = w.tick(1050).mix;
  assert.ok(mid > 0 && mid < 1);
  assert.equal(w.tick(1100).mix, 1);
  const done = w.sample();
  assert.equal(done.offsetX, 0);
  assert.equal(done.scaleX, 1);
  assert.equal(done.mix, 1);
});

test("bindWorld single plate is identity UV and never explores-outer", async () => {
  const w = bindWorld({ lo: "island.webp" });
  assert.equal(w.spec.loUrl, "./assets/island.webp");
  assert.equal(w.progressive, false);
  const s = w.sample();
  assert.equal(s.offsetX, 0);
  assert.equal(s.scaleX, 1);
  assert.equal(s.uploadHi, false);
  assert.equal(w.explore({ zoom: 1, panX: 0.3, panY: 0, panUser: true }, { w: 800, h: 800 }), false);
  assert.equal(await w.prefetchHi(), null);
});

test("resolveWorld keeps a single island.webp plate on skin.islandUrl", () => {
  const w = resolveWorld({ islandUrl: "./assets/island.webp" });
  assert.equal(w.progressive, false);
  assert.equal(w.spec.loUrl, "./assets/island.webp");
  assert.equal(w.sample().scaleX, 1);
});

test("resolveWorld accepts bindWorld({ lo, hi }) on skin.world", () => {
  const w = resolveWorld({
    world: { lo: "island.webp", hi: "island-full.webp" },
    islandUrl: "./assets/legacy.webp",
  });
  assert.equal(w.progressive, true);
  assert.equal(w.spec.loUrl, "./assets/island.webp");
  assert.equal(w.spec.hiUrl, "./assets/island-full.webp");
  assert.equal(w.spec.uv.offset, 0.25);
});

test("readWorldAsset from a document-like root", () => {
  const el = fakeAsset({ src: "island.webp", full: "island-full.webp" });
  const spec = readWorldAsset({
    querySelector(sel) {
      return String(sel).includes("world") ? el : null;
    },
  });
  assert.equal(spec.loUrl, "./assets/island.webp");
  assert.equal(spec.hiUrl, "./assets/island-full.webp");
  assert.equal(spec.grid, 4);
  assert.equal(spec.inner, 2);
});

test("soft gate only banners when the user explores the unloaded ring", async () => {
  const w = bindWorld({ lo: fakeImg(8), hi: fakeImg(16) });
  await w.warmLo();
  const view = { w: 800, h: 800 };
  assert.equal(w.explore({ zoom: 1, panX: 0, panY: 0, panUser: false, zoomUser: false }, view), false);
  assert.equal(w.explore({ zoom: 1.7, panX: 0.2, panY: 0, panUser: true }, view), true);
  w.markHiUploaded(0);
  w.tick(1000);
  assert.equal(w.explore({ zoom: 1.7, panX: 0.2, panY: 0, panUser: true }, view), false);
});
