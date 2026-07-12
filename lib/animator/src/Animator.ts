import * as THREE from "three";
import type { ActionKey, MoveInput, TraversalMode, WeaponClass } from "./types.js";
import { WEAPON_SETS, TRAVERSAL_SETS, resolveGlobalAction } from "./clipCatalog.js";
import { LocomotionBlend } from "./LocomotionBlend.js";
import type { VoxelCharacter } from "./rig.js";
import { mountWeapons, unmountWeapons, type MountedWeapons } from "./weapons.js";

/** Horizontal speed below which the character is considered standing still. */
const MOVE_EPS = 0.08;

/** Crossfade (seconds) used to ease the additive combat overlay in and out. */
const OVERLAY_FADE = 0.07;
/** Additive overlay weight at rest (slow walk) vs. full sprint. */
const OVERLAY_WEIGHT_MIN = 0.78;
const OVERLAY_WEIGHT_MAX = 1;
/** Additive overlay playback rate at slow walk vs. full sprint (heavier = faster). */
const OVERLAY_RATE_MIN = 1;
const OVERLAY_RATE_MAX = 1.35;

/**
 * Bone-name fragments (Mixamo `mixamorig*`) that make up the UPPER body. The
 * additive combat overlay keeps only tracks targeting these bones so the legs
 * stay owned by the locomotion blend (walk/run continues under the swing) while
 * the spine, shoulders, arms and hands play the attack. `Hips` is deliberately
 * excluded — rotating it would drag the whole lower body with the swing.
 */
const UPPER_BODY_BONES = ["Spine", "Neck", "Head", "Shoulder", "Arm", "Hand"];

/** Whether an animation track targets an upper-body bone (see UPPER_BODY_BONES). */
function isUpperBodyTrack(trackName: string): boolean {
  return UPPER_BODY_BONES.some((b) => trackName.includes(b));
}

/**
 * Drives one {@link VoxelCharacter} with a single-active-clip state machine.
 *
 * Design: exactly one clip is dominant at a time and the mixer crossfades
 * between them. Locomotion, blocking/aim holds, and one-shot actions (attacks,
 * rolls, dashes, hits, death) all resolve to a clip and flow through the same
 * crossfade path, which keeps weight management bug-free at the cost of additive
 * layering (not needed for these full-body clips).
 *
 * Each frame the engine pushes INTENT (locomotion vector, strafe flag, holds)
 * and the Animator reconciles it into the dominant clip in {@link update}.
 * One-shots are fired imperatively and auto-revert when they elapse.
 */
export class Animator {
  readonly character: VoxelCharacter;
  readonly root: THREE.Group;

  private readonly mixer: THREE.AnimationMixer;
  private readonly clips: Map<string, THREE.AnimationClip>;
  private readonly actionCache = new Map<string, THREE.AnimationAction>();

  private weapon: WeaponClass = "unarmed";
  private mounted: MountedWeapons | null = null;

  /** Traversal mode: ground uses the weapon loco; climb/swim use TRAVERSAL_SETS. */
  private mode: TraversalMode = "ground";

  private current: THREE.AnimationAction | null = null;
  private currentId: string | null = null;

  /** Weight-blended idle/walk/run layer; drives locomotion when no clip overrides. */
  private readonly locoBlend: LocomotionBlend;
  /** True while the blend (not a single clip) owns the pose. */
  private blendDriving = false;

  // INTENT pushed by the engine, reconciled each frame.
  private move: MoveInput = { x: 0, z: 0, speed: 0, running: false };
  private strafe = false;
  private crouch = false;
  private hold: "aim" | "block" | null = null;

  // Active one-shot (attack/roll/etc): suppresses reconcile until it elapses.
  private once: { endTime: number; hold: boolean } | null = null;

