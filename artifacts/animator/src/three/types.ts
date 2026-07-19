import type * as THREE from "three";
import type { CombatStateName } from "@workspace/epicfight";
import type { CanonicalSuffix } from "./retargetMap";
import type { CharacterLook } from "./explorer/types";
import type { SnippetSpec } from "./snippets";
import type { GroundSampler } from "./anim/legIk";

export type AnimRole =
  | "idle"
  | "walk"
  | "run"
  | "attack"
  | "jump"
  | "death"
  | "hurt"
  | "block";

export type WeaponId =
  | "none"
  | "sword"
  | "greatsword"
  | "axe"
  | "dagger"
  | "spear"
  | "hammer"
  | "mace"
  | "mace2h"
  | "greataxe"
  | "hammer2h"
  | "bow"
  | "staff"
  | "staffFire"
  | "staffIce"
  | "staffStorm"
  | "staffNature"
  | "staffHoly"
  | "staffArcane"
  | "pistol"
  | "rifle"
  | "shield"
  | "gunblade"
  | "hunter-rifle"
  | "javelin";

export type SkillKind =
  | "slash"
  | "slam"
  | "bolt"
  | "nova"
  | "muzzle"
  | "thrust"
  // Model-driven projectile/spell skills (vfx-sandbox GLB templates).
  | "fireDragon"
  | "meteor"
  | "turret"
  | "darkBlades"
  | "swordVolley"
  // A slow, strongly-homing spectral "soul" projectile + a fast, near-straight
  // FTL burst-laser bolt (vfx-sandbox GLB templates).
  | "soul"
  | "laser";

/** Status effects (ported from the CC0 BinbunVFX packs). */
export type StatusKind = "buff" | "debuff";
export type StatusId =
  | "burning"
  | "frozen"
  | "poisoned"
  | "shocked"
  | "hexed"
  | "regen"
  | "empowered"
  | "shielded"
  | "haste"
  /** Movement slow (ice/venom snakes, earth roots). */
  | "slowed"
  /** Brief hard CC (storm/holy snakes, roots peak). */
  | "stunned";

/**
 * Elemental school of a magic staff. Each element is its own staff weapon type
 * that casts its themed projectile + applies its matching status (see
 * `arsenal/elements.ts` for the canonical theme table).
 */
export type StaffElement = "fire" | "ice" | "storm" | "nature" | "holy" | "arcane";

/**
 * Crowd-control statuses a sparring target can carry (distinct from the player's
 * BinbunVFX `StatusId` buff/debuff auras). A "stun" freezes a target and skips
 * all its reactions for the duration; a "shieldBreak" leaves it unable to
 * block/parry/dodge incoming hits.
 */
export type TargetStatusId = "stun" | "shieldBreak";

/** A single active status as the HUD notifier renders it. */
export interface StatusView {
  id: StatusId;
  name: string;
  kind: StatusKind;
  /** CSS color string. */
  color: string;
  /** Non-emoji symbol glyph for the chip. */
  glyph: string;
  remaining: number;
  duration: number;
}

/**
 * Sparring-opponent aggression level. "passive" keeps the old training-dummy
 * behaviour (no AI, no attacks); easy/medium/hard scale reaction speed,
 * aggression, weapon-skill frequency, defence odds and damage dealt.
 */
export type Difficulty = "passive" | "easy" | "medium" | "hard";

/** Which side a spawned NPC fights for. Allies fight enemies; enemies fight the
 * player + allies. */
export type Faction = "enemy" | "ally";

/** Phase of an AI-vs-AI Explorer duel. */
export type DuelPhase = "idle" | "countdown" | "fighting" | "result";

/** Read-only snapshot of a duel for the HUD (round / score / weapon / winner). */
export interface DuelState {
  active: boolean;
  phase: DuelPhase;
  /** Whole seconds left in the current countdown / result pause. */
  timer: number;
  round: number;
  /** Fighters per side (1 = 1v1, 2 = 2v2, 3 = 3v3). */
  teamSize: number;
  weapon: WeaponId;
  weaponLabel: string;
  /** Left (fighter A) and right (fighter B) running scores. */
  scoreA: number;
  scoreB: number;
  /** Winner of the round just resolved ("A" left / "B" right), null = none/draw. */
  lastWinner: "A" | "B" | null;
}

// ── A.L.E. Bot (director cameras, highlights & diagnostics) ──────────────────

/** World-space tracking points the diagnostics lens pins markers to. */
export interface AvatarMarkers {
  head: THREE.Vector3;
  leftHand: THREE.Vector3;
  rightHand: THREE.Vector3;
  leftFoot: THREE.Vector3;
  rightFoot: THREE.Vector3;
  /** Approx weapon tip (or empty hand when unarmed). */
  weapon: THREE.Vector3;
}

/** Lightweight per-frame read of a duel fighter the A.L.E. Bot polls. */
export interface FighterView {
  id: number;
  /** Duel mapping: ally → "A" (left), enemy → "B" (right). */
  faction: Faction;
  dead: boolean;
  group: THREE.Group;
  /** Real procedural rig (duel fighters) or null for primitive dummies. */
  avatar: import("./ExplorerCharacter").ExplorerCharacter | null;
  health: number;
  maxHealth: number;
  poise: number;
  stamina: number;
  state: CombatStateName;
}

/** Which duel camera the A.L.E. rig is driving ("off" = player controller owns it). */
export type AleCameraMode = "off" | "orbit" | "povA" | "povB" | "director";

/**
 * How often A.L.E. auto-interrupts the action with a highlight replay.
 * "off" = never; "ko" = only the finishing blow; "rare" / "highlights" /
 * "frequent" widen which mid-round moments earn a replay (and shorten the
 * anti-spam cooldown between them).
 */
export type ReplayFrequency = "off" | "ko" | "rare" | "highlights" | "frequent";

/** Category of a flagged highlight moment. */
export type HighlightKind = "ko" | "crit" | "parry" | "bigHit" | "flurry";

