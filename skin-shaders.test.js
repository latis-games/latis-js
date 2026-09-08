import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  pickShaderModuleUrl,
  normalizeShaderModule,
  resolveShaders,
} from "./skin-shaders.js";
import * as skinShaders from "./skin-shaders.js";
import * as shaders from "./shaders.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const webgpuFixture = pathToFileURL(path.join(dir, "fixtures/skin-shader-webgpu.js")).href;
const webglFixture = pathToFileURL(path.join(dir, "fixtures/skin-shader-webgl.js")).href;
const canvasFixture = pathToFileURL(path.join(dir, "fixtures/skin-shader-canvas.js")).href;
const islandAliasFixture = pathToFileURL(path.join(dir, "fixtures/skin-shader-island-aliases.js")).href;

test("pickShaderModuleUrl reads per-tier skin URLs", () => {
  const skin = {
    webgpuUrl: "./render/webgpu.js",
    webglUrl: " https://games.example/gl.js ",
    canvasUrl: "./render/canvas.js",
  };
  assert.equal(pickShaderModuleUrl(skin, "webgpu"), "./render/webgpu.js");
  assert.equal(pickShaderModuleUrl(skin, "webgl"), "https://games.example/gl.js");
  assert.equal(pickShaderModuleUrl(skin, "canvas"), "./render/canvas.js");
  assert.equal(pickShaderModuleUrl(skin, "2d"), "./render/canvas.js");
});

test("pickShaderModuleUrl is empty without a matching URL", () => {
  assert.equal(pickShaderModuleUrl(null, "webgpu"), "");
  assert.equal(pickShaderModuleUrl({}, "webgpu"), "");
  assert.equal(pickShaderModuleUrl({ webgpuUrl: "" }, "webgpu"), "");
  assert.equal(pickShaderModuleUrl({ webgpuUrl: "./a.js" }, ""), "");
});

test("normalizeShaderModule maps named exports", () => {
  const paint = () => {};
  const rec = normalizeShaderModule({
    vertex: "v",
    fragment: "f",
    wgsl: "w",
    paint,
  });
  assert.equal(rec.vertex, "v");
  assert.equal(rec.fragment, "f");
  assert.equal(rec.wgsl, "w");
  assert.equal(rec.paint, paint);
});

test("normalizeShaderModule accepts aliases and default object / string", () => {
  const a = normalizeShaderModule({ vertexSrc: "vs", fragmentSrc: "fs", wgslSrc: "wg" });
  assert.equal(a.vertex, "vs");
  assert.equal(a.fragment, "fs");
  assert.equal(a.wgsl, "wg");

  const b = normalizeShaderModule({ vs: "v2", fs: "f2", code: "c2" });
  assert.equal(b.vertex, "v2");
  assert.equal(b.fragment, "f2");
  assert.equal(b.wgsl, "c2");

  const c = normalizeShaderModule({ default: { vertex: "dv", fragment: "df" } });
  assert.equal(c.vertex, "dv");
  assert.equal(c.fragment, "df");

  const d = normalizeShaderModule({ default: "fn main(){}" }, "webgpu");
  assert.equal(d.wgsl, "fn main(){}");
  assert.equal(d.fragment, "");

  const e = normalizeShaderModule("void main(){}", "webgl");
  assert.equal(e.fragment, "void main(){}");
  assert.equal(e.wgsl, "");
});

test("normalizeShaderModule accepts island* export aliases", () => {
  const islandPaint = () => {};
  const rec = normalizeShaderModule({
    islandVertex: "iv",
    islandFragment: "if",
    islandWgsl: "iw",
    islandPaint,
  });
  assert.equal(rec.vertex, "iv");
  assert.equal(rec.fragment, "if");
  assert.equal(rec.wgsl, "iw");
  assert.equal(rec.paint, islandPaint);

  const paintIsland = () => {};
  const viaPaintIsland = normalizeShaderModule({ paintIsland });
  assert.equal(viaPaintIsland.paint, paintIsland);
});

test("normalizeShaderModule prefers generic names over island* aliases", () => {
  const genericPaint = () => {};
  const islandPaint = () => {};
  const rec = normalizeShaderModule({
    vertex: "v",
    islandVertex: "iv",
    fragment: "f",
    islandFragment: "if",
    wgsl: "w",
    islandWgsl: "iw",
    paint: genericPaint,
    islandPaint,
  });
  assert.equal(rec.vertex, "v");
  assert.equal(rec.fragment, "f");
  assert.equal(rec.wgsl, "w");
  assert.equal(rec.paint, genericPaint);
});

test("normalizeShaderModule empty module is blank", () => {
  const rec = normalizeShaderModule(null);
  assert.equal(rec.vertex, "");
  assert.equal(rec.fragment, "");
  assert.equal(rec.wgsl, "");
  assert.equal(rec.paint, null);
});

test("resolveShaders imports the title module by kind", async () => {
  const gpu = await resolveShaders({ webgpuUrl: webgpuFixture }, "webgpu");
  assert.match(gpu.wgsl, /fn vs/);

  const gl = await resolveShaders({ webglUrl: webglFixture }, "webgl");
  assert.match(gl.vertex, /a_pos/);
  assert.match(gl.fragment, /gl_FragColor/);

  const c2d = await resolveShaders({ canvasUrl: canvasFixture }, "canvas");
  assert.equal(typeof c2d.paint, "function");
  const canvas = {};
  c2d.paint(canvas);
  assert.equal(canvas._painted, true);
});

test("resolveShaders maps island* exports from a title module", async () => {
  const gpu = await resolveShaders({ webgpuUrl: islandAliasFixture }, "webgpu");
  assert.match(gpu.wgsl, /island_vs/);

  const gl = await resolveShaders({ webglUrl: islandAliasFixture }, "webgl");
  assert.match(gl.vertex, /a_island/);
  assert.match(gl.fragment, /gl_FragColor/);

  const c2d = await resolveShaders({ canvasUrl: islandAliasFixture }, "canvas");
  assert.equal(typeof c2d.paint, "function");
  const canvas = {};
  c2d.paint(canvas);
  assert.equal(canvas._islandPainted, true);
});

test("resolveShaders prefers skin.resolveShaders hook", async () => {
  const rec = await resolveShaders(
    {
      webgpuUrl: webgpuFixture,
      resolveShaders: async (kind) => {
        assert.equal(kind, "webgpu");
        return { wgsl: "hook-wgsl" };
      },
    },
    "webgpu"
  );
  assert.equal(rec.wgsl, "hook-wgsl");
});

test("resolveShaders without a URL is empty (engine keeps its own fallback)", async () => {
  const rec = await resolveShaders({}, "webgpu");
  assert.equal(rec.wgsl, "");
  assert.equal(rec.fragment, "");
});

test("public API has no island-named helpers", () => {
  assert.equal(skinShaders.resolveIslandShaders, undefined);
  assert.equal(skinShaders.islandFromModule, undefined);
  assert.equal(skinShaders.pickIslandShaderUrl, undefined);
  assert.equal(typeof skinShaders.pickShaderModuleUrl, "function");
  assert.equal(typeof skinShaders.resolveShaders, "function");
  assert.equal(typeof skinShaders.normalizeShaderModule, "function");
  assert.equal(typeof shaders.pickShaderModuleUrl, "function");
  assert.equal(typeof shaders.resolveShaders, "function");
  assert.equal(shaders.resolveIslandShaders, undefined);
});
