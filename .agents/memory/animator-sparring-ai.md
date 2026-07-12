---
name: Animator Danger Room sparring AI
description: How difficulty-scaled AI opponents share the player's combat math in the self-contained animator artifact.
---

# Danger Room sparring AI

The Danger Room (`artifacts/animator`, preview `/animator/`) replaced passive
training dummies with difficulty-scaled AI sparring opponents WITHOUT breaking the
existing public API of `Targets`/`TargetHandle` (blast/launch/raycast/nearest/
aliveCount/onDeath/group/dispose preserved; blast/launch gained an optional ctx arg).

**Decision layer is a goal-driven brain; combat contract is untouchable.** The old
hand-rolled `idle/approach/windup/recover` switch inside `Targets.updateAi` was
replaced by a Yuka-style brain in `src/three/ai/` (`Goal`+`CompositeGoal` lifecycle,
`Think` arbitrator with desirability evaluators + a small commit bonus, and
`FighterBrain` with Idle/Engage/Attack/Defend/Reposition goals). The brain core is
**pure decision logic** over a `FighterAgent` adapter (no Three.js / no `@workspace`
imports) so it's unit-tested against a mock agent. `Targets.equipBrain(d)` builds the
agent: a mutable `FighterPerception` snapshot the host refreshes each frame + opaque
`FighterActions` hooks that close over `this`+`d` and route into the UNCHANGED combat
contract (`executeStrike`/`commitDefense`/`meleeStrike`). **Never let the brain touch
engine state directly** — add a perception field or action hook instead. Reaction
latency is gated INSIDE the goals (`AttackGoal`/`DefendGoal` wait `agent.reactionDelay`
before committing), replacing the old `decision`/`reactT` dummy fields. Reset the brain
(`d.brain?.reset()`) on revive + difficulty switch.

**Interrupting the brain must drop the in-flight goal, not just `d.state`.** When
`updateAi` early-returns on a busy CC state (hitstun/committed move:
`stagger|stunned|fallen|dodge|parry|dead`), it MUST call `d.brain.reset()` before
standing down. Setting `d.state = "idle"` alone is not enough: a stateful goal like
`AttackGoal` keeps its internal `phase`/timer, so after hitstun it would resume a stale
wind-up and fire a strike with no fresh telegraph (and `d.state` desyncs from the goal
phase). `reset()` → `removeAllSubgoals()` → each subgoal's `terminate()`; that's why
`AttackGoal.terminate()` calls `cancelWindup()` when `phase === "windup"`. **Why:** any
goal carrying multi-tick committed state needs an explicit interrupt path; the CC state
flag is not the goal's source of truth.

**Shared combat math is the contract.** `src/three/combat.ts` owns `aoeFalloff(dist,
radius)` + `meleeStrike(...)` → `{reach, radius, damage, force}`. BOTH the player's
combo (`Studio.scheduleComboHit` → `targets.blast`) and each opponent strike
(brain `releaseStrike` → `Targets.executeStrike` → `ctx.dealToPlayer` →
`Studio.resolveOpponentStrike`) run the same falloff so damage feels symmetric. Do
not fork separate damage formulas.

**Difficulty lives in data, not branches.** `DIFFICULTY_PROFILES` in `Targets.ts`
keys `passive|easy|medium|hard` → windup / approachSpeed / attackInterval / skillChance
(engine tuning) PLUS `aggression`+`caution` (brain bias weights that bend the Attack /
Defend evaluators; the old flat `defendChance` is gone — defense now emerges from the
caution bias × a telegraph-driven desirability). `passive` = inert training-dummy
behaviour (AI gate is `difficulty !== "passive" && playerAlive`; brain bias zeroes out).

**Coupling is one-way through `SparringContext`.** `Targets` never imports `Studio`;
the engine passes a `SparringContext` into `targets.update(dt, ctx)` each frame with
`playerPos` (chest = root.y + 1.0), `playerAlive` (false while downed/invuln so
opponents hold off), `dealToPlayer`, and optional VFX hooks `onWindup`/`onStrike`/
`onDefend`. Keep new opponent→player effects flowing through this interface.

**Player defense.** RMB hold = block (`onMouseDown` btn2 + window `mouseup` +
`contextmenu` preventDefault — remember to remove all three in dispose). A block
within `PARRY_WINDOW` (~0.32s of hold) fully negates + staggers the attacker; a
held block heavily mitigates but drains stamina and only protects from the front
(facing dot check). Player death → `defeatPlayer` schedules a heal + i-frame respawn.

