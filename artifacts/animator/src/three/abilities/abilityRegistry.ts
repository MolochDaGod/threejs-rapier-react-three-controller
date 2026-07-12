import type { SkillKind, StatusId, StatusKind } from "../types";
import type { AbilityDef, AbilityTargetShape, TravelMotion } from "./abilityTypes";

/**
 * Seed library of {@link AbilityDef}s used by the Studio's data-driven ability
 * lifecycle. Pure data — no `three`, no `@workspace/*`. Colors are plain hex and
 * mirror `THEME` / `SKILL_COLOR` so the migrated abilities render identically to
 * their pre-refactor inline paths.
 */

/** Mirrors `THEME.fireDragon` / `SKILL_COLOR.fireDragon`. */
const COLOR_FIRE_DRAGON = 0xff6a1e;
/** Mirrors `THEME.slash` / `SKILL_COLOR.slash`. */
const COLOR_SLASH = 0x9fe8ff;

/**
 * Aimed fire-dragon signature spell — the projectile archetype. Exercises the
 * cast → release → travel lifecycle. The launch is instant (`duration: 0`) and
 * the dragon's own blast-on-arrival is owned by the travel effect, so both the
 * cast aura and `impact` are omitted — the player cast stays cosmetic, matching
 * the pre-refactor path exactly.
 */
const fireDragonSig: AbilityDef = {
  id: "fireDragonSig",
  name: "Fire Dragon",
  kind: "fireDragon",
  color: COLOR_FIRE_DRAGON,
  target: "aimed",
  cast: { duration: 0 },
  travel: { motion: "dragon", maxFlight: 3 },
};

/**
 * Bow F-skill lunging slash — the melee archetype. A wind-up (lunge + streak)
 * then a delayed impact that lands the hit + a movement-slow debuff at the
 * lunge endpoint. The wind-up duration models the original scheduled impact
 * delay; the gameplay (blast + slow) is supplied via the impact hook.
 */
const bowSlash: AbilityDef = {
  id: "bowSlash",
  name: "Bow Slash",
  kind: "slash",
  color: COLOR_SLASH,
  target: "aimed",
  anim: { clip: "animations/sword/great-sword-slide-attack", role: "attack", fade: 0.08 },
  cast: { duration: 0.187 },
};

/**
 * Generic dash signature skill — the lunge archetype. A short wind-up (the body
 * eases forward along a spline while the real skill clip plays) then a delayed
 * AoE blast at the lunge endpoint. The wind-up duration is overridden at cast
 * time with the runtime slide delay; the dash / streak / cooldown / stamina stay
 * inline in the Studio wrapper and only the delayed blast moves into the impact
 * hook (mirrors the {@link bowSlash} timed-melee recipe).
 */
const dashSkill: AbilityDef = {
  id: "dashSkill",
  name: "Dash Skill",
  kind: "slash",
  color: COLOR_SLASH,
  target: "aimed",
  cast: { duration: 0.231 },
};

/** Mirrors the snare field's themed color (a sickly tar-green zone marker). */
const COLOR_SNARE_FIELD = 0x86e3a0;

/**
 * Snare field deployable — the support / zone-control counterpart to the turret,
 * and the second user of the `deploy → tick* → expire` lifecycle. It stands for
 * `life` seconds and, each `interval`, re-pulses a movement slow + chip damage on
 * every enemy in range (each pulse re-acquires its targets in the host's
 * `onTick`). Seeded here so its deploy tick / lifetime shape is single-sourced
 * and unit-testable, exactly like the turret's volley count was. `ticks` derives
 * from the lifetime via {@link deployAbility} (`floor((life - tail) / interval)`,
 * min 1).
 */
const snareFieldDeploy: AbilityDef = deployAbility("snareField", "nova", COLOR_SNARE_FIELD, {
  life: 6.0,
  firstTick: 0.4,
  interval: 0.8,
  tail: 0.4,
});

/** Static, id-addressable abilities (projectile + melee + deploy archetypes). */
export const ABILITIES: Record<string, AbilityDef> = {
  [fireDragonSig.id]: fireDragonSig,
  [bowSlash.id]: bowSlash,
  [dashSkill.id]: dashSkill,
  [snareFieldDeploy.id]: snareFieldDeploy,
};

/** Look up a static ability definition by id. */
export function getAbility(id: string): AbilityDef | undefined {
  return ABILITIES[id];
}

/**
 * Register (or replace) a runtime-authored ability so {@link getAbility} can
 * resolve it by id. Used by the Dressing Room's AI assistant to add abilities
 * built from the {@link statusAbility} / {@link vfxSkill} builders to the same
 * library the Studio reads from — no new behaviour, just a new entry.
 */
