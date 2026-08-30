/** Engine-owned island renderer. WebGPU / WebGL2 Gerstner + depth/foam, Canvas2D Tesla fallback.
 * Title does not import Three.js. No Water Pro package.
 *
 * Paint modes (skin.paint):
 *   "overlay" (default) — island water (Gerstner).
 *   "board"             — skip Gerstner; clear + call skin.draw if provided.
 *   "scene"             — no island path; title drives packs/scene.js.
 */
import { stickLine, stickX, stickO, strokeStick } from "./draw.js";
import { startWebGPU } from "./gpu.js";
import { bindCamera, getCamera, playfieldZoom as camPlayfieldZoom, currentZoom as camCurrentZoom, setZoom as camSetZoom } from "./camera.js";
import { setMetric } from "./metrics.js";

/** Local zoom helper. Reads skin.playfieldZoom or skin zoom fields. Never imports a title skin. */
let _activeSkin = null;

function playfieldZoom(w, h, skin) {
  return camPlayfieldZoom(w, h, skin || _activeSkin);
}

function skinInset(skin) {
  return (skin && skin.inset) || { left: 0, right: 0, top: 0, bottom: 0 };
}

function skinFit(skin) {
  return skin && skin.islandFit != null ? Number(skin.islandFit) : 1;
}

function skinZoomMin(skin) {
  return skin && skin.zoomMin != null ? Number(skin.zoomMin) : 1;
}

function skinZoomMax(skin) {
  return skin && skin.zoomMax != null ? Number(skin.zoomMax) : 2.4;
}

function skinTallQuery(skin) {
  return (skin && skin.tallQuery) || "(orientation: portrait), (max-width: 700px)";
}

const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_res;
uniform float u_time;
uniform sampler2D u_island;
uniform sampler2D u_carve;
uniform sampler2D u_rocks;
uniform sampler2D u_palms;
uniform float u_zoom;
uniform vec2 u_pan;
uniform float u_rot;
uniform float u_fade;

// noise/hash/caustic deleted \u2014 grid. Shore lace is sines of unbounded wp.

vec3 seafloor(vec2 iuv, float t) {
  // Smooth open-ocean teal. No sine-lattice / floor / hash \u2014 those read as a grid.
  return vec3(0.10, 0.50, 0.58);
}

void gerstner(vec2 xz, vec2 dir, float steep, float amp, float wl, float speed, float t, inout vec3 disp, inout vec3 deriv) {
  float k = 6.2831853 / wl;
  float a = amp;
  float q = steep;
  float theta = k * dot(dir, xz) - speed * t;
  float s = sin(theta);
  float c = cos(theta);
  disp.y += a * s;
  disp.xz += dir * (q * a * c);
  deriv.xz += dir * (k * a * c);
  deriv.y -= k * a * q * s;
}

vec3 oceanColor(vec2 p, vec2 uvC, vec3 photoW, vec3 N, float nh, float dispY, float isWater, float t) {
  float crest = smoothstep(-0.03, 0.07, dispY);
  float trough = 1.0 - crest;
  float ndl = max(0.0, dot(N, normalize(vec3(-0.58, 0.38, 0.72))));
  // Tighter Water Pro specular, gentler trough. No extra Lambert mud.
  vec3 wcol = photoW * mix(vec3(0.78, 0.90, 1.08), vec3(1.06, 1.04, 0.96), crest);
  wcol = mix(wcol, vec3(0.10, 0.42, 0.58), trough * 0.18);
  wcol *= 0.92 + 0.12 * ndl;
  float sunDisk = pow(nh, 420.0);
  wcol += vec3(1.00, 0.97, 0.88) * isWater * sunDisk * 2.4;
  float fres = pow(1.0 - max(0.0, N.y), 2.6);
  wcol = mix(wcol, vec3(0.62, 0.84, 0.96), fres * 0.28 * isWater);
  return wcol;
}

float landHint(vec2 u) {
  float inside = step(0.0, u.x) * step(u.x, 1.0) * step(0.0, u.y) * step(u.y, 1.0);
  vec2 c = clamp(u, 0.0, 1.0);
  vec3 a = texture(u_island, c).rgb;
  float L = dot(a, vec3(0.30, 0.59, 0.11));
  float g = a.g - max(a.r, a.b);
  float veg = smoothstep(0.02, 0.10, g) * (1.0 - smoothstep(0.72, 0.90, L));
  float sand = max(
    smoothstep(0.54, 0.68, L) * smoothstep(0.04, 0.12, a.r - a.b),
    smoothstep(0.60, 0.76, L) * smoothstep(0.02, 0.12, a.r - a.b)
  ) * (1.0 - veg);
  float rock = texture(u_rocks, c).r;
  return clamp(max(sand, max(veg, rock)), 0.0, 1.0) * inside;
}

