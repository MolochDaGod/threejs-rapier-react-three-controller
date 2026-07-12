/**
 * Procedural pixel textures for hair protrusion boxes.
 *
 * Hair boxes used to render as flat single-colour slabs (a darkened "core"
 * under the strand overlay), which read as untextured plastic — especially
 * the big crown slab on top of the head. This module generates a small
 * deterministic pixel grid per hair box in the same palette style as the
 * painted head faces (base / dark / lite streaks from `paintHair`), so the
 * blocks look like combed pixel-art hair from every angle.
 *
 * Strand shading varies per texture column and runs along the V axis: on the
 * box's side faces V is vertical (strands hang down), and on the top face V
 * runs front-to-back (combed-back crown). Pure and THREE-free so it can be
 * unit-tested; the CanvasTexture wrapper lives in hairStrands.ts.
 */
import { hash01, shade } from "./pixels";

/**
 * Texels per head unit. Was 32 (double head-pixel density); now 320 — a
 * 10x-per-axis (100x texel) density so strands render as smooth shaded
 * filaments instead of chunky pixel stripes.
 */
export const HAIR_TEXELS_PER_UNIT = 320;

/** Clamp texture dimensions (per-box canvases stay GPU-friendly). */
export const HAIR_TEX_MIN = 16;
export const HAIR_TEX_MAX = 512;

/** Texture size (texels) for a hair box edge of `units` head units. */
export function hairTexSize(units: number): number {
  return Math.min(HAIR_TEX_MAX, Math.max(HAIR_TEX_MIN, Math.round(units * HAIR_TEXELS_PER_UNIT)));
}

/** Shade-factor bounds every texel stays inside (matches paintHair range). */
export const HAIR_SHADE_DARK = 0.55;
export const HAIR_SHADE_LITE = 1.16;

/** Lane divisor for the standard strand look (~24 strands across a box). */
export const LANE_DIV = 24;
/**
 * Lane divisor for the FINE strand look (~96 strands): side hair and beards
 * render with 4× finer filaments grouped into thick rounded clumps.
 */
export const FINE_LANE_DIV = 96;
/** Fine lanes per clump — one clump reads as a thick lock of fine strands. */
export const FINE_CLUMP_LANES = 7;

const clampShade = (f: number) =>
  Math.min(HAIR_SHADE_LITE, Math.max(HAIR_SHADE_DARK, f));

/**
 * Should this hair/beard box use the FINE strand material (extra-fine
 * filaments in thick clumps)? True for all beard volume and for side hair —
 * boxes hugging the head's left/right faces (curtains, slicked panels,
 * shaggy locks; the head is a unit cube so its sides sit at |x| ≈ 0.5).
 * Braided volume keeps its weave texture instead. Pure so it's testable.
 */
export function isFineHairBox(box: {
  hair?: boolean;
  slot?: string;
  x: number;
  braided?: boolean;
}): boolean {
  if (box.braided) return false;
  if (box.slot === "facialHair") return true;
  return box.hair === true && Math.abs(box.x) > 0.45;
}

/**
 * Compose a `cols` × `rows` grid of packed 0xRRGGBB ints for one hair box.
 *
 * Each column is one "strand lane" with its own base shade; occasional lanes
 * become dark grooves (partings) or lit strands (sheen). Lanes meander
 * slightly along V (combed flow instead of ruler-straight stripes) and a
 * root→tip gradient darkens the ends so long boxes read as lit-from-the-roots
 * hair. Per-pixel noise breaks everything up so nothing bands.
 *
 * `braided` swaps the lane look for a tight diagonal weave: chevron bands of
 * alternating shade with dark grooves at the strand crossings (dread locks
 * and beard braids). `fine` swaps it for the extra-fine look instead: 4×
 * thinner filament lanes gathered into thick rounded clumps with dark
 * separation grooves (side hair + beards). Braided wins when both are set.
 * Deterministic for (color, dims, seed, braided, fine).
 */