/** A flagged moment in the rolling highlight buffer. */
export interface Highlight {
  /** Seconds since the duel started. */
  t: number;
  round: number;
  kind: HighlightKind;
  /** Which fighter the moment is credited to ("A"/"B"). */
  fighter: "A" | "B";
  /** 0..1 excitement at capture. */
  score: number;
  label: string;
}

/** One ranked finding in the post-duel report. */
export interface AleFinding {
  /** Higher = more severe / more worth a designer's attention. */
  severity: number;
  category: "balance" | "timing" | "physics";
  text: string;
}

/** Per-fighter aggregated telemetry shown in the report. */
export interface AleFighterReport {
  fighter: "A" | "B";
  swings: number;
  hits: number;
  whiffs: number;
  /** hits / swings, 0..1. */
  accuracy: number;
  blocks: number;
  parries: number;
  dodges: number;
  /** Frames flagged with limb/weapon motion through an attack with no active collider. */
  missingColliderFlags: number;
  /** Count of above-threshold knockback impulses. */
  forceSpikes: number;
  peakForce: number;
  damageDealt: number;
  kos: number;
}

/** Aggregated post-duel A.L.E. report. */
export interface AleReportData {
  rounds: number;
  /** Per-round time-to-kill (seconds), most recent last. */
  timeToKill: number[];
  fighters: AleFighterReport[];
  /** Ranked human-readable findings (most severe first). */
  findings: AleFinding[];
}

/** A channel A.L.E. drafts attention-grabbing posts for (preview only — no publishing). */
export type AlePlatform =
  | "grudge-studio"
  | "discord"
  | "youtube"
  | "twitter"
  | "instagram"
  | "forum";

/** A single draft post A.L.E. composed from a duel — never auto-published. */
export interface AlePost {
  platform: AlePlatform;
  /** Optional headline/title (used by youtube/forum/site/discord). */
  headline: string;
  /** Body caption in A.L.E.'s attention-seeking GRUDOX voice. */
  caption: string;
  /** Platform-flavoured tags/hashtags (no leading '#'). */
  tags: string[];
  /** The highlight moment that inspired the post, if any. */
  highlight?: string;
  /** 0..1 hype score (drives ordering, newest-hottest first). */
  hype: number;
}

/** Who an A.L.E. recording entry concerns: A = Player 1, B = Player 2, ale = the director itself. */
export type AleActor = "A" | "B" | "ale";

/** One timestamped entry in A.L.E.'s fight recording log. */
export interface AleLogEntry {
  /** Seconds since the duel started. */
  t: number;
  round: number;
  actor: AleActor;
  /** Category (drives icon/colour). */
  kind: "hit" | "crit" | "parry" | "block" | "dodge" | "ko" | "round" | "slowmo" | "note";
  text: string;
}

/** A.L.E.'s narrative match recap (announcer commentary), built once a duel ends. */
export interface AleRecap {
  title: string;
  /** Commentary lines in A.L.E.'s GRUDOX announcer voice, in reading order. */
  lines: string[];
  /** Most valuable fighter (skill + result), or null on a featureless draw. */
  mvp: "A" | "B" | null;
  /** Skill-meta tallies — the parry/block/dodge/timing bar these ad videos are gated on. */
  skill: { parries: number; blocks: number; dodges: number; cleanTiming: boolean };
}

/** A single beat of the narrated highlight review. */
export interface AleReviewBeat {
  /** Milliseconds into the review this beat begins. */
  atMs: number;
  durationMs: number;
  /** On-screen caption. */
  caption: string;
  /** What A.L.E. speaks aloud (browser text-to-speech). */
  speak: string;
  /** Camera A.L.E. cuts to while this beat plays. */
  camera: AleCameraMode;
}

/** A ~10-second narrated highlight reel A.L.E. assembles post-duel (ad-ready review). */
export interface AleReview {
  totalMs: number;
  beats: AleReviewBeat[];
}

/** A.L.E. Bot state surfaced to the HUD/admin UI each frame. */
export interface AleSnapshot {
  cameraMode: AleCameraMode;
  diagnostics: boolean;
  /** 0..1 live excitement. */
  excitement: number;
  /** True while a slow-mo highlight is playing. */
  slowmo: boolean;
  /** Newest-first rolling highlight buffer. */
  highlights: Highlight[];
  /** Finalised report after a duel stops (null while running / before any duel). */
  report: AleReportData | null;
  /** Draft social posts A.L.E. composed from the last duel (preview only). */
  feed: AlePost[];
  /** Chronological fight recording (Player 1 / Player 2 / A.L.E.), oldest first. */
  log: AleLogEntry[];
  /** A.L.E.'s narrative recap, built once a duel ends (null while running). */
  recap: AleRecap | null;
  /** A ~10s narrated highlight reel built post-duel (null while running). */
  review: AleReview | null;
  /** True while an instant replay is re-posing recorded fight frames. */
  replaying: boolean;
  /** 0..1 progress through the current instant replay (0 when not replaying). */
  replayProgress: number;
  /** True while the active replay's playhead is paused (held on a frame). */
  replayPaused: boolean;
  /** Viewer-chosen replay playback rate (1 = recorded real-time). */
  replaySpeed: number;
  /** Camera currently framing the replay (or the live duel camera when idle). */
  replayCamera: AleCameraMode;
  /** Camera modes a viewer may cut to while a replay is playing. */
  replayCameras: AleCameraMode[];
  /** How often KOs/highlights auto-trigger an instant replay. */
  replayFrequency: ReplayFrequency;
  /** True when enough footage is buffered to play an instant replay on demand. */
  canReplay: boolean;
}

/** Tuning an active difficulty applies to every sparring opponent. */
export interface DifficultyProfile {
  /** Telegraph/reaction time an opponent winds up before a strike lands (s). */
  windup: number;
  /** Closing speed toward the player while approaching (m/s). */
  approachSpeed: number;
  /** Seconds between an opponent's attacks (lower = more aggressive). */
  attackInterval: number;
  /** 0-1 chance any given attack is a flashy weapon skill (bigger hit). Also the brain's skill-frequency bias. */
  skillChance: number;
  /** Scales damage opponents deal to the player. */
  damageScale: number;
  /** Brain bias: how strongly the fighter presses an attack (higher = more aggressive). */
  aggression: number;
  /** Brain bias: how strongly the fighter defends a telegraphed threat (higher = more defensive). */
  caution: number;
}

