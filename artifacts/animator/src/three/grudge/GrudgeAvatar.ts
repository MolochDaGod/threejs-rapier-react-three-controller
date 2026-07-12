import * as THREE from "three";
import type { AnimRole, Avatar, CharacterDef } from "../types";
import { FootGrounder, type GroundSampler } from "../anim/legIk";
import {
  ANIM_PACK_CLIPS,
  SPRINT_CLIP,
  applyBodyTexture,
  applyGearPreset,
  findHandBone,
  getPreset,
  loadBakedClip,
  loadBodyTexture,
  loadCharacterModel,
  RACE_ASSETS,
  type PresetId,
  type RaceId,
} from "./index";

/**
 * An {@link Avatar} backed by the vendored Grudge character-kit: a normalized
 * customizable race FBX (one shared body atlas, equipment-driven mesh
 * visibility) animated by pre-baked Bip001 clips streamed from the asset host.
 *
 * It mirrors {@link Character} (the GLB avatar) so the Animator's `Controller`
 * drives it unchanged — a continuous idle/walk/run locomotion blend plus
 * one-shot overlay actions (attack) that crossfade in and hand control back.
 *
 * The normalized FBX group already faces +Z and sits with feet on y=0; an inner
 * `holder` carries the optional `modelYaw` so the art-forward can be re-aimed
 * without disturbing the group's self-contained centering transform.
 */
export class GrudgeAvatar implements Avatar {
  root = new THREE.Group();
  def: CharacterDef;
  rightHand: THREE.Object3D | null = null;
  leftHand: THREE.Object3D | null = null;

  readonly raceId: RaceId;
  readonly presetId: PresetId;

  private holder = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private roleClip = new Map<AnimRole, string>();
  private current: THREE.AnimationAction | null = null;
  private oneShot: THREE.AnimationAction | null = null;
  private oneShotEnd = 0;
  private skeletonHelper: THREE.SkeletonHelper | null = null;
  private blendTime = 0.22;
  private modelYaw = 0;
  private disposed = false;

  private bodyTexture: THREE.Texture | null = null;
  private bodyMaterial: THREE.Material | null = null;

  /** Foot-to-ground IK pass; bound on load, applied post-mixer, default OFF. */
  private footGrounder = new FootGrounder();

  // ── Skill Lab authoring knobs ──────────────────────────────────────────────
  /** Global playback multiplier applied to locomotion + authored one-shots. */
  private overdrive = 1;
  /** Whether authored clips play left/right mirrored. */
  private mirror = false;
  /** Arm spread, -1 (tucked) .. +1 (wide); additive on the upper-arm bones. */
  private armWidth = 0;
  private lUpperArm: THREE.Object3D | null = null;
  private rUpperArm: THREE.Object3D | null = null;
  private readonly armAxis = new THREE.Vector3(0, 0, 1);
  private readonly armScratch = new THREE.Quaternion();
  /** Cache of sliced/mirrored authored clips, keyed by name|from|to|mirror. */
  private authoredClips = new Map<string, THREE.AnimationClip>();
  /** Editable damaging hit sphere; anchored to the swinging hand, origin + angle for skill VFX. */
  private colliderHelper: THREE.Mesh | null = null;
  private showCollider = true;
  private colliderSpec: { x: number; y: number; z: number; radius: number } | null = null;
  // Scratch for the per-frame collider world transform (no hot-path allocation).
  private readonly cHandPos = new THREE.Vector3();
  private readonly cBodyQuat = new THREE.Quaternion();
  private readonly cHandQuat = new THREE.Quaternion();
  private readonly cOffset = new THREE.Vector3();
  private readonly cWorldPos = new THREE.Vector3();
  private readonly cWorldQuat = new THREE.Quaternion();
  private readonly cRootQuat = new THREE.Quaternion();

  constructor(raceId: RaceId, presetId: PresetId) {
    this.raceId = raceId;
    this.presetId = presetId;
    const race = RACE_ASSETS[raceId];
    const preset = getPreset(raceId, presetId);
    this.root.add(this.holder);
    this.def = {
      id: `grudge:${raceId}:${presetId}`,
      name: `${race.name} ${preset.label}`,
      file: race.modelUrl,
      scale: 1,
      clips: {},
      signatureSkills: [],
      handBone: "Bip001_(R|L)_Hand",
      modelYaw: 0,
    };
  }