void sampleEdge(vec2 uvC, out float nearLand, out float nearWater, out float signedS) {
  // Circular taps. Axis-only samples made diamond zigzags on diagonal shores.
  float mx = 0.0;
  float mn = 1.0;
  float acc = landHint(uvC);
  const float INV = 0.70710678;
  vec2 dir[8];
  dir[0] = vec2(1.0, 0.0); dir[1] = vec2(-1.0, 0.0);
  dir[2] = vec2(0.0, 1.0); dir[3] = vec2(0.0, -1.0);
  dir[4] = vec2(INV, INV); dir[5] = vec2(-INV, INV);
  dir[6] = vec2(INV, -INV); dir[7] = vec2(-INV, -INV);
  float rad[3];
  rad[0] = 0.013;
  rad[1] = 0.020;
  rad[2] = 0.030;
  for (int r = 0; r < 3; r++) {
    for (int i = 0; i < 8; i++) {
      float h = landHint(uvC + dir[i] * rad[r]);
      acc += h;
      mx = max(mx, h);
      mn = min(mn, h);
    }
  }
  nearLand = mx;
  nearWater = 1.0 - mn;
  signedS = acc / 25.0 * 2.0 - 1.0;
}

void main() {
  float side = max(u_res.x, u_res.y);
  vec2 origin = (u_res - vec2(side)) * 0.5;
  vec2 px = v_uv * u_res;
  vec2 local = (px - origin) / max(side, 1.0);
  // Cover: photo fills the window. No side bars. No letterbox fill.
  // Rotate around 0.5 AFTER local, BEFORE zoom.
  vec2 p = local - 0.5;
  float rc = cos(u_rot);
  float rs = sin(u_rot);
  p = vec2(rc * p.x - rs * p.y, rs * p.x + rc * p.y);
  vec2 iuv = p / max(u_zoom, 1.0) + 0.5 - u_pan;
  vec2 uv = vec2(iuv.x, 1.0 - iuv.y);
  vec2 uvC = clamp(uv, 0.0, 1.0);
  float inPhoto = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float inIsland = step(0.0, iuv.x) * step(iuv.x, 1.0) * step(0.0, iuv.y) * step(iuv.y, 1.0);

  vec4 palmTex = textureLod(u_palms, uvC, 0.0);
  float palm = palmTex.a * inPhoto;
  if (palm > 0.20) {
    vec3 leaf = palmTex.rgb / max(palmTex.a, 0.001);
    fragColor = vec4(leaf, 1.0);
    return;
  }

  vec3 tex = texture(u_island, uvC).rgb;
  vec3 deepOcean = vec3(0.10, 0.50, 0.58);
  vec3 albedo = mix(deepOcean, tex, inPhoto);
  float lum = dot(albedo, vec3(0.30, 0.59, 0.11));
  float mx = max(albedo.r, max(albedo.g, albedo.b));
  float mn = min(albedo.r, min(albedo.g, albedo.b));
  float sat = mx - mn;
  float greenish = albedo.g - max(albedo.r, albedo.b);
  float blueish = albedo.b - albedo.r;

  // Photo land only: sand, palms, warm cay boulders. No fake sand disc.
  // Cool/cyan underwater rocks stay ocean and keep the water shader.
  float stronglyCyan = smoothstep(0.08, 0.18, blueish);
  // Interior bushes: strict green, no 8-neighbor dilation (that haloed cyan around fronds).
  float isVeg = smoothstep(0.04, 0.10, greenish) * (1.0 - smoothstep(0.72, 0.90, lum)) * inPhoto * (1.0 - stronglyCyan);
  isVeg *= (1.0 - palm);
  float isSand = smoothstep(0.54, 0.68, lum) * (1.0 - smoothstep(0.22, 0.38, sat))
               * smoothstep(0.04, 0.12, albedo.r - albedo.b) * (1.0 - isVeg) * inPhoto;
  isSand = max(isSand, smoothstep(0.60, 0.76, lum) * smoothstep(0.02, 0.12, albedo.r - albedo.b) * (1.0 - isVeg) * inPhoto);
  // Land rocks: mid-dark brown/gray that are not strongly cyan. Wet boulders
  // pick up a little photo-blue, so do not require warm * (1.0-cool).
  float isRock = (1.0 - isSand) * (1.0 - isVeg) * inPhoto * (1.0 - stronglyCyan)
               * smoothstep(0.08, 0.16, lum) * (1.0 - smoothstep(0.58, 0.72, lum));

  // Photo land-rock mask (.r only; rocks.g unused for color). Light dilate so water stays off rock tops.
  // Wider halo is shoreline foam wrap on neighboring sand/water, not inland veg.
  float rockRaw = texture(u_rocks, uvC).r;
  vec2 rPx = 5.0 / vec2(textureSize(u_rocks, 0));
  float rockHardSrc = rockRaw;
  rockHardSrc = max(rockHardSrc, texture(u_rocks, clamp(uvC + vec2( rPx.x,  0.0), 0.0, 1.0)).r);
  rockHardSrc = max(rockHardSrc, texture(u_rocks, clamp(uvC + vec2(-rPx.x,  0.0), 0.0, 1.0)).r);
  rockHardSrc = max(rockHardSrc, texture(u_rocks, clamp(uvC + vec2( 0.0,  rPx.y), 0.0, 1.0)).r);
  rockHardSrc = max(rockHardSrc, texture(u_rocks, clamp(uvC + vec2( 0.0, -rPx.y), 0.0, 1.0)).r);
  rockHardSrc = max(rockHardSrc, texture(u_rocks, clamp(uvC + vec2( rPx.x,  rPx.y) * 0.70710678, 0.0, 1.0)).r);
  rockHardSrc = max(rockHardSrc, texture(u_rocks, clamp(uvC + vec2(-rPx.x,  rPx.y) * 0.70710678, 0.0, 1.0)).r);
  rockHardSrc = max(rockHardSrc, texture(u_rocks, clamp(uvC + vec2( rPx.x, -rPx.y) * 0.70710678, 0.0, 1.0)).r);
  rockHardSrc = max(rockHardSrc, texture(u_rocks, clamp(uvC + vec2(-rPx.x, -rPx.y) * 0.70710678, 0.0, 1.0)).r);

  isRock = max(isRock, rockRaw * inPhoto);
  float rockHard = step(0.12, rockHardSrc) * inPhoto;
  float rockAmt = smoothstep(0.05, 0.16, rockHardSrc) * inPhoto;
  rockHard = max(rockHard, step(0.10, rockAmt));
  // Hard clip: rocks and interior veg stay still photo. Palms composite last (no cyan ghost).
  if ((rockAmt > 0.40 || isRock > 0.28 || isVeg > 0.08) && palm < 0.02 && stronglyCyan < 0.15) {
    fragColor = vec4(albedo, 1.0);
    return;
  }
  float isLand = clamp(max(isSand, max(isVeg, isRock)), 0.0, 1.0);
  // Ocean: anything that is not land/sand/veg in the photo. Teal boost, not a gate.
  float isTeal = smoothstep(-0.04, 0.05, blueish);
  float isWater = (1.0 - isLand) * (1.0 - rockHard);
  isWater = max(isWater * inPhoto * max(0.65, isTeal), 1.0 - inPhoto);


  // Island UV, unbounded. Rotate/pan past the photo and Gerstner still covers the screen.
  vec2 wp = (iuv - 0.5) * 2.0;
  float t = u_time;
  vec3 disp = vec3(0.0);
  vec3 deriv = vec3(0.0, 1.0, 0.0);
  // Gerstner between original 0.055.. and 1.8x. Same unbounded wp in and out.
  gerstner(wp, normalize(vec2(0.25, 0.97)), 0.48, 0.070, 0.68, 0.92, t, disp, deriv);
  gerstner(wp, normalize(vec2(-0.72, 0.69)), 0.42, 0.046, 0.38, 1.22, t, disp, deriv);
  gerstner(wp, normalize(vec2(0.91, 0.42)), 0.36, 0.028, 0.20, 1.55, t, disp, deriv);
  gerstner(wp, normalize(vec2(-0.15, 0.99)), 0.30, 0.018, 0.11, 2.05, t, disp, deriv);
  vec3 N = normalize(vec3(-deriv.x, max(0.35, deriv.y), -deriv.z));
  vec3 L = normalize(vec3(-0.58, 0.38, 0.72));
  vec3 V = normalize(vec3(0.06, 0.55, 0.83));
  vec3 R = reflect(-L, N);
  float nh = max(0.0, dot(R, V));

  // Photo ocean + Gerstner refraction + tight glitter. Palms stay still photo.
  // Off-photo: waterAmt = 1 so Gerstner fills to the viewport edge. Palms never get water.
  float waterAmt = max(isWater * (1.0 - rockHard) * (1.0 - rockAmt) * (1.0 - isVeg), 1.0 - inPhoto);
  waterAmt *= (1.0 - palm);
  float nearLand = 0.0;
  float nearWater = 0.0;
  float signedS = 0.0;
  sampleEdge(uvC, nearLand, nearWater, signedS);
  nearLand *= inPhoto;
  nearWater *= inPhoto;
  float edgeWater = waterAmt * nearLand;
  float edgeSand = isSand * (1.0 - isVeg) * (1.0 - rockHard) * nearWater;
  float beach = (1.0 - isVeg) * (1.0 - palm) * (1.0 - rockHard) * inPhoto;

  // Playable sand board stays dry still-photo. Feather so shore still hits the beach ring.
  vec2 bMin = vec2(0.342, 0.358);
  vec2 bMax = vec2(0.648, 0.662);
  vec2 bq = max(bMin - iuv, iuv - bMax);
  float onBoard = 1.0 - smoothstep(0.0, 0.04, max(bq.x, bq.y));
  float offBoard = 1.0 - onBoard;

  // Live swash along land/water gradient. Sines of unbounded wp \u2014 no floor lattice.
  float n1 = 0.5 + 0.5 * sin(wp.x * 3.1 + wp.y * 1.7 + t * 0.17);
  float n2 = 0.5 + 0.5 * sin(wp.x * 7.4 - wp.y * 4.2 + t * 0.31);
  float n3 = 0.5 + 0.5 * sin(wp.x * 11.2 + wp.y * 5.6 + t * 1.05);
  float tide = 0.06 * sin(t * 0.21 + n1 * 1.3);
  float period = mix(2.55, 3.90, 0.5 + 0.5 * sin(wp.x * 2.1 + wp.y * 1.4));
  float phase = t * 6.2831853 / period + n1 * 2.5 + n2 * 0.85;
  float cycle = 0.5 + 0.5 * sin(phase);
  float receding = smoothstep(0.22, -0.22, cos(phase));
  float lace = (n1 - 0.5) * 0.10 + (n2 - 0.5) * 0.06 + (n3 - 0.5) * 0.03;
  float wl = tide + mix(-0.16, 0.11, cycle) + lace * 0.7;
  float swashCover = smoothstep(wl + 0.05, wl - 0.04, signedS);
  float runup = swashCover * beach * max(isSand, edgeWater);
  float foamW = max(0.12, length(vec2(dFdx(signedS), dFdy(signedS))) * 6.0);
  float foamLine = (1.0 - smoothstep(0.0, foamW, abs(signedS - wl)))
                 * mix(0.38, 1.0, n3) * beach
                 * (1.0 - smoothstep(0.10, 0.20, signedS));
  float film = receding * beach * (1.0 - swashCover)
             * smoothstep(wl + 0.12, wl + 0.02, signedS)
             * smoothstep(wl - 0.06, wl + 0.02, signedS)
             * mix(0.12, 0.40, n2);
  float wetMark = tide + mix(-0.04, 0.14, 0.5 + 0.5 * sin(phase - 0.95)) + lace * 0.45;
  float wetSand = isSand * beach * (1.0 - swashCover)
                * smoothstep(wetMark + 0.18, wl + 0.03, signedS)
                * smoothstep(wl - 0.04, wl + 0.08, signedS)
                * mix(0.28, 1.0, receding * 0.65 + (1.0 - cycle) * 0.18);
  runup *= offBoard;
  foamLine *= offBoard;
  film *= offBoard;
  wetSand *= offBoard;

  vec2 rPxH = 11.0 / vec2(textureSize(u_rocks, 0));
  float rockHalo = rockHardSrc;
  rockHalo = max(rockHalo, texture(u_rocks, clamp(uvC + vec2( rPxH.x,  0.0), 0.0, 1.0)).r);
  rockHalo = max(rockHalo, texture(u_rocks, clamp(uvC + vec2(-rPxH.x,  0.0), 0.0, 1.0)).r);
  rockHalo = max(rockHalo, texture(u_rocks, clamp(uvC + vec2( 0.0,  rPxH.y), 0.0, 1.0)).r);
  rockHalo = max(rockHalo, texture(u_rocks, clamp(uvC + vec2( 0.0, -rPxH.y), 0.0, 1.0)).r);
  rockHalo = max(rockHalo, texture(u_rocks, clamp(uvC + vec2( rPxH.x,  rPxH.y), 0.0, 1.0)).r);
  rockHalo = max(rockHalo, texture(u_rocks, clamp(uvC + vec2(-rPxH.x,  rPxH.y), 0.0, 1.0)).r);
  rockHalo = max(rockHalo, texture(u_rocks, clamp(uvC + vec2( rPxH.x, -rPxH.y), 0.0, 1.0)).r);
  rockHalo = max(rockHalo, texture(u_rocks, clamp(uvC + vec2(-rPxH.x, -rPxH.y), 0.0, 1.0)).r);
  float nearRock = clamp(rockHalo * (1.0 - rockHard), 0.0, 1.0);
  float rockFoam = nearRock * beach
                 * (1.0 - smoothstep(0.12, 0.36, signedS))
                 * (foamLine * 0.90 + film * 0.55 + 0.18 * cycle);

  vec2 refr = clamp(uvC + N.xz * (0.048 * waterAmt + 0.040 * edgeWater + 0.018 * runup), 0.0, 1.0);
  // Never refract onto a land rock. Never wrap/tile the island tex off-photo.
  float refrRock = texture(u_rocks, refr).r;
  if (refrRock > 0.12) refr = uvC;
  float shallow = clamp(edgeWater + runup * 0.70, 0.0, 1.0)
                * (1.0 - smoothstep(0.14, 0.46, signedS));
  // Constant teal seafloor. Never sample island.webp as the water surface (baked ripples).
  vec3 photoW = seafloor(iuv, t);
  vec3 wcol = oceanColor(wp, uvC, photoW, N, nh, disp.y, waterAmt, t);
  wcol = mix(wcol, vec3(0.14, 0.68, 0.64), shallow * 0.46);
  wcol = mix(wcol, vec3(0.72, 0.90, 0.96), edgeWater * (0.10 + 0.16 * cycle));

  float peak = smoothstep(0.002, 0.028, disp.y);
  float foam = foamLine * 0.95 + film + rockFoam;
  foam += waterAmt * peak * 0.22;
  foam += edgeWater * 0.10;
  foam *= (1.0 - rockHard) * (1.0 - rockAmt) * (1.0 - isVeg) * (1.0 - palm);
  foam = clamp(foam, 0.0, 1.0);

  // All water (in-photo + off-photo to the screen edge) is Gerstner wcol. Albedo never wins on water.
  vec3 col = mix(albedo, wcol, max(max(waterAmt, 1.0 - inPhoto), runup * 0.80));
  float wetLum = dot(albedo, vec3(0.30, 0.59, 0.11));
  vec3 wetCol = mix(vec3(wetLum), albedo, 1.35) * vec3(0.55, 0.45, 0.33);
  col = mix(col, wetCol, wetSand * 0.82);
  col = mix(col, albedo * vec3(0.68, 0.56, 0.44), edgeSand * (0.08 + 0.10 * cycle) * (1.0 - wetSand));
  col = mix(col, vec3(0.97, 0.99, 1.0), foam * 0.96);

  vec2 carveUv = clamp(vec2(iuv.x, 1.0 - iuv.y), 0.0, 1.0);
  float sandMask = (1.0 - rockHard) * (1.0 - rockAmt) * (1.0 - step(0.08, isVeg)) * (1.0 - palm) * isSand * onBoard;
  float g = texture(u_carve, carveUv).r * inIsland * u_fade * sandMask;
  float groove = smoothstep(0.04, 0.36, g);
  vec3 wet = albedo * vec3(0.46, 0.36, 0.24);
  col = mix(col, wet, groove * 0.90);
  col *= 1.0 - groove * 0.10;
  float rim = clamp(-dFdx(g) * 2.2 + dFdy(g) * 1.1, 0.0, 1.0) * groove;
  col += albedo * vec3(0.28, 0.20, 0.10) * rim * 0.40;

  // Interior bushes on land stay photo. Over-water palm composites only from u_palms.
  col = mix(col, albedo, clamp(max(rockAmt, isVeg * (1.0 - palm)), 0.0, 1.0));
  if (palm > 0.01) {
    vec3 leaf = palmTex.rgb / max(palmTex.a, 0.001);
    col = mix(col, leaf, palm);
  }
  fragColor = vec4(col, 1.0);
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
function setZoom(z) {
  return camSetZoom(z, _activeSkin).zoom;
}
function bindZoom(layoutHit) {
  bindCamera({
    skin: _activeSkin,
    onChange() {
      if (typeof layoutHit === "function") layoutHit();
    },
  });
}
function teslaUserAgent() {
  try { return /Tesla/i.test(navigator.userAgent || ""); }
  catch { return false; }
}
function probeWebGL2() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2", { alpha: false, antialias: true, premultipliedAlpha: true });
    return !!(gl && !gl.isContextLost());
  } catch { return false; }
}
function forcedPath() {
  const v = String(queryParam("renderer")).toLowerCase();
  if (v === "webgpu" || v === "webgl" || v === "2d") return v;
  return "";
}
function fpsWanted() { return queryParam("fps") === "1"; }

