import type { AnimRole, SkillKind, StatusId } from "../types";

/**
 * Data-driven ability / effect lifecycle definitions.
 *
 * This module is deliberately PURE: it imports only `import type` symbols (which
 * are erased at build time) and pulls in nothing from `three` or any
 * `@workspace/*` package, so the schema + the {@link AbilityOrchestrator} that
 * consumes it are unit-testable in plain vitest without a WebGL context.
 *
 * An {@link AbilityDef} describes the SHAPE of a cast — which phases exist
 * (cast → release → travel → impact → status), their timing, and the bindings
 * (animation, colors, status) each phase carries. The actual rendering / physics
 * work is supplied per cast by the host as {@link AbilityHooks} closures, so the
 * orchestrator never touches engine internals; it only sequences the phases and
 * guarantees the travel fail-safe.
 */

/** Minimal positional shape; `THREE.Vector3` is structurally assignable to it. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** How an ability acquires its impact point. */
export type AbilityTargetShape = "self" | "aimed" | "aoe";

/** Which travelling-effect family carries the projectile to its impact point. */
export type TravelMotion = "dragon" | "darkBlades";

/**
 * Who a status phase is applied to:
 * - `self`     — the caster.
 * - `ally`     — the selected ally (falls back to self).
 * - `hostile`  — the selected hostile (falls back to self).
 * - `aoeAlly`  — every ally in range (falls back to selected ally, then self).
 */
export type StatusScope = "self" | "ally" | "hostile" | "aoeAlly";

/** The animation a cast binds to (a logical role and/or an exact clip name). */
export interface AbilityAnim {
  role?: AnimRole;
  clip?: string;
  fade?: number;
}

/** Charge / wind-up phase: a delay before release, with an optional cast aura. */
export interface AbilityCastPhase {
  /** Seconds the wind-up lasts before the effect releases (0 = release now). */
  duration: number;
  /** When set, a charge-up aura of this color (hex) is spawned at cast start. */
  auraColor?: number;
}

/** Travel phase: a projectile flies to its impact point. */
export interface AbilityTravelPhase {
  motion: TravelMotion;
  /** Override color (hex) for the projectile; defaults to {@link AbilityDef.color}. */
  color?: number;
  /**
   * Fail-safe seconds: if the travelling effect never reports a hit (its async
   * `onHit` was dropped — e.g. the host scene was torn down mid-flight), the
   * orchestrator forces the impact phase after this long so a cast can never
   * deadlock in flight.
   */
  maxFlight: number;
}

/** Impact phase: a one-shot blast at the landing point. */
export interface AbilityImpactPhase {
  /** Override color (hex) for the impact burst; defaults to {@link AbilityDef.color}. */
  color?: number;
  /** Impact burst scale. */
  scale?: number;
}

/** Status phase: a buff/debuff aura applied at the end of the lifecycle. */
export interface AbilityStatusPhase {
  id: StatusId;
  scope: StatusScope;
}

/**
 * Deploy phase: a persistent autonomous entity (turret / gadget) — NOT a one-shot
 * cast. Unlike `cast → impact`, a deployed ability stands for `life` seconds and
 * fires a repeating effect on its own schedule: the first tick after `firstTick`,
 * then one every `interval`, for `ticks` total. Each tick re-acquires its own
 * target (the host's {@link AbilityHooks.onTick} supplies the re-acquire + the
 * effect), so the orchestrator owns only the lifetime + tick schedule, never the
 * targeting. When set, the lifecycle is `deploy → tick* → expire` and the cast/
 * travel/impact/status phases are unused.
 */
export interface AbilityDeployPhase {
  /** Total seconds the deployed entity persists before it expires. */
  life: number;
  /** Seconds after deploy before the first tick fires. */
  firstTick: number;
  /** Seconds between repeating ticks. */
  interval: number;
  /** Total number of ticks fired over the lifetime. */
  ticks: number;
}

/** A single ability described entirely as data. */
export interface AbilityDef {
  id: string;
  name: string;
  /** The weapon/skill kind this ability presents as (drives default behaviour). */
  kind: SkillKind;
  /** Base color (hex) used by phases that don't override it. */
  color: number;
  target: AbilityTargetShape;
  /** Animation played at cast start. */
  anim?: AbilityAnim;
  /** Charge / wind-up before release. Omit (or duration 0) for an instant cast. */
  cast?: AbilityCastPhase;
  /** Projectile travel before impact. Omit for instant (melee / self) abilities. */
  travel?: AbilityTravelPhase;
  /** Impact burst. Omit when the travel effect owns its own landing VFX. */
  impact?: AbilityImpactPhase;
  /** Buff/debuff applied at lifecycle end. */
  status?: AbilityStatusPhase;
  /**
   * Deployed persistent entity (turret / gadget). When set, the ability runs the
   * `deploy → tick* → expire` lifecycle instead of `cast → impact`; the cast /
   * travel / impact / status phases are ignored.
   */
  deploy?: AbilityDeployPhase;
}

/**
 * Per-cast work supplied by the host. Every hook is optional: the orchestrator
 * calls only the ones present, in lifecycle order. The hook bodies (closures
 * built by the host at cast time) capture the snapshotted positions / gameplay
 * for THIS cast, so several casts can be in flight at once without clashing.
 */
export interface AbilityHooks {
  /** Wind-up start: play the cast animation + any charge aura. */
  onCast?(): void;
  /** Wind-up finished, effect leaves the caster (e.g. a release flourish). */
  onRelease?(): void;
  /**
   * Launch the travelling effect. Call the provided `hit` when it lands; if it
   * is never called the orchestrator forces impact via the travel fail-safe.
   */
  onTravel?(hit: (at: Vec3Like | null) => void): void;
  /** The effect lands. `at` is the reported hit point, or null for instant casts. */
  onImpact?(at: Vec3Like | null): void;
  /** Apply the buff/debuff status. */
  onStatus?(): void;
  /** Spawn the deployed entity (its visuals). Fires once, synchronously, at deploy. */
  onDeploy?(): void;
  /**
   * One repeating tick of the deployed entity (re-acquire its target + fire). It
   * fires once per scheduled tick; `at` is the scheduled tick time (seconds since
   * deploy) the orchestrator reached.
   */
  onTick?(at: number): void;
  /** The deployed entity's lifetime ends. Fires once at expiry. */
  onExpire?(): void;
}

/** Lifecycle phases, in order, as the orchestrator advances through them. */
export type AbilityPhase = "cast" | "travel" | "deploy" | "done";
