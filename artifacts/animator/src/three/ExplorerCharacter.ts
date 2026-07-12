import * as THREE from "three";
import type { AnimRole, AvatarMarkers, Avatar, CharacterDef } from "./types";
import { CHARACTER_HEIGHT_M } from "./types";
import { getWeapon } from "./assets";
import { holdStyle } from "./arsenal/holdStyle";
import { createAnimatedCharacter } from "./explorer/loader";
import type { Animator } from "./explorer/Animator";
import type { VoxelPart } from "./explorer/rig";
import type { ShellId } from "./LedMaskShells";
import type { WeaponClass, ActionKey } from "./explorer/types";
import { resolveActionAnywhere, WEAPON_SETS } from "./explorer/clipCatalog";
import { CLIP_BY_VERB, PREVIEW_VERB_KEYS, VERBS } from "./explorer/clipRegistry";
import type { ExplorerPose } from "./ale/replay";
import { animDebug } from "./debug/animDebug";

/**
 * The Explorer rig's clip "verbs" — the named clips it exposes to the Dressing
 * Room library, the slot editor, and every AI/Studio trigger — plus their UI
 * categories, display labels, and the humanise/categorise helpers, all DERIVED
 * from the single declarative {@link CLIP_REGISTRY} (see ./explorer/clipRegistry).
 * Re-exported here so existing consumers keep importing them from this module.
 */
export {
  CLIP_CATEGORIES,
  VERB_CATEGORY,
  VERB_LABEL_OVERRIDES,
  categorizeClips,
  humanizeClipId,
  verbLabel,
} from "./explorer/clipRegistry";
export { PREVIEW_VERB_KEYS, VERBS };

/** Scratch vector for world-position reads in the animation debugger (copied out immediately). */
const _dbgWorldPos = new THREE.Vector3();

/**
 * Adapter that drives the ported procedural {@link Animator} (box rig + Mixamo
 * FBX clips) behind the same surface the {@link import("./Character").Character}
 * GLB class exposes, so {@link import("./Studio").Studio} and
 * {@link import("./Controller").Controller} can treat it polymorphically (see
 * the {@link Avatar} interface).
 *
 * The GLB path is role/clip-name based; this rig is INTENT based. The shims here
 * translate the engine's role/clip calls into Animator intents: locomotion ids
 * become a 0..1 blend speed fed to {@link Animator.setLocomotion}, and one-shot
 * roles/verbs map onto the Animator's imperative one-shots.
 */
export class ExplorerCharacter implements Avatar {
  readonly root = new THREE.Group();
  rightHand: THREE.Object3D | null = null; // procedural weapons live on the rig
  leftHand: THREE.Object3D | null = null;

  def: CharacterDef;
  private animator: Animator | null = null;
  /** Inner avatar group; carries the model-yaw offset (root carries facing). */
  private inner: THREE.Group | null = null;
  private skeletonHelper: THREE.SkeletonHelper | null = null;

  /** 0..1 locomotion intensity requested by the controller's playRole calls. */
  private locoSpeed = 0;

  /** Accumulated time driving the avatar-head hair sway. */
  private headFxTime = 0;
  /** True while a jump's held airborne pose is active (cleared on landing). */
  private airborne = false;
  private modelYaw = 0;
  private showSkeleton = false;
  private weaponClass: WeaponClass = "sword";
  private lastClip = "idle";
  private disposed = false;

  /** Cached ordered skeleton bones for instant-replay pose capture/restore. */
  private poseBones: THREE.Bone[] | null = null;
  /** Scratch quaternions reused by {@link applyPoseLerp}. */
  private readonly _qa = new THREE.Quaternion();
  private readonly _qb = new THREE.Quaternion();

  /**
   * When true, {@link update} keeps the rig's lowest foot planted at the bind
   * ground level every frame. Used by static previews (e.g. the Voxel Editor)
   * where the controller does NOT drive Y and stances that lift the feet (wide
   * two-handed idles) would otherwise read as floating. Off for gameplay rigs,
   * whose grounding is owned by the Controller / FootGrounder.
   */
  private groundFeetEnabled = false;
  /** Lowest foot's root-local Y captured at bind pose (grounding reference). */
  private bindFootLocalY: number | null = null;
  /** Scratch vectors reused by {@link measureLowestFootLocalY}. */
  private readonly _fv = new THREE.Vector3();

