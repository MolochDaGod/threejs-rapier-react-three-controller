import * as THREE from "three";

/** One clip participating in the locomotion blend. */
interface BlendEntry {
  action: THREE.AnimationAction;
  /** Current (smoothed) weight. */
  weight: number;
  /** Weight we are easing toward this frame. */
  target: number;
  /** Stride clips (walk/run) are phase-synced; idle plays on its own time. */
  stride: boolean;
  duration: number;
}

/** Per-frame intent handed to {@link LocomotionBlend.update}. */
export interface LocoBlendInput {
  idleId?: string;
  walkId?: string;
  runId?: string;
  /** 0..1 locomotion intensity (idle -> walk -> run). */
  speed: number;
  /** When crouched, running is suppressed and the stride cadence slows. */
  crouch: boolean;
  /** False fades the whole blend out (a one-shot/hold has taken over). */
  active: boolean;
  dt: number;
}

/** Speeds at which idle / walk / run reach full weight. */
const IDLE_AT = 0.06;
const WALK_AT = 0.45;
const RUN_AT = 0.9;
/** Weight easing rate (per second-ish, via 1-exp style clamp). */
const WEIGHT_K = 14;
/** Below this weight a fading-out clip is considered gone and stopped. */
const SILENCE_EPS = 0.001;

/**
 * A weight-blended, phase-synchronised locomotion layer that sits alongside the
 * Animator's single-clip crossfade state machine.
 *
 * Instead of snapping between idle/walk/run clips, it plays the adjacent pair
 * simultaneously and eases their weights with `speed`, so acceleration reads as a
 * continuous gait change. Walk and run share ONE normalised stride phase (their
 * `action.time` is driven manually from that phase, with the mixer time-scale
 * pinned to 0), which guarantees their feet land together while blended — the
 * standard cure for the foot-slide you get when crossfading clips of different
 * length. Idle is not a stride, so it keeps its own natural time.
 *
 * The blend reuses the Animator's cached actions (passed in via `resolveAction`),
 * so it shares the same clones and root-lock as the rest of the system.
 */
export class LocomotionBlend {
  private readonly entries = new Map<string, BlendEntry>();
  private phase = 0;

  constructor(private readonly resolveAction: (id: string) => THREE.AnimationAction | null) {}

  /** Reconcile the blend toward the requested idle/walk/run mix for this frame. */
  update(input: LocoBlendInput): void {
    const { dt } = input;

    let wIdle = 0;
    let wWalk = 0;
    let wRun = 0;
    if (input.active) {
      const s = THREE.MathUtils.clamp(input.speed, 0, 1);
      if (s <= WALK_AT) {
        const t = THREE.MathUtils.clamp((s - IDLE_AT) / (WALK_AT - IDLE_AT), 0, 1);
        wIdle = 1 - t;
        wWalk = t;
      } else {
        const t = THREE.MathUtils.clamp((s - WALK_AT) / (RUN_AT - WALK_AT), 0, 1);
        wWalk = 1 - t;
        wRun = t;
      }
      if (input.crouch) {
        // No running while crouched: fold the run weight back into walk.
        wWalk += wRun;
        wRun = 0;
      }
    }

    // Mark this frame's wanted clips and make sure each has a live entry.
    const want = new Map<string, number>();
    const request = (id: string | undefined, weight: number, stride: boolean): void => {
      if (!id || weight <= 0) return;
      want.set(id, (want.get(id) ?? 0) + weight);
      let entry = this.entries.get(id);
      if (!entry) {
        const action = this.resolveAction(id);
        if (!action) return;
        // Don't restart an action that's still playing (e.g. the dominant clip
        // just handed back from a crossfade) — resetting it would pop the idle
        // loop. A fresh/stopped action still needs a clean start.
        if (!action.isRunning()) action.reset();
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
        action.enabled = true;
        action.setEffectiveWeight(0);
        action.play();
        entry = { action, weight: 0, target: 0, stride, duration: action.getClip().duration };
        this.entries.set(id, entry);
      }
      entry.stride = stride;
    };
    request(input.idleId, wIdle, false);
    request(input.walkId, wWalk, true);
    request(input.runId, wRun, true);

    // Advance the shared stride phase from the blended natural cadence of the
    // active walk/run clips, scaled so steps quicken with speed.
    const walkEntry = input.walkId ? this.entries.get(input.walkId) : undefined;
    const runEntry = input.runId ? this.entries.get(input.runId) : undefined;
    const walkRate = walkEntry ? 1 / Math.max(0.1, walkEntry.duration) : 0;
    const runRate = runEntry ? 1 / Math.max(0.1, runEntry.duration) : 0;
    const denom = wWalk + wRun;
    const naturalRate =
      denom > 0 ? (walkRate * wWalk + runRate * wRun) / denom : walkRate || runRate || 1;
    const speedScale = (input.crouch ? 0.5 : 0.7) + 0.6 * THREE.MathUtils.clamp(input.speed, 0, 1);
    this.phase = (this.phase + naturalRate * speedScale * dt) % 1;

    // Ease every entry toward its target weight; drop ones that have faded out.
    const k = Math.min(1, WEIGHT_K * dt);
    for (const [id, entry] of this.entries) {
      entry.target = want.get(id) ?? 0;
      entry.weight += (entry.target - entry.weight) * k;
      if (entry.target === 0 && entry.weight < SILENCE_EPS) {
        entry.action.stop();
        this.entries.delete(id);
        continue;
      }
      entry.action.setEffectiveWeight(entry.weight);
      if (entry.stride) {
        entry.action.setEffectiveTimeScale(0);
        entry.action.time = this.phase * entry.duration;
      } else {
        entry.action.setEffectiveTimeScale(1);
      }
    }
  }

  /** The currently heaviest blend action (for crossfades), or null when silent. */
  peekDominant(): { action: THREE.AnimationAction; id: string } | null {
    let bestId: string | null = null;
    let bestEntry: BlendEntry | null = null;
    for (const [id, entry] of this.entries) {
      if (!bestEntry || entry.weight > bestEntry.weight) {
        bestId = id;
        bestEntry = entry;
      }
    }
    return bestEntry && bestId ? { action: bestEntry.action, id: bestId } : null;
  }

  /**
   * Hand control to the single-clip path: stop every blend clip except the
   * heaviest, restore that one to full weight + natural time so a one-shot can
   * crossFadeFrom it, and forget all entries. Returns the survivor (or null).
   */
  collapseToDominant(): { action: THREE.AnimationAction; id: string } | null {
    const dominant = this.peekDominant();
    for (const [id, entry] of this.entries) {
      if (dominant && id === dominant.id) continue;
      entry.action.stop();
    }
    this.entries.clear();
    if (!dominant) return null;
    dominant.action.setEffectiveTimeScale(1);
    dominant.action.setEffectiveWeight(1);
    return dominant;
  }

  /** Whether the blend currently drives no clips. */
  get silent(): boolean {
    return this.entries.size === 0;
  }

  /** Hard-stop and forget every blend clip. */
  stopAll(): void {
    for (const entry of this.entries.values()) entry.action.stop();
    this.entries.clear();
  }
}
