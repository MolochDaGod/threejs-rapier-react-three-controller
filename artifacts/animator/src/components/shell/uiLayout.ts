/**
 * Shell UI layout persistence — user-movable chrome (mode title, wallet pill,
 * bottom-right Toolbox). Each element stores a {dx, dy} pixel offset from its
 * CSS-anchored home position; offsets are applied as CSS vars so the stock
 * layout (all zeros) renders byte-identically.
 *
 * Pure + unit-tested: no DOM access outside load/save.
 */

/** Every shell element the UI edit mode can move. */
export const UI_ELEMENT_IDS = ["topbar", "wallet", "toolbox"] as const;
export type UiElementId = (typeof UI_ELEMENT_IDS)[number];

export interface UiOffset {
  dx: number;
  dy: number;
}

export type UiLayout = Record<UiElementId, UiOffset>;

const STORAGE_KEY = "dangerroom:uilayout";

/** Stock layout — everything at its CSS-anchored home. */
export function defaultUiLayout(): UiLayout {
  return { topbar: { dx: 0, dy: 0 }, wallet: { dx: 0, dy: 0 }, toolbox: { dx: 0, dy: 0 } };
}

/**
 * Clamp one offset so the element can never be dragged fully off-screen.
 * `vw`/`vh` are the viewport dimensions; a margin keeps at least a grabbable
 * sliver inside the viewport in each axis.
 */
export function clampOffset(off: UiOffset, vw: number, vh: number): UiOffset {
  const mx = Math.max(0, vw - 60);
  const my = Math.max(0, vh - 60);
  // NaN goes home (0); ±Infinity clamps to the bound; -0 normalizes to 0.
  const num = (n: number) => (Number.isNaN(n) ? 0 : n);
  return {
    dx: Math.min(mx, Math.max(-mx, Math.round(num(off.dx)))) + 0,
    dy: Math.min(my, Math.max(-my, Math.round(num(off.dy)))) + 0,
  };
}

/** Re-clamp every element of a layout against a (new) viewport size. */
export function clampLayout(layout: UiLayout, vw: number, vh: number): UiLayout {
  const out = defaultUiLayout();
  for (const id of UI_ELEMENT_IDS) out[id] = clampOffset(layout[id], vw, vh);
  return out;
}

/** Merge possibly-hostile persisted data onto the default layout, clamped. */
export function mergeUiLayout(raw: unknown, vw: number, vh: number): UiLayout {
  const out = defaultUiLayout();
  if (!raw || typeof raw !== "object") return out;
  for (const id of UI_ELEMENT_IDS) {
    const v = (raw as Record<string, unknown>)[id];
    if (!v || typeof v !== "object") continue;
    const { dx, dy } = v as { dx?: unknown; dy?: unknown };
    out[id] = clampOffset(
      { dx: typeof dx === "number" ? dx : 0, dy: typeof dy === "number" ? dy : 0 },
      vw,
      vh,
    );
  }
  return out;
}

/** True when every element sits at its stock home position. */
export function isDefaultLayout(layout: UiLayout): boolean {
  return UI_ELEMENT_IDS.every((id) => layout[id].dx === 0 && layout[id].dy === 0);
}

export function loadUiLayout(vw: number, vh: number): UiLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultUiLayout();
    return mergeUiLayout(JSON.parse(raw), vw, vh);
  } catch {
    return defaultUiLayout();
  }
}

export function saveUiLayout(layout: UiLayout): void {
  try {
    if (isDefaultLayout(layout)) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage unavailable (private mode) — layout just won't persist.
  }
}
