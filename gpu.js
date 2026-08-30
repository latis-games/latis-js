/** Raw WebGPU island water. Own WGSL — no Three.js, no three/webgpu, no Water Pro FFT.
 * Look stolen from renderer.js GLSL: Gerstner + shore foam + rock hard-clip + carve grooves.
 */
import { getCamera, currentZoom as camCurrentZoom } from "./camera.js";
let _activeSkin = null;

const WGSL = /* wgsl */ `
struct Uniforms {
  res: vec2<f32>,
  time: f32,
  zoom: f32,
  fade: f32,
  panX: f32,
  panY: f32,
  rot: f32,
};

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex_island: texture_2d<f32>;
@group(0) @binding(3) var tex_carve: texture_2d<f32>;
@group(0) @binding(4) var tex_rocks: texture_2d<f32>;
@group(0) @binding(5) var tex_palms: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  let p = pos[vid];
  var o: VSOut;
  o.clip = vec4<f32>(p, 0.0, 1.0);
  o.uv = p * 0.5 + 0.5;
  return o;
}

// noise/hash/caustic deleted \u2014 grid. Shore lace is sines of unbounded wp.

fn seafloor(iuv: vec2<f32>, t: f32) -> vec3<f32> {
  // Smooth open-ocean teal. No sine-lattice / floor / hash \u2014 those read as a grid.
  return vec3<f32>(0.10, 0.50, 0.58);
}

struct GerstnerIO {
  disp: vec3<f32>,
  deriv: vec3<f32>,
}

fn gerstner(xz: vec2<f32>, dir: vec2<f32>, steep: f32, amp: f32, wl: f32, speed: f32, t: f32, io: GerstnerIO) -> GerstnerIO {
  let k = 6.2831853 / wl;
  let a = amp;
  let q = steep;
  let theta = k * dot(dir, xz) - speed * t;
  let s = sin(theta);
  let c = cos(theta);
  var disp = io.disp;
  var deriv = io.deriv;
  disp.y += a * s;
  disp.x += dir.x * (q * a * c);
  disp.z += dir.y * (q * a * c);
  deriv.x += dir.x * (k * a * c);
  deriv.z += dir.y * (k * a * c);
  deriv.y -= k * a * q * s;
  return GerstnerIO(disp, deriv);
}

fn oceanColor(p: vec2<f32>, uvC: vec2<f32>, photoW: vec3<f32>, N: vec3<f32>, nh: f32, dispY: f32, isWater: f32, t: f32) -> vec3<f32> {
  let crest = smoothstep(-0.03, 0.07, dispY);
  let trough = 1.0 - crest;
  let ndl = max(0.0, dot(N, normalize(vec3<f32>(-0.58, 0.38, 0.72))));
  // Tighter Water Pro specular, gentler trough. No extra Lambert mud.
  var wcol = photoW * mix(vec3<f32>(0.78, 0.90, 1.08), vec3<f32>(1.06, 1.04, 0.96), crest);
  wcol = mix(wcol, vec3<f32>(0.10, 0.42, 0.58), trough * 0.18);
  wcol *= 0.92 + 0.12 * ndl;
  let sunDisk = pow(nh, 420.0);
  wcol += vec3<f32>(1.00, 0.97, 0.88) * isWater * sunDisk * 2.4;
  let fres = pow(1.0 - max(0.0, N.y), 2.6);
  wcol = mix(wcol, vec3<f32>(0.62, 0.84, 0.96), fres * 0.28 * isWater);
  return wcol;
}

fn landHint(uu: vec2<f32>) -> f32 {
  let inside = step(0.0, uu.x) * step(uu.x, 1.0) * step(0.0, uu.y) * step(uu.y, 1.0);
  let c = clamp(uu, vec2<f32>(0.0), vec2<f32>(1.0));
  let a = textureSample(tex_island, samp, c).rgb;
  let L = dot(a, vec3<f32>(0.30, 0.59, 0.11));
  let g = a.g - max(a.r, a.b);
  let veg = smoothstep(0.02, 0.10, g) * (1.0 - smoothstep(0.72, 0.90, L));
  let sand = max(
    smoothstep(0.54, 0.68, L) * smoothstep(0.04, 0.12, a.r - a.b),
    smoothstep(0.60, 0.76, L) * smoothstep(0.02, 0.12, a.r - a.b)
  ) * (1.0 - veg);
  let rock = textureSample(tex_rocks, samp, c).r;
  return clamp(max(sand, max(veg, rock)), 0.0, 1.0) * inside;
}

fn sampleEdge(uvC: vec2<f32>) -> vec3<f32> {
  var mx = 0.0;
  var mn = 1.0;
  var acc = landHint(uvC);
  let inv = 0.70710678;
  let dir = array<vec2<f32>, 8>(
    vec2<f32>(1.0, 0.0), vec2<f32>(-1.0, 0.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(0.0, -1.0),
    vec2<f32>(inv, inv), vec2<f32>(-inv, inv),
    vec2<f32>(inv, -inv), vec2<f32>(-inv, -inv)
  );
  let rad = array<f32, 3>(0.013, 0.020, 0.030);
  for (var r = 0; r < 3; r++) {
    for (var i = 0; i < 8; i++) {
      let h = landHint(uvC + dir[i] * rad[r]);
      acc += h;
      mx = max(mx, h);
      mn = min(mn, h);
    }
  }
  return vec3<f32>(mx, 1.0 - mn, acc / 25.0 * 2.0 - 1.0);
}

@fragment
fn fs(input: VSOut) -> @location(0) vec4<f32> {
  let v_uv = input.uv;
  let side = max(u.res.x, u.res.y);
  let origin = (u.res - vec2<f32>(side)) * 0.5;
  let px = v_uv * u.res;
  let local = (px - origin) / max(side, 1.0);
  // Cover: side = max(res). Zoom is real, including < 1 pullback (floor 1e-6, not 1).
  // Zoom >= 1 fills the window. Zoom < 1 shows more island. Off-photo is Gerstner to the edge.
  // No side bars. No letterbox fill.
  // Rotate around 0.5 AFTER local, BEFORE zoom.
  var p = local - vec2<f32>(0.5);
  let rc = cos(u.rot);
  let rs = sin(u.rot);
  p = vec2<f32>(rc * p.x - rs * p.y, rs * p.x + rc * p.y);
  let iuv = p / max(u.zoom, 1e-6) + 0.5 - vec2<f32>(u.panX, u.panY);
  let uv = vec2<f32>(iuv.x, 1.0 - iuv.y);
  let uvC = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
  let inPhoto = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  let inIsland = step(0.0, iuv.x) * step(iuv.x, 1.0) * step(0.0, iuv.y) * step(iuv.y, 1.0);

  let palmTex = textureSampleLevel(tex_palms, samp, uvC, 0.0);
  let palm = palmTex.a * inPhoto;
  // Hard overlay is applied at the end so remaining textureSample stays uniform.

  let tex = textureSample(tex_island, samp, uvC).rgb;
  let deepOcean = vec3<f32>(0.10, 0.50, 0.58);
  let albedo = mix(deepOcean, tex, inPhoto);
  let lum = dot(albedo, vec3<f32>(0.30, 0.59, 0.11));
  let mx = max(albedo.r, max(albedo.g, albedo.b));
  let mn = min(albedo.r, min(albedo.g, albedo.b));
  let sat = mx - mn;
  let greenish = albedo.g - max(albedo.r, albedo.b);
  let blueish = albedo.b - albedo.r;

  let stronglyCyan = smoothstep(0.08, 0.18, blueish);
  // Interior bushes: strict green, no 8-neighbor dilation (that haloed cyan around fronds).
  var isVeg = smoothstep(0.04, 0.10, greenish) * (1.0 - smoothstep(0.72, 0.90, lum)) * inPhoto * (1.0 - stronglyCyan);
  isVeg = isVeg * (1.0 - palm);
  var isSand = smoothstep(0.54, 0.68, lum) * (1.0 - smoothstep(0.22, 0.38, sat))
             * smoothstep(0.04, 0.12, albedo.r - albedo.b) * (1.0 - isVeg) * inPhoto;
  isSand = max(isSand, smoothstep(0.60, 0.76, lum) * smoothstep(0.02, 0.12, albedo.r - albedo.b) * (1.0 - isVeg) * inPhoto);
  var isRock = (1.0 - isSand) * (1.0 - isVeg) * inPhoto * (1.0 - stronglyCyan)
             * smoothstep(0.08, 0.16, lum) * (1.0 - smoothstep(0.58, 0.72, lum));

  let rockRaw = textureSample(tex_rocks, samp, uvC).r;
  let rocksDim = vec2<f32>(textureDimensions(tex_rocks));
  let rPx = 5.0 / rocksDim;
  var rockHardSrc = rockRaw;
  rockHardSrc = max(rockHardSrc, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>( rPx.x,  0.0), vec2<f32>(0.0), vec2<f32>(1.0))).r);
  rockHardSrc = max(rockHardSrc, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>(-rPx.x,  0.0), vec2<f32>(0.0), vec2<f32>(1.0))).r);
  rockHardSrc = max(rockHardSrc, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>( 0.0,  rPx.y), vec2<f32>(0.0), vec2<f32>(1.0))).r);
  rockHardSrc = max(rockHardSrc, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>( 0.0, -rPx.y), vec2<f32>(0.0), vec2<f32>(1.0))).r);
  rockHardSrc = max(rockHardSrc, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>( rPx.x,  rPx.y) * 0.70710678, vec2<f32>(0.0), vec2<f32>(1.0))).r);
  rockHardSrc = max(rockHardSrc, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>(-rPx.x,  rPx.y) * 0.70710678, vec2<f32>(0.0), vec2<f32>(1.0))).r);
  rockHardSrc = max(rockHardSrc, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>( rPx.x, -rPx.y) * 0.70710678, vec2<f32>(0.0), vec2<f32>(1.0))).r);
  rockHardSrc = max(rockHardSrc, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>(-rPx.x, -rPx.y) * 0.70710678, vec2<f32>(0.0), vec2<f32>(1.0))).r);
  let rPxH = 11.0 / rocksDim;
  var rockHalo = rockHardSrc;
  rockHalo = max(rockHalo, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>( rPxH.x,  0.0), vec2<f32>(0.0), vec2<f32>(1.0))).r);
  rockHalo = max(rockHalo, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>(-rPxH.x,  0.0), vec2<f32>(0.0), vec2<f32>(1.0))).r);
  rockHalo = max(rockHalo, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>( 0.0,  rPxH.y), vec2<f32>(0.0), vec2<f32>(1.0))).r);
  rockHalo = max(rockHalo, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>( 0.0, -rPxH.y), vec2<f32>(0.0), vec2<f32>(1.0))).r);
  rockHalo = max(rockHalo, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>( rPxH.x,  rPxH.y), vec2<f32>(0.0), vec2<f32>(1.0))).r);
  rockHalo = max(rockHalo, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>(-rPxH.x,  rPxH.y), vec2<f32>(0.0), vec2<f32>(1.0))).r);
  rockHalo = max(rockHalo, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>( rPxH.x, -rPxH.y), vec2<f32>(0.0), vec2<f32>(1.0))).r);
  rockHalo = max(rockHalo, textureSample(tex_rocks, samp, clamp(uvC + vec2<f32>(-rPxH.x, -rPxH.y), vec2<f32>(0.0), vec2<f32>(1.0))).r);

  isRock = max(isRock, rockRaw * inPhoto);
  let rockHard = step(0.12, rockHardSrc) * inPhoto;
  let isLand = clamp(max(isSand, max(isVeg, isRock)), 0.0, 1.0);
  let isTeal = smoothstep(-0.04, 0.05, blueish);
  var isWater = (1.0 - isLand) * (1.0 - rockHard);
  isWater = max(isWater * inPhoto * max(0.65, isTeal), 1.0 - inPhoto);

  let wp = (iuv - 0.5) * 2.0;
  let t = u.time;
  var io = GerstnerIO(vec3<f32>(0.0), vec3<f32>(0.0, 1.0, 0.0));
  // Gerstner between original 0.055.. and 1.8x. Same unbounded wp in and out.
  io = gerstner(wp, normalize(vec2<f32>(0.25, 0.97)), 0.48, 0.070, 0.68, 0.92, t, io);
  io = gerstner(wp, normalize(vec2<f32>(-0.72, 0.69)), 0.42, 0.046, 0.38, 1.22, t, io);
  io = gerstner(wp, normalize(vec2<f32>(0.91, 0.42)), 0.36, 0.028, 0.20, 1.55, t, io);
  io = gerstner(wp, normalize(vec2<f32>(-0.15, 0.99)), 0.30, 0.018, 0.11, 2.05, t, io);
  let disp = io.disp;
  let deriv = io.deriv;
  let N = normalize(vec3<f32>(-deriv.x, max(0.35, deriv.y), -deriv.z));
  let L = normalize(vec3<f32>(-0.58, 0.38, 0.72));
  let V = normalize(vec3<f32>(0.06, 0.55, 0.83));
  let R = reflect(-L, N);
  let nh = max(0.0, dot(R, V));

  let rockAmt = smoothstep(0.05, 0.16, rockHardSrc) * inPhoto;
  // Off-photo: waterAmt = 1 so Gerstner fills to the viewport edge. Palms never get water.
  var waterAmt = max(isWater * (1.0 - rockHard) * (1.0 - rockAmt) * (1.0 - isVeg), 1.0 - inPhoto);
  waterAmt = waterAmt * (1.0 - palm);
  let edge = sampleEdge(uvC);
  let nearLand = edge.x * inPhoto;
  let nearWater = edge.y * inPhoto;
  let signedS = edge.z;
  let edgeWater = waterAmt * nearLand;
  let edgeSand = isSand * (1.0 - isVeg) * (1.0 - rockHard) * nearWater;
  let beach = (1.0 - isVeg) * (1.0 - palm) * (1.0 - rockHard) * inPhoto;

  // Playable sand board stays dry still-photo. Feather so shore still hits the beach ring.
  let bMin = vec2<f32>(0.342, 0.358);
  let bMax = vec2<f32>(0.648, 0.662);
  let bq = max(bMin - iuv, iuv - bMax);
  let onBoard = 1.0 - smoothstep(0.0, 0.04, max(bq.x, bq.y));
  let offBoard = 1.0 - onBoard;

  // Live swash. Sines of unbounded wp \u2014 no floor lattice.
  let n1 = 0.5 + 0.5 * sin(wp.x * 3.1 + wp.y * 1.7 + t * 0.17);
  let n2 = 0.5 + 0.5 * sin(wp.x * 7.4 - wp.y * 4.2 + t * 0.31);
  let n3 = 0.5 + 0.5 * sin(wp.x * 11.2 + wp.y * 5.6 + t * 1.05);
  let tide = 0.06 * sin(t * 0.21 + n1 * 1.3);
  let period = mix(2.55, 3.90, 0.5 + 0.5 * sin(wp.x * 2.1 + wp.y * 1.4));
  let phase = t * 6.2831853 / period + n1 * 2.5 + n2 * 0.85;
  let cycle = 0.5 + 0.5 * sin(phase);
  let receding = smoothstep(0.22, -0.22, cos(phase));
  let lace = (n1 - 0.5) * 0.10 + (n2 - 0.5) * 0.06 + (n3 - 0.5) * 0.03;
  let wl = tide + mix(-0.16, 0.11, cycle) + lace * 0.7;
  let swashCover = smoothstep(wl + 0.05, wl - 0.04, signedS);
  var runup = swashCover * beach * max(isSand, edgeWater);
  let foamW = max(0.12, length(vec2<f32>(dpdx(signedS), dpdy(signedS))) * 6.0);
  var foamLine = (1.0 - smoothstep(0.0, foamW, abs(signedS - wl)))
               * mix(0.38, 1.0, n3) * beach
               * (1.0 - smoothstep(0.10, 0.20, signedS));
  var film = receding * beach * (1.0 - swashCover)
           * smoothstep(wl + 0.12, wl + 0.02, signedS)
           * smoothstep(wl - 0.06, wl + 0.02, signedS)
           * mix(0.12, 0.40, n2);
  let wetMark = tide + mix(-0.04, 0.14, 0.5 + 0.5 * sin(phase - 0.95)) + lace * 0.45;
  var wetSand = isSand * beach * (1.0 - swashCover)
              * smoothstep(wetMark + 0.18, wl + 0.03, signedS)
              * smoothstep(wl - 0.04, wl + 0.08, signedS)
              * mix(0.28, 1.0, receding * 0.65 + (1.0 - cycle) * 0.18);
  runup *= offBoard;
  foamLine *= offBoard;
  film *= offBoard;
  wetSand *= offBoard;
  let nearRock = clamp(rockHalo * (1.0 - rockHard), 0.0, 1.0);
  let rockFoam = nearRock * beach
               * (1.0 - smoothstep(0.12, 0.36, signedS))
               * (foamLine * 0.90 + film * 0.55 + 0.18 * cycle);

  var refr = clamp(uvC + N.xz * (0.048 * waterAmt + 0.040 * edgeWater + 0.018 * runup), vec2<f32>(0.0), vec2<f32>(1.0));
  let refrRock = textureSample(tex_rocks, samp, refr).r;
  if (refrRock > 0.12) {
    refr = uvC;
  }
  let shallow = clamp(edgeWater + runup * 0.70, 0.0, 1.0)
              * (1.0 - smoothstep(0.14, 0.46, signedS));
  // Constant teal seafloor. Never sample island.webp as the water surface (baked ripples).
  let photoW = seafloor(iuv, t);
  var wcol = oceanColor(wp, uvC, photoW, N, nh, disp.y, waterAmt, t);
  wcol = mix(wcol, vec3<f32>(0.14, 0.68, 0.64), shallow * 0.46);
  wcol = mix(wcol, vec3<f32>(0.72, 0.90, 0.96), edgeWater * (0.10 + 0.16 * cycle));

  let peak = smoothstep(0.002, 0.028, disp.y);
  var foam = foamLine * 0.95 + film + rockFoam;
  foam += waterAmt * peak * 0.22;
  foam += edgeWater * 0.10;
  foam *= (1.0 - rockHard) * (1.0 - rockAmt) * (1.0 - isVeg) * (1.0 - palm);
  foam = clamp(foam, 0.0, 1.0);

  // All water (in-photo + off-photo to the screen edge) is Gerstner wcol. Albedo never wins on water.
  var col = mix(albedo, wcol, max(max(waterAmt, 1.0 - inPhoto), runup * 0.80));
  let wetLum = dot(albedo, vec3<f32>(0.30, 0.59, 0.11));
  let wetCol = mix(vec3<f32>(wetLum), albedo, 1.35) * vec3<f32>(0.55, 0.45, 0.33);
  col = mix(col, wetCol, wetSand * 0.82);
  col = mix(col, albedo * vec3<f32>(0.68, 0.56, 0.44), edgeSand * (0.08 + 0.10 * cycle) * (1.0 - wetSand));
  col = mix(col, vec3<f32>(0.97, 0.99, 1.0), foam * 0.96);

  let carveUv = clamp(vec2<f32>(iuv.x, 1.0 - iuv.y), vec2<f32>(0.0), vec2<f32>(1.0));
  let sandMask = (1.0 - rockHard) * (1.0 - rockAmt) * (1.0 - step(0.08, isVeg)) * (1.0 - palm) * isSand * onBoard;
  let g = textureSample(tex_carve, samp, carveUv).r * inIsland * u.fade * sandMask;
  let groove = smoothstep(0.04, 0.36, g);
  let wet = albedo * vec3<f32>(0.46, 0.36, 0.24);
  col = mix(col, wet, groove * 0.90);
  col *= 1.0 - groove * 0.10;
  let rim = clamp(-dpdx(g) * 2.2 + dpdy(g) * 1.1, 0.0, 1.0) * groove;
  col += albedo * vec3<f32>(0.28, 0.20, 0.10) * rim * 0.40;

  // Hard clip after every sample so textureSample stays in uniform control flow.
  // Interior bushes on land stay photo. Over-water palm composites only from tex_palms.
  col = mix(col, albedo, clamp(max(rockAmt, isVeg * (1.0 - palm)), 0.0, 1.0));
  let leaf = palmTex.rgb / max(palmTex.a, 0.001);
  if (palm > 0.20) {
    return vec4<f32>(leaf, 1.0);
  }
  if (palm > 0.01) {
    col = mix(col, leaf, palm);
  }
  if ((rockAmt > 0.40 || isRock > 0.28 || isVeg > 0.08) && palm < 0.02 && stronglyCyan < 0.15) {
    return vec4<f32>(albedo, 1.0);
  }
  return vec4<f32>(col, 1.0);
}
`;

