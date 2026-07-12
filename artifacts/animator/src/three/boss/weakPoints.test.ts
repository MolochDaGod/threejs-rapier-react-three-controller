import { describe, it, expect } from "vitest";
import {
  activeWeakPoint,
  advanceWeakPoint,
  bossPhaseFromState,
  exposedWeakPoints,
  weakPointHint,
  weakPointLocalHeight,
  weakPointMod,
} from "./weakPoints";

describe("bossPhaseFromState", () => {
  it("is downed only while the CC is fallen", () => {
    expect(bossPhaseFromState("fallen")).toBe("downed");
  });
  it("is armoured in every other state", () => {
    for (const s of ["idle", "attack", "stagger", "stunned", "block", "getUp"] as const) {
      expect(bossPhaseFromState(s)).toBe("armored");
    }
  });
});

describe("exposed weak points per phase", () => {
  it("armoured exposes only the knees", () => {
    expect(exposedWeakPoints("armored")).toEqual(["knees"]);
  });
  it("downed exposes head + chest", () => {
    expect(exposedWeakPoints("downed")).toEqual(["head", "chest"]);
  });
});

describe("activeWeakPoint (stale-index safe)", () => {
  it("resolves within the phase's exposed set", () => {
    expect(activeWeakPoint("armored", 0)).toBe("knees");
    expect(activeWeakPoint("downed", 0)).toBe("head");
    expect(activeWeakPoint("downed", 1)).toBe("chest");
  });
  it("wraps a stale index carried across a phase change", () => {
    // Index 5 from a longer set still maps cleanly into the downed pair.
    expect(activeWeakPoint("downed", 5)).toBe("chest");
    // A knees-phase index never falls out of range.
    expect(activeWeakPoint("armored", 3)).toBe("knees");
  });
});

describe("advanceWeakPoint (tab cycle)", () => {
  it("a single-point phase always wraps (Tab moves off the boss)", () => {
    expect(advanceWeakPoint("armored", 0)).toEqual({ index: 0, wrapped: true });
  });
  it("downed cycles head -> chest -> (wrap)", () => {
    expect(advanceWeakPoint("downed", 0)).toEqual({ index: 1, wrapped: false });
    expect(advanceWeakPoint("downed", 1)).toEqual({ index: 0, wrapped: true });
  });
});

describe("weakPointMod (all damage routes through applyAttack)", () => {
  it("armoured knees: low damage, heavy poise (the break path)", () => {
    const m = weakPointMod("armored", "knees");
    expect(m.damageMul).toBeLessThan(1);
    expect(m.poiseMul).toBeGreaterThan(1.5);
  });
  it("armoured body is heavily resisted", () => {
    expect(weakPointMod("armored", "head").damageMul).toBeLessThan(0.3);
    expect(weakPointMod("armored", "chest").damageMul).toBeLessThan(0.3);
  });
  it("downed head/chest take large bonus damage and no poise", () => {
    expect(weakPointMod("downed", "head").damageMul).toBeGreaterThan(2);
    expect(weakPointMod("downed", "chest").damageMul).toBeGreaterThan(1.5);
    expect(weakPointMod("downed", "head").poiseMul).toBe(0);
  });
  it("the head is the juiciest downed weak point", () => {
    expect(weakPointMod("downed", "head").damageMul).toBeGreaterThan(
      weakPointMod("downed", "chest").damageMul,
    );
  });
});

describe("weakPointHint (boss bar coaching)", () => {
  it("armoured coaches breaking the knees", () => {
    expect(weakPointHint("armored")).toMatch(/knee/i);
  });
  it("downed coaches striking head & chest", () => {
    const hint = weakPointHint("downed");
    expect(hint).toMatch(/head/i);
    expect(hint).toMatch(/chest/i);
  });
  it("differs between phases", () => {
    expect(weakPointHint("armored")).not.toBe(weakPointHint("downed"));
  });
});

describe("weakPointLocalHeight", () => {
  it("orders knees < chest < head", () => {
    expect(weakPointLocalHeight("knees")).toBeLessThan(weakPointLocalHeight("chest"));
    expect(weakPointLocalHeight("chest")).toBeLessThan(weakPointLocalHeight("head"));
  });
});