function ensureFpsHud() {
  if (!fpsWanted()) return null;
  let el = document.getElementById("fps-hud");
  if (!el) {
    el = document.createElement("div");
    el.id = "fps-hud";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
  }
  return el;
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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image " + src));
    img.src = src;
  });
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(log || "shader compile");
  }
  return sh;
}

function makeProgram(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) || "link");
  }
  return prog;
}

function makeTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function paintGrooves2d(ctx, w, h, skin) {
  const snap = skin.getSnap();
  const ins = skinInset(skin);
  const z = currentZoom();
  const cam = getCamera();
  const side = Math.max(w, h) * skinFit(skin) * z;
  const ox0 = (w - side) / 2 + cam.panX * side;
  const oy0 = (h - side) / 2 + cam.panY * side;
  const x0 = ox0 + ins.left * side;
  const y0 = oy0 + ins.top * side;
  const bw = side * (1 - ins.left - ins.right);
  const bh = side * (1 - ins.top - ins.bottom);
  const c = snap.cols;
  const r = snap.rows;
  const cw = bw / c;
  const rh = bh / r;
  const lw = Math.max(1.6, Math.min(cw, rh) * 0.038);

  function strokeAll(ox, oy, color, width, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 1; i < c; i++) {
      const pts = stickLine(x0 + i * cw, y0 + rh * 0.07, x0 + i * cw, y0 + bh - rh * 0.07, 200 + i * 13, Math.min(cw, rh) * 0.018);
      strokeStick(ctx, pts.map((p) => ({ x: p.x + ox, y: p.y + oy })));
    }
    for (let i = 1; i < r; i++) {
      const pts = stickLine(x0 + cw * 0.07, y0 + i * rh, x0 + bw - cw * 0.07, y0 + i * rh, 400 + i * 17, Math.min(cw, rh) * 0.018);
      strokeStick(ctx, pts.map((p) => ({ x: p.x + ox, y: p.y + oy })));
    }
    const pad = Math.min(cw, rh) * 0.20;
    for (let i = 0; i < snap.cells.length; i++) {
      const v = snap.cells[i];
      if (!v) continue;
      const col = i % c;
      const row = (i / c) | 0;
      const x = x0 + col * cw;
      const y = y0 + row * rh;
      const letter = v === 1 ? "X" : "O";
      const drawn = skin.getMark && skin.getMark(i);
      if (drawn && drawn.strokes && drawn.strokes.length) {
        for (const stroke of drawn.strokes) {
          const pts = stroke.points || stroke;
          if (!pts.length) continue;
          ctx.moveTo(pts[0].x * side + ox0 + ox, pts[0].y * side + oy0 + oy);
          for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x * side + ox0 + ox, pts[k].y * side + oy0 + oy);
        }
      } else if (letter === "X") {
        for (const pts of stickX(x, y, cw, rh, pad, 700 + i * 31)) {
          strokeStick(ctx, pts.map((p) => ({ x: p.x + ox, y: p.y + oy })));
        }
      } else {
        const rad = Math.min(cw, rh) / 2 - pad;
        const pts = stickO(x + cw / 2, y + rh / 2, rad, rad * 0.92, 900 + i * 29);
        strokeStick(ctx, pts.map((p) => ({ x: p.x + ox, y: p.y + oy })));
      }
    }
    const win = snap.winLine || [];
    if (win.length >= 2) {
      const a = win[0];
      const b = win[win.length - 1];
      const pts = stickLine(
        x0 + (a % c) * cw + cw / 2, y0 + ((a / c) | 0) * rh + rh / 2,
        x0 + (b % c) * cw + cw / 2, y0 + ((b / c) | 0) * rh + rh / 2,
        1100 + a * 7 + b, Math.min(cw, rh) * 0.03
      );
      strokeStick(ctx, pts.map((p) => ({ x: p.x + ox, y: p.y + oy })));
    }
    ctx.stroke();
    ctx.restore();
  }

  // Stick-carved wet sand: dark trench + dusty lip. Photo shows through. No white.
  const fade = Number((window.__latisCamera && window.__latisCamera.carveFade) ?? 1);
  const a = Math.max(0, Math.min(1, fade));
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  strokeAll(1.4, 1.8, "rgb(92, 68, 42)", lw * 1.55, 0.38 * a);
  strokeAll(0.3, 0.45, "rgb(120, 88, 54)", lw * 1.05, 0.34 * a);
  ctx.restore();
  strokeAll(-0.8, -1.0, "rgba(196, 160, 110, 0.22)", lw * 0.42, 0.55 * a);
}

