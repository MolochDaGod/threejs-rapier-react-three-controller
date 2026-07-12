/**
 * 2D avatar portrait — a straight-on front projection of a composed cube
 * head, rendered without WebGL (works in plain DOM, headless-safe).
 *
 * Pure layer math lives in {@link portraitLayers} / {@link projectBox}
 * (unit-testable, no DOM); {@link renderPortraitDataUrl} blits the layers to
 * a 2D canvas and returns a data URL for use in `<img>` tags.
 *
 * Draw order: protrusion boxes whose front face sits behind the head cube's
 * front plane (z + d/2 <= 0.5) go UNDER the face grid (visible only outside
 * the head silhouette — side hair curtains, ears); boxes that poke past the
 * front plane (nose, tusks, fringe) go OVER it. Both groups stay sorted far
 * → near so nearer boxes overpaint farther ones.
 */
import { FACE, type Grid, cssHex } from "./pixels";
import type { AvatarConfig } from "./catalog";
import { composeHead, type ProtrusionBox } from "./composeHead";

/** Axis-aligned rect in head-pixel units (16 px per head edge, y down). */
export interface PortraitRect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
}

export interface PortraitLayers {
  /** The composed 16×16 front face. */
  grid: Grid;
  /** Boxes behind the front plane, far → near (drawn before the grid). */
  under: PortraitRect[];
  /** Boxes past the front plane, far → near (drawn after the grid). */
  over: PortraitRect[];
}

/** Front-project one protrusion box into head-pixel space. */
export function projectBox(p: ProtrusionBox): PortraitRect {
  return {
    x: (p.x - p.w / 2 + 0.5) * FACE,
    y: (0.5 - p.y - p.h / 2) * FACE,
    w: p.w * FACE,
    h: p.h * FACE,
    color: p.color,
  };
}

/** Whether a box pokes past the head cube's front plane (z = +0.5). */
export function pokesFront(p: ProtrusionBox): boolean {
  return p.z + p.d / 2 > 0.5 + 1e-6;
}

/** Compose a config and split it into 2D portrait layers (pure, no DOM). */
export function portraitLayers(cfg: AvatarConfig): PortraitLayers {
  const composed = composeHead(cfg);
  const sorted = [...composed.protrusions].sort((a, b) => a.z - b.z);
  const under: PortraitRect[] = [];
  const over: PortraitRect[] = [];
  for (const p of sorted) (pokesFront(p) ? over : under).push(projectBox(p));
  return { grid: composed.faces.front, under, over };
}

/**
 * Render a config to a square PNG data URL, or null when the canvas is
 * unavailable (headless) or composition throws. `marginUnits` is extra
 * viewport padding per side in head units so side hair / tusks that extend
 * beyond the cube stay in frame.
 */
export function renderPortraitDataUrl(
  cfg: AvatarConfig,
  sizePx = 128,
  marginUnits = 0.22,
): string | null {
  try {
    const layers = portraitLayers(cfg);
    const canvas = document.createElement("canvas");
    canvas.width = sizePx;
    canvas.height = sizePx;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const view = 1 + marginUnits * 2; // total width in head units
    const cell = sizePx / (FACE * view); // one head-pixel in canvas px
    const off = (sizePx - cell * FACE) / 2; // head square top-left

    const fillRect = (r: PortraitRect) => {
      ctx.fillStyle = cssHex(r.color);
      ctx.fillRect(off + r.x * cell, off + r.y * cell, r.w * cell, r.h * cell);
    };

    for (const r of layers.under) fillRect(r);
    // Face grid; cells overdrawn by half a px to avoid sub-pixel seams.
    for (let y = 0; y < FACE; y++)
      for (let x = 0; x < FACE; x++) {
        ctx.fillStyle = cssHex(layers.grid[y * FACE + x]);
        ctx.fillRect(off + x * cell, off + y * cell, cell + 0.5, cell + 0.5);
      }
    for (const r of layers.over) fillRect(r);

    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