  async load(): Promise<void> {
    const race = RACE_ASSETS[this.raceId];
    const preset = getPreset(this.raceId, this.presetId);

    const loaded = await loadCharacterModel(race.modelUrl);
    if (this.disposed) {
      this.disposeObject3D(loaded.group);
      return;
    }
    applyGearPreset(loaded.group, preset.visibleMeshes);

    const tex = await loadBodyTexture(race.textureUrl);
    if (this.disposed) {
      tex.dispose();
      this.disposeObject3D(loaded.group);
      return;
    }
    this.bodyTexture = tex;
    this.bodyMaterial = applyBodyTexture(loaded.group, tex);

    this.model = loaded.group;
    this.mixer = loaded.mixer;
    this.holder.add(loaded.group);

    // Stream the baked locomotion/attack clips for this preset's anim pack and
    // bind them under stable logical keys (role name) — keys, not clip names, so
    // packs that reuse a base clip (e.g. run + sprint both "running") never
    // collide in the action map.
    const pack = ANIM_PACK_CLIPS[preset.animPack];
    const wanted: { key: string; role: AnimRole | null; rel: string }[] = [
      { key: "idle", role: "idle", rel: pack.idle },
      { key: "walk", role: "walk", rel: pack.walk },
      { key: "run", role: "run", rel: pack.run },
      { key: "attack", role: "attack", rel: pack.attack },
      { key: "sprint", role: null, rel: SPRINT_CLIP },
    ];
    const loadedClips = await Promise.all(
      wanted.map(async (w) => {
        try {
          const clip = await loadBakedClip(w.rel);
          return { ...w, clip };
        } catch (err) {
          console.error(`[GrudgeAvatar] clip "${w.rel}" failed`, err);
          return { ...w, clip: null as THREE.AnimationClip | null };
        }
      }),
    );
    if (this.disposed || !this.mixer) {
      this.teardownGpu();
      return;
    }
    for (const { key, role, clip } of loadedClips) {
      if (!clip) continue;
      clip.name = key;
      const action = this.mixer.clipAction(clip);
      this.actions.set(key, action);
      if (role) this.roleClip.set(role, key);
    }
    // Cross-fill locomotion so movement always reads even if a clip 404'd.
    if (!this.roleClip.has("idle") && this.actions.size) {
      this.roleClip.set("idle", [...this.actions.keys()][0]);
    }
    if (!this.roleClip.has("walk") && this.roleClip.has("run")) this.roleClip.set("walk", this.roleClip.get("run")!);
    if (!this.roleClip.has("run") && this.roleClip.has("walk")) this.roleClip.set("run", this.roleClip.get("walk")!);

    this.model.updateMatrixWorld(true);
    this.rightHand = findHandBone(this.model, "R");
    this.leftHand = findHandBone(this.model, "L");
    this.findArmBones(this.model);
    this.footGrounder.bind(this.model);
    this.holder.rotation.y = this.modelYaw;
    this.playRole("idle", 0);
  }

  clipNames(): string[] {
    return [...this.actions.keys()];
  }

  currentClipName(): string {
    if (this.oneShot) return this.oneShot.getClip().name;
    if (this.current) return this.current.getClip().name;
    return "";
  }

  setModelYaw(rad: number): void {
    this.modelYaw = rad;
    this.holder.rotation.y = rad;
  }

  setBlendTime(t: number): void {
    this.blendTime = t;
  }

  /** Enable/disable the post-mixer foot-to-ground IK pass (default OFF). */
  setFootIk(enabled: boolean): void {
    this.footGrounder.setEnabled(enabled);
  }

  /** Supply a world-space ground-height sampler for the foot IK pass. */
  setGroundSampler(fn: GroundSampler): void {
    this.footGrounder.setGroundSampler(fn);
  }

  setShowSkeleton(show: boolean): void {
    if (!this.model) return;
    if (show && !this.skeletonHelper) {
      this.skeletonHelper = new THREE.SkeletonHelper(this.model);
      this.root.add(this.skeletonHelper);
    } else if (!show && this.skeletonHelper) {
      this.root.remove(this.skeletonHelper);
      this.skeletonHelper.dispose?.();
      this.skeletonHelper = null;
    }
  }

  hasRole(role: AnimRole): boolean {
    return this.roleClip.has(role);
  }

