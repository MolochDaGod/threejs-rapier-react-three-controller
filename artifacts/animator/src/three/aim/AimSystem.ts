import * as THREE from "three";

/**
 * Shared aim / raycast / vector-math system.
 *
 * Concepts ported (not imported) from the Unity Kuvrot/DGS project:
 *  - `ShootingSystem.cs`: a camera-forward raycast taken from the screen centre
 *    (`Physics.Raycast(cam.position, cam.forward, 100)`), named hit zones
 *    (Body / Head → headshot 2x), close-range shotgun damage bonus, and hit FX
 *    oriented to the surface normal (`Quaternion.LookRotation(hit.normal)`).
 *  - `CameraController.cs`: a field-of-view "kick" that ramps between a base and
 *    a sprint FOV.
 *
 * Everything here is engine-agnostic: it only touches THREE plus a caller-owned
 * list of raycast targets, so both the Danger Room (`Studio`) and the Playground
 * (`EditorScene`) can drive the exact same aiming maths.
 */

/** A surface hit returned by the screen-centre raycast. */
export interface AimHit {
  /** World-space contact point. */
  point: THREE.Vector3;
  /** Surface normal at the contact (world space, normalised). */
  normal: THREE.Vector3;
  /** Distance from the ray origin to the contact. */
  distance: number;
  /** The first intersected object (leaf mesh). */
  object: THREE.Object3D;
  /** Resolved damage zone derived from the object name chain, if any. */
  zone: HitZone;
}

/** Named damage zone, resolved by walking the hit object's ancestry. */
export type HitZone = "head" | "body" | "none";

/**
 * Build a ray from the screen centre along the camera's forward axis. This is the
 * true first/third-person aim ray: in first person it is exactly where you look;
 * in third person it is what the crosshair (screen centre) is pointing at, which
 * is what the player expects to hit. Mirrors DGS's `cam.position + cam.forward`.
 */
export function screenCenterRay(camera: THREE.Camera, out = new THREE.Ray()): THREE.Ray {
  const origin = new THREE.Vector3();
  camera.getWorldPosition(origin);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  out.origin.copy(origin);
  out.direction.copy(dir.normalize());
  return out;
}

/**
 * Rotate `dir` by a random offset inside a cone of half-angle `spreadRad`. Uses a
 * uniform disc sample on the plane perpendicular to `dir` so the distribution is
 * even (no clustering toward the centre). `rng` defaults to Math.random but can be
 * a seeded generator for deterministic / networked fire.
 */
