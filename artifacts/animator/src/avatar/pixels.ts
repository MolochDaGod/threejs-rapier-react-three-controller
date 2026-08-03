/**
 * Tiny pure pixel-grid toolkit for the Avatar Edit cube heads.
 *
 * A face is a 16×16 grid of packed 0xRRGGBB ints, drawn with top-left origin
 * (x → right, y → down) exactly like the canvas it eventually blits to. All
 * painters here are pure and deterministic so the composer is unit-testable
 * without THREE or a DOM.
 */

export const FACE = 16;

/** One face: FACE*FACE packed 0xRRGGBB ints (always opaque). */
export type Grid = number[];

export function makeGrid(fill: number): Grid {
  return new Array<number>(FACE * FACE).fill(fill);
}

export function px(g: Grid, x: number, y: number, c: number): void {
  if (x < 0 || y < 0 || x >= FACE || y >= FACE) return;
  g[y * FACE + x] = c;
}

export function at(g: Grid, x: number, y: number): number {
  return g[y * FACE + x];
}

export function rect(g: Grid, x: number, y: number, w: number, h: number, c: number): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(g, xx, yy, c);
}

export function hline(g: Grid, x: number, y: number, w: number, c: number): void {
  rect(g, x, y, w, 1, c);
}

export function vline(g: Grid, x: number, y: number, h: number, c: number): void {
  rect(g, x, y, 1, h, c);
}

/** Mirror-paint: set (x,y) and its horizontal mirror (15-x, y). */
export function mirror(g: Grid, x: number, y: number, c: number): void {
  px(g, x, y, c);
  px(g, FACE - 1 - x, y, c);
}

/** Mirror a filled rect across the vertical centre line. */
export function mirrorRect(g: Grid, x: number, y: number, w: number, h: number, c: number): void {
  rect(g, x, y, w, h, c);
  rect(g, FACE - x - w, y, w, h, c);
}

/** Multiply-shade a packed colour: f < 1 darkens, f > 1 brightens. */
export function shade(c: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 0xff) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 0xff) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 0xff) * f)));
  return (r << 16) | (g << 8) | b;
}

/**
 * Deterministic per-pixel hash in [0, 1) — used for stubble/rot/freckle
 * scatter so the same config always composes the identical face.
 */
export function hash01(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** CSS hex string ("#rrggbb") for a packed colour — swatch rendering. */
export function cssHex(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}
