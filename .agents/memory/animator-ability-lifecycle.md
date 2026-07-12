---
name: Animator ability lifecycle orchestrator
description: The data-driven AbilityDef + AbilityOrchestrator pattern for Grudge combat abilities, and how to migrate a Studio path onto it without changing behavior.
---

# Ability lifecycle pattern (`src/three/abilities/`)

A declarative `AbilityDef` (pure data) + a tiny per-cast `AbilityOrchestrator`
state machine that runs **cast → release → travel → impact → status**. The
orchestrator owns timing/ordering + the travel fail-safe and delegates every
engine-side effect to per-cast `AbilityHooks` closures the host supplies. All
three modules are pure (`import type` only, NO `three`, NO `@workspace/*`) so
they unit-test directly.

## How the phases bind
- The orchestrator is a **pure sequencer**: it fires whatever hooks are present
  (`onCast?.()` etc). It does NOT inspect `def.impact`/`def.status` to decide
  whether to call `onImpact`/`onStatus` — only `def.travel` changes structure
  (adds the travel wait). So a no-status ability simply omits `onStatus`.
- `cast.duration === 0` → release + onTravel fire **synchronously inside
  `cast()`** (same tick), so an instant ability behaves identically to the old
  inline call.
- travel waits for the host to report a hit via the `onTravel(hit)` callback, or
  forces `onImpact(null)` after `maxFlight` (fail-safe). A late hit after the
  fail-safe is ignored.

## Migrating a Studio path without behavior drift
**Why:** verification is typecheck + pure vitest only (no runtime, no
screenshots — they error out), so the wiring must be provably identical.
**How to apply:**
- Call `this.abilities.update(dt)` **adjacent to `updatePending(dt)`** with the
  same `dt` — that makes orchestrator-driven impacts land on the same frame as
  the legacy `this.schedule(...)` they replace.
- For a delayed melee impact, compute the runtime delay first, then spread the
  registry def and override `cast.duration` with it: `{ ...base, cast: { ...base.cast, duration: runtimeDelay } }`. Keep dash/streak/cooldown/stamina
  inline in the Studio wrapper; only the delayed resolution moves into `onImpact`.
- Add `this.abilities.cancelAll()` everywhere `this.pending.length = 0` runs
  (character swap + dispose) so stale closures can't fire after teardown.
- `statusAbility(id, kind, aoe)` is the single source for buff/debuff defs;
  `kind` may be undefined → scope falls back to `self`, mirroring the old
  `applyStatus` default. `applyStatusScoped` must keep the aoe→ally→self
  fallthrough chain exactly.

## Pure-VFX skills route through the orchestrator too
**Why:** the aimed sigs (meteor/darkBlades/swordVolley/soul/laser), caster
F-skills, and generic weapon F-skills produce their projectile + landing visuals
ENTIRELY in the `Vfx` subsystem — there is no orchestrator-owned travel/impact.
**How to apply:** use `vfxSkill(kind, color, opts?)` (registry) for an instant
cast and put the single `vfx.playSkill(...)` call in the `onCast` hook (NOT
onTravel — onTravel only fires when `def.travel` is set, so a no-travel kind
would never launch). cast.duration 0 means playSkill fires synchronously inside
`cast()`, identical to the old inline call. `color` is passed in from the host's
`SKILL_COLOR` so the registry stays pure. `travel` in `vfxSkill` opts is
descriptive only (lingers activeCount for maxFlight, drives nothing).

Migrated: fireDragon sig + bowSlash + buff + debuff (proof), then all aimed sig
spells, `doDashSkill` (delayed AoE → impact hook via `dashSkill` registry def),
caster F-skill + generic weapon F-skill (vfxSkill + onCast), AND the four bespoke
per-character sig kits (pistol-kiter / arcane-soulbinder / gunblade-tank /
kick-striker) + `doFireCombo`. Kit migration used `kitAbility(id, kind, color,
delay)` (registry) — builds `{id:`kit:${id}`, target:"aimed", cast.duration:delay}`;
each delayed `this.schedule(delay, cb)` became `this.abilities.cast(kitAbility(...),
{ onImpact: cb })` with the callback body kept verbatim (incl. internal guards).
Nested casts pushed during the orchestrator's update for..of are visited the same
frame (fine — no infinite loop). `doFireCombo` has no schedule; its travel-owned
VFX launch (castDragonAt/castMeteor) was wrapped in `vfxSkill + onCast` for
consistency. Kept inline per kit: dash/streak/cooldown/stamina (armSig etc.) and
instant casts with no delayed resolution (e.g. doKickSig0 = dash + instant bolt).

