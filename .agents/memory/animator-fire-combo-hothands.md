---
name: Animator Hot Hands fire-combo
description: How the caster's chained F-key fire spell-combo ("Hot Hands") is wired into Studio/Vfx/combat, and the constraints a similar chained ability must follow.
---

# Hot Hands fire spell-combo

The arcane caster (Soulbinder: `def.arcane`, `weaponId === "staff"`, procedural,
colliderVfx) has a chained 3-stage fire combo on its **F key** — `useSkill()` with
no signature index. The four sig slots stay soul-themed; F is a separate fire kit.

## Where a chained F-key ability hooks in

`useSkill(signatureIndex?)` resolves bespoke kits **before** the shared
`if (this.skillCooldown > 0) return false` gate. The four existing kits
(kick/kiter/arcane-sig/tank) all branch on `isSig`. A non-sig F-key channel must
branch on `!isSig` in that same pre-gate block (e.g.
`if (def.arcane && weaponId === "staff" && !isSig) return this.doFireCombo()`), so
it **bypasses the shared skillCooldown** and uses its own combo lock instead. The
generic F-skill fallthrough below the gate is only reached when no bespoke kit claims it.

**Why:** a combo chain can't gate on `skillCooldown` (a per-cast cooldown would
break the chain), and a lingering cooldown from a previously-played character must
not block it. The bespoke kits already established the "own-lock, bypass-gate" pattern.

## Combo-state constraints (mirror the kick combo)

A new `xComboIndex/xComboTimer/xComboLock` trio must, in lockstep:
- decrement in the per-frame update loop, resetting the index when the timer hits 0;
- be reset in `recoverFromFail` (clear timer AND index) so a blocked/parried/dodged
  offense doesn't let a stale chain continue;
- gate re-press on the lock (`fireComboLock`/`recoverLock`), not on damage.
Stage tuning is a **pure** helper in `combat.ts` (`fireComboStep`, clamped 0-2) +
unit-tested — orchestration (clips, projectiles, blast/launch) stays in Studio,
matching the repo convention of keeping combat-decision data pure and testable.

## Reuse, don't reinvent

- `pickTargetInFront(origin, fwd, range, minDot)` already prefers the Tab-selected
  red hostile — it IS the "@target" behavior; don't hand-roll selection.
- Force = `sparringBlast(center, radius, dmg, params.skillForce * mul)` (knockback)
  + `targets.launch(center, radius, 0, upVel)` (vertical pop on a finisher).
- The casting hand world pose is `colliderPose()?.pos` (only non-null when the def
  has `colliderVfx`); fall back to root + ~1.3m.
- `Vfx.hotHands(pos,color,scale)` is owned-instances only (Points + a core mesh +
  castSwirl) — safe to self-dispose; it does NOT clone shared GLB templates, so it
  sidesteps the shared-template disposal hazard (see animator-glb-vfx.md).
