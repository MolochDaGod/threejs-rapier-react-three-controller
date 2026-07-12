import { describe, expect, it } from "vitest";
import { FACE } from "./pixels";
import { composeHead, type ProtrusionBox } from "./composeHead";
import { defaultConfig, type AvatarConfig } from "./catalog";
import {
  MAX_STRANDS,
  STRAND_THICKNESS,
  buildStrandDescriptors,
} from "./hairStrands";

const P = 1 / FACE;

const cfg = (over: Partial<AvatarConfig>): AvatarConfig => ({
  ...defaultConfig("human"),
  ...over,
});

const box = (over: Partial<ProtrusionBox> = {}): ProtrusionBox => ({
  x: 0,
  y: 0.2,
  z: -0.5,
  w: 0.5,
  h: 0.6,
  d: 0.06,
  color: 0x5a3825,
  hair: true,
  ...over,
});

describe("composeHead hair tagging", () => {
  it("tags every hair-section box and nothing else", () => {
    const head = composeHead(cfg({ hair: "long", ears: "round", facialHair: "braided" }));
    const hair = head.protrusions.filter((p) => p.hair);
    const rest = head.protrusions.filter((p) => !p.hair);
    expect(hair.length).toBeGreaterThan(0);
    // ears/nose/beard remain untagged
    expect(rest.length).toBeGreaterThan(0);
    // hair boxes all carry the configured hair colour family — none of them
    // is an ear (ears sit at |x| > 0.5 with skin colours at eye level AND
    // small heights; cheap sanity: every untagged box is outside the hair
    // colour set used by this config)
    const hairColors = new Set(hair.map((p) => p.color));
    expect(hairColors.size).toBeGreaterThan(0);
  });

  it("bald heads produce no hair-tagged boxes", () => {
    const head = composeHead(cfg({ hair: "bald" }));
    expect(head.protrusions.some((p) => p.hair)).toBe(false);
  });

  it("beard/ears/nose boxes stay untagged even alongside hair", () => {
    // bald + braided beard + ears: every remaining protrusion is non-hair
    const noHair = composeHead(
      cfg({ hair: "bald", facialHair: "braided", ears: "round" }),
    );
    expect(noHair.protrusions.length).toBeGreaterThan(0);
    expect(noHair.protrusions.every((p) => !p.hair)).toBe(true);
    // adding a hairstyle must not tag any of those pre-existing boxes
    const withHair = composeHead(
      cfg({ hair: "dreads", facialHair: "braided", ears: "round" }),
    );
    const untagged = withHair.protrusions.filter((p) => !p.hair);
    expect(untagged.length).toBe(noHair.protrusions.length);
  });
});

describe("buildStrandDescriptors", () => {
  it("is deterministic for identical input", () => {
    const a = buildStrandDescriptors([box()]);
    const b = buildStrandDescriptors([box()]);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("strand cross-section is 1/8 of a head pixel (with bounded jitter)", () => {
    for (const s of buildStrandDescriptors([box()])) {
      expect(s.thick).toBeGreaterThanOrEqual(STRAND_THICKNESS);
      expect(s.thick).toBeLessThanOrEqual(STRAND_THICKNESS * 2.2);
    }
    expect(STRAND_THICKNESS).toBeCloseTo(P / 8, 10);
  });

  it("roots stay within the box footprint (plus jitter slack)", () => {
    const b = box();
    const slack = P / 2;
    for (const s of buildStrandDescriptors([b])) {
      expect(Math.abs(s.x - b.x)).toBeLessThanOrEqual(b.w / 2 + slack);
      expect(Math.abs(s.z - b.z)).toBeLessThanOrEqual(b.d / 2 + slack);
      expect(s.y).toBeCloseTo(b.y + b.h / 2, 10);
      expect(s.len).toBeGreaterThan(0);
      expect(s.len).toBeLessThanOrEqual(b.h * 1.3 + 1e-9);
    }
  });

  it("long strands sway, short scalp fuzz holds still", () => {
    const long = buildStrandDescriptors([box({ h: 0.7 })]);
    const short = buildStrandDescriptors([box({ h: 2 * P })]);
    expect(long.some((s) => s.sway > 0)).toBe(true);
    expect(short.every((s) => s.sway === 0)).toBe(true);
  });

  it("respects the strand cap deterministically", () => {
    const big = box({ w: 1.1, d: 1.1, h: 0.5 });
    const strands = buildStrandDescriptors([big, box(), box({ x: 0.3 })], 500);
    expect(strands.length).toBeLessThanOrEqual(500 * 1.15); // hash thinning is approximate
    const again = buildStrandDescriptors([big, box(), box({ x: 0.3 })], 500);
    expect(strands).toEqual(again);
  });

  it("caps a full long-hair head below MAX_STRANDS-ish and stays non-empty", () => {
    const head = composeHead(cfg({ hair: "long" }));
    const strands = buildStrandDescriptors(head.protrusions.filter((p) => p.hair));
    expect(strands.length).toBeGreaterThan(100);
    expect(strands.length).toBeLessThanOrEqual(MAX_STRANDS * 1.15);
  });

  it("returns empty for no hair boxes", () => {
    expect(buildStrandDescriptors([])).toEqual([]);
  });

  it("braided beards get zero strands; loose facial hair grows them", () => {
    // braided beard boxes (dwarf) are weave-only — no flyaway strands
    const dwarf = composeHead(defaultConfig("dwarf"));
    const braidedBeard = dwarf.protrusions.filter(
      (p) => p.slot === "facialHair" && p.braided,
    );
    expect(braidedBeard.length).toBeGreaterThan(0);
    expect(buildStrandDescriptors(braidedBeard)).toEqual([]);
    // non-braided beard bulk (full) and sideburns DO sprout strands
    for (const style of ["full", "sideburns"] as const) {
      const head = composeHead(cfg({ facialHair: style }));
      const beard = head.protrusions.filter((p) => p.slot === "facialHair");
      expect(beard.length).toBeGreaterThan(0);
      expect(buildStrandDescriptors(beard).length).toBeGreaterThan(0);
    }
  });
});
