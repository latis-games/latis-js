# Latis engine (JS)

Public Cloudflare Pages ES module. Titles import `createGame` from this origin. No title skin, no Three.js, no game assets.

Build: `./build.sh` → `dist/engine.min-vnext.js` (staging). `engine.min.js` is the stable pin — do not overwrite it unless promoting. Engine CSS is inlined via `import ENGINE_CSS from "./chrome.css"` + esbuild `--loader:.css=text`.

## Boot
- `createGame` — grid + chrome + radio + camera + input. Overlay island water via `startRenderer`. Tropical Triki still uses this (draw X/O, grow board). Titles own piece types and game rules.

## Packs
- `packs/scene.js` — minimal 3D (no Three): scene graph, camera, mesh, lights, raycast, tiny GLB loader.

No chess / checkers / match-3 / falling-piece packs. Those live in titles.

## Meshes / meshopt.js
`loadMesh(url | ArrayBuffer | Uint8Array, options?)` decodes **meshopt-compressed** meshes. It is exported from the engine bundle (`engine.loadMesh`). Returns TypedArrays plus count/stride metadata for GL upload:

```js
{
  positions,          // Float32Array or Int16Array
  colors,             // rgb/rgba TypedArray, or null
  indices,            // Uint16Array / Uint32Array, or null
  count,              // vertex count
  stride,             // position components (2 = xy soup, 3 = xyz)
  positionStride,     // same as stride
  colorStride,        // 0, 3 (rgb), or 4 (rgba)
  indexCount,
  format,             // "meshopt"
}
```

Enough for Slice Time beach soup (xy + rgb) and later GLB-ish meshes.

**Codec module.** `meshopt.js` is a stripped meshoptimizer reference decoder (`decodeVertexBuffer` + `decodeIndexBuffer` only; MIT, Arseny Kapoulkine / Jasper St. Pierre). esbuild folds it into `dist/engine.min-vnext.js`. There is no engine-wasm package, no second decoder URL, and no WASM/SIMD pair. More codecs can join later as sibling modules. Keep `latis-loader.min.js` free of meshopt — the store/loader does not need mesh decode.

Raw meshopt buffers: pass `options.vertexCount` + `options.stride` (or `options.streams` for positions/colors/indices). Optional **LTMS** packed container (magic `LTMS`, v1) wraps several streams in one buffer — header documented in `mesh.js`.

Raw `.bin` int16 soup stays a title-side `fetch` + `Int16Array`. Do not route those through `loadMesh`, and do not overload image-plate `loadAsset` for meshes.

## Camera / input
Shared zoom + pan + rot on `window.__latisCamera`. Two-finger trackpad + Safari pinch + mobile pinch zoom; WASD/arrows pan with A/D inverted vs the old mapping; Q/E rotate the cay; no mouse/trackpad pan. `u_pan` / `u_rot` are in WebGL + WGSL. Host UV and the hit grid use the same mapping so strokes stay on the carved board.

Paint modes (`skin.paint`): `"overlay"` (island water, default), `"board"` (clear + `skin.draw`), `"scene"`.