function queryParam(name) {
  try { return new URLSearchParams(location.search).get(name) || ""; }
  catch { return ""; }
}

function viewportSize() {
  const el = document.getElementById("stage") || document.getElementById("mount");
  if (el) {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }
  return { w: window.innerWidth || 0, h: window.innerHeight || 0 };
}

function currentZoom() {
  return camCurrentZoom(_activeSkin);
}

function sizeCanvas(canvas, el) {
  const rect = el.getBoundingClientRect();
  const cssW = Math.max(1, rect.width);
  const cssH = Math.max(1, rect.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  return { w, h, dpr };
}

function softwareAdapterBlob(info) {
  if (!info) return "";
  return [info.vendor, info.architecture, info.device, info.description]
    .filter(Boolean)
    .join(" ");
}

async function adapterLooksSoftware(adapter) {
  if (!adapter) return true;
  if (adapter.isFallbackAdapter === true) return true;
  let info = adapter.info || null;
  if (!info && typeof adapter.requestAdapterInfo === "function") {
    try { info = await adapter.requestAdapterInfo(); } catch { info = null; }
  }
  if (info && info.isFallbackAdapter === true) return true;
  const blob = softwareAdapterBlob(info).toLowerCase();
  if (!blob) return false;
  return /swiftshader|llvmpipe|softpipe|lavapipe|\bwarp\b|d3d12warp|microsoft basic render|software/.test(blob);
}

function downscaleSource(source, maxDim) {
  const w = source.width || source.naturalWidth || 0;
  const h = source.height || source.naturalHeight || 0;
  if (!w || !h) return source;
  if (w <= maxDim && h <= maxDim) return source;
  const s = maxDim / Math.max(w, h);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
  return c;
}

function rgbaCanvas(source) {
  const w = Math.max(1, source.width || source.naturalWidth || 0);
  const h = Math.max(1, source.height || source.naturalHeight || 0);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { alpha: true, colorSpace: "srgb" });
  ctx.drawImage(source, 0, 0, w, h);
  return c;
}

