---
name: Voxel melee combat (play mode)
description: How EpicFight-style melee is wired in voxel-engine play mode — event-driven intents vs. resolver, impact-feel channels, telegraph, view animation.
---

# EpicFight-style melee in voxel-engine play mode

The old `EpicFightCombatSystem` (a standalone `@workspace/epicfight` sparring
dummy) was **removed/superseded** by a real gameplay melee layer where the
creature population are the enemies. The design is intent → resolver, fully
event-driven over the engine EventBus, so it works first- AND third-person.

## The split (don't merge these responsibilities)

- **PlayerController = intent.** Owns combat state (stamina/combo/guard/dodge
  i-frames/special cooldown) and reads input. It emits *requests*, never resolves
  damage: `combat:melee` (LMB; combo, dash-attack when sprint+moving),
  `combat:guard{active}` (hold), `combat:dodge{dir}` (i-frames + `Controls.applyDash`),
  `combat:special{origin,radius,damage}`, `combat:parry{origin,dir}` (guard within
  `PARRY_WINDOW` of a hit), plus `combat:dashattack`/`combat:hit`. Snapshot carries
  `stamina/maxStamina/combo/guarding/specialReady` for the HUD.
- **MeleeCombatSystem = resolver.** Holds the `CreatureSystem` ref (like
  `ProjectileSystem`). Ray-marches `combat:melee` (stops at first solid voxel so
  swings don't reach through walls), combo finisher cleaves via `damageInRadius`;
  `combat:special` is an AoE; `combat:parry` staggers. On every connect it fires
  the impact-feel channels.

## Impact feel — three channels, fired by the resolver

- `combat:impact {pos,kind}` → CombatVfxSystem draws the hit (already subscribed).
- `fx:hitstop {seconds}` → Engine freezes sim dt for a brief window.
- `fx:shake {intensity}` → Engine applies a decaying random camera offset.
  Knockback rides `damageCreature(c, dmg, {knockDir, knockStrength})`.

## Non-obvious rules

- **LMB melee is hooked in `PlayerController.onMouseDown` (button 0), NOT off
  `held:swing`.** `held:swing` is an animation cue emitted by many paths (mine,
  place, fire, cast); meleeSwing() itself *emits* `held:swing` for the view. A
  left click both mines a block AND requests a melee — the resolver only damages
  a creature actually in reach, so clicking terrain still just mines.
- **Hostile creature melee telegraphs.** `CreatureSystem` adds a `windup` timer:
  on reaching the player it plants + plays "attack", and the hit only lands when
  the wind-up elapses *and* the player is still in (slightly extended) reach — so
  dodge/guard/parry during the telegraph avoids it. Damage is no longer dealt the
  instant it enters reach.
- **View systems only animate** (T007): ThirdPersonCharacter subscribes
  `combat:guard/dodge/special/dashattack/hit` → animator `block/roll/skill/
  dashAttack/hit`; HeldItemView eases a first-person guard pose on `combat:guard`.
  They never resolve damage.
- **`KeyF` is `Controls.toggleFly`.** Default combat keys: guard `KeyG`, dodge
  `KeyX`, special `KeyR` (all in `settings.ts` keybinds, schema bumped to 3,
  rebindable; applied via `PlayerController.setCombatKeys` in both the fresh-engine
  apply block and the settings-change effect in Workspace).
- **Bosses** are spawnable through the existing `CreatureSystem.spawn(BOSS_DEFS)`
  — no separate boss system; BOSS_DEFS already exported from the barrel.
- Puter guest gate blocks headless Playwright/screenshots — verify combat feel
  manually.
