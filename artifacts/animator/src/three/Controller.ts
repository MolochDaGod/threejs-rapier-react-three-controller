import * as THREE from "three";
import type { InputState } from "./input";
import type { Avatar, EditorParams, ObstacleCircle } from "./types";
import { supportHeightAt } from "./support";
import {
  NO_WATER_BAND,
  isInWaterBand,
  sinkClampVertical,
  type WaterBand,
} from "./dungeon/water";

/** Default third-person orbit pitch clamp (radians). The floor stays positive
 *  so the orbit camera never dips under the room floor in normal play. */
const DEFAULT_PITCH_MIN = 0.06;
const DEFAULT_PITCH_MAX = 1.3;

export interface ControllerState {
  grounded: boolean;
  jumpsLeft: number;
  speed: number;
}

/**
 * Pluggable world-collision backend. When set on the Controller, end-of-frame
 * movement is reconciled through `move()` (a Rapier KCC in the dungeon) instead
 * of the flat Danger Room floor + box bounds. `from` is the body feet position
 * at the start of the frame, `delta` the attempted displacement; the result is
 * the corrected feet position + whether the body is standing on ground.
 */
export interface CollisionProvider {
  move(from: THREE.Vector3, delta: THREE.Vector3): { pos: THREE.Vector3; grounded: boolean };
}

/**
 * Third-person controller: camera-relative WASD over a yaw/pitch orbit camera,
 * gravity + ground clamp, ground jump + one mid-air double jump, and it drives
 * the Character's locomotion blend + facing.
 */
export class Controller {
  yaw = 0;
  pitch = 0.32;
  private velocity = new THREE.Vector3();
  /** Damped external knockback impulse (e.g. taking a hit), added every frame on
   *  top of whatever the movement branch does, so it survives input override. */
  private extVel = new THREE.Vector3();
  /** Decay rate for `extVel` (per second, used as exp(-k·dt)). Higher = more
   *  friction / shorter slide. Set per-impulse by {@link applyImpulse}; a blocked
   *  big-hit bounce-back drops it low so the separation slides out smoothly. */
  private extVelDamp = 7;
  private vertical = 0;
  private grounded = true;
  private jumpsLeft = 2;
  private wantFacing = 0;
  private smoothedSpeed = 0;
  /** Transient move-speed multiplier (e.g. the Kiter's Smoke Phantom sprint). */
  private speedMult = 1;
  private bound = 15;
  private readonly roomBound = 15;
  /** Pluggable world collision (dungeon KCC). Null = flat Danger Room floor. */
  private collision: CollisionProvider | null = null;
  /** Live interior obstacle circles (XZ) for Danger Room push-out collision —
   *  pillars, training dummies and opponents. Circles with a finite `top` are
   *  landable: the player can stand/walk on that surface. Only consulted on the
   *  null (Danger Room) path; the dungeon/arena KCC owns collision when set. */
  private obstacles: (() => ObstacleCircle[]) | null = null;
  /** World Y of the surface currently supporting the body (0 = room floor).
   *  Updated on every touchdown; procedural specials (flip/roll/spin) anchor
   *  their vertical arcs to it instead of a hardcoded floor 0, so they don't
   *  teleport the body off an elevated prop top. */
  private supportY = 0;
  /** Max ledge drop (m) the body walks down smoothly while grounded; anything
   *  deeper transitions to the airborne fall state instead of gluing the feet. */
  private readonly STEP_DOWN = 0.3;
  /** Meshes the third-person camera pulls in front of (dungeon walls). */
  private occluders: THREE.Object3D[] = [];
  /** Dungeon water band [bottom, top] (world Y). Outside the band ⇒ no clamp. */
  private waterBand: WaterBand = NO_WATER_BAND;
  /** Slow constant sink speed (u/s) while inside the water band. */
  private readonly SINK_SPEED = 4;
  private camRay = new THREE.Raycaster();
  private didDoubleJump = false;
  /** Seconds left of a fast-turn window (set by faceToward) for crosshair lock. */
  private facingBoost = 0;
  /** Lock-on stance: when set, the camera frames this world point and the body
   *  faces it (so A/D reads as a strafe). Null = free-look. */
  private lockTarget: THREE.Vector3 | null = null;

  /** Camera framing: orbit "third" person, or eye-anchored "first" person. */
  private viewMode: "third" | "first" = "third";
  static readonly DEFAULT_PITCH_MIN = DEFAULT_PITCH_MIN;
  static readonly DEFAULT_PITCH_MAX = DEFAULT_PITCH_MAX;
  /** Third-person orbit pitch clamp. The default floor stays positive so the
   *  orbit never dips under the room floor; contexts that need to look UP at a
   *  tall body (mech piloting) widen it via {@link setPitchRange} and MUST
   *  restore it with {@link resetPitchRange} on exit. */
  private pitchMin = DEFAULT_PITCH_MIN;
  private pitchMax = DEFAULT_PITCH_MAX;
  /** First-person look elevation (radians, + = up). Full range, unlike the
   *  third-person `pitch` which stays positive so the orbit never dips underfloor. */
  private fpPitch = 0;
  /** Live recoil offset (radians) added to the aim each frame; pushed in by the
   *  consumer from the shared `Recoil` model. +pitch kicks the view up. */
  private aimPitch = 0;
  private aimYaw = 0;
  /** Additive FOV offset (degrees) on top of params.fov — the sprint "kick"
   *  (DGS CameraController). Owned by the consumer via setFovKick. */
  private fovKickAmt = 0;
  /** Camera-shake "trauma" (0..1) that decays each frame; the screen offset is
   *  trauma² so light taps barely register while heavy hits rattle hard. Fed by
   *  the consumer (e.g. heavy mech footsteps / landings) via {@link addCameraShake}. */
  private shakeTrauma = 0;
  /** Per-Controller phase seed so two sessions don't shake in lock-step. */
  private readonly shakeSeed = Math.random() * 1000;
  /** The additive shake offset applied last frame, removed before the next base
   *  pose is computed so the (lerped) third-person camera never accumulates it. */
  private readonly shakeOffset = new THREE.Vector3();
  /** Scratch ray reused by aimRay() so screen-centre aim allocates nothing. */
  private aimRayCache = new THREE.Ray();

  // Lunge state (signature / kick attacks): an eased "spline" body translation
  // that drives in toward a strike point then springs back, kept in sync with
  // the animation clip so the joint motion and the root motion read as one move.
  private dashActive = false;
  private dashElapsed = 0;
  private dashDuration = 0;
  private dashReach = 0;
  private dashSettle = 0;
  private dashImpactAt = 0.5;
  private dashImpactFired = false;
  private dashOrigin = new THREE.Vector3();
  private dashDir = new THREE.Vector3();
  private justDashImpact = false;
  // Skyfall special: track the launch so we can fire a barrage at the apex.
  private skyfallArmed = false;
  private justApex = false;
  // Skyfall launch flair: a twist-flip while rising straight up to the apex.
  private skyfallRiseElapsed = 0;
  private skyfallRiseDur = 0;