/** Assignable action slots a GLB clip can be bound to. */
export type ActionSlot = "primary" | "fskill" | "sig1" | "sig2" | "sig3" | "sig4";

/** A resolved binding of an action slot to the clip it currently triggers. */
export interface SlotBinding {
  slot: ActionSlot;
  /** Input key/button label, e.g. "LMB", "F", "1". */
  key: string;
  /** Friendly action name (weapon skill / signature label). */
  label: string;
  /** The clip name this slot will play right now (override or default). */
  clip: string;
  /** True when the slot is bound to a user override rather than the default. */
  custom: boolean;
}

/**
 * Per-weapon melee tuning, all on a designer-friendly 1-100 scale except range
 * (real metres). Drives the 3-hit LMB combo: how hard hits land, how strongly a
 * strike steers/homes onto the crosshair target, and the distance window the
 * dash-closer commits to. e.g. Sword & Shield ~ (intensity 30, direction 100,
 * range 1-2 m): light, perfectly target-locked, short reach.
 */
export interface WeaponCombat {
  /** 1-100: strike power — scales damage, knockback force, lunge speed + impact size. */
  intensity: number;
  /** 1-100: how strongly a strike auto-faces/steers onto the aimed target. */
  direction: number;
  /** Reach window [min, max] in metres: the dash-closer stops inside this band. */
  range: [number, number];
}

/**
 * A weapon's game-ready melee hit volume: a CAPSULE running along the weapon's
 * cutting edge, expressed in the weapon's LOCAL mount frame (the same frame as
 * the `tip` anchor — grip at the origin, `+Y` toward the tip for held blades).
 * `a` is the guard/haft end of the edge, `b` the tip end. `radius` is the blade's
 * hit tolerance around that edge segment.
 *
 * This is what the swept-edge collision system sweeps through space each frame to
 * resolve blade-vs-body (impact/damage), blade-vs-shield (block), and
 * blade-vs-weapon (clash/parry). It is tunable per weapon (grip + blade
 * placement) and persisted with the weapon overrides, so every weapon has a
 * "sure asset" collider known in its def.
 */
export interface WeaponHitShape {
  /** Guard/haft end of the cutting edge, local mount-space metres. */
  a: [number, number, number];
  /** Tip end of the cutting edge, local mount-space metres. */
  b: [number, number, number];
  /** Capsule radius around the edge segment (metres). */
  radius: number;
}

/** Behaviour a Striker-style kick skill triggers (drives the Studio dispatch). */
export type KickSkillBehavior = "lunge" | "launcher" | "aerialProjectile" | "hover";

/** One step of a fire-kick LMB combo. Distances in metres. */
export interface KickComboStep {
  /** Preferred native clip name; falls back to the attack role when missing. */
  clip: string;
  /** Base damage at the strike. */
  damage: number;
  /** Lunge distance toward the aimed target. */
  reach: number;
  /** Fraction (0..1) of `reach` sprung back after impact (ninja recoil). */
  bounce: number;
  /** Knockback force multiplier (x editor skillForce). */
  force: number;
  /** Strike radius. */
  radius: number;
  /** Upward pop apex (m) applied to struck targets. 0/undefined = none. */
  lift?: number;
  /** Self vertical hop velocity at the strike (m/s). 0/undefined = grounded. */
  hop?: number;
}

/**
 * One Striker signature skill. Tunables only — its label, clip and VFX `kind`
 * come from the parallel-indexed `signatureSkills` entry (single source).
 */
export interface KickSkill {
  /** What the skill does. */
  behavior: KickSkillBehavior;
  /** Cooldown in seconds (Strikers run large cooldowns). */
  cooldown: number;
  /** Strike damage. */
  damage: number;
  /** Knockback force multiplier (x editor skillForce). */
  force: number;
  /** Strike radius. */
  radius: number;
}

/**
 * Data-driven fire-kick fighter profile (Striker "Sealeg"). Built to be reused
 * by future martial styles (Boxer / Tera-kasi): the 3-hit LMB combo and the four
 * signature skills are pure data; the Studio interprets each step/skill behaviour
 * (the underlying GLB rig plays its OWN native clips, layered with fire VFX +
 * procedural body motion).
 */
export interface StrikerCombat {
  /** Fire palette (hex). core = white-hot, flame = orange, ember = red. */
  palette: { core: number; flame: number; ember: number };
  /** The 3-hit LMB combo, in order. */
  combo: KickComboStep[];
  /** Signature skills mapped to HUD slots 1-4 (parallel to `signatureSkills`). */
  skills: KickSkill[];
  /**
   * Impact theme for the combo + signature VFX. "fire" (default) is the Striker's
   * flaming-foot style; "chi" layers crackling lightning accents on every strike
   * for an electric martial artist (Tera-kasi). Cosmetic only — drives VFX flavour.
   */
  fx?: "fire" | "chi";
}

/**
 * Pistol "Kiter / Gunslinger" primary-fire profile. Pure data so the editor and
 * future ranged kits can retune the proximity-adaptive primary: at range it
 * shoots and back-steps (kiter mobility); inside `kickRange` it becomes a
 * close-quarters MMA kick (parry/stun). Each clip holds `clipSize` rounds and
 * the final round fires a colorful explosive AoE bullet before reloading.
 */
export interface KiterKit {
  /** Planar distance (m) at/under which the primary becomes the close MMA kick. */
  kickRange: number;
  /** Rounds per clip; the last round is the explosive colorful bullet. */
  clipSize: number;
  /** Per-shot bullet damage (ordinary rounds). */
  shotDamage: number;
  /** Explosive (final) round damage. */
  blastDamage: number;
  /** Explosive (final) round AoE radius (m). */
  blastRadius: number;
  /** Close MMA-kick strike damage. */
  kickDamage: number;
  /** Metres the player back-steps away from the aimed target after a ranged shot. */
  backstep: number;
}