  /**
   * Active upper-body additive combat overlay (a moving attack). Unlike `once`
   * it does NOT suppress locomotion — it layers on top of the running blend, so
   * `isBusy()` stays false and the engine keeps the character moving. Auto-fades
   * out near the end of the clip and clears once fully faded.
   */
  private overlay: {
    action: THREE.AnimationAction;
    fadeTime: number;
    endTime: number;
    fading: boolean;
  } | null = null;

  private time = 0;
  private comboIndex = 0;
  private comboUntil = 0;
  private skillUntil = 0;

  constructor(character: VoxelCharacter, clips: Map<string, THREE.AnimationClip>) {
    this.character = character;
    this.root = character.root;
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(character.skeletonRoot);
    this.locoBlend = new LocomotionBlend((id) => this.action(id));
  }

  // ------------------------------------------------------------------- intent

  /** Push per-frame locomotion intent (local-space move dir + speed). */
  setLocomotion(move: MoveInput): void {
    this.move = move;
  }

  /** When true, locomotion uses directional clips (body faces aim, not motion). */
  setStrafe(on: boolean): void {
    this.strafe = on;
  }

  /**
   * Hold a crouch/sneak state: suppresses running in the blend, slows the stride
   * cadence, and (where the class ships a crouch clip, e.g. ranged) plays a
   * dedicated crouched idle when standing still.
   */
  setCrouch(on: boolean): void {
    this.crouch = on;
  }

  /** Whether the crouch/sneak state is currently engaged. */
  isCrouching(): boolean {
    return this.crouch;
  }

  /** The class currently equipped. */
  getWeapon(): WeaponClass {
    return this.weapon;
  }

  /** Whether a blocking one-shot (attack/roll/etc) is currently playing. */
  isBusy(): boolean {
    return this.once !== null && !this.once.hold;
  }

  /**
   * The equipped melee weapon's blade segment — empty tip/base marker nodes
   * riding the hand bone — so a host can sample the blade's real world-space
   * transform each frame (call `root.updateMatrixWorld(true)` first) to drive a
   * swept-blade hitbox + trail. Null for non-melee / unarmed classes.
   */
  getWeaponBlade(): { tip: THREE.Object3D; base: THREE.Object3D } | null {
    return this.mounted?.blade ?? null;
  }

  // ------------------------------------------------------------------ weapons

  /**
   * Equip a weapon class: swap the hand props and play the draw/equip flourish.
   * Locomotion immediately adopts the new class's clip set.
   */
  setWeapon(weapon: WeaponClass): void {
    if (weapon === this.weapon && this.mounted) return;
    if (this.mounted) {
      unmountWeapons(this.mounted);
      this.mounted = null;
    }
    this.weapon = weapon;
    this.mounted = mountWeapons(this.character, weapon);
    this.currentId = null; // force loco re-eval against the new set
    this.clearOverlay(); // a half-played swing for the old weapon must not linger
    const intro = this.resolve("equip") ?? this.resolve("draw");
    if (intro) this.playOnce(intro);
  }

  /** Hide/show the off-hand prop (e.g. while its thrown knife is in flight). No-op if none. */
  setOffhandVisible(visible: boolean): void {
    const off = this.mounted?.offhand;
    if (off) off.visible = visible;
  }

  /** Whether the equipped loadout carries an off-hand prop (a throwable). */
  hasOffhand(): boolean {
    return !!this.mounted?.offhand;
  }

  // --------------------------------------------------------------- one-shots

  /**
   * Melee combo: advances the chain when re-pressed inside the buffer window and
   * returns the next clip id (undefined when the class has no combo). Shared by
   * the rooted full-body {@link attack} and the moving {@link attackMoving}.
   */
  private nextComboClip(): string | undefined {
    const set = WEAPON_SETS[this.weapon];
    if (set.combo.length === 0) return undefined;
    if (this.time <= this.comboUntil && this.comboIndex < set.combo.length - 1) {
      this.comboIndex += 1;
    } else {
      this.comboIndex = 0;
    }
    return this.resolve(set.combo[this.comboIndex]);
  }

