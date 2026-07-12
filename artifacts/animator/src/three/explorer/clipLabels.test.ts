import { describe, expect, it } from "vitest";
import { VERBS, VERB_CATEGORY, verbLabel, humanizeClipId } from "../ExplorerCharacter";

describe("clip library labels & categories", () => {
  it("every preview verb has a built-in category (none silently fall to 'Other')", () => {
    const uncategorized = VERBS.filter((v) => !(v in VERB_CATEGORY));
    expect(uncategorized).toEqual([]);
  });

  it("humanizeClipId drops paths, splits camelCase/digits, and Title-Cases", () => {
    expect(humanizeClipId("animations/sword/outward-slash")).toBe("Outward Slash");
    expect(humanizeClipId("jumpAttack")).toBe("Jump Attack");
    expect(humanizeClipId("meleeCombo1")).toBe("Melee Combo 1");
    expect(humanizeClipId("blockReactWide")).toBe("Block React Wide");
  });

  it("verbLabel applies overrides for acronyms / awkward verbs, humanises the rest", () => {
    expect(verbLabel("mmaKick")).toBe("MMA Kick");
    expect(verbLabel("kipUp")).toBe("Kip-Up");
    expect(verbLabel("gestureRelievedSigh")).toBe("Relieved Sigh");
    expect(verbLabel("pistolWhip")).toBe("Pistol Whip");
  });

  it("labels every verb to a non-empty string", () => {
    for (const v of VERBS) expect(verbLabel(v).length).toBeGreaterThan(0);
  });
});
