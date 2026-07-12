import { describe, it, expect } from "vitest";
import { aoeFalloff, aoeVictims, fireComboStep, meleeStrike, preferSelectedHostile, strikeForceLevel } from "./combat";

/**
 * The AoE telegraph resolves at impact time and may only affect units still
 * inside the circle. Both resolvers (Studio.resolveOpponentStrike for the player
 * and Targets.blastFaction for allies) gate on `aoeFalloff`, so its contract —
 * negative (no hit) outside the radius, falling 1→0 from center to edge — is the
 * single source of truth for "only units inside the radius at resolve are hit".
 */
describe("aoeFalloff (AoE radius gate)", () => {
  it("returns < 0 for anything outside the radius (no hit)", () => {
    expect(aoeFalloff(3.01, 3)).toBeLessThan(0);
    expect(aoeFalloff(100, 3)).toBeLessThan(0);
  });

  it("falls from 1 at the center to 0 at the edge", () => {
    expect(aoeFalloff(0, 4)).toBeCloseTo(1);
    expect(aoeFalloff(2, 4)).toBeCloseTo(0.5);
    expect(aoeFalloff(4, 4)).toBeCloseTo(0);
  });

  it("treats a zero/negative radius as a non-AoE (never hits)", () => {
    expect(aoeFalloff(0, 0)).toBeLessThan(0);
    expect(aoeFalloff(0, -1)).toBeLessThan(0);
  });
});

/**
 * Skill swings are the "AoE attacks" that telegraph: meleeStrike gives a skill a
 * larger area radius than a basic swing, which is what `executeStrike` keys off
 * (`pendingSkill`) to route through the telegraph instead of an instant hit.
 */
describe("meleeStrike skill vs basic radius", () => {
  it("a skill swing has a larger area radius than a basic swing", () => {
    const combat = { range: [1, 2] as [number, number], intensity: 50, direction: 50 };
    const basic = meleeStrike(combat, { skill: false, skillForce: 1 });
    const skill = meleeStrike(combat, { skill: true, skillForce: 1 });
    expect(skill.radius).toBeGreaterThan(basic.radius);
  });
});

/**
 * A telegraphed AoE must resolve at impact with the SAME force tier as a direct
 * strike, so a boss skill stays unblockable (force 4) whether it lands instantly
 * (NPC-vs-NPC) or through the telegraph path.
 */
describe("strikeForceLevel (impact force tier reuse)", () => {
  it("a boss skill is unblockable (4)", () => {
    expect(strikeForceLevel(true, true)).toBe(4);
  });
  it("a non-boss skill is heavy (2)", () => {
    expect(strikeForceLevel(false, true)).toBe(2);
  });
  it("a basic swing is light (1), boss or not", () => {
    expect(strikeForceLevel(false, false)).toBe(1);
    expect(strikeForceLevel(true, false)).toBe(1);
  });
});

/**
 * The telegraph resolves faction-aware: an enemy's skill AoE hits the player +
 * allied units, while an ally's skill AoE hits enemy units only and NEVER the
 * player — proving a non-boss ally skill can't damage the player or fellow allies.
 */
describe("aoeVictims (faction-aware telegraph resolve)", () => {
  it("an enemy attacker hits the player and allied units", () => {
    expect(aoeVictims("enemy")).toEqual({ hitsPlayer: true, victimFaction: "ally" });
  });
  it("an ally attacker hits enemy units only, never the player", () => {
    expect(aoeVictims("ally")).toEqual({ hitsPlayer: false, victimFaction: "enemy" });
  });
});

/**
 * Offensive abilities resolve against the Tab-selected hostile (red target) when
 * one is selected and in range — so the red target is honored even when another
 * enemy is nearer or better aligned. Out-of-range or no-selection falls back to
 * the cone/nearest acquisition.
 */
describe("preferSelectedHostile (offensive target acquisition)", () => {
  it("uses the selected hostile when it is in range", () => {
    // A red target 8 m away is chosen over the cone/nearest fallback (range 12).
    expect(preferSelectedHostile(8, 12)).toBe(true);
  });
  it("falls back when the selected hostile is out of range", () => {
    expect(preferSelectedHostile(20, 12)).toBe(false);
  });
  it("falls back when nothing hostile is selected", () => {
    expect(preferSelectedHostile(null, 12)).toBe(false);
  });
  it("ignores a zero-distance (degenerate) selection", () => {
    expect(preferSelectedHostile(0, 12)).toBe(false);
  });
});

describe("fireComboStep (Hot Hands fire-combo escalation)", () => {
  it("escalates damage, radius and force across the three stages", () => {
    const [a, b, c] = [0, 1, 2].map(fireComboStep);
    expect(a.damage).toBeLessThan(b.damage);
    expect(b.damage).toBeLessThan(c.damage);
    expect(a.radius).toBeLessThan(b.radius);
    expect(b.radius).toBeLessThan(c.radius);
    expect(a.forceMul).toBeLessThan(b.forceMul);
    expect(b.forceMul).toBeLessThan(c.forceMul);
  });
  it("only the finisher (stage 2) launches the target", () => {
    expect(fireComboStep(0).launch).toBe(0);
    expect(fireComboStep(1).launch).toBe(0);
    expect(fireComboStep(2).launch).toBeGreaterThan(0);
    expect(fireComboStep(0).finisher).toBe(false);
    expect(fireComboStep(2).finisher).toBe(true);
  });
  it("clamps out-of-range stages to the nearest valid step", () => {
    expect(fireComboStep(-3)).toEqual(fireComboStep(0));
    expect(fireComboStep(99)).toEqual(fireComboStep(2));
    expect(fireComboStep(1.9)).toEqual(fireComboStep(1));
  });
});
