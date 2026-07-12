/**
 * Instant-replay rolling buffer for AI duels.
 *
 * The A.L.E. Bot records each live fighter's full pose (skeleton bone local
 * transforms + the rig's world transform) into a fixed-size ring every frame the
 * fight is on. An instant replay re-poses the real fighters from this buffer in
 * slow-mo, so the playback is the actual recorded motion — not a re-simulation.
 *
 * This module is intentionally renderer/three-agnostic so the ring + frame
 * sampling can be unit-tested without WebGL: poses are captured by anything that
 * implements {@link PoseRecordable}, and {@link sampleFrames} is a pure function.
 */

/** A captured pose: rig world transform + flat per-bone local TRS (no scale). */
export interface ExplorerPose {
  /** Rig root world position. */
  px: number;
  py: number;
  pz: number;
  /** Rig root world quaternion. */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Per-bone local [px,py,pz, qx,qy,qz,qw] packed in a stable bone order. */
  bones: Float32Array;
}

/** Anything (e.g. the Explorer rig) that can snapshot its pose into a buffer. */
export interface PoseRecordable {
  /** Capture the current pose, reusing `out` when its bone array fits. */
  capturePose(out?: ExplorerPose): ExplorerPose | null;
}

/** One recorded instant of the duel: both fighters' poses at a timestamp. */
export interface ReplayFrame {
  /** Record-clock time in seconds (matches the A.L.E. elapsed clock). */
  t: number;
  /** Fighter A (ally) pose, or null if absent that frame. */
  a: ExplorerPose | null;
  /** Fighter B (enemy) pose, or null if absent that frame. */
  b: ExplorerPose | null;
}

/**
 * Fixed-capacity ring of {@link ReplayFrame}s. Frame slots (and their packed
 * pose Float32Arrays) are reused as the ring wraps, so steady-state recording
 * makes no per-frame allocations once warmed up.
 */
export class ReplayBuffer {
  private readonly frames: ReplayFrame[] = [];
  private head = 0;
  private size = 0;

  constructor(private readonly capacity: number) {}

  /** Number of frames currently buffered. */
  get length(): number {
    return this.size;
  }

  /** Drop all buffered frames (keeps the allocated slots for reuse). */
  clear(): void {
    this.head = 0;
    this.size = 0;
  }

  /** Record both fighters' poses at time `t` into the next ring slot. */
  record(t: number, a: PoseRecordable | null, b: PoseRecordable | null): void {
    let slot = this.frames[this.head];
    if (!slot) {
      slot = { t: 0, a: null, b: null };
      this.frames[this.head] = slot;
    }
    slot.t = t;
    slot.a = a ? a.capturePose(slot.a ?? undefined) : null;
    slot.b = b ? b.capturePose(slot.b ?? undefined) : null;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }

  /** Oldest→newest chronological view of the buffered frames (shared slots). */
  ordered(): ReplayFrame[] {
    const out: ReplayFrame[] = [];
    const start = (this.head - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) out.push(this.frames[(start + i) % this.capacity]);
    return out;
  }

  /** Timestamp of the most recent recorded frame (0 when empty). */
  latestT(): number {
    if (this.size === 0) return 0;
    return this.frames[(this.head - 1 + this.capacity) % this.capacity].t;
  }
}

/** A bracketing pair of frames around a playhead time, with a 0..1 blend. */
export interface FrameSample {
  f0: ReplayFrame;
  f1: ReplayFrame;
  /** Interpolation weight from f0→f1 (0 = at f0, 1 = at f1). */
  alpha: number;
}

/**
 * Find the two frames bracketing playhead `t` in an ascending-time `frames`
 * array and the interpolation weight between them. Clamps to the ends; returns
 * null only for an empty array.
 */
export function sampleFrames(frames: ReplayFrame[], t: number): FrameSample | null {
  const n = frames.length;
  if (n === 0) return null;
  if (n === 1) return { f0: frames[0], f1: frames[0], alpha: 0 };
  if (t <= frames[0].t) return { f0: frames[0], f1: frames[0], alpha: 0 };
  if (t >= frames[n - 1].t) return { f0: frames[n - 1], f1: frames[n - 1], alpha: 0 };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const f0 = frames[lo];
  const f1 = frames[hi];
  const span = f1.t - f0.t;
  return { f0, f1, alpha: span > 1e-6 ? (t - f0.t) / span : 0 };
}
