import * as THREE from "three";
import { footPlantOffset, pelvisDropForFeet, solveTwoBoneIk } from "./footIk";

/**
 * Skinned-rig foot-to-ground IK applier. The geometry/angles live in the pure
 * {@link solveTwoBoneIk} (unit-tested in `footIk.test.ts`); this module turns
 * those angles into bone quaternions on a live `three` skeleton.
 *
 * It MUST run AFTER the animation mixer has written its pose for the frame —
 * foot IK is a per-frame bone OVERRIDE layered on top of the animated pose, in
 * the single documented post-mixer override order each avatar's `update()`
 * follows (see GrudgeAvatar / Character). On flat ground with feet already
 * planted it is a no-op, so it is safe to leave enabled.
 */

/** A two-bone leg: hip→knee (`upper`), knee→ankle (`lower`), the ankle (`foot`). */
export interface LegChain {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  foot: THREE.Object3D;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Module-scoped scratch so the per-frame solve allocates nothing.
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _bc = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _at = new THREE.Vector3();
const _nAc = new THREE.Vector3();
const _nAb = new THREE.Vector3();
const _nBc = new THREE.Vector3();
const _nAt = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _qParent = new THREE.Quaternion();
const _qRot = new THREE.Quaternion();
const _qDelta = new THREE.Quaternion();
const _footWorld = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _nUp = new THREE.Vector3();
const _qAlign = new THREE.Quaternion();
const _qClamp = new THREE.Quaternion();
const _qId = new THREE.Quaternion();

/**
 * Rotate a bone by `angle` radians about a WORLD-space `axis`, expressed as a
 * pre-multiply on its local quaternion (`qLocal' = (qP⁻¹·R·qP)·qLocal`, which
 * yields `qWorld' = R·qWorld`). Refreshes the bone's descendant world matrices so
 * a later read of a child (knee/ankle) sees the new pose.
 */
function rotateBoneWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  if (!bone.parent || Math.abs(angle) < 1e-5) return;
  bone.parent.getWorldQuaternion(_qParent);
  _qRot.setFromAxisAngle(axis, angle);
  _qDelta.copy(_qParent).invert().multiply(_qRot).multiply(_qParent);
  bone.quaternion.premultiply(_qDelta);
  bone.updateWorldMatrix(false, true);
}

/**
 * Apply a WORLD-space rotation `qWorld` to a bone (`qWorld'·qWorld = qWorld·…`),
 * expressed as a pre-multiply on its local quaternion the same way as
 * {@link rotateBoneWorld}. Used to tilt the foot onto a sloped ground normal.
 */
function rotateBoneWorldQuat(bone: THREE.Object3D, qWorld: THREE.Quaternion): void {
  if (!bone.parent) return;
  bone.parent.getWorldQuaternion(_qParent);
  _qDelta.copy(_qParent).invert().multiply(qWorld).multiply(_qParent);
  bone.quaternion.premultiply(_qDelta);
  bone.updateWorldMatrix(false, true);
}

/**
 * Analytic two-bone IK (Juckett): bend the hip + knee with the law-of-cosines
 * angles for the new hip→target distance, then swing the whole leg at the hip so
 * the ankle lands on `target`. `poleHint` (world space) disambiguates the bend
 * plane only when the leg is dead straight; otherwise the current knee position
 * defines the plane so the natural forward knee bend is preserved.
 */
