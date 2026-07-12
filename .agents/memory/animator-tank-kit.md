---
name: Animator Tank/Centurion gunblade kit
description: How the slow-armoured gunblade+scutum Tank character is wired, and the speed-restore trap it exposed.
---

# Tank / Centurion (gunblade + scutum)

A procedural Explorer-rig character that is slow + damage-resistant + has a
stronger guard, wielding a gunblade (main) + roman scutum (off-hand). Reuses the
existing `"sword"` animSet (already a sword+shield stance) — NO new WeaponClass or
clip class was needed.

## Pattern: data-flagged bespoke kit (mirror arcane/kiter/kick)
- A new bruiser/caster archetype is a `Partial`-style data flag on `CharacterDef`
  (`tank?: TankKit`) + a `weaponId` gate in `useSkill`, branching to a private
  `do<Kit>Sig` dispatcher BEFORE the shared `skillCooldown` gate. Each sig slot
  has its own independent cooldown in `sigCooldowns[]` (armed via an `arm<Kit>Sig`
  helper that also spends stamina). This is the established kit shape — follow it.
- Signature `clip`/`kind` fields on the char are only HUD fallback pose/colour;
  the real behaviour is whatever clips the handler plays. Use clip VERBS that the
  reused animSet actually defines (sword set: `attack1..6`, `comboHit1-3`, `skill`,
  `dashAttack`, `stab`) — guard each with `hasClip()` so GLB rigs no-op cleanly.

## Stat wiring (no max-HP threading)
- Player max HP is owned by SparringCombat — do NOT thread a tank HP value.
  "Tankier / stronger block" = damage-mitigation MULTIPLIERS applied in
  `resolveOpponentStrike`: `damageTakenMul` always, `*blockDamageMul` while
  `this.blocking`; scale both `damage` and `poiseDamage` together.

## The speed-restore trap (cost an architect round)
- **Rule:** any transient speed change must restore to the character's *baseline*
  multiplier, never a bare `setSpeedMultiplier(1)`.
- **Why:** the Tank is permanently slow (`moveSpeedMul < 1`). The overextend/expose
  recovery and the Kiter phantom buff both reset to `1`, which silently strips the
  Tank's slowness after the first recovery window.
- **How to apply:** route every reset through a `baseSpeedMul()` helper
  (`getCharacter(id).tank?.moveSpeedMul ?? 1`). Spawn applies the penalty; the
  reset sites must read the same baseline.

## Adding a new WeaponId — full lockstep
Adding to the `WeaponId` union breaks several exhaustive `Record<WeaponId, …>`
maps that don't error until typecheck: at minimum the weapon's `WeaponDef`
(`arsenal/melee.ts`), `WEAPON_ICON` (`icons.ts`), and `WEAPON_COLOR`
(`voxel/types.ts`). Typecheck surfaces the rest.
