---
name: EpicFight defensive combat model
description: Architecture and wiring rules for the parry/block/dodge/stun shared combat layer in @workspace/epicfight and the reaction-clip vocabulary in @workspace/animator.
---

# EpicFight defensive combat model

## The pure resolver
`lib/epicfight/src/combat/defense.ts` exports `resolveDefense(attack, defense, invincible)` — no globals, no randomness. The host calls it through `CombatController.applyAttack(payload)`, never directly. The attacker calls `buildAttackPayload()` to get the `AttackPayload` from the current `AttackMove`.

## Outcome flow
```
parry + age ≤ perfectWindow          → perfectParry  (attackerReaction = "parried")
parry + age ≤ deflectWindow          → deflect       (force comparison applies)
block + shieldBreak flag             → blockStop     (defenderReaction = "stunned", critWindow = true)
block + def.force ≥ atk.force        → blockStop
dodge + age ≤ DODGE_PUNISH_WINDOW    → dodgePunish   (attackerReaction = "dodgePunished")
dodge + invincible                   → dodgeEvade
equal forces (any non-none action)   → deflect       (elastic collision rule)
otherwise                            → hit / crit
```

**Why:** the elastic-collision rule (`atk.force === def.force` → deflect, no damage either side) is the spec from the equal-opposing-forces diagram; it applies ONLY when `defense.action !== "none"`.

## Crit window
`CombatController.applyVulnerableState(vs)` (host must call this on the ATTACKER's controller after reading `result.attackerReaction`) enters the matching state and opens a 2-second crit window. `applyHit` and `applyAttack` both auto-upgrade plain hits inside the window.

## How to apply (host wiring)
```typescript
// Attacker resolves a contact frame
const payload = attacker.buildAttackPayload();
if (payload && defender) {
  const result = defender.applyAttack(payload);
  if (result.attackerReaction !== "none") {
    attacker.applyVulnerableState(result.attackerReaction);
  }
  // play reaction clips via result.outcome
}
```

## Applying the resolved damage (host health)
The defender's physical health must be driven by `result.damageDealt` (0 when blocked/parried/dodged; full/half/crit otherwise) applied DIRECTLY onto that target at ITS own world position — never by a separate `damage=0` impulse + a "sync the CC's health onto the nearest body" step.

**Why:** in the Animator sparring room, routing dummy health through a single shared CC via `blast(center, …, 0, force)` + `syncHealthAt(focusedPos, getDummyHealth())` made player hits feel like they did nothing — the impulse keyed off a computed swing *center* point (which whiffs when the body is knocked back / out of a tight radius), and the sync had its own 3m gate. `applyAttack` already subtracts `result.damageDealt` from the CC internally, so applying the SAME number to the body keeps the HUD bar (`getDummyHealth`) in lockstep and the body dies (→ `resetDummy`) exactly when the CC does.

**How to apply:** after `processPlayerHit`, do `targets.blast(target.position, smallRadius, result.damageDealt, outcomePhysicsForce(result.outcome, baseForce))`. Center the blast on the TARGET, not on the abstract attack center, so the hit reliably lands.

## Animator reaction clips
`GLOBAL_REACTIONS` in `clipCatalog.ts` maps ActionKeys → `animations/reactions/*.fbx`. Use `resolveReaction(key)` to get the clip id. The 9 FBX files are in `artifacts/animator/public/anim/animations/reactions/`. `loader.ts` always includes `reactionClipIds()` so they preload for any weapon class.

**Universal locomotion fallback:** `UNIVERSAL_LOCO` and `UNIVERSAL_MOVEMENT` are named exports in `clipCatalog.ts`; weapon classes that lack directional loco or dodge/jump reference these directly instead of duplicating id strings.