  // --- Striker procedural specials (fire-kick fighter) ---
  // In-place backflip (launcher): a pitch tumble + vertical arc, NO horizontal
  // recoil; owns the body for its duration.
  private flipActive = false;
  private flipElapsed = 0;
  private flipDuration = 0;
  private flipHop = 0;
  // Ground forward roll-out used to absorb a hard / double-jump landing.
  private rollActive = false;
  private rollElapsed = 0;
  private rollDuration = 0;
  private rollDir = new THREE.Vector3(0, 0, 1);
  // Hover: hop back, then float at a fixed height for a beat (input allowed,
  // jump cancels). Gravity is suspended while active.
  private hoverActive = false;
  private hoverElapsed = 0;
  private hoverDuration = 0;
  private hoverHeight = 0;
  private hoverEnd = false;
  private hoverWasActive = false;
  private justRollLanding = false;
  // Aerial spin: rise + spin the body fast, then report the end so the Studio can
  // fire the flame-slash projectile.
  private spinActive = false;
  private spinElapsed = 0;
  private spinDuration = 0;
  private spinHeight = 0;
  private justSpinEnd = false;
  // Landing telemetry (drives the roll-out decision in the Studio).
  private landingSpeed = 0;
  private landedWithDouble = false;
  private slamActive = false;
  private justSlamLanded = false;

  constructor(
    private character: Avatar,
    private camera: THREE.PerspectiveCamera,
    private input: InputState,
    private params: EditorParams,
  ) {}

  setParams(p: EditorParams) {
    this.params = p;
  }

  get state(): ControllerState {
    return { grounded: this.grounded, jumpsLeft: this.jumpsLeft, speed: this.smoothedSpeed };
  }

  /** Returns true if a double jump fired this frame (for VFX hooks). */
  private justDoubleJumped = false;
  consumeDoubleJump(): boolean {
    const v = this.justDoubleJumped;
    this.justDoubleJumped = false;
    return v;
  }
  private justLanded = false;
  consumeLanded(): boolean {
    const v = this.justLanded;
    this.justLanded = false;
    return v;
  }

