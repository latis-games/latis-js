import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  slugify,
  songUrl,
  isSafariFamily,
  skipKind,
  deckReady,
  clamp01,
  wrapIndex,
  AUDIO_VIS_HIDE,
  logSpectrumBar,
  fillLogSpectrum,
} from "./player/lib.js";
import { playlistSongs, playlistMediaBase } from "./chrome-songs.js";
import playerApi, { mountPlayer } from "./player/index.js";
import { PLAYER_CSS } from "./player/css.js";

test("exports mountPlayer as named and default", () => {
  assert.equal(typeof mountPlayer, "function");
  assert.equal(playerApi.mountPlayer, mountPlayer);
  assert.deepEqual(Object.keys(playerApi), ["mountPlayer"]);
});

test("slugify is lowercase and strips punctuation", () => {
  assert.equal(slugify("Forever On The Grid"), "forever-on-the-grid");
  assert.equal(slugify("Watch 'Em Mash"), "watch-em-mash");
  assert.equal(slugify("Play in the sand"), "play-in-the-sand");
  assert.equal(slugify("Watch ’Em Mash"), "watch-em-mash");
});

test("songUrl is mediaBase + slug + .m4a only", () => {
  assert.equal(
    songUrl("/media/", "Forever On The Grid"),
    "/media/forever-on-the-grid.m4a",
  );
  assert.equal(
    songUrl("/media", "Watch 'Em Mash"),
    "/media/watch-em-mash.m4a",
  );
  assert.equal(
    songUrl("https://cdn.example/media/", "Play in the sand"),
    "https://cdn.example/media/play-in-the-sand.m4a",
  );
  assert.ok(!songUrl("/media/", "X").includes(".mp3"));
  assert.ok(!songUrl("/media/", "X").includes(".opus"));
  assert.ok(!songUrl("/media/", "X").includes(".ogg"));
});

test("skip while paused stays paused; playing crossfades if ready", () => {
  assert.equal(skipKind(false, true), "paused");
  assert.equal(skipKind(false, false), "paused");
  assert.equal(skipKind(true, true), "crossfade");
  assert.equal(skipKind(true, false), "fade");
});

