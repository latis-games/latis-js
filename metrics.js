/** Shared title metrics. Declare <latis-metric> and bind, or defineMetrics() for the old score-card. */

import { engine } from "./shaders.js";

export const DEFAULT_METRICS = [
  { id: "turn", label: "TURN", value: "X" },
  { id: "level", label: "LEVEL", value: "3×3" },
  { id: "timer", label: "TIMER", value: "0:00" },
  { id: "score", label: "SCORE", value: "0" },
  { id: "fps", label: "FPS", value: "—" },
];

const ALIAS = {
  turn: "status",
  status: "status",
  level: "level",
  timer: "timer",
  score: "score",
  high: "high",
  fps: "fps",
};

const VALUE_ID = {
  turn: "status",
  status: "status",
  level: "level",
  timer: "timer",
  score: "score",
  high: "high-score",
  fps: "fps",
};

const METRIC_TAGS = ["latis-metric"];

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function titleSlug(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/['\u2018\u2019\u201B]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function aliasId(id) {
  const key = String(id || "").toLowerCase();
  return ALIAS[key] || key;
}

function valueId(id) {
  const key = String(id || "").toLowerCase();
  return VALUE_ID[key] || "metric-" + key;
}

function defineTag(name) {
  if (typeof customElements === "undefined") return;
  if (!customElements.get(name)) {
    customElements.define(name, class extends HTMLElement {});
  }
}

export function defineMetricElements() {
  for (const tag of METRIC_TAGS) defineTag(tag);
}

function paintMetric(el, label, id) {
  el.setAttribute("title", label);
  if (!el.id) el.id = id;
  el.dataset.metric = id;
  el.classList.add("latis-metric");
  let lab = el.querySelector(":scope > .label");
  if (!lab) {
    lab = document.createElement("span");
    lab.className = "label";
    el.prepend(lab);
  }
  if (!lab.textContent) lab.textContent = label;
  let val = el.querySelector(":scope > .metric-value");
  if (!val) {
    val = document.createElement("span");
    val.className = "metric-value";
    el.appendChild(val);
  }
  if (!val.id && !document.getElementById(id)) val.id = id;
  return val;
}

function emptyList() {
  const list = [];
  engine.metrics = list;
  return list;
}

function record(list, id, label, value) {
  const rec = { id, label: String(label || id), value: value ?? "" };
  list.push(rec);
  Object.defineProperty(list, id, {
    value: rec,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  return rec;
}

function paintScoreCard() {
  if (typeof document === "undefined" || document.querySelector("latis-metric")) return;
  const card = document.getElementById("score-card");
  if (!card) return;
  const list = engine.metrics || [];
  const chips = list
    .map((m) => {
      const vid = valueId(m.id);
      const live = m.id === "status" || m.id === "turn" ? ' aria-live="polite"' : "";
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

function writeMetricDom(id, value) {
  if (typeof document === "undefined") return;
  const key = aliasId(id);
  let el = document.getElementById(key);
  if (!el || el.localName !== "latis-metric") {
    el = document.querySelector('latis-metric[data-metric="' + key + '"]');
  }
  if (el) {
    let val = el.querySelector(":scope > .metric-value");
    if (!val) val = paintMetric(el, el.getAttribute("title") || key, key);
    val.textContent = String(value);
    return;
  }
  const legacy = document.getElementById(valueId(key));
  if (legacy) legacy.textContent = String(value);
}

/** Scan <latis-metric title="Score"> in root (or document). */
export function bindMetrics(root) {
  defineMetricElements();
  if (typeof document === "undefined") return [];
  const scope = root && root.nodeType === 1 ? root : document;
  const nodes = Array.from(scope.querySelectorAll("latis-metric"));
  if (!nodes.length) return engine.metrics || [];
  const list = emptyList();
  for (const el of nodes) {
    const label = (el.getAttribute("title") || el.getAttribute("label") || el.textContent || "").trim() || "metric";
    const id = el.id || titleSlug(label);
    if (!id) continue;
    const text = paintMetric(el, label, id).textContent;
    const rec = record(list, id, label, text || "");
    if (id === "status" && !list.turn) {
      Object.defineProperty(list, "turn", {
        value: rec,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  }
  if (!list.fps) record(list, "fps", "Fps", "—");
  engine.metrics = list;
  return list;
}

/** Title defines the set. Layout can differ; the ids are shared. */
export function defineMetrics(defs) {
  if (typeof document !== "undefined" && document.querySelector("latis-metric")) {
    return bindMetrics(document.querySelector("latis-game") || document);
  }
  const src = Array.isArray(defs) && defs.length ? defs : DEFAULT_METRICS;
  const list = emptyList();
  for (const d of src) {
    const id = String((d && (d.id || d.key || (d.title && titleSlug(d.title)))) || "")
      .trim()
      .toLowerCase();
    if (!id) continue;
    record(list, id, d.label || d.title || id, d.value != null ? d.value : "");
  }
  if (!list.fps) record(list, "fps", "FPS", "—");
  if (list.status && !list.turn) {
    Object.defineProperty(list, "turn", {
      value: list.status,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  engine.metrics = list;
  paintScoreCard();
  return list;
}

export function setMetric(id, value) {
  const key = aliasId(id);
  let rec = engine.metrics && (engine.metrics[key] || engine.metrics[String(id || "").toLowerCase()]);
  if (!rec && engine.metrics) {
    if (key === "status") rec = engine.metrics.turn;
    if (!rec && String(id || "").toLowerCase() === "turn") rec = engine.metrics.status;
  }
  if (!rec) return null;
  rec.value = value;
  writeMetricDom(rec.id, value);
  return rec;
}

export function getMetric(id) {
  const key = aliasId(id);
  return (engine.metrics && (engine.metrics[key] || engine.metrics[String(id || "").toLowerCase()])) || null;
}

engine.metrics = [];