function paintCanvas2D(canvas, island, skin) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#1a8094";
  ctx.fillRect(0, 0, w, h);
  const z = currentZoom();
  const cam = getCamera();
  const rot = Number(cam.rot) || 0;
  // Rotate around canvas center so Tesla/2D matches GL (shader +rot is CCW on screen → canvas -rot).
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-rot);
  ctx.translate(-w / 2, -h / 2);
  const side = Math.max(w, h) * skinFit(skin) * z;
  const ox = (w - side) / 2 + cam.panX * side;
  const oy = (h - side) / 2 + cam.panY * side;
  // 2D Tesla fallback: still photo + cheap oscillating wet-sand tint. No Gerstner/foam.
  if (island) ctx.drawImage(island, ox, oy, side, side);
  {
    const t = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * ((Math.PI * 2) / 3.2));
    const cx = ox + side * 0.5;
    const cy = oy + side * 0.5;
    // Ring at the cay edge so the center playable board stays dry still-photo.
    const g = ctx.createRadialGradient(cx, cy, side * (0.44 + 0.012 * pulse), cx, cy, side * (0.55 + 0.018 * pulse));
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.42, "rgba(92, 68, 46, 1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.10 + 0.18 * pulse;
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, side, side);
    ctx.restore();
  }
  paintGrooves2d(ctx, w, h, skin);
}

