/** LatisEngine — dumb grid kernel. Players are opaque u8 (0 = empty). No X/O, turns, or title rules. */

const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

const NEIGHBOR_DIRS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export class LatisEngine {
  /**
   * @param {number} cols
   * @param {number} rows
   */
  constructor(cols, rows) {
    this._cols = cols >>> 0;
    this._rows = rows >>> 0;
    const n = this._cols * this._rows;
    this._cells = new Uint8Array(n);
  }

  cols() {
    return this._cols;
  }

  rows() {
    return this._rows;
  }

  len() {
    return this._cells.length;
  }

  /** @param {number} i */
  cell(i) {
    const idx = i | 0;
    if (idx < 0 || idx >= this._cells.length) return 0;
    return this._cells[idx];
  }

  /** Write `v` at `i`. No-op if out of bounds. */
  set(i, v) {
    const idx = i | 0;
    if (idx < 0 || idx >= this._cells.length) return;
    this._cells[idx] = v & 0xff;
  }

  /** Place `player` on an empty in-bounds cell. `false` if occupied or OOB. */
  place(i, player) {
    const idx = i | 0;
    if (idx < 0 || idx >= this._cells.length) return false;
    if (this._cells[idx] !== 0) return false;
    this._cells[idx] = player & 0xff;
    return true;
  }

  clear() {
    this._cells.fill(0);
  }

  reset() {
    this.clear();
  }

  full() {
    const cells = this._cells;
    if (!cells.length) return false;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === 0) return false;
    }
    return true;
  }

  /**
   * First contiguous run of at least `k` matching non-empty cells.
   * Empty array if none. `k` is supplied by the host, not baked in.
   * @param {number} k
   * @returns {number[]}
   */
  kInARow(k) {
    k = k >>> 0;
    const cols = this._cols;
    const rows = this._rows;
    const cells = this._cells;
    if (!k || !cols || !rows) return [];

    const indexAt = (x, y) => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return -1;
      return y * cols + x;
    };

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const v = cells[i];
        if (!v) continue;
        for (let d = 0; d < DIRS.length; d++) {
          const dx = DIRS[d][0];
          const dy = DIRS[d][1];
          const pi = indexAt(x - dx, y - dy);
          if (pi >= 0 && cells[pi] === v) continue;
          const line = [i];
          let cx = x + dx;
          let cy = y + dy;
          for (;;) {
            const ni = indexAt(cx, cy);
            if (ni < 0 || cells[ni] !== v) break;
            line.push(ni);
            cx += dx;
            cy += dy;
          }
          if (line.length >= k) return line;
        }
      }
    }
    return [];
  }

  /**
   * 8-connected in-bounds neighbors of `i`. Empty if `i` is OOB.
   * @param {number} i
   * @returns {number[]}
   */
  neighbors(i) {
    const idx = i | 0;
    const cols = this._cols;
    const n = this._cells.length;
    if (idx < 0 || idx >= n || !cols) return [];
    const x = idx % cols;
    const y = (idx / cols) | 0;
    const out = [];
    for (let d = 0; d < NEIGHBOR_DIRS.length; d++) {
      const nx = x + NEIGHBOR_DIRS[d][0];
      const ny = y + NEIGHBOR_DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= this._rows) continue;
      out.push(ny * cols + nx);
    }
    return out;
  }

}

export default LatisEngine;
