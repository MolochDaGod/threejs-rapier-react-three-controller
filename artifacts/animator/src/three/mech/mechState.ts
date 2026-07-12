/**
 * Pure suit-up / exit state machine for the Exo-Armour Mech Mode.
 *
 * This module is deliberately PURE: it imports nothing from `three` or any
 * `@workspace/*` package, so the transformation logic can be unit-tested in
 * plain vitest without a WebGL context. The owning {@link MechSystem} reads the
 * snapshot each frame and applies the visual / gameplay consequences (cloning
 * the armour, hiding the pilot, swapping control to the mech).
 *
 * Lifecycle: `idle → opening → enclosing → piloted → exiting → idle`.
 *  - opening   — the armour appears and assembles around the (still-visible) pilot.
 *  - enclosing — the armour closes; partway through, the pilot is hidden inside.
 *  - piloted   — full mech control; the pilot stays enclosed.
 *  - exiting   — the armour re-opens; the pilot reappears and is released at the end.
 */

export type MechPhase = "idle" | "opening" | "enclosing" | "piloted" | "exiting";

/** Seconds each timed transition phase lasts. */
export interface MechTimings {
  /** Armour assembles / appears around the pilot. */
  opening: number;
  /** Armour closes around the pilot (pilot is hidden partway through). */
  enclosing: number;
  /** Armour re-opens and releases the pilot. */
  exiting: number;
}

export const DEFAULT_MECH_TIMINGS: MechTimings = {
  opening: 0.9,
  enclosing: 0.7,
  exiting: 0.9,
};

/**
 * Closure fraction (0 = fully open, 1 = fully closed) at/after which the pilot is
 * considered sealed inside the armour and is hidden. Shared by the enclosing
 * (rising) and exiting (falling) phases so the pilot hides/reappears at the same
 * visual threshold both ways.
 */
export const ENCLOSE_THRESHOLD = 0.6;

/** Read-only view of the machine the owner consumes each frame. */
export interface MechSnapshot {
  phase: MechPhase;
  /** 0..1 progress through the current timed phase (1 for idle / piloted). */
  progress: number;
  /** Assembly amount: 0 = fully open/absent, 1 = fully closed around the pilot. */
  closure: number;
  /** The pilot character mesh should be visible. */
  pilotVisible: boolean;
  /** The mech mesh should be present in the scene. */
  mechVisible: boolean;
  /** The pilot is sealed inside (closure ≥ {@link ENCLOSE_THRESHOLD}). */
  enclosed: boolean;
  /** Player input should drive the MECH rather than the pilot. */
  mechControlled: boolean;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Smoothstep ease for a less mechanical assemble/close feel. */
const ease = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * The transformation state machine. Construct one per Studio session; drive it
 * with {@link enter}/{@link exit}/{@link toggle} and advance it with
 * {@link update}. All visual + gameplay effects are derived from {@link snapshot}.
 */
export class MechStateMachine {
  private phase: MechPhase = "idle";
  /** Seconds elapsed in the current timed phase. */
  private elapsed = 0;
  private readonly timings: MechTimings;

  constructor(timings: MechTimings = DEFAULT_MECH_TIMINGS) {
    this.timings = { ...timings };
  }

  /** Current lifecycle phase. */
  get current(): MechPhase {
    return this.phase;
  }

  /** True whenever the armour is present (any non-idle phase). */
  get isActive(): boolean {
    return this.phase !== "idle";
  }

  /** True only in the fully-piloted phase (mech under player control). */
  get isPiloted(): boolean {
    return this.phase === "piloted";
  }

  /** True while a transition (open/close) is mid-flight (not idle, not piloted). */
  get isTransitioning(): boolean {
    return this.phase === "opening" || this.phase === "enclosing" || this.phase === "exiting";
  }

  /**
   * Begin suiting up. Only valid from `idle`; returns true if the transition
   * started, false if a mech is already active/transitioning (idempotent).
   */
  enter(): boolean {
    if (this.phase !== "idle") return false;
    this.phase = "opening";
    this.elapsed = 0;
    return true;
  }

  /**
   * Begin exiting. Only valid from the fully-piloted phase; returns true if the
   * exit started. Mid-transition requests are ignored (no abort), so a half-open
   * armour always finishes its current move first.
   */
  exit(): boolean {
    if (this.phase !== "piloted") return false;
    this.phase = "exiting";
    this.elapsed = 0;
    return true;
  }

  /**
   * Convenience toggle: enter from idle, exit from piloted, ignore otherwise.
   * Returns the action taken (or null when ignored mid-transition).
   */
  toggle(): "enter" | "exit" | null {
    if (this.phase === "idle") return this.enter() ? "enter" : null;
    if (this.phase === "piloted") return this.exit() ? "exit" : null;
    return null;
  }

  /** Force the machine straight back to idle (e.g. on character swap / teardown). */
  forceIdle(): void {
    this.phase = "idle";
    this.elapsed = 0;
  }

  /** Advance timed phases by `dt` seconds. Idle / piloted are steady states. */
  update(dt: number): void {
    if (dt <= 0) return;
    if (this.phase === "idle" || this.phase === "piloted") return;
    this.elapsed += dt;
    const dur = this.phaseDuration();
    if (this.elapsed < dur) return;
    // Carry no overflow between phases — each transition restarts its clock so
    // timings stay independent and predictable.
    if (this.phase === "opening") {
      this.phase = "enclosing";
      this.elapsed = 0;
    } else if (this.phase === "enclosing") {
      this.phase = "piloted";
      this.elapsed = 0;
    } else if (this.phase === "exiting") {
      this.phase = "idle";
      this.elapsed = 0;
    }
  }

  private phaseDuration(): number {
    switch (this.phase) {
      case "opening":
        return this.timings.opening;
      case "enclosing":
        return this.timings.enclosing;
      case "exiting":
        return this.timings.exiting;
      default:
        return 0;
    }
  }

  /** Derived, read-only snapshot of everything the owner needs this frame. */
  get snapshot(): MechSnapshot {
    const dur = this.phaseDuration();
    const progress = dur > 0 ? clamp01(this.elapsed / dur) : 1;
    const closure = this.computeClosure(progress);
    const enclosed = closure >= ENCLOSE_THRESHOLD;
    let pilotVisible: boolean;
    switch (this.phase) {
      case "idle":
        pilotVisible = true;
        break;
      case "piloted":
        pilotVisible = false;
        break;
      default:
        // During opening/enclosing/exiting the pilot is visible until sealed in.
        pilotVisible = !enclosed;
        break;
    }
    return {
      phase: this.phase,
      progress,
      closure,
      pilotVisible,
      mechVisible: this.phase !== "idle",
      enclosed,
      mechControlled: this.phase === "piloted",
    };
  }

  /** Assembly fraction for the current phase + progress (eased). */
  private computeClosure(progress: number): number {
    switch (this.phase) {
      case "idle":
        return 0;
      case "opening":
        // Armour assembles to halfway (parts arrive) during the open phase.
        return 0.5 * ease(progress);
      case "enclosing":
        // ...then closes the rest of the way around the pilot.
        return 0.5 + 0.5 * ease(progress);
      case "piloted":
        return 1;
      case "exiting":
        // Re-opens fully: closure falls from 1 back to 0.
        return 1 - ease(progress);
    }
  }
}
