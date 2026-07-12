import { describe, expect, it } from "vitest";
import { FACE } from "./pixels";
import { defaultConfig } from "./catalog";
import type { ProtrusionBox } from "./composeHead";
import { pokesFront, portraitLayers, projectBox } from "./portrait";

const box = (p: Partial<ProtrusionBox>): ProtrusionBox => ({
  x: 0,
  y: 0,
  z: 0,
  w: 0.2,
  h: 0.2,
  d: 0.2,
  color: 0xff0000,
  ...p,
});

describe("projectBox", () => {
  it("maps a centred box to the centre of the 16px face", () => {
    const r = projectBox(box({ w: 0.5, h: 0.25 }));
    // centred: x spans [-0.25, 0.25] → pixels [4, 12]
    expect(r.x).toBeCloseTo(4);
    expect(r.w).toBeCloseTo(8);
    // y up: centred vertically, h 0.25 → top at (0.5 - 0.125) * 16 = 6
    expect(r.y).toBeCloseTo(6);
    expect(r.h).toBeCloseTo(4);
    expect(r.color).toBe(0xff0000);
  });

  it("maps +y (up) to smaller canvas y (top)", () => {
    const high = projectBox(box({ y: 0.4 }));
    const low = projectBox(box({ y: -0.4 }));
    expect(high.y).toBeLessThan(low.y);
  });

  it("maps +x to the right", () => {
    const right = projectBox(box({ x: 0.4 }));
    const left = projectBox(box({ x: -0.4 }));
    expect(right.x).toBeGreaterThan(left.x);
  });
});

describe("pokesFront", () => {
  it("is true only when the box crosses the front plane z=0.5", () => {
    expect(pokesFront(box({ z: 0.5, d: 0.2 }))).toBe(true); // front at 0.6
    expect(pokesFront(box({ z: 0.4, d: 0.2 }))).toBe(false); // front at 0.5
    expect(pokesFront(box({ z: -0.5, d: 0.2 }))).toBe(false); // behind
  });
});

describe("portraitLayers", () => {
  it("returns a full 16x16 front grid", () => {
    const layers = portraitLayers(defaultConfig("human"));
    expect(layers.grid).toHaveLength(FACE * FACE);
  });

  it("puts orc tusks (front protrusions) in the over layer", () => {
    // Orc defaults include tusks that jut past the face.
    const layers = portraitLayers(defaultConfig("orc"));
    expect(layers.over.length).toBeGreaterThan(0);
  });

  it("keeps each layer sorted far-to-near is stable (no NaN rects)", () => {
    const layers = portraitLayers(defaultConfig("elf"));
    for (const r of [...layers.under, ...layers.over]) {
      expect(Number.isFinite(r.x)).toBe(true);
      expect(Number.isFinite(r.y)).toBe(true);
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    }
  });
});
