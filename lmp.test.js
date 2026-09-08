import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const lmp = readFileSync(join(root, "lmp.css"), "utf8");
const chromeCss = readFileSync(join(root, "chrome.css"), "utf8");
const chromeJs = readFileSync(join(root, "chrome.js"), "utf8");
const engineCss = readFileSync(join(root, "engine.css"), "utf8");
const entry = readFileSync(join(root, "entry.js"), "utf8");

test("lmp.css is the player chrome source (TT glass pill tokens)", () => {
  assert.match(lmp, /--latis-music-glass/);
  assert.match(lmp, /--latis-music-border/);
  assert.match(lmp, /backdrop-filter:\s*blur/);
  assert.match(lmp, /latis-music/);
  assert.match(lmp, /\.lmp-art/);
  assert.match(lmp, /object-fit:\s*cover/);
  assert.match(lmp, /aspect-ratio:\s*1\s*\/\s*1/);
  assert.match(lmp, /\.lmp-times/);
  assert.match(lmp, /:hover \.lmp-times/);
  assert.match(lmp, /\.lmp-gain/);
  assert.match(lmp, /\.lmp-eq/);
  assert.match(lmp, /grid-template-areas:\s*"art title controls"/);
});

test("lmp.css hides seek times until hover and keeps EQ in the compact pill", () => {
  const times = lmp.indexOf(".lmp-times");
  const hover = lmp.indexOf(":hover .lmp-times");
  assert.ok(times >= 0 && hover > times);
  assert.match(lmp, /\.lmp-times\s*\{[^}]*opacity:\s*0/s);
  assert.match(lmp, /:hover \.lmp-times[^}]*opacity:\s*0\.7/s);
  assert.match(lmp, /@media \(width <= 900px\), \(orientation: portrait\)/);
  assert.match(lmp, /latis-layout-vertical latis-music \.lmp-eq/);
  assert.match(lmp, /grid-area:\s*title/);
});

test("chrome.js concatenates lmp.css after chrome.css", () => {
  assert.match(chromeJs, /import LMP_CSS from "\.\/lmp\.css"/);
  assert.match(chromeJs, /ENGINE_CSS \+ "\\n" \+ LMP_CSS/);
  assert.match(chromeJs, /export function mountChrome/);
  assert.match(chromeJs, /export \{ initRadio/);
});

test("overlay #radio no longer forces a tall cover column", () => {
  const overlay = chromeCss.slice(chromeCss.indexOf('html[data-host="overlay"] #radio {'));
  const block = overlay.slice(0, overlay.indexOf("html[data-host=\"overlay\"] #radio-prev"));
  assert.doesNotMatch(block, /flex-direction:\s*column/);
  assert.doesNotMatch(chromeCss, /#radio-cover \{[^}]*min-height:\s*120px/s);
});

test("legacy #radio cover stays square-fill; theme tokens remain overridable", () => {
  assert.match(chromeCss, /#radio-cover \{[^}]*object-fit:\s*cover/s);
  assert.match(chromeCss, /--latis-glass:/);
  assert.match(chromeCss, /--vol-fill:/);
});

test("engine.css is marked unused; entry still exports mountChrome/initRadio", () => {
  assert.match(engineCss, /UNUSED stale fork/);
  assert.match(entry, /mountChrome/);
  assert.match(entry, /initRadio/);
});
