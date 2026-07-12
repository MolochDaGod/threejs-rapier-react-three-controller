import * as THREE from "three";
import type { Highlight, HighlightKind } from "../types";

/** A discrete combat moment the director reacts to (derived by AleBot). */
export interface DuelEvent {
  fighter: "A" | "B";
  kind: HighlightKind;
  /** World point the moment happened at (for the hotspot). */
  at: THREE.Vector3;
  /** Raw magnitude (damage, force, etc.) used to weight excitement. */
  magnitude: number;
}

const MAX_HIGHLIGHTS = 20;
const SLOWMO_SECONDS = 1.1;
const SLOWMO_SCALE = 0.35;

/** Excitement bump per event kind. */
const KIND_BUMP: Record<HighlightKind, number> = {
  ko: 1.0,
  crit: 0.7,
  parry: 0.55,
  bigHit: 0.45,
  flurry: 0.3,
};

/** Kinds that are dramatic enough to trigger a slow-mo beat. */
const SLOWMO_KINDS: ReadonlySet<HighlightKind> = new Set<HighlightKind>(["ko", "crit", "parry"]);

const LABELS: Record<HighlightKind, string> = {
  ko: "Knockout",
  crit: "Critical hit",
  parry: "Parry",
  bigHit: "Big hit",
  flurry: "Flurry",
};

/**
 * The director's "brain": maintains a decaying excitement score, picks the world
 * hotspot the drone should frame, captures flagged moments into a rolling
 * highlight buffer, and decides when to drop into slow-mo.
 */
export class DuelDirector {
  private excitement = 0;
  private readonly hotspot = new THREE.Vector3();
  private readonly highlights: Highlight[] = [];
  private slowmoLeft = 0;
  private elapsed = 0;

  reset(): void {
    this.excitement = 0;
    this.slowmoLeft = 0;
    this.elapsed = 0;
    this.highlights.length = 0;
  }

  /**
   * Advance the director one frame.
   * @param proximity 0..1 how close & engaged the fighters are.
   * @param events    discrete moments captured this frame.
   * @param round     current duel round (stamped onto highlights).
   * @param mid       fighters' midpoint, the resting hotspot.
   */
  update(
    dt: number,
    proximity: number,
    events: DuelEvent[],
    round: number,
    mid: THREE.Vector3,
  ): void {
    this.elapsed += dt;
    if (this.slowmoLeft > 0) this.slowmoLeft = Math.max(0, this.slowmoLeft - dt);

    // Decay, then floor on sustained proximity so a tense standoff still reads hot.
    this.excitement = Math.max(this.excitement * Math.exp(-dt * 1.3), proximity * 0.4);

    // Drift the hotspot toward the action; events yank it to the latest impact.
    let target = mid;
    let strongest: DuelEvent | null = null;
    for (const e of events) {
      this.excitement = Math.min(1, this.excitement + KIND_BUMP[e.kind] + e.magnitude * 0.15);
      if (!strongest || KIND_BUMP[e.kind] > KIND_BUMP[strongest.kind]) strongest = e;
      this.capture(e, round);
      if (SLOWMO_KINDS.has(e.kind)) this.slowmoLeft = Math.max(this.slowmoLeft, SLOWMO_SECONDS);
    }
    if (strongest) target = strongest.at;
    const lambda = strongest ? 12 : 3;
    this.hotspot.x = target.x + (this.hotspot.x - target.x) * Math.exp(-lambda * dt);
    this.hotspot.y = target.y + (this.hotspot.y - target.y) * Math.exp(-lambda * dt);
    this.hotspot.z = target.z + (this.hotspot.z - target.z) * Math.exp(-lambda * dt);
  }

  private capture(e: DuelEvent, round: number): void {
    this.highlights.unshift({
      t: this.elapsed,
      round,
      kind: e.kind,
      fighter: e.fighter,
      score: this.excitement,
      label: LABELS[e.kind],
    });
    if (this.highlights.length > MAX_HIGHLIGHTS) this.highlights.length = MAX_HIGHLIGHTS;
  }

  getExcitement(): number {
    return this.excitement;
  }

  getHotspot(): THREE.Vector3 {
    return this.hotspot;
  }

  isSlowmo(): boolean {
    return this.slowmoLeft > 0;
  }

  /** Global time-scale multiplier to apply this frame (1 = normal). */
  timeScale(): number {
    return this.slowmoLeft > 0 ? SLOWMO_SCALE : 1;
  }

  /** Newest-first copy of the rolling highlight buffer. */
  getHighlights(): Highlight[] {
    return this.highlights.slice();
  }
}
