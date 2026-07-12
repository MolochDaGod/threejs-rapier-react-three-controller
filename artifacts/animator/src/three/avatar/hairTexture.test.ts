import { describe, expect, it } from "vitest";
import {
  FINE_CLUMP_LANES,
  FINE_LANE_DIV,
  HAIR_TEX_MAX,
  HAIR_TEX_MIN,
  LANE_DIV,
  buildHairTexturePixels,
  hairTexSize,
  isFineHairBox,
} from "./hairTexture";
import { shade } from "./pixels";

describe("hairTexSize", () => {
  it("clamps tiny and huge boxes", () => {
    expect(hairTexSize(0.01)).toBe(HAIR_TEX_MIN);
    expect(hairTexSize(100)).toBe(HAIR_TEX_MAX);
  });

  it("scales with head units in between", () => {
    expect(hairTexSize(0.5)).toBe(160);
    expect(hairTexSize(1)).toBe(320);
  });
});

describe("buildHairTexturePixels", () => {
  const COLOR = 0x8b5a2b;

  it("returns cols*rows valid packed colours", () => {
    const px = buildHairTexturePixels(COLOR, 12, 20, 3);
    expect(px).toHaveLength(12 * 20);
    for (const c of px) {
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("is deterministic for identical inputs", () => {
    const a = buildHairTexturePixels(COLOR, 16, 16, 7);
    const b = buildHairTexturePixels(COLOR, 16, 16, 7);
    expect(a).toEqual(b);
  });

  it("varies with the seed", () => {
    const a = buildHairTexturePixels(COLOR, 16, 16, 1);
    const b = buildHairTexturePixels(COLOR, 16, 16, 2);
    expect(a).not.toEqual(b);
  });

  it("produces multiple shades (not a flat block)", () => {
    const px = buildHairTexturePixels(COLOR, 32, 32, 0);
    const distinct = new Set(px);
    expect(distinct.size).toBeGreaterThanOrEqual(4);
  });

  it("keeps every texel derived from the hair colour's shade range", () => {
    const px = buildHairTexturePixels(COLOR, 16, 16, 5);
    const darkest = shade(COLOR, 0.55);
    const lightest = shade(COLOR, 1.16);
    const lum = (c: number) =>
      ((c >> 16) & 0xff) * 0.299 + ((c >> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114;
    for (const c of px) {
      expect(lum(c)).toBeGreaterThanOrEqual(lum(darkest) - 1);
      expect(lum(c)).toBeLessThanOrEqual(lum(lightest) + 1);
    }
  });

  it("braided weave differs from the loose-strand look and stays in range", () => {
    const braid = buildHairTexturePixels(COLOR, 16, 16, 5, true);
    const loose = buildHairTexturePixels(COLOR, 16, 16, 5, false);
    expect(braid).not.toEqual(loose);
    expect(braid).toHaveLength(16 * 16);
    const darkest = shade(COLOR, 0.55);
    const lightest = shade(COLOR, 1.16);
    const lum = (c: number) =>
      ((c >> 16) & 0xff) * 0.299 + ((c >> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114;
    for (const c of braid) {
      expect(lum(c)).toBeGreaterThanOrEqual(lum(darkest) - 1);
      expect(lum(c)).toBeLessThanOrEqual(lum(lightest) + 1);
    }
    // weave has real contrast (grooves + lit strands), deterministically
    expect(new Set(braid).size).toBeGreaterThanOrEqual(4);
    expect(buildHairTexturePixels(COLOR, 16, 16, 5, true)).toEqual(braid);
  });

  it("darkens toward the tips (root→tip gradient)", () => {
    const cols = 24;
    const rows = 48;
    const px = buildHairTexturePixels(COLOR, cols, rows, 11);
    const lum = (c: number) =>
      ((c >> 16) & 0xff) * 0.299 + ((c >> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114;
    const rowAvg = (y0: number, y1: number) => {
      let s = 0;
      let n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = 0; x < cols; x++) {
          s += lum(px[y * cols + x]);
          n++;
        }
      return s / n;
    };
    expect(rowAvg(rows - 8, rows)).toBeLessThan(rowAvg(0, 8));
  });

  it("fine variant differs from the standard look, stays in range, deterministic", () => {
    const fine = buildHairTexturePixels(COLOR, 96, 96, 5, false, true);
    const std = buildHairTexturePixels(COLOR, 96, 96, 5, false, false);
    expect(fine).not.toEqual(std);
    expect(fine).toHaveLength(96 * 96);
    const darkest = shade(COLOR, 0.55);
    const lightest = shade(COLOR, 1.16);
    const lum = (c: number) =>
      ((c >> 16) & 0xff) * 0.299 + ((c >> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114;
    for (const c of fine) {
      expect(lum(c)).toBeGreaterThanOrEqual(lum(darkest) - 1);
      expect(lum(c)).toBeLessThanOrEqual(lum(lightest) + 1);
    }
    expect(new Set(fine).size).toBeGreaterThanOrEqual(4);
    expect(buildHairTexturePixels(COLOR, 96, 96, 5, false, true)).toEqual(fine);
  });

  it("fine variant packs more strand lanes than the standard look", () => {
    // Count luminance sign-changes across a row: finer lanes = more edges.
    const cols = 384;
    const rows = 8;
    const lum = (c: number) =>
      ((c >> 16) & 0xff) * 0.299 + ((c >> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114;
    const edges = (px: number[]) => {
      let n = 0;
      for (let y = 0; y < rows; y++)
        for (let x = 1; x < cols; x++)
          if (Math.abs(lum(px[y * cols + x]) - lum(px[y * cols + x - 1])) > 8) n++;
      return n;
    };
    const fine = buildHairTexturePixels(COLOR, cols, rows, 3, false, true);
    const std = buildHairTexturePixels(COLOR, cols, rows, 3, false, false);
    expect(edges(fine)).toBeGreaterThan(edges(std));
    expect(FINE_LANE_DIV).toBeGreaterThan(LANE_DIV * 2);
  });

  it("fine variant carves periodic clump grooves (thick-lock structure)", () => {
    const cols = 384; // laneW = 4 texels → clump period = 28 texels
    const rows = 16;
    const px = buildHairTexturePixels(COLOR, cols, rows, 7, false, true);
    const lum = (c: number) =>
      ((c >> 16) & 0xff) * 0.299 + ((c >> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114;
    const colAvg: number[] = [];
    for (let x = 0; x < cols; x++) {
      let s = 0;
      for (let y = 0; y < rows; y++) s += lum(px[y * cols + x]);
      colAvg.push(s / rows);
    }
    const laneW = Math.round(cols / FINE_LANE_DIV);
    const period = laneW * FINE_CLUMP_LANES;
    const overall = colAvg.reduce((a, b) => a + b, 0) / cols;
    // Average groove-column luminance sits clearly below the overall mean.
    let grooveSum = 0;
    let grooveN = 0;
    for (let x = 0; x < cols; x += period)
      for (let i = 0; i < laneW && x + i < cols; i++) {
        grooveSum += colAvg[x + i];
        grooveN++;
      }
    expect(grooveSum / grooveN).toBeLessThan(overall * 0.92);
  });

  it("braided wins over fine when both flags are set", () => {
    const both = buildHairTexturePixels(COLOR, 48, 48, 5, true, true);
    const braid = buildHairTexturePixels(COLOR, 48, 48, 5, true, false);
    expect(both).toEqual(braid);
  });

  it("column lanes have distinct base shading (strand look)", () => {
    const cols = 24;
    const rows = 24;
    const px = buildHairTexturePixels(COLOR, cols, rows, 9);
    // Compare average luminance across columns: strands must not be uniform.
    const lum = (c: number) =>
      ((c >> 16) & 0xff) * 0.299 + ((c >> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114;
    const colAvg: number[] = [];
    for (let x = 0; x < cols; x++) {
      let s = 0;
      for (let y = 0; y < rows; y++) s += lum(px[y * cols + x]);
      colAvg.push(s / rows);
    }
    const min = Math.min(...colAvg);
    const max = Math.max(...colAvg);
    expect(max - min).toBeGreaterThan(5);
  });
});

describe("isFineHairBox", () => {
  it("all beard boxes are fine (slot facialHair, regardless of x)", () => {
    expect(isFineHairBox({ slot: "facialHair", x: 0 })).toBe(true);
    expect(isFineHairBox({ slot: "facialHair", x: 0.2, hair: undefined })).toBe(true);
  });

  it("side hair boxes are fine (hair hugging the head's side faces)", () => {
    // long-hair curtain at x = ±(0.5 + 0.022)
    expect(isFineHairBox({ hair: true, slot: "hair", x: 0.522 })).toBe(true);
    expect(isFineHairBox({ hair: true, slot: "hair", x: -0.522 })).toBe(true);
    // smooth slicked side panel at ±(0.5 + 0.016)
    expect(isFineHairBox({ hair: true, slot: "hair", x: -0.516 })).toBe(true);
  });

  it("crown slabs, fringe and back sheets stay on the standard look", () => {
    expect(isFineHairBox({ hair: true, slot: "hair", x: 0 })).toBe(false); // crown
    expect(isFineHairBox({ hair: true, slot: "hair", x: 0.18 })).toBe(false); // back sheet
    expect(isFineHairBox({ hair: true, slot: "hair", x: -0.42 })).toBe(false); // crown tuft
  });

  it("braided volume keeps the weave (never fine)", () => {
    expect(isFineHairBox({ hair: true, slot: "hair", x: 0.53, braided: true })).toBe(false);
    expect(isFineHairBox({ slot: "facialHair", x: 0, braided: true })).toBe(false);
  });

  it("non-hair protrusions (ears, tusks) are never fine", () => {
    expect(isFineHairBox({ slot: "ears", x: 0.55 })).toBe(false);
    expect(isFineHairBox({ x: 0.6 })).toBe(false);
  });
});