  /** World-space forward (camera yaw projected onto the floor). */
  forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
  }

  /**
   * World-space aim direction INCLUDING the camera pitch (unlike {@link forward},
   * which is floor-projected). In third person the view direction is the orbit
   * looking at the body (+pitch = camera above looking DOWN); in first person it
   * is the eye look (fpPitch + recoil, + = up). Used by aimed abilities (e.g. the
   * mech's plasma cannon) so shots go where the camera looks.
   */
  aimForward(): THREE.Vector3 {
    if (this.viewMode === "first") {
      const yaw = this.yaw + this.aimYaw;
      const p = THREE.MathUtils.clamp(this.fpPitch + this.aimPitch, -1.5, 1.5);
      const cp = Math.cos(p);
      return new THREE.Vector3(Math.sin(yaw) * cp, Math.sin(p), Math.cos(yaw) * cp).normalize();
    }
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(
      Math.sin(this.yaw) * cp,
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * cp,
    ).normalize();
  }

  /**
   * Signed look elevation (radians, + = up) of the current view. Third person
   * negates the orbit pitch (+pitch = looking down); first person is the eye
   * pitch directly. Drives cosmetic aim poses (e.g. the mech torso tilt).
   */
  aimElevation(): number {
    if (this.viewMode === "first") {
      return THREE.MathUtils.clamp(this.fpPitch + this.aimPitch, -1.5, 1.5);
    }
    return -this.pitch;
  }

  /**
   * Widen/narrow the third-person orbit pitch clamp (radians). A negative `min`
   * lets the camera drop below the body's head to look UP (mech piloting); the
   * current pitch is re-clamped immediately so the camera never sits outside the
   * new range. Callers MUST pair this with {@link resetPitchRange} on exit.
   */
  setPitchRange(min: number, max: number): void {
    this.pitchMin = Math.min(min, max);
    this.pitchMax = Math.max(min, max);
    this.pitch = THREE.MathUtils.clamp(this.pitch, this.pitchMin, this.pitchMax);
  }

  /** Restore the default third-person pitch clamp (and re-clamp the pitch). */
  resetPitchRange(): void {
    this.setPitchRange(Controller.DEFAULT_PITCH_MIN, Controller.DEFAULT_PITCH_MAX);
  }

  /**
   * Add camera-shake trauma (clamped to 1). The visible jitter scales with
   * trauma², so a small value (~0.2, a heavy footstep) is a subtle rattle while a
   * large value (~0.6, a landing slam) really kicks the view. Trauma decays on its
   * own each frame, so callers just pump in impulses on impact frames.
   */
  addCameraShake(amount: number) {
    this.shakeTrauma = THREE.MathUtils.clamp(this.shakeTrauma + amount, 0, 1);
  }

  /** True while the body is on the floor (no double-jump / air state). */
  get isGrounded(): boolean {
    return this.grounded;
  }

  /** Lock-on: face/frame this world point each frame (null clears the stance). */
  setLockTarget(p: THREE.Vector3 | null) {
    this.lockTarget = p ? new THREE.Vector3(p.x, 0, p.z) : null;
  }

  /** Soft-lock world point: a gentle camera/aim assist toward this enemy (null
   *  clears it). Unlike the hard lock it never seizes the yaw — it only nudges
   *  the camera toward a foe already roughly ahead and yields the instant the
   *  player actively turns the look. */
  private softTarget: THREE.Vector3 | null = null;
  setSoftTarget(p: THREE.Vector3 | null) {
    this.softTarget = p ? new THREE.Vector3(p.x, 0, p.z) : null;
  }

  /** Current camera framing. */
  get view(): "third" | "first" {
    return this.viewMode;
  }

  /** True while the eye-anchored first-person camera is active. */
  get isFirstPerson(): boolean {
    return this.viewMode === "first";
  }

  /**
   * Switch camera framing. Entering first person hides the player's own avatar so
   * the body never blocks the view (no separate first-person arms model); exiting
   * restores it. The third-person orbit is untouched while in third person.
   */
  setViewMode(mode: "third" | "first") {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    this.character.root.visible = mode !== "first";
    if (mode === "first") this.fpPitch = 0;
  }

  /** Toggle between first- and third-person framing. */
  toggleView() {
    this.setViewMode(this.viewMode === "first" ? "third" : "first");
  }

  /**
   * Push the live recoil offset (radians) applied to the aim/camera this frame.
   * `pitch` kicks the view up; `yaw` nudges it sideways. Fed by the shared `Recoil`
   * model in the consumer; cleared to zero when no weapon is recoiling.
   */
  setAimOffset(pitch: number, yaw: number) {
    this.aimPitch = pitch;
    this.aimYaw = yaw;
  }

  /** Additive FOV offset (degrees) applied on top of the base params.fov, used
   *  for the sprint kick. Pass 0 to clear. */
  setFovKick(extraDeg: number) {
    this.fovKickAmt = extraDeg;
  }

  /**
   * Screen-centre aim ray (camera origin along camera forward) — identical maths
   * in both first and third person, since the camera is always looking through the
   * crosshair. Reuses a cached Ray; copy it if you need to retain the result.
   */
  aimRay(): THREE.Ray {
    this.camera.getWorldPosition(this.aimRayCache.origin);
    this.camera.getWorldDirection(this.aimRayCache.direction);
    this.aimRayCache.direction.normalize();
    return this.aimRayCache;
  }

  /**
   * Swap the world-collision backend. When a provider is set the box bounds are
   * lifted (the dungeon KCC owns collision) and, if `spawn` is given, the body
   * teleports there with its fall/jump state reset. Passing null restores the
   * flat Danger Room floor + room bounds — Danger Room feel is untouched while
   * no provider is set.
   */
  setCollision(p: CollisionProvider | null, spawn?: THREE.Vector3) {
    this.collision = p;
    this.bound = p ? 1e5 : this.roomBound;
    if (!p) this.occluders = [];
    if (spawn) {
      this.character.root.position.copy(spawn);
      this.vertical = 0;
      this.velocity.set(0, 0, 0);
      this.extVel.set(0, 0, 0);
      this.grounded = true;
      // Refresh the special-move anchor at the spawn point so flip/roll/spin
      // never ride a stale pre-teleport support height.
      this.supportY = p ? spawn.y : this.supportHeightAt(spawn.x, spawn.z, spawn.y);
      this.jumpsLeft = 2;
      this.didDoubleJump = false;
    }
  }

  /** Meshes the third-person camera pulls in front of (dungeon walls/props). */
  setCameraOccluders(meshes: THREE.Object3D[]) {
    this.occluders = meshes;
  }

  /**
   * Instantly relocate the body (a teleport / blink): copy `pos`, clamp it inside
   * the active room bounds, and reset fall/dash/velocity state so the caster lands
   * cleanly without inheriting pre-blink momentum. Used by the Arcane Staff's
   * void-jaunt; safe in both the flat Danger Room and dungeon (KCC) modes.
   */
  blinkTo(pos: THREE.Vector3) {
    const b = this.bound - 0.5;
    this.character.root.position.set(
      THREE.MathUtils.clamp(pos.x, -b, b),
      pos.y,
      THREE.MathUtils.clamp(pos.z, -b, b),
    );
    this.vertical = 0;
    this.velocity.set(0, 0, 0);
    this.extVel.set(0, 0, 0);
    this.dashActive = false;
    this.grounded = true;
    // Re-anchor specials at the blink destination (stale supportY would warp
    // a follow-up flip/roll back toward the pre-blink surface height).
    const dst = this.character.root.position;
    this.supportY = this.collision ? dst.y : this.supportHeightAt(dst.x, dst.z, dst.y);
  }

  /**
   * Define a vertical water band: while the body's feet are inside [bottom, top]
   * the downward fall speed is clamped to a slow sink (rather than free-fall
   * gravity) so the player descends gently through the dungeon's water layer.
   */
  setWaterBand(top: number, bottom: number) {
    this.waterBand = { top, bottom };
  }

  /** Drop the water band — body falls under normal gravity again. */
  clearWaterBand() {
    this.waterBand = NO_WATER_BAND;
  }

  /** True while the body's feet are within the active water band. */
  isInWater(): boolean {
    return isInWaterBand(this.character.root.position.y, this.waterBand);
  }

  /**
   * Supply a live source of interior obstacle circles (pillars, dummies,
   * opponents) so the body can't walk through them in the Danger Room. The
   * callback is read every frame (positions move), and is ignored while a
   * collision provider is active (the KCC handles collision there). Pass null
   * to disable.
   */
  setObstacles(fn: (() => ObstacleCircle[]) | null) {
    this.obstacles = fn;
  }

  /**
   * Highest walkable support under (x, z) for feet that were at height `fromY`
   * (room floor or a landable obstacle top). Danger Room (null-collision) path
   * only — the dungeon KCC owns its floors. Pure math lives in ./support.
   */
  private supportHeightAt(x: number, z: number, fromY: number): number {
    if (!this.obstacles) return 0;
    return supportHeightAt(this.obstacles(), x, z, fromY);
  }

  /** True while a dungeon collision backend is active. */
  get hasCollision(): boolean {
    return this.collision !== null;
  }

  jump() {
    // A hover is cancelled by jumping out of it (kept feeling responsive).
    if (this.hoverActive) {
      this.hoverActive = false;
      this.vertical = Math.sqrt(2 * this.params.gravity * this.params.jumpHeight) * 0.95;
      this.jumpsLeft = 0;
      this.didDoubleJump = true;
      this.justDoubleJumped = true;
      this.character.playRoleOnce("jump", 0.08);
      return;
    }
    if (this.grounded) {
      this.vertical = Math.sqrt(2 * this.params.gravity * this.params.jumpHeight);
      this.grounded = false;
      this.jumpsLeft = 1;
      this.didDoubleJump = false;
      this.character.playRoleOnce("jump", 0.1);
    } else if (this.jumpsLeft > 0 && !this.didDoubleJump) {
      this.vertical = Math.sqrt(2 * this.params.gravity * this.params.jumpHeight) * 0.95;
      this.jumpsLeft = 0;
      this.didDoubleJump = true;
      this.justDoubleJumped = true;
      this.character.playRoleOnce("jump", 0.08);
    }
  }

  /**
   * Lunge along `dir`: ease in to `distance` metres by `impactAt` of the move,
   * then ease back so the final offset is `distance - bounceBack` (a ninja-style
   * recoil when bounceBack > 0). `duration` is the whole in+out motion — pass a
   * value tied to the attack clip so the body and the joints stay in lockstep.
   */
  dash(dir: THREE.Vector3, distance: number, duration: number, bounceBack = 0, impactAt = 0.5) {
    const flat = new THREE.Vector3(dir.x, 0, dir.z);
    if (flat.lengthSq() < 1e-4 || duration <= 0) return;
    flat.normalize();
    this.dashActive = true;
    this.dashElapsed = 0;
    this.dashDuration = duration;
    this.dashReach = distance;
    this.dashSettle = distance - bounceBack;
    this.dashImpactAt = THREE.MathUtils.clamp(impactAt, 0.05, 0.95);
    this.dashImpactFired = false;
    this.dashOrigin.copy(this.character.root.position);
    this.dashDir.copy(flat);
    // Targets are physical colliders: if one lies inside the lunge path, stop the
    // body at its surface and REVERSE the leftover distance, so the lunge bounces
    // in and back out instead of clipping straight through the target. This
    // deliberately overrides any caller-supplied `bounceBack` for collided lunges.
    // The recoil is floored at the launch point (never behind origin): a contact
    // bounce reads as "in and out ON the target", and point-blank attacks (very
    // common in combos where the body is already adjacent) must not be flung
    // backward across the arena.
    const contact = this.dashContactDistance(distance);
    if (contact !== null && contact < distance) {
      const remaining = distance - contact;
      this.dashReach = contact;
      this.dashSettle = THREE.MathUtils.clamp(contact - remaining, 0, contact);
    }
    // Commit toward the target via a fast (but not snapped) turn — the lunge
    // facing is steered by the boosted turn rate below, avoiding a jarring snap.
    this.wantFacing = Math.atan2(flat.x, flat.z);
  }

  /**
   * Distance along the lunge direction to the first solid collider surface
   * (combatant footprint or prop) within `reach`, or null if the path is clear.
   * Only the flat Danger Room path is checked — the dungeon/arena KCC owns
   * collision when a provider is set. Standard ray↔circle intersection in XZ,
   * inflated by the player's footprint so the body stops flush, not overlapping.
   */
  private dashContactDistance(reach: number): number | null {
    if (this.collision || !this.obstacles) return null;
    const PLAYER_R = 0.35;
    const ox = this.dashOrigin.x;
    const oz = this.dashOrigin.z;
    const dx = this.dashDir.x;
    const dz = this.dashDir.z;
    let best: number | null = null;
    for (const o of this.obstacles()) {
      // Lunging across the top of a landable prop: no lateral contact.
      if (o.top !== undefined && this.dashOrigin.y >= o.top - 0.02) continue;
      const R = o.r + PLAYER_R;
      const cx = o.x - ox;
      const cz = o.z - oz;
      // Already overlapping this collider at the start: contact is immediate.
      if (cx * cx + cz * cz <= R * R) return 0;
      const proj = cx * dx + cz * dz; // closest-approach parameter along the ray
      if (proj <= 0) continue; // collider sits behind the lunge
      const closestSq = cx * cx + cz * cz - proj * proj;
      const rSq = R * R;
      if (closestSq > rSq) continue; // ray misses the circle
      const t = proj - Math.sqrt(rSq - closestSq); // near intersection
      if (t >= 0 && t <= reach && (best === null || t < best)) best = t;
    }
    return best;
  }

  /**
   * Aim the body at a horizontal direction with a brief fast-turn window so the
   * character snaps to the crosshair target smoothly (not instantly) before a
   * strike. Used by the combo so every hit faces what you're aiming at.
   */
  faceToward(dir: THREE.Vector3, boost = 0.18) {
    const flat = new THREE.Vector3(dir.x, 0, dir.z);
    if (flat.lengthSq() < 1e-4) return;
    flat.normalize();
    this.wantFacing = Math.atan2(flat.x, flat.z);
    this.facingBoost = Math.max(this.facingBoost, boost);
  }

  /** Eased displacement (metres along the lunge dir) at normalized time tau. */
  private dashDisplacement(tau: number): number {
    const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
    const impact = this.dashImpactAt;
    if (tau <= impact) return this.dashReach * easeOut(impact > 0 ? tau / impact : 1);
    const k = (tau - impact) / (1 - impact);
    return THREE.MathUtils.lerp(this.dashReach, this.dashSettle, easeOut(k));
  }

  get isDashing(): boolean {
    return this.dashActive;
  }

  /** True on the single frame the lunge reaches its strike point (for impact hooks). */
  consumeDashImpact(): boolean {
    const v = this.justDashImpact;
    this.justDashImpact = false;
    return v;
  }

  /** Launch high into the air; the apex is reported via consumeApex(). */
  skyLaunch(height: number) {
    // Cancel any competing aerial special so the gravity/apex path runs and the
    // apex is always detected — otherwise consumeApex() never fires and the
    // caller's skyfall barrage deadlocks.
    this.dashActive = false;
    this.flipActive = false;
    this.rollActive = false;
    this.spinActive = false;
    this.hoverActive = false;
    this.slamActive = false;
    this.vertical = Math.sqrt(2 * this.params.gravity * height);
    this.grounded = false;
    this.jumpsLeft = 0;
    this.didDoubleJump = true;
    this.skyfallArmed = true;
    this.justApex = false;
    // Estimate the rise time (v / g) so the twist-flip completes exactly at apex.
    this.skyfallRiseElapsed = 0;
    this.skyfallRiseDur = Math.max(0.2, this.vertical / this.params.gravity);
    this.character.root.rotation.x = 0;
    this.character.playRoleOnce("jump", 0.1);
  }

  /** True on the single frame the skyfall launch reaches its apex. */
  consumeApex(): boolean {
    const v = this.justApex;
    this.justApex = false;
    return v;
  }

  /** Add an upward velocity impulse (combo hops / flaming-foot bounce-away). */
  hop(v: number) {
    if (v <= 0) return;
    this.vertical = Math.max(this.vertical, v);
    this.grounded = false;
  }

  /**
   * Apply a horizontal knockback impulse (taking a hit), with a small hop.
   * `damp` sets the slide friction for this impulse: the default ~7 settles
   * quickly; a lower value (e.g. 2.5) gives a long, low-friction bounce-back
   * used for big hits soaked on a raised guard.
   */
  applyImpulse(dir: THREE.Vector3, speed: number, hop = 0, damp = 7) {
    this.extVel.x += dir.x * speed;
    this.extVel.z += dir.z * speed;
    this.extVelDamp = damp;
    if (hop > 0) this.hop(hop);
  }

  /**
   * Slam straight down: cancel any aerial special and drive a hard downward
   * velocity. The touchdown frame is reported via consumeSlamLanded() so the
   * host can detonate the ground-impact blast exactly on landing.
   */
  slamDown(speed = 28) {
    this.dashActive = false;
    this.flipActive = false;
    this.rollActive = false;
    this.spinActive = false;
    this.hoverActive = false;
    this.skyfallArmed = false;
    this.slamActive = true;
    this.vertical = -Math.abs(speed);
    this.grounded = false;
  }

  /** True on the single frame a slam touches down (fire the ground blast). */
  consumeSlamLanded(): boolean {
    const v = this.justSlamLanded;
    this.justSlamLanded = false;
    return v;
  }

  /** Drop a pending slam without detonating (a superseding action took over). */
  cancelSlam() {
    this.slamActive = false;
  }

  /**
   * In-place backflip (launcher): a full pitch tumble + a short vertical arc with
   * NO horizontal recoil. Owns the body until it lands again.
   */
  backflip(duration = 0.6, hop = 1.4) {
    this.flipActive = true;
    this.flipElapsed = 0;
    this.flipDuration = Math.max(0.2, duration);
    this.flipHop = hop;
    this.slamActive = false;
    this.grounded = false;
    this.jumpsLeft = 0;
    this.didDoubleJump = true;
    this.vertical = 0;
  }

  /** Ground forward roll-out (absorbs a hard / double-jump landing). */
  rollOut(dir: THREE.Vector3, duration = 0.55) {
    const flat = new THREE.Vector3(dir.x, 0, dir.z);
    if (flat.lengthSq() < 1e-4) flat.copy(this.forward());
    flat.normalize();
    this.rollActive = true;
    this.rollElapsed = 0;
    this.rollDuration = Math.max(0.2, duration);
    this.rollDir.copy(flat);
    this.wantFacing = Math.atan2(flat.x, flat.z);
  }

  /**
   * Hop back then float at `height` metres for `duration` seconds. Horizontal
   * input still works while hovering and a jump cancels it; gravity is suspended.
   */
  hover(height = 2, duration = 2, backHop = 3) {
    this.hoverActive = true;
    this.hoverElapsed = 0;
    this.hoverDuration = Math.max(0.2, duration);
    this.hoverHeight = height;
    this.slamActive = false;
    this.grounded = false;
    this.jumpsLeft = 1;
    this.didDoubleJump = false;
    this.vertical = 0;
    const back = this.forward().multiplyScalar(-backHop);
    this.velocity.x = back.x;
    this.velocity.z = back.z;
  }

  /** Rise + spin in place for `duration`s, then report via consumeSpinEnd(). */
  aerialSpin(duration = 1.5, height = 2.2) {
    this.spinActive = true;
    this.spinElapsed = 0;
    this.spinDuration = Math.max(0.3, duration);
    this.spinHeight = height;
    this.justSpinEnd = false;
    this.slamActive = false;
    this.grounded = false;
    this.jumpsLeft = 0;
    this.didDoubleJump = true;
    this.vertical = 0;
  }

  /** True on the single frame the aerial spin finishes (fire the projectile). */
  consumeSpinEnd(): boolean {
    const v = this.justSpinEnd;
    this.justSpinEnd = false;
    return v;
  }

  /** Downward speed at the last landing + whether a double jump was used. */
  get landingInfo(): { speed: number; doubled: boolean } {
    return { speed: this.landingSpeed, doubled: this.landedWithDouble };
  }

  /** True while any body-owning procedural special is running. */
  get isBusy(): boolean {
    return this.dashActive || this.flipActive || this.rollActive || this.spinActive;
  }

  /** True while the aerial spin is active (for per-frame flame trails). */
  get spinning(): boolean {
    return this.spinActive;
  }

  /** True while hovering (for per-frame ember flicker). */
  get hovering(): boolean {
    return this.hoverActive;
  }

  /**
   * Begin a hover at `height` metres above the floor for `duration` seconds.
   * Gravity is suppressed while hovering; the player keeps one mid-hover jump.
   * A jump() call during hover exits it (the vertical impulse overrides the lock).
   */
  startHover(height: number, duration: number) {
    this.hoverActive = true;
    this.hoverElapsed = 0;
    this.hoverDuration = Math.max(0.1, duration);
    this.hoverHeight = Math.max(0.1, height);
    this.hoverEnd = false;
    this.hoverWasActive = true;
    this.vertical = 0;
    this.grounded = false;
    this.jumpsLeft = 1;
    this.didDoubleJump = false;
  }

  /** Cancel the hover early (e.g. character took damage). */
  endHover() {
    this.hoverActive = false;
  }

  /** Set a transient horizontal move-speed multiplier (1 = normal). */
  setSpeedMultiplier(m: number) {
    this.speedMult = Math.max(0, m);
  }

  /** True while the hover is active. */
  get isHovering(): boolean {
    return this.hoverActive;
  }

  /** True on the single frame the hover timer naturally expired (not a jump-exit). */
  consumeHoverEnd(): boolean {
    const v = this.hoverEnd;
    this.hoverEnd = false;
    return v;
  }

  /**
   * True on the frame the player lands after having double-jumped OR after
   * hovering — plays the Striker's roll-out recovery clip.
   */
  consumeRollLanding(): boolean {
    const v = this.justRollLanding;
    this.justRollLanding = false;
    return v;
  }

  /** Smoothstep ease used by the procedural tumbles. */
  private static easeInOut(x: number): number {
    return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  }

  update(dt: number) {
    const mouse = this.input.consumeMouse();
    // Apply look from the mouse (pointer lock) OR from a touch look-pad drag.
    if (this.input.locked || this.input.lookActive) {
      const sens = 0.0022 * this.params.mouseSensitivity;
      const invert = this.params.invertY ? -1 : 1;
      // While locked on, the camera yaw is driven by the target, not the mouse.
      if (!this.lockTarget) this.yaw -= mouse.dx * sens;
      if (this.viewMode === "first") {
        // First person: dragging the mouse down looks down. fpPitch is the look
        // elevation (+ up), so drag-down decreases it; invertY flips. Near-±90°
        // clamp avoids gimbal flip at straight up/down.
        this.fpPitch = THREE.MathUtils.clamp(this.fpPitch - mouse.dy * sens * invert, -1.45, 1.45);
      } else {
        // Pitch up = camera rises and looks DOWN. By default dragging the mouse
        // down looks down (pitch up); invertY flips it. Clamp stays positive so
        // the orbit never drops the camera under the floor.
        this.pitch = THREE.MathUtils.clamp(
          this.pitch + mouse.dy * sens * invert,
          this.pitchMin,
          this.pitchMax,
        );
      }
    }
    // Wheel zooms the third-person orbit distance; in first person there is no
    // orbit, so the wheel is ignored (FOV zoom is owned by the consumer).
    if (mouse.wheel !== 0 && this.viewMode !== "first") {
      this.params.cameraDistance = THREE.MathUtils.clamp(
        this.params.cameraDistance + mouse.wheel * 0.005,
        2.5,
        10,
      );
    }

    // Lock-on: drive the camera yaw so the player sits between the camera and the
    // target (enemy framed ahead). lockYaw also forces the body facing below so
    // A/D strafes instead of turning toward the movement direction.
    let lockYaw: number | null = null;
    if (this.lockTarget) {
      const toT = new THREE.Vector3(
        this.lockTarget.x - this.character.root.position.x,
        0,
        this.lockTarget.z - this.character.root.position.z,
      );
      if (toT.lengthSq() > 1e-4) {
        lockYaw = Math.atan2(toT.x, toT.z);
        let d = lockYaw - this.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.yaw += d * Math.min(1, 9 * dt);
      }
    } else if (this.softTarget && (this.input.locked || this.input.lookActive)) {
      // Soft-lock aim assist: when the foe sits within a forward cone and the
      // player isn't actively turning, nudge the yaw gently toward it. This never
      // overrides intent — a real flick (mouse.dx) suspends the assist, and a foe
      // outside the cone is ignored (that's what Tab / hard lock are for).
      const toS = new THREE.Vector3(
        this.softTarget.x - this.character.root.position.x,
        0,
        this.softTarget.z - this.character.root.position.z,
      );
      if (toS.lengthSq() > 1e-4 && Math.abs(mouse.dx) < 2) {
        const desired = Math.atan2(toS.x, toS.z);
        let d = desired - this.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) < 1.05) this.yaw += d * Math.min(1, 3 * dt) * 0.5;
      }
    }

    // Movement input (camera-relative).
    // forward() is the camera's view direction projected on the floor; the
    // camera sits BEHIND the character looking along +forward, so screen-right
    // is cross(up, -viewDir) = (-fwd.z, 0, fwd.x). The old (fwd.z,0,-fwd.x) was
    // the negative of that, which mirrored A/D (and the facing that tracks
    // movement) — it felt like driving the character from the far side of the
    // screen. Keep this sign so D = screen-right.
    const fwd = this.forward();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3();
    if (this.input.down("KeyW") || this.input.down("ArrowUp")) move.add(fwd);
    if (this.input.down("KeyS") || this.input.down("ArrowDown")) move.sub(fwd);
    if (this.input.down("KeyD") || this.input.down("ArrowRight")) move.add(right);
    if (this.input.down("KeyA") || this.input.down("ArrowLeft")) move.sub(right);

    // Analog joystick (touch) blends in on top of the keyboard. When the stick is
    // the only input, `analog` drives a proportional speed; the keyboard stays
    // full-speed (unit vectors) exactly as before.
    const analog = Math.abs(this.input.moveX) > 0.001 || Math.abs(this.input.moveY) > 0.001;
    if (analog) {
      move.addScaledVector(fwd, this.input.moveY);
      move.addScaledVector(right, this.input.moveX);
    }
    const mag = Math.min(1, move.length());

    const sprinting =
      this.input.down("ShiftLeft") || this.input.down("ShiftRight") || this.input.touchSprint;
    const speed =
      this.params.moveSpeed * (sprinting ? this.params.sprintMultiplier : 1) * this.speedMult;
    // Keyboard moves at full speed; the joystick scales by how far it's pushed.
    const intensity = analog && move.length() < 1 ? mag : 1;
    let moving = mag > 0.06;
    const pos = this.character.root.position;
    // Body position at the start of the frame — used to reconcile the attempted
    // displacement through the dungeon KCC at the end of the movement block.
    const prevPos = this.collision ? pos.clone() : null;
    if (this.dashActive) {
      // The lunge owns the body: drive position along the eased curve, overriding
      // input. This is the "spline motion" that pairs with the clip's joint motion.
      this.dashElapsed += dt;
      const tau = THREE.MathUtils.clamp(this.dashElapsed / this.dashDuration, 0, 1);
      const disp = this.dashDisplacement(tau);
      pos.x = THREE.MathUtils.clamp(this.dashOrigin.x + this.dashDir.x * disp, -this.bound, this.bound);
      pos.z = THREE.MathUtils.clamp(this.dashOrigin.z + this.dashDir.z * disp, -this.bound, this.bound);
      this.velocity.set(0, 0, 0);
      moving = false;
      if (!this.dashImpactFired && tau >= this.dashImpactAt) {
        this.dashImpactFired = true;
        this.justDashImpact = true;
      }
      if (tau >= 1) this.dashActive = false;
    } else if (this.flipActive || this.spinActive) {
      // Backflip / aerial spin own the body in place: no horizontal motion.
      this.velocity.set(0, 0, 0);
      moving = false;
    } else if (this.rollActive) {
      // Forward roll-out: glide along rollDir, decelerating over the duration.
      const tau = THREE.MathUtils.clamp(this.rollElapsed / this.rollDuration, 0, 1);
      const rollSpeed = this.params.moveSpeed * 1.7 * (1 - tau);
      pos.x = THREE.MathUtils.clamp(pos.x + this.rollDir.x * rollSpeed * dt, -this.bound, this.bound);
      pos.z = THREE.MathUtils.clamp(pos.z + this.rollDir.z * rollSpeed * dt, -this.bound, this.bound);
      this.velocity.set(0, 0, 0);
      moving = false;
    } else if (this.hoverActive) {
      // Float: keyboard/stick still steer (slower); the back-hop velocity decays.
      if (moving) {
        move.normalize();
        this.velocity.copy(move).multiplyScalar(speed * intensity * 0.7);
        this.wantFacing = Math.atan2(move.x, move.z);
      } else {
        this.velocity.x *= 0.9;
        this.velocity.z *= 0.9;
      }
      pos.x = THREE.MathUtils.clamp(pos.x + this.velocity.x * dt, -this.bound, this.bound);
      pos.z = THREE.MathUtils.clamp(pos.z + this.velocity.z * dt, -this.bound, this.bound);
      moving = false;
    } else {
      if (moving) {
        move.normalize();
        this.velocity.copy(move).multiplyScalar(speed * intensity);
        this.wantFacing = Math.atan2(move.x, move.z);
      } else {
        this.velocity.multiplyScalar(0.001);
      }
      // Apply horizontal movement with simple room bounds.
      pos.x = THREE.MathUtils.clamp(pos.x + this.velocity.x * dt, -this.bound, this.bound);
      pos.z = THREE.MathUtils.clamp(pos.z + this.velocity.z * dt, -this.bound, this.bound);
    }

    // External knockback rides on top of every branch and decays smoothly.
    if (this.extVel.lengthSq() > 1e-4) {
      pos.x = THREE.MathUtils.clamp(pos.x + this.extVel.x * dt, -this.bound, this.bound);
      pos.z = THREE.MathUtils.clamp(pos.z + this.extVel.z * dt, -this.bound, this.bound);
      const damp = Math.exp(-this.extVelDamp * dt);
      this.extVel.x *= damp;
      this.extVel.z *= damp;
    }

    // Danger Room interior collision: multi-pass push out of static props
    // (pillars, crates/platforms) and live opponents so the capsule never stays
    // meshed inside solid volumes. Dungeon/arena use a Rapier KCC instead.
    if (!this.collision && this.obstacles) {
      const PLAYER_R = 0.35;
      const obs = this.obstacles();
      const lateralActive = (o: ObstacleCircle, feetY: number): boolean => {
        // Standing on a landable top — no side push.
        if (o.top !== undefined && feetY >= o.top - 0.02) return false;
        // Walking under a floating platform — no side push below its bottom.
        if (o.bottom !== undefined && feetY < o.bottom - 0.02) return false;
        // Capsule vertical span roughly [feetY, feetY+1.8]; skip if fully above top.
        if (o.top !== undefined && feetY > o.top + 1.75) return false;
        return true;
      };
      // 3 iterations: overlapping circles (pillar + crate) need repeated resolve
      // so we don't remain stuck after a single push into a neighbour.
      for (let iter = 0; iter < 3; iter++) {
        for (const o of obs) {
          if (!lateralActive(o, pos.y)) continue;
          const dx = pos.x - o.x;
          const dz = pos.z - o.z;
          const minDist = o.r + PLAYER_R;
          const d = Math.hypot(dx, dz);
          if (d >= minDist) continue;
          if (d > 1e-4) {
            pos.x = o.x + (dx / d) * minDist;
            pos.z = o.z + (dz / d) * minDist;
          } else {
            const f = this.forward();
            pos.x = o.x + f.x * minDist;
            pos.z = o.z + f.z * minDist;
          }
        }
        pos.x = THREE.MathUtils.clamp(pos.x, -this.bound, this.bound);
        pos.z = THREE.MathUtils.clamp(pos.z, -this.bound, this.bound);
        // Corner slide: wall clamp can re-embed into a pillar — project to the
        // nearest in-bounds point that clears the circle.
        for (const o of obs) {
          if (!lateralActive(o, pos.y)) continue;
          const dx = pos.x - o.x;
          const dz = pos.z - o.z;
          const minDist = o.r + PLAYER_R;
          if (dx * dx + dz * dz >= minDist * minDist) continue;
          const candidates: { x: number; z: number }[] = [];
          const needX = Math.sqrt(Math.max(0, minDist * minDist - dz * dz));
          for (const sx of [o.x + needX, o.x - needX]) {
            if (sx >= -this.bound && sx <= this.bound) candidates.push({ x: sx, z: pos.z });
          }
          const needZ = Math.sqrt(Math.max(0, minDist * minDist - dx * dx));
          for (const sz of [o.z + needZ, o.z - needZ]) {
            if (sz >= -this.bound && sz <= this.bound) candidates.push({ x: pos.x, z: sz });
          }
          let best: { x: number; z: number } | null = null;
          let bestD = Infinity;
          for (const c of candidates) {
            const dd = (c.x - pos.x) ** 2 + (c.z - pos.z) ** 2;
            if (dd < bestD) {
              bestD = dd;
              best = c;
            }
          }
          if (best) {
            pos.x = best.x;
            pos.z = best.z;
          }
        }
      }
    }

    // Vertical. Procedural specials drive their own height (gravity suspended);
    // otherwise the normal gravity + ground clamp runs.
    if (this.flipActive) {
      this.flipElapsed += dt;
      const tau = THREE.MathUtils.clamp(this.flipElapsed / this.flipDuration, 0, 1);
      // Anchor the arc to the current support surface (elevated prop tops
      // included) so the special never teleports the body back to the floor.
      pos.y = this.supportY + Math.sin(Math.PI * tau) * this.flipHop;
      this.character.root.rotation.x = -Math.PI * 2 * Controller.easeInOut(tau);
      this.vertical = 0;
      if (tau >= 1) {
        this.flipActive = false;
        this.character.root.rotation.x = 0;
        pos.y = this.supportY;
        this.grounded = true;
        this.jumpsLeft = 2;
        this.didDoubleJump = false;
      }
    } else if (this.rollActive) {
      this.rollElapsed += dt;
      const tau = THREE.MathUtils.clamp(this.rollElapsed / this.rollDuration, 0, 1);
      this.character.root.rotation.x = -Math.PI * 2 * Controller.easeInOut(tau);
      pos.y = this.supportY;
      this.vertical = 0;
      this.grounded = true;
      if (tau >= 1) {
        this.rollActive = false;
        this.character.root.rotation.x = 0;
      }
    } else if (this.spinActive) {
      this.spinElapsed += dt;
      const tau = THREE.MathUtils.clamp(this.spinElapsed / this.spinDuration, 0, 1);
      pos.y = this.supportY + Math.sin(tau * Math.PI * 0.5) * this.spinHeight;
      this.vertical = 0;
      if (tau >= 1) {
        this.spinActive = false;
        this.justSpinEnd = true;
        // Falls from this height under gravity on the next frame.
      }
    } else if (this.hoverActive) {
      this.hoverElapsed += dt;
      pos.y += (this.hoverHeight - pos.y) * Math.min(1, 6 * dt);
      this.vertical = 0;
      if (this.hoverElapsed >= this.hoverDuration) {
        this.hoverActive = false;
        this.hoverEnd = true;
      }
    } else {
      // Gravity + ground.
      const prevVertical = this.vertical;
      const prevY = pos.y;
      this.vertical -= this.params.gravity * dt;
      // Inside the dungeon water band, buoyancy clamps the descent to a slow,
      // constant sink so the player drifts down through the water rather than
      // plummeting. Climbing/upward velocity (jumps) is left untouched.
      this.vertical = sinkClampVertical(pos.y, this.vertical, this.waterBand, this.SINK_SPEED);
      pos.y += this.vertical * dt;
      // Skyfall apex: the single frame vertical velocity flips from rising to falling.
      if (this.skyfallArmed && prevVertical > 0 && this.vertical <= 0) {
        this.skyfallArmed = false;
        this.justApex = true;
        this.character.root.rotation.x = 0;
      }
      // Twist-flip while rising: one forward somersault eased to finish at apex.
      if (this.skyfallArmed) {
        this.skyfallRiseElapsed += dt;
        const tau = THREE.MathUtils.clamp(this.skyfallRiseElapsed / this.skyfallRiseDur, 0, 1);
        this.character.root.rotation.x = -Math.PI * 2 * Controller.easeInOut(tau);
      }
      if (!this.collision) {
        // Ground is no longer a flat y=0 plane: landable obstacle tops (crates,
        // barrels, deployed props) count as support, sampled from the height the
        // feet fell FROM so wall faces never teleport the body upward.
        const groundY = this.supportHeightAt(pos.x, pos.z, prevY);
        if (pos.y <= groundY) {
          pos.y = groundY;
          if (!this.grounded) {
            this.justLanded = true;
            this.landingSpeed = Math.abs(prevVertical);
            if (this.slamActive) {
              this.justSlamLanded = true;
              this.slamActive = false;
            }
            this.landedWithDouble = this.didDoubleJump;
            this.justRollLanding = this.didDoubleJump || this.hoverWasActive;
            this.hoverWasActive = false;
            // Ground-truth touchdown for rigs holding a looped airborne pose —
            // they can't infer elevated landings from root.y alone.
            this.character.notifyLanded?.();
          }
          this.vertical = 0;
          this.grounded = true;
          this.supportY = groundY;
          this.jumpsLeft = 2;
          this.didDoubleJump = false;
          this.skyfallArmed = false;
          this.character.root.rotation.x = 0;
        } else if (this.grounded) {
          const drop = pos.y - groundY;
          if (drop <= this.STEP_DOWN) {
            // Small ledge: glue the feet to the lower surface and keep walking.
            pos.y = groundY;
            this.vertical = 0;
            this.supportY = groundY;
          } else {
            // Support fell away (walked off a prop top): proper airborne state —
            // fall pose now, landing state/VFX fire on touchdown below.
            this.grounded = false;
            this.supportY = 0;
            if (!this.character.isOneShotActive && !this.isBusy) {
              this.character.playRoleOnce("jump", 0.15);
            }
          }
        }
      }
    }

    // Dungeon collision: reconcile the whole frame's attempted displacement
    // through the KCC, then derive grounding from the result. Only runs when a
    // collision provider is active, so the Danger Room path above is untouched.
    if (this.collision && prevPos) {
      const delta = new THREE.Vector3().subVectors(pos, prevPos);
      const res = this.collision.move(prevPos, delta);
      pos.copy(res.pos);
      if (res.grounded && this.vertical <= 0) {
        if (!this.grounded) {
          this.justLanded = true;
          this.landingSpeed = Math.abs(this.vertical);
          if (this.slamActive) {
            this.justSlamLanded = true;
            this.slamActive = false;
          }
          this.landedWithDouble = this.didDoubleJump;
          this.justRollLanding = this.didDoubleJump || this.hoverWasActive;
          this.hoverWasActive = false;
          // Elevated dungeon floors land well above y=0 — tell the rig directly
          // so a held airborne pose clears at the real support height.
          this.character.notifyLanded?.();
        }
        this.vertical = 0;
        this.grounded = true;
        this.supportY = pos.y;
        this.jumpsLeft = 2;
        this.didDoubleJump = false;
        this.skyfallArmed = false;
      } else if (!res.grounded) {
        this.grounded = false;
        // A ceiling bonk: kill upward velocity so we don't stick to it.
        if (this.vertical > 0 && delta.y > 0 && res.pos.y - prevPos.y < delta.y - 1e-3) {
          this.vertical = 0;
        }
      }
    }

    // Lock-on overrides facing: keep the body squared to the enemy so A/D reads
    // as a strafe instead of turning to face the movement direction.
    if (lockYaw !== null && !this.spinActive) this.wantFacing = lockYaw;

    // Face movement direction. During a lunge, turn faster so it reads as a
    // committed dash without the old jarring instant facing snap.
    const cur = this.character.root.rotation.y;
    let diff = this.wantFacing - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (this.facingBoost > 0) this.facingBoost = Math.max(0, this.facingBoost - dt);
    const boosted = this.dashActive || this.facingBoost > 0;
    const turn = boosted ? Math.max(this.params.turnResponsiveness, 20) : this.params.turnResponsiveness;
    if (this.spinActive) {
      // Fast continuous Y-spin overrides facing while the aerial spin runs.
      this.character.root.rotation.y += 16 * dt;
    } else if (this.skyfallArmed) {
      // Add a body twist to the rising Skyfall flip (twist-flip going straight up).
      this.character.root.rotation.y += 13 * dt;
    } else {
      this.character.root.rotation.y = cur + diff * Math.min(1, turn * dt);
    }

    // Locomotion blend by smoothed speed (skip while a one-shot owns the body).
    // Walk stays mid-range; Shift forces 1.0 so setLocomotion can pick sprint.
    // Previously non-sprint keyboard sat at 0.5 and the fallback path promoted
    // grudge6 to "run" at 0.65 — Shift and walk both felt like the wrong gait.
    const targetSpeed = moving
      ? sprinting
        ? 1
        : analog
          ? Math.min(0.75, 0.25 + mag * 0.5)
          : 0.45
      : 0;
    this.smoothedSpeed += (targetSpeed - this.smoothedSpeed) * Math.min(1, 10 * dt);
    if (!this.character.isOneShotActive && this.grounded && !this.isBusy && !this.hoverActive) {
      if (this.character.setLocomotionDirectional) {
        // Direction-aware weight-blend (GLB Character): project the world move
        // dir onto the body facing so A/D under a target lock reads as a strafe
        // (moveX) and forward as moveZ. Degrades to the forward blend on rigs
        // without strafe clips, so normal play is unchanged.
        const yaw = this.character.root.rotation.y;
        const rel = Math.atan2(move.x, move.z) - yaw;
        const mv = this.smoothedSpeed;
        this.character.setLocomotionDirectional(Math.sin(rel) * mv, Math.cos(rel) * mv, mv);
      } else if (this.character.setLocomotion) {
        // GrudgeAvatar + GLB Character: continuous speed → idle/walk/sprint.
        this.character.setLocomotion(this.smoothedSpeed);
      } else if (sprinting && this.character.hasRole("run")) {
        this.character.playRole("run");
        this.character.setLocomotionRate(1);
      } else if (this.smoothedSpeed > 0.06) {
        this.character.playRole("walk");
        this.character.setLocomotionRate(0.9 + this.smoothedSpeed * 0.3);
      } else {
        this.character.playRole("idle");
        this.character.setLocomotionRate(1);
      }
    }

    this.updateCamera(dt);
  }

  private updateCamera(dt: number) {
    // Decay trauma and strip last frame's additive shake before recomputing the
    // base pose, so the lerped third-person camera never accumulates the offset.
    if (this.shakeTrauma > 0) this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 1.6);
    this.camera.position.sub(this.shakeOffset);

    if (this.viewMode === "first") {
      this.updateFirstPersonCamera();
      this.applyCameraShake();
      return;
    }
    const target = this.character.root.position.clone();
    target.y += this.params.cameraHeight;
    const dist = this.params.cameraDistance;
    // Spherical orbit BEHIND the character: the horizontal ring (x/z) sits on
    // -forward via -dist and shrinks with pitch (cos), while the vertical rises
    // with pitch (+sin * dist) so a higher pitch looks DOWN from above. The old
    // code multiplied the whole vector (incl. +sin(pitch)) by -dist, which sank
    // the camera underground and made it look up from beneath the floor.
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch) * -dist,
      Math.sin(this.pitch) * dist,
      Math.cos(this.yaw) * Math.cos(this.pitch) * -dist,
    );
    const desired = target.clone().add(offset);
    if (!this.collision) {
      // Danger Room: hard floor clamp + keep the camera inside the room walls so
      // a wall can never end up between the camera and the character.
      desired.y = Math.max(desired.y, 0.5);
      const camBound = this.bound + 0.5;
      desired.x = THREE.MathUtils.clamp(desired.x, -camBound, camBound);
      desired.z = THREE.MathUtils.clamp(desired.z, -camBound, camBound);
    } else if (this.occluders.length) {
      // Dungeon: pull the camera in front of any wall/prop between it and the
      // player so the view never clips into geometry indoors.
      const dir = new THREE.Vector3().subVectors(desired, target);
      const len = dir.length();
      if (len > 1e-3) {
        dir.divideScalar(len);
        this.camRay.set(target, dir);
        this.camRay.far = len;
        const hits = this.camRay.intersectObjects(this.occluders, false);
        if (hits.length > 0) {
          const d = Math.max(0.5, hits[0].distance - 0.3);
          desired.copy(target).addScaledVector(dir, d);
        }
      }
    }
    this.camera.position.lerp(desired, Math.min(1, 12 * dt));
    this.camera.lookAt(target);
    this.applyFov();
    this.applyCameraShake();
  }

  /**
   * Compute this frame's camera-shake offset from the current trauma and add it
   * to the (already-positioned) camera. Multi-frequency per-axis noise reads as a
   * non-repetitive rattle; the offset is recorded so {@link updateCamera} can undo
   * it next frame before recomputing the base pose.
   */
  private applyCameraShake() {
    const s = this.shakeTrauma * this.shakeTrauma;
    if (s <= 0) {
      this.shakeOffset.set(0, 0, 0);
      return;
    }
    const t = (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001;
    this.shakeOffset.set(
      Math.sin(t * 47 + this.shakeSeed) * 0.22 * s,
      Math.sin(t * 61 + this.shakeSeed * 1.7) * 0.16 * s,
      Math.sin(t * 53 + this.shakeSeed * 2.3) * 0.22 * s,
    );
    this.camera.position.add(this.shakeOffset);
  }

  /**
   * Eye-anchored first-person camera: sit the camera at the body's eye height and
   * look along yaw + first-person pitch (plus any recoil offset). The avatar mesh
   * is hidden in this mode so the body never occludes the view. The screen-centre
   * aim ray (aimRay) is camera-forward, so the crosshair maps exactly to the hit
   * point — the DGS camera-forward raycast model.
   */
  private updateFirstPersonCamera() {
    const eye = this.character.root.position;
    const yaw = this.yaw + this.aimYaw;
    const pitch = THREE.MathUtils.clamp(this.fpPitch + this.aimPitch, -1.5, 1.5);
    const cp = Math.cos(pitch);
    const dirX = Math.sin(yaw) * cp;
    const dirY = Math.sin(pitch);
    const dirZ = Math.cos(yaw) * cp;
    const ex = eye.x;
    const ey = eye.y + this.params.cameraHeight;
    const ez = eye.z;
    this.camera.position.set(ex, ey, ez);
    this.camera.lookAt(ex + dirX, ey + dirY, ez + dirZ);
    this.applyFov();
  }

  /** Apply the base FOV plus the consumer-owned sprint kick, if it changed. */
  private applyFov() {
    const fov = this.params.fov + this.fovKickAmt;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