  hasClip(name: string): boolean {
    return this.actions.has(name);
  }

  playRole(role: AnimRole, fade = this.blendTime): void {
    const key = this.roleClip.get(role) ?? this.roleClip.get("idle");
    if (!key) return;
    const action = this.actions.get(key);
    if (!action || action === this.current) return;
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.fadeIn(fade);
    action.play();
    if (this.current && this.current !== action) this.current.fadeOut(fade);
    this.current = action;
  }

  setLocomotionRate(rate: number): void {
    if (this.current) this.current.setEffectiveTimeScale(rate * this.overdrive);
  }

  // ── Skill Lab authoring API ────────────────────────────────────────────────

  /** Global playback multiplier (speed/intensity overdrive) for skill authoring. */
  setOverdrive(rate: number): void {
    this.overdrive = Math.max(0.1, Math.min(4, rate));
    if (this.oneShot) this.oneShot.setEffectiveTimeScale(this.overdrive);
  }

  /** Toggle left/right mirroring of authored skill clips. */
  setMirror(on: boolean): void {
    this.mirror = on;
  }

  /** Set arm spread (-1 tucked .. +1 wide); applied additively after the mixer. */
  setArmWidth(spread: number): void {
    this.armWidth = Math.max(-1, Math.min(1, spread));
  }

  /** Locate the upper-arm bones so {@link setArmWidth} can spread them. */
  private findArmBones(model: THREE.Object3D): void {
    model.traverse((n) => {
      if (!(n as THREE.Bone).isBone) return;
      const nm = n.name.toLowerCase();
      if (!(nm.includes("upperarm") || nm.includes("upper_arm"))) return;
      if (nm.includes("_l_") || nm.includes("left")) this.lUpperArm = n;
      else if (nm.includes("_r_") || nm.includes("right")) this.rUpperArm = n;
    });
  }

  private applyArmWidth(): void {
    if (this.armWidth === 0) return;
    const ang = this.armWidth * 0.6;
    if (this.rUpperArm) {
      this.armScratch.setFromAxisAngle(this.armAxis, ang);
      this.rUpperArm.quaternion.multiply(this.armScratch);
    }
    if (this.lUpperArm) {
      this.armScratch.setFromAxisAngle(this.armAxis, -ang);
      this.lUpperArm.quaternion.multiply(this.armScratch);
    }
  }

  /**
   * Play a clip as a one-shot, optionally sliced to a sub-range (`from`..`to`,
   * 0..1) and/or mirrored — the core of authoring a custom skill animation. The
   * sliced/mirrored clip is cached so repeated tests reuse the same action.
   * Returns the wall-clock duration (accounting for overdrive).
   */
  playAuthoredClip(name: string, from = 0, to = 1, fade = 0.1): number {
    const baseAction = this.actions.get(name);
    if (!baseAction || !this.mixer) return 0;
    const lo = Math.max(0, Math.min(0.98, from));
    const hi = Math.max(lo + 0.02, Math.min(1, to));
    const key = `${name}|${lo.toFixed(3)}|${hi.toFixed(3)}|${this.mirror ? 1 : 0}`;
    let clip = this.authoredClips.get(key);
    if (!clip) {
      let c = baseAction.getClip();
      if (lo > 0.001 || hi < 0.999) {
        const fps = 30;
        const total = Math.max(1, Math.round(c.duration * fps));
        const s = Math.max(0, Math.min(total - 1, Math.round(lo * total)));
        const e = Math.max(s + 1, Math.min(total, Math.round(hi * total)));
        c = THREE.AnimationUtils.subclip(c, `${name}__${s}_${e}`, s, e, fps);
      }
      if (this.mirror) c = this.mirrorClip(c);
      clip = c;
      this.authoredClips.set(key, c);
      // Bound the cache: slider-driven trims would otherwise accumulate a unique
      // clip + cached mixer action per (range, mirror) tuple for the avatar's
      // lifetime. Evict the oldest entry (and free its action) past the cap.
      if (this.authoredClips.size > 24) {
        const oldestKey = this.authoredClips.keys().next().value;
        if (oldestKey !== undefined) {
          const stale = this.authoredClips.get(oldestKey);
          this.authoredClips.delete(oldestKey);
          if (stale && this.mixer) this.mixer.uncacheClip(stale);
        }
      }
    }
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.enabled = true;
    action.setEffectiveTimeScale(this.overdrive);
    action.setEffectiveWeight(1);
    action.fadeIn(fade);
    action.play();
    if (this.current) this.current.fadeOut(fade);
    if (this.oneShot && this.oneShot !== action) this.oneShot.stop();
    this.oneShot = action;
    const dur = clip.duration / Math.max(0.1, this.overdrive);
    this.oneShotEnd = dur;
    return dur;
  }

