/**
 * Spine aim IK — first/third-person gun/look pitch (and 3P yaw bias).
 *
 * Order (must match Character.update):
 *   1. restoreBones()   before mixer.update  (undo last IK)
 *   2. mixer.update
 *   3. FootGrounder.apply
 *   4. applyAim1P / applyAim3P  after mixer + feet
 *
 * Ported from the gun-aim spine IK reference (Euler/Quaternion local-space aim).
 */
import { Euler, Quaternion, Vector3, type Object3D, type Camera } from "three";

// Reused temps (avoid per-frame GC)
const _aimQ = new Quaternion();
const _yawQ = new Quaternion();
const _localPitchQ = new Quaternion();
const _parentWorldQ = new Quaternion();
const _cameraWorldQ = new Quaternion();
const _aimAxis = new Vector3(1, 0, 0);
const _yawAxis = new Vector3(0, 1, 0);

const _headWorldQ = new Quaternion();
const _headParentWorldQ = new Quaternion();
const _headEuler = new Euler();

/** Max third-person orbit pitch used to normalize the pitch curve (50°). */
const PITCH_NORM = Math.PI * (50 / 180);

export class SpineIK {
  spineBones: Object3D[];
  headBone: Object3D | null;
  /** Clean animation pose saved each apply; restored next frame pre-mixer. */
  baseQuats: Quaternion[];

  constructor(spineBones: Object3D[], headBone: Object3D | null = null) {
    this.spineBones = spineBones;
    this.headBone = headBone;
    this.baseQuats = spineBones.map(() => new Quaternion());
  }

  get isBound(): boolean {
    return this.spineBones.length > 0;
  }

  /** Restore spine to pre-IK animation pose (call BEFORE mixer.update). */
  restoreBones(): void {
    for (let i = 0; i < this.spineBones.length; i++) {
      this.spineBones[i].quaternion.copy(this.baseQuats[i]);
    }
  }

  /** Zero head roll so 1P camera mount doesn't tilt with animation. */
  clearHeadRoll(): void {
    const head = this.headBone;
    if (!head?.parent) return;
    head.updateWorldMatrix(true, false);
    head.getWorldQuaternion(_headWorldQ);
    _headEuler.setFromQuaternion(_headWorldQ, "YXZ");
    _headEuler.z = 0;
    _headWorldQ.setFromEuler(_headEuler);
    head.parent.getWorldQuaternion(_headParentWorldQ);
    head.quaternion.copy(_headParentWorldQ).invert().multiply(_headWorldQ);
    head.updateWorldMatrix(false, false);
  }

  /**
   * First-person aim: distribute pitchTarget across spine so arms follow look.
   * Call AFTER mixer + foot IK.
   */
  applyAim1P(camera: Camera, pitchTarget: number): void {
    if (!this.spineBones.length) return;
    this.clearHeadRoll();

    camera.getWorldQuaternion(_cameraWorldQ);
    _aimAxis.set(1, 0, 0).applyQuaternion(_cameraWorldQ);
    _aimQ.setFromAxisAngle(_aimAxis, pitchTarget / this.spineBones.length);

    this.spineBones[0].parent?.updateWorldMatrix(true, false);
    for (let i = 0; i < this.spineBones.length; i++) {
      this.baseQuats[i].copy(this.spineBones[i].quaternion);
      const parent = this.spineBones[i].parent;
      if (!parent) continue;
      parent.getWorldQuaternion(_parentWorldQ);
      _localPitchQ.copy(_parentWorldQ).invert().multiply(_aimQ).multiply(_parentWorldQ);
      this.spineBones[i].quaternion.premultiply(_localPitchQ);
      this.spineBones[i].updateWorldMatrix(false, false);
    }
    this.spineBones[this.spineBones.length - 1].updateWorldMatrix(false, true);
  }

