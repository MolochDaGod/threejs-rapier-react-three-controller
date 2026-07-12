import * as THREE from "three";

/**
 * Pure geometry for the swept-edge weapon collision system. A weapon's cutting
 * edge is a capsule (segment `a`→`b` + radius). Each frame we sweep the edge from
 * its previous pose to its current pose and test that swept volume against a
 * target capsule (an enemy body, a shield slab modelled as a fat capsule, or
 * another weapon's edge). Everything here is deterministic and side-effect free
 * so it can be unit tested without a GPU.
 */

/** A capsule: the segment `a`→`b` inflated by `radius`. */
export interface Capsule {
  a: THREE.Vector3;
  b: THREE.Vector3;
  radius: number;
}

const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();

/**
 * Closest points between two segments `p1`→`q1` and `p2`→`q2`. Writes the results
 * into `out1`/`out2` and returns the squared distance between them. Real-Time
 * Collision Detection §5.1.9 (Ericson), robust to degenerate/parallel segments.
 */
export function closestSegmentSegment(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
  out1: THREE.Vector3,
  out2: THREE.Vector3,
): number {
  _d1.subVectors(q1, p1); // direction of segment 1
  _d2.subVectors(q2, p2); // direction of segment 2
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1); // squared length of seg 1
  const e = _d2.dot(_d2); // squared length of seg 2
  const f = _d2.dot(_r);

  const EPS = 1e-9;
  let s: number;
  let t: number;

  if (a <= EPS && e <= EPS) {
    // Both segments degenerate to points.
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    // Segment 1 is a point.
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = _d1.dot(_r);
    if (e <= EPS) {
      // Segment 2 is a point.
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      // General non-degenerate case.
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom > EPS ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }

  out1.copy(p1).addScaledVector(_d1, s);
  out2.copy(p2).addScaledVector(_d2, t);
  return out1.distanceToSquared(out2);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

/**
 * Test two capsules for overlap. On a hit, writes the mid-point of the closest
 * approach into `outPoint` and returns the penetration depth (>= 0). Returns a
 * negative number (the signed gap) when they do not touch.
 */
export function capsuleCapsule(x: Capsule, y: Capsule, outPoint?: THREE.Vector3): number {
  const d2 = closestSegmentSegment(x.a, x.b, y.a, y.b, _c1, _c2);
  const rr = x.radius + y.radius;
  const dist = Math.sqrt(d2);
  if (outPoint) outPoint.addVectors(_c1, _c2).multiplyScalar(0.5);
  return rr - dist; // >=0 overlap depth, <0 gap
}

const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _sa = new THREE.Vector3();
const _sb = new THREE.Vector3();

/** Result of a swept-edge test. */
export interface SweptHit {
  /** World point of the deepest contact found along the sweep. */
  point: THREE.Vector3;
  /** Penetration depth at that contact (metres). */
  depth: number;
  /** 0..1 fraction along the sweep where the deepest contact happened. */
  t: number;
}

/**
 * Sweep a blade edge (capsule) from its previous pose (`prevA`→`prevB`) to its
 * current pose (`curA`→`curB`) and test against a static `target` capsule. The
 * edge is sampled at `steps`+1 interpolated poses so a fast swing can't tunnel
 * through a thin target between frames. Returns the deepest contact, or `null`.
 *
 * `steps` should scale with how far the edge travelled this frame (see
 * {@link sweepSteps}); more steps = finer continuous detection.
 */
export function sweptEdgeVsCapsule(
  prevA: THREE.Vector3,
  prevB: THREE.Vector3,
  curA: THREE.Vector3,
  curB: THREE.Vector3,
  edgeRadius: number,
  target: Capsule,
  steps: number,
  out?: SweptHit,
): SweptHit | null {
  const n = Math.max(1, Math.floor(steps));
  let best = -Infinity;
  const point = out?.point ?? new THREE.Vector3();
  const found = { hit: false, t: 0 };
  const tmp = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    _sa.lerpVectors(prevA, curA, f);
    _sb.lerpVectors(prevB, curB, f);
    const d2 = closestSegmentSegment(_sa, _sb, target.a, target.b, _pa, _pb);
    const depth = edgeRadius + target.radius - Math.sqrt(d2);
    if (depth >= 0 && depth > best) {
      best = depth;
      tmp.addVectors(_pa, _pb).multiplyScalar(0.5);
      point.copy(tmp);
      found.hit = true;
      found.t = f;
    }
  }
  if (!found.hit) return null;
  const res = out ?? { point, depth: 0, t: 0 };
  res.point = point;
  res.depth = best;
  res.t = found.t;
  return res;
}

/**
 * Choose a sweep sub-step count from how far the edge endpoints moved this frame
 * relative to a reference size (typically the target radius). Keeps continuous
 * detection cheap when slow and dense when fast, clamped to `[1, max]`.
 */
export function sweepSteps(travel: number, reference: number, max = 8): number {
  if (reference <= 1e-4) return 1;
  return Math.min(max, Math.max(1, Math.ceil(travel / (reference * 0.5))));
}
