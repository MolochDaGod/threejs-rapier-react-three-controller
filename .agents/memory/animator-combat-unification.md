---
name: Animator combat unification (single epicfight authority)
description: How ALL Danger Room + dungeon + boss fights resolve through one @workspace/epicfight CombatController per fighter; what was retired.
---

# Single combat source of truth = epicfight CombatController

**Decision:** every combatant (player, each sparring enemy, each dungeon enemy, bosses)
owns exactly ONE `CombatController` from `@workspace/epicfight`. ALL damage + defense
resolve through `defenderCC.applyAttack(payload)`. There is exactly one AI driver per
enemy, and the player has one health (the player CC).

**Why:** the Danger Room previously ran TWO AI systems hitting the player
(`SparringCombat`'s abstract internal timer → playerCC, AND `Targets` per-dummy AI →
Studio.resolveOpponentStrike's bespoke PARRY_WINDOW/blockHeld) and TWO damage
authorities (epicfight CC for the ONE focused dummy vs. `d.health` + `combat.ts`
meleeStrike for everyone else). The dungeon was a third path (`dungeon/damage.ts`).
User asked to "unify everything now."

## Key insight that makes it tractable
`applyAttack` resolves defense from the defender CC's CURRENT state (block/parry/dodge/none)
and applies health/poise/stamina/crit/stagger INTERNALLY. So you do NOT need to rebuild
movesets to unify — attacks stay AI/combo-timed in the host; each defender just resolves
incoming hits via its own CC. Movesets can be `{id,light:[],heavy:[]}` (empty) when the CC
is only used as a defender + stat owner.

## Force model (integers; defaults block.force=parry.force=2)
- force 1 = light: block→blockStop, parry→deflect, dodge→evade.
- force 2 = heavy/finisher: equal-force elastic → still deflect/blockStop (0 dmg).
- force 3 + shieldBreak = player "R": block→stunned (guard break).
- force 4, NO shieldBreak = boss UNBLOCKABLE: breaks through block (full dmg), parry only
  halves (age in window), ONLY dodge i-frames fully evade. This is how "unblockable→force
  dodge" is expressed — high force, not a special flag.
shieldBreak gives 0 dmg but stuns the blocker; raw high force leaks damage through block.

## Retired as authorities
- `three/combat.ts` meleeStrike damage (keep only reach/radius GEOMETRY if needed).
- Studio `resolveOpponentStrike` bespoke block/PARRY_WINDOW/blockHeld → player defense now
  = `playerCC.applyAttack`.
- `SparringCombat` dummy CC + its internal AI timer (Targets per-dummy AI is the one AI).
- `dungeon/damage.ts` computeDamage.

## Shared helper
`three/combatModel.ts` — `makeFighterCC(archetype, events, overrides)` + per-archetype
configs (player/grunt/elite/boss) + `outcomeForceScale`/`isDefended` so knockback is 0 on
evade/parry, reduced on block, full on hit/crit. Archetype configs override
defaultCombatConfig.

## Attacker reaction wiring (don't forget)
After `defenderCC.applyAttack`, if `result.attackerReaction !== "none"` the ATTACKER's CC
must get `applyVulnerableState(result.attackerReaction)` (perfectParry→parried,
dodgePunish→dodgePunished). For player→enemy the attacker is playerCC; for enemy→player
it's that enemy's CC; for NPC-vs-NPC it's the striking dummy's CC.
