/**
 * loadMesh — meshopt-compressed meshes via the in-repo meshopt.js decoder.
 *
 * meshopt.js is the codec module (decodeVertexBuffer + decodeIndexBuffer).
 * esbuild folds it into dist/engine.min-vnext.js — no sidecar package,
 * no second URL, no WASM blobs. More codecs can join later as sibling modules.
 *
 * Raw int16 .bin soup stays a title-side fetch (Int16Array). Do not overload
 * image-plate loadAsset for meshes. Loader / store should not import this.
 */

import { MeshoptDecoder } from "./meshopt.js";
import { engine } from "./shaders.js";

const LTMS = [0x4c, 0x54, 0x4d, 0x53]; // "LTMS"

/**
 * @param {string|ArrayBuffer|ArrayBufferView} source
 * @returns {Promise<Uint8Array>}
 */
export async function resolveMeshBytes(source) {
  if (typeof source === "string") {
    if (typeof fetch !== "function") throw new Error("loadMesh: fetch unavailable");
    const res = await fetch(source);
    if (!res.ok) throw new Error("loadMesh: fetch " + res.status);
    return new Uint8Array(await res.arrayBuffer());
  }
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  throw new Error("loadMesh: expected url, ArrayBuffer, or Uint8Array");
}

function asTyped(v) {
  if (!v) return null;
  if (ArrayBuffer.isView(v)) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return new Float32Array(v);
  return null;
}

function meshoptVertexSize(components, elemSize) {
  const raw = (components * elemSize) | 0;
  return (raw + 3) & ~3;
}

function decodeVertex(decoder, source, count, size, filter) {
  const target = new Uint8Array(count * size);
  decoder.decodeVertexBuffer(target, count, size, source, filter);
  return target;
}

function decodeIndices(decoder, source, count, size) {
  const target = new Uint8Array(count * size);
  decoder.decodeIndexBuffer(target, count, size, source);
  const copy = target.buffer.slice(target.byteOffset, target.byteOffset + target.byteLength);
  return size === 4 ? new Uint32Array(copy) : new Uint16Array(copy);
}

function readElems(decoded, count, components, elemSize) {
  const byteStride = meshoptVertexSize(components, elemSize);
  const Ctor = elemSize === 2 ? Int16Array : Float32Array;
  const out = new Ctor(count * components);
  const dv = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  const get = elemSize === 2 ? "getInt16" : "getFloat32";
  for (let i = 0; i < count; i++) {
    const base = i * byteStride;
    for (let c = 0; c < components; c++) {
      out[i * components + c] = dv[get](base + c * elemSize, true);
    }
  }
  return out;
}

function readColors(decoded, count, components, elemSize) {
  const byteStride = meshoptVertexSize(components, elemSize);
  if (elemSize === 1) {
    const out = new Uint8Array(count * components);
    for (let i = 0; i < count; i++) {
      out.set(decoded.subarray(i * byteStride, i * byteStride + components), i * components);
    }
    return out;
  }
  if (elemSize === 4) return readElems(decoded, count, components, 4);
  const out = new Uint16Array(count * components);
  const dv = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < components; c++) {
      out[i * components + c] = dv.getUint16(i * byteStride + c * 2, true);
    }
  }
  return out;
}

function isPackedMesh(u8) {
  return (
    u8 &&
    u8.byteLength >= 36 &&
    u8[0] === LTMS[0] &&
    u8[1] === LTMS[1] &&
    u8[2] === LTMS[2] &&
    u8[3] === LTMS[3]
  );
}

/**
 * LTMS v1 packed mesh (optional container for several meshopt streams):
 *
 *   0  u32 magic "LTMS"
 *   4  u16 version (1)
 *   6  u16 flags
 *   8  u32 vertexCount
 *  12  u32 indexCount
 *  16  u8  positionStride (2 = xy soup, 3 = xyz)
 *  17  u8  positionElemSize (2 = i16, 4 = f32)
 *  18  u8  colorStride (0, 3 = rgb, 4 = rgba)
 *  19  u8  colorElemSize (1 = u8, 2 = u16, 4 = f32)
 *  20  u8  indexElemSize (0, 2, 4)
 *  21  u8  reserved
 *  22  u16 reserved
 *  24  u32 positionCompressedLength
 *  28  u32 colorCompressedLength
 *  32  u32 indexCompressedLength
 *  36  position bytes, then color bytes, then index bytes
 */
