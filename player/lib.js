/** Title → lowercase filename slug. Apostrophes drop; other non-alnum become `-`. */
export function slugify(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2018\u2019\u0060]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function joinUrl(base, name) {
  const b = String(base || "");
  if (!b) return name;
  return b.endsWith("/") ? b + name : b + "/" + name;
}

/** AAC-LC only: `{mediaBase}{slug}.m4a`. */
export function songUrl(mediaBase, title) {
  const slug = slugify(title);
  if (!slug) return "";
  return joinUrl(mediaBase, slug + ".m4a");
}

/**
 * Safari desktop and every iOS/iPadOS WebKit browser. MediaElementSource
 * on these stacks silences element playback.
 */
export function isSafariFamily(ua, hints) {
  const nav = hints && hints.navigator;
  const userAgent = ua || (nav && nav.userAgent) || (typeof navigator !== "undefined" ? navigator.userAgent : "") || "";
  const platform = hints && hints.platform != null
    ? hints.platform
    : (nav && nav.platform) || (typeof navigator !== "undefined" ? navigator.platform : "") || "";
  const maxTouch = hints && hints.maxTouchPoints != null
    ? hints.maxTouchPoints
    : (nav && nav.maxTouchPoints) || (typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0) || 0;
  const iOS = /iP(hone|od|ad)/.test(userAgent) || (platform === "MacIntel" && maxTouch > 1);
  const safari = /Safari/i.test(userAgent) && !/Chrome|CriOS|Chromium|EdgA?|FxiOS|OPR|Android/i.test(userAgent);
  return !!(iOS || safari);
}

/** Skip while paused stays paused. Playing: crossfade if next is ready, else fade. */
export function skipKind(playing, nextReady) {
  if (!playing) return "paused";
  return nextReady ? "crossfade" : "fade";
}

export const HAVE_FUTURE_DATA = 3;

export function deckReady(node, url) {
  if (!node || !url) return false;
  const assigned = node.dataset && node.dataset.lmpSrc;
  const srcAttr = node.getAttribute && node.getAttribute("src");
  const matches = assigned === url || srcAttr === url;
  return !!(matches && node.readyState >= HAVE_FUTURE_DATA);
}

export function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function wrapIndex(i, len) {
  if (!len) return 0;
  return ((i % len) + len) % len;
}

/** 1px clip-rect vis-hide. Never `display:none` on `<audio>` (Safari). */
export const AUDIO_VIS_HIDE =
  "display:block !important;position:absolute;width:1px;height:1px;margin:0;padding:0;overflow:hidden;clip:rect(0,0,0,0);border:0;pointer-events:none";

/** Log-spectrum bar energy from analyser frequency bins. */
export function logSpectrumBar(freqBins, i, bars) {
  const n = freqBins && freqBins.length;
  if (!n || bars <= 0) return 0;
  const lo = i <= 0 ? 0 : Math.floor(Math.pow(n, i / bars));
  const hi = Math.max(lo + 1, Math.ceil(Math.pow(n, (i + 1) / bars)));
  let sum = 0;
  let count = 0;
  for (let k = lo; k < hi && k < n; k++) {
    sum += freqBins[k];
    count++;
  }
  return (sum / Math.max(1, count)) / 255;
}

export function fillLogSpectrum(freqBins, out) {
  const bars = out && out.length;
  if (!bars) return out;
  for (let i = 0; i < bars; i++) {
    const target = Math.min(1, Math.max(0, logSpectrumBar(freqBins, i, bars)));
    out[i] += (target - out[i]) * 0.5;
  }
  return out;
}
