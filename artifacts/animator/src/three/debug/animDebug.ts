import * as THREE from "three";

/**
 * A single animation event recorded by the debugger. One record is emitted each
 * time a clip is validated against the active rig (bind coverage + timing), each
 * time the rig switches its dominant clip ("play"), each time a high-level combat
 * verb fires (carrying the character's world XYZ), and whenever a clip fails to
 * resolve/bind. `issues` lists any problems detected (empty = healthy).
 */
export interface AnimRecord {
  /** Monotonic sequence number (also a stable React key). */
  seq: number;
  /** `performance.now()` timestamp (ms) the event was recorded. */
  t: number;
  /** What emitted it: `"rig"` (the low-level Animator) or `"verb"` (combat intent). */
  source: "rig" | "verb";
  /** Event class: skeleton validation / clip switch / combat verb / failure. */
  kind: "validate" | "play" | "verb" | "fail";
  /** Clip id or verb name. */
  id: string;
  /** Whether the clip loops (play events). */
  loop?: boolean;
  /** Clip duration in seconds (validate/play/verb). */
  duration?: number;
  /** Total authored tracks on the source clip (validate). */
  totalTracks?: number;
  /** How many of those tracks actually bind to a node on the rig (validate). */
  boundTracks?: number;
  /** Character world position at the moment of a combat verb. */
  pos?: { x: number; y: number; z: number };
  /** Any problems found — bind gaps, bad timing, missing clips, etc. */
  issues: string[];
}

/** Result of validating a clip against a skeleton root. */
export interface ClipValidation {
  total: number;
  bound: number;
  issues: string[];
}

const DEFAULT_CAP = 300;

/**
 * App-wide animation debugger: a persistent, opt-in ring-buffer recorder that the
 * rig instruments as it plays clips. It is a passive observer — when disabled the
 * `record*` calls are near-free no-ops, so the instrumentation can stay live in
 * production. A dockable panel subscribes to render the feed.
 */
class AnimDebug {
  private enabled = false;
  private buf: AnimRecord[] = [];
  private cap = DEFAULT_CAP;
  private seq = 0;
  private readonly subs = new Set<() => void>();

  /** Whether recording is currently on (instrumentation early-outs when false). */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Turn recording on/off. Existing records are kept so a toggle doesn't lose history. */
  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.emit();
  }

  /** Subscribe to change notifications (records added / cleared / toggled). */
  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  /** The current records, oldest first. */
  getRecords(): readonly AnimRecord[] {
    return this.buf;
  }

  /** Drop all recorded events. */
  clear(): void {
    if (this.buf.length === 0) return;
    this.buf = [];
    this.emit();
  }

  /**
   * Validate an animation clip against a skeleton `root`: how many of its authored
   * tracks bind to a real node (mesh/skeleton form), plus timing sanity (finite,
   * positive duration and finite keyframe times). Pure — safe to call regardless
   * of the enabled flag; the rig uses it to decide whether to record.
   */
  validateClip(root: THREE.Object3D, clip: THREE.AnimationClip): ClipValidation {
    const total = clip.tracks.length;
    let bound = 0;
    let badTimes = false;
    for (const track of clip.tracks) {
      const { nodeName } = THREE.PropertyBinding.parseTrackName(track.name);
      if (THREE.PropertyBinding.findNode(root, nodeName) != null) bound++;
      if (!badTimes) {
        const times = track.times;
        for (let i = 0; i < times.length; i++) {
          if (!Number.isFinite(times[i])) {
            badTimes = true;
            break;
          }
        }
      }
    }
    const issues: string[] = [];
    if (total === 0) {
      issues.push("no animation tracks");
    } else if (bound === 0) {
      issues.push("no tracks bind to this rig (skeleton mismatch)");
    } else if (bound < total) {
      issues.push(`${total - bound}/${total} tracks unbound (mesh/skeleton mismatch)`);
    }
    if (!Number.isFinite(clip.duration) || clip.duration <= 0) {
      issues.push(`bad duration (${clip.duration})`);
    }
    if (badTimes) issues.push("non-finite keyframe times");
    return { total, bound, issues };
  }

  /**
   * Record a clip-validation event (bind coverage + timing). Called by the rig the
   * first time it binds a clip to the current skeleton, so mesh/skeleton mismatches
   * surface even for clips that never visibly fail.
   */
  recordValidate(root: THREE.Object3D, id: string, clip: THREE.AnimationClip): void {
    if (!this.enabled) return;
    const v = this.validateClip(root, clip);
    this.push({
      seq: 0,
      t: 0,
      source: "rig",
      kind: "validate",
      id,
      duration: clip.duration,
      totalTracks: v.total,
      boundTracks: v.bound,
      issues: v.issues,
    });
  }

  /** Record the rig switching its dominant clip. `duration` is the clip length. */
  recordPlay(id: string, loop: boolean, duration: number): void {
    if (!this.enabled) return;
    const issues: string[] = [];
    if (!loop && (!Number.isFinite(duration) || duration <= 0)) {
      issues.push(`bad duration (${duration}) for a one-shot`);
    }
    this.push({ seq: 0, t: 0, source: "rig", kind: "play", id, loop, duration, issues });
  }

  /**
   * Record a high-level combat verb firing, tagged with the character's world XYZ
   * (location validation) and the resulting clip duration. A `0` duration means
   * the verb resolved to nothing — recorded as a failure so it's easy to spot.
   */
  recordVerb(name: string, pos: THREE.Vector3, duration: number): void {
    if (!this.enabled) return;
    const p = { x: pos.x, y: pos.y, z: pos.z };
    const issues: string[] = [];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      issues.push("non-finite character position");
    }
    const failed = !(duration > 0);
    if (failed) issues.push("verb produced no animation");
    this.push({
      seq: 0,
      t: 0,
      source: "verb",
      kind: failed ? "fail" : "verb",
      id: name,
      duration,
      pos: p,
      issues,
    });
  }

  /** Record an outright failure to resolve/bind a clip (missing id, null action). */
  recordFail(id: string, reason: string): void {
    if (!this.enabled) return;
    this.push({ seq: 0, t: 0, source: "rig", kind: "fail", id, issues: [reason] });
  }

  private push(rec: AnimRecord): void {
    rec.seq = ++this.seq;
    rec.t = typeof performance !== "undefined" ? performance.now() : Date.now();
    // Produce a NEW array reference on every change so `useSyncExternalStore`
    // (which bails out via Object.is on the snapshot) actually re-renders the feed.
    const next = this.buf.length >= this.cap ? this.buf.slice(this.buf.length - this.cap + 1) : this.buf.slice();
    next.push(rec);
    this.buf = next;
    this.emit();
  }

  private emit(): void {
    for (const cb of this.subs) cb();
  }
}

/** The one shared animation debugger instrumented by the rig + read by the panel. */
export const animDebug = new AnimDebug();
