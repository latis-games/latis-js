/**
 * Minimal 3D pack. No Three.js. Scene graph, camera, mesh, lights, raycast, resize/DPR.
 * Optional tiny GLB mesh loader (POSITION + indices).
 */

function ident(out) {
  const m = out || new Float32Array(16);
  m.fill(0);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mul(a, b, out) {
  const o = out || new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      o[j * 4 + i] =
        a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    }
  }
  return o;
}

function compose(pos, rot, scale, out) {
  const cx = Math.cos(rot[0]), sx = Math.sin(rot[0]);
  const cy = Math.cos(rot[1]), sy = Math.sin(rot[1]);
  const cz = Math.cos(rot[2]), sz = Math.sin(rot[2]);
  const m = out || new Float32Array(16);
  // XYZ euler * scale + translate
  const rx = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
  const ry = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
  const rz = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const s = ident();
  s[0] = scale[0]; s[5] = scale[1]; s[10] = scale[2];
  const r = mul(mul(rz, ry), rx);
  mul(r, s, m);
  m[12] = pos[0]; m[13] = pos[1]; m[14] = pos[2];
  return m;
}

function invertAffine(m, out) {
  const o = out || new Float32Array(16);
  const a00 = m[0], a01 = m[1], a02 = m[2];
  const a10 = m[4], a11 = m[5], a12 = m[6];
  const a20 = m[8], a21 = m[9], a22 = m[10];
  const det = a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
  if (Math.abs(det) < 1e-12) return ident(o);
  const inv = 1 / det;
  o[0] = (a11 * a22 - a12 * a21) * inv;
  o[1] = (a02 * a21 - a01 * a22) * inv;
  o[2] = (a01 * a12 - a02 * a11) * inv;
  o[3] = 0;
  o[4] = (a12 * a20 - a10 * a22) * inv;
  o[5] = (a00 * a22 - a02 * a20) * inv;
  o[6] = (a02 * a10 - a00 * a12) * inv;
  o[7] = 0;
  o[8] = (a10 * a21 - a11 * a20) * inv;
  o[9] = (a01 * a20 - a00 * a21) * inv;
  o[10] = (a00 * a11 - a01 * a10) * inv;
  o[11] = 0;
  o[12] = -(o[0] * m[12] + o[4] * m[13] + o[8] * m[14]);
  o[13] = -(o[1] * m[12] + o[5] * m[13] + o[9] * m[14]);
  o[14] = -(o[2] * m[12] + o[6] * m[13] + o[10] * m[14]);
  o[15] = 1;
  return o;
}

function transformPoint(m, x, y, z, out) {
  const o = out || [0, 0, 0];
  o[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  o[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  o[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return o;
}

function transformDir(m, x, y, z, out) {
  const o = out || [0, 0, 0];
  o[0] = m[0] * x + m[4] * y + m[8] * z;
  o[1] = m[1] * x + m[5] * y + m[9] * z;
  o[2] = m[2] * x + m[6] * y + m[10] * z;
  return o;
}

export class Object3D {
  constructor() {
    this.position = [0, 0, 0];
    this.rotation = [0, 0, 0];
    this.scale = [1, 1, 1];
    this.parent = null;
    this.children = [];
    this.visible = true;
    this.matrix = ident();
    this.worldMatrix = ident();
    this.name = "";
  }
  add(child) {
    if (!child || child === this) return this;
    if (child.parent) child.parent.remove(child);
    child.parent = this;
    this.children.push(child);
    return this;
  }
  remove(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) {
      this.children.splice(i, 1);
      child.parent = null;
    }
    return this;
  }
  updateMatrix() {
    compose(this.position, this.rotation, this.scale, this.matrix);
    return this.matrix;
  }
  updateWorldMatrix() {
    this.updateMatrix();
    if (this.parent) mul(this.parent.worldMatrix, this.matrix, this.worldMatrix);
    else this.worldMatrix.set(this.matrix);
    for (const c of this.children) c.updateWorldMatrix();
    return this.worldMatrix;
  }
}

export class Scene extends Object3D {
  constructor() {
    super();
    this.lights = [];
  }
  add(child) {
    super.add(child);
    if (child && (child.isLight || child.kind === "light")) this.lights.push(child);
    return this;
  }
  remove(child) {
    super.remove(child);
    const i = this.lights.indexOf(child);
    if (i >= 0) this.lights.splice(i, 1);
    return this;
  }
}

export class PerspectiveCamera extends Object3D {
  constructor(fov = 50, aspect = 1, near = 0.1, far = 100) {
    super();
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this.projection = ident();
  }
  projectionMatrix() {
    const f = 1 / Math.tan((this.fov * Math.PI) / 360);
    const nf = 1 / (this.near - this.far);
    const m = this.projection;
    m.fill(0);
    m[0] = f / Math.max(this.aspect, 1e-6);
    m[5] = f;
    m[10] = (this.far + this.near) * nf;
    m[11] = -1;
    m[14] = 2 * this.far * this.near * nf;
    return m;
  }
  viewMatrix(out) {
    this.updateWorldMatrix();
    return invertAffine(this.worldMatrix, out || new Float32Array(16));
  }
}

export class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry || { position: new Float32Array(0), index: null };
    this.material = material || { color: [1, 1, 1] };
  }
}

