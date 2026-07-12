import * as THREE from "three";
import { type Capsule, type SweptHit, sweepSteps, sweptEdgeVsCapsule } from "./sweptEdge";

/**
 * A hostile the swept blade can physically strike this frame. Each volume is a
 * capsule in WORLD space (built by the owner of the fighters, e.g. `Targets`):
 * the always-present `body`, an optional raised `shield` slab, and an optional
 * `weapon` edge (present only while that fighter is mid-swing). All in metres.
 */
export interface BladeDefender {
  id: number;
  body: Capsule;
  shield: Capsule | null;
  weapon: Capsule | null;
}

export type BladeContactKind = "body" | "shield" | "weapon";

/** A resolved physical contact between the player's blade and a defender volume. */
export interface BladeContact {
  id: number;
  kind: BladeContactKind;
  /** World point of the contact. */
  point: THREE.Vector3;
  /** Penetration depth (metres). */
  depth: number;
}

/**
 * Continuous swept-edge blade collision for the player's MAIN weapon.
 *
 * During an open swing window the player's cutting edge (a capsule) is swept from
 * its previous world pose to its current pose every frame and tested against each
 * hostile's volumes. Contacts are classified — weapon clash > shield block > body
 * — with an intercepting blade/shield stopping the cut before the body, and each
 * (defender, kind) fires at most once per swing so a single cut can't multi-hit.
 *
 * This is an ADDITIVE physical layer: it drives blade-vs-weapon clash, blade-vs-
 * shield clash feedback, and precise blade-vs-body contact points. Damage/defense
 * authority still lives in the existing combo resolution; this system reports what
 * the steel actually touched and when.
 */
export class BladeCollisionSystem {
  private active = false;
  private hasPrev = false;
  private readonly prevA = new THREE.Vector3();
  private readonly prevB = new THREE.Vector3();
  private readonly hit: SweptHit = { point: new THREE.Vector3(), depth: 0, t: 0 };
  private readonly hitBody = new Set<number>();
  private readonly hitShield = new Set<number>();
  private readonly hitWeapon = new Set<number>();

  /** Open a fresh swing window: clears per-swing dedupe + re-seeds the pose. */
  beginSwing(): void {
    this.active = true;
    this.hasPrev = false;
    this.hitBody.clear();
    this.hitShield.clear();
    this.hitWeapon.clear();
  }

  /** Close the swing window; the next frame's pose becomes a fresh seed. */
  endSwing(): void {
    this.active = false;
    this.hasPrev = false;
  }

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Sweep the blade edge (`curA`→`curB`, world space, radius `edgeRadius`) against
   * every defender and emit each fresh classified contact via `onContact`. The
   * first frame after {@link beginSwing} only seeds the previous pose (no sweep),
   * so a swing needs at least one prior frame before it can connect.
   */
  update(
    curA: THREE.Vector3,
    curB: THREE.Vector3,
    edgeRadius: number,
    defenders: BladeDefender[],
    onContact: (c: BladeContact) => void,
  ): void {
    if (!this.active) return;
    if (!this.hasPrev) {
      this.prevA.copy(curA);
      this.prevB.copy(curB);
      this.hasPrev = true;
      return;
    }
    const travel = Math.max(this.prevA.distanceTo(curA), this.prevB.distanceTo(curB));
    for (const d of defenders) {
      // Weapon clash first: an enemy blade meeting yours intercepts the cut.
      if (d.weapon && !this.hitWeapon.has(d.id) && this.test(curA, curB, edgeRadius, d.weapon, travel)) {
        this.hitWeapon.add(d.id);
        onContact({ id: d.id, kind: "weapon", point: this.hit.point.clone(), depth: this.hit.depth });
        continue;
      }
      // Then a raised shield stops the cut before it reaches the body.
      if (d.shield && !this.hitShield.has(d.id) && this.test(curA, curB, edgeRadius, d.shield, travel)) {
        this.hitShield.add(d.id);
        onContact({ id: d.id, kind: "shield", point: this.hit.point.clone(), depth: this.hit.depth });
        continue;
      }
      // Otherwise the blade bites flesh.
      if (!this.hitBody.has(d.id) && this.test(curA, curB, edgeRadius, d.body, travel)) {
        this.hitBody.add(d.id);
        onContact({ id: d.id, kind: "body", point: this.hit.point.clone(), depth: this.hit.depth });
      }
    }
    this.prevA.copy(curA);
    this.prevB.copy(curB);
  }

  private test(curA: THREE.Vector3, curB: THREE.Vector3, edgeRadius: number, target: Capsule, travel: number): boolean {
    const steps = sweepSteps(travel, target.radius);
    return sweptEdgeVsCapsule(this.prevA, this.prevB, curA, curB, edgeRadius, target, steps, this.hit) !== null;
  }
}