function parsePacked(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = dv.getUint16(4, true);
  if (version !== 1) throw new Error("loadMesh: unsupported LTMS version " + version);
  const vertexCount = dv.getUint32(8, true);
  const indexCount = dv.getUint32(12, true);
  const positionStride = u8[16];
  const positionElemSize = u8[17] || 4;
  const colorStride = u8[18];
  const colorElemSize = u8[19] || 1;
  const indexElemSize = u8[20];
  const posLen = dv.getUint32(24, true);
  const colLen = dv.getUint32(28, true);
  const idxLen = dv.getUint32(32, true);
  let off = 36;
  const positionSrc = u8.subarray(off, off + posLen);
  off += posLen;
  const colorSrc = colLen ? u8.subarray(off, off + colLen) : null;
  off += colLen;
  const indexSrc = idxLen ? u8.subarray(off, off + idxLen) : null;
  return {
    vertexCount,
    indexCount,
    positionStride,
    positionElemSize,
    colorStride,
    colorElemSize,
    indexElemSize,
    positionSrc,
    colorSrc,
    indexSrc,
  };
}

function sliceStream(bytes, spec) {
  if (!spec) return null;
  if (spec.source) {
    const s = spec.source;
    if (s instanceof Uint8Array) return s;
    if (s instanceof ArrayBuffer) return new Uint8Array(s);
    if (ArrayBuffer.isView(s)) return new Uint8Array(s.buffer, s.byteOffset, s.byteLength);
  }
  const off = spec.offset || 0;
  const len = spec.length != null ? spec.length : bytes.byteLength - off;
  return bytes.subarray(off, off + len);
}

function normalizeMesh(raw, fallback = {}) {
  if (!raw || typeof raw !== "object") throw new Error("loadMesh: decoder returned no mesh");
  const positions = asTyped(raw.positions || raw.position);
  if (!positions || !positions.length) throw new Error("loadMesh: mesh has no positions");
  const colors = asTyped(raw.colors || raw.color);
  const indices = asTyped(raw.indices || raw.index);
  const stride = (raw.stride || raw.positionStride || fallback.stride || 0) | 0;
  const resolvedStride = stride || (positions.length % 2 === 0 && positions.length % 3 !== 0 ? 2 : 3);
  const count =
    (raw.count || raw.vertexCount || fallback.count || 0) | 0 || ((positions.length / resolvedStride) | 0);
  const colorStride = colors
    ? (raw.colorStride || fallback.colorStride || ((colors.length / count) | 0)) | 0
    : 0;
  return {
    positions,
    colors: colors || null,
    indices: indices || null,
    count,
    stride: resolvedStride,
    positionStride: resolvedStride,
    colorStride,
    indexCount: indices ? indices.length : 0,
    format: raw.format || fallback.format || "meshopt",
  };
}

function decodePacked(decoder, bytes) {
  const h = parsePacked(bytes);
  const posSize = meshoptVertexSize(h.positionStride, h.positionElemSize);
  const posBytes = decodeVertex(decoder, h.positionSrc, h.vertexCount, posSize);
  const positions = readElems(posBytes, h.vertexCount, h.positionStride, h.positionElemSize);
  let colors = null;
  if (h.colorStride && h.colorSrc && h.colorSrc.length) {
    const colSize = meshoptVertexSize(h.colorStride, h.colorElemSize);
    const colBytes = decodeVertex(decoder, h.colorSrc, h.vertexCount, colSize);
    colors = readColors(colBytes, h.vertexCount, h.colorStride, h.colorElemSize);
  }
  let indices = null;
  if (h.indexCount && h.indexSrc && h.indexSrc.length && h.indexElemSize) {
    indices = decodeIndices(decoder, h.indexSrc, h.indexCount, h.indexElemSize);
  }
  return normalizeMesh({
    positions,
    colors,
    indices,
    count: h.vertexCount,
    stride: h.positionStride,
    colorStride: h.colorStride,
    format: "meshopt",
  });
}