function textureFromSource(device, source, w, h) {
  // Safari WebGPU copyExternalImageToTexture of RGB WebP mis-strides into rgba8unorm.
  const rgba = rgbaCanvas(source);
  const texture = device.createTexture({
    size: [rgba.width, rgba.height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: rgba }, { texture }, [rgba.width, rgba.height]);
  return texture;
}

function blackCanvas() {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, 1, 1);
  return c;
}

export async function startWebGPU({ mountEl, skin, island, rocks, palms }) {
  if (!mountEl) throw new Error("startWebGPU: mountEl required");
  if (!skin) throw new Error("startWebGPU: skin required");
  if (!island) throw new Error("startWebGPU: island required");
  if (!navigator.gpu) throw new Error("WebGPU missing");
  _activeSkin = skin;

  const allowSoftware = String(queryParam("renderer")).toLowerCase() === "webgpu";
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("WebGPU adapter missing");
  if (!allowSoftware && await adapterLooksSoftware(adapter)) {
    throw new Error("software/fallback WebGPU adapter");
  }
  const device = await adapter.requestDevice();

  const canvas = document.createElement("canvas");
  canvas.id = "board-webgpu";
  canvas.setAttribute("aria-hidden", "true");
  mountEl.replaceChildren();
  mountEl.style.pointerEvents = "none";
  canvas.style.pointerEvents = "none";
  mountEl.appendChild(canvas);

  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("webgpu context missing");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const shader = device.createShaderModule({ code: WGSL });
  if (typeof shader.getCompilationInfo === "function") {
    const info = await shader.getCompilationInfo();
    const err = (info.messages || []).find((m) => m.type === "error");
    if (err) throw new Error(err.message || "wgsl compile");
  }

  const bgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    vertex: { module: shader, entryPoint: "vs" },
    fragment: {
      module: shader,
      entryPoint: "fs",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });
  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });

  const maxTex = (adapter.limits && adapter.limits.maxTextureDimension2D) || 8192;
  const islandSrc = downscaleSource(island, maxTex);
  const islandTex = textureFromSource(device, islandSrc, islandSrc.width, islandSrc.height);

  const carveCanvas = document.createElement("canvas");
  carveCanvas.width = 1024;
  carveCanvas.height = 1024;
  const carveTex = device.createTexture({
    size: [1024, 1024],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const rocksSrc = rocks ? downscaleSource(rocks, maxTex) : blackCanvas();
  const rocksTex = textureFromSource(device, rocksSrc, rocksSrc.width, rocksSrc.height);

  const palmsSrc = palms ? downscaleSource(palms, maxTex) : blackCanvas();
  const palmsTex = textureFromSource(device, palmsSrc, palmsSrc.width, palmsSrc.height);

  const uniformData = new Float32Array(8);
  const uniformBuf = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    layout: bgl,
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: islandTex.createView() },
      { binding: 3, resource: carveTex.createView() },
      { binding: 4, resource: rocksTex.createView() },
      { binding: 5, resource: palmsTex.createView() },
    ],
  });

  let lastKey = "";
  function uploadCarve() {
    const key = skin.sourceKey();
    if (key === lastKey) return;
    lastKey = key;
    skin.paintCarve(carveCanvas, skin.getSnap());
    device.queue.copyExternalImageToTexture(
      { source: carveCanvas },
      { texture: carveTex },
      [1024, 1024]
    );
  }

  const t0 = performance.now();
  function frame() {
    const { w, h } = sizeCanvas(canvas, mountEl);
    uploadCarve();
    uniformData[0] = w;
    uniformData[1] = h;
    uniformData[2] = (performance.now() - t0) / 1000;
    uniformData[3] = currentZoom();
    uniformData[4] = Number((window.__latisCamera && window.__latisCamera.carveFade) ?? 1);
    {
      const cam = getCamera();
      uniformData[5] = cam.panX;
      uniformData[6] = cam.panY;
      uniformData[7] = cam.rot || 0;
    }
    device.queue.writeBuffer(uniformBuf, 0, uniformData);
    const encoder = device.createCommandEncoder();
    const view = context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0.04, g: 0.22, b: 0.34, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  uploadCarve();
  frame();
  return { path: "webgpu", canvas, frame };
}