export function solveLegToTarget(
  chain: LegChain,
  target: THREE.Vector3,
  poleHint?: THREE.Vector3,
): void {
  const { upper, lower, foot } = chain;
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  foot.getWorldPosition(_c);

  const lab = _a.distanceTo(_b);
  const lbc = _b.distanceTo(_c);
  if (lab < 1e-5 || lbc < 1e-5) return;

  _at.copy(target).sub(_a);
  const lat = clamp(_at.length(), 1e-4, lab + lbc - 1e-4);

  _ab.copy(_b).sub(_a);
  _bc.copy(_c).sub(_b);
  _ac.copy(_c).sub(_a);
  _nAb.copy(_ab).normalize();
  _nBc.copy(_bc).normalize();
  _nAc.copy(_ac).normalize();
  _nAt.copy(_at).normalize();

  // Current interior angles.
  const acab0 = Math.acos(clamp(_nAc.dot(_nAb), -1, 1));
  const babc0 = Math.acos(clamp(-_nAb.dot(_nBc), -1, 1));

  // Desired angles for the new reach length.
  const sol = solveTwoBoneIk(lab, lbc, lat);
  const acab1 = sol.rootAngle; // hip angle between upper bone and the reach line
  const babc1 = sol.jointAngle; // interior knee angle

  // Bend plane normal: the current leg plane, or the pole hint when straight.
  _axis.copy(_ac).cross(_ab);
  if (_axis.lengthSq() < 1e-8) {
    const pole = poleHint ?? _pole.set(0, 0, 1);
    _axis.copy(_at).cross(pole);
    if (_axis.lengthSq() < 1e-8) return;
  }
  _axis.normalize();

  rotateBoneWorld(upper, _axis, acab1 - acab0);
  rotateBoneWorld(lower, _axis, -(babc1 - babc0));

  // Swing the (now correctly-bent) leg so the ankle lands on the target line.
  foot.getWorldPosition(_c);
  _ac.copy(_c).sub(_a).normalize();
  _at.copy(target).sub(_a).normalize();
  _axis.copy(_ac).cross(_at);
  if (_axis.lengthSq() > 1e-8) {
    _axis.normalize();
    const swing = Math.acos(clamp(_ac.dot(_at), -1, 1));
    rotateBoneWorld(upper, _axis, swing);
  }
}

/**
 * Find a side's two-bone leg chain on a skeleton by bone-name substring, robust
 * across Biped (`Bip001_L_Thigh / Calf / Foot`) and Mixamo
 * (`mixamorigLeftUpLeg / Leg / Foot`) naming. Returns null if any bone is
 * missing so the grounder can no-op on rigs without locatable legs.
 */
export function findLegChain(root: THREE.Object3D, side: "L" | "R"): LegChain | null {
  const sideRe = side === "L" ? /_l_|left/i : /_r_|right/i;
  const upperRe = /thigh|upleg|upperleg/i;
  const lowerRe = /calf|shin|knee|lowerleg/i;
  const legRe = /leg/i;
  const footRe = /foot|ankle/i;
  const toeRe = /toe/i;
  let upper: THREE.Object3D | null = null;
  let lower: THREE.Object3D | null = null;
  let foot: THREE.Object3D | null = null;
  root.traverse((n) => {
    if (!(n as THREE.Bone).isBone) return;
    const nm = n.name;
    if (!sideRe.test(nm) || toeRe.test(nm)) return;
    if (!foot && footRe.test(nm)) foot = n;
    else if (!upper && upperRe.test(nm)) upper = n;
    else if (!lower && lowerRe.test(nm)) lower = n;
  });
  // Mixamo's lower leg is just "...LeftLeg" — pick it up when no calf/shin matched.
  if (!lower) {
    root.traverse((n) => {
      if (lower || !(n as THREE.Bone).isBone) return;
      const nm = n.name;
      if (!sideRe.test(nm) || toeRe.test(nm)) return;
      if (n !== upper && n !== foot && legRe.test(nm) && !upperRe.test(nm)) lower = n;
    });
  }
  return upper && lower && foot ? { upper, lower, foot } : null;
}

/**
 * One ground sample under a world (x, z): the floor height plus an optional
 * world up-normal of the surface (null = treat as flat +Y, i.e. no foot tilt).
 * Return a non-finite `y` to signal "off the ground" so the grounder leaves that
 * foot alone rather than yanking it to a fallback height.
 */
export interface GroundSample {
  y: number;
  normal: THREE.Vector3 | null;
}

/** Samples the ground under a world (x, z); default = flat y=0, no tilt. */
export type GroundSampler = (x: number, z: number) => GroundSample;

const FLAT_GROUND: GroundSampler = () => ({ y: 0, normal: null });

/**
 * Per-avatar foot-to-ground grounder: drops the pelvis to the deepest required
 * foot, re-plants both ankles onto the sampled ground, and tilts each foot onto
 * the ground normal. Disabled by default so it never changes existing behaviour
 * until a host opts in (and supplies a real ground sampler); on flat ground it
 * resolves to a no-op. Vertical corrections + the pelvis drop are smoothed across
 * frames so stepping over uneven terrain doesn't pop.
 */
