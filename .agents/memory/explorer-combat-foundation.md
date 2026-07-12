---
name: Explorer combat foundation
description: How the arcade Explorer cabinet's damage model, enemies, destructibles and damage numbers fit together.
---

# Explorer combat foundation (`artifacts/arcade/src/games/explorer/combat/`)

Single combat entry point: `stats.ts` `applyDamage(target: Durability, profile)`
resolves toughness soak + crit + lethal and **mutates `target.health` in place**.

- **Enemies have no flat `toughness` field** — toughness lives on `e.archetype`.
  To damage one, wrap it in a `Durability` (`{health, toughness: archetype.toughness}`),
  call `applyDamage`, then write `dur.health` back onto the enemy. Don't try to
  pass the `Enemy` directly (it won't satisfy `Durability`).
- Managers (`EnemyManager`, `DestructibleManager`, `DamageNumbers`) own ALL their
  own THREE meshes; the engine just constructs them, ticks `update()`, and calls
  `dispose()`. Damage numbers are in-world billboarded canvas sprites, pooled.
- Engine→managers wiring is one-directional: melee swing → `damageInRadius(center,
  reach, profile, knockFrom)`, projectiles → `hitTest(prev, pos, profile)` (nearest
  of enemy/destructible/terrain), slam impact → AOE `damageInRadius`.
- Store→engine is one-directional via setters: launcher pushes `game.power` through
  `engine.setCombatPower(power)`; engine surfaces `onPlayerHit`/`onEnemyKill`
  callbacks the launcher routes into `game.damage()` / `game.gainXp()`.

**Why:** keeps the engine self-contained and the damage math testable/pure, and
avoids a second coupling direction (engine reaching into the RPG store).

**How to apply:** route any NEW damage source (traps, new weapons) through
`applyDamage` + the manager `damageInRadius`/`hitTest` surface — never subtract
health ad hoc. Dispose combat managers BEFORE the VFX manager + scene sweep
(see vfx-quarks-lib).