  /**
   * Full-body rooted attack: the whole skeleton plays the combo clip and the
   * locomotion blend is suppressed until it elapses. Use when standing still or
   * for a planted heavy swing. Advances the combo and returns the clip duration.
   */
  attack(): number {
    const id = this.nextComboClip();
    if (!id) return 0;
    const dur = this.playOnce(id);
    this.comboUntil = this.time + dur * 1.1;
    return dur;
  }

  /**
   * Moving attack: play the next combo clip as an UPPER-BODY ADDITIVE OVERLAY on
   * top of the running locomotion blend, so the legs keep walking/sprinting while
   * the upper body swings. `intensity` (0..1, the engine's current locomotion
   * speed) scales the overlay weight + playback rate so a sprint attack reads
   * heavier and faster than a walk attack. `isBusy()` stays false throughout, so
   * the engine keeps translating the body and the combo can still chain. Returns
   * the (rate-adjusted) clip duration, or 0 when no combo/clip is available.
   */
  attackMoving(intensity: number): number {
    const id = this.nextComboClip();
    if (!id) return 0;
    const dur = this.playOverlay(id, intensity);
    if (dur > 0) this.comboUntil = this.time + dur * 1.1;
    return dur;
  }

  /** Class signature move; gated by a short cooldown. */
  skill(cooldown = 1.5): number {
    if (this.time < this.skillUntil) return 0;
    const id = this.resolve("skill") ?? this.resolve("attack1");
    if (!id) return 0;
    const dur = this.playOnce(id);
    this.skillUntil = this.time + dur + cooldown;
    return dur;
  }

  /** Hold a block/guard stance (rooted). Call with false to release. */
  block(active: boolean): void {
    this.hold = active ? "block" : this.hold === "block" ? null : this.hold;
  }

  /** Hold an aim stance (strafe locomotion + draw pose when still). */
  aim(active: boolean): void {
    if (active) {
      this.hold = "aim";
      this.strafe = true;
    } else if (this.hold === "aim") {
      this.hold = null;
      this.strafe = false;
      const release = this.resolve("release");
      if (release) this.playOnce(release);
    }
  }

  /** Dodge roll in a local direction; returns the clip duration for the engine. */
  roll(dir: "F" | "B" | "L" | "R"): number {
    const id = this.resolveMovement(`dodge${dir}` as ActionKey) ?? this.resolveMovement("dodgeF");
    return id ? this.playOnce(id) : 0;
  }

  /** Quick dash/lunge; returns clip duration so the engine can time displacement. */
  dash(): number {
    const id = this.resolveMovement("dash") ?? this.resolveMovement("dodgeF");
    return id ? this.playOnce(id) : 0;
  }

  /** Lunging attack that covers ground; engine drives the forward displacement. */
  dashAttack(): number {
    const id = this.resolve("dashAttack") ?? this.resolve("attack1");
    return id ? this.playOnce(id) : 0;
  }

  /** Begin an airborne pose (looped fall) for the jump arc. */
  jump(): void {
    const id = this.resolveMovement("jumpAir");
    if (id) {
      this.setActive(id, { loop: true, fade: 0.1 });
      this.once = { endTime: Number.POSITIVE_INFINITY, hold: true };
    }
  }

  /** Land from a jump and recover to locomotion. */
  land(): number {
    this.once = null;
    const id = this.resolveMovement("land");
    return id ? this.playOnce(id) : 0;
  }

  /** Brief flinch reaction. */
  hit(): number {
    const id = this.resolve("hit");
    return id ? this.playOnce(id) : 0;
  }

  /** Play the death clip and hold the final pose until {@link revive}. */
  die(): number {
    const id = this.resolve("death");
    if (!id) return 0;
    const dur = this.playOnce(id, /*holdLast*/ true);
    return dur;
  }

  /** Clear a held death/jump pose and resume normal control. */
  revive(): void {
    this.once = null;
  }

  // ------------------------------------------------------------ traversal modes