  /**
   * Third-person aim: pitch + slight yaw toward screen center when gun-engaged.
   * Mutates camera.rotation.x for visual compensation (caller should own camera).
   */
  applyAim3P(camera: Camera & { rotation: { x: number } }, isGunEngaged: boolean): void {
    if (!this.spineBones.length) return;

    const normalizedPitch = camera.rotation.x / PITCH_NORM;
    const pitchSq = Math.pow(Math.abs(normalizedPitch), 2.0);

    const pitchTarget = isGunEngaged ? camera.rotation.x : 0;
    // Visual compensation: look-down raises aim, look-up softens
    camera.rotation.x += normalizedPitch > 0 ? pitchSq * 0.35 : -pitchSq * 0.1;

    const yawTarget = isGunEngaged
      ? -Math.PI * ((10 * (1 + pitchSq * 0.35)) / 180)
      : 0;

    _aimAxis.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _aimQ.setFromAxisAngle(_aimAxis, pitchTarget / this.spineBones.length);
    _yawQ.setFromAxisAngle(_yawAxis, yawTarget);
    _aimQ.premultiply(_yawQ);

    this.spineBones[0].parent?.updateWorldMatrix(true, false);
    for (let i = 0; i < this.spineBones.length; i++) {
      this.baseQuats[i].copy(this.spineBones[i].quaternion);
      const parent = this.spineBones[i].parent;
      if (!parent) continue;
      parent.getWorldQuaternion(_parentWorldQ);
      _localPitchQ.copy(_parentWorldQ).invert().multiply(_aimQ).multiply(_parentWorldQ);
      this.spineBones[i].quaternion.premultiply(_localPitchQ);
      this.spineBones[i].updateWorldMatrix(false, false);
    }
  }
}

/**
 * Discover spine chain + head on a Mixamo / Bip001 / generic humanoid skeleton.
 * Returns bones ordered pelvis → upper chest (bottom to top).
 */
export function findSpineBones(root: Object3D): {
  spine: Object3D[];
  head: Object3D | null;
} {
  const byName = new Map<string, Object3D>();
  root.traverse((n) => {
    if ((n as { isBone?: boolean }).isBone || /spine|chest|torso|neck|head|hips|pelvis/i.test(n.name)) {
      byName.set(n.name, n);
    }
  });

  const prefer = [
    [/hips|pelvis|bip001(?!_)/i, 0],
    [/spine(?!1|2|3)|spine0|bip001.?spine(?!\d)/i, 1],
    [/spine1|bip001.?spine1/i, 2],
    [/spine2|chest|bip001.?spine2/i, 3],
    [/spine3|upperchest|bip001.?spine3/i, 4],
  ] as const;

  const scored: { bone: Object3D; score: number }[] = [];
  for (const [name, bone] of byName) {
    for (const [re, score] of prefer) {
      if (re.test(name)) {
        scored.push({ bone, score });
        break;
      }
    }
  }
  scored.sort((a, b) => a.score - b.score);
  // Unique bones, keep order
  const spine: Object3D[] = [];
  const seen = new Set<Object3D>();
  for (const { bone } of scored) {
    if (seen.has(bone)) continue;
    // Skip pure hips if we have real spine bones
    if (/hips|pelvis/i.test(bone.name) && scored.some((s) => /spine/i.test(s.bone.name))) {
      continue;
    }
    seen.add(bone);
    spine.push(bone);
  }

  // Fallback: any "Spine*" chain sorted by name
  if (spine.length < 2) {
    const spines: Object3D[] = [];
    root.traverse((n) => {
      if (/spine/i.test(n.name) && (n as { isBone?: boolean }).isBone) spines.push(n);
    });
    spines.sort((a, b) => a.name.localeCompare(b.name));
    if (spines.length) return { spine: spines.slice(0, 4), head: findHead(root) };
  }

  return { spine: spine.slice(0, 4), head: findHead(root) };
}

function findHead(root: Object3D): Object3D | null {
  let head: Object3D | null = null;
  root.traverse((n) => {
    if (head) return;
    if (/^head$|head_end|bip001.?head$/i.test(n.name) && (n as { isBone?: boolean }).isBone) {
      head = n;
    }
  });
  if (!head) {
    root.traverse((n) => {
      if (head) return;
      if (/head/i.test(n.name) && (n as { isBone?: boolean }).isBone) head = n;
    });
  }
  return head;
}