  constructor(def: CharacterDef) {
    this.def = def;
    this.modelYaw = def.modelYaw ?? 0;
  }

  async load(): Promise<void> {
    const animator = await createAnimatedCharacter({
      height: CHARACTER_HEIGHT_M,
      weapon: this.weaponClass,
      // Only the Explorer (the player's own character) wears the saved
      // Avatar Edit head; other procedural characters keep their stock look.
      look: this.def.id === "explorer" ? { ...this.def.look, avatarHead: true } : this.def.look,
    });
    if (this.disposed) {
      animator.dispose();
      return;
    }
    this.animator = animator;
    this.inner = animator.root;
    this.inner.rotation.y = this.modelYaw;
    this.inner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });
    this.root.add(this.inner);
    // Expose the rig's hand mounts so the host (Studio) can mount real GLB
    // weapon models, and clear the Animator's own procedural prop mesh so the
    // two don't double up.
    this.rightHand = animator.character.mounts.rightHand;
    this.leftHand = animator.character.mounts.leftHand;
    animator.setWeapon(this.weaponClass, false);
    if (this.showSkeleton) this.setShowSkeleton(true);
    // Capture the bind-pose foot height now, before the mixer advances, so
    // foot-grounding previews have a stable ground reference.
    this.bindFootLocalY = this.measureLowestFootLocalY();
  }

  /**
   * Enable/disable per-frame foot grounding (keeps the lowest foot planted at
   * the bind ground level). Static previews turn this on; gameplay rigs leave it
   * off so the Controller owns vertical placement.
   */
  setGroundFeet(on: boolean): void {
    this.groundFeetEnabled = on;
  }

  /**
   * Lowest ankle bone's Y in the rig root's local frame, or null when the feet
   * bones/rig aren't available. Root-local (not world) so difficulty scaling on
   * the host group divides out and the value matches {@link inner}'s local Y.
   */
  private measureLowestFootLocalY(): number | null {
    if (!this.animator) return null;
    const ch = this.animator.character;
    const feet = [ch.getBone("mixamorigLeftFoot"), ch.getBone("mixamorigRightFoot")];
    let lowest = Infinity;
    for (const b of feet) {
      if (!b) continue;
      b.getWorldPosition(this._fv);
      this.root.worldToLocal(this._fv);
      if (this._fv.y < lowest) lowest = this._fv.y;
    }
    return Number.isFinite(lowest) ? lowest : null;
  }

  /** Swap the equipped weapon class's CLIP SET only (the host mounts the model). */
  setWeaponId(weaponId: string): void {
    this.weaponClass = (getWeapon(weaponId).animSet as WeaponClass) ?? "unarmed";
    this.animator?.setWeapon(this.weaponClass, false);
  }

  /**
   * Swap the weapon class AND show the Animator's own procedural prop mesh. Used
   * for AI-driven non-player fighters (e.g. duel opponents) that have no host
   * mounting a real GLB weapon, so they still visibly hold their weapon.
   */
  equipProceduralWeapon(weaponId: string): void {
    this.weaponClass = (getWeapon(weaponId).animSet as WeaponClass) ?? "unarmed";
    this.animator?.setWeapon(this.weaponClass, true);
  }

  /** Raise (or drop) a held guard — drives the Animator's block state directly. */
  setBlock(active: boolean): void {
    this.animator?.block(active);
  }

  /**
   * Play the equipped weapon's category ready / guard pose (and any draw
   * flourish) on stance entry, blending back to idle. GLB rigs omit this.
   */
  readyPose(weaponId: string): number {
    if (!this.animator) return 0;
    const { guard } = holdStyle(getWeapon(weaponId).group);
    return this.animator.enterStance(guard.pose, guard.draw);
  }

  /** Play a directional evade roll (dodge), returning its duration in seconds. */
  rollDir(dir: "F" | "B" | "L" | "R"): number {
    if (!this.animator) return 0;
    this.lastClip = "roll";
    return this.animator.roll(dir);
  }

  /**
   * Play a defensive reaction clip by key (stumble / stunned / fallDown / fallen
   * / getUp / kipUp / wallCrash) with caller-controlled blend. Distinct from the
   * generic `hurt` flinch so knock-downs, knock-ups and acrobatic recoveries each
   * show their real clip. `hold` keeps the grounded pose until a recovery plays.
   */
  reaction(key: string, fade?: number, hold?: boolean): number {
    if (!this.animator) return 0;
    this.lastClip = key;
    return this.animator.reaction(key as ActionKey, fade, hold);
  }

  /** Swap the locomotion clip set between ground and swim (dungeon water band). */
  setTraversalMode(mode: "ground" | "swim"): void {
    this.animator?.setMode(mode);
  }

  // ---- locomotion (role/rate shims -> blend speed intent) ----

  playRole(role: AnimRole): void {
    if (role === "run") this.locoSpeed = 1;
    else if (role === "walk") this.locoSpeed = 0.5;
    else if (role === "idle") this.locoSpeed = 0;
  }

  setLocomotionRate(_rate: number): void {
    // The weight-blended locomotion layer owns stride cadence; nothing to do.
  }

  // ---- one-shots ----

  playRoleOnce(role: AnimRole): number {
    if (!this.animator) return 0;
    this.lastClip = role;
    switch (role) {
      case "attack":
        return this.animator.attack();
      case "jump":
        this.airborne = true;
        this.animator.jump();
        return 0.6;
      case "death":
        return this.animator.die();
      case "hurt":
        return this.animator.hit();
      case "block":
        this.animator.block(true);
        return 0;
      default:
        return 0;
    }
  }

  /**
   * Resolve a verb / {@link ActionKey} to a concrete catalog clip id: the
   * equipped weapon class first, then ANY class / global / reaction / movement
   * that ships the clip (`resolveActionAnywhere`). Single resolution shared by
   * the in-combat one-shot path AND the Dressing Room preview, so a verb can
   * never preview correctly yet silently no-op (or fire a generic attack) in
   * combat.
   */
  private resolveClipId(key: ActionKey): string | undefined {
    return WEAPON_SETS[this.weaponClass].actions[key] ?? resolveActionAnywhere(key);
  }

  /** Play the resolved clip for `key`; fall back to a basic attack if missing. */
  private playResolvedClip(key: ActionKey): number {
    const a = this.animator;
    if (!a) return 0;
    const id = this.resolveClipId(key);
    if (id) {
      const dur = a.playById(id);
      if (dur) return dur;
    }
    return a.attack();
  }

  playClipOnce(name: string): number {
    const a = this.animator;
    if (!a) return 0;
    this.lastClip = name;
    const dur = this.dispatchClipOnce(name);
    // Log the fired verb with the character's world XYZ (location validation) and
    // the resulting clip duration — a 0 means the verb produced no animation.
    // Use the WORLD position (not root.position, which is local-to-parent) so the
    // coordinate stays meaningful if the rig is ever re-parented.
    animDebug.recordVerb(name, this.root.getWorldPosition(_dbgWorldPos), dur);
    return dur;
  }

  /** Resolve + fire the clip for a combat verb. See {@link playClipOnce}. */
  private dispatchClipOnce(name: string): number {
    const a = this.animator;
    if (!a) return 0;
    // Single dispatch driven by the declarative CLIP_REGISTRY: each verb names a
    // trigger strategy (combo chain, skill, magic, directional roll, named
    // movement, …) and everything else uses the shared `"clip"` resolution — the
    // SAME path the preview uses — so adding/rewiring a verb is one registry edit
    // and the combat path can never diverge from the library.
    const entry = CLIP_BY_VERB.get(name);
    const play = entry?.play ?? "clip";
    if (typeof play === "object") {
      if ("magic" in play) return a.magic(play.magic);
      if ("roll" in play) return a.roll(play.roll);
      if ("action" in play) return a.playAction(play.action);
      // movement
      if (play.airborne) this.airborne = true;
      return a.movement(play.movement);
    }
    switch (play) {
      case "combo":
        return a.attack();
      case "skill":
        return a.skill();
      case "slide":
        return a.slide();
      case "throw":
        return a.throwItem();
      case "dash":
        return a.dash();
      case "dashAttack":
        return a.dashAttack();
      case "death":
        return a.die();
      case "hit":
        return a.hit();
      case "clip":
      default:
        // Registry "clip" verbs resolve via their declared key; non-registry
        // names (arbitrary catalog action keys passed by Studio/Targets) resolve
        // by the name itself. Either way: real same-named clip, else attack().
        return this.playResolvedClip((entry?.key ?? name) as ActionKey);
    }
  }

  previewClip(name: string): number {
    const a = this.animator;
    if (!a) return 0;
    // Dressing Room library preview: ALWAYS play the clip of the SAME NAME,
    // independent of the equipped weapon. Most verbs map to a concrete catalog
    // clip id (PREVIEW_VERB_KEYS), resolved equipped-class-first then across any
    // class / global so out-of-class verbs (jumpAttack, pistolWhip, hit, jump, …)
    // still play their own animation instead of no-opping or firing a generic
    // attack. The rig loads every referenced clip, so playById finds them all.
    const key = PREVIEW_VERB_KEYS[name];
    if (key) {
      const id = this.resolveClipId(key);
      if (id) {
        const dur = a.playById(id);
        if (dur) {
          this.lastClip = name;
          return dur;
        }
      }
    }
    // Verbs without a static clip id (or an unexpectedly missing clip) fall back
    // to the gameplay one-shot path so they still animate.
    return this.playClipOnce(name);
  }

  /**
   * Play an arbitrary, already-retargeted external clip on this rig (e.g. a
   * Mixamo animation auto-wired from an editor import). Looped by default so
   * locomotion clips read clearly during preview; the engine still owns world
   * translation (the clip's horizontal root is locked by the Animator).
   * Returns the clip duration, or 0 if the rig hasn't loaded.
   */
  playExternalClip(clip: THREE.AnimationClip, loop = true): number {
    if (!this.animator) return 0;
    if (loop) {
      this.animator.playClipLooped(clip);
      return clip.duration;
    }
    return this.animator.playClip(clip);
  }

  /** Stop a previewed external clip and return the rig to locomotion/idle. */
  stopExternalClip(): void {
    this.animator?.clearOneShot();
  }

  // ---- introspection ----

  hasRole(role: AnimRole): boolean {
    return ["idle", "walk", "run", "attack", "jump", "death", "hurt", "block"].includes(role);
  }

  hasClip(name: string): boolean {
    return (VERBS as readonly string[]).includes(name);
  }

  clipNames(): string[] {
    return [...VERBS];
  }

  currentClipName(): string {
    return this.lastClip;
  }

  get isOneShotActive(): boolean {
    return this.animator?.isBusy() ?? false;
  }

  /**
   * World-space tracking points (head / hands / feet / weapon tip) for the
   * A.L.E. Bot diagnostics lens. Returns null until the rig has loaded. Bones
   * use sanitised Mixamo names; missing bones fall back to a sensible offset of
   * the root so a marker never disappears.
   */
  getMarkers(): AvatarMarkers | null {
    if (!this.animator) return null;
    const ch = this.animator.character;
    const root = this.root.position;
    const world = (o: THREE.Object3D | null | undefined, fb: THREE.Vector3): THREE.Vector3 =>
      o ? o.getWorldPosition(new THREE.Vector3()) : fb;
    const bone = (n: string): THREE.Bone | undefined => ch.getBone(n);
    const head = world(bone("mixamorigHead"), new THREE.Vector3(root.x, root.y + 1.6, root.z));
    const rightHand = world(this.rightHand ?? bone("mixamorigRightHand"), head.clone());
    const leftHand = world(this.leftHand ?? bone("mixamorigLeftHand"), head.clone());
    const leftFoot = world(bone("mixamorigLeftFoot"), new THREE.Vector3(root.x, root.y, root.z));
    const rightFoot = world(bone("mixamorigRightFoot"), new THREE.Vector3(root.x, root.y, root.z));
    // Approx weapon tip: the weapon group rides the right hand with +Y toward the
    // tip; project a short reach along the hand's world up-axis.
    const weapon = rightHand.clone();
    if (this.rightHand) {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
        this.rightHand.getWorldQuaternion(new THREE.Quaternion()),
      );
      weapon.addScaledVector(up, 0.9);
    }
    return { head, leftHand, rightHand, leftFoot, rightFoot, weapon };
  }

  // ---- config shims ----

  setModelYaw(rad: number): void {
    this.modelYaw = rad;
    if (this.inner) this.inner.rotation.y = rad;
  }

  setBlendTime(_t: number): void {
    // The Animator manages its own crossfade durations.
  }

  setShowSkeleton(show: boolean): void {
    this.showSkeleton = show;
    if (!this.animator) return;
    if (show && !this.skeletonHelper) {
      this.skeletonHelper = new THREE.SkeletonHelper(this.animator.character.skeletonRoot);
      this.root.add(this.skeletonHelper);
    } else if (!show && this.skeletonHelper) {
      this.root.remove(this.skeletonHelper);
      this.skeletonHelper.dispose?.();
      this.skeletonHelper = null;
    }
  }

  // ---- voxel-rig appearance (procedural box rig only) ----

  /** Recolour one body part of the procedural box rig (skin/shirt/pants/boot/hat/eye). */
  setPartColor(part: VoxelPart, color: THREE.ColorRepresentation): void {
    this.animator?.character.setPartColor(part, color);
  }

  /** Apply or clear a tiling pattern texture on one body part of the box rig. */
  setPartPattern(part: VoxelPart, texture: THREE.Texture | null): void {
    this.animator?.character.setPartPattern(part, texture);
  }

  /**
   * Swap the box rig's baked LED-mask head: `null` removes it (skin face), any
   * {@link ShellId} (re)builds the mask wearing that housing shell. Static bake.
   */
  setLedMask(shellId: ShellId | null): void {
    this.animator?.character.setLedMask(shellId);
  }

  /**
   * Ground-truth touchdown from the controller (elevated prop tops, dungeon
   * floors): clear the held airborne pose and play the land recovery. The
   * `root.y <= 0.02` check in {@link update} only covers flat-floor landings.
   */
  notifyLanded(): void {
    if (!this.airborne || !this.animator) return;
    this.animator.land();
    this.airborne = false;
  }

  // ---- per-frame ----

  update(dt: number): void {
    if (!this.animator) return;
    // Avatar-head hair-strand sway (no-op when no composed head is applied).
    this.headFxTime += dt;
    this.animator.character.updateHeadFx(this.headFxTime);
    // The controller drives root.position.y; observe the landing here to clear
    // the held airborne pose and play the recovery one-shot.
    if (this.airborne && this.root.position.y <= 0.02) {
      // Floor-level backstop only: elevated touchdowns (prop tops, dungeon
      // floors) come through notifyLanded() from the controller, which knows
      // the real support height.
      this.animator.land();
      this.airborne = false;
    }
    this.animator.setLocomotion({
      x: 0,
      z: this.locoSpeed > 0.06 ? 1 : 0,
      speed: this.locoSpeed,
      running: this.locoSpeed > 0.65,
    });
    this.animator.update(dt);
    // Static previews: pull the rig down so its lowest foot rests at the bind
    // ground level, so stances that lift the feet (wide 2H idles) don't float.
    if (this.groundFeetEnabled && this.inner && this.bindFootLocalY !== null) {
      const cur = this.measureLowestFootLocalY();
      if (cur !== null) {
        const correction = THREE.MathUtils.clamp(this.bindFootLocalY - cur, -0.6, 0.6);
        // Deadzone: ignore sub-2mm nudges so the idle bob doesn't churn the rig.
        if (Math.abs(correction) > 0.002) this.inner.position.y += correction;
      }
    }
  }

  // ---- instant-replay pose capture / restore ----

  /**
   * Ordered (and cached) list of every skeleton bone, traversed once from the
   * rig's `skeletonRoot`. The order is stable for the rig's lifetime, so it can
   * key the flat per-bone arrays in {@link capturePose} / {@link applyPose}.
   */
  private orderedBones(): THREE.Bone[] {
    if (this.poseBones) return this.poseBones;
    const bones: THREE.Bone[] = [];
    const sk = this.animator?.character.skeletonRoot;
    if (sk) sk.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
    });
    this.poseBones = bones;
    return bones;
  }

  /**
   * Snapshot the rig's full pose: root world transform + every bone's local
   * TRS (rotation + position; scale never animates). Reuses `out.bones` when it
   * already fits so steady-state recording avoids allocations. Returns null
   * before the rig has loaded.
   */
  capturePose(out?: ExplorerPose): ExplorerPose | null {
    if (!this.animator) return null;
    const bones = this.orderedBones();
    const n = bones.length * 7;
    const arr = out && out.bones.length === n ? out.bones : new Float32Array(n);
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      const o = i * 7;
      arr[o] = b.position.x;
      arr[o + 1] = b.position.y;
      arr[o + 2] = b.position.z;
      arr[o + 3] = b.quaternion.x;
      arr[o + 4] = b.quaternion.y;
      arr[o + 5] = b.quaternion.z;
      arr[o + 6] = b.quaternion.w;
    }
    const r = this.root;
    const pose: ExplorerPose = out ?? {
      px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, bones: arr,
    };
    pose.bones = arr;
    pose.px = r.position.x;
    pose.py = r.position.y;
    pose.pz = r.position.z;
    pose.qx = r.quaternion.x;
    pose.qy = r.quaternion.y;
    pose.qz = r.quaternion.z;
    pose.qw = r.quaternion.w;
    return pose;
  }

  /** Re-pose the rig to an exact captured pose (read-only replay; no mixer). */
  applyPose(p: ExplorerPose): void {
    if (!this.animator) return;
    const bones = this.orderedBones();
    if (p.bones.length !== bones.length * 7) return;
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      const o = i * 7;
      b.position.set(p.bones[o], p.bones[o + 1], p.bones[o + 2]);
      b.quaternion.set(p.bones[o + 3], p.bones[o + 4], p.bones[o + 5], p.bones[o + 6]);
    }
    this.root.position.set(p.px, p.py, p.pz);
    this.root.quaternion.set(p.qx, p.qy, p.qz, p.qw);
  }

  /** Re-pose by interpolating between two captured poses (smooth slow-mo). */
  applyPoseLerp(a: ExplorerPose, b: ExplorerPose, alpha: number): void {
    if (!this.animator) return;
    const bones = this.orderedBones();
    const n = bones.length * 7;
    if (a.bones.length !== n || b.bones.length !== n) return;
    const t = THREE.MathUtils.clamp(alpha, 0, 1);
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      const o = i * 7;
      bone.position.set(
        a.bones[o] + (b.bones[o] - a.bones[o]) * t,
        a.bones[o + 1] + (b.bones[o + 1] - a.bones[o + 1]) * t,
        a.bones[o + 2] + (b.bones[o + 2] - a.bones[o + 2]) * t,
      );
      this._qa.set(a.bones[o + 3], a.bones[o + 4], a.bones[o + 5], a.bones[o + 6]);
      this._qb.set(b.bones[o + 3], b.bones[o + 4], b.bones[o + 5], b.bones[o + 6]);
      bone.quaternion.slerpQuaternions(this._qa, this._qb, t);
    }
    this.root.position.set(
      a.px + (b.px - a.px) * t,
      a.py + (b.py - a.py) * t,
      a.pz + (b.pz - a.pz) * t,
    );
    this._qa.set(a.qx, a.qy, a.qz, a.qw);
    this._qb.set(b.qx, b.qy, b.qz, b.qw);
    this.root.quaternion.slerpQuaternions(this._qa, this._qb, t);
  }

  dispose(): void {
    this.disposed = true;
    if (this.skeletonHelper) {
      this.skeletonHelper.dispose?.();
      this.skeletonHelper = null;
    }
    this.animator?.dispose();
    this.animator = null;
    this.inner = null;
    this.root.clear();
  }
}
