import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { engine } from "./shaders.js";
import { MeshoptDecoder } from "./meshopt.js";
import { loadMesh, resolveMeshBytes } from "./mesh.js";

// Official meshoptimizer encoder fixtures (v1 vertex / index).
const ENC_XY = new Uint8Array([
  161, 218, 218, 0, 36, 0, 255, 255, 0, 127, 0, 2, 255, 252, 0, 24, 0, 128, 128, 0, 0, 127, 1, 0, 255, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
]);
const POS_XY = new Float32Array([0, 0, 1, 0, 0.5, 1, 2, 3, -1, 4, 8, -2]);

const ENC_XYZ = new Uint8Array([
  161, 250, 250, 234, 0, 0, 255, 0, 0, 127, 126, 0, 0, 0, 0, 255, 0, 0, 127, 126, 0, 0, 0, 127, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
]);
const POS_XYZ = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);

const ENC_RGB = new Uint8Array([
  161, 191, 0, 2, 0, 20, 0, 1, 2, 40, 0, 0, 1, 62, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0,
  255, 0,
]);
const RGB = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255]);

const ENC_IDX = new Uint8Array([225, 240, 0, 118, 135, 86, 103, 120, 169, 134, 101, 137, 104, 152, 1, 105, 0, 0]);

function buildLtms({
  positions,
  colors,
  indices,
  positionStride,
  positionElemSize = 4,
  colorStride = 0,
  colorElemSize = 1,
  indexElemSize = 0,
}) {
  const vertexCount = (positions.length / positionStride) | 0;
  const indexCount = indices ? indices.length : 0;
  const posBytes = positions instanceof Uint8Array ? positions : new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);
  const colBytes = colors
    ? colors instanceof Uint8Array
      ? colors
      : new Uint8Array(colors.buffer, colors.byteOffset, colors.byteLength)
    : new Uint8Array(0);
  const idxBytes = indices
    ? indices instanceof Uint8Array
      ? indices
      : new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength)
    : new Uint8Array(0);
  const header = new Uint8Array(36);
  const dv = new DataView(header.buffer);
  header[0] = 0x4c;
  header[1] = 0x54;
  header[2] = 0x4d;
  header[3] = 0x53;
  dv.setUint16(4, 1, true);
  dv.setUint32(8, vertexCount, true);
  dv.setUint32(12, indexCount, true);
  header[16] = positionStride;
  header[17] = positionElemSize;
  header[18] = colorStride;
  header[19] = colorElemSize;
  header[20] = indexElemSize;
  dv.setUint32(24, posBytes.byteLength, true);
  dv.setUint32(28, colBytes.byteLength, true);
  dv.setUint32(32, idxBytes.byteLength, true);
  const out = new Uint8Array(36 + posBytes.byteLength + colBytes.byteLength + idxBytes.byteLength);
  out.set(header, 0);
  out.set(posBytes, 36);
  out.set(colBytes, 36 + posBytes.byteLength);
  out.set(idxBytes, 36 + posBytes.byteLength + colBytes.byteLength);
  return out;
}

test("MeshoptDecoder.decodeVertexBuffer roundtrips xy soup", async () => {
  await MeshoptDecoder.ready;
  const out = new Uint8Array(POS_XY.byteLength);
  MeshoptDecoder.decodeVertexBuffer(out, 6, 8, ENC_XY);
  assert.deepEqual(Array.from(new Float32Array(out.buffer)), Array.from(POS_XY));
});

test("MeshoptDecoder.decodeVertexBuffer roundtrips xyz and rgb", () => {
  const xyz = new Uint8Array(POS_XYZ.byteLength);
  MeshoptDecoder.decodeVertexBuffer(xyz, 4, 12, ENC_XYZ);
  assert.deepEqual(Array.from(new Float32Array(xyz.buffer)), Array.from(POS_XYZ));
  const rgb = new Uint8Array(16);
  MeshoptDecoder.decodeVertexBuffer(rgb, 4, 4, ENC_RGB);
  assert.deepEqual(Array.from(rgb), Array.from(RGB));
});

