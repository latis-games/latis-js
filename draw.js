/** Sand strokes in photo UV (0–1). Tap places. Closed loop = O. Two slashes = X. */

export function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

function bbox(pts) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of pts) {
    if (p.x < minx) minx = p.x;
    if (p.y < miny) miny = p.y;
    if (p.x > maxx) maxx = p.x;
    if (p.y > maxy) maxy = p.y;
  }
  return { minx, miny, maxx, maxy, w: maxx - minx, h: maxy - miny };
}

function shoelace(pts) {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) * 0.5;
}

function distToSeg(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const L2 = vx * vx + vy * vy;
  if (L2 < 1e-8) return dist(p, a);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** UV-space line: a cell slash is ~0.08–0.14 long. Pixel thresholds (8/10) never fire in UV. */
export function isLine(pts) {
  if (pts.length < 2) return false;
  const L = pathLength(pts);
  const chord = dist(pts[0], pts[pts.length - 1]);
  if (L < 0.035 || chord < 0.026) return false;
  let maxd = 0;
  for (const p of pts) maxd = Math.max(maxd, distToSeg(p, pts[0], pts[pts.length - 1]));
  return maxd < 0.28 * L && chord > 0.48 * L;
}

/** Reconnects-to-itself is the O signal. Messy loops still count. */
export function isCircle(pts) {
  if (pts.length < 6) return false;
  const box = bbox(pts);
  const span = Math.max(box.w, box.h, 1e-6);
  const L = pathLength(pts);
  const gap = dist(pts[0], pts[pts.length - 1]);
  const closed = gap < 0.38 * span || gap < 0.28 * L;
  if (!closed) return false;
  if (L < 0.055 || L < 1.12 * span) return false;
  if (isLine(pts)) return false;
  const A = shoelace(pts);
  const P = L + gap;
  const circ = P > 0 ? (4 * Math.PI * A) / (P * P) : 0;
  // Loose: a reconnecting stroke is enough even if circularity is messy.
  return circ > 0.12 || gap < 0.22 * span;
}

function headingBins(pts) {
  const bins = [0, 0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const len = Math.hypot(dx, dy);
    if (len < 0.002) continue;
    const ang = (Math.atan2(dy, dx) + Math.PI) % Math.PI;
    const slash = Math.abs(Math.cos(ang - Math.PI / 4));
    const back = Math.abs(Math.cos(ang + Math.PI / 4));
    if (slash >= back) bins[0] += len;
    else bins[1] += len;
  }
  return bins;
}

export function isCross(pts) {
  if (pts.length < 6) return false;
  if (isCircle(pts) || isLine(pts)) return false;
  const bins = headingBins(pts);
  const tot = bins[0] + bins[1] || 1;
  const a = bins[0] / tot;
  const b = bins[1] / tot;
  return a > 0.22 && b > 0.22;
}

export function classifyStroke(pts) {
  const L = pathLength(pts);
  // UV tap: a few percent of the photo. Old L < 16 made EVERY UV stroke a tap.
  if (pts.length < 2 || L < 0.016) return "tap";
  if (isCircle(pts)) return "O";
  if (isCross(pts)) return "X";
  if (isLine(pts)) return "line";
  return "unknown";
}

export function angleBetween(a0, a1, b0, b1) {
  const ax = a1.x - a0.x;
  const ay = a1.y - a0.y;
  const bx = b1.x - b0.x;
  const by = b1.y - b0.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-6 || lb < 1e-6) return 0;
  const c = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  const deg = (Math.acos(c) * 180) / Math.PI;
  return deg > 90 ? 180 - deg : deg;
}

export function twoLinesAreCross(a, b) {
  if (!isLine(a) || !isLine(b)) return false;
  const ang = angleBetween(a[0], a[a.length - 1], b[0], b[b.length - 1]);
  // Perfect X is 90°. Old ceiling of 88 dropped perpendicular slashes.
  return ang >= 32 && ang <= 90;
}