export function buildHairTexturePixels(
  color: number,
  cols: number,
  rows: number,
  seed: number,
  braided = false,
  fine = false,
): number[] {
  const out = new Array<number>(cols * rows);
  const dark = shade(color, HAIR_SHADE_DARK);
  const lite = shade(color, HAIR_SHADE_LITE);

  if (braided) {
    // Diagonal weave: two crossing band directions form chevrons; band
    // boundaries go dark (the groove between woven strands) and each band
    // gets a rounded, lit "cylinder" profile so the plaits read as volume.
    const period = Math.max(3, Math.round(Math.min(cols, rows) / 3));
    for (let y = 0; y < rows; y++) {
      const tip = 1 - (y / Math.max(1, rows - 1)) * 0.14; // root→tip darkening
      for (let x = 0; x < cols; x++) {
        const a = (((x + y) % period) + period) % period;
        const b = (((x - y) % period) + period) % period;
        const band = Math.min(a, b) / period; // 0 at crossings, higher inside
        const n = hash01(x, y, seed + 5);
        let f: number;
        if (band < 0.18) f = HAIR_SHADE_DARK + n * 0.1; // groove
        else {
          // rounded strand crown: sin ramps 0→1 across the band interior
          const crown = Math.sin(Math.min(1, (band - 0.18) / 0.62) * Math.PI * 0.5);
          f = 0.74 + crown * 0.42 + (n - 0.5) * 0.1;
        }
        out[y * cols + x] = shade(color, clampShade(f * tip));
      }
    }
    return out;
  }

  if (fine) {
    // Extra-fine filaments in thick clumps: each lane is a 4×-thinner strand,
    // FINE_CLUMP_LANES neighbouring lanes share a clump with its own base
    // shade and a rounded macro "lock" profile (bright crown, shadowed
    // edges), and the first lane of every clump darkens into a separation
    // groove — dense fine hair gathered into thick locks, not flat noise.
    const laneW = Math.max(1, Math.round(cols / FINE_LANE_DIV));
    for (let x = 0; x < cols; x++) {
      const lane = Math.floor(x / laneW);
      const clump = Math.floor(lane / FINE_CLUMP_LANES);
      const clumpShade = 0.74 + hash01(clump, 11, seed) * 0.26;
      // Macro cylinder across the whole clump (thick rounded lock).
      const cu =
        ((lane % FINE_CLUMP_LANES) + ((x % laneW) + 0.5) / laneW) / FINE_CLUMP_LANES;
      const clumpCyl = 0.8 + Math.sin(cu * Math.PI) * 0.3;
      const boundary = lane % FINE_CLUMP_LANES === 0;
      const laneShade = clumpShade * (0.86 + hash01(lane, 0, seed) * 0.24);
      const sheenLane = hash01(lane, 1, seed) < 0.06;
      // Micro cylinder inside each fine strand (needs ≥3 texels to matter).
      const u = ((x % laneW) + 0.5) / laneW;
      const cyl = laneW > 2 ? 0.85 + Math.sin(u * Math.PI) * 0.24 : 1;
      for (let y = 0; y < rows; y++) {
        const tip = 1 - (y / Math.max(1, rows - 1)) * 0.16; // root→tip gradient
        const n = hash01(x, y, seed + 4);
        let f = laneShade * cyl * clumpCyl;
        if (boundary) f *= 0.58; // groove between thick locks
        const base = shade(color, clampShade(f * tip));
        out[y * cols + x] = sheenLane
          ? n > 0.55
            ? base
            : lite
          : n > 0.92
            ? lite
            : n < 0.07
              ? dark
              : base;
      }
    }
    return out;
  }

  // A "lane" is one visible strand. Lane width scales with resolution so a
  // box always carries the same number of strands regardless of texel
  // density — extra texels buy smooth shading INSIDE each strand (rounded
  // cylinder highlight) instead of ever-thinner noise stripes.
  const laneW = Math.max(1, Math.round(cols / LANE_DIV));
  for (let x = 0; x < cols; x++) {
    const lane = Math.floor(x / laneW);
    // Per-lane character: base shade jitter + rare groove / sheen lanes.
    const laneShade = 0.66 + hash01(lane, 0, seed) * 0.3;
    const laneKind = hash01(lane, 1, seed);
    const groove = laneKind > 0.9;
    const sheen = laneKind < 0.08;
    // Cross-strand cylinder profile: bright at the lane centre, shadowed at
    // the edges (only meaningful when lanes span multiple texels).
    const u = ((x % laneW) + 0.5) / laneW;
    const cyl = laneW > 2 ? 0.87 + Math.sin(u * Math.PI) * 0.2 : 1;
    for (let y = 0; y < rows; y++) {
      // Lane meander: sample the neighbouring lane's shade partway down so
      // strands drift sideways like combed hair instead of ruler stripes.
      const drift = hash01(lane + (y >> 2), 3, seed) > 0.5 ? 1 : -1;
      const meander = hash01(lane, y >> 1, seed + 9) > 0.72;
      const laneF =
        (meander ? 0.66 + hash01(lane + drift, 0, seed) * 0.3 : laneShade) * cyl;
      const tip = 1 - (y / Math.max(1, rows - 1)) * 0.12; // root→tip gradient
      const n = hash01(x, y, seed + 2);
      let c: number;
      if (groove) c = n > 0.82 ? shade(color, clampShade(laneF * tip)) : dark;
      else if (sheen) c = n > 0.7 ? shade(color, clampShade(laneF * tip)) : lite;
      else
        c =
          n > 0.85
            ? lite
            : n < 0.12
              ? dark
              : shade(color, clampShade(laneF * tip));
      out[y * cols + x] = c;
    }
  }
  return out;
}