  /** Build a left/right-mirrored copy of a clip (Bip001 _L_/_R_ bone swap). */
  private mirrorClip(clip: THREE.AnimationClip): THREE.AnimationClip {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf(".");
      const node = track.name.slice(0, dot);
      const prop = track.name.slice(dot + 1);
      const mirrored = node
        .replace(/_L_/g, "_@_")
        .replace(/_R_/g, "_L_")
        .replace(/_@_/g, "_R_")
        .replace(/Left/g, "@@")
        .replace(/Right/g, "Left")
        .replace(/@@/g, "Right");
      const values = (track.values as Float32Array).slice();
      if (prop === "quaternion") {
        for (let i = 0; i < values.length; i += 4) {
          values[i + 1] = -values[i + 1];
          values[i + 2] = -values[i + 2];
        }
      } else if (prop === "position") {
        for (let i = 0; i < values.length; i += 3) values[i] = -values[i];
      }
      const Ctor = track.constructor as new (
        name: string,
        times: ArrayLike<number>,
        values: ArrayLike<number>,
      ) => THREE.KeyframeTrack;
      tracks.push(new Ctor(`${mirrored}.${prop}`, (track.times as Float32Array).slice(), values));
    }
    return new THREE.AnimationClip(`${clip.name}__mirror`, clip.duration, tracks, clip.blendMode);
  }

  /**
   * Place/size the damaging hit sphere. The offset (x,y,z) is interpreted in the
   * body's yaw frame (x=right, y=up, z=forward) but its origin RIDES the swinging
   * right-hand bone (falling back to the body holder), so the sphere tracks the
   * animation and carries the hand's real world orientation — the source for both
   * the slash-arc plane and collider-aimed projectile angles.
   */
  setDamageCollider(spec: { x: number; y: number; z: number; radius: number } | null): void {
    if (!spec) {
      this.removeColliderHelper();
      return;
    }
    this.colliderSpec = spec;
    if (!this.colliderHelper) {
      const geo = new THREE.SphereGeometry(1, 16, 12);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff4d6d,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
      });
      this.colliderHelper = new THREE.Mesh(geo, mat);
      this.colliderHelper.renderOrder = 999;
      // Parent to root (not the bone) so bone scale never distorts the radius;
      // the world transform is driven manually each frame from the hand.
      this.root.add(this.colliderHelper);
    }
    this.colliderHelper.scale.setScalar(Math.max(0.05, spec.radius));
    this.colliderHelper.visible = this.showCollider;
    this.updateColliderTransform();
  }

  showDamageCollider(on: boolean): void {
    this.showCollider = on;
    if (this.colliderHelper) this.colliderHelper.visible = on;
  }

  /** Recompute the collider's world transform from the swinging hand bone. */
  private updateColliderTransform(): void {
    if (!this.colliderHelper || !this.colliderSpec) return;
    const anchor = this.rightHand ?? this.holder;
    anchor.updateWorldMatrix(true, false);
    anchor.getWorldPosition(this.cHandPos);
    this.holder.getWorldQuaternion(this.cBodyQuat);
    if (this.rightHand) this.rightHand.getWorldQuaternion(this.cHandQuat);
    else this.cHandQuat.copy(this.cBodyQuat);
    // Offset in the body's yaw frame keeps the sliders intuitive; origin = hand.
    this.cOffset.set(this.colliderSpec.x, this.colliderSpec.y, this.colliderSpec.z).applyQuaternion(this.cBodyQuat);
    this.cWorldPos.copy(this.cHandPos).add(this.cOffset);
    this.cWorldQuat.copy(this.cHandQuat);
    // Express the world transform in root-local space (the helper's parent).
    this.root.updateWorldMatrix(true, false);
    this.root.getWorldQuaternion(this.cRootQuat).invert();
    this.colliderHelper.position.copy(this.cWorldPos);
    this.root.worldToLocal(this.colliderHelper.position);
    this.colliderHelper.quaternion.copy(this.cRootQuat).multiply(this.cWorldQuat);
  }

  /** World-space center of the damaging hit sphere, or null if none is set. */
  damageColliderWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.colliderHelper || !this.colliderSpec) return null;
    this.updateColliderTransform();
    return out.copy(this.cWorldPos);
  }

  /** World-space orientation of the damaging hit sphere (the swing plane), or null. */
  damageColliderQuat(out: THREE.Quaternion): THREE.Quaternion | null {
    if (!this.colliderHelper || !this.colliderSpec) return null;
    this.updateColliderTransform();
    return out.copy(this.cWorldQuat);
  }

  private removeColliderHelper(): void {
    this.colliderSpec = null;
    if (!this.colliderHelper) return;
    this.root.remove(this.colliderHelper);
    this.colliderHelper.geometry.dispose();
    (this.colliderHelper.material as THREE.Material).dispose();
    this.colliderHelper = null;
  }

  playClipOnce(name: string, fade = 0.12): number {
    const action = this.actions.get(name);
    if (!action) return 0;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.enabled = true;
    action.setEffectiveTimeScale(this.overdrive);
    action.setEffectiveWeight(1);
    action.fadeIn(fade);
    action.play();
    if (this.current) this.current.fadeOut(fade);
    if (this.oneShot && this.oneShot !== action) this.oneShot.stop();
    this.oneShot = action;
    const dur = action.getClip().duration / Math.max(0.1, this.overdrive);
    this.oneShotEnd = dur;
    return dur;
  }

  playRoleOnce(role: AnimRole, fade = 0.12): number {
    const key = this.roleClip.get(role);
    if (!key) return 0;
    return this.playClipOnce(key, fade);
  }

  get isOneShotActive(): boolean {
    return this.oneShot !== null;
  }

  update(dt: number): void {
    if (!this.mixer) return;
    // Single documented per-frame POST-MIXER override order:
    //   0. footGrounder.beginFrame — undo last frame's pelvis drop PRE-mixer so
    //      the mixer always sees a clean base (never compounds; no stale-drop
    //      leak when a one-shot clip saves/restores its "original" pose).
    //   1. mixer.update    — the animation pose for this frame.
    //   2. applyArmWidth   — additive upper-arm spread override.
    //   3. footGrounder.apply — foot-to-ground IK override (legs + pelvis drop).
    //   4. collider xform  — reads the FINAL hand world transform.
    // Any new bone override must slot into this list, never run before the mixer.
    this.footGrounder.beginFrame();
    this.mixer.update(dt);
    this.applyArmWidth();
    this.footGrounder.apply(dt);
    this.updateColliderTransform();
    if (this.oneShot) {
      this.oneShotEnd -= dt;
      if (this.oneShotEnd <= 0) {
        this.oneShot.fadeOut(this.blendTime);
        this.oneShot = null;
        if (this.current) {
          this.current.enabled = true;
          this.current.fadeIn(this.blendTime);
          this.current.play();
        }
      }
    }
  }

  /** Dispose the geometry of an owned Object3D graph (materials handled separately). */
  private disposeObject3D(root: THREE.Object3D): void {
    root.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh) m.geometry?.dispose();
    });
  }

  /** Free GPU resources: geometries + the single shared body material + texture. */
  private teardownGpu(): void {
    if (this.model) this.disposeObject3D(this.model);
    this.bodyMaterial?.dispose();
    this.bodyTexture?.dispose();
    this.bodyMaterial = null;
    this.bodyTexture = null;
  }

  dispose(): void {
    this.disposed = true;
    this.removeColliderHelper();
    this.authoredClips.clear();
    this.lUpperArm = null;
    this.rUpperArm = null;
    if (this.mixer) this.mixer.stopAllAction();
    this.mixer = null;
    if (this.skeletonHelper) {
      this.root.remove(this.skeletonHelper);
      this.skeletonHelper.dispose?.();
      this.skeletonHelper = null;
    }
    this.teardownGpu();
    this.root.clear();
    this.holder.clear();
    this.actions.clear();
    this.roleClip.clear();
    this.current = null;
    this.oneShot = null;
    this.model = null;
    this.rightHand = null;
    this.leftHand = null;
  }
}