async function startWebGL(mountEl, skin, island, rocks, palms) {
  const canvas = document.createElement("canvas");
  canvas.id = "board-webgl";
  canvas.setAttribute("aria-hidden", "true");
  mountEl.replaceChildren();
  mountEl.style.pointerEvents = "none";
  canvas.style.pointerEvents = "none";
  mountEl.appendChild(canvas);
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl || gl.isContextLost()) throw new Error("WebGL2 missing");
  const prog = makeProgram(gl, VS, FS);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.activeTexture(gl.TEXTURE0);
  const islandTex = makeTexture(gl);
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  let islandUpload = island;
  if (island && (island.width > maxTex || island.height > maxTex)) {
    const s = maxTex / Math.max(island.width, island.height);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(island.width * s));
    c.height = Math.max(1, Math.round(island.height * s));
    c.getContext("2d").drawImage(island, 0, 0, c.width, c.height);
    islandUpload = c;
  }
  {
    const ic = document.createElement("canvas");
    ic.width = islandUpload.width || islandUpload.naturalWidth;
    ic.height = islandUpload.height || islandUpload.naturalHeight;
    ic.getContext("2d", { alpha: true, colorSpace: "srgb" }).drawImage(islandUpload, 0, 0, ic.width, ic.height);
    islandUpload = ic;
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, islandUpload);
  const err0 = gl.getError();
  if (err0) throw new Error("island tex " + err0);

  const carveCanvas = document.createElement("canvas");
  carveCanvas.width = 1024;
  carveCanvas.height = 1024;
  gl.activeTexture(gl.TEXTURE1);
  const carveTex = makeTexture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1024, 1024, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  gl.activeTexture(gl.TEXTURE2);
  const rocksTex = makeTexture(gl);
  if (rocks) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, rocks);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  }

  gl.activeTexture(gl.TEXTURE3);
  const palmsTex = makeTexture(gl);
  if (palms) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, palms);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  }

  const uTime = gl.getUniformLocation(prog, "u_time");
  const uRes = gl.getUniformLocation(prog, "u_res");
  const uZoom = gl.getUniformLocation(prog, "u_zoom");
  const uPan = gl.getUniformLocation(prog, "u_pan");
  const uRot = gl.getUniformLocation(prog, "u_rot");
  const uFade = gl.getUniformLocation(prog, "u_fade");
  const uIsland = gl.getUniformLocation(prog, "u_island");
  const uCarve = gl.getUniformLocation(prog, "u_carve");
  const uRocks = gl.getUniformLocation(prog, "u_rocks");
  const uPalms = gl.getUniformLocation(prog, "u_palms");
  gl.useProgram(prog);
  gl.uniform1i(uIsland, 0);
  gl.uniform1i(uCarve, 1);
  gl.uniform1i(uRocks, 2);
  gl.uniform1i(uPalms, 3);

  let lastKey = "";
  function uploadCarve() {
    const key = skin.sourceKey();
    if (key === lastKey) return;
    lastKey = key;
    skin.paintCarve(carveCanvas, skin.getSnap());
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, carveTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, carveCanvas);
  }

  const t0 = performance.now();
  function frame() {
    const { w, h } = sizeCanvas(canvas, mountEl);
    gl.viewport(0, 0, w, h);
    uploadCarve();
    gl.useProgram(prog);
    gl.uniform2f(uRes, w, h);
    gl.uniform1f(uTime, (performance.now() - t0) / 1000);
    gl.uniform1f(uZoom, currentZoom());
    {
      const cam = getCamera();
      gl.uniform2f(uPan, cam.panX, cam.panY);
      gl.uniform1f(uRot, cam.rot || 0);
    }
    gl.uniform1f(uFade, Number((window.__latisCamera && window.__latisCamera.carveFade) ?? 1));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, islandTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, carveTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, rocksTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, palmsTex);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.clearColor(0.04, 0.22, 0.34, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  uploadCarve();
  frame();
  return { path: "webgl", canvas, frame, gl };
}

