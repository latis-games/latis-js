/** Engine shader registry. Titles fetch a Pages-safe manifest; no directory listing. */

export const shaders = {};

const PALETTE_MAX = 12;

function asCssColor(v) {
  if (typeof v !== "string") return "";
  const t = v.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return t;
  if (/^(rgb|hsl)a?\(/i.test(t)) return t;
  return "";
}

/** Title colors. palette[0] is primary (volume fill), palette[1] is secondary. */
export function setPalette(colors) {
  const list = Array.isArray(colors) ? colors.map(asCssColor).filter(Boolean) : [];
  engine.palette = list;
  if (typeof document === "undefined") return list;
  const root = document.documentElement;
  for (let i = 0; i < PALETTE_MAX; i++) root.style.removeProperty("--palette-" + i);
  list.forEach((c, i) => root.style.setProperty("--palette-" + i, c));
  if (list[0]) {
    root.style.setProperty("--primary", list[0]);
    root.style.setProperty("--vol-fill", list[0]);
  } else {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--vol-fill");
  }
  if (list[1]) root.style.setProperty("--secondary", list[1]);
  else root.style.removeProperty("--secondary");
  return list;
}

const DEFAULT_VERT =
  "attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos,0.0,1.0); }";

export const engine = { shaders, palette: [], metrics: [] };

if (typeof window !== "undefined") {
  window.__latisEngine = engine;
}

export function getShader(name) {
  return shaders[name];
}

function parseUniforms(src) {
  const uniforms = {};
  if (!src) return uniforms;
  const re = /uniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+(\w+)\s*;/g;
  let m;
  while ((m = re.exec(src))) {
    uniforms[m[2]] = { type: m[1] };
  }
  return uniforms;
}

function joinBase(base, file) {
  if (!file) return "";
  if (/^https?:\/\//i.test(file) || file.startsWith("/")) return file;
  const root = String(base || "./shaders").replace(/\/+$/, "");
  return root + "/" + String(file).replace(/^\/+/, "");
}

async function fetchText(url) {
  if (!url) return "";
  try {
    const res = await fetch(url);
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

let _inflight = null;
let _loadedBase = "";

export async function loadShaders(base = "./shaders") {
  const root = String(base || "./shaders").replace(/\/+$/, "") || "./shaders";
  if (_inflight && _loadedBase === root) return _inflight;
  _loadedBase = root;
  _inflight = loadShadersInner(root);
  return _inflight;
}

async function loadShadersInner(root) {
  let manifest;
  try {
    const res = await fetch(root + "/index.json");
    if (!res.ok) return {};
    manifest = await res.json();
  } catch {
    return {};
  }
  if (!Array.isArray(manifest)) return {};

  await Promise.all(
    manifest.map(async (item) => {
      if (!item || !item.name) return;
      const rec = {
        name: item.name,
        vertex: DEFAULT_VERT,
        fragment: "",
        wgsl: "",
        uniforms: item.uniforms && typeof item.uniforms === "object" ? { ...item.uniforms } : {},
      };
      const jobs = [];
      if (item.fragment) {
        jobs.push(
          fetchText(joinBase(root, item.fragment)).then((t) => {
            rec.fragment = t;
          })
        );
      } else if (item.fragmentSrc) {
        rec.fragment = String(item.fragmentSrc);
      }
      if (item.vertex && /\.(glsl|vert|vs)$/i.test(String(item.vertex))) {
        jobs.push(
          fetchText(joinBase(root, item.vertex)).then((t) => {
            if (t) rec.vertex = t;
          })
        );
      } else if (item.vertexSrc) {
        rec.vertex = String(item.vertexSrc);
      }
      if (item.wgsl && /\.wgsl$/i.test(String(item.wgsl))) {
        jobs.push(
          fetchText(joinBase(root, item.wgsl)).then((t) => {
            rec.wgsl = t;
          })
        );
      } else if (item.wgslSrc) {
        rec.wgsl = String(item.wgslSrc);
      } else if (item.wgsl && typeof item.wgsl === "string" && !/\.wgsl$/i.test(item.wgsl)) {
        rec.wgsl = item.wgsl;
      }
      await Promise.all(jobs);
      if (!Object.keys(rec.uniforms).length) rec.uniforms = parseUniforms(rec.fragment);
      shaders[item.name] = rec;
    })
  );
  return shaders;
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("latis shader compile", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function makeGl(canvas, vert, frag) {
  const attrs = { alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false };
  const gl =
    canvas.getContext("webgl2", attrs) ||
    canvas.getContext("webgl", attrs) ||
    canvas.getContext("experimental-webgl", attrs);
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, vert || DEFAULT_VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("latis shader link", gl.getProgramInfoLog(prog));
    return null;
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  return { gl, prog, buf };
}

function sizeCanvas(canvas) {
  const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  const w = Math.max(1, canvas.clientWidth || canvas.width || 1);
  const h = Math.max(1, canvas.clientHeight || canvas.height || 1);
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  return { w: canvas.width, h: canvas.height, cssW: w, cssH: h };
}

function setUniform(gl, loc, type, value) {
  if (!loc || value == null) return;
  if (type === "float" || type === "int") {
    if (type === "int") gl.uniform1i(loc, value | 0);
    else gl.uniform1f(loc, Number(value) || 0);
    return;
  }
  if (type === "vec2" && value.length >= 2) gl.uniform2f(loc, value[0], value[1]);
  else if (type === "vec3" && value.length >= 3) gl.uniform3f(loc, value[0], value[1], value[2]);
  else if (type === "vec4" && value.length >= 4) gl.uniform4f(loc, value[0], value[1], value[2], value[3]);
  else if (typeof value === "number") gl.uniform1f(loc, value);
}

/**
 * Compile shaders[name] onto el (canvas or host). WebGL2, then WebGL1.
 * Skip if the shader is missing.
 */
export async function mountShader(el, name, opts) {
  if (!el || !name) return null;
  const sh = shaders[name];
  if (!sh || !sh.fragment) return null;
  const options = opts || {};
  let canvas = el;
  if (el.tagName !== "CANVAS") {
    canvas = el.querySelector("canvas") || document.createElement("canvas");
    if (!canvas.parentNode) {
      canvas.style.cssText = "display:block;width:100%;height:100%;";
      el.appendChild(canvas);
    }
  }
  const gpu = makeGl(canvas, sh.vertex || DEFAULT_VERT, sh.fragment);
  if (!gpu) return null;
  const gl = gpu.gl;
  gl.useProgram(gpu.prog);
  const loc = {};
  const spec = sh.uniforms || {};
  Object.keys(spec).forEach((key) => {
    loc[key] = gl.getUniformLocation(gpu.prog, key);
  });
  ["u_time", "u_res", "u_origin", "u_hue", "u_style", "u_energy"].forEach((key) => {
    if (loc[key] == null) loc[key] = gl.getUniformLocation(gpu.prog, key);
  });
  const attrib = gl.getAttribLocation(gpu.prog, "a_pos");
  let raf = 0;
  let t0 = performance.now();
  function frame(now) {
    const dim = sizeCanvas(canvas);
    gl.viewport(0, 0, dim.w, dim.h);
    gl.useProgram(gpu.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buf);
    if (attrib >= 0) {
      gl.enableVertexAttribArray(attrib);
      gl.vertexAttribPointer(attrib, 2, gl.FLOAT, false, 0, 0);
    }
    const t = ((now - t0) / 1000) * (options.speed == null ? 1 : options.speed);
    if (loc.u_time) gl.uniform1f(loc.u_time, t);
    if (loc.u_res) gl.uniform2f(loc.u_res, dim.w, dim.h);
    const origin = options.origin || [dim.w * 0.5, dim.h * 0.55];
    if (loc.u_origin) gl.uniform2f(loc.u_origin, origin[0], origin[1]);
    if (loc.u_hue) gl.uniform1f(loc.u_hue, options.hue == null ? 0 : options.hue);
    if (loc.u_style) gl.uniform1f(loc.u_style, options.style == null ? 1 : options.style);
    if (loc.u_energy) gl.uniform1f(loc.u_energy, options.energy == null ? 1 : options.energy);
    const extra = options.uniforms || {};
    Object.keys(extra).forEach((key) => {
      const L = loc[key] || gl.getUniformLocation(gpu.prog, key);
      const typ = (spec[key] && spec[key].type) || "float";
      setUniform(gl, L, typ, extra[key]);
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return {
    name,
    canvas,
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
