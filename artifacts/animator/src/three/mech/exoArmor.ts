import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { asset } from "../assets";

/**
 * Self-hosted, normalized loader + per-instance wrapper for the Exo-Armour mech
 * GLB ("Mecha_00" pack, rebuilt by scripts/src/build-mech-glb.mjs into a single
 * 87-bone rig + Core/Base_M part meshes carrying 9 embedded clips). The rig is
 * NOT humanoid-Mixamo, so it cannot reuse the shared character clip library —
 * everything plays from the embedded clips:
 *
 *  - Suit-up morph: the "Mech_Crouch" clip (a stand→crouch transition) is
 *    SCRUBBED by the transformation phases — the armour materializes kneeling
 *    (opening holds the fully-crouched end pose), rises to stand as it seals
 *    (enclosing scrubs end→start), and kneels back down while cracking open on
 *    exit (exiting scrubs start→end). See {@link setMorph}.
 *  - Piloted locomotion: weight-blended Idle/Walk/Run driven by the pilot's
 *    normalized speed, with the walk/run time scale riding the same speed.
 *  - Aim: {@link setAimTilt} leans ONLY the torso (spine bone, post-mixer)
 *    about the mech's level right-axis, so the chassis/legs stay flat while the
 *    upper body tracks the camera pitch.
 *
 * The template is loaded + prepared ONCE and cached; every {@link ExoArmor}
 * instance clones it with {@link cloneSkinned} (SkeletonUtils) so each clone gets
 * its own rebound skeleton (a plain `.clone()` would break skinning). Clones
 * SHARE the template's geometry + materials, so an instance must NEVER dispose
 * those — only the cached template owns those GPU resources for the app's life.
 */
const MECH_FILE = "models/mech-00.glb";

/** Mech target height in metres — larger/heavier than a ~2m fighter. */
export const MECH_HEIGHT_M = 3.2;

/** Torso bone the aim tilt drives (level chassis, pitched upper body). */
const SPINE_BONE = "spine_01x";

/** Transformation phase as the mech visual needs it (mirrors MechPhase). */
export type MechMorphPhase = "idle" | "opening" | "enclosing" | "piloted" | "exiting";

interface ExoArmorTemplate {
  scene: THREE.Group;
  /** Embedded clips by name (Mech_Idle / Mech_Walk / Mech_Run / Mech_Crouch…). */
  clips: Map<string, THREE.AnimationClip>;
}

const loader = new GLTFLoader();
let templatePromise: Promise<ExoArmorTemplate | null> | null = null;

/** Load + normalize the mech template once; cached for the app's lifetime. */
export function loadExoArmorTemplate(): Promise<ExoArmorTemplate | null> {
  if (!templatePromise) {
    templatePromise = buildTemplate().catch((err) => {
      console.error("[exoArmor] failed to load mech template", err);
      templatePromise = null; // allow a later retry
      return null;
    });
  }
  return templatePromise;
}

async function buildTemplate(): Promise<ExoArmorTemplate> {
  const gltf = await loader.loadAsync(asset(MECH_FILE));
  const model = gltf.scene;

  // Fit to the target world height (source is authored in centimetres).
  model.updateWorldMatrix(true, true);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.setScalar(MECH_HEIGHT_M / (size.y || 1));

  // Recentre on X/Z and drop the base to Y=0 (after scaling).
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;

  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  const wrap = new THREE.Group();
  wrap.add(model);
  const clips = new Map<string, THREE.AnimationClip>();
  for (const clip of gltf.animations) clips.set(clip.name, clip);
  return { scene: wrap, clips };
}

// Scratch objects for the post-mixer torso tilt (no per-frame allocations).
const _tiltRight = new THREE.Vector3();
const _qTilt = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _qLocal = new THREE.Quaternion();

/**
 * One spawned mech instance. Owns a SkeletonUtils clone of the shared template
 * plus its own {@link THREE.AnimationMixer} driving the embedded clip set. The
 * visible assembly amount (0 = absent/open, 1 = fully closed) is applied as a
 * scale on an inner group so the open/close transition reads procedurally
 * without touching shared materials.
 */
export class ExoArmor {
  /** Outer group — the owner positions/orients THIS each frame. */
  readonly root = new THREE.Group();
  /** Inner group whose scale we drive for the assemble/close effect. */
  private readonly inner = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private runAction: THREE.AnimationAction | null = null;
  /** Paused, manually-scrubbed stand→crouch clip driving the suit-up morph. */
  private crouchAction: THREE.AnimationAction | null = null;
  private crouchDur = 0;
  /** Current morph weight (1 = crouch scrub owns the pose, 0 = locomotion). */
  private morphWeight = 1;
  private morphPhase: MechMorphPhase = "idle";
  /** Torso bone the aim tilt is applied to after the mixer each frame. */
  private spine: THREE.Object3D | null = null;
  private aimTiltTarget = 0;
  private aimTilt = 0;

