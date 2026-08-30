/** Engine-owned host chrome. Titles supply a skin; they do not build radio/score/layout. */

import { initRadio } from "./radio.js";
import { loadShaders, setPalette } from "./shaders.js";
import { defineMetrics, setMetric } from "./metrics.js";
import ENGINE_CSS from "./chrome.css";

const AUDIO_ID = "latis-bgm";

function radioMarkup() {
  return `
      <aside id="radio" class="glass-panel" aria-label="Now playing">
        <img id="radio-cover" src="./assets/covers/00.png" width="400" height="400" alt="" />
        <div id="radio-meta">
          <div id="radio-eq-wrap" aria-hidden="true">
            <canvas id="radio-eq" width="280" height="48"></canvas>
          </div>
          <p id="radio-title"></p>
          <div id="radio-vol-wrap">
            <input id="radio-vol" type="range" min="0" max="100" value="55" step="1" aria-label="Volume" />
            <span id="radio-vol-pct" hidden>55%</span>
          </div>
        </div>
        <div id="radio-controls">
          <button id="radio-prev" type="button" aria-label="Previous track">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2.2v14H6V5zm3.4 7 8.6 6.2V5.8L9.4 12z"/></svg>
          </button>
          <button id="radio-play" type="button" aria-label="Play">
            <svg class="icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5L8 5.5z"/></svg>
            <svg class="icon-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.4v14H7V5zm6.6 0H17v14h-3.4V5z"/></svg>
          </button>
          <button id="radio-next" type="button" aria-label="Next track">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.8 5H18v14h-2.2V5zM6 18.2V5.8L14.6 12 6 18.2z"/></svg>
          </button>
          <button id="radio-mute" type="button" aria-pressed="false" aria-label="Mute">
            <svg class="icon-speaker" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.8v12.4L7.2 14.5H4V9.5zm11.1 1.1a3.2 3.2 0 0 1 0 2.8l-1.3-.7a1.7 1.7 0 0 0 0-1.4l1.3-.7zm1.9-2.3a6.2 6.2 0 0 1 0 7.4l-1.3-.8a4.7 4.7 0 0 0 0-5.8l1.3-.8z"/></svg>
            <svg class="icon-speaker-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.8v12.4L7.2 14.5H4V9.5zm15.7-3.2 1.4 1.4-3.2 3.2 3.2 3.2-1.4 1.4-3.2-3.2-3.2 3.2-1.4-1.4 3.2-3.2-3.2-3.2 1.4-1.4 3.2 3.2 3.2-3.2z"/></svg>
          </button>
        </div>
      </aside>`;
}

function treeMarkup(skin) {
  const s = skin || {};
  const name = s.name || "";
  const tagline = s.tagline || "";
  const word = s.wordmarkUrl || s.wordmark || "";
  return `
    <header>
      <h1>${name}</h1>
      <p class="sub">${tagline}</p>
    </header>
    <div id="play-row">
      <p id="move-chip" aria-hidden="true"></p>
      <aside id="chrome">
        <div id="chrome-title">
          <img id="wordmark" src="" width="686" height="526" alt="" />
        </div>
        <aside id="score-card" aria-label="Game status"></aside>
      </aside>
      <div id="stage">
        <div id="bg-mount"></div>
        <div id="mount"></div>
        <div id="edge-fade" aria-hidden="true"></div>
        <div id="hit" aria-label="Board"></div>
      </div>
      <aside id="dock">
        ${radioMarkup()}
        <div id="legal">
          <p id="copy">©2026</p>
          <a id="ionic-mark" href="https://ionic.games" target="_blank" rel="noopener noreferrer">
            <img src="./assets/ionic-games.png" width="1200" height="296" alt="ionic.games" />
          </a>
        </div>
      </aside>
    </div>`;
}

function ensureAudio() {
  let el = document.getElementById(AUDIO_ID) || document.getElementById("triki-bgm");
  if (el) return el;
  el = document.createElement("audio");
  el.id = AUDIO_ID;
  el.setAttribute("preload", "auto");
  el.setAttribute("playsinline", "");
  el.setAttribute("webkit-playsinline", "");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none";
  document.body.prepend(el);
  return el;
}

function ensurePreloads(_playlist) {
  /* Visuals preload in main.js. Music warms after the game is up. */
}

