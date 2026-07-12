import type { MechAnchor, MechFrame, MechSystem } from "./MechSystem";

/**
 * Studio-side reconciliation glue for the Exo-Armour Mech Mode.
 *
 * The pure {@link MechStateMachine} owns the transformation lifecycle; this class
 * owns the *consequences* the Studio must apply each frame and at takeover edges:
 * hiding/showing the pilot, swapping the move-speed multiplier on the
 * piloted edge, and tearing the mech down cleanly when another context (e.g. an
 * AI duel) seizes the player avatar.
 *
 * These edges — duel-takeover teardown and a buff (Smoke-Phantom) expiring while
 * the player is mid-pilot — are exactly the cases that regressed during review,
 * so the logic lives here behind a tiny injectable {@link MechReconcileHost}
 * surface. That lets it be driven with the real {@link MechSystem} in a plain
 * vitest harness, with no WebGL / full Studio. The Studio supplies a host backed
 * by its controller + character and simply delegates.
 */
export interface MechReconcileHost {
  /** True while the player is a hidden duel spectator (pilot must stay hidden). */
  spectating(): boolean;
  /**
   * Baseline move-speed multiplier any transient speed change must restore TO
   * (e.g. the Tank/Centurion is permanently slow — never a bare `1`).
   */
  baseSpeedMul(): number;
  /** Apply a move-speed multiplier to the player controller (no-op if absent). */
  setSpeedMultiplier(mul: number): void;
  /** Show/hide the pilot character mesh (no-op when there is no character). */
  setPilotVisible(visible: boolean): void;
  /**
   * Toggle the mech aim camera: `true` widens the third-person pitch clamp to
   * {@link MECH_PITCH_MIN}..{@link MECH_PITCH_MAX} (so the pilot can look UP at
   * the tall chassis / aim skyward), `false` restores the default clamp. The
   * reconciler drives this on the piloted edges AND from {@link MechReconciler.cancel},
   * so a takeover teardown can never leave the widened clamp behind.
   */
  setMechAimActive(active: boolean): void;
  /** World anchor (player root pos + facing yaw) the mech should track. */
  anchor(): MechAnchor;
}

/** Heavier movement weight applied while piloting the exo-armour. */
export const MECH_PILOT_SPEED_MUL = 0.82;

/**
 * Third-person orbit pitch clamp while piloting (radians). The negative floor
 * lets the camera drop low and look UP at the 3.2m chassis; the raised ceiling
 * gives a steeper top-down view for the stomp/cannon.
 */
export const MECH_PITCH_MIN = -0.55;
export const MECH_PITCH_MAX = 1.35;

export class MechReconciler {
  /** Tracks the piloted edge so the speed multiplier is applied/restored once. */
  prevControlled = false;
  /** Cooldown on the mech's heavy slam skill. */
  skillCd = 0;

  constructor(
    private readonly mech: MechSystem,
    private readonly host: MechReconcileHost,
  ) {}

  /**
   * Instantly tear down any active exo-armour and restore the pilot's control
   * state. Used when entering contexts (e.g. duel spectating) that take over the
   * player avatar and must not leave a stray mech in the scene.
   */
  cancel(): void {
    if (!this.mech.isActive && !this.prevControlled) return;
    const wasControlled = this.prevControlled || this.mech.isPiloted;
    this.mech.forceIdle();
    this.prevControlled = false;
    this.skillCd = 0;
    if (wasControlled) this.host.setSpeedMultiplier(this.host.baseSpeedMul());
    this.host.setMechAimActive(false);
    this.host.setPilotVisible(!this.host.spectating());
  }

  /**
   * Reset glue state on a character swap (the new pilot starts unsuited). Does
   * NOT touch the skill cooldown — a swap clears the rig, not the timer.
   */
  reset(): void {
    this.mech.forceIdle();
    this.prevControlled = false;
  }

  /**
   * Advance the mech transformation and apply this frame's visibility/speed
   * reconciliation. Hides/restores the pilot per the state machine and applies
   * (then later restores) the piloting move-speed penalty on the piloted edge.
   */
  update(dt: number): MechFrame {
    const wasActive = this.mech.isActive;
    const frame = this.mech.update(dt, this.host.anchor());
    const snap = frame.snap;

    if (this.mech.isActive) {
      // Pilot is visible until sealed inside; respect the spectator invariant.
      this.host.setPilotVisible(snap.pilotVisible && !this.host.spectating());
    } else if (wasActive) {
      // Mech turned off this frame — restore the pilot + base movement speed.
      this.host.setPilotVisible(!this.host.spectating());
      this.host.setSpeedMultiplier(this.host.baseSpeedMul());
    }

    // Heavier movement + widened aim pitch while piloting; restore both on the
    // piloted→exiting edge (the exit morph plays under the normal camera).
    if (snap.mechControlled && !this.prevControlled) {
      this.host.setSpeedMultiplier(MECH_PILOT_SPEED_MUL);
      this.host.setMechAimActive(true);
    } else if (!snap.mechControlled && this.prevControlled) {
      if (this.mech.isActive) this.host.setSpeedMultiplier(this.host.baseSpeedMul());
      this.host.setMechAimActive(false);
    }
    this.prevControlled = snap.mechControlled;
    return frame;
  }

  /** Advance the heavy-slam cooldown. */
  tickCooldown(dt: number): void {
    if (this.skillCd > 0) this.skillCd = Math.max(0, this.skillCd - dt);
  }

  /**
   * Buff-expiry restore (Smoke-Phantom): only un-hide the pilot + reset speed
   * when NOT suited up. While piloting, the mech owns the pilot's visibility and
   * speed multiplier, so the expiring buff must leave both untouched.
   */
  restorePilotIfMechInactive(): void {
    if (this.mech.isActive) return;
    this.host.setPilotVisible(true);
    this.host.setSpeedMultiplier(this.host.baseSpeedMul());
  }
}