/**
 * Arcane Staff "Soulbinder" caster kit. Pure data driving the four bespoke
 * signature spells dispatched by Studio.doArcaneSig when the staff is equipped:
 * a soul-step backstep (1), a release of homing soul bolts (2), a void-jaunt that
 * drops timed soul-bombs then blinks the caster backward (3), and a soul-nova
 * capstone (4).
 */
export interface ArcaneKit {
  /** Metres the soul-step (slot 1) carries the caster backward. */
  backstep: number;
  /** Number of homing souls released by Soul Release (slot 2). */
  soulCount: number;
  /** Per-soul impact damage. */
  soulDamage: number;
  /** Soul impact AoE radius (m). */
  soulRadius: number;
  /** Metres the void-jaunt (slot 3) blinks the caster backward. */
  blinkDist: number;
  /** Number of timed bombs the void-jaunt drops at the launch point. */
  bombCount: number;
  /** Per-bomb explosion damage. */
  bombDamage: number;
  /** Per-bomb explosion AoE radius (m). */
  bombRadius: number;
  /** Seconds before the dropped bombs detonate. */
  bombDelay: number;
  /** Soul-nova (slot 4) AoE damage around the caster. */
  novaDamage: number;
  /** Soul-nova (slot 4) AoE radius (m). */
  novaRadius: number;
}

/**
 * Gunblade "Tank" (Centurion) kit. A slow, heavily-armoured bruiser who fights
 * with a gunsword + roman scutum and bypasses the shared skillCooldown gate for
 * four bespoke signature skills (Studio.doTankSig): a shield-charge gap-closer
 * (1), a point-blank shield bash (2), a sword+shield blade flurry (3), and a
 * gunblade "Super Cannon" capstone beam (4). The three `*Mul` stats express the
 * tank fantasy as pure data — slower movement and reduced incoming damage (with
 * an extra mitigation step while guarding) — applied in Studio (spawnCharacter +
 * resolveOpponentStrike); the player's max HP itself stays owned by SparringCombat.
 */
export interface TankKit {
  /** Movement-speed multiplier (<1 = slower). Applied on spawn. */
  moveSpeedMul: number;
  /** Multiplier on ALL incoming damage (<1 = tankier). */
  damageTakenMul: number;
  /** Extra incoming-damage multiplier applied ON TOP while actively blocking (<1 = sturdier guard). */
  blockDamageMul: number;
  /** Shield Charge (slot 1): forward dash distance (m). */
  chargeDistance: number;
  /** Shield Charge impact damage. */
  chargeDamage: number;
  /** Shield Charge impact AoE radius (m). */
  chargeRadius: number;
  /** Shield Bash (slot 2): point-blank damage. */
  bashDamage: number;
  /** Shield Bash AoE radius (m). */
  bashRadius: number;
  /** Blade Flurry (slot 3): per-hit damage. */
  flurryDamage: number;
  /** Number of hits in the Blade Flurry. */
  flurryHits: number;
  /** Blade Flurry per-hit AoE radius (m). */
  flurryRadius: number;
  /** Super Cannon (slot 4): beam impact damage. */
  cannonDamage: number;
  /** Super Cannon blast AoE radius (m). */
  cannonRadius: number;
  /** Super Cannon beam range (m). */
  cannonRange: number;
}

/**
 * Animation set a weapon drives. Mirrors the procedural Explorer rig's weapon
 * classes (clip sets self-hosted under `public/anim/animations/`); GLB rigs play
 * their own embedded clips, so this only re-classes the procedural rig.
 */
export type WeaponAnimSet =
  | "unarmed"
  | "sword"
  | "knife"
  | "greatsword"
  | "axe"
  | "mace"
  | "mace2h"
  | "spear"
  | "hammer"
  | "greataxe"
  | "hammer2h"
  | "ranged"
  | "bow"
  | "magic"
  | "pistol";

/** Local model axis that points toward a weapon's tip/barrel before normalising. */
export type ModelForward = "x+" | "x-" | "y+" | "y-" | "z+" | "z-";

/**
 * One real GLB piece of a weapon loadout. The mounter loads (cached) + clones the
 * GLB, reorients `forward` onto the mount's `align` axis, uniform-fits the longest
 * axis to `length` (m), and anchors it (`base` = grip at the bottom for held
 * weapons; `center` = centred for shields/guns). Per-weapon grip rotation/offset
 * is applied afterwards by the mounter's id table.
 */
export interface WeaponModelPiece {
  /** Public URL under `models/weapons/` (resolved via `asset()`). */
  file: string;
  /** Target longest-axis size in metres after uniform auto-fit. */
  length: number;
  /** Which local axis points toward the tip/barrel. */
  forward: ModelForward;
  /** Mount axis `forward` is rotated onto: `y` (held up) or `z` (aimed forward). */
  align: "y" | "z";
  /** Grip anchor: `base` sits the bottom in the fist; `center` centres the model. */
  anchor: "base" | "center";
}

/**
 * A weapon's real-model loadout: a main-hand piece, an optional off-hand piece
 * (Sword's buckler, the second Dagger), and a two-handed stance hint (the held
 * pose comes from the animation set, not IK).
 */
export interface WeaponModel {
  main: WeaponModelPiece;
  off?: WeaponModelPiece;
  /** Held with both hands via the animation stance (Greatsword/Spear/Hammer/Bow/Rifle). */
  twoHanded?: boolean;
}

/** Roster family used for grouping + duel eligibility. */
export type WeaponGroup =
  | "unarmed"
  | "melee-1h"
  | "melee-2h"
  | "off-hand"
  | "ranged"
  | "magic";

/** Per-axis grip rotation/translation in the (world-aligned) hand-mount frame. */
export interface WeaponGripTransform {
  rot: [number, number, number];
  pos: [number, number, number];
}