test("Safari / iOS family skips Web Audio", () => {
  assert.equal(isSafariFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"), true);
  assert.equal(isSafariFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), true);
  assert.equal(isSafariFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1"), true);
  assert.equal(isSafariFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"), false);
  assert.equal(isSafariFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"), false);
  assert.equal(isSafariFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", { platform: "MacIntel", maxTouchPoints: 5 }), true);
});

test("deckReady requires matching src and HAVE_FUTURE_DATA", () => {
  const url = "/media/forever-on-the-grid.m4a";
  assert.equal(deckReady({ dataset: { lmpSrc: url }, readyState: 3, getAttribute: () => url }, url), true);
  assert.equal(deckReady({ dataset: { lmpSrc: url }, readyState: 1, getAttribute: () => url }, url), false);
  assert.equal(deckReady({ dataset: { lmpSrc: "/other.m4a" }, readyState: 4, getAttribute: () => "/other.m4a" }, url), false);
});

test("audio vis-hide is clip-rect, never display:none", () => {
  assert.match(AUDIO_VIS_HIDE, /clip:\s*rect/);
  assert.match(AUDIO_VIS_HIDE, /display\s*:\s*block/i);
  assert.doesNotMatch(AUDIO_VIS_HIDE, /display\s*:\s*none/i);
  const audioBlock = PLAYER_CSS.slice(PLAYER_CSS.indexOf("audio.lmp-audio"), PLAYER_CSS.indexOf(".lmp-eq-wrap"));
  assert.match(audioBlock, /display:\s*block\s*!important/);
  assert.doesNotMatch(audioBlock, /display:\s*none/);
});

test("player CSS bans backdrop-filter, blur, drop-shadow, will-change", () => {
  assert.doesNotMatch(PLAYER_CSS, /backdrop-filter/i);
  assert.doesNotMatch(PLAYER_CSS, /drop-shadow/i);
  assert.doesNotMatch(PLAYER_CSS, /will-change/i);
  assert.doesNotMatch(PLAYER_CSS, /(?<!text-)blur\s*\(/);
  assert.match(PLAYER_CSS, /text-shadow:\s*0 1px 2px #000,\s*0 0 6px #000,\s*0 0 14px rgba\(0,0,0,\.95\)/);
});

test("wrapIndex and clamp01", () => {
  assert.equal(wrapIndex(-1, 3), 2);
  assert.equal(wrapIndex(3, 3), 0);
  assert.equal(clamp01(1.5), 1);
  assert.equal(clamp01(-0.2), 0);
});

test("build.sh writes vnext engine and player, not engine.min.js", () => {
  const sh = readFileSync(new URL("./build.sh", import.meta.url), "utf8");
  assert.match(sh, /outfile=dist\/engine\.min-vnext\.js/);
  assert.match(sh, /outfile=dist\/latis-music-player\.min\.js/);
  assert.match(sh, /latis-music-player\.min\.js/);
  assert.doesNotMatch(sh, /outfile=dist\/engine\.min\.js/);
  assert.match(sh, /Access-Control-Allow-Origin: \*/);
});

test("player source has no store/lattice/games knowledge", () => {
  const src = readFileSync(new URL("./player/index.js", import.meta.url), "utf8")
    + readFileSync(new URL("./player/lib.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /lattice/i);
  assert.doesNotMatch(src, /latis\.games/i);
  assert.doesNotMatch(src, /createGame|initRadio|playlist\.json/);
});

test("log-spectrum maps low bins to bass and high bins to treble", () => {
  const bins = new Uint8Array(64);
  bins[1] = 255;
  bins[60] = 255;
  assert.ok(logSpectrumBar(bins, 0, 8) > 0.2);
  assert.ok(logSpectrumBar(bins, 7, 8) > 0);
  assert.ok(logSpectrumBar(bins, 3, 8) < 0.05);
  const treble = new Uint8Array(64);
  for (let i = 48; i < 64; i++) treble[i] = 255;
  assert.ok(logSpectrumBar(treble, 7, 8) > 0.4);
  assert.ok(logSpectrumBar(treble, 0, 8) < 0.05);
  const out = new Float32Array(8);
  fillLogSpectrum(bins, out);
  assert.ok(out[0] > 0);
  assert.ok(out[7] > 0);
});

test("chrome playlist is song title strings + mediaBase", () => {
  assert.deepEqual(
    playlistSongs({ songs: ["Forever On The Grid", "Watch 'Em Mash"] }, {}),
    ["Forever On The Grid", "Watch 'Em Mash"],
  );
  assert.deepEqual(
    playlistSongs({ playlist: ["Play in the sand", { title: "Watch 'Em Mash" }] }, {}),
    ["Play in the sand", "Watch 'Em Mash"],
  );
  assert.equal(playlistMediaBase({}, {}), "/media/");
  assert.equal(playlistMediaBase({ mediaBase: "https://cdn.example/media/" }, {}), "https://cdn.example/media/");
});

test("chrome vnext mounts player into empty #radio; initRadio unused", () => {
  const chrome = readFileSync(new URL("./chrome.js", import.meta.url), "utf8");
  const host = readFileSync(new URL("./host.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("./chrome.css", import.meta.url), "utf8");
  assert.match(chrome, /from "\.\/player\/index\.js"/);
  assert.match(chrome, /mountPlayer\(radioEl/);
  assert.match(chrome, /id="radio"/);
  assert.doesNotMatch(chrome, /id="radio-cover"/);
  assert.doesNotMatch(chrome, /initRadio\(/);
  assert.doesNotMatch(host, /initRadio/);
  assert.match(css, /min-height:\s*52px/);
  assert.match(css, /html\[data-host="overlay"\] #radio \{[\s\S]*?min-height:\s*200px/);
});

test("clamp helpers stay finite", () => {
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01("nope"), 0);
});