  // ── Procedural "heavy walk" state ──────────────────────────────────────────
  /** Stride phase (radians); a foot plants every π. Advanced only while moving. */
  private stridePhase = 0;
  /** Smoothed normalized move speed (0..1) driving lean/footstep cadence. */
  private smoothedSpeed = 0;
  /** Smoothed roll lean into turns (radians). */
  private leanRoll = 0;
  /** Previous facing yaw, for the lean-into-turn yaw-rate. */
  private prevYaw = 0;
  private yawInit = false;

  constructor() {
    this.root.add(this.inner);
    this.root.visible = false;
  }

  /** Clone the shared template + bind the embedded clips. Idempotent. */
  async load(): Promise<boolean> {
    if (this.model) return true;
    const tpl = await loadExoArmorTemplate();
    if (!tpl) return false;
    // SkeletonUtils clone so the skinned meshes rebind to a fresh skeleton.
    const model = cloneSkinned(tpl.scene) as THREE.Object3D;
    this.model = model;
    this.inner.add(model);
    this.spine = model.getObjectByName(SPINE_BONE) ?? null;

    const mixer = new THREE.AnimationMixer(model);
    this.mixer = mixer;
    const looping = (name: string): THREE.AnimationAction | null => {
      const clip = tpl.clips.get(name);
      if (!clip) return null;
      const action = mixer.clipAction(clip);
      action.setEffectiveWeight(0);
      action.play();
      return action;
    };
    this.idleAction = looping("Mech_Idle");
    this.walkAction = looping("Mech_Walk");
    this.runAction = looping("Mech_Run");
    const crouchClip = tpl.clips.get("Mech_Crouch");
    if (crouchClip) {
      this.crouchDur = crouchClip.duration;
      const crouch = mixer.clipAction(crouchClip);
      crouch.setLoop(THREE.LoopOnce, 0);
      crouch.clampWhenFinished = true;
      crouch.setEffectiveWeight(1);
      crouch.play();
      crouch.paused = true; // scrubbed manually by setMorph()
      this.crouchAction = crouch;
    }
    return true;
  }

  get loaded(): boolean {
    return this.model != null;
  }

  /**
   * Drive the suit-up morph from the transformation state machine. The
   * stand→crouch clip is scrubbed (never advanced by the mixer):
   *  - opening   — hold the fully-crouched end pose (armour assembles kneeling),
   *  - enclosing — scrub end→start so the mech RISES to stand as it seals,
   *  - exiting   — scrub start→end so it kneels back down while cracking open,
   *  - piloted   — the crouch fades out and the Idle/Walk/Run blend takes over.
   */
  setMorph(phase: MechMorphPhase, progress: number): void {
    this.morphPhase = phase;
    const crouch = this.crouchAction;
    if (!crouch || this.crouchDur <= 0) return;
    // Keep a hair inside the clip so LoopOnce never flips to "finished".
    const maxT = Math.max(0, this.crouchDur - 1e-3);
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    switch (phase) {
      case "opening":
        crouch.time = maxT;
        break;
      case "enclosing":
        crouch.time = maxT * (1 - p);
        break;
      case "exiting":
        crouch.time = maxT * p;
        break;
      default:
        break; // piloted/idle: weight handling below owns the pose
    }
  }

  /**
   * Aim elevation for the torso (radians, + = up). Only the spine bone is
   * rotated (post-mixer, about the mech's LEVEL right-axis), so the chassis and
   * legs never pitch with the camera. Smoothed toward the target each frame.
   */
  setAimTilt(elevation: number): void {
    this.aimTiltTarget = THREE.MathUtils.clamp(elevation, -0.6, 0.6);
  }

  /** Advance the clip mixer, blend weights, and apply the torso aim tilt. */
  update(dt: number): void {
    if (!this.mixer) return;
    this.applyWeights(dt);
    this.mixer.update(dt);
    this.applyAimTilt(dt);
  }

  /** Crossfade crouch-morph vs. speed-blended Idle/Walk/Run each frame. */
  private applyWeights(dt: number): void {
    const piloted = this.morphPhase === "piloted";
    // Snap INTO the morph pose (a transition owns the body instantly) but fade
    // OUT into locomotion so the stand→idle handoff reads as one motion.
    const morphTarget = piloted ? 0 : 1;
    if (morphTarget > this.morphWeight) this.morphWeight = morphTarget;
    else this.morphWeight += (morphTarget - this.morphWeight) * Math.min(1, 7 * dt);

    const move = this.smoothedSpeed;
    const loco = 1 - this.morphWeight;
    const runW = THREE.MathUtils.smoothstep(move, 0.55, 0.9);
    const walkW = THREE.MathUtils.smoothstep(move, 0.06, 0.45) * (1 - runW);
    const idleW = Math.max(0, 1 - walkW - runW);
    this.crouchAction?.setEffectiveWeight(this.morphWeight);
    this.idleAction?.setEffectiveWeight(loco * idleW);
    this.walkAction?.setEffectiveWeight(loco * walkW);
    this.runAction?.setEffectiveWeight(loco * runW);
    // Stride pace rides the speed so foot travel roughly tracks ground speed.
    this.walkAction?.setEffectiveTimeScale(0.75 + 0.5 * move);
    this.runAction?.setEffectiveTimeScale(0.8 + 0.35 * move);
  }

