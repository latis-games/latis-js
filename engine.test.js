import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LatisEngine } from "./engine.js";
import {
  PAN_KEY_DELTA,
  ROT_KEY_DELTA,
  applyRotToLocal,
  playfieldZoom,
  clampPan,
  screenToIslandUV,
} from "./camera.js";
import { engine, setPalette } from "./shaders.js";
import { defineMetrics, setMetric } from "./metrics.js";

const here = dirname(fileURLToPath(import.meta.url));

test("sized at runtime", () => {
  const a = new LatisEngine(3, 3);
  assert.equal(a.cols(), 3);
  assert.equal(a.rows(), 3);
  assert.equal(a.len(), 9);
  for (let i = 0; i < 9; i++) assert.equal(a.cell(i), 0);

  const b = new LatisEngine(5, 5);
  assert.equal(b.len(), 25);

  const c = new LatisEngine(8, 8);
  assert.equal(c.cols(), 8);
  assert.equal(c.rows(), 8);
  assert.equal(c.len(), 64);
  assert.equal(c.full(), false);
  assert.deepEqual(c.kInARow(3), []);
});

test("place rejects occupied and oob", () => {
  const e = new LatisEngine(3, 3);
  assert.equal(e.place(4, 1), true);
  assert.equal(e.cell(4), 1);
  assert.equal(e.place(4, 2), false);
  assert.equal(e.cell(4), 1);
  assert.equal(e.place(9, 1), false);
  assert.equal(e.place(99, 2), false);
  assert.equal(e.place(-1, 1), false);
  assert.equal(e.cell(9), 0);
});

test("set and clear / reset", () => {
  const e = new LatisEngine(4, 2);
  e.set(3, 7);
  assert.equal(e.cell(3), 7);
  e.set(99, 1);
  e.set(-3, 1);
  assert.equal(e.len(), 8);
  e.clear();
  for (let i = 0; i < 8; i++) assert.equal(e.cell(i), 0);
  e.set(0, 3);
  e.reset();
  assert.equal(e.cell(0), 0);
});

test("k-in-a-row horizontal", () => {
  const e = new LatisEngine(3, 3);
  assert.equal(e.place(0, 1), true);
  assert.equal(e.place(1, 1), true);
  assert.equal(e.place(2, 1), true);
  assert.deepEqual(e.kInARow(3), [0, 1, 2]);
  assert.deepEqual(e.kInARow(4), []);
});

test("k-in-a-row vertical and diag", () => {
  const e = new LatisEngine(3, 3);
  e.set(0, 2);
  e.set(3, 2);
  e.set(6, 2);
  assert.deepEqual(e.kInARow(3), [0, 3, 6]);

  const d = new LatisEngine(3, 3);
  d.set(0, 1);
  d.set(4, 1);
  d.set(8, 1);
  assert.deepEqual(d.kInARow(3), [0, 4, 8]);

  const a = new LatisEngine(3, 3);
  a.set(2, 1);
  a.set(4, 1);
  a.set(6, 1);
  const anti = a.kInARow(3);
  assert.equal(anti.length, 3);
  assert.ok(anti.includes(2) && anti.includes(4) && anti.includes(6));
  const ends = [anti[0], anti[anti.length - 1]];
  assert.ok(ends.includes(2) && ends.includes(6));
});

test("k comes from caller on any size", () => {
  const e = new LatisEngine(5, 5);
  for (let i = 0; i < 4; i++) e.set(i * 5 + i, 9);
  assert.deepEqual(e.kInARow(4), [0, 6, 12, 18]);
  assert.deepEqual(e.kInARow(5), []);
  e.set(1, 9);
  assert.deepEqual(e.kInARow(5), []);
  e.set(4 * 5 + 4, 9);
  assert.deepEqual(e.kInARow(5), [0, 6, 12, 18, 24]);
});

test("full board", () => {
  const e = new LatisEngine(2, 2);
  assert.equal(e.full(), false);
  e.place(0, 1);
  e.place(1, 2);
  e.place(2, 1);
  assert.equal(e.full(), false);
  e.place(3, 2);
  assert.equal(e.full(), true);
  assert.deepEqual(e.kInARow(3), []);
});

test("neighbors corner center and bounds", () => {
  const e = new LatisEngine(3, 3);
  assert.deepEqual(e.neighbors(0), [1, 3, 4]);
  const center = e.neighbors(4);
  assert.equal(center.length, 8);
  assert.deepEqual(center, [0, 1, 2, 3, 5, 6, 7, 8]);
  assert.deepEqual(e.neighbors(99), []);
  assert.deepEqual(e.neighbors(-1), []);
  const edge = e.neighbors(1);
  assert.deepEqual(edge, [0, 2, 3, 4, 5]);
});

test("engine does not track turns", () => {
  const e = new LatisEngine(3, 3);
  assert.equal(e.place(0, 1), true);
  assert.equal(e.place(1, 1), true);
  assert.equal(e.place(4, 2), true);
  assert.equal(e.cell(0), 1);
  assert.equal(e.cell(1), 1);
  assert.equal(e.cell(4), 2);
});

test("k=0 and empty grid", () => {
  const e = new LatisEngine(3, 3);
  e.place(0, 1);
  e.place(1, 1);
  e.place(2, 1);
  assert.deepEqual(e.kInARow(0), []);
  const z = new LatisEngine(0, 0);
  assert.equal(z.len(), 0);
  assert.equal(z.full(), false);
  assert.deepEqual(z.kInARow(3), []);
  assert.deepEqual(z.neighbors(0), []);
});