  /**
   * Switch the traversal mode (ground / climb / swim). `climb` and `swim` swap in
   * their own locomotion (`TRAVERSAL_SETS`) until set back to `ground`; the next
   * `update` crossfades from whatever was playing, so transitions stay smooth.
   * Any in-flight one-shot is left to finish on its own.
   */
  setMode(mode: TraversalMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.currentId = null; // force a fresh loco evaluation against the new set
    this.clearOverlay(); // ground swings don't carry into climb/swim
  }

  /** The active traversal mode. */
  getMode(): TraversalMode {
    return this.mode;
  }

  /**
   * Mantle/climb-to-top one-shot. The clip carries the body up + over a ledge; the
   * engine should drive the world translation across the returned duration so the
   * visual reach and the world move stay in lockstep (root motion is locked
   * horizontally but keeps its vertical bob). Returns 0 if the clip is missing.
   */
  mantle(): number {
    return this.playGlobalOnce("mantle");
  }

  /** Swim-to-edge climb-out one-shot; returns the clip duration (0 if missing). */
  swimExit(): number {
    return this.playGlobalOnce("swimExit");
  }

  /**
   * Play a farming verb as a rooted one-shot (dig/plant, water, pick, plant-tree,
   * pull-plant). Returns the clip duration so the engine can time any effect.
   */
  farm(action: "harvest" | "water" | "pick" | "plantTree" | "pullPlant"): number {
    return this.playGlobalOnce(action);
  }

  /**
   * Play a magic verb as a rooted one-shot (cast / single-target / area). Returns
   * the clip duration. Available in any mode and for any equipped class.
   */
  magic(action: "castSpell" | "magicAttack" | "magicArea"): number {
    return this.playGlobalOnce(action);
  }

  /**
   * Running slide: a rooted slide one-shot, class-independent. Returns the clip
   * duration so the engine can carry forward momentum for its length (like dash).
   */
  slide(): number {
    return this.playGlobalOnce("slide");
  }

  /**
   * Throw a grenade / bomb / trap: a rooted overhand throw one-shot, available to
   * any loadout. Returns the clip duration so the engine can time the release.
   */
  throwItem(): number {
    return this.playGlobalOnce("throw");
  }

  /**
   * Play an externally-supplied one-shot clip that is NOT part of the shared
   * catalog — e.g. a cabinet-specific interaction such as entering/leaving a
   * vehicle. The clip is registered under a synthetic id (keyed by its uuid so
   * repeat plays reuse the cached action) and flows through the same one-shot
   * path: its horizontal root is locked, so the host engine owns world
   * translation, and it auto-reverts to locomotion when it elapses (unless
   * `holdLast` clamps the final pose). Returns the clip duration (0 if invalid).
   */
  playClip(clip: THREE.AnimationClip, holdLast = false): number {
    if (!clip) return 0;
    const id = `__ext__/${clip.uuid}`;
    if (!this.clips.has(id)) this.clips.set(id, clip);
    return this.playOnce(id, holdLast);
  }

  /**
   * Play an externally-supplied clip as a LOOPED held pose — the airborne
   * equivalent of {@link jump} for a cabinet-specific fall loop (e.g. a skydive
   * pose). Registered under the same synthetic `__ext__` id as {@link playClip}
   * (so the cached action is reused), its horizontal root is locked, and it is
   * marked as a held one-shot so `isBusy()` stays false (the engine keeps
   * translating the body) while it loops until cleared by {@link revive},
   * {@link land}, or another one-shot. No-op for an invalid clip.
   */
  playClipLooped(clip: THREE.AnimationClip): void {
    if (!clip) return;
    const id = `__ext__/${clip.uuid}`;
    if (!this.clips.has(id)) this.clips.set(id, clip);
    this.setActive(id, { loop: true, fade: 0.1 });
    this.once = { endTime: Number.POSITIVE_INFINITY, hold: true };
  }

  // ----------------------------------------------------------------- per-frame

