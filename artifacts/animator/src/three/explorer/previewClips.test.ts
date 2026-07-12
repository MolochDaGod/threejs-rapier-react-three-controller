import { describe, expect, it } from "vitest";
import { VERBS, PREVIEW_VERB_KEYS } from "../ExplorerCharacter";
import {
  WEAPON_SETS,
  allReferencedClipIds,
  resolveActionAnywhere,
} from "./clipCatalog";
import type { WeaponClass } from "./types";

/**
 * The Dressing Room "Rig clips" library must play a REAL, same-named animation
 * for every verb it lists, regardless of the equipped weapon — no no-ops and no
 * generic-attack fallbacks. These tests pin that contract: each verb maps to an
 * action key, and that key resolves to a clip the rig actually loads.
 */
describe("Dressing Room rig-clip preview", () => {
  const referenced = new Set(allReferencedClipIds());
  const ALL_CLASSES = Object.keys(WEAPON_SETS) as WeaponClass[];

  it("maps every listed verb to a preview clip key (lockstep with VERBS)", () => {
    const unmapped = VERBS.filter((v) => !(v in PREVIEW_VERB_KEYS));
    expect(unmapped).toEqual([]);
  });

  it("resolves every verb to a real, loaded clip of the same name", () => {
    const broken: string[] = [];
    for (const verb of VERBS) {
      const key = PREVIEW_VERB_KEYS[verb];
      const id = resolveActionAnywhere(key);
      if (!id || !referenced.has(id)) broken.push(`${verb} -> ${key} -> ${id}`);
    }
    expect(broken).toEqual([]);
  });

  it("plays a real clip for every verb on EVERY equipped weapon class", () => {
    // previewClip resolves the equipped class first, then falls back across all
    // classes/globals. Whatever the loadout, the resolved id must be a real clip.
    const broken: string[] = [];
    for (const weapon of ALL_CLASSES) {
      for (const verb of VERBS) {
        const key = PREVIEW_VERB_KEYS[verb];
        const id = WEAPON_SETS[weapon].actions[key] ?? resolveActionAnywhere(key);
        if (!id || !referenced.has(id)) broken.push(`${weapon}/${verb}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