export class FootGrounder {
  enabled = false;
  /** Max distance a foot may be lifted onto a rise / dropped into a dip (metres). */
  maxLift = 0.4;
  maxDrop = 0.4;
  /** Tilt each foot onto the sampled ground normal (clamped to {@link maxTilt}). */
  alignFeet = true;
  /** Max foot tilt onto a slope, radians (~28°). */
  maxTilt = 0.5;
  /** Exponential smoothing rate (per second) for foot offsets + the pelvis drop. */
  smooth = 14;

  private left: LegChain | null = null;
  private right: LegChain | null = null;
  private pelvis: THREE.Object3D | null = null;
  private sampler: GroundSampler = FLAT_GROUND;

  // Smoothed corrections carried across frames (snapped on the first frame after
  // enabling / a sampler swap so there's no initial lerp from a stale value).
  private smLeft = 0;
  private smRight = 0;
  private smDrop = 0;
  private primed = false;

  // The pelvis drop mutates `pelvis.position` AFTER the mixer. That is only safe
  // if we also UNDO it before the next mixer.update, because many rigs (e.g. the
  // Bip001 hero clips) animate the pelvis with rotation only and NO translation
  // track — the mixer never re-writes its position, so a drop left in place would
  // compound: the rig sinks through the floor and the over-dropped hip folds the
  // legs up toward the torso. Worse, if a one-shot clip (evade, an idle variant)
  // STARTS while the pelvis is dropped, the mixer saves that dropped pose as the
  // clip's "original state" and restores it when the clip finishes — leaking one
  // extra drop per clip cycle, so repeated evades / idle re-triggers slowly sink
  // the rig even when a single frame looks fine. The cure is `beginFrame()`:
  // restore the pelvis to its captured bind-pose local BEFORE every mixer.update
  // so the mixer always sees (and thus saves/restores) a clean base. `apply()`
  // then reads the post-mixer pose — the true animated base — and applies the
  // drop absolutely, so it can never compound regardless of clip lifecycle.
  private readonly pelvisBindLocal = new THREE.Vector3();
  private pelvisBindCaptured = false;

  /** Bind the grounder to a skeleton root; locates both legs + the pelvis (hips). */
  bind(root: THREE.Object3D): void {
    this.left = findLegChain(root, "L");
    this.right = findLegChain(root, "R");
    this.pelvis = this.findPelvis(root);
    // Capture the rest-pose pelvis local position as the base we restore to
    // before every mixer update. At bind time no clip has deformed it yet.
    if (this.pelvis) {
      this.pelvisBindLocal.copy(this.pelvis.position);
      this.pelvisBindCaptured = true;
    } else {
      this.pelvisBindCaptured = false;
    }
  }

  /**
   * Restore the pelvis to its bind-pose local BEFORE the mixer runs. Call this
   * once per frame, immediately before `mixer.update`, so the mixer always sees
   * a clean (undropped) base — this is what keeps the drop from compounding and
   * stops a clip's save/restore of "original state" from leaking a stale drop.
   * No-op until bound and while disabled.
   */
  beginFrame(): void {
    if (!this.enabled || !this.pelvisBindCaptured || !this.pelvis) return;
    this.pelvis.position.copy(this.pelvisBindLocal);
  }

  setEnabled(on: boolean): void {
    // Restore the pelvis to its bind-pose local when switching off so the rig
    // isn't left with a stale drop baked into its position.
    if (!on && this.pelvisBindCaptured && this.pelvis) {
      this.pelvis.position.copy(this.pelvisBindLocal);
      this.pelvis.updateWorldMatrix(false, true);
    }
    this.enabled = on;
    if (!on) this.primed = false; // re-enable snaps to the live ground
  }

  setGroundSampler(fn: GroundSampler): void {
    this.sampler = fn;
    this.primed = false; // a new world: snap rather than lerp from the old one
  }

  get isBound(): boolean {
    return !!(this.left && this.right);
  }

  private findPelvis(root: THREE.Object3D): THREE.Object3D | null {
    let hit: THREE.Object3D | null = null;
    root.traverse((n) => {
      if (hit || !(n as THREE.Bone).isBone) return;
      if (/pelvis|hips|hip\b/i.test(n.name)) hit = n;
    });
    return hit;
  }