test("pan keys: island follows Left/A, arrows match WASD", () => {
  const k = PAN_KEY_DELTA;
  assert.deepEqual(k.KeyA, [1, 0]);
  assert.deepEqual(k.KeyD, [-1, 0]);
  assert.deepEqual(k.ArrowLeft, k.KeyA);
  assert.deepEqual(k.ArrowRight, k.KeyD);
  assert.deepEqual(k.ArrowUp, k.KeyW);
  assert.deepEqual(k.ArrowDown, k.KeyS);
  assert.deepEqual(k.KeyW, [0, -1]);
  assert.deepEqual(k.KeyS, [0, 1]);
});

test("rotate keys: Q clockwise, E counterclockwise", () => {
  assert.equal(ROT_KEY_DELTA.KeyQ, -1);
  assert.equal(ROT_KEY_DELTA.KeyE, 1);
});

test("applyRotToLocal maps D to screen-right after 90 deg", () => {
  const [dx, dy] = PAN_KEY_DELTA.KeyD;
  const r0 = applyRotToLocal(dx, dy, 0);
  assert.equal(r0.x, dx);
  assert.equal(r0.y, dy);
  const r90 = applyRotToLocal(dx, dy, Math.PI / 2);
  assert.ok(Math.abs(r90.x) < 1e-10);
  assert.ok(Math.abs(r90.y - dx) < 1e-10);
});

test("engine.palette is an array; [0] is primary", () => {
  setPalette(["#F0B800", "#583000", "nope"]);
  assert.deepEqual(engine.palette, ["#F0B800", "#583000"]);
  setPalette(["#abc", "rgb(1, 2, 3)"]);
  assert.deepEqual(engine.palette, ["#abc", "rgb(1, 2, 3)"]);
  setPalette("not-an-array");
  assert.deepEqual(engine.palette, []);
});

test("WebGPU and WebGL paint zoom < 1 instead of clamping at 1", () => {
  const gpu = readFileSync(join(here, "gpu.js"), "utf8");
  const gl = readFileSync(join(here, "renderer.js"), "utf8");
  assert.match(gpu, /p \/ max\(u\.zoom, 1e-6\)/);
  assert.match(gl, /p \/ max\(u_zoom, 1e-6\)/);
  assert.doesNotMatch(gpu, /max\(u\.zoom, 1\.0\)/);
  assert.doesNotMatch(gl, /max\(u_zoom, 1\.0\)/);
  assert.match(gpu, /uniformData\[3\] = currentZoom\(\)/);
  assert.match(gl, /gl\.uniform1f\(uZoom, currentZoom\(\)\)/);
});

test("cover zoom 0.55 stores and maps more island UV than zoom 1", () => {
  const prev = globalThis.window;
  globalThis.window = {
    __latisCamera: { zoom: 0.55, zoomUser: true, panX: 0, panY: 0, rot: 0 },
    innerWidth: 800,
    innerHeight: 600,
    document: { getElementById() { return null; } },
  };
  try {
    const skin = { zoomMin: 0.55, zoomMax: 2.4 };
    assert.equal(playfieldZoom(800, 600, skin), 0.55);

    const rect = { left: 0, top: 0, width: 800, height: 600 };
    const box1 = { zoom: 1, panX: 0, panY: 0, rot: 0 };
    const boxOut = { zoom: 0.55, panX: 0, panY: 0, rot: 0 };
    const mid1 = screenToIslandUV(400, 300, rect, box1);
    const midOut = screenToIslandUV(400, 300, rect, boxOut);
    assert.ok(Math.abs(mid1.x - 0.5) < 1e-6);
    assert.ok(Math.abs(midOut.x - 0.5) < 1e-6);

    const left1 = screenToIslandUV(0, 300, rect, box1);
    const leftOut = screenToIslandUV(0, 300, rect, boxOut);
    // Cover side = max(w,h). Zoom 1 maps the left cover edge to UV 0.
    // Zoom 0.55 maps that same pixel past the photo (more island on screen).
    assert.ok(Math.abs(left1.x) < 1e-6);
    assert.ok(leftOut.x < -0.3);
    const span1 = screenToIslandUV(800, 300, rect, box1).x - left1.x;
    const spanOut = screenToIslandUV(800, 300, rect, boxOut).x - leftOut.x;
    assert.ok(spanOut > span1);
    assert.ok(Math.abs(spanOut - 1 / 0.55) < 1e-6);

    const pan = clampPan(0.4, 0.4, 800, 600, 0.55);
    assert.equal(pan.panX, 0);
    assert.equal(pan.panY, 0);
  } finally {
    if (prev === undefined) delete globalThis.window;
    else globalThis.window = prev;
  }
});

test("engine.metrics is an array keyed by id", () => {
  defineMetrics([
    { id: "turn", label: "TURN", value: "X" },
    { id: "score", label: "SCORE", value: 0 },
  ]);
  assert.equal(engine.metrics.length, 3);
  assert.equal(engine.metrics["turn"].value, "X");
  setMetric("turn", "O");
  assert.equal(engine.metrics["turn"].value, "O");
  assert.equal(engine.metrics[0].id, "turn");
  assert.equal(engine.metrics["fps"].id, "fps");
  setMetric("fps", "120");
  assert.equal(engine.metrics["fps"].value, "120");
});