function decodeStreams(decoder, bytes, options) {
  const streams = options.streams;
  if (streams && streams.positions) {
    const pos = streams.positions;
    const count = pos.count || options.vertexCount || options.count;
    const components = pos.components || pos.stride || options.positionStride || options.stride || 3;
    const elemSize = pos.elemSize || options.positionElemSize || 4;
    const size = pos.size || meshoptVertexSize(components, elemSize);
    if (!count) throw new Error("loadMesh: streams.positions.count required");
    const posBytes = decodeVertex(decoder, sliceStream(bytes, pos), count, size, pos.filter);
    const positions = readElems(posBytes, count, components, elemSize);
    let colors = null;
    let colorStride = 0;
    if (streams.colors) {
      const col = streams.colors;
      colorStride = col.components || col.stride || options.colorStride || 3;
      const colElem = col.elemSize || options.colorElemSize || 1;
      const colSize = col.size || meshoptVertexSize(colorStride, colElem);
      const colCount = col.count || count;
      const colBytes = decodeVertex(decoder, sliceStream(bytes, col), colCount, colSize, col.filter);
      colors = readColors(colBytes, colCount, colorStride, colElem);
    }
    let indices = null;
    if (streams.indices) {
      const idx = streams.indices;
      const indexCount = idx.count || options.indexCount;
      const indexSize = idx.size || options.indexSize || 2;
      if (!indexCount) throw new Error("loadMesh: streams.indices.count required");
      indices = decodeIndices(decoder, sliceStream(bytes, idx), indexCount, indexSize);
    }
    return normalizeMesh({
      positions,
      colors,
      indices,
      count,
      stride: components,
      colorStride,
      format: "meshopt",
    });
  }

  const count = options.vertexCount || options.count;
  const components = options.positionStride || options.stride || 3;
  const elemSize = options.positionElemSize || 4;
  const size = options.vertexSize || meshoptVertexSize(components, elemSize);
  if (!count) {
    throw new Error("loadMesh: compressed payload needs an LTMS header, options.streams, or options.vertexCount");
  }
  const posBytes = decodeVertex(decoder, bytes, count, size, options.positionFilter);
  const positions = readElems(posBytes, count, components, elemSize);
  return normalizeMesh({
    positions,
    colors: null,
    indices: null,
    count,
    stride: components,
    format: "meshopt",
  });
}

/**
 * Load a meshopt-compressed mesh. Decoder lives in meshopt.js and is bundled.
 *
 * @param {string|ArrayBuffer|ArrayBufferView} source
 * @param {object} [options]
 * @param {number} [options.vertexCount]
 * @param {number} [options.stride] position components (2 = xy soup, 3 = xyz)
 * @param {object} [options.streams] { positions, colors, indices } meshopt streams
 * @returns {Promise<{
 *   positions: Float32Array|Int16Array,
 *   colors: Uint8Array|Float32Array|Uint16Array|null,
 *   indices: Uint16Array|Uint32Array|null,
 *   count: number,
 *   stride: number,
 *   positionStride: number,
 *   colorStride: number,
 *   indexCount: number,
 *   format: string,
 * }>}
 */
export async function loadMesh(source, options) {
  const opts = options || {};
  const bytes = await resolveMeshBytes(source);
  await MeshoptDecoder.ready;
  const decoder = MeshoptDecoder;
  if (typeof opts.decode === "function") {
    const packed = await opts.decode(bytes, opts);
    if (packed) return normalizeMesh(packed, { format: packed.format || "meshopt" });
  }
  if (isPackedMesh(bytes)) return decodePacked(decoder, bytes);
  return decodeStreams(decoder, bytes, opts);
}

engine.loadMesh = loadMesh;

export { MeshoptDecoder };
export default loadMesh;
