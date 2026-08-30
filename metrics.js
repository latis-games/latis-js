/** Shared title metrics. Array plus named keys: engine.metrics["turn"].value */
import { engine } from "./shaders.js";

export const DEFAULT_METRICS = [
  { id: "turn", label: "TURN", value: "X" },
  { id: "level", label: "LEVEL", value: "3×3" },
  { id: "timer", label: "TIMER", value: "0:00" },
  { id: "score", label: "SCORE", value: "0" },
  { id: "fps", label: "FPS", value: "—" },
];

const VALUE_ID = {
  turn: "status",
  level: "level",
  timer: "timer",
  score: "score",
  high: "high-score",
  fps: "fps",
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function valueId(id) {
  return VALUE_ID[id] || "metric-" + id;
}

function paintMetrics() {
  if (typeof document === "undefined") return;
  const card = document.getElementById("score-card");
  if (!card) return;
  const list = engine.metrics || [];
  const chips = list
    .map((m) => {
      const vid = valueId(m.id);
      const live = m.id === "turn" ? ' aria-live="polite"' : "";
      return (
        '<div class="stat glass-panel" data-metric="' +
        esc(m.id) +
        '">' +
        '<span class="label">' +
        esc(m.label) +
        "</span>" +
        '<span class="metric-value" id="' +
        esc(vid) +
        '"' +
        live +
        ">" +
        esc(m.value) +
        "</span></div>"
      );
    })
    .join("");
  card.innerHTML =
    chips +
    '<span id="turn-mark" aria-hidden="true"></span>' +
    '<p id="hint"></p>' +
    (list.high ? "" : '<span id="high-score" hidden>0</span>');
}

function emptyList() {
  const list = [];
  engine.metrics = list;
  return list;
}

/** Title defines the set. Layout can differ; the ids are shared. */
export function defineMetrics(defs) {
  const src = Array.isArray(defs) && defs.length ? defs : DEFAULT_METRICS;
  const list = emptyList();
  for (const d of src) {
    const id = String((d && (d.id || d.key)) || "")
      .trim()
      .toLowerCase();
    if (!id) continue;
    const rec = {
      id,
      label: String(d.label || id),
      value: d.value != null ? d.value : "",
    };
    list.push(rec);
    Object.defineProperty(list, id, {
      value: rec,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  if (!list.fps) {
    const rec = { id: "fps", label: "FPS", value: "—" };
    list.push(rec);
    Object.defineProperty(list, "fps", {
      value: rec,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  engine.metrics = list;
  paintMetrics();
  return list;
}

export function setMetric(id, value) {
  const key = String(id || "").toLowerCase();
  const rec = engine.metrics && engine.metrics[key];
  if (!rec) return null;
  rec.value = value;
  if (typeof document !== "undefined") {
    const el = document.getElementById(valueId(key));
    if (el) el.textContent = String(value);
  }
  return rec;
}

export function getMetric(id) {
  const key = String(id || "").toLowerCase();
  return (engine.metrics && engine.metrics[key]) || null;
}

engine.metrics = [];
