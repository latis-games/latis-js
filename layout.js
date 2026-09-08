/** Declarative <latis-game> shell. Light DOM custom elements; bindLayout wires chrome. */

import { bindMetrics, defineMetricElements } from "./metrics.js";
import { bindInventory, defineInventoryElements } from "./inventory.js";
import LAYOUT_CSS from "./layout.css";
import METRICS_CSS from "./metrics.css";
import INVENTORY_CSS from "./inventory.css";

export const WIDE_ASPECT = 1.2;

export const TAGS = [
  "latis-game",
  "latis-layout",
  "latis-layout-horizontal",
  "latis-layout-vertical",
  "latis-background",
  "latis-world",
  "latis-play",
  "latis-board",
  "latis-pre",
  "latis-post",
  "latis-logo",
  "latis-music",
  "latis-studio",
  "latis-score",
  "latis-inventory",
];

const SHELL_CSS = LAYOUT_CSS + "\n" + METRICS_CSS + "\n" + INVENTORY_CSS;

function defineTag(name) {
  if (typeof customElements === "undefined") return;
  if (!customElements.get(name)) {
    customElements.define(name, class extends HTMLElement {});
  }
}

export function defineLayoutElements() {
  for (const tag of TAGS) defineTag(tag);
  defineMetricElements();
  defineInventoryElements();
}

function injectLayoutCss() {
  if (typeof document === "undefined") return;
  if (document.getElementById("latis-layout-css")) return;
  const style = document.createElement("style");
  style.id = "latis-layout-css";
  style.textContent = SHELL_CSS;
  document.head.appendChild(style);
}

function boxOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function fillNode(el, content) {
  if (!el) return null;
  el.querySelectorAll(".latis-placeholder, .play-placeholder").forEach((n) => n.remove());
  if (content == null) return el;
  if (typeof content === "string") {
    el.insertAdjacentHTML("beforeend", content);
    return el;
  }
  if (content.nodeType === 1 || content.nodeType === 11) {
    if (content === el || (content.nodeType === 1 && content.contains(el)) || content.parentElement === el) return el;
    el.appendChild(content);
  }
  return el;
}

function appendAll(parent, nodes) {
  if (!parent || !nodes || !nodes.length) return;
  const frag = document.createDocumentFragment();
  for (const n of nodes) {
    if (!n || n === parent) continue;
    if (n.nodeType === 1 && typeof n.contains === "function" && n.contains(parent)) continue;
    frag.appendChild(n);
  }
  if (frag.childNodes.length) parent.appendChild(frag);
}

function resolveGame(root) {
  if (root == null) throw new Error("bindLayout: root is required (latis-game element or selector)");
  let el = null;
  if (typeof root === "string") el = document.querySelector(root);
  else if (root && root.nodeType === 1) el = root;
  if (!el) throw new Error('bindLayout: root not found — HTML must provide <latis-game id="latis-game">');
  if (el.localName !== "latis-game") throw new Error(`bindLayout: root must be <latis-game>, got <${el.localName}>`);
  return el;
}