test("MeshoptDecoder.decodeIndexBuffer roundtrips a triangle", () => {
  const out = new Uint8Array(6);
  MeshoptDecoder.decodeIndexBuffer(out, 3, 2, ENC_IDX);
  assert.deepEqual(Array.from(new Uint16Array(out.buffer)), [0, 1, 2]);
});

test("loadMesh decodes raw meshopt vertex buffer via options", async () => {
  const mesh = await loadMesh(ENC_XY, { vertexCount: 6, positionStride: 2, positionElemSize: 4 });
  assert.equal(mesh.count, 6);
  assert.equal(mesh.stride, 2);
  assert.deepEqual(Array.from(mesh.positions), Array.from(POS_XY));
  assert.equal(mesh.colors, null);
  assert.equal(mesh.format, "meshopt");
});

test("loadMesh streams xy + rgb soup", async () => {
  const mesh = await loadMesh(ENC_XY, {
    streams: {
      positions: { source: ENC_XY, count: 6, components: 2, elemSize: 4 },
      colors: { source: ENC_RGB, count: 4, components: 4, elemSize: 1 },
    },
  });
  assert.equal(mesh.count, 6);
  assert.equal(mesh.stride, 2);
  assert.deepEqual(Array.from(mesh.positions), Array.from(POS_XY));
  assert.deepEqual(Array.from(mesh.colors), Array.from(RGB));
  assert.equal(mesh.colorStride, 4);
});

test("loadMesh LTMS + streams indices", async () => {
  const packed = buildLtms({
    positions: ENC_XYZ,
    indices: ENC_IDX,
    positionStride: 3,
    positionElemSize: 4,
    indexElemSize: 2,
  });
  const dv = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  dv.setUint32(8, 4, true);
  dv.setUint32(12, 3, true);
  const mesh = await loadMesh(packed);
  assert.equal(mesh.count, 4);
  assert.equal(mesh.stride, 3);
  assert.deepEqual(Array.from(mesh.positions), Array.from(POS_XYZ));
  assert.deepEqual(Array.from(mesh.indices), [0, 1, 2]);
  assert.equal(mesh.indexCount, 3);
});

test("engine.loadMesh is the same API", () => {
  assert.equal(typeof engine.loadMesh, "function");
  assert.equal(engine.loadMesh, loadMesh);
});

test("ArrayBuffer and url sources", async () => {
  const fromAb = await loadMesh(ENC_XYZ.buffer.slice(ENC_XYZ.byteOffset, ENC_XYZ.byteOffset + ENC_XYZ.byteLength), {
    vertexCount: 4,
    positionStride: 3,
  });
  assert.deepEqual(Array.from(fromAb.positions), Array.from(POS_XYZ));

  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, "./beach.mopt");
    return {
      ok: true,
      arrayBuffer: async () => ENC_XY.buffer.slice(ENC_XY.byteOffset, ENC_XY.byteOffset + ENC_XY.byteLength),
    };
  };
  try {
    const fromUrl = await loadMesh("./beach.mopt", { vertexCount: 6, stride: 2 });
    assert.equal(fromUrl.positions[2], 1);
  } finally {
    globalThis.fetch = prev;
  }
});

test("resolveMeshBytes rejects unknown sources", async () => {
  await assert.rejects(() => resolveMeshBytes(null), /expected url/);
  await assert.rejects(() => loadMesh(null), /expected url/);
});

test("meshopt.js is an in-repo JS decoder, not wasm", () => {
  const src = readFileSync(new URL("./meshopt.js", import.meta.url), "utf8");
  assert.equal(src.includes("\0asm"), false);
  assert.match(src, /decodeVertexBuffer/);
  assert.match(src, /decodeIndexBuffer/);
  assert.match(src, /meshoptimizer MIT/);
  assert.equal(typeof MeshoptDecoder.decodeIndexSequence, "undefined");
  const entry = readFileSync(new URL("./entry.js", import.meta.url), "utf8");
  assert.match(entry, /loadMesh/);
  assert.match(entry, /meshopt\.js/);
  const mesh = readFileSync(new URL("./mesh.js", import.meta.url), "utf8");
  assert.equal(mesh.includes("engine-wasm"), false);
  assert.equal(mesh.includes("wasmBase"), false);
});
