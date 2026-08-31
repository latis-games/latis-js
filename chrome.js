/** Engine-owned host chrome. Titles supply a skin; they do not build radio/score/layout. */

import { initRadio } from "./radio.js";
import { mountPlayer } from "./player/index.js";
import { songUrl } from "./player/lib.js";
import { playlistSongs, playlistMediaBase } from "./chrome-songs.js";
import { loadShaders, setPalette } from "./shaders.js";
import { defineMetrics, setMetric } from "./metrics.js";
import ENGINE_CSS from "./chrome.css";

function radioMarkup() {
  return `<aside id="radio" class="glass-panel" aria-label="Now playing"></aside>`;
}

function treeMarkup(skin) {
  const s = skin || {};
  const name = s.name || "";
  const tagline = s.tagline || "";
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

export { playlistSongs, playlistMediaBase } from "./chrome-songs.js";

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
  if (!document.documentElement.dataset.host) {
    document.documentElement.dataset.host = "overlay";
  }
  return chromeEls();
}

/** After createGame. Warms the first AAC-LC slug.m4a. */
export function prefetchPlaylistAudio(playlist, mediaBase) {
  const songs = playlistSongs({ playlist: Array.isArray(playlist) ? playlist : [] });
  const url = songUrl(mediaBase || "/media/", songs[0] || "");
  if (!url) return;
  try {
    fetch(new URL(url, location.href).href, { cache: "force-cache", credentials: "same-origin" }).catch(function () {});
  } catch {
    /* ignore */
  }
}

export async function applyChrome(skin, settings, mode) {
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

  const songs = playlistSongs(s, g);
  const mediaBase = playlistMediaBase(s, g);
  const radioEl = document.getElementById("radio");
  let player = null;
  if (radioEl) {
    player = await mountPlayer(radioEl, { mediaBase, songs });
    window.__latisRadio = player;
  }
  prefetchPlaylistAudio(songs, mediaBase);
  loadShaders((s && s.shadersDir) || "./shaders");
  return {
    host: document.documentElement.dataset.host,
    playlist: songs,
    songs,
    mediaBase,
    player,
    els: chromeEls(),
  };
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

export { initRadio, mountPlayer, defineMetrics, setMetric };
