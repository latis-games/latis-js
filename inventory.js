/** Declarative <latis-inventory> — slots, select, drag-out. Board drop is title-owned. */

import { engine } from "./shaders.js";

const INVENTORY_TAGS = ["latis-inventory", "latis-slot"];
const SLOT_SEL = ":scope > latis-slot, :scope > .latis-slot";
const DRAG_PX = 4;

function defineTag(name) {
  if (typeof customElements === "undefined") return;
  if (!customElements.get(name)) {
    customElements.define(name, class extends HTMLElement {});
  }
}

export function defineInventoryElements() {
  for (const tag of INVENTORY_TAGS) defineTag(tag);
}

function emptyList() {
  const list = [];
  engine.inventory = list;
  return list;
}

function record(list, key, rec) {
  if (key == null || key === "") return rec;
  Object.defineProperty(list, key, {
    value: rec,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  return rec;
}

function intAttr(el, name, fallback) {
  const n = parseInt(el.getAttribute(name), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function trayShape(el) {
  const cols = intAttr(el, "cols", 0);
  const rows = intAttr(el, "rows", 0);
  if (cols && rows) return { cols, rows, n: cols * rows };
  const slots = intAttr(el, "slots", 4);
  if (slots === 4) return { cols: 2, rows: 2, n: 4 };
  return { cols: slots, rows: 1, n: slots };
}

function applyShape(el, shape) {
  el.style.setProperty("--latis-inventory-cols", String(shape.cols));
  el.style.setProperty("--latis-inventory-rows", String(shape.rows));
  el.style.setProperty("--latis-inventory-count", String(shape.n));
}

function ensureLabel(el, title) {
  let lab = el.querySelector(":scope > .label");
  if (!lab) {
    lab = document.createElement("span");
    lab.className = "label";
    el.prepend(lab);
  }
  if (!lab.textContent) lab.textContent = title;
  return lab;
}

function ensureBody(slot) {
  let body = slot.querySelector(":scope > .latis-slot-body");
  if (!body) {
    body = document.createElement("span");
    body.className = "latis-slot-body";
    slot.appendChild(body);
  }
  return body;
}

function slotNodes(tray) {
  return Array.from(tray.querySelectorAll(SLOT_SEL));
}

function readSlotValue(slot) {
  const body = slot.querySelector(":scope > .latis-slot-body");
  if (body) {
    const html = String(body.innerHTML || "").trim();
    const text = String(body.textContent || "").trim();
    if (html || text) return { html: body.innerHTML, text: body.textContent };
    return null;
  }
  const leftover = Array.from(slot.childNodes).filter(
    (n) => !(n.nodeType === 1 && n.classList && (n.classList.contains("label") || n.classList.contains("latis-slot-body")))
  );
  if (!leftover.length) return null;
  return { html: slot.innerHTML, text: slot.textContent };
}

function writeSlotValue(slot, value) {
  const body = ensureBody(slot);
  body.replaceChildren();
  if (value == null || value === "") {
    slot.classList.add("is-empty");
    slot.setAttribute("aria-label", slot.dataset.slotLabel || "Empty inventory slot");
    return null;
  }
  if (typeof value === "string") {
    body.innerHTML = value;
  } else if (value.nodeType === 1 || value.nodeType === 11) {
    body.appendChild(value);
  } else if (typeof value === "object") {
    if (value.node) body.appendChild(value.node);
    else if (value.html != null) body.innerHTML = String(value.html);
    else if (value.text != null) body.textContent = String(value.text);
    if (value.label) slot.setAttribute("aria-label", String(value.label));
  }
  const empty = !body.childNodes.length && !String(body.textContent || "").trim();
  slot.classList.toggle("is-empty", empty);
  return { html: body.innerHTML, text: body.textContent };
}

function paintSlot(slot, index, trayId) {
  slot.classList.add("latis-slot", "latis-glass");
  slot.dataset.slot = String(index);
  if (!slot.id) slot.id = (trayId ? trayId + "-" : "") + "slot-" + index;
  if (!slot.getAttribute("role")) slot.setAttribute("role", "option");
  if (slot.getAttribute("tabindex") == null) slot.setAttribute("tabindex", "0");
  if (!slot.getAttribute("aria-selected")) slot.setAttribute("aria-selected", "false");
  ensureBody(slot);
  const has = !!(slot.querySelector(":scope > .latis-slot-body") && slot.querySelector(":scope > .latis-slot-body").childNodes.length);
  slot.classList.toggle("is-empty", !has && !String(slot.textContent || "").trim());
  return slot;
}

function ensureSlots(tray) {
  const shape = trayShape(tray);
  applyShape(tray, shape);
  let slots = slotNodes(tray);
  while (slots.length < shape.n) {
    const s = document.createElement("latis-slot");
    tray.appendChild(s);
    slots.push(s);
  }
  slots = slotNodes(tray).slice(0, shape.n);
  const trayId = tray.id || titleKey(tray);
  slots.forEach((s, i) => paintSlot(s, i, trayId));
  return slots;
}

function titleKey(el) {
  return String(el.getAttribute("title") || el.id || "inventory")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "inventory";
}

function findRec(id) {
  const list = engine.inventory;
  if (!list) return null;
  if (id && id.nodeType === 1) {
    return list.find((r) => r.el === id) || null;
  }
  const key = id == null ? "" : String(id);
  if (list[key]) return list[key];
  const n = parseInt(key, 10);
  if (Number.isFinite(n) && list[n]) return list[n];
  return list.find((r) => r.id === key || String(r.index) === key) || null;
}

function emit(tray, name, detail) {
  if (!tray || typeof tray.dispatchEvent !== "function") return;
  tray.dispatchEvent(new CustomEvent(name, { bubbles: true, cancelable: true, detail }));
}

function selectRec(rec, selected) {
  const list = engine.inventory || [];
  if (selected) {
    for (const r of list) {
      if (r.tray === rec.tray && r !== rec) {
        r.selected = false;
        if (r.el) {
          r.el.classList.remove("is-selected");
          r.el.setAttribute("aria-selected", "false");
        }
      }
    }
  }
  rec.selected = !!selected;
  if (rec.el) {
    rec.el.classList.toggle("is-selected", rec.selected);
    rec.el.setAttribute("aria-selected", rec.selected ? "true" : "false");
  }
  list.selected = rec.selected ? rec : list.find((r) => r.selected) || null;
  if (rec.selected) emit(rec.tray, "latis-inventory-select", { index: rec.index, id: rec.id, slot: rec.el, value: rec.value });
  return rec;
}

function bindTrayEvents(tray, list) {
  if (tray.dataset.latisInventoryBound === "1") return;
  tray.dataset.latisInventoryBound = "1";

  let drag = null;

  function recFromSlot(slot) {
    const i = parseInt(slot && slot.dataset.slot, 10);
    return list.find((r) => r.el === slot || r.index === i) || null;
  }

  function endDrag(ev, dropped) {
    if (!drag) return;
    const rec = drag.rec;
    if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    if (rec.el) rec.el.classList.remove("is-dragging");
    const x = ev && ev.clientX != null ? ev.clientX : drag.x;
    const y = ev && ev.clientY != null ? ev.clientY : drag.y;
    if (drag.moved) {
      emit(tray, "latis-inventory-drag", {
        type: "end",
        x,
        y,
        index: rec.index,
        id: rec.id,
        slot: rec.el,
        value: rec.value,
        moved: true,
        dropped: !!dropped,
      });
    }
    try {
      if (drag.pointerId != null) tray.releasePointerCapture(drag.pointerId);
    } catch {
      /* ignore */
    }
    drag = null;
  }

  tray.addEventListener("pointerdown", (ev) => {
    const slot = ev.target && ev.target.closest && ev.target.closest("latis-slot, .latis-slot");
    if (!slot || !tray.contains(slot)) return;
    if (ev.button != null && ev.button !== 0) return;
    const rec = recFromSlot(slot);
    if (!rec) return;
    selectRec(rec, true);
    drag = {
      rec,
      pointerId: ev.pointerId,
      x0: ev.clientX,
      y0: ev.clientY,
      x: ev.clientX,
      y: ev.clientY,
      moved: false,
      ghost: null,
    };
    try {
      tray.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
  });

  tray.addEventListener("pointermove", (ev) => {
    if (!drag || (drag.pointerId != null && ev.pointerId !== drag.pointerId)) return;
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    const dist = Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0);
    if (!drag.moved && dist < DRAG_PX) return;
    if (!drag.rec.value) return;
    if (!drag.moved) {
      drag.moved = true;
      const ghost = drag.rec.el.cloneNode(true);
      ghost.classList.add("latis-inventory-ghost");
      ghost.classList.remove("is-selected", "is-dragging");
      ghost.style.width = drag.rec.el.getBoundingClientRect().width + "px";
      ghost.style.height = drag.rec.el.getBoundingClientRect().height + "px";
      document.body.appendChild(ghost);
      drag.ghost = ghost;
      drag.rec.el.classList.add("is-dragging");
      emit(tray, "latis-inventory-drag", {
        type: "start",
        x: ev.clientX,
        y: ev.clientY,
        index: drag.rec.index,
        id: drag.rec.id,
        slot: drag.rec.el,
        value: drag.rec.value,
      });
    }
    if (drag.ghost) {
      drag.ghost.style.left = ev.clientX + "px";
      drag.ghost.style.top = ev.clientY + "px";
    }
    emit(tray, "latis-inventory-drag", {
      type: "move",
      x: ev.clientX,
      y: ev.clientY,
      index: drag.rec.index,
      id: drag.rec.id,
      slot: drag.rec.el,
      value: drag.rec.value,
    });
  });

  const stop = (ev) => endDrag(ev, false);
  tray.addEventListener("pointerup", stop);
  tray.addEventListener("pointercancel", stop);

  tray.addEventListener("keydown", (ev) => {
    const slot = ev.target && ev.target.closest && ev.target.closest("latis-slot, .latis-slot");
    if (!slot || !tray.contains(slot)) return;
    const rec = recFromSlot(slot);
    if (!rec) return;
    const slots = list.filter((r) => r.tray === tray);
    const i = slots.indexOf(rec);
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      selectRec(rec, true);
    } else if (ev.key === "ArrowRight" || ev.key === "ArrowDown") {
      ev.preventDefault();
      const next = slots[(i + 1) % slots.length];
      if (next && next.el) next.el.focus();
    } else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const prev = slots[(i - 1 + slots.length) % slots.length];
      if (prev && prev.el) prev.el.focus();
    }
  });
}

/** Scan <latis-inventory cols rows> in root (or document). */
export function bindInventory(root) {
  defineInventoryElements();
  if (typeof document === "undefined") return engine.inventory || [];
  const scope = root && root.nodeType === 1 ? root : document;
  const trays = Array.from(scope.querySelectorAll("latis-inventory"));
  if (!trays.length) return engine.inventory || [];

  const list = emptyList();
  for (const tray of trays) {
    const title = (tray.getAttribute("title") || tray.getAttribute("label") || "Inventory").trim();
    tray.setAttribute("title", title);
    tray.classList.add("latis-inventory", "latis-glass");
    if (!tray.getAttribute("role")) tray.setAttribute("role", "listbox");
    if (!tray.getAttribute("aria-label")) tray.setAttribute("aria-label", title);
    ensureLabel(tray, title);
    const slots = ensureSlots(tray);
    for (const slot of slots) {
      const rec = {
        id: slot.id,
        index: parseInt(slot.dataset.slot, 10) || 0,
        el: slot,
        tray,
        value: writeSlotValue(slot, readSlotValue(slot)),
        selected: false,
      };
      list.push(rec);
      record(list, rec.id, rec);
    }
    bindTrayEvents(tray, list);
  }
  list.selected = null;
  engine.inventory = list;
  return list;
}

export function setSlot(id, value) {
  const rec = findRec(id);
  if (!rec) return null;
  rec.value = writeSlotValue(rec.el, value);
  return rec;
}

export function clearSlot(id) {
  return setSlot(id, null);
}

export function getSlot(id) {
  return findRec(id);
}

export function selectSlot(id, on = true) {
  const rec = findRec(id);
  if (!rec) return null;
  return selectRec(rec, on);
}

export function getSelectedSlot() {
  const list = engine.inventory;
  return (list && list.selected) || (list && list.find((r) => r.selected)) || null;
}

engine.inventory = [];