Then the self-contained single-delayed-impact combat verbs were migrated the same
`kitAbility(id, kind, color, delay)` + `{ onImpact: cb }` way (body verbatim,
dash/clip/cooldown stay inline): `doHeavyAttack` (shield-break), `utilityKick`,
`throwBomb`, `healPotion`, `headbutt`, `stomp`, `aerialDaggerSlash`. `kind`/`color`
are descriptive only here.

## Deploy phase: persistent entities (turret / gadget)
**Why:** a deployed entity is NOT a one-shot `cast→impact` — it stands for a
lifetime and fires a repeating, self-re-targeting effect on its own schedule.
**How to apply:** set `AbilityDef.deploy = {life, firstTick, interval, ticks}`
(built by `deployAbility(id, kind, color, {life, firstTick, interval, tail?})`,
which derives `ticks = max(1, floor((life - tail) / interval))` so it matches the
legacy volley count). The lifecycle becomes `deploy → tick* → expire`, replacing
cast/travel/impact/status. Host hooks: `onDeploy` (spawn visuals, fires sync
inside `cast()`), `onTick(at)` (one repeating effect; re-acquire the target HERE —
the orchestrator never touches targeting), `onExpire` (optional teardown). The
orchestrator owns only the lifetime + tick schedule; `advanceDeploy` accumulates
`elapsed` and fires every due tick in a `while` loop (a big `dt` drains several at
once, like the old schedule), then expires once `elapsed >= life`. Because
`abilities.update(dt)` runs adjacent to `updatePending(dt)` with the same `dt`,
each tick lands on the same frame the legacy `schedule(firstTick + v*interval, …)`
bank would — frame-for-frame contract is unit-tested.

Migrated: **turret** (`deployTurret`) — `onDeploy = spawnTurret`, `onTick =
fireTurretVolley` (re-acquires nearest enemy at fire time), `life = TURRET_LIFE`,
`firstTick = 0.5`, `interval = TURRET_VOLLEY_GAP`, `tail = 0.4`, no onExpire (the
VFX turret self-times its own disappearance). Kept inline INSIDE `fireTurretVolley`:
the per-bolt `schedule(i * 0.16, …)` stagger — cosmetic intra-volley fan-out, same
precedent as `fireSkyfall` per-bolt launches (covered by teardown anyway).

## Intentionally still inline (NOT orchestrator-shaped)
**Why:** these `this.schedule(...)` callers are not single ability casts, so
forcing them through `cast→impact` would be a category error or a large unrelated
surface change. Leave them on `this.schedule` (already covered by teardown — both
sites run `this.pending.length = 0` adjacent to `this.abilities.cancelAll()`).
- **`scheduleComboHit`-based moves** (the core attack combo, `stab`, the dash
  skills at the combo sites): all route through the ONE shared combo-hit resolver.
  Migrating `stab` in isolation means duplicating that body; migrating the resolver
  itself drags in the whole primary-combo system — out of scope for "stragglers".
- **Reaction-recovery animation chains** (`playPlayerReaction` getUp/kipUp/fallen/
  knockedOut/wallCrash, `defeatPlayer` respawn, the onPlayerVulnerable fall→kipUp
  and blockStop wall-crash schedules): these chain clip A → clip B over time; they
  are animation sequencing, not an ability cast → impact.
- **`fireSkyfall` per-bolt staggered launches** and **`applyRangeConsequence`
  slow-mo / expose-window restores**: cosmetic multi-bolt VFX fan-out and
  time-scale/speed-multiplier restores, not impact resolutions (and not in scope).
