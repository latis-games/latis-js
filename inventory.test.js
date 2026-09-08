import { test } from "node:test";
import assert from "node:assert/strict";
import { engine } from "./shaders.js";
import {
  bindInventory,
  setSlot,
  clearSlot,
  getSlot,
  selectSlot,
  getSelectedSlot,
  trayShape,
  defineInventoryElements,
} from "./inventory.js";

function attrEl(attrs) {
  return { getAttribute: (k) => (attrs[k] != null ? String(attrs[k]) : null) };
}

test("trayShape defaults to 2x2 for Neon Poly", () => {
  assert.deepEqual(trayShape(attrEl({})), { cols: 2, rows: 2, n: 4 });
  assert.deepEqual(trayShape(attrEl({ slots: 4 })), { cols: 2, rows: 2, n: 4 });
  assert.deepEqual(trayShape(attrEl({ cols: 2, rows: 2 })), { cols: 2, rows: 2, n: 4 });
  assert.deepEqual(trayShape(attrEl({ cols: 4, rows: 1 })), { cols: 4, rows: 1, n: 4 });
  assert.deepEqual(trayShape(attrEl({ slots: 6 })), { cols: 6, rows: 1, n: 6 });
});

test("bindInventory is a no-op without document", () => {
  const list = bindInventory();
  assert.ok(Array.isArray(list));
  assert.equal(setSlot(0, "<i>x</i>"), null);
  assert.equal(clearSlot(0), null);
  assert.equal(getSlot(0), null);
  assert.equal(selectSlot(0), null);
  assert.equal(getSelectedSlot(), null);
  defineInventoryElements();
});

test("engine.inventory is an array", () => {
  assert.ok(Array.isArray(engine.inventory));
});

test("layout.js TAGS and bindLayout wire inventory", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./layout.js", import.meta.url), "utf8");
  assert.match(src, /"latis-inventory"/);
  assert.match(src, /bindInventory/);
  assert.match(src, /export const TAGS/);
});

test("entry and chrome export bindInventory and bindLayout", async () => {
  const { readFileSync } = await import("node:fs");
  const entry = readFileSync(new URL("./entry.js", import.meta.url), "utf8");
  const chrome = readFileSync(new URL("./chrome.js", import.meta.url), "utf8");
  assert.match(entry, /bindInventory/);
  assert.match(entry, /bindLayout/);
  assert.match(entry, /setSlot/);
  assert.match(chrome, /bindLayout/);
  assert.match(chrome, /bindInventory/);
});