function startCanvas2D(mountEl, skin, island) {
  const canvas = document.createElement("canvas");
  canvas.id = "board-2d";
  canvas.setAttribute("aria-hidden", "true");
  mountEl.replaceChildren();
  mountEl.style.pointerEvents = "none";
  canvas.style.pointerEvents = "none";
  mountEl.appendChild(canvas);
  skin.setCanvas2D(canvas);
  let lastKey = "";
  function frame() {
    sizeCanvas(canvas, mountEl);
    const fade = Number((window.__latisCamera && window.__latisCamera.carveFade) ?? 1);
    const cam = getCamera();
    const tBucket = Math.floor(((typeof performance !== "undefined" ? performance.now() : 0) / 1000) * 5);
    const key = skin.sourceKey() + "|" + canvas.width + "x" + canvas.height + "|z" + currentZoom() + "|f" + fade.toFixed(3) + "|p" + cam.panX.toFixed(4) + "," + cam.panY.toFixed(4) + "|r" + (cam.rot || 0).toFixed(4) + "|t" + tBucket;
    if (key === lastKey) return;
    lastKey = key;
    paintCanvas2D(canvas, island, skin);
  }
  frame();
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => { lastKey = ""; frame(); }).observe(mountEl);
  } else {
    window.addEventListener("resize", () => { lastKey = ""; frame(); });
  }
  return { path: "2d", canvas, frame };
}