/** After createGame. Radio fetches the current track on play, then the next near the end. */
export function prefetchPlaylistAudio(playlist) {
  const audio = document.getElementById("latis-bgm") || document.getElementById("triki-bgm");
  if (!audio) return;
  audio.preload = "auto";
  const t = playlist && playlist[0];
  const src = t && (t.mp3 || t.src || t.opus);
  if (!src) return;
  try {
    fetch(new URL(src, location.href).href, { cache: "force-cache", credentials: "same-origin" }).catch(function () {});
  } catch {
    /* ignore */
  }
}

export function chromeEls() {
  return {
    app: document.getElementById("app"),
    mountEl: document.getElementById("mount"),
    bgEl: document.getElementById("bg-mount"),
    hitEl: document.getElementById("hit"),
    statusEl: document.getElementById("status"),
    hintEl: document.getElementById("hint"),
    radioEl: document.getElementById("radio"),
    coverEl: document.getElementById("radio-cover"),
    scoreEl: document.getElementById("score"),
    highEl: document.getElementById("high-score"),
    timerEl: document.getElementById("timer"),
    levelEl: document.getElementById("level"),
  };
}

function injectEngineCss() {
  if (typeof document === "undefined") return;
  if (document.getElementById("latis-engine-css")) return;
  const style = document.createElement("style");
  style.id = "latis-engine-css";
  style.textContent = ENGINE_CSS;
  document.head.appendChild(style);
}

export function mountChrome(skin) {
  injectEngineCss();
  let app = document.getElementById("app");
  if (!app) {
    app = document.createElement("div");
    app.id = "app";
    document.body.appendChild(app);
  }
  if (!document.getElementById("play-row")) {
    app.insertAdjacentHTML("afterbegin", treeMarkup(skin));
  }
  ensureAudio();
  if (!document.documentElement.dataset.host) {
    document.documentElement.dataset.host = "overlay";
  }
  return chromeEls();
}

export function applyChrome(skin, settings, mode) {
  mountChrome(skin);
  const s = skin || {};
  const g = settings || {};
  const hostMode = mode || s.host || g.host || "board";
  // scene uses the same floating-chrome layout as overlay
  document.documentElement.dataset.host = hostMode === "board" ? "board" : "overlay";
  document.documentElement.dataset.paint = (s && s.paint) || hostMode;

  const name = s.name || g.name || "Latis";
  const tagline = s.tagline || g.tagline || "";
  const word = document.getElementById("wordmark");
  if (word) {
    const src = s.wordmarkUrl || s.wordmark;
    if (src) word.src = src;
    word.alt = name;
  }
  const headerH1 = document.querySelector("header h1");
  if (headerH1) headerH1.textContent = name;
  const headerSub = document.querySelector("header .sub");
  if (headerSub) headerSub.textContent = tagline;
  document.title = tagline ? name + " — " + tagline : name;

  const accent = s.accent || g.accent;
  if (accent && typeof accent === "object") {
    const root = document.documentElement;
    if (accent.cyan) root.style.setProperty("--cyan", accent.cyan);
    if (accent.ink) root.style.setProperty("--ink", accent.ink);
    if (accent.hot) root.style.setProperty("--cyan-hot", accent.hot);
    if (accent.fill) root.style.setProperty("--hud-fill", accent.fill);
  }
  const palette = s.palette || g.palette;
  if (Array.isArray(palette) && palette.length) setPalette(palette);
  defineMetrics(s.metrics || g.metrics);

  const playlist = s.playlist || g.playlist || [];
  ensurePreloads(playlist);
  ensureAudio();
  const cover = document.getElementById("radio-cover");
  if (cover && playlist[0] && playlist[0].cover) {
    cover.src = playlist[0].cover;
    cover.alt = playlist[0].title || "";
  }
  loadShaders((s && s.shadersDir) || "./shaders");
  return { host: document.documentElement.dataset.host, playlist, els: chromeEls() };
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
}

export function setScoreHud(score, high) {
  const s = String(Math.max(0, score | 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const h = String(Math.max(0, high | 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  setMetric("score", s);
  setMetric("high", h);
  const el = document.getElementById("high-score");
  if (el) el.textContent = h;
}

export function setTimerHud(seconds) {
  setMetric("timer", formatTime(seconds));
}

export function setLevelHud(label) {
  setMetric("level", String(label || ""));
}

export { initRadio, defineMetrics, setMetric };