/** A weapon prefab's hand-mount grip (main piece + optional off-hand piece). */
export interface WeaponGripDef {
  main: WeaponGripTransform;
  off?: WeaponGripTransform;
}

/**
 * A named variant of a weapon carried purely as DATA — no new models or clips.
 * Tiers let one prefab present multiple flavours (Iron → Mythril) and optionally
 * scale its combat intensity, while reusing the same model/clip/VFX loadout.
 */
export interface WeaponTier {
  /** Display name of the variant (e.g. "Iron", "Runed", "Mythril"). */
  name: string;
  /** Multiplier on the base combat intensity (1 = unchanged). */
  power?: number;
  /**
   * Optional distinct GLB for this tier, REPLACING the weapon's base `model.main`
   * piece when this tier is selected (the off-hand piece, clip set, hold-style
   * and skill all stay the weapon's — a tier only swaps the main model's looks).
   * Lets one type present several genuinely different weapons (e.g. six bows)
   * while sharing one moveset. Omit to reuse the base model.
   */
  model?: WeaponModelPiece;
  /** Optional grip override for this tier's main model (else the weapon's grip). */
  grip?: WeaponGripTransform;
}

export interface WeaponDef {
  id: WeaponId;
  label: string;
  /** Which hand the main piece mounts to. */
  hand: "right" | "left";
  /** Drives the skill VFX + behaviour. */
  kind: SkillKind;
  skillName: string;
  /** Seconds the skill animation/effect runs. */
  skillDuration: number;
  /** Cooldown in seconds. */
  cooldown: number;
  /**
   * Per-weapon melee tuning, expressed as a DEVIATION from the weapon's category
   * hold-style default (see `arsenal/holdStyle.ts`). Only the fields that differ
   * from the category standard need be declared; the rest are inherited. A weapon
   * that fights exactly to category standard declares no `combat` at all.
   */
  combat?: Partial<WeaponCombat>;
  /**
   * Per-weapon melee hit volume (blade-edge capsule in the local mount frame),
   * used by the swept-edge collision system. When omitted, a sensible default is
   * derived from the weapon's group + model length. Tunable + persisted via the
   * weapon overrides, so every melee weapon has a game-ready collider.
   */
  hit?: WeaponHitShape;
  /** Animation set / weapon class this weapon switches the rig to. */
  animSet: WeaponAnimSet;
  /** Real GLB model loadout. When set, replaces the procedural primitive. */
  model?: WeaponModel;
  /** Roster family (grouping + duel selection). */
  group?: WeaponGroup;
  /** Named tier variants carried purely as data. */
  tiers?: WeaponTier[];
  /**
   * Hand-mount grip transform, co-located with the prefab so a weapon is a
   * single self-contained module (model + grip + clip set + skill + VFX kind).
   */
  grip?: WeaponGripDef;
  /** When true, AI melee duels may select this weapon. */
  duelEligible?: boolean;
  /**
   * Optional complete skill kit (F + keys 1–4). When set, Studio prefers these
   * labels/kinds over character `signatureSkills` for HUD + fire. Fill one weapon
   * at a time — only `mace2h` ships a kit today so other weapons stay unchanged.
   */
  skillKit?: import("./arsenal/weaponSkillKits").WeaponSkillKit;
  /**
   * Explicit AI combat role override. The sparring brain reads this to decide how
   * a fighter plays the weapon (kite + shoot, mid-range hurl, or melee combo).
   * When omitted, the role is inferred from `group` (`ranged` group → ranged,
   * else melee). Set `"thrown"` on a weapon whose group is melee but whose AI
   * game is a mid-range projectile (e.g. the javelin).
   */
  combatRole?: "ranged" | "thrown";
  /** Elemental school for magic staffs — drives the cast projectile + status + tint. */
  element?: StaffElement;
}

/**
 * A deployable gadget a character can drop in battle: a persistent autonomous
 * entity (built on the ability lifecycle's deploy phase, like the turret) that
 * stands for a lifetime and fires a repeating, self-re-targeting effect.
 * - `snareField` — a zone that re-pulses a movement slow + chip damage on every
 *   enemy standing in it (the support/control counterpart to the turret).
 * - `bearTrap` — owner-only-visible one-shot snare: 2 m trigger, stuns enemies
 *   that walk into it (Bear Trap.glb).
 */
export type GadgetKind = "snareField" | "bearTrap";

