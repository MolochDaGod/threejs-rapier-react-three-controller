---
name: Animator weapon hold-style standard
description: Per-category (WeaponGroup) hold-style standard that owns grip, reach, combat defaults, AI fight band, guard pose, and guaranteed defensive clips.
---

`arsenal/holdStyle.ts` is the single source of truth for per-category weapon
behaviour, keyed by `WeaponGroup` (unarmed / melee-1h / melee-2h / off-hand /
ranged / magic). Each `HoldStyle` owns: canonical grip, businessReach, a default
`WeaponCombat`, `fightRange` (AI spacing band), a guard pose (+optional draw), and
a guaranteed `DefenseStyle` (block/parry/dodge/stumble/fall/recover).

**Rule:** per-weapon defs express only DEVIATIONS from their category. `WeaponDef.combat`
is `Partial<WeaponCombat>`; `weaponCombat(id)` = `resolveCombat` merges category
default + weapon partial. `WEAPON_GRIPS` falls back to the category grip via
`resolveGrip`. A weapon matching its category needs no `combat`/`grip` at all.

**Why:** numbers were duplicated across every weapon and ranged weapons carried a
tiny melee `range` that made the AI walk a bow into sword range. The standard
centralises the knobs and gives ranged a real kite distance.

**How to apply:**
- AI spacing (`Targets.ts`) derives engage/inner from `fightBand(getWeapon(id))`,
  NOT raw `combat.range`. Melee/magic return their strike band (feel unchanged);
  ranged returns `HOLD_STYLES.ranged.fightRange` (the kite band, ~[5,11]).
- "No silent no-ops": `resolveReaction` (clipCatalog) falls back to `stumble`;
  `Animator.reaction` chains `resolve → resolveGlobalAction → resolveReaction`.
  `defenseOutcomeClip`/`vulnerableReactionClip`/`defenseClips` map every resolver
  outcome/state/proactive-action to a real clip and are the SINGLE source the
  runtime reads — both player (Studio sparring callbacks + onPlayerHit recoils)
  and AI (Targets CC-state reactions + commitDefense), keyed by weapon group. Do
  not re-hardcode reaction clip keys in those paths. Covered by `holdStyle.test.ts`.
- Ready/guard pose on equip: `Animator.enterStance(pose, draw)` ←
  `ExplorerCharacter.readyPose(weaponId)` ← `Studio.applyWeaponAsync`. Avatar
  marks `readyPose?` optional; GLB rigs omit it and keep their own idle.
- All shipped weapons still declare full combat, so effective numbers are
  unchanged — the standard is additive until a def is trimmed to deviations.
