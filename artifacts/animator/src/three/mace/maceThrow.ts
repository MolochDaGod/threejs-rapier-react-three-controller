/**
 * Pure state machine for the Flanged Mace's signature throw (slot "4").
 *
 * Lifecycle: `idle` → `outbound` (the mace flies to the aimed point) → on
 * arrival it stuns the target and flips to `returning` (the mace flies back to
 * the hand) → `caught` → `idle`. Pressing the key again while the mace is OUT
 * (either flight phase) recalls it instantly and dashes the player to it instead
 * of waiting for the return — a gap-closer.
 *
 * The machine owns ONLY phase + timing. All world positions, VFX and damage are
 * the engine's responsibility: it reads {@link phase} / {@link progress} each
 * frame and reacts to the {@link MaceThrowEvent}s returned by {@link press} and
 * {@link step}. A fail-safe watchdog guarantees the out-state always returns to
 * idle, so the held weapon can never deadlock (lost target, stuck flight, etc.).
 */
export type MacePhase = "idle" | "outbound" | "returning";

export interface MaceThrowConfig {
  /** Flight time (s) from the hand out to the aimed point. */
  outbound: number;
  /** Flight time (s) back from the target to the hand. */
  inbound: number;
  /** Max total time (s) the mace may be out before a forced recall. */
  failSafe: number;
}

export const DEFAULT_MACE_THROW: MaceThrowConfig = {
  outbound: 0.32,
  inbound: 0.3,
  failSafe: 3,
};

/**
 * A side effect the engine must apply this step (positions/VFX live engine-side):
 * - `impact` — the mace reached the target: stun + impact VFX; now returning.
 * - `caught` — the mace is back in hand: restore the held weapon + drop the mesh.
 * - `dash`   — re-press while out: dash the player to the mace (then `caught`).
 */
export type MaceThrowEvent = "impact" | "caught" | "dash";

export class MaceThrowMachine {
  private _phase: MacePhase = "idle";
  /** Elapsed seconds in the current flight phase. */
  private t = 0;
  /** Total seconds the mace has been out (fail-safe watchdog). */
  private total = 0;

  constructor(private readonly cfg: MaceThrowConfig = DEFAULT_MACE_THROW) {}

  get phase(): MacePhase {
    return this._phase;
  }

  /** True while the mace is in flight (outbound or returning). */
  get isOut(): boolean {
    return this._phase !== "idle";
  }

  /** 0..1 progress through the current flight phase (0 while idle). */
  progress(): number {
    if (this._phase === "outbound") return clamp01(this.t / this.cfg.outbound);
    if (this._phase === "returning") return clamp01(this.t / this.cfg.inbound);
    return 0;
  }

  /**
   * Press the slot-4 key. From idle it launches the throw (the engine then sets
   * up the flight + hides the held weapon) and returns no events. While the mace
   * is out it recalls + dashes, returning `["dash", "caught"]`.
   */
  press(): MaceThrowEvent[] {
    if (this._phase === "idle") {
      this._phase = "outbound";
      this.t = 0;
      this.total = 0;
      return [];
    }
    this.resetToIdle();
    return ["dash", "caught"];
  }

  /** Advance the flight timers; returns any transition events for this step. */
  step(dt: number): MaceThrowEvent[] {
    if (this._phase === "idle") return [];
    this.t += dt;
    this.total += dt;
    // Watchdog: never let the out-state linger past its budget.
    if (this.total >= this.cfg.failSafe) {
      this.resetToIdle();
      return ["caught"];
    }
    if (this._phase === "outbound" && this.t >= this.cfg.outbound) {
      this._phase = "returning";
      this.t = 0;
      return ["impact"];
    }
    if (this._phase === "returning" && this.t >= this.cfg.inbound) {
      this.resetToIdle();
      return ["caught"];
    }
    return [];
  }

  /**
   * Forced teardown (weapon swap, death, dungeon/room change, dispose). Returns
   * true when the mace was out — so the engine restores the held weapon + clears
   * the flying mesh. Safe (and a no-op) to call when already idle.
   */
  cancel(): boolean {
    const wasOut = this._phase !== "idle";
    this.resetToIdle();
    return wasOut;
  }

  private resetToIdle() {
    this._phase = "idle";
    this.t = 0;
    this.total = 0;
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