export function cellFromUv(u, v, inset, cols, rows, slack) {
  const pad = slack == null ? 0.08 : slack;
  const bw = 1 - inset.left - inset.right;
  const bh = 1 - inset.top - inset.bottom;
  if (bw <= 0 || bh <= 0) return -1;
  const lx = (u - inset.left) / bw;
  const ly = (v - inset.top) / bh;
  if (lx < -pad / bw || ly < -pad / bh || lx >= 1 + pad / bw || ly >= 1 + pad / bh) return -1;
  const col = Math.min(cols - 1, Math.max(0, Math.floor(lx * cols)));
  const row = Math.min(rows - 1, Math.max(0, Math.floor(ly * rows)));
  return row * cols + col;
}

export function majorityCell(pts, inset, cols, rows) {
  const votes = new Map();
  for (const p of pts) {
    const i = cellFromUv(p.x, p.y, inset, cols, rows);
    if (i < 0) continue;
    votes.set(i, (votes.get(i) || 0) + 1);
  }
  let best = -1;
  let n = 0;
  for (const [i, c] of votes) {
    if (c > n) {
      n = c;
      best = i;
    }
  }
  if (best >= 0) return best;
  if (!pts.length) return -1;
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return cellFromUv(sx / pts.length, sy / pts.length, inset, cols, rows, 0.04);
}

/** True if the stroke mostly lives in one cell (small spill OK). */
export function strokeFitsCell(pts, cell, inset, cols, rows) {
  if (cell < 0 || !pts || !pts.length) return false;
  const bw = 1 - inset.left - inset.right;
  const bh = 1 - inset.top - inset.bottom;
  if (bw <= 0 || bh <= 0 || !cols || !rows) return false;
  const cw = bw / cols;
  const rh = bh / rows;
  const col = cell % cols;
  const row = (cell / cols) | 0;
  const minx = inset.left + col * cw;
  const miny = inset.top + row * rh;
  const maxx = minx + cw;
  const maxy = miny + rh;
  const pad = 0.22 * Math.min(cw, rh);
  const box = bbox(pts);
  if (box.minx < minx - pad || box.maxx > maxx + pad || box.miny < miny - pad || box.maxy > maxy + pad) {
    return false;
  }
  let inside = 0;
  for (const pt of pts) {
    if (cellFromUv(pt.x, pt.y, inset, cols, rows, 0.04) === cell) inside += 1;
  }
  return inside >= pts.length * 0.7;
}


/** Seeded 0–1. Stable so carved lines do not shimmer. */
export function hash01(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43759.17;
  return x - Math.floor(x);
}

/** Hand-drawn stick stroke between two points. amp is perpendicular wobble in px. */
export function stickLine(x0, y0, x1, y1, seed, amp) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const n = Math.max(10, Math.round(len / 6));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const fade = Math.sin(t * Math.PI);
    const w = (hash01(seed + i * 19) - 0.5) * 2 * amp * fade;
    const w2 = (hash01(seed + i * 47 + 3) - 0.5) * amp * 0.5 * fade;
    pts.push({
      x: x0 + dx * t + nx * (w + w2),
      y: y0 + dy * t + ny * (w + w2),
    });
  }
  return pts;
}

export function stickX(x, y, cw, rh, pad, seed) {
  const amp = Math.min(cw, rh) * 0.038;
  return [
    stickLine(x + pad, y + pad, x + cw - pad, y + rh - pad, seed, amp),
    stickLine(x + cw - pad, y + pad, x + pad, y + rh - pad, seed + 17, amp),
  ];
}

/** Hand-drawn sand O: slightly oval, wobble on the radius, always a closed circle. */
export function stickO(cx, cy, rx, ry, seed) {
  const n = 32;
  const pts = [];
  const start = hash01(seed) * Math.PI * 2;
  const sweep = Math.PI * 2;
  const rx2 = rx * (0.94 + hash01(seed + 2) * 0.10);
  const ry2 = ry * (0.94 + hash01(seed + 5) * 0.10);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = start + t * sweep;
    const wob = 1 + (hash01(seed + i * 9) - 0.5) * 0.10;
    pts.push({ x: cx + Math.cos(a) * rx2 * wob, y: cy + Math.sin(a) * ry2 * wob });
  }
  pts[pts.length - 1] = { x: pts[0].x, y: pts[0].y };
  return pts;
}

export function strokeStick(ctx, pts) {
  if (!pts || pts.length < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}