export function applySpread(
  dir: THREE.Vector3,
  spreadRad: number,
  rng: () => number = Math.random,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  out.copy(dir).normalize();
  if (spreadRad <= 1e-6) return out;
  // Pick a basis perpendicular to the aim direction.
  const up = Math.abs(out.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3().crossVectors(up, out).normalize();
  const bitangent = new THREE.Vector3().crossVectors(out, tangent).normalize();
  // Uniform sample within the cone: angle scaled by sqrt for an even areal spread.
  const theta = rng() * Math.PI * 2;
  const radius = Math.tan(spreadRad) * Math.sqrt(rng());
  out
    .addScaledVector(tangent, Math.cos(theta) * radius)
    .addScaledVector(bitangent, Math.sin(theta) * radius)
    .normalize();
  return out;
}

/**
 * Resolve a named damage zone by walking up the object's parent chain looking for
 * a "head" / "body" tag (case-insensitive substring match on object names — the
 * Danger Room dummies and rig bones use these conventions). DGS matched exact
 * names "Head" / "Body"; the substring walk is more forgiving for skinned rigs.
 */
export function resolveHitZone(object: THREE.Object3D | null): HitZone {
  let node: THREE.Object3D | null = object;
  let depth = 0;
  while (node && depth < 24) {
    const name = node.name.toLowerCase();
    if (name.includes("head") || name.includes("neck")) return "head";
    if (name.includes("body") || name.includes("chest") || name.includes("spine")) return "body";
    node = node.parent;
    depth++;
  }
  return "none";
}

/**
 * Damage multiplier for a hit. Headshots double damage (DGS). A close-range bonus
 * (e.g. shotgun within `closeRange` metres) also doubles, matching DGS's
 * `distance <= 3 → Damage * 2` body rule. Multipliers stack.
 */
export function damageMultiplier(
  zone: HitZone,
  distance: number,
  opts: { closeRange?: number; closeBonus?: number; headBonus?: number } = {},
): number {
  const { closeRange = 0, closeBonus = 2, headBonus = 2 } = opts;
  let mult = 1;
  if (zone === "head") mult *= headBonus;
  if (closeRange > 0 && distance <= closeRange) mult *= closeBonus;
  return mult;
}

/**
 * Cast the screen-centre ray against `targets` and return the nearest surface hit
 * (with zone + normal), or null. `far` caps the range (DGS used 100). Recursive so
 * skinned meshes under a group are caught.
 */
export function raycastScene(
  camera: THREE.Camera,
  targets: THREE.Object3D[],
  far = 100,
  raycaster = new THREE.Raycaster(),
): AimHit | null {
  const ray = screenCenterRay(camera);
  raycaster.set(ray.origin, ray.direction);
  raycaster.far = far;
  const hits = raycaster.intersectObjects(targets, true);
  for (const h of hits) {
    // Skip non-renderable helpers and back-faceless degenerate hits.
    if (!h.face && !h.point) continue;
    const normal = h.face
      ? h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize()
      : ray.direction.clone().negate();
    return {
      point: h.point.clone(),
      normal,
      distance: h.distance,
      object: h.object,
      zone: resolveHitZone(h.object),
    };
  }
  return null;
}

/** Orient a quaternion so +Z faces along the surface normal (DGS hit-FX rule). */
export function lookAlongNormal(normal: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
}

/**
 * Recoil accumulator: short kicks (pitch up, slight random yaw) that decay back to
 * zero. The Controller adds the live offset to the camera pitch/yaw each frame and
 * the crosshair widens by `bloom`. This replaces ad-hoc per-weapon nudges with one
 * consistent model.
 */
export class Recoil {
  /** Current camera-pitch offset (radians, +up). */
  pitch = 0;
  /** Current camera-yaw offset (radians). */
  yaw = 0;
  /** Current accumulated spread bloom (radians) added to the base spread. */
  bloom = 0;

  constructor(
    /** Exponential recovery rate (higher = snappier recentre). */
    private recovery = 8,
    /** How fast accumulated bloom settles back to zero. */
    private bloomRecovery = 5,
    /** Hard cap on accumulated bloom. */
    private maxBloom = 0.08,
  ) {}

  /** Add one shot's kick. `yawJitter` randomises the horizontal nudge sign. */
  kick(pitch: number, bloom: number, yawJitter = pitch * 0.4) {
    this.pitch += pitch;
    this.yaw += (Math.random() * 2 - 1) * yawJitter;
    this.bloom = Math.min(this.maxBloom, this.bloom + bloom);
  }

  /** Decay all offsets toward zero. Call once per frame. */
  update(dt: number) {
    const k = Math.exp(-this.recovery * dt);
    this.pitch *= k;
    this.yaw *= k;
    this.bloom *= Math.exp(-this.bloomRecovery * dt);
    if (Math.abs(this.pitch) < 1e-5) this.pitch = 0;
    if (Math.abs(this.yaw) < 1e-5) this.yaw = 0;
    if (this.bloom < 1e-5) this.bloom = 0;
  }

  reset() {
    this.pitch = 0;
    this.yaw = 0;
    this.bloom = 0;
  }
}

/**
 * FOV sprint-kick (DGS `CameraController`): ease the live FOV toward `sprint` while
 * sprinting and back to `base` otherwise. Returns the new FOV; the caller applies
 * it to the camera. Frame-rate independent (exponential approach).
 */
export function fovKick(
  current: number,
  base: number,
  sprintFov: number,
  sprinting: boolean,
  dt: number,
  rate = 8,
): number {
  const target = sprinting ? sprintFov : base;
  return current + (target - current) * Math.min(1, rate * dt);
}