  /**
   * Sample the ground under one foot: its desired vertical correction and the
   * surface normal. Returns null if the chain is missing; a zero offset (and no
   * normal) when the sample is off-ground (non-finite y) so that foot is left be.
   */
  private footSample(
    chain: LegChain | null,
  ): { offset: number; normal: THREE.Vector3 | null } | null {
    if (!chain) return null;
    chain.foot.getWorldPosition(_footWorld);
    const s = this.sampler(_footWorld.x, _footWorld.z);
    if (!Number.isFinite(s.y)) return { offset: 0, normal: null };
    return {
      offset: footPlantOffset(_footWorld.y, s.y, this.maxLift, this.maxDrop),
      normal: s.normal,
    };
  }

  /** Re-plant one foot onto the ground (foot world Y + its correction). */
  private plant(chain: LegChain | null, offset: number, poleHint: THREE.Vector3): void {
    if (!chain || Math.abs(offset) < 1e-4) return;
    chain.foot.getWorldPosition(_footWorld);
    _footWorld.y += offset;
    solveLegToTarget(chain, _footWorld, poleHint);
  }

  /** Tilt one foot bone so its sole follows the ground normal (clamped). */
  private align(chain: LegChain | null, normal: THREE.Vector3 | null): void {
    if (!chain || !normal || !this.alignFeet) return;
    _nUp.set(0, 1, 0);
    _qAlign.setFromUnitVectors(_nUp, normal); // rotation taking +Y onto the normal
    // Clamp the tilt: slerp from identity toward the full alignment so a steep
    // slope never folds the ankle past `maxTilt`.
    const ang = 2 * Math.acos(Math.min(1, Math.abs(_qAlign.w)));
    if (ang < 1e-4) return;
    const t = ang > this.maxTilt ? this.maxTilt / ang : 1;
    _qId.identity();
    _qClamp.copy(_qId).slerp(_qAlign, t);
    rotateBoneWorldQuat(chain.foot, _qClamp);
  }

  /**
   * Run the grounding pass. Call this exactly once per frame, AFTER the mixer
   * update (and any additive pose overrides) — the documented post-mixer order.
   * `dt` drives the cross-frame smoothing.
   */
  apply(dt: number): void {
    if (!this.enabled || !this.left || !this.right) return;

    // The pelvis is already at its true animated base here: `beginFrame()`
    // restored it to bind-local before the mixer ran, and the mixer then wrote
    // whatever the active clip animates (a translation track, or nothing for the
    // rotation-only hero clips — in which case bind-local IS the animated base).
    // So we can sample the feet and drop absolutely with no reconciliation.
    const ls = this.footSample(this.left);
    const rs = this.footSample(this.right);
    if (!ls || !rs) return;

    // Exponential smoothing of both foot offsets + the pelvis drop. The first
    // frame after enabling snaps (k=1) so feet don't visibly lerp into place.
    const k = this.primed ? 1 - Math.exp(-this.smooth * Math.max(dt, 1e-4)) : 1;
    this.smLeft += (ls.offset - this.smLeft) * k;
    this.smRight += (rs.offset - this.smRight) * k;
    const drop = pelvisDropForFeet([this.smLeft, this.smRight]);
    this.smDrop += (drop - this.smDrop) * k;
    this.primed = true;

    // Drop the pelvis to the lowest-reaching foot, then re-plant both feet on
    // top (each foot's remaining correction is relative to the lowered pelvis).
    // The pelvis sits at its animated base (restored by beginFrame() before the
    // mixer) so the drop is applied absolutely, never compounding frame to frame.
    if (this.pelvis && this.smDrop < -1e-4) {
      const p = this.pelvis;
      p.getWorldPosition(_footWorld);
      _footWorld.y += this.smDrop;
      p.parent?.worldToLocal(_footWorld);
      p.position.copy(_footWorld);
      p.updateWorldMatrix(false, true);
    }

    // Pole hint: forward (+Z in root space) keeps knees bending forward when a
    // leg solves from a straight pose.
    _pole.set(0, 0, 1);
    this.plant(this.left, this.smLeft - this.smDrop, _pole);
    this.plant(this.right, this.smRight - this.smDrop, _pole);

    // Foot orientation alignment runs LAST, after the ankles are planted.
    this.align(this.left, ls.normal);
    this.align(this.right, rs.normal);
  }
}
