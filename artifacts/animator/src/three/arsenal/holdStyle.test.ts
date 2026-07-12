import { describe, expect, it } from "vitest";
import type { DefensiveOutcome, VulnerableState } from "@workspace/epicfight";
import { resolveReaction } from "../explorer/clipCatalog";
import { getWeapon } from "../assets";
import { WEAPONS } from "../arsenal";
import type { WeaponGroup } from "../types";
import {
  HOLD_STYLES,
  defenseClips,
  defenseOutcomeClip,
  fightBand,
  guardedHitClip,
  holdStyle,
  resolveCombat,
  resolveGrip,
  vulnerableReactionClip,
} from "./holdStyle";

const GROUPS: WeaponGroup[] = ["unarmed", "melee-1h", "melee-2h", "off-hand", "ranged", "magic"];
const OUTCOMES: DefensiveOutcome[] = ["deflect", "perfectParry", "blockStop", "dodgeEvade", "dodgePunish", "hit", "crit"];
const STATES: VulnerableState[] = ["stunned", "fallen", "parried", "dodgePunished", "none"];

describe("hold-style standard", () => {
  it("defines a complete style for every weapon group", () => {
    for (const g of GROUPS) {
      const s = HOLD_STYLES[g];
      expect(s.category).toBe(g);
      expect(s.businessReach).toBeGreaterThan(0);
      expect(s.fightRange[0]).toBeLessThanOrEqual(s.fightRange[1]);
      expect(s.combat.range[0]).toBeLessThanOrEqual(s.combat.range[1]);
    }
  });

  it("maps EVERY defensive outcome to a real, resolvable clip (no silent no-ops)", () => {
    for (const g of GROUPS) {
      for (const o of OUTCOMES) {
        const key = defenseOutcomeClip(g, o);
        // resolveReaction guarantees a real clip id (falls back to stumble).
        expect(resolveReaction(key)).toBeTruthy();
      }
    }
  });

  it("maps every losing vulnerable state (except none) to a resolvable clip", () => {
    for (const g of GROUPS) {
      for (const st of STATES) {
        const key = vulnerableReactionClip(g, st);
        if (st === "none") {
          expect(key).toBeNull();
        } else {
          expect(key).not.toBeNull();
          expect(resolveReaction(key!)).toBeTruthy();
        }
      }
    }
  });

  it("guarantees all six canonical defense clips per category", () => {
    for (const g of GROUPS) {
      const d = defenseClips(g);
      for (const key of [d.block, d.parry, d.dodge, d.stumble, d.fall, d.recover]) {
        expect(resolveReaction(key)).toBeTruthy();
      }
    }
  });

  it("maps every guarded-hit side to a real clip, distinct per direction", () => {
    for (const g of GROUPS) {
      const left = guardedHitClip(g, "left");
      const right = guardedHitClip(g, "right");
      const front = guardedHitClip(g, "front");
      // Each direction resolves to a real, loadable reaction clip.
      for (const key of [left, right, front]) {
        expect(resolveReaction(key)).toBeTruthy();
      }
      // Left and right are genuinely distinct sides (not collapsed to one clip).
      expect(left).not.toBe(right);
      // The frontal react is the category's own guarded-hit clip.
      expect(front).toBe(defenseClips(g).blockReact);
    }
  });

  it("gives ranged a true kite band, well beyond melee strike reach", () => {
    const ranged = fightBand({ group: "ranged", combat: { range: [0.6, 1.4] } });
    const melee = fightBand({ group: "melee-1h", combat: { range: [1, 2] } });
    expect(ranged[0]).toBeGreaterThan(melee[1]);
    // The kite band must NOT collapse to the tiny melee butt-strike range.
    expect(ranged[0]).toBeGreaterThanOrEqual(5);
  });

  it("melee/magic fight bands still track their strike reach", () => {
    expect(fightBand({ group: "melee-2h", combat: { range: [1.6, 3] } })).toEqual([1.6, 3]);
    expect(fightBand({ group: "magic", combat: { range: [1, 2.2] } })).toEqual([1, 2.2]);
  });

  it("resolveCombat merges a partial deviation over the category default", () => {
    const base = holdStyle("melee-1h").combat;
    // No deviation → exactly the category default.
    expect(resolveCombat({ group: "melee-1h" })).toEqual({
      intensity: base.intensity,
      direction: base.direction,
      range: [base.range[0], base.range[1]],
    });
    // Partial deviation → only the declared field changes; the rest inherit.
    const merged = resolveCombat({ group: "melee-1h", combat: { range: [1.6, 3] } });
    expect(merged.intensity).toBe(base.intensity);
    expect(merged.direction).toBe(base.direction);
    expect(merged.range).toEqual([1.6, 3]);
  });

  it("resolveGrip falls back to the category grip when a weapon declares none", () => {
    const styleGrip = holdStyle("melee-1h").grip;
    expect(resolveGrip({ group: "melee-1h" })).toEqual(styleGrip);
    const own = { main: { rot: [0.1, 0.2, 0.3] as [number, number, number], pos: [0, 0, 0] as [number, number, number] } };
    expect(resolveGrip({ group: "melee-1h", grip: own })).toBe(own);
  });

  it("keeps every shipped weapon's effective combat profile intact", () => {
    // Every current weapon declares a full combat profile, so resolving through
    // the standard must reproduce its declared numbers verbatim.
    for (const w of WEAPONS) {
      const declared = getWeapon(w.id).combat;
      if (!declared || declared.intensity === undefined) continue;
      const resolved = resolveCombat(w);
      expect(resolved.intensity).toBe(declared.intensity);
      expect(resolved.direction).toBe(declared.direction);
      expect(resolved.range).toEqual(declared.range);
    }
  });
});