export function bindLayout(opts = {}) {
  defineLayoutElements();
  injectLayoutCss();

  const wideAspect = Number(opts.wideAspect) > 0 ? Number(opts.wideAspect) : WIDE_ASPECT;
  const host = resolveGame(opts.root);
  const layout = host.querySelector(":scope > latis-layout") || host.querySelector(":scope > latis-layout-horizontal");
  if (!layout) throw new Error("bindLayout: <latis-game> must contain <latis-layout> (or <latis-layout-horizontal>)");

  let layoutVertical = host.querySelector(":scope > latis-layout-vertical");
  let authoredVertical = false;
  if (layoutVertical) {
    authoredVertical = !!(
      layoutVertical.querySelector(":scope > latis-background, :scope > latis-pre, :scope > latis-play, :scope > latis-post")
    );
  } else {
    layoutVertical = document.createElement("latis-layout-vertical");
    layoutVertical.hidden = true;
    host.appendChild(layoutVertical);
  }

  const pick = (sel) => layout.querySelector(sel) || layoutVertical.querySelector(sel);
  const background = pick("latis-background");
  const pre = pick("latis-pre");
  const play = pick("latis-play");
  const post = pick("latis-post");
  if (!background || !pre || !play || !post) {
    throw new Error("bindLayout: shell needs latis-background, latis-pre, latis-play, latis-post");
  }

  const world = background.querySelector("latis-world") || background;
  const logo = pre.querySelector("latis-logo");
  const music = pre.querySelector("latis-music");
  const studio = pre.querySelector("latis-studio") || layout.querySelector("latis-studio") || layoutVertical.querySelector("latis-studio");
  const score = post.querySelector("latis-score");
  const board = play.querySelector("latis-board") || play;
  const metrics = Array.from(post.querySelectorAll(":scope > latis-metric"));
  const inventory =
    post.querySelector("latis-inventory") ||
    layout.querySelector("latis-inventory") ||
    layoutVertical.querySelector("latis-inventory");

  bindMetrics(host);
  bindInventory(host);

  if (opts.backgroundPointerEvents) background.style.pointerEvents = "auto";

  let playRect = boxOf(play);
  let backgroundRect = boxOf(background);
  let mode = "horizontal";
  let aspect = wideAspect;
  const listeners = new Set();
  if (typeof opts.onResize === "function") listeners.add(opts.onResize);

  function applyOrientation(next) {
    const show = next === "vertical" ? layoutVertical : layout;
    const hide = next === "vertical" ? layout : layoutVertical;
    if (!authoredVertical) {
      if (next === "vertical") {
        const nodes = [background, pre, play, post];
        if (inventory) nodes.push(inventory);
        if (studio) nodes.push(studio);
        appendAll(show, nodes);
      } else {
        if (inventory && post && inventory !== post && !(inventory.contains && inventory.contains(post)) && inventory.parentElement !== post) {
          post.appendChild(inventory);
        }
        if (studio && studio !== pre && !(studio.contains && studio.contains(pre)) && studio.parentElement !== pre) {
          pre.appendChild(studio);
        }
        appendAll(show, [background, pre, play, post]);
      }
    }
    hide.hidden = true;
    show.hidden = false;
    mode = next === "vertical" ? "vertical" : "horizontal";
    host.dataset.layout = mode;
  }

  let raf = 0;
  function measure() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w >= 2 && h >= 2) {
      const next = w / h >= aspect ? "horizontal" : "vertical";
      if (mode !== next || (next === "horizontal" ? layout.hidden : layoutVertical.hidden)) applyOrientation(next);
    }
    playRect = boxOf(play);
    backgroundRect = boxOf(background);
    const info = { playRect: { ...playRect }, backgroundRect: { ...backgroundRect }, layout: mode };
    for (const fn of listeners) {
      try {
        fn(info);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      measure();
    });
  }

  applyOrientation(host.clientWidth / Math.max(host.clientHeight, 1) >= aspect ? "horizontal" : "vertical");

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
  if (ro) {
    ro.observe(host);
    ro.observe(play);
    ro.observe(background);
  } else if (typeof window !== "undefined") {
    window.addEventListener("resize", schedule);
  }
  schedule();

  return {
    root: host,
    host,
    layout,
    layoutVertical,
    horizontal: layout,
    vertical: layoutVertical,
    background,
    mainBackground: background,
    pre,
    main: play,
    play,
    board,
    post,
    prePanel: pre,
    mainPanel: play,
    mainArea: play,
    postPanel: post,
    logo,
    music,
    studio,
    score,
    metrics,
    inventory,
    stage: board,
    backgroundStage: world,
    getPlayRect() {
      return { ...playRect };
    },
    getBackgroundRect() {
      return { ...backgroundRect };
    },
    getLayout() {
      return mode;
    },
    setWideAspect(v) {
      if (Number(v) > 0) {
        aspect = Number(v);
        schedule();
      }
    },
    setBackgroundPointerEvents(on) {
      background.style.pointerEvents = on ? "auto" : "none";
    },
    fillLogo(content) {
      return fillNode(logo, content);
    },
    fillMusic(content) {
      return fillNode(music, content);
    },
    fillStudio(content) {
      return fillNode(studio, content);
    },
    fillScore(content) {
      return metrics.length ? post : fillNode(score || post, content);
    },
    setTheme(vars = {}) {
      for (const [k, v] of Object.entries(vars)) {
        if (v == null) continue;
        const name = k.startsWith("--") ? k : `--latis-${k}`;
        host.style.setProperty(name, String(v));
      }
    },
    onResize(fn) {
      if (typeof fn === "function") listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy() {
      if (ro) ro.disconnect();
      else if (typeof window !== "undefined") window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
      listeners.clear();
    },
  };
}

export function createLayout(opts = {}) {
  return bindLayout(opts);
}
