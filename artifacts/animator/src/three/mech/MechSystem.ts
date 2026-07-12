import * as THREE from "three";
import { ExoArmor } from "./exoArmor";
import { MechStateMachine, type MechPhase, type MechSnapshot } from "./mechState";

/**
 * THREE-side orchestrator for the Exo-Armour Mech Mode, owned by the Studio.
 *
 * Holds the pure {@link MechStateMachine} plus the visual {@link ExoArmor}
 * instance, and each frame:
 *  - advances the transformation phases,
 *  - lazily clones the (cached) mech template the first time the player suits up,
 *  - syncs the mech to the supplied anchor transform (the player root),
 *  - applies the assemble/close scale, and
 *  - tears the instance down when the machine returns to idle.
 *
 * Gameplay consequences (hiding the pilot, swapping control, scaled combat) are
 * left to the Studio, which reads the returned {@link MechSnapshot}. Disposal is
 * limited to owned clones — the shared template is never disposed (see ExoArmor).
 */
export interface MechAnchor {
  /** World position the mech should sit at (the player's feet). */
  pos: THREE.Vector3;
  /** Facing yaw (radians) the mech should orient to. */
  yaw: number;
  /** Normalized movement speed (0..1) of the pilot, for the procedural walk. */
  speed: number;
  /**
   * Aim elevation for the torso (radians, + = up), from the camera pitch.
   * Applied only while piloted; the chassis stays level (torso-only lean).
   */
  aimTilt?: number;
}

/**
 * Per-frame "feel" output the owner reacts to: the raw {@link MechSnapshot} plus
 * the discrete moments worth punctuating with VFX / audio / camera shake (a heavy
 * foot-plant, the suit-up assemble start, the seal-shut, and the release crack).
 */
export interface MechFrame {
  snap: MechSnapshot;
  /** World position of a heavy foot-plant this frame, else null. */
  footstep: THREE.Vector3 | null;
  /** Suit-up just began (armour starts materializing around the pilot). */
  justOpened: boolean;
  /** The armour just sealed shut around the pilot (closure crossed the seal). */
  justSealed: boolean;
  /** The armour just began cracking open to release the pilot. */
  justReleased: boolean;
}

export class MechSystem {
  private readonly machine = new MechStateMachine();
  private armor: ExoArmor | null = null;
  private loading = false;
  private readonly scene: THREE.Scene;
  /** Phase / seal state last frame, for edge-detecting the staged feel moments. */
  private prevPhase: MechPhase = "idle";
  private prevEnclosed = false;
  /** Scratch foot position reused so a footstep allocates nothing. */
  private readonly footScratch = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  get isActive(): boolean {
    return this.machine.isActive;
  }

  get isPiloted(): boolean {
    return this.machine.isPiloted;
  }

  get snapshot(): MechSnapshot {
    return this.machine.snapshot;
  }

  /** Toggle suit-up / exit. Returns the action taken (or null mid-transition). */
  toggle(): "enter" | "exit" | null {
    const action = this.machine.toggle();
    if (action === "enter") void this.ensureArmor();
    return action;
  }

  /** Advance the machine, sync the mech, and manage instance lifecycle. */
  update(dt: number, anchor: MechAnchor): MechFrame {
    this.machine.update(dt);
    const snap = this.machine.snapshot;

    // Edge-detect the staged feel moments from the prior frame's phase/seal state.
    const justOpened = this.prevPhase === "idle" && snap.phase === "opening";
    const justReleased = this.prevPhase === "piloted" && snap.phase === "exiting";
    const justSealed = !this.prevEnclosed && snap.enclosed;
    this.prevPhase = snap.phase;
    this.prevEnclosed = snap.enclosed;

    let footstep: THREE.Vector3 | null = null;
    if (snap.mechVisible) {
      if (this.armor?.loaded) {
        // Suit-up morph scrub + torso aim BEFORE the mixer advances this frame.
        this.armor.setMorph(snap.phase, snap.progress);
        this.armor.setAimTilt(snap.mechControlled ? (anchor.aimTilt ?? 0) : 0);
        this.armor.update(dt);
        this.armor.setClosure(snap.closure);
        this.armor.setPosition(anchor.pos.x, anchor.pos.y, anchor.pos.z);
        this.armor.setYaw(anchor.yaw);
        // Procedural heavy walk only counts while fully piloted (closed up).
        const fp = this.armor.updateLocomotion(dt, anchor.speed, snap.mechControlled);
        if (fp) footstep = this.footWorldPos(anchor, fp.side);
      } else {
        // Template still downloading on the very first suit-up — kick it off.
        void this.ensureArmor();
      }
    } else if (this.armor) {
      // Returned to idle: release the owned clone (shared template stays cached).
      this.armor.dispose();
      this.armor = null;
    }

    return { snap, footstep, justOpened, justSealed, justReleased };
  }

  /** World position of a planted foot offset to one side of the mech's centre. */
  private footWorldPos(anchor: MechAnchor, side: -1 | 1): THREE.Vector3 {
    // Screen-right on the floor for the mech's facing yaw.
    const rx = Math.cos(anchor.yaw);
    const rz = -Math.sin(anchor.yaw);
    return this.footScratch.set(
      anchor.pos.x + rx * side * 0.6,
      anchor.pos.y,
      anchor.pos.z + rz * side * 0.6,
    );
  }

  /** Force the mech off immediately (character swap / teardown). */
  forceIdle(): void {
    this.machine.forceIdle();
    this.prevPhase = "idle";
    this.prevEnclosed = false;
    if (this.armor) {
      this.armor.dispose();
      this.armor = null;
    }
  }

  dispose(): void {
    this.forceIdle();
  }

  private async ensureArmor(): Promise<void> {
    if (this.armor || this.loading) return;
    this.loading = true;
    try {
      const armor = new ExoArmor();
      const ok = await armor.load();
      if (!ok) {
        armor.dispose();
        return;
      }
      // The player may have already exited while the template was loading.
      if (!this.machine.isActive) {
        armor.dispose();
        return;
      }
      this.scene.add(armor.root);
      this.armor = armor;
    } finally {
      this.loading = false;
    }
  }
}
