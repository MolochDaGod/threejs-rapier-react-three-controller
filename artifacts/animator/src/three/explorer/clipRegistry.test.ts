import { describe, expect, it } from "vitest";
import {
  CLIP_REGISTRY,
  CLIP_CATEGORY_ORDER,
  CLIP_BY_VERB,
  CLIP_CATEGORIES,
  VERBS,
  PREVIEW_VERB_KEYS,
  VERB_CATEGORY,
} from "./clipRegistry";
import { WEAPON_SETS, allReferencedClipIds, resolveActionAnywhere } from "./clipCatalog";
import type { WeaponClass } from "./types";

/**
 * CLIP_REGISTRY is the single source of truth for the Explorer rig's clip verbs.
 * These tests pin the contract the old 6-place lockstep used to risk silently
 * breaking: every verb is unique, resolves to a REAL loaded clip on EVERY weapon
 * class, and the derived tables (VERBS / PREVIEW_VERB_KEYS / categories) stay in
 * sync — so a verb can never preview correctly yet no-op (or fire a generic
 * attack) in combat, and a new verb can't ship half-wired.
 */
describe("clip registry (single source of truth)", () => {
  const referenced = new Set(allReferencedClipIds());
  const ALL_CLASSES = Object.keys(WEAPON_SETS) as WeaponClass[];
  const LIBRARY = CLIP_REGISTRY.filter((e) => e.library !== false);

  it("has no duplicate verbs", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const e of CLIP_REGISTRY) {
      if (seen.has(e.verb)) dupes.push(e.verb);
      seen.add(e.verb);
    }
    expect(dupes).toEqual([]);
  });

  it("resolves every registry key to a real, loaded clip (default resolution)", () => {
    const broken: string[] = [];
    for (const e of CLIP_REGISTRY) {
      const id = resolveActionAnywhere(e.key);
      if (!id || !referenced.has(id)) broken.push(`${e.verb} -> ${e.key} -> ${id}`);
    }
    expect(broken).toEqual([]);
  });

  it("resolves every registry key on EVERY weapon class (class-first then global)", () => {
    const broken: string[] = [];
    for (const e of CLIP_REGISTRY) {
      for (const cls of ALL_CLASSES) {
        const id = WEAPON_SETS[cls].actions[e.key] ?? resolveActionAnywhere(e.key);
        if (!id || !referenced.has(id)) broken.push(`${cls}:${e.verb} -> ${e.key} -> ${id}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("VERBS equals the library verbs and all map into PREVIEW_VERB_KEYS", () => {
    expect(VERBS).toEqual(LIBRARY.map((e) => e.verb));
    expect(VERBS.filter((v) => !(v in PREVIEW_VERB_KEYS))).toEqual([]);
    // PREVIEW_VERB_KEYS carries no extra (combat-only) verbs.
    expect(Object.keys(PREVIEW_VERB_KEYS).filter((v) => !VERBS.includes(v))).toEqual([]);
  });

  it("every library verb has a category in CLIP_CATEGORY_ORDER and lands in exactly one group", () => {
    const order = new Set<string>(CLIP_CATEGORY_ORDER);
    expect(LIBRARY.filter((e) => !(e.verb in VERB_CATEGORY)).map((e) => e.verb)).toEqual([]);
    expect(Object.values(VERB_CATEGORY).filter((c) => !order.has(c))).toEqual([]);
    const counts = new Map<string, number>();
    for (const g of CLIP_CATEGORIES) for (const v of g.verbs) counts.set(v, (counts.get(v) ?? 0) + 1);
    expect([...counts.entries()].filter(([, n]) => n > 1).map(([v]) => v)).toEqual([]);
  });

  it("formerly-broken global/reaction verbs resolve to their OWN clip, not the attack path", () => {
    // Regression guard for the fixed bug: jump/block/parry/reactions used to fall
    // through playClipOnce's default branch and fire a generic attack(). They must
    // now be plain "clip" verbs (shared preview resolution) mapping to their own
    // same-named animation — never the basic attack clip.
    const formerlyBroken = [
      "jump",
      "block",
      "blockGuard",
      "blockLeft",
      "blockRight",
      "blockReact",
      "blockReactWide",
      "blockReactHeavy",
      "parry",
    ];
    const attackId = resolveActionAnywhere("attack1");
    for (const verb of formerlyBroken) {
      const e = CLIP_BY_VERB.get(verb);
      expect(e, `${verb} missing from registry`).toBeTruthy();
      expect(e!.play, `${verb} must use the shared "clip" path (no explicit strategy)`).toBeUndefined();
      const id = resolveActionAnywhere(e!.key);
      expect(id, `${verb} -> ${e!.key} must resolve to a real clip`).toBeTruthy();
      expect(id, `${verb} must not collapse to the basic attack clip`).not.toBe(attackId);
    }
  });

  it("CLIP_BY_VERB covers every verb, with combat-only dodges hidden from the library", () => {
    for (const e of CLIP_REGISTRY) expect(CLIP_BY_VERB.get(e.verb)).toBe(e);
    for (const d of ["dodgeF", "dodgeB", "dodgeL", "dodgeR"]) {
      expect(CLIP_BY_VERB.has(d)).toBe(true);
      expect(VERBS).not.toContain(d);
    }
  });
});
