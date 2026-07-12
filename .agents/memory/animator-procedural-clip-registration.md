---
name: Animator procedural clip registration lockstep
description: The touchpoints that must change together to add a new FBX clip/verb to the Danger Room procedural (ExplorerCharacter) path.
---

# Adding a procedural movement/action clip to the animator (Danger Room)

A new Mixamo FBX clip is only reachable on the procedural rigs (ExplorerCharacter,
the chars with `procedural:true` in `assets.ts` — Explorer, Gunslinger). GLB chars
(Striker/orc/etc.) use native role clips and intentionally no-op on these verbs.

Wiring a clip end-to-end requires these touchpoints **in lockstep** (miss one and
it silently fails — `fromData`/resolve drop unknown ids, `hasClip` gates triggers):

1. Deploy the FBX to `public/anim/animations/<folder>/<kebab>.fbx` (movement/
   acrobatic clips live in `extra/`). Ids resolve to `${BASE}anim/<id>.fbx`.
2. `explorer/types.ts` — add the verb to the `ActionKey` union.
3. `explorer/clipCatalog.ts` — map the id. For class-independent movement, add to
   `UNIVERSAL_MOVEMENT` AND reference it in `WEAPON_SETS.unarmed.actions`, because
   `Animator.resolveMovement(key)` only falls back to the **unarmed** set (not the
   universal const directly). A weapon-specific move goes in that class's `actions`.
4. `explorer/Animator.ts` — play it. `playAction()` uses `resolve()` (per-class
   only); `movement()` uses `resolveMovement()` (with the unarmed fallback). Pick
   the matching one.
5. `ExplorerCharacter.ts` — add a `playClipOnce()` case AND add the verb to the
   `VERBS` array (VERBS gates `hasClip`/`clipNames`, so it's what makes the verb
   previewable and what the player-input guards check).
6. Player trigger (optional): `Studio.handleKey` forwards any code not consumed by
   `App.tsx` (Tab/KeyE/KeyC are eaten there first). Guard handlers with
   `if (!this.controller || !this.character) return;` (spawn is async) and
   `character.hasClip(...)` so GLB rigs no-op cleanly.

**Why:** the resolve chain has two distinct fallbacks (`resolve` per-class vs
`resolveMovement` → unarmed) and `VERBS` is a separate gate from the catalog, so a
clip can be in the catalog yet still be untriggerable. Both the pistol "kiter" kit
and the acrobatic movement set hit this same lockstep.