export interface CharacterDef {
  id: string;
  name: string;
  /** Path relative to BASE_URL (no leading slash). */
  file: string;
  /** Uniform scale applied so the rig is ~1.8m tall. */
  scale: number;
  /**
   * Optional mesh color multiply (hex) for palette variants of one GLB
   * (e.g. Ikkaku Madarame crimson / azure / void).
   */
  meshTint?: number;
  /** Map of logical role -> exact clip name embedded in the GLB. */
  clips: Partial<Record<AnimRole, string>>;
  /** Extra signature skill clips, keyed by a label shown in the UI. */
  signatureSkills: {
    label: string;
    clip: string;
    kind: SkillKind;
    /** "dash" turns the skill into a forward lunge with blur + endpoint AoE. */
    mode?: "default" | "dash";
  }[];
  /**
   * When set, the F-skill casts this VFX skill kind directly (no weapon swing)
   * instead of the weapon's default skill. Lets a caster bind a 5th spell that
   * has no signature slot to the F key (e.g. the Archmage's Deploy Turret).
   */
  fskillKind?: SkillKind;
  /**
   * When set, the F-skill deploys this gadget (a persistent autonomous entity)
   * at the caster's feet instead of the weapon's default skill — e.g. the LED
   * Monk's snare field. Takes precedence over {@link fskillKind} / the weapon
   * F-skill, but an assigned slot override still wins (mirrors fskillKind).
   */
  gadget?: GadgetKind;
  /** Regex used to locate the weapon-mount hand bones. */
  handBone: string;
  /** When true the character never mounts a weapon (a pure martial artist). */
  weaponless?: boolean;
  /**
   * When true the character already carries a baked-in weapon mesh (e.g. Hippolin
   * Guard's 2H maul). Studio skips library weapon mount so we don't double-equip,
   * but {@link defaultWeapon} still drives combat stats, combo animSet, and skills.
   */
  bakedWeapon?: boolean;
  /**
   * Special melee style. "kick": every attack is a foot strike that lunges in
   * toward the aimed target along an eased spline and springs back like a ninja,
   * driven by the real attack/skill clip (joint motion) plus our impact VFX.
   */
  meleeStyle?: "kick";
  /**
   * Yaw (radians) applied to the model mesh so its art-forward points away from
   * the camera (+Z). Separate from the root's movement-facing rotation. Most
   * rigs need PI to face away rather than toward the camera.
   */
  modelYaw?: number;
  /** When true the character is the procedural Explorer rig, not a GLB. */
  procedural?: boolean;
  /**
   * Optional overrides for the unified animation retargeting pipeline: map a
   * quirky bone name on THIS rig's skeleton to a canonical Mixamo suffix when the
   * auto-derivation (`canonicalSuffix`) can't infer it. Keyed by the exact target
   * bone name. Most rigs (incl. Racalvin) need none.
   */
  retargetAliases?: Record<string, CanonicalSuffix>;
  /**
   * Optional appearance overrides for the procedural Explorer rig (skin/shirt/
   * pants colours, head accessory, cape). Lets a catalog entry be a styled
   * variant of the Explorer — e.g. a baked LED-mask + hooded + caped look.
   * Ignored by GLB characters.
   */
  look?: Partial<CharacterLook>;
  /** Weapon auto-equipped when this character spawns (procedural rigs). */
  defaultWeapon?: WeaponId;
  /**
   * Direction assistance for attacks (0-100): how strongly a strike/lunge
   * auto-acquires and steers toward a nearby target. 0 = none (pure camera aim,
   * narrow cone); 100 = wide acquisition cone and near-full snap onto the target.
   * Defaults to 50 when unset.
   */
  directionAssist?: number;
  /**
   * Dash rating for attacks (0-100): how far a strike lunges. 50 = nominal reach
   * (the editor's Dash Distance); 100 = double; lower = a shorter, snappier step.
   * Defaults to 50 when unset.
   */
  dashRating?: number;
  /**
   * Data-driven fire-kick profile (Striker "Sealeg"). Present only on kick-style
   * martial artists; drives the 3-hit LMB combo + the four signature skills.
   */
  kick?: StrikerCombat;
  /**
   * Extra FBX motion clips injected into the rig after the GLB commits, keyed by a
   * synthetic clip name (e.g. `striker:flip_kick`). Loaded by `loadKickClips(id)`
   * for kick-style fighters so each martial artist can pull in its own motions
   * (the reserved `flip_kick.fbx` is Tera-kasi's combo opener). `file` is a path
   * under the artifact base URL. Falls back to the Striker set when unset.
   */
  kickClips?: { name: string; file: string }[];
  /**
   * Pistol "Kiter" primary-fire profile. Present on the Gunslinger; when set and
   * the pistol is equipped the LMB primary becomes the proximity-adaptive
   * shoot-and-backstep / MMA-kick kit instead of the generic melee combo.
   */
  kiter?: KiterKit;
  /**
   * Arcane Staff "Soulbinder" caster profile. When set and the staff is equipped,
   * the four signature slots become the bespoke soul/void kit (Studio.doArcaneSig)
   * instead of the generic signature spells.
   */
  arcane?: ArcaneKit;
  /**
   * Gunblade "Tank" (Centurion) profile. When set and the gunblade is equipped,
   * the four signature slots become the bespoke shield/cannon kit (Studio.doTankSig)
   * and the tank's slower-movement + damage-mitigation stats apply.
   */
  tank?: TankKit;
  /**
   * Opt-in: emit combat skill VFX (slash arcs + the GLB spells fireDragon /
   * meteor / turret / darkBlades / swordVolley) from the swinging hand's collider
   * pose — its world position AND 3D angle — instead of the body's flat yaw, so
   * authored skills look the same in live combat as in the Dressing Room Skill
   * Lab (mirrors that lab's `slashFromCollider` gate). Off/unset → unchanged flat
   * behavior. Homing spells still curve toward their target; only the launch
   * origin + angle move to the hand.
   */
  colliderVfx?: boolean;
  /**
   * Weapon loadout (Heroes of Grudge): the ordered list of library weapons this
   * character can carry. When 2+ entries are present the Danger Room "Q" key
   * cycles through them (swapping the mounted model + animation set). The first
   * entry is auto-equipped on spawn. Unset/short lists leave "Q" as its default
   * (parry) action.
   */
  loadout?: WeaponId[];
  /**
   * Off-hand piece auto-equipped on spawn (e.g. a Knight's "shield"). Only shown
   * while the main weapon is {@link offHandEligible}; re-applied after each Q swap.
   */
  offHand?: WeaponId;
  /**
   * Regex (case-insensitive) matched against node names in the GLB; matched nodes
   * are hidden on load. Used to suppress a rig's *baked* weapon/shield/quiver
   * meshes so the mounted library weapon is the only one visible.
   */
  hideNodes?: string;
}

/**
 * XZ push-out collision circle for the flat Danger Room path.
 * - `top` (world Y): landable upper surface — stand/walk on it; lateral push-out
 *   is skipped while feet are at/above the top.
 * - `bottom` (world Y): underside of a floating platform — skip lateral push when
 *   feet are below the volume so the capsule can walk under platforms.
 * Omitted top ⇒ infinite cylinder (live combatants, tall columns).
 */
export interface ObstacleCircle {
  x: number;
  z: number;
  r: number;
  top?: number;
  /** Lower Y of the solid volume (platforms that leave walkable space underneath). */
  bottom?: number;
}

