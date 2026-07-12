---
name: Animator target indicators + AOE telegraph
description: Durable lessons for under-foot faction discs, dual hostile/ally targeting, and AOE telegraphs in the Danger Room.
---

# Target indicators, dual targeting, AOE telegraph

## Recoloring the shared ring GLB (the non-obvious bit)
The shared ring template's material has a baked warm base color. **Multiplicative
tinting crushes cool tints (blue/green) against it.** Recolor by using the GLB
texture as an `alphaMap` (shape mask) on a fresh additive `MeshBasicMaterial` with
a flat color tint. Per-instance discs clone ONLY the material — never dispose the
shared template geometry/texture.
**Why:** preserves the silhouette while letting any tint read true.

## AOE telegraph = skill swings, not just bosses
"AOE attacks" in this engine are the **skill swings** (`pendingSkill`): `meleeStrike`
gives a skill a larger area radius than a basic swing. Telegraph EVERY skill strike
(yellow blink → solid red → resolve), not only boss skills; basic swings stay
instant single-target. Boss skills are just the unblockable (force-4) subset routed
through the same path.

**Resolve at impact, not at schedule.** The telegraph fires its `onResolve` ~1 s
later; that callback must do BOTH the damage (player + `blastFaction(...,"ally")`
splash) AND the impact/VFX (`onStrike`). Firing VFX when the telegraph is *scheduled*
makes the explosion precede the damage. Both resolvers are radius-aware (`aoeFalloff`),
so resolving against everyone is safe — units outside the circle at resolve take nothing.

**Capture `pendingSkill` before it resets.** `executeStrike` sets `d.pendingSkill =
false` at its end (synchronously), but the resolve closure runs a second later. Read
the flag into a local (`wasSkill`) up front; the deferred closures must see THIS
strike's value, not the next swing's.

## Offensive abilities follow the red (selected) hostile
Player offensive target acquisition must PREFER the Tab-selected hostile, not just
cone/nearest. Both the melee resolver and the ability cone-pick route through it: use
the selected hostile when it's a live enemy within the ability's range (honored even
if another enemy is nearer/better-aligned or outside the aim cone), and fall back to
cone/nearest only when nothing is selected or it's out of range. Friendly casts route
to the green ally; offensive casts to the red hostile.

## Optional cross-cutting interface methods
Ally/hostile selection accessors, `selectedHostilePoint`, `indicatorSnapshot`, and the
group accessors are **optional** on the shared combat-targets interface so the second
implementation (dungeon enemies) still conforms without edits — callers use `?.()`.

## Pure, testable combat helpers
The headless test env has no WebGL and the engine classes load GLBs, so the
non-obvious decisions are extracted as pure functions in `combat.ts` and unit-tested
there: force tier (boss skill unblockable), faction-aware AoE victims, and the
"prefer selected hostile in range" gate. Keep new combat-decision logic pure for the
same reason.

## Status cast routing
Status application routes by the status `kind`: buff → selected ally anchor, debuff →
selected hostile anchor, else self. The aura follows its target via a per-status
`() => Vector3` anchor passed into `apply(id, anchor?)`, not a self fallback.