export function registerAbility(def: AbilityDef): void {
  ABILITIES[def.id] = def;
}

/**
 * Build a buff/debuff ability definition for a status id. Buffs target the
 * caster's allies (`aoeAlly` when `aoe`, else `ally`); debuffs target the
 * selected hostile; any unknown/undefined kind falls back to `self` (mirroring
 * the pre-refactor `applyStatus` default). Status auras are instant (no cast /
 * travel / impact) — they exercise only the lifecycle's status phase. `kind`
 * selects the scope so it is derived from the status, not guessed.
 */
export function statusAbility(id: StatusId, kind: StatusKind | undefined, aoe = false): AbilityDef {
  const scope = kind === "buff" ? (aoe ? "aoeAlly" : "ally") : kind === "debuff" ? "hostile" : "self";
  return {
    id: `status:${id}`,
    name: id,
    kind: "nova",
    color: 0xffffff,
    target: aoe ? "aoe" : "self",
    status: { id, scope },
  };
}

/**
 * Build an instant, VFX-owned skill ability for a model-/effect-driven kind
 * whose projectile + landing visuals are produced entirely by the `Vfx`
 * subsystem (`Vfx.playSkill`). The orchestrator only sequences a synchronous
 * launch — the host plays the VFX in the cast hook — so there is no
 * orchestrator-owned wind-up, impact, or status. An optional `travel` phase is
 * descriptive only (the projectile arc + blast stay owned by the VFX effect);
 * it exercises the lifecycle's travel motion without changing launch timing.
 *
 * Used by the aimed signature spells (meteor / dark-blades / sword-volley /
 * soul / laser), the caster F-skill, and the generic weapon F-skill. `color` is
 * passed in from the host's `SKILL_COLOR` palette so this module stays pure.
 */
export function vfxSkill(
  kind: SkillKind,
  color: number,
  opts: { target?: AbilityTargetShape; travel?: TravelMotion; maxFlight?: number } = {},
): AbilityDef {
  const def: AbilityDef = {
    id: `vfx:${kind}`,
    name: kind,
    kind,
    color,
    target: opts.target ?? "self",
    cast: { duration: 0 },
  };
  if (opts.travel) def.travel = { motion: opts.travel, maxFlight: opts.maxFlight ?? 3 };
  return def;
}

/**
 * Build a delayed-impact ability for a bespoke per-character signature kit
 * (pistol "Kiter" / arcane "Soulbinder" / gunblade "Tank" / kick "Striker").
 * These kits own their dash / streak / cooldown / stamina inline; only each
 * delayed effect resolution — the old `schedule(delay, …)` callback — moves into
 * the orchestrator's impact phase so it shares the lifecycle + `cancelAll`
 * teardown. `delay` is the runtime wind-up before the effect resolves (0 = the
 * same tick, matching an instant inline call); the impact lands at exactly the
 * delay the legacy `schedule` used because the orchestrator's `update` runs with
 * the same `dt`, adjacent to `updatePending`. `kind` / `color` are descriptive
 * only — the resolution VFX + gameplay are supplied by the host's `onImpact`
 * hook, so the orchestrator never inspects them for these casts.
 */
export function kitAbility(id: string, kind: SkillKind, color: number, delay: number): AbilityDef {
  return {
    id: `kit:${id}`,
    name: id,
    kind,
    color,
    target: "aimed",
    cast: { duration: Math.max(0, delay) },
  };
}

/**
 * Build a deployable-entity ability (turret / gadget): a persistent autonomous
 * entity that stands for `life` seconds and fires a repeating, self-re-targeting
 * effect — the first after `firstTick`, then one every `interval` — over its
 * lifetime. The tick count is derived from the lifetime exactly as the legacy
 * turret did (`floor((life - tail) / interval)`, min 1, where `tail` is the
 * dead-time at the end where no further tick fits) so the migrated deploy fires
 * the same number of volleys at the same times. The host supplies the spawn
 * visuals (`onDeploy`), each volley (`onTick`, which re-acquires its target),
 * and optional teardown (`onExpire`); the orchestrator owns only the lifetime +
 * the tick schedule, never the targeting. `kind` / `color` are descriptive only.
 */
export function deployAbility(
  id: string,
  kind: SkillKind,
  color: number,
  opts: { life: number; firstTick: number; interval: number; tail?: number },
): AbilityDef {
  const ticks = Math.max(1, Math.floor((opts.life - (opts.tail ?? 0)) / opts.interval));
  return {
    id: `deploy:${id}`,
    name: id,
    kind,
    color,
    target: "aoe",
    deploy: { life: opts.life, firstTick: opts.firstTick, interval: opts.interval, ticks },
  };
}
