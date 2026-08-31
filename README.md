# Latis engine (JS)

Public Cloudflare Pages ES module. Titles import `createGame` from this origin. No title skin, no Three.js, no game assets.

Build: `./build.sh` → `dist/engine.min-vnext.js` (does not overwrite the stable CDN pin `dist/engine.min.js`) and `dist/latis-music-player.min.js`. Engine CSS is inlined via `import ENGINE_CSS from "./chrome.css"` + esbuild `--loader:.css=text`.

## Boot
- `createGame` — grid + chrome + radio + camera + input. Overlay island water via `startRenderer`. Tropical Triki still uses this (draw X/O, grow board). Titles own piece types and game rules.

## Packs
- `packs/scene.js` — minimal 3D (no Three): scene graph, camera, mesh, lights, raycast, tiny GLB loader.

No chess / checkers / match-3 / falling-piece packs. Those live in titles.

## Music player

Standalone public ES module. Not bundled into the engine. No game/store/lattice knowledge.

```js
import { mountPlayer } from "https://example.pages.dev/latis-music-player.min.js";

await mountPlayer(rootEl, {
  mediaBase: "/media/",
  songs: ["Forever On The Grid", "Watch 'Em Mash", "Play in the sand"],
});
```

Tracks are AAC-LC `.m4a` only. Title → lowercase slug + `.m4a` (no JSON playlist, no opus, no mp3).

## Camera / input
Shared zoom + pan + rot on `window.__latisCamera`. Two-finger trackpad + Safari pinch + mobile pinch zoom; WASD/arrows pan with A/D inverted vs the old mapping; Q/E rotate the cay; no mouse/trackpad pan. `u_pan` / `u_rot` are in WebGL + WGSL. Host UV and the hit grid use the same mapping so strokes stay on the carved board.

Paint modes (`skin.paint`): `"overlay"` (island water, default), `"board"` (clear + `skin.draw`), `"scene"`.
