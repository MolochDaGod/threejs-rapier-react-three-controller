import type { AbilityDef, AbilityHooks, AbilityPhase, Vec3Like } from "./abilityTypes";

/**
 * A single in-flight cast tracked by the {@link AbilityOrchestrator}.
 */
interface ActiveCast {
  def: AbilityDef;
  hooks: AbilityHooks;
  phase: AbilityPhase;
  /** Seconds remaining in the current timed phase (cast wind-up / travel fail-safe). */
  timer: number;
  /** Whether the travelling effect has reported a landing. */
  hit: boolean;
  /** Reported landing point (or null when forced by the fail-safe). */
  hitAt: Vec3Like | null;
  /** Deploy phase only: seconds elapsed since the entity was deployed. */
  elapsed: number;
  /** Deploy phase only: scheduled time of the next tick to fire. */
  nextTick: number;
  /** Deploy phase only: ticks still to fire over the remaining lifetime. */
  ticksLeft: number;
}

/**
 * Drives an {@link AbilityDef} through its lifecycle: cast → release → travel →
 * impact → status. It is a PURE state machine — it owns timing + ordering + the
 * travel fail-safe, and delegates every engine-side effect to the per-cast
 * {@link AbilityHooks} closures the host passes to {@link cast}. It never imports
 * `three` or any `@workspace/*` package, so it can be unit-tested directly.
 *
 * Phase mapping:
 * - `cast`   — `onCast` fires immediately; if `def.cast.duration > 0` the machine
 *              waits that long before releasing, otherwise it releases on the
 *              same tick (instant abilities: melee / buff / debuff).
 * - release  — `onRelease` fires once the wind-up completes.
 * - `travel` — present only when `def.travel` is set; `onTravel` launches the
 *              projectile and the machine waits for the reported hit (or the
 *              `maxFlight` fail-safe) before impacting.
 * - impact   — `onImpact(at)` fires at the landing point (`at` is null for
 *              instant casts or a forced fail-safe).
 * - status   — `onStatus` fires last, applying any buff/debuff.
 * - `deploy` — present only when `def.deploy` is set (turret / gadget). Replaces
 *              the cast → impact path entirely: `onDeploy` spawns the entity now,
 *              `onTick` fires the repeating self-re-targeting effect on schedule,
 *              and `onExpire` fires once the lifetime ends.
 */
export class AbilityOrchestrator {
  private active: ActiveCast[] = [];

  /**
   * Begin a cast. `onCast` fires synchronously; instant abilities (no travel,
   * zero wind-up) run their entire lifecycle within this call.
   */
  cast(def: AbilityDef, hooks: AbilityHooks): void {
    const rec: ActiveCast = {
      def,
      hooks,
      phase: "cast",
      timer: def.cast?.duration ?? 0,
      hit: false,
      hitAt: null,
      elapsed: 0,
      nextTick: 0,
      ticksLeft: 0,
    };
    this.active.push(rec);
    // A deployed entity (turret / gadget) runs its own lifetime + repeating tick
    // schedule, not the one-shot cast → impact path: spawn it now, then advance
    // its ticks in `update`.
    if (def.deploy) {
      rec.phase = "deploy";
      rec.nextTick = def.deploy.firstTick;
      rec.ticksLeft = def.deploy.ticks;
      hooks.onDeploy?.();
      return;
    }
    hooks.onCast?.();
    if (rec.timer <= 0) this.release(rec);
  }

  /** Number of casts currently mid-lifecycle (excludes finished ones). */
  get activeCount(): number {
    return this.active.filter((r) => r.phase !== "done").length;
  }

  /** Drop every in-flight cast (e.g. on a hard scene reset). */
  cancelAll(): void {
    this.active.length = 0;
  }

  /** Advance every in-flight cast by `dt` seconds. */
  update(dt: number): void {
    for (const rec of this.active) {
      if (rec.phase === "cast") {
        rec.timer -= dt;
        if (rec.timer <= 0) this.release(rec);
      } else if (rec.phase === "travel") {
        rec.timer -= dt;
        if (rec.hit) this.impact(rec, rec.hitAt);
        else if (rec.timer <= 0) this.impact(rec, null);
      } else if (rec.phase === "deploy") {
        this.advanceDeploy(rec, dt);
      }
    }
    if (this.active.some((r) => r.phase === "done")) {
      this.active = this.active.filter((r) => r.phase !== "done");
    }
  }

  /** Wind-up complete: launch travel, or impact immediately for instant casts. */
  private release(rec: ActiveCast): void {
    rec.hooks.onRelease?.();
    if (rec.def.travel) {
      rec.phase = "travel";
      rec.timer = rec.def.travel.maxFlight;
      rec.hooks.onTravel?.((at) => {
        // Ignore a late/duplicate report once the cast has already impacted.
        if (!rec.hit && rec.phase === "travel") {
          rec.hit = true;
          rec.hitAt = at ?? null;
        }
      });
    } else {
      this.impact(rec, null);
    }
  }

  /** Terminal step: impact burst (if any) then status (if any). */
  private impact(rec: ActiveCast, at: Vec3Like | null): void {
    rec.hooks.onImpact?.(at);
    rec.hooks.onStatus?.();
    rec.phase = "done";
  }

  /**
   * Advance a deployed entity by `dt`: fire every tick whose scheduled time the
   * accumulated lifetime has now reached (a single oversized `dt` can fire more
   * than one — exactly like the legacy schedule draining several due entries in
   * one frame), then expire once the full `life` has elapsed. Each tick re-acquires
   * its own target inside the host's `onTick`, so the orchestrator never touches
   * targeting; it only owns the lifetime + the repeating schedule.
   */
  private advanceDeploy(rec: ActiveCast, dt: number): void {
    const deploy = rec.def.deploy!;
    rec.elapsed += dt;
    while (rec.ticksLeft > 0 && rec.elapsed >= rec.nextTick) {
      rec.hooks.onTick?.(rec.nextTick);
      rec.nextTick += deploy.interval;
      rec.ticksLeft -= 1;
    }
    if (rec.elapsed >= deploy.life) {
      rec.hooks.onExpire?.();
      rec.phase = "done";
    }
  }
}