**Crowd-control is real, not cosmetic.** `Targets` dummies carry per-target
`stunT`/`shieldBreakT` timers (defaults `STUN_SECONDS`/`SHIELD_BREAK_SECONDS`
exported from `Targets.ts`). `stun(center,radius,sec)` freezes a target (skips AI +
drops wind-up) and `shieldBreak(...)` strips its block/parry/dodge; both gate the
defence roll in `hit()`. The Kiter sigs (Smoke Phantom, Bear Trap, Hexaring Beam)
apply the real status AND pass the same duration to the `stunMark` VFX `life` so the
floating-star/shatter marks line up with the status timer. Keep `markStun` applying
status + VFX together.

**Ranged spell casts follow the same brain/contract split.** AI fighters can cast
the player's aimed projectile spells (`fireDragon/meteor/darkBlades/swordVolley` —
NOT `turret`, a stationary deploy, excluded by design) via a `CastGoal` +
`castEvaluator` in `FighterBrain` (perception `spellReady`/`spellRange`, actions
`beginCast`/`tickCast`/`releaseCast`/`cancelCast`, mirroring the Attack goal's
wait→charge→release + `terminate()`→`cancelCast` interrupt). Pacing is **host-side
data, not the CC**: `CombatController` has no public stamina-spend, so casts gate on
a difficulty-scaled `spellCd` cooldown + a `stamina01 > 0.3` floor (`spellCd` reset
on spawn/revive with jitter so a ring doesn't volley at once). The release routes
through a new `SparringContext.castSpell(kind, from, target, onImpact)` hook
implemented in `Studio.sparCtx` (builds fwd/quat → `Vfx.playSkill(...,onImpact)`);
`Vfx.playSkill` gained an optional `onImpact` threaded into the aimed cast methods'
existing `onHit` slot. Damage resolves at the projectile's landing point via the
SAME `aoeVictims`/`dealToPlayer`/`blastFaction` path as melee skills (faction-aware,
radius falloff → side-stepping the aim point dodges it). The existing `onWindup`
telegraph doubles as the readable cast tell. **Why:** keep all opponent→player
ability flow inside the perception/action + `SparringContext` contract; never let
the brain touch the engine or fork a second damage formula.

**AI casts are weapon-aware, and only onImpact-wired kinds deal damage.** A
fighter's combat role is derived from its weapon's metadata (`WeaponDef.combatRole`
→ else `group === "ranged"` → else melee) by the pure helper `src/three/ai/weaponRole.ts`,
which yields a per-fighter profile (role, spellRange, comboMax, castKind, castCdScale)
stored on the `Dummy` at `makeDummy` and read by perception (`spellRange`/`comboMax`)
+ `brainBeginCast` (`castKind`) + the `spellCd` recast (× `castCdScale`). Ranged fighters
kite + loose `laser`; thrown (the javelin, `combatRole:"thrown"` on a melee-group def)
hurl `swordVolley`; melee fall back to a random `SPELL_KINDS` pick. **Critical:** the
AI cast path only does real damage for SkillKinds whose `Vfx.playSkill` case forwards
the passed `onImpact` — `fireDragon/meteor/darkBlades/swordVolley/soul/laser/turret`.
The simple visual kinds (`muzzle/bolt/thrust/slash/slam/nova`) IGNORE `onImpact`, so
never pick them as an AI `castKind` (the fighter would whiff forever). Combo cap is now
`AttackGoal.maxHits = round(1 + aggression*(comboMax-1)/2)` which reduces to the legacy
`round(1+aggression)` at the default cap of 3, so light 1H weapons chain to 4 and
ranged/thrown (cap 1) never chain. **Why:** weapon identity must drive AI play, but the
damage contract is gated on which VFX cases honour the impact callback — a coherent-but-
silent kind is a live trap.

**Verify manually.** Headless WebGL fails in this artifact, so CI = `pnpm --filter
@workspace/animator-app run typecheck` + restart `artifacts/animator: web` + curl
`localhost:80/animator/` for 200. Drive block/parry/respawn by hand. The animator
vitest suite has 6 PRE-EXISTING failures (TelegraphField in `telegraph.test.ts` +
`fx/Indicators.test.ts`: `document is not defined` — canvas-using tests with no
jsdom env); they fail in isolation and are unrelated to AI/combat changes.

**A fighter's transient "recover" needs a durable timer for opponents to read.**
A dummy's post-swing `state === "recover"` is overwritten within a frame by its own
movement actions (`brainAdvance/Retreat/Strafe` set `state` to approach/idle), so an
opponent's `targetRecovering` perception read off `state` is loop-order-dependent and
mostly misses. Carry a dedicated `recoverT` timer set alongside the recover beat in
`executeStrike` and ticked down independently; opponents read `recoverT > 0`. The
player's equivalent whiff signal is `Studio.recoverLock > 0`, surfaced via
`SparringContext.playerRecovering`. **Why:** perception flags must derive from durable
timers, never from an enum that other per-frame actions mutate.