/**
 * The polymorphic surface the Studio/Controller drive a character through.
 * Implemented by both the GLB `Character` (role/clip-name based) and the
 * procedural `ExplorerCharacter` (Animator intent based).
 */
export interface Avatar {
  root: THREE.Group;
  rightHand: THREE.Object3D | null;
  leftHand: THREE.Object3D | null;
  def: CharacterDef;
  load(): Promise<void>;
  update(dt: number): void;
  dispose(): void;
  setBlendTime(t: number): void;
  setShowSkeleton(show: boolean): void;
  setModelYaw(rad: number): void;
  hasRole(role: AnimRole): boolean;
  hasClip(name: string): boolean;
  clipNames(): string[];
  currentClipName(): string;
  playRole(role: AnimRole, fade?: number): void;
  playRoleOnce(role: AnimRole, fade?: number): number;
  playClipOnce(name: string, fade?: number): number;
  setLocomotionRate(rate: number): void;
  readonly isOneShotActive: boolean;
  /**
   * GLB `Character` only: push a continuous 0..1 movement intensity to the
   * weight-blended locomotion layer (idle/walk/run eased by speed). When present
   * it replaces the discrete {@link playRole}/{@link setLocomotionRate} loco path.
   */
  setLocomotion?(speed: number): void;
  /**
   * GLB `Character` only: direction-aware locomotion. `moveX` (right+/left−) and
   * `moveZ` (forward+/back−) are in the character's own facing frame; when the rig
   * ships strafe/back clips the eased speed-blend routes through the dominant
   * stride, otherwise it degrades to the forward {@link setLocomotion} blend.
   */
  setLocomotionDirectional?(moveX: number, moveZ: number, speed: number): void;
  /**
   * GLB `Character` only: play a clip as an upper-body additive overlay so a
   * swing layers over locomotion (a moving attack) without freezing the legs.
   * Returns the rate-adjusted duration, or 0 when unavailable. Does not set the
   * one-shot flag.
   */
  playClipOverlay?(name: string, intensity: number): number;
  /**
   * GLB `Character` only: register a snippet — a fraction-based slice of a parent
   * native clip — as a new playable action. Returns false when the parent isn't
   * loaded. The snippet then plays via {@link playClipOnce}.
   */
  registerSnippet?(spec: SnippetSpec): boolean;
  /** Procedural rig only: swap the equipped weapon class (clip set + mesh). */
  setWeaponId?(weaponId: WeaponId): void;
  /** Procedural rig only: play a directional dodge-roll clip (F/B/L/R). */
  rollDir?(dir: "F" | "B" | "L" | "R"): number;
  /**
   * Ground-truth touchdown notification from the controller. Rigs that hold a
   * looped airborne pose (the procedural Explorer) clear it and play the land
   * recovery here — the controller knows the real support height (elevated prop
   * tops, dungeon floors), so rigs must NOT infer landing from `root.position.y`
   * alone. Optional: GLB rigs (self-ending jump one-shots) may omit it.
   */
  notifyLanded?(): void;
  /**
   * Procedural rig only: play a defensive reaction clip by key (stumble /
   * stunned / fallDown / fallen / getUp / kipUp / wallCrash) with blend control.
   * GLB rigs omit this and fall back to the generic `hurt` role.
   */
  reaction?(key: string, fade?: number, hold?: boolean): number;
  /** Procedural rig only: swap locomotion clip set (ground vs. swim traversal). */
  setTraversalMode?(mode: "ground" | "swim"): void;
  /**
   * Procedural rig only: play the equipped weapon's category ready / guard pose
   * (and any draw flourish) on stance entry, blending back to idle. GLB rigs omit
   * this and keep their own idle.
   */
  readyPose?(weaponId: WeaponId): number;
  /**
   * Skinned rigs (`Character` / `GrudgeAvatar`) only: toggle the post-mixer
   * foot-to-ground IK pass. Off by default; the host enables it on uneven terrain
   * (e.g. dungeon mode) and supplies a sampler via {@link setGroundSampler}.
   * Procedural rigs omit this and no-op.
   */
  setFootIk?(enabled: boolean): void;
  /**
   * Skinned rigs only: supply the ground sampler the foot-IK pass plants onto.
   * Procedural rigs omit this.
   */
  setGroundSampler?(fn: GroundSampler): void;
}