function startBoardPaint(mountEl, skin) {
  const canvas = document.createElement("canvas");
  canvas.id = "board-2d";
  canvas.setAttribute("aria-hidden", "true");
  mountEl.replaceChildren();
  mountEl.style.pointerEvents = "none";
  canvas.style.pointerEvents = "none";
  mountEl.appendChild(canvas);
  if (skin.setCanvas2D) skin.setCanvas2D(canvas);
  let lastSnap = null;
  function frame() {
    sizeCanvas(canvas, mountEl);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (skin.draw && lastSnap) skin.draw(lastSnap, ctx, canvas);
  }
  frame();
  bindZoom(skin.layoutHit);
  document.documentElement.dataset.renderer = "board";
  document.documentElement.dataset.ready = "1";
  return {
    path: "board",
    canvas,
    frame,
    draw(snap) {
      lastSnap = snap;
      if (skin.draw) skin.draw(snap, canvas.getContext("2d"), canvas);
      frame();
    },
    dispose() {},
  };
}

export async function startRenderer({ mountEl, skin }) {
  if (!mountEl) throw new Error("startRenderer: mountEl required");
  if (!skin) throw new Error("startRenderer: skin required");
  _activeSkin = skin;
  const paintMode = (skin && skin.paint) || "overlay";
  if (paintMode === "scene") {
    bindZoom(skin.layoutHit);
    document.documentElement.dataset.renderer = "scene";
    document.documentElement.dataset.ready = "1";
    return {
      path: "scene",
      draw(snap) { if (snap && skin.draw) skin.draw(snap); },
      dispose() {},
    };
  }
  if (paintMode === "board") {
    return startBoardPaint(mountEl, skin);
  }
  const hud = ensureFpsHud();
  let island = null;
  try { island = await loadImage(skin.islandUrl); }
  catch (err) { console.warn("island albedo", err); }
  let rocks = null;
  try { if (skin.rocksUrl) rocks = await loadImage(skin.rocksUrl); }
  catch (err) { console.warn("land rocks mask", err); }
  let palms = null;
  try { if (skin.palmsUrl) palms = await loadImage(skin.palmsUrl); }
  catch (err) { console.warn("palms overlay", err); }

  const forced = forcedPath();
  let gpu = null;
  let path = "2d";
  const tesla = teslaUserAgent();
  const hasGpu = typeof navigator !== "undefined" && !!navigator.gpu;
  const wantGPU = forced !== "webgl" && forced !== "2d" && hasGpu && !!island && (forced === "webgpu" || !tesla);
  if (wantGPU) {
    try {
      gpu = await startWebGPU({ mountEl, skin, island, rocks, palms });
      path = "webgpu";
    } catch (err) {
      console.warn("renderer webgpu failed", err);
      try { mountEl.replaceChildren(); } catch { /* ignore */ }
    }
  }
  const wantGL = !gpu && forced !== "2d" && (forced === "webgl" || probeWebGL2());
  if (wantGL && island) {
    try {
      gpu = await startWebGL(mountEl, skin, island, rocks, palms);
      path = "webgl";
    } catch (err) {
      console.warn("renderer webgl failed", err);
      try { mountEl.replaceChildren(); } catch { /* ignore */ }
    }
  }
  if (!gpu) {
    gpu = startCanvas2D(mountEl, skin, island);
    path = "2d";
  }

  document.documentElement.dataset.renderer = path;
  document.documentElement.dataset.ready = "1";
  window.__latisCamera = Object.assign(window.__latisCamera || {}, { renderer: path });

  let raf = 0;
  let fpsFrames = 0;
  let fpsStamp = 0;
  function tick(now) {
    raf = window.requestAnimationFrame(tick);
    if (gpu && gpu.frame) gpu.frame();
    fpsFrames += 1;
    if (!fpsStamp) fpsStamp = now;
    const elapsed = now - fpsStamp;
    if (elapsed >= 250) {
      const n = Math.round((fpsFrames * 1000) / elapsed);
      setMetric("fps", String(n));
      if (hud) hud.textContent = n + " fps · " + path;
      fpsFrames = 0;
      fpsStamp = now;
    }
  }
  raf = window.requestAnimationFrame(tick);

  if (skin.layoutHit) skin.layoutHit();
  bindZoom(skin.layoutHit);

  return {
    path,
    draw(snap) {
      if (snap && skin.draw) skin.draw(snap);
      if (gpu && gpu.frame) gpu.frame();
    },
    dispose() {
      if (raf) window.cancelAnimationFrame(raf);
    },
  };
}