  update(dt: number): void {
    this.time += dt;

    // Expire elapsed one-shots (held poses persist until cleared explicitly).
    if (this.once && !this.once.hold && this.time >= this.once.endTime) {
      this.once = null;
    }

    // Drive the additive combat overlay's lifecycle (it rides ON TOP of whatever
    // the blend/one-shot path does below; the shared mixer advances it for us).
    if (this.overlay) {
      if (!this.overlay.fading && this.time >= this.overlay.fadeTime) {
        this.overlay.action.fadeOut(OVERLAY_FADE);
        this.overlay.fading = true;
      }
      if (this.time >= this.overlay.endTime) {
        this.overlay.action.stop();
        this.overlay = null;
      }
    }

    // Traversal modes (climb / swim) own locomotion via a small directional set,
    // not the weapon blend. A one-shot (mantle, swim-exit, etc.) still wins; the
    // mixer just advances while it plays.
    if (this.mode !== "ground") {
      if (!this.once) this.updateTraversalLoco();
      this.mixer.update(dt);
      return;
    }

    // A rooted hold pose (block / aim-still / crouch-still) overrides the blend
    // when the class actually ships that clip; otherwise the blend keeps driving.
    const singleId = this.holdClip();
    const blendDrives = !this.once && !singleId;

    if (blendDrives) {
      // Coming back from a single clip: fade it out under the rising blend.
      if (!this.blendDriving && this.current) this.current.fadeOut(0.18);
      const tiers = this.locoTierIds();
      this.locoBlend.update({
        idleId: tiers.idle,
        walkId: tiers.walk,
        runId: tiers.run,
        speed: this.move.speed,
        crouch: this.crouch,
        active: true,
        dt,
      });
      // Track the heaviest blend clip so a one-shot can crossFadeFrom it.
      const dom = this.locoBlend.peekDominant();
      this.current = dom?.action ?? null;
      this.currentId = dom?.id ?? null;
      this.blendDriving = true;
    } else {
      if (this.blendDriving) {
        // Collapse to one clip so the upcoming hold/one-shot can crossfade cleanly.
        const dom = this.locoBlend.collapseToDominant();
        this.current = dom?.action ?? this.current;
        this.currentId = dom?.id ?? this.currentId;
        this.blendDriving = false;
      }
      if (!this.once && singleId) this.setActive(singleId, { loop: true });
    }

    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.character.skeletonRoot);
    if (this.mounted) unmountWeapons(this.mounted);
    this.character.dispose();
  }

  // ------------------------------------------------------------------ internals

  /** Resolve a logical loco/action key to a clip id for the current class. */
  private resolve(key: ActionKey): string | undefined {
    return WEAPON_SETS[this.weapon].actions[key];
  }

  /**
   * Resolve a UNIVERSAL movement action (jump/land/dodge/dash). These ship in the
   * longbow/unarmed packs but not every weapon set (the sword & rifle packs are
   * motion-light), so when the equipped class lacks the clip we fall back to the
   * shared `unarmed` set rather than dropping the action. Every weapon can roll,
   * dash and jump with real animation, matching the design where longbow loco/
   * roll/jump doubles as default unarmed loco.
   */
  private resolveMovement(key: ActionKey): string | undefined {
    return this.resolve(key) ?? WEAPON_SETS.unarmed.actions[key];
  }

  /**
   * The single rooted clip that should override the locomotion blend this frame,
   * or undefined when the blend should drive. Only returns an id the current
   * class actually ships, so motion-light packs fall through to the blend.
   */
  private holdClip(): string | undefined {
    if (this.hold === "block") return this.resolve("blockIdle") ?? this.resolve("blockStart");
    const still = this.move.speed < MOVE_EPS;
    if (this.hold === "aim" && still) return this.resolve("aim");
    if (this.crouch && still) return this.resolve("crouchIdle");
    return undefined;
  }

  /**
   * Resolve the idle/walk/run clip ids that the blend should mix for the current
   * move intent. Strafe picks the 8-dir clip for the dominant axis; otherwise the
   * body faces its motion so forward clips suffice. A fallback chain keeps partial
   * weapon packs animating.
   */
  private locoTierIds(): { idle?: string; walk?: string; run?: string } {
    const loco = WEAPON_SETS[this.weapon].loco;
    const idle = loco.idle;
    let walk: string | undefined;
    let run: string | undefined;
    if (this.strafe) {
      const ax = Math.abs(this.move.x);
      const az = Math.abs(this.move.z);
      if (az >= ax) {
        if (this.move.z >= 0) {
          walk = loco.walkF;
          run = loco.runF;
        } else {
          walk = loco.walkB;
          run = loco.runB;
        }
      } else if (this.move.x >= 0) {
        walk = loco.walkR;
        run = loco.runR;
      } else {
        walk = loco.walkL;
        run = loco.runL;
      }
    } else {
      walk = loco.walkF;
      run = loco.runF;
    }
    walk = walk ?? run ?? loco.walkF ?? loco.runF ?? idle;
    run = run ?? walk ?? loco.runF ?? idle;
    return { idle, walk, run };
  }

  /**
   * Drive climb/swim locomotion: pick the in-place idle (hang / tread) when still,
   * the forward stroke/up-climb when moving forward, or the back/down clip when
   * reversing. `setActive` crossfades from whatever played before (including the
   * collapsed ground blend on a mode change), so transitions stay smooth.
   */
  private updateTraversalLoco(): void {
    if (this.mode === "ground") return;
    const set = TRAVERSAL_SETS[this.mode];
    let id = set.idle;
    if (this.move.speed >= MOVE_EPS) {
      // Forward intent (z >= 0) climbs up / swims; backward intent climbs down.
      id = this.move.z >= 0 ? set.forward : set.back;
    }
    this.setActive(id, { loop: true, fade: 0.2 });
  }

  /** Fire a class-independent one-shot (traversal/farming/magic); 0 if missing. */
  private playGlobalOnce(key: ActionKey, holdLast = false): number {
    const id = resolveGlobalAction(key);
    return id ? this.playOnce(id, holdLast) : 0;
  }

  /** Fire a one-shot clip and schedule its auto-revert. */
  private playOnce(id: string, holdLast = false): number {
    // A rooted full-body one-shot takes over the whole skeleton, so drop any
    // upper-body additive overlay rather than layering a swing on top of it.
    this.clearOverlay();
    const a = this.setActive(id, { loop: false, clamp: true, fade: 0.08 });
    if (!a) return 0;
    const dur = a.getClip().duration;
    this.once = { endTime: this.time + dur * 0.92, hold: holdLast };
    if (holdLast) this.once.endTime = Number.POSITIVE_INFINITY;
    return dur;
  }

  /**
   * Play `id` as an upper-body additive overlay (see {@link attackMoving}). The
   * weight + playback rate scale with `intensity` (0..1). Restarts cleanly if an
   * overlay is already running (combo chaining). Returns the rate-adjusted clip
   * duration, or 0 when the clip is missing.
   */
  private playOverlay(id: string, intensity: number): number {
    const action = this.additiveAction(id);
    if (!action) return 0;
    this.clearOverlay();

    const s = THREE.MathUtils.clamp(intensity, 0, 1);
    const weight = OVERLAY_WEIGHT_MIN + (OVERLAY_WEIGHT_MAX - OVERLAY_WEIGHT_MIN) * s;
    const rate = OVERLAY_RATE_MIN + (OVERLAY_RATE_MAX - OVERLAY_RATE_MIN) * s;

    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
    action.setEffectiveTimeScale(rate);
    action.setEffectiveWeight(weight);
    action.enabled = true;
    action.play();
    action.fadeIn(OVERLAY_FADE);

    const dur = action.getClip().duration / rate;
    this.overlay = {
      action,
      fadeTime: this.time + Math.max(0, dur - OVERLAY_FADE),
      endTime: this.time + dur,
      fading: false,
    };
    return dur;
  }

  /** Stop and drop the active additive combat overlay, if any. */
  private clearOverlay(): void {
    if (!this.overlay) return;
    this.overlay.action.stop();
    this.overlay = null;
  }

  /**
   * Release the locomotion blend so a single clip can take over. Collapses the
   * blend to its heaviest action (kept at full weight + natural time) and adopts
   * it as `current`, giving the next clip something clean to crossFadeFrom.
   */
  private beginSingle(): void {
    if (!this.blendDriving) return;
    const dom = this.locoBlend.collapseToDominant();
    this.current = dom?.action ?? null;
    this.currentId = dom?.id ?? null;
    this.blendDriving = false;
  }

  /**
   * Make `id` the dominant clip, crossfading from whatever played before. Reuses
   * the cached action so repeated loco frames don't restart the clip.
   */
  private setActive(
    id: string,
    opts: { loop: boolean; timeScale?: number; clamp?: boolean; fade?: number },
  ): THREE.AnimationAction | null {
    // Any single-clip activation first takes the pose back from the blend so the
    // crossfade has a stable, single `current` to fade from.
    this.beginSingle();
    const a = this.action(id);
    if (!a) return null;

    const loop = opts.loop;
    if (this.current === a && this.currentId === id) {
      // Same clip still dominant: just keep the time-scale fresh (loco speed).
      if (opts.timeScale !== undefined) a.setEffectiveTimeScale(opts.timeScale);
      return a;
    }

    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.clampWhenFinished = !loop && (opts.clamp ?? false);
    a.setEffectiveTimeScale(opts.timeScale ?? 1);
    a.setEffectiveWeight(1);
    a.enabled = true;
    a.play();

    const fade = opts.fade ?? 0.2;
    if (this.current && this.current !== a) {
      a.crossFadeFrom(this.current, fade, true);
    }
    this.current = a;
    this.currentId = id;
    return a;
  }

  /** Get/create a cached action for a clip id (clone + lock horizontal root). */
  private action(id: string): THREE.AnimationAction | null {
    const cached = this.actionCache.get(id);
    if (cached) return cached;
    const clip = this.clips.get(id);
    if (!clip) return null;
    const c = clip.clone();
    lockHorizontalRoot(c);
    const action = this.mixer.clipAction(c);
    this.actionCache.set(id, action);
    return action;
  }

  /**
   * Get/create a cached UPPER-BODY ADDITIVE action for a clip id. The clip is
   * cloned, stripped to its upper-body tracks (legs stay on the locomotion
   * blend), made additive relative to its own first frame, and registered with
   * the additive blend mode. Cached under a separate key so it never collides
   * with the full-body action of the same id.
   */
  private additiveAction(id: string): THREE.AnimationAction | null {
    const key = `__additive__/${id}`;
    const cached = this.actionCache.get(key);
    if (cached) return cached;
    const clip = this.clips.get(id);
    if (!clip) return null;
    const c = clip.clone();
    c.tracks = c.tracks.filter((t) => isUpperBodyTrack(t.name));
    if (c.tracks.length === 0) return null;
    THREE.AnimationUtils.makeClipAdditive(c);
    const action = this.mixer.clipAction(c, undefined, THREE.AdditiveAnimationBlendMode);
    this.actionCache.set(key, action);
    return action;
  }
}

/**
 * Remove horizontal drift from a clip's root (Hips) track while keeping the
 * vertical bob. Mixamo "in place" clips have little horizontal hip motion, but
 * locking X/Z to the first frame guarantees no foot-sliding-independent drift
 * since the game engine owns the character's world translation.
 */
function lockHorizontalRoot(clip: THREE.AnimationClip): void {
  for (const track of clip.tracks) {
    if (track.name !== "mixamorigHips.position") continue;
    const v = track.values;
    const x0 = v[0];
    const z0 = v[2];
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x0;
      v[i + 2] = z0;
    }
  }
}