export interface HudSnapshot {
  character: string;
  /**
   * Portrait-cache key for the player's own rendered face thumbnail (the
   * user's avatar). Null while the rig is still loading — the player frame
   * then falls back to the weapon icon.
   */
  playerPortraitKey: string | null;
  weapon: WeaponId;
  weaponLabel: string;
  skillName: string;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  /** Current poise (from the sparring CombatController). */
  poise: number;
  maxPoise: number;
  /**
   * Active combat state string (idle / parry / block / dodge / stagger /
   * stunned / fallen / getUp / dead).  Shown as a chip in the vitals panel.
   */
  combatState: string;
  /** Seconds remaining in the open crit window (> 0 = flash in HUD). */
  critWindow: number;
  /** Brief event label flashed center-screen (PERFECT PARRY!, SHIELD BREAK!, etc.) */
  combatFlash: string;
  /** Focused enemy (nearest live training dummy) combat state for the right-side panel. */
  enemyHealth: number;
  enemyMaxHealth: number;
  enemyStamina: number;
  enemyMaxStamina: number;
  enemyPoise: number;
  enemyMaxPoise: number;
  enemyCritWindow: number;
  enemyCombatState: string;
  skillReady: boolean;
  skillCooldown: number;
  skillCooldownMax: number;
  skyfallCooldown: number;
  skyfallCooldownMax: number;
  /**
   * Per-signature-skill cooldowns (parallel to sig1..sig4 slots). When the
   * active character uses per-skill cooldowns (e.g. the Striker), each slot
   * has its own timer; otherwise all are 0 (the shared `skillCooldown` applies).
   */
  sigCooldowns: number[];
  sigCooldownMaxes: number[];
  /** True while the Striker's Hover skill is keeping the player airborne. */
  hovering: boolean;
  locked: boolean;
  /** True while the first-person camera is active (KeyB toggles it). */
  firstPerson: boolean;
  /** Crosshair spread in px (grows with movement + recoil bloom). */
  aimSpread: number;
  /**
   * Where the focused enemy sits relative to the player's Optimal Weapon Range:
   * "optimal" (green ring) = in the sweet spot, "close" (red) = inside the inner
   * edge (crowded), "far" (yellow) = past the outer edge, "none" = no enemy near.
   */
  owrRange: "close" | "optimal" | "far" | "none";
  /** Monotonic confirmed-hit counter; a change flashes the hit-marker. */
  hitMarker: number;
  grounded: boolean;
  jumpsLeft: number;
  speed: number;
  fps: number;
  /** Number of sparring opponents currently standing. */
  targetsAlive: number;
  /** Active sparring difficulty (drives the opponents' AI). */
  difficulty: Difficulty;
  /** True while the player is holding block (RMB). */
  blocking: boolean;
  /** Counts down briefly after the player takes a hit (drives a hurt vignette). */
  hurt: number;
  /** True while the player is downed and waiting to respawn. */
  defeated: boolean;
  /**
   * The Tab-locked enemy's on-screen health frame (head projected to pixels), or
   * null when nothing is selected / the target died.
   */
  selectedTarget: {
    /** Stable unique enemy id — names can repeat across dummies (weapon labels)
     *  so the status frame keys its tween/ghost state off this. */
    id: number;
    x: number;
    y: number;
    health: number;
    maxHealth: number;
    name: string;
    /**
     * Cache key into the rendered target-portrait store (per enemy type), or
     * null when no portrait subject exists — the frame then shows the initial
     * letter fallback.
     */
    portraitKey: string | null;
  } | null;
  /**
   * The Shift+Tab-selected ally's on-screen health frame (head projected to
   * pixels), or null when no ally is selected / it died. Rendered in green.
   */
  selectedAllyTarget: {
    x: number;
    y: number;
    health: number;
    maxHealth: number;
    name: string;
  } | null;
  /**
   * Current dungeon zone the player occupies, derived from player-Y vs the
   * water band (same check that drives swim mode): above the water = surface,
   * inside the water band = underwater, below it = the sealed pit. Null when not
   * in the dungeon (no zone cue shown).
   */
  zone: "surface" | "underwater" | "pit" | null;
  /**
   * The locked boss-tier hostile (e.g. "Moloch Da God") for the distinct boss
   * health bar, or null when no boss is the selected hostile.
   */
  boss: { name: string; health: number; maxHealth: number; hint: string } | null;
  /** Name of the animation clip currently playing on the character. */
  clip: string;
  /** Resolved action-slot bindings (primary / F / 1-4) for the HUD. */
  slots: SlotBinding[];
  /** Active status effects for the buff/debuff notifier. */
  statuses: StatusView[];
  /** Contextual interaction prompt (e.g. "Hit E to Enter"), or null. */
  prompt: string | null;
  /** True while the player is inside the dungeon level. */
  inDungeon: boolean;
  /**
   * Exo-Armour mech ability bar — present only while the player is sealed inside
   * the mech (piloted phase). Each entry has its own live cooldown so the HUD can
   * sweep them independently of the on-foot skill bar. Null when on foot.
   */
  mech?: {
    abilities: { key: string; name: string; icon: string; cd: number; cdMax: number }[];
  } | null;
  /** Active AI-vs-AI duel snapshot (round/score/weapon/winner), or null. */
  duel?: DuelState | null;
  /** A.L.E. Bot state (cameras / highlights / diagnostics / report), or null. */
  ale?: AleSnapshot | null;
}

export interface EditorParams {
  moveSpeed: number;
  sprintMultiplier: number;
  jumpHeight: number;
  gravity: number;
  cameraDistance: number;
  cameraHeight: number;
  mouseSensitivity: number;
  fov: number;
  turnResponsiveness: number;
  blendTime: number;
  showSkeleton: boolean;
  /** Extra yaw (radians) added on top of the character's base facing offset. */
  modelYaw: number;
  /** Invert vertical mouse-look. */
  invertY: boolean;
  /** Distance (m) a dash signature lunges forward. */
  dashDistance: number;
  /** Radius (m) of AoE blasts (dash endpoint + skyfall impacts). */
  aoeRadius: number;
  /** Knockback strength applied to targets by skills. */
  skillForce: number;
  /** Number of spline bolts rained by the Skyfall special. */
  skyfallBolts: number;
  /**
   * Attack steer/auto-aim strength (0..1.5). Scales how strongly a melee strike
   * homes onto the aimed target on top of the weapon/character profile: 0 = pure
   * camera aim (no homing), 1 = the profile's nominal steer, > 1 = stronger snap.
   */
  attackSteer: number;
}

/**
 * Canonical fighter height in world metres (the studio runs at 1 unit = 1 m).
 * The whole studio is scaled around a ~2 m (≈6 ft 7) fighter: rig loaders
 * normalise every model to this height, and AI engagement distances are derived
 * from it (see `SPACING_SCALE` / `SPELL_RANGE` in Targets.ts) so spacing
 * "discovers" from real body size instead of frozen magic numbers. Bump this and
 * the character + the whole engagement envelope grow together.
 */
/** Human-scale height in metres (textures/anims authored for ~1.8–2 m fighters). */
export const CHARACTER_HEIGHT_M = 1.8;

export const DEFAULT_EDITOR: EditorParams = {
  moveSpeed: 4.2,
  sprintMultiplier: 1.9,
  jumpHeight: 2.2,
  gravity: 22,
  cameraDistance: 5.2,
  cameraHeight: 1.7,
  mouseSensitivity: 1,
  fov: 60,
  turnResponsiveness: 12,
  blendTime: 0.22,
  showSkeleton: false,
  modelYaw: 0,
  invertY: false,
  dashDistance: 6,
  aoeRadius: 4,
  skillForce: 12,
  skyfallBolts: 6,
  attackSteer: 1,
};