  /** Post-mixer torso lean about the mech's level (world) right-axis. */
  private applyAimTilt(dt: number): void {
    this.aimTilt += (this.aimTiltTarget - this.aimTilt) * Math.min(1, 10 * dt);
    const spine = this.spine;
    if (!spine || !spine.parent || Math.abs(this.aimTilt) < 1e-4) return;
    // World right-axis for the mech's current facing (root is yaw-only).
    const yaw = this.root.rotation.y;
    _tiltRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
    // Rotating about +right by a positive angle pitches the torso DOWN, so the
    // "+ = up" elevation negates. Convert the world rotation into the bone's
    // parent space: local' = qParent⁻¹ · R · qParent · local.
    _qTilt.setFromAxisAngle(_tiltRight, -this.aimTilt);
    spine.parent.getWorldQuaternion(_qParent);
    _qLocal.copy(_qParent).invert().multiply(_qTilt).multiply(_qParent);
    spine.quaternion.premultiply(_qLocal);
  }

  /** Drive the assemble/close visual: 0 = collapsed/open, 1 = fully formed. */
  setClosure(closure: number): void {
    const c = THREE.MathUtils.clamp(closure, 0, 1);
    // Rise from a flattened, partially-assembled state to full size; a small
    // floor keeps the meshes from inverting at closure 0.
    const s = THREE.MathUtils.lerp(0.25, 1, c);
    this.inner.scale.setScalar(s);
    this.root.visible = c > 0.001;
  }

  /**
   * Procedural "heavy walk" feel layered on top of the clip-driven locomotion.
   * The clips own the leg/arm motion and vertical bob now, so this only keeps:
   *  - the roll lean into turns (from the owner-set yaw's rate of change),
   *  - a subtle side-to-side weight sway, and
   *  - the foot-plant CADENCE events (dust/shockwave/audio hooks for the owner).
   *
   * Returns a foot-plant event ({@link side}: -1 left / +1 right) on the frame a
   * heavy foot lands so the owner can spawn dust, a shockwave, audio and camera
   * shake at that foot — otherwise null. Eases back to a neutral pose when idle so
   * the transformation phases (which call this with piloted=false) read clean.
   */
  updateLocomotion(dt: number, speed: number, piloted: boolean): { side: -1 | 1 } | null {
    if (dt <= 0) return null;
    // Normalize the controller's smoothed speed: ~0.65 is the run threshold.
    const target = piloted ? THREE.MathUtils.clamp(speed / 0.9, 0, 1) : 0;
    this.smoothedSpeed += (target - this.smoothedSpeed) * Math.min(1, 8 * dt);
    const move = this.smoothedSpeed;

    // Lean into turns from the yaw rate (owner sets root.rotation.y before this).
    const yaw = this.root.rotation.y;
    if (!this.yawInit) {
      this.prevYaw = yaw;
      this.yawInit = true;
    }
    let dyaw = yaw - this.prevYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.prevYaw = yaw;
    const yawRate = dyaw / dt;
    const targetRoll =
      THREE.MathUtils.clamp(-yawRate * 0.1, -0.16, 0.16) * (0.4 + 0.6 * move);
    this.leanRoll += (targetRoll - this.leanRoll) * Math.min(1, 6 * dt);

    // Advance the stride only while actually moving so a stopped mech never bobs;
    // when stopped the phase is frozen and the smoothed speed eases the bob out.
    let footstep: { side: -1 | 1 } | null = null;
    if (move > 0.05) {
      const prevStep = Math.floor(this.stridePhase / Math.PI);
      this.stridePhase += (2.4 + 2.2 * move) * dt;
      const newStep = Math.floor(this.stridePhase / Math.PI);
      if (newStep > prevStep && move > 0.18) {
        footstep = { side: newStep % 2 === 0 ? 1 : -1 };
      }
    }

    // The clips carry the vertical heave now — keep only a light weight sway
    // plus the turn lean so the chassis stays level (aim pitches the torso only).
    this.inner.position.y = 0;
    this.inner.position.x = Math.sin(this.stridePhase * 0.5) * 0.03 * move;
    this.inner.rotation.x = 0.03 * move;
    this.inner.rotation.z = this.leanRoll + Math.sin(this.stridePhase * 0.5) * 0.02 * move;
    return footstep;
  }

  /** World-space transform helpers the owner calls each frame. */
  setPosition(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
  }

  setYaw(yaw: number): void {
    this.root.rotation.y = yaw;
  }

  /**
   * Dispose ONLY this instance's owned resources: the animation mixer and the
   * cloned scene graph nodes. Geometry + materials are SHARED with the cached
   * template (via SkeletonUtils clone), so they are intentionally left intact.
   */
  dispose(): void {
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.idleAction = null;
    this.walkAction = null;
    this.runAction = null;
    this.crouchAction = null;
    this.spine = null;
    if (this.model) {
      this.inner.remove(this.model);
      this.model = null;
    }
    this.root.removeFromParent();
  }
}