export class DirectionalLight {
  constructor(color = [1, 1, 1], intensity = 1) {
    this.kind = "light";
    this.isLight = true;
    this.type = "directional";
    this.color = color;
    this.intensity = intensity;
    this.direction = [0, -1, 0];
    this.position = [0, 10, 0];
  }
}

export class HemisphereLight {
  constructor(sky = [1, 1, 1], ground = [0.2, 0.2, 0.2], intensity = 1) {
    this.kind = "light";
    this.isLight = true;
    this.type = "hemisphere";
    this.sky = sky;
    this.ground = ground;
    this.intensity = intensity;
    this.position = [0, 1, 0];
  }
}

function rayTriangle(orig, dir, a, b, c) {
  const EPS = 1e-7;
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < EPS) return null;
  const inv = 1 / det;
  const tvec = [orig[0] - a[0], orig[1] - a[1], orig[2] - a[2]];
  const u = (tvec[0] * p[0] + tvec[1] * p[1] + tvec[2] * p[2]) * inv;
  if (u < 0 || u > 1) return null;
  const q = [tvec[1] * e1[2] - tvec[2] * e1[1], tvec[2] * e1[0] - tvec[0] * e1[2], tvec[0] * e1[1] - tvec[1] * e1[0]];
  const v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
  if (t < EPS) return null;
  return t;
}

function rayAABB(orig, dir, min, max) {
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-12) {
      if (orig[i] < min[i] || orig[i] > max[i]) return null;
      continue;
    }
    const inv = 1 / dir[i];
    let t1 = (min[i] - orig[i]) * inv;
    let t2 = (max[i] - orig[i]) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : tmax;
}

function geomAABB(geo) {
  const pos = geo && geo.position;
  if (!pos || !pos.length) return { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < min[0]) min[0] = pos[i];
    if (pos[i + 1] < min[1]) min[1] = pos[i + 1];
    if (pos[i + 2] < min[2]) min[2] = pos[i + 2];
    if (pos[i] > max[0]) max[0] = pos[i];
    if (pos[i + 1] > max[1]) max[1] = pos[i + 1];
    if (pos[i + 2] > max[2]) max[2] = pos[i + 2];
  }
  return { min, max };
}

export class Raycaster {
  constructor() {
    this.origin = [0, 0, 0];
    this.direction = [0, 0, -1];
  }
  set(origin, direction) {
    this.origin = origin.slice();
    const len = Math.hypot(direction[0], direction[1], direction[2]) || 1;
    this.direction = [direction[0] / len, direction[1] / len, direction[2] / len];
    return this;
  }
  setFromCamera(ndc, camera) {
    const proj = camera.projectionMatrix();
    const view = camera.viewMatrix();
    const invView = camera.worldMatrix;
    const px = ndc[0];
    const py = ndc[1];
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const x = px * tan * camera.aspect;
    const y = py * tan;
    const origin = [invView[12], invView[13], invView[14]];
    const dir = transformDir(invView, x, y, -1, []);
    return this.set(origin, dir);
  }
  intersectTriangle(a, b, c) {
    const t = rayTriangle(this.origin, this.direction, a, b, c);
    if (t == null) return null;
    return {
      distance: t,
      point: [
        this.origin[0] + this.direction[0] * t,
        this.origin[1] + this.direction[1] * t,
        this.origin[2] + this.direction[2] * t,
      ],
    };
  }
  intersectAABB(min, max) {
    const t = rayAABB(this.origin, this.direction, min, max);
    if (t == null) return null;
    return { distance: t };
  }
  intersectObject(obj, recursive = true, dest = []) {
    if (!obj || obj.visible === false) return dest;
    obj.updateWorldMatrix();
    if (obj.geometry && obj.geometry.position && obj.geometry.position.length) {
      const pos = obj.geometry.position;
      const idx = obj.geometry.index;
      const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
      const triCount = idx ? (idx.length / 3) | 0 : (pos.length / 9) | 0;
      let hitT = Infinity;
      for (let i = 0; i < triCount; i++) {
        const i0 = idx ? idx[i * 3] : i * 3;
        const i1 = idx ? idx[i * 3 + 1] : i * 3 + 1;
        const i2 = idx ? idx[i * 3 + 2] : i * 3 + 2;
        transformPoint(obj.worldMatrix, pos[i0 * 3], pos[i0 * 3 + 1], pos[i0 * 3 + 2], a);
        transformPoint(obj.worldMatrix, pos[i1 * 3], pos[i1 * 3 + 1], pos[i1 * 3 + 2], b);
        transformPoint(obj.worldMatrix, pos[i2 * 3], pos[i2 * 3 + 1], pos[i2 * 3 + 2], c);
        const t = rayTriangle(this.origin, this.direction, a, b, c);
        if (t != null && t < hitT) hitT = t;
      }
      if (hitT < Infinity) {
        dest.push({
          object: obj,
          distance: hitT,
          point: [
            this.origin[0] + this.direction[0] * hitT,
            this.origin[1] + this.direction[1] * hitT,
            this.origin[2] + this.direction[2] * hitT,
          ],
        });
      } else {
        const box = geomAABB(obj.geometry);
        const min = transformPoint(obj.worldMatrix, box.min[0], box.min[1], box.min[2], []);
        const max = transformPoint(obj.worldMatrix, box.max[0], box.max[1], box.max[2], []);
        const aabbMin = [Math.min(min[0], max[0]), Math.min(min[1], max[1]), Math.min(min[2], max[2])];
        const aabbMax = [Math.max(min[0], max[0]), Math.max(min[1], max[1]), Math.max(min[2], max[2])];
        const hit = this.intersectAABB(aabbMin, aabbMax);
        if (hit) dest.push({ object: obj, distance: hit.distance, aabb: true });
      }
    }
    if (recursive) for (const ch of obj.children || []) this.intersectObject(ch, true, dest);
    dest.sort((x, y) => x.distance - y.distance);
    return dest;
  }
}

