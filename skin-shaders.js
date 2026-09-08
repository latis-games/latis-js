/** Thin generic skin-module shader loader.
 * Titles set skin.webgpuUrl / skin.webglUrl / skin.canvasUrl (or skin.resolveShaders).
 * Engine dynamically imports that module and normalizes vertex / fragment / wgsl / paint.
 */

const KIND_URL_KEYS = {
  webgpu: ["webgpuUrl"],
  webgl: ["webglUrl"],
  canvas: ["canvasUrl"],
  "2d": ["canvasUrl"],
};

/**
 * Pick the shader-module URL for a renderer tier from the skin.
 * @param {object | null | undefined} skin
 * @param {string} kind  "webgpu" | "webgl" | "canvas" | "2d"
 * @returns {string}
 */
export function pickShaderModuleUrl(skin, kind) {
  if (!skin || !kind) return "";
  const keys = KIND_URL_KEYS[kind] || [String(kind) + "Url"];
  for (let i = 0; i < keys.length; i++) {
    const url = skin[keys[i]];
    if (typeof url === "string" && url.trim()) return url.trim();
  }
  return "";
}

function resolveModuleHref(url) {
  if (!url) return "";
  if (/^(https?:|data:|file:|blob:)/i.test(url) || url.startsWith("/")) return url;
  try {
    if (typeof document !== "undefined" && document.baseURI) {
      return new URL(url, document.baseURI).href;
    }
  } catch {
    /* keep relative specifier */
  }
  return url;
}

function asString(v) {
  return typeof v === "string" ? v : "";
}

/**
 * Normalize a dynamically imported (or inline) module into engine shader fields.
 * Accepts named exports, a default object, or a default string (wgsl / fragment by kind).
 * @param {object | string | null | undefined} mod
 * @param {string} [kind]
 */
export function normalizeShaderModule(mod, kind) {
  if (mod == null || mod === "") {
    return { vertex: "", fragment: "", wgsl: "", paint: null };
  }
  if (typeof mod === "string") {
    const rec = { vertex: "", fragment: "", wgsl: "", paint: null };
    if (kind === "webgpu") rec.wgsl = mod;
    else rec.fragment = mod;
    return rec;
  }
  let rec = mod;
  if (typeof mod.default === "string") {
    rec = { ...mod };
    if (kind === "webgpu") rec.wgsl = rec.wgsl || mod.default;
    else rec.fragment = rec.fragment || mod.default;
  } else if (mod.default && typeof mod.default === "object") {
    rec = { ...mod.default, ...mod };
  }
  const paint =
    typeof rec.paint === "function"
      ? rec.paint
      : typeof rec.paintCanvas === "function"
        ? rec.paintCanvas
        : null;
  return {
    vertex: asString(rec.vertex || rec.vertexSrc || rec.vs),
    fragment: asString(rec.fragment || rec.fragmentSrc || rec.fs),
    wgsl: asString(rec.wgsl || rec.wgslSrc || rec.code),
    paint,
  };
}

/**
 * Load and normalize the title's shader module for one renderer tier.
 * Prefers `skin.resolveShaders(kind)` when that is a function; otherwise
 * dynamically imports `skin.webgpuUrl` / `webglUrl` / `canvasUrl`.
 * @param {object | null | undefined} skin
 * @param {string} kind
 */
export async function resolveShaders(skin, kind) {
  if (skin && typeof skin.resolveShaders === "function") {
    return normalizeShaderModule(await skin.resolveShaders(kind), kind);
  }
  const url = pickShaderModuleUrl(skin, kind);
  if (!url) return normalizeShaderModule(null, kind);
  const href = resolveModuleHref(url);
  const mod = await import(href);
  return normalizeShaderModule(mod, kind);
}