export function resizeRenderer(canvas, dpr) {
  if (!canvas) return { w: 0, h: 0, dpr: 1 };
  const el = canvas.parentElement || canvas;
  const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: canvas.width, height: canvas.height };
  const ratio = Math.min(dpr != null ? dpr : (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1), 2);
  const w = Math.max(1, Math.round((rect.width || 1) * ratio));
  const h = Math.max(1, Math.round((rect.height || 1) * ratio));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  return { w, h, dpr: ratio };
}

function accessorArray(json, bin, accIndex) {
  const acc = json.accessors[accIndex];
  const view = json.bufferViews[acc.bufferView];
  const off = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const typeCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type] || 3;
  const n = acc.count * typeCount;
  const slice = bin.slice(off, off + n * (acc.componentType === 5126 ? 4 : acc.componentType === 5125 ? 4 : 2));
  if (acc.componentType === 5126) return new Float32Array(slice);
  if (acc.componentType === 5125) return new Uint32Array(slice);
  if (acc.componentType === 5123) return new Uint16Array(slice);
  if (acc.componentType === 5121) return new Uint8Array(slice);
  return new Uint16Array(slice);
}

export function parseGLB(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("loadGLB: not a GLB (missing glTF magic)");
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error("loadGLB: unsupported glTF version " + version);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= u8.byteLength) {
    const len = dv.getUint32(offset, true);
    const type = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    const chunk = u8.subarray(start, start + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    offset = start + len;
  }
  if (!json) throw new Error("loadGLB: missing JSON chunk");
  if (!bin) bin = new Uint8Array(0);
  const binBuf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  const meshes = [];
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const posAcc = prim.attributes && prim.attributes.POSITION;
      if (posAcc == null) continue;
      const position = accessorArray(json, binBuf, posAcc);
      const index = prim.indices != null ? accessorArray(json, binBuf, prim.indices) : null;
      meshes.push({ name: mesh.name || "", position, index, primitive: prim.mode == null ? 4 : prim.mode });
    }
  }
  if (!meshes.length) throw new Error("loadGLB: no mesh POSITION accessor");
  return { json, meshes, scene: json.scene || 0 };
}

export async function loadGLB(source) {
  let buf;
  if (typeof source === "string") {
    if (typeof fetch !== "function") throw new Error("loadGLB: fetch unavailable");
    const res = await fetch(source);
    if (!res.ok) throw new Error("loadGLB: fetch " + res.status);
    buf = await res.arrayBuffer();
  } else if (source instanceof ArrayBuffer) {
    buf = source;
  } else if (ArrayBuffer.isView(source)) {
    buf = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  } else {
    throw new Error("loadGLB: expected url or ArrayBuffer");
  }
  return parseGLB(buf);
}

export { ident, mul, compose, invertAffine, transformPoint };
export default { Scene, Object3D, PerspectiveCamera, Mesh, DirectionalLight, HemisphereLight, Raycaster, loadGLB, resizeRenderer };
