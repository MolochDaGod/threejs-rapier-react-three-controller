import * as THREE from "three";
import type {
  AttackPayload,
  CombatController,
  CombatStateName,
  DefensiveResult,
  DodgeDir,
} from "@workspace/epicfight";
import { getCharacter, getWeapon, weaponCombat } from "./assets";
import { defenseClips, fightBand, guardedHitClip } from "./arsenal/holdStyle";
import type { BladeDefender } from "./combat/BladeCollisionSystem";
import { ExplorerCharacter } from "./ExplorerCharacter";
import { DummyModels, type DummyInstance, type DummyKind } from "./DummyModels";
import { PORTRAIT_OMIT_NAME } from "./targetPortraits";
import { aoeFalloff, aoeVictims, classifyEngagement, meleeStrike, preferSelectedHostile, strikeForceLevel, weaponOWR } from "./combat";
import {
  activeWeakPoint,
  advanceWeakPoint,
  bossPhaseFromState,
  weakPointHint,
  weakPointLocalHeight,
  weakPointMod,
  type BossPhase,
  type WeakPoint,
} from "./boss/weakPoints";
import { BEAR_ATTACKS, nextBearAttack, telegraphBlink, type BearAttack } from "./bear/bearAttacks";
import type { IndicatorItem } from "./fx/Indicators";
import {
  type FighterArchetype,
  fighterConfig,
  isDefended,
  makeFighterCC,
  outcomeForceScale,
} from "./combatModel";
import type { Difficulty, DifficultyProfile, Faction, FighterView, SkillKind, WeaponCombat, WeaponId } from "./types";
import { CHARACTER_HEIGHT_M } from "./types";
import type { NpcState } from "@workspace/danger-net";
import { createFighterBrain, type FighterActions, type FighterAgent, type FighterBias, type FighterPerception } from "./ai/FighterBrain";
import { fighterWeaponProfile, type WeaponCombatRole } from "./ai/weaponRole";
import type { Think } from "./ai/Think";
import {
  CORPSE_TO_SKELETON_S,
  SKELETON_LINGER_S,
  createSkeletonCorpse,
  preloadSkeletonCorpses,
} from "./corpse/SkeletonCorpse";

/** Per-frame world snapshot the brain's action hooks read (refreshed in updateAi). */
interface FighterFrame {
  /** Unit horizontal direction from the fighter toward its target. */
  dir: THREE.Vector3;
  /** Horizontal distance to the target (m). */
  dist: number;
  /** The fighter's equipped weapon reach/intensity profile. */
  combat: WeaponCombat;
  /** Active sparring context (damage routing + telegraph/VFX hooks). */
  ctx: SparringContext | null;
  /** The current hostile target (position + optional NPC dummy). */
  target: { pos: THREE.Vector3; dummy: Dummy | null } | null;
}

/**
 * Sparring opponents for the Danger Room. A self-contained, disposable system: it
 * owns a ring of simple humanoid fighters that approach the player, telegraph and
 * land weapon strikes, defend (block/parry/dodge) against incoming hits, take
 * damage (flash + force-driven knockback + topple), fall when defeated and respawn
 * after a beat.
 *
 * Combat is unified on `@workspace/epicfight`: EVERY fighter owns one
 * {@link CombatController} (see {@link makeFighterCC}) and ALL damage/defense
 * resolves through `cc.applyAttack(payload)`. The player damages opponents through
 * `playerHit` / `blast` / `launch` (each routed into the target CCs); opponents
 * damage the player through the `SparringContext.dealToPlayer` callback (the
 * Studio resolves it against the player CC) — so a duel uses ONE consistent,
 * engine-owned combat model with no parallel damage maths.
 */
export interface TargetHandle {
  /** Live world position of the target's chest (knockback origin). */
  readonly position: THREE.Vector3;
  /** Smoothed planar (XZ) velocity (m/s), for predictive aim / lead. */
  readonly velocity: THREE.Vector3;
  readonly alive: boolean;
}

/** Per-difficulty AI tuning (passive has no profile — it disables the AI). */
export const DIFFICULTY_PROFILES: Record<Exclude<Difficulty, "passive">, DifficultyProfile> = {
  easy: { windup: 1.05, approachSpeed: 1.7, attackInterval: 2.6, skillChance: 0.1, damageScale: 0.6, aggression: 0.7, caution: 0.5 },
  medium: { windup: 0.68, approachSpeed: 2.7, attackInterval: 1.7, skillChance: 0.22, damageScale: 1.0, aggression: 1.0, caution: 1.0 },
  hard: { windup: 0.42, approachSpeed: 3.7, attackInterval: 1.05, skillChance: 0.4, damageScale: 1.5, aggression: 1.35, caution: 1.4 },
};

/** Melee weapons opponents can spar with (ranged weapons stay player-only). */
const OPPONENT_WEAPONS: WeaponId[] = ["sword", "greatsword", "axe", "spear", "hammer", "dagger", "staff", "shield", "rifle", "hunter-rifle", "bow", "javelin"];

/**
 * The aimed projectile spells AI fighters can cast at the player. Mirrors the
 * player's aimed-spell set minus `turret` (a stationary deploy, not a homing
 * projectile, so it doesn't fit the "fire a dodgeable shot at the player" flow).
 */
const SPELL_KINDS: SkillKind[] = ["fireDragon", "meteor", "darkBlades", "swordVolley", "soul", "laser"];

/**
 * World scale relative to the legacy 1.8 m baseline these spacing knobs were
 * tuned at. With the canonical fighter now {@link CHARACTER_HEIGHT_M} (2 m), the
 * engagement envelope "discovers" from real body size: bump the canonical
 * height and engage padding / lunge band / poke range all grow with it.
 */
const SPACING_SCALE = CHARACTER_HEIGHT_M / 1.8;

/**
 * Max distance (m) at which an AI fighter will commit a ranged spell cast.
 * Derived from body size (~10 fighter-heights of stand-off) instead of a frozen
 * magic number, so the ranged poke range opens up with a larger fighter.
 */
const SPELL_RANGE = Math.round(CHARACTER_HEIGHT_M * 10);

/**
 * Predictive aim: ranged casts lead a moving target by `CAST_LEAD_TIME` seconds
 * of its estimated velocity (so a strafing player gets tracked), but the lead is
 * capped to `CAST_LEAD_FRACTION` of the shot distance so a hard juke still
 * dodges it — reach, not aimbot. The dash gap-closer leads by
 * `GAPCLOSE_LEAD_TIME` so it lands in range against a target that's moving.
 */
const CAST_LEAD_TIME = 0.28;
const CAST_LEAD_FRACTION = 0.5;
const GAPCLOSE_LEAD_TIME = 0.3;

/** Charge-up time (s) the aura tell plays before the spell projectile fires. */
const CAST_CHARGE = 0.55;

/** Charge-up time (s) the aura tell plays before a deployed turret drops. */
const DEPLOY_CHARGE = 0.6;

/**
 * AI deployable-turret tuning. A deployed turret stands for `TURRET_LIFE` seconds
 * and, every `TURRET_VOLLEY_GAP`, fires a burst of `TURRET_VOLLEY` slow, oversized
 * bolts at its current hostile (the player for an enemy turret) `TURRET_BOLT_GAP`
 * apart. Each bolt resolves a small dodgeable AoE at its landing point through the
 * faction-aware combat path. Damage scales with difficulty + per-fighter mul.
 */
const TURRET_LIFE = 6.0;
const TURRET_VOLLEY = 3;
const TURRET_VOLLEY_GAP = 1.4;
const TURRET_BOLT_GAP = 0.16;
const TURRET_SHOT_DAMAGE = 8;
const TURRET_BOLT_RADIUS = 1.0;
const TURRET_COLOR = 0x8fd0ff;

/** SkillKind → accent colour, mirrors the Studio palette (kept local to stay self-contained). */
const KIND_COLOR: Record<SkillKind, number> = {
  slash: 0x9fe8ff,
  slam: 0xffb24d,
  bolt: 0x6fd6ff,
  nova: 0xb98cff,
  muzzle: 0xfff2a8,
  thrust: 0xff6f6f,
  fireDragon: 0xff6a1e,
  meteor: 0xff8a3d,
  turret: 0x8fd0ff,
  darkBlades: 0xb070ff,
  swordVolley: 0xa8e6ff,
  soul: 0x8fffe0,
  laser: 0xff5a3c,
};

/** Hooks the Studio passes each frame so opponents can hit the player + fire VFX. */
export interface SparringContext {
  /** Player chest-height world position. */
  playerPos: THREE.Vector3;
  /** False while the player is downed/invulnerable (opponents hold off). */
  playerAlive: boolean;
  /**
   * True while the player is in offense-fail recovery — their last swing was
   * blocked/parried/dodged so they're locked out for a beat. A free punish
   * window the AI should press into.
   */
  playerRecovering?: boolean;
  /**
   * Resolve an opponent strike against the player. The Studio runs the payload
   * through the player CombatController and returns the {@link DefensiveResult}
   * (or null when the player was out of the strike area) so the attacker can
   * react to a parry/dodge-punish. Signature kept positional for the dungeon.
   */
  dealToPlayer: (
    center: THREE.Vector3,
    radius: number,
    damage: number,
    force: number,
    from: THREE.Vector3,
    kind: SkillKind,
    isSkill: boolean,
  ) => DefensiveResult | null;
  /** An opponent began winding up an attack (telegraph VFX). */
  onWindup?: (pos: THREE.Vector3, kind: SkillKind) => void;
  /**
   * An opponent began charging a ranged spell. Unlike the generic melee
   * {@link onWindup} burst this spins up the same spell-kind-coloured cast aura
   * the player's own casts use, so an incoming spell reads distinctly. Held for
   * the {@link CAST_CHARGE} window before the projectile fires.
   */
  onCastCharge?: (pos: THREE.Vector3, kind: SkillKind) => void;
  /** An opponent's strike landed at `center` (impact VFX). */
  onStrike?: (center: THREE.Vector3, kind: SkillKind, radius: number, isSkill: boolean) => void;
  /**
   * The heavy bear committed (`"swing"`) or landed (`"land"`) one of its three
   * named attacks — play the matching per-attack audio/VFX cue. `"swing"` fires
   * the wind-up whoosh as the body motion starts; `"land"` fires the impact cue
   * at the hit point (heavier — a thud + ground shock — for the slam than for
   * the single-target swipe/maul). Routed through the host so it owns the
   * audio/VFX systems.
   */
  onBearAttack?: (at: THREE.Vector3, attack: BearAttack, moment: "swing" | "land") => void;
  /** An opponent defended (blocked/parried/dodged) a player hit. */
  onDefend?: (pos: THREE.Vector3, dodged: boolean) => void;
  /**
   * Cast one of the aimed projectile spells at the player: play the spell's
   * aura/projectile/impact VFX from `from` homing onto `target`, and invoke
   * `onImpact` at the projectile's landing point so the caster can resolve
   * damage there (radius-aware, so a player who moved off the aim point dodges
   * it). When absent, AI fighters fall back to melee skills only.
   */
  castSpell?: (
    kind: SkillKind,
    from: THREE.Vector3,
    target: THREE.Vector3,
    onImpact: (center: THREE.Vector3) => void,
  ) => void;
  /**
   * Deploy a standing turret hazard: play its chassis VFX at `at` facing
   * `faceDir`, lasting `life` seconds. Returns a disposer the host calls to
   * remove the chassis early (caster death / scene clear). When absent, AI
   * fighters never deploy turrets.
   */
  deployTurret?: (
    at: THREE.Vector3,
    faceDir: THREE.Vector3,
    color: number,
    life: number,
  ) => (() => void) | void;
  /**
   * Fire one turret bolt: play a slow oversized projectile from `from` along
   * `dir` for `dist`, invoking `onLand` at its landing point so the host can
   * resolve a small faction-aware AoE there (a target that moved off the line
   * dodges it). Paired with {@link deployTurret}.
   */
  turretBolt?: (
    from: THREE.Vector3,
    dir: THREE.Vector3,
    dist: number,
    color: number,
    onLand: (center: THREE.Vector3) => void,
  ) => void;
  /**
   * Telegraph an incoming AoE: draw a warning circle at `center`/`radius` that
   * blinks yellow then turns solid red, and invoke `onResolve` when the hit
   * lands (0.5s after it turns red). When absent, callers resolve immediately.
   */
  telegraph?: (center: THREE.Vector3, radius: number, onResolve: () => void) => void;
}

/**
 * The combat-target surface the Studio drives. Both the Danger Room `Targets`
 * and the dungeon's `DungeonEnemies` implement it, so on entering the dungeon
 * the Studio can swap `this.targets` to the dungeon population and every
 * player-combat call site (blast/raycast/nearest/lock-on/...) keeps working
 * unchanged.
 */
export interface CombatTargets {
  group: THREE.Group;
  onDeath: ((pos: THREE.Vector3) => void) | null;
  /** Fired for the focused enemy after a player hit resolves (impact VFX). */
  onPlayerHit: ((result: DefensiveResult, pos: THREE.Vector3) => void) | null;
  /** Fired when an enemy CC enters a reaction state (stagger/stunned/fallen). */
  onEnemyState: ((pos: THREE.Vector3, state: CombatStateName) => void) | null;
  readonly aliveCount: number;
  /** Register the player's CombatController (so player hits can be parried). */
  setPlayerCC(cc: CombatController | null): void;
  cycleSelection(): void;
  /** Clear the hostile (red) selection / soft-lock highlight. Optional. */
  clearSelection?(): void;
  /** Rotate the GREEN ally selection (Shift+Tab). Optional: dungeon has no allies. */
  cycleAllySelection?(): void;
  selectedView(): {
    /** Stable unique id of the locked enemy — names can repeat (weapon labels /
     *  shared profiles), so the HUD keys tween state off this instead. */
    id: number;
    head: THREE.Vector3;
    health: number;
    maxHealth: number;
    name: string;
    /** True when the locked hostile is a boss-tier enemy (drives the boss bar). */
    isBoss?: boolean;
    /** Contextual coaching line for the boss bar (weak-point hint), if a boss. */
    bossHint?: string;
  } | null;
  /**
   * The locked hostile's portrait subject for the HUD status frame: a stable
   * per-enemy-type cache key plus the live visual root the portrait renderer
   * clones. Null when nothing is locked (the HUD falls back to the initial
   * letter). Optional.
   */
  selectedPortrait?(): { key: string; object: THREE.Object3D } | null;
  /** The selected ally's on-screen health frame (green), or null. Optional. */
  selectedAllyView?(): { head: THREE.Vector3; health: number; maxHealth: number; name: string } | null;
  /** Object to anchor a friendly cast's aura on (the green ally), or null. Optional. */
  selectedAllyGroup?(): THREE.Object3D | null;
  /** Groups of every living ally within a radius (anchors for a friendly AOE cast). Optional. */
  alliesInRadius?(center: THREE.Vector3, radius: number): THREE.Object3D[];
  /** Object to anchor an offensive cast's aura on (the red hostile), or null. Optional. */
  selectedHostileGroup?(): THREE.Object3D | null;
  /** Torso point of the selected hostile, so offensive abilities can prefer it. Optional. */
  selectedHostilePoint?(): THREE.Vector3 | null;
  /** Per-frame ground-disc descriptors for the target indicators. Optional. */
  indicatorSnapshot?(playerPos?: THREE.Vector3): IndicatorItem[];
  /** Head point of the locked hostile, for the overhead red dot. Optional. */
  selectedHostileHead?(): THREE.Vector3 | null;
  /** Live combat readout for the locked/nearest enemy, for the HUD (or null). */
  focusedCombatView(from: THREE.Vector3): EnemyCombatView | null;
  lockPoint(): THREE.Vector3 | null;
  acquireNearest(from: THREE.Vector3): THREE.Vector3 | null;
  setDifficulty(d: Difficulty): void;
  getDifficulty(): Difficulty;
  setCount(count: number): void;
  spawn(weaponId: WeaponId, faction: Faction): void;
  /** Spawn a fighter at an exact position (Danger Room only; dungeon enemies
   *  place via their own level data and don't implement this). */
  spawnAt?(
    pos: THREE.Vector3,
    weaponId: WeaponId,
    faction: Faction,
    opts?: {
      scale?: number;
      maxHealth?: number;
      damageMul?: number;
      arch?: FighterArchetype;
      avatar?: boolean;
      reactionDelay?: number;
      /** Mount a passive training-dummy GLB visual instead of the primitive body. */
      dummyModel?: DummyKind;
    },
  ): void;
  clear(): void;
  factionCounts(): { enemy: number; ally: number };
  nearest(from: THREE.Vector3, count: number): TargetHandle[];
  raycast(ray: THREE.Ray, maxDist: number, softCos: number): TargetHandle | null;
  stagger(handle: TargetHandle, seconds?: number): void;
  stun(center: THREE.Vector3, radius: number, seconds?: number): number;
  shieldBreak(center: THREE.Vector3, radius: number, seconds?: number): number;
  slowArea(center: THREE.Vector3, radius: number, mul: number, seconds: number): number;
  /**
   * Forced guard-breaking stagger against the nearest enemy in range (e.g. the
   * Utility Kick). Returns the struck enemy's chest position (for impact VFX),
   * or null when nothing was in reach.
   */
  kickStagger(center: THREE.Vector3, radius: number, force: number, seconds?: number, from?: THREE.Vector3): THREE.Vector3 | null;
  /**
   * Torso point of the nearest knocked-down (fallen) ENEMY within `radius` of
   * `from`, or null when none is downed in range. Powers the Stomp finisher,
   * which only lands on a prone foe.
   */
  nearestDownedPoint(from: THREE.Vector3, radius: number): THREE.Vector3 | null;
  blast(center: THREE.Vector3, radius: number, damage: number, force: number, ctx?: SparringContext): number;
  /**
   * Player attack against the focused enemy (resolved through its CC), with
   * lighter AoE splash to others in range. Returns the focused result (or null
   * when nothing was in reach — then it falls back to a plain blast).
   */
  playerHit(
    center: THREE.Vector3,
    radius: number,
    payload: AttackPayload,
    physForce: number,
    ctx?: SparringContext,
  ): DefensiveResult | null;
  launch(center: THREE.Vector3, radius: number, damage: number, upVel: number): number;
  /**
   * World-space blade-collision volumes (body / raised shield / mid-swing weapon)
   * for every living ENEMY, oriented toward `playerPos`, for the swept-edge blade
   * system. Optional — only the primary Targets impl provides it.
   */
  bladeDefenders?(playerPos: THREE.Vector3): BladeDefender[];
  /** Force a short physical guard on an enemy by id (blade met its shield). */
  forceGuard?(id: number, seconds: number): void;
  /**
   * Shove living hostiles near `origin` away from `awayFrom` by ~`distance`
   * metres (block bounce). Optional stun reaction during the bounce.
   */
  shoveAway?(
    origin: THREE.Vector3,
    awayFrom: THREE.Vector3,
    distance: number,
    stun?: boolean,
  ): void;
  reactAt(nearPos: THREE.Vector3, reaction: "stagger" | "stunned" | "fallen"): void;
  /** Host-authoritative NPC roster for coop broadcast. */
  netSnapshot(): NpcState[];
  /** Apply a peer-forwarded hit against a host-owned NPC by id. */
  applyNetHit(id: string, amount: number, ctx?: SparringContext): void;
  update(dt: number, ctx?: SparringContext): void;
  dispose(): void;
}

/** Live combat readout for the locked/nearest enemy, for the HUD. */
export interface EnemyCombatView {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  poise: number;
  maxPoise: number;
  critWindow: number;
  state: CombatStateName;
}

/** AI attack-pacing phase (the defensive/hitstun state lives in the CC). */
type AiState = "idle" | "approach" | "windup" | "recover";

interface Dummy {
  id: number;
  group: THREE.Group;
  /** Lazily-built red outline shell shown while this dummy is the locked target. */
  outline?: THREE.Group;
  home: THREE.Vector3;
  vel: THREE.Vector3;
  /** Smoothed finite-difference planar velocity, for predictive lead by the player. */
  velEstimate: THREE.Vector3;
  /** Last frame's planar position, the basis for the {@link velEstimate} difference. */
  lastSeenPos: THREE.Vector3;
  /** Lean applied while reeling, eased back to 0 at rest. */
  tilt: THREE.Vector3;
  /** The single combat authority for this fighter (health/poise/stamina/defense). */
  cc: CombatController;
  arch: FighterArchetype;
  maxHealth: number;
  maxStamina: number;
  maxPoise: number;
  /** Last observed CC state, for one-shot reaction VFX on transition. */
  lastState: CombatStateName;
  /** Force of the most recent landed hit, so a heavy stagger reads as a big body blow. */
  lastHitForce: number;
  /**
   * Clean knock-up launch phase. `rising` while airborne and ascending,
   * `falling` after the apex; cleared on landing (which forces the fallen
   * knock-out). `undefined` when grounded / not launched.
   */
  launchPhase?: "rising" | "falling";
  flash: number;
  flashColor: THREE.Color;
  dead: boolean;
  respawn: number;
  /** Flesh replaced by Skeletons_Free residual after 2 min dead. */
  isSkeleton: boolean;
  skeletonRoot: THREE.Object3D | null;
  yaw: number;
  body: THREE.Mesh;
  head: THREE.Mesh;
  accent: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  /** Per-dummy materials to free on rebuild/dispose (excludes the shared base). */
  ownMats: THREE.Material[];
  // ---- AI ----
  weaponId: WeaponId;
  faction: Faction;
  kind: SkillKind;
  state: AiState;
  stateT: number;
  attackCd: number;
  /**
   * Post-swing recovery window (seconds; 0 = inactive). A durable punish-window
   * flag: unlike `state === "recover"` (which movement actions overwrite within
   * a frame) this ticks down independently, so opponents reliably read the
   * vulnerable beat right after this fighter commits a strike.
   */
  recoverT: number;
  defendCd: number;
  /** Seconds left holding a proactively-raised CC block. */
  blockHold: number;
  /**
   * Countdown after a block-bounce shove; when it hits 0 the brain may stylish-
   * flip recover (AI "Space" equivalent) and re-open for skill-1 style offense.
   */
  blockFlipT: number;
  pendingSkill: boolean;
  // ---- Ranged spell-cast pacing (the new aimed-projectile spells) ----
  /** Seconds until this fighter can cast another ranged spell (0 = ready). */
  spellCd: number;
  /** Charge-up countdown for an in-progress cast (the aura tell). */
  castT: number;
  /** The spell kind staged for the active cast (null = no cast in flight). */
  pendingCastKind: SkillKind | null;
  // ---- Weapon-derived combat profile (set once at spawn from the equipped weapon) ----
  /** How this fighter plays its weapon: melee combo / ranged kite / mid-range hurl. */
  combatRole: WeaponCombatRole;
  /** Max distance (m) this fighter commits a ranged shot / throw / spell. */
  spellRange: number;
  /** Hard cap on this fighter's melee combo length (1 for ranged/thrown). */
  comboMax: number;
  /** The projectile this fighter looses when casting (null → host picks a melee spell). */
  castKind: SkillKind | null;
  /** Multiplier on the base ranged-cast cooldown (ranged recasts fast). */
  castCdScale: number;
  // ---- Deployable turret pacing (a standing hazard, not a one-shot cast) ----
  /** Seconds until this fighter can deploy another turret (0 = ready). */
  turretCd: number;
  /** Charge-up countdown for an in-progress turret deploy (0 = none in flight). */
  deployT: number;
  // ---- Crowd-control status (seconds remaining; 0 = inactive) ----
  /** Frozen + can't react while > 0 (player utility-skill stun, orthogonal to CC). */
  stunT: number;
  /** Can't block/parry/dodge while > 0 (player utility-skill shield-break). */
  shieldBreakT: number;
  /** Movement slowed while > 0 (bow slash debuff). Approach speed × `slowMul`. */
  slowT: number;
  /** Approach-speed multiplier applied while `slowT > 0` (1 = no slow). */
  slowMul: number;
  /** Outgoing-damage multiplier (difficulty tier scaling; 1 = baseline). */
  damageMul: number;
  // ---- Optional AI-driven Explorer rig (duel fighters render a real character) ----
  /** Last seen target position + smoothed planar velocity, for predictive aim. */
  aimPrevTarget?: THREE.Vector3;
  aimTargetVel?: THREE.Vector3;
  /** Identity of the tracked target (dummy id, or -1 = player); resets the
   *  velocity estimate on a target swap so it can't spike from a teleport jump. */
  aimTargetId?: number;
  /** A real procedural Explorer rig replacing the primitive body (duel mode). */
  avatar?: ExplorerCharacter | null;
  /** True once the avatar's async clips have loaded and it's mounted + visible. */
  avatarReady?: boolean;
  // ---- Passive training-dummy GLB visual (replaces the primitive capsule) ----
  /** A static/idling dummy model standing in for the primitive body (passive). */
  model?: DummyInstance | null;
  /** The dummy model kind requested (latched so an async load can be cancelled). */
  modelKind?: DummyKind;
  /** True once the dummy GLB has loaded and is mounted + visible. */
  modelReady?: boolean;
  /** Latches the death clip so it only fires once per death. */
  deathPlayed?: boolean;
  // ---- Goal-driven brain (decision layer) ----
  /** Activation latency (s) the brain waits before committing (0 = legacy instant). */
  reactionDelay: number;
  /** This fighter's goal-driven sparring brain (built in {@link makeDummy}). */
  brain?: Think<FighterAgent>;
  /** The brain's owner adapter (live perception + action hooks into the engine). */
  agent?: FighterAgent;
  /** Mutable perception snapshot the host refreshes before each brain tick. */
  perception?: FighterPerception;
  /** Per-frame world snapshot the brain's action hooks read. */
  frame?: FighterFrame;
  /** The defensive move staged for the current defend goal. */
  pendingDefense?: "parry" | "dodge" | "block";
  /** Lateral dodge direction staged with a pending dodge. */
  pendingDodgeDir?: DodgeDir;
  // ---- Weak-point boss runtime (arch "boss" only) ----
  /** Boss tab-targeting state: which weak point is currently selected + its marker. */
  boss?: {
    /** Index into the active phase's exposed weak points (Tab cycles it). */
    weakIndex: number;
    /** A small sphere that floats over the selected weak point while locked. */
    marker: THREE.Mesh;
    markerGeo: THREE.SphereGeometry;
    markerMat: THREE.MeshBasicMaterial;
  };
  // ---- Heavy melee bear runtime (modelKind "bear" only) ----
  /** Index of the bear's last-thrown attack (rotates through the 3-attack kit). */
  bearAttackIndex?: number;
  /** The bear attack pre-picked at wind-up, applied when the strike resolves. */
  pendingBearAttack?: BearAttack;
  /** Full wind-up duration (s) captured at begin, so a telegraph can blink over it. */
  windupTotal?: number;
}

/**
 * A live AI-deployed turret hazard. Owned by {@link Targets} (which ticks its
 * life + volleys + faction-aware damage); the standing chassis VFX is owned by
 * the host and removed early via {@link ActiveTurret.dispose} on caster death.
 */
interface ActiveTurret {
  /** Id of the fighter that deployed it (cleaned up when it dies / despawns). */
  ownerId: number;
  /** The deployer's faction — drives who its bolts can damage. */
  faction: Faction;
  /** Muzzle world position the bolts fire from. */
  muzzle: THREE.Vector3;
  /** Accent colour for the bolt/muzzle VFX. */
  color: number;
  /** Per-bolt damage (captured at deploy, difficulty + per-fighter scaled). */
  damage: number;
  /** Attack force level the bolts resolve with (light/dodgeable). */
  force: 1 | 2 | 4;
  /** Seconds it has stood so far. */
  age: number;
  /** Total seconds it stands before despawning. */
  life: number;
  /** Countdown to the next volley. */
  volleyT: number;
  /** Bolts still queued to fire in the current volley. */
  pending: number;
  /** Countdown between individual bolts within a volley. */
  boltT: number;
  /** Removes the standing chassis VFX early (caster death / despawn). */
  dispose: () => void;
}

/** Default crowd-control durations (also used to time the matching VFX). */
export const STUN_SECONDS = 1.6;
export const SHIELD_BREAK_SECONDS = 4;

/** Radius of a dummy's chest hit sphere, used by the crosshair raycast. */
const CHEST_RADIUS = 0.95;

/** Hard cap on simultaneous spawned NPCs (both factions) to bound the sim. */
const MAX_DUMMIES = 16;

/** Body tint per faction so allies (green) and enemies (red) read at a glance. */
const FACTION_BODY: Record<Faction, number> = { enemy: 0x6b2f3a, ally: 0x2f6b4a };
const COLOR_HEAD = 0x9fb6ff;
const FLASH_COLOR = new THREE.Color(0xff5a6a);
const WINDUP_COLOR = new THREE.Color(0xffb24d);
const DEFEND_COLOR = new THREE.Color(0x6fe0ff);
const PARRY_COLOR = new THREE.Color(0xffffff);
const REST_EMISSIVE = new THREE.Color(0x16203a);
// Crowd-control glows (match the Kiter VFX: yellow stars / blue shatter ring).
const STUN_COLOR = new THREE.Color(0xffe24a);
const SHIELD_BREAK_COLOR = new THREE.Color(0x9fd8ff);

/**
 * CC states in which the AI is interrupted: hitstun (stagger/stunned/fallen/
 * getUp/dead — a parry or dodge-punish lands the attacker in `stagger`) or a
 * committed defensive move (mid-dodge / mid-parry). `block` is handled separately
 * so the dummy can drop its guard.
 */
function isBusyState(s: CombatStateName): boolean {
  return (
    s === "stagger" ||
    s === "stunned" ||
    s === "fallen" ||
    s === "getUp" ||
    s === "dodge" ||
    s === "parry" ||
    s === "dead"
  );
}

export class Targets implements CombatTargets {
  group = new THREE.Group();
  private scene: THREE.Scene;
  private dummies: Dummy[] = [];
  /** Live AI-deployed turret hazards (lifecycle + firing ticked in update). */
  private turrets: ActiveTurret[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private bodyGeo: THREE.CapsuleGeometry;
  private headGeo: THREE.SphereGeometry;
  private baseGeo: THREE.CylinderGeometry;
  private accentGeo: THREE.BoxGeometry;
  private baseMat: THREE.MeshStandardMaterial;
  private radius: number;
  private difficulty: Difficulty = "medium";
  /** When false, dead dummies stay down (a duel round ends on a death). */
  private autoRespawn = true;
  /** Half-extent the dummies are clamped to (X/Z). Relaxed for played maps. */
  private bounds = 14;
  /** Wall-clock accumulator driving status-glow pulses. */
  private clock = 0;
  /** Monotonic id source for stable Tab target selection. */
  private nextId = 1;
  /** Currently locked-on hostile id (Tab selection), or null. */
  private selectedId: number | null = null;
  /** Currently selected ally id (Shift+Tab selection), or null. */
  private allySelectedId: number | null = null;
  /** Shared red BackSide material for the hostile selection outline shell. */
  private outlineMat: THREE.MeshBasicMaterial;
  /** Shared green BackSide material for the ally selection outline shell. */
  private allyOutlineMat: THREE.MeshBasicMaterial;
  /** The player's CombatController, so player hits can punish a parried player. */
  private playerCC: CombatController | null = null;
  /** Shared loader/cache for the passive training-dummy GLB visuals. */
  private dummyModels = new DummyModels();

  /** Called when a target's health first reaches zero (for VFX hooks). */
  onDeath: ((pos: THREE.Vector3) => void) | null = null;
  /** Called for the focused enemy after a player hit resolves (drive impact VFX). */
  onPlayerHit: ((result: DefensiveResult, pos: THREE.Vector3) => void) | null = null;
  /** Called when an enemy CC enters a reaction state (stagger/stunned/fallen). */
  onEnemyState: ((pos: THREE.Vector3, state: CombatStateName) => void) | null = null;

  constructor(scene: THREE.Scene, count = 0, radius = 8) {
    this.scene = scene;
    this.radius = radius;
    this.bodyGeo = new THREE.CapsuleGeometry(0.42, 1.0, 6, 12);
    this.headGeo = new THREE.SphereGeometry(0.3, 16, 12);
    this.baseGeo = new THREE.CylinderGeometry(0.6, 0.7, 0.18, 20);
    this.accentGeo = new THREE.BoxGeometry(0.12, 0.95, 0.12);
    this.geos.push(this.bodyGeo, this.headGeo, this.baseGeo, this.accentGeo);

    this.baseMat = new THREE.MeshStandardMaterial({ color: 0x10182c, roughness: 0.8, metalness: 0.3 });
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, side: THREE.BackSide });
    this.allyOutlineMat = new THREE.MeshBasicMaterial({ color: 0x37e070, side: THREE.BackSide });

    this.build(count);
    scene.add(this.group);
    preloadSkeletonCorpses();
  }

  /** Register the player's CombatController (so player hits can be parried). */
  setPlayerCC(cc: CombatController | null): void {
    this.playerCC = cc;
  }

  /** (Re)build the opponent ring with `count` fighters. */
  private build(count: number) {
    for (const d of this.dummies) {
      this.group.remove(d.group);
      this.disposeAvatar(d);
      this.disposeModel(d);
      for (const m of d.ownMats) m.dispose();
      this.disposeBoss(d);
    }
    this.dummies.length = 0;
    const n = Math.max(0, Math.min(8, Math.round(count)));
    for (let i = 0; i < n; i++) {
      const ang = (i / Math.max(1, n)) * Math.PI * 2;
      const home = new THREE.Vector3(Math.cos(ang) * this.radius, 0, Math.sin(ang) * this.radius);
      const d = this.makeDummy(home, OPPONENT_WEAPONS[i % OPPONENT_WEAPONS.length], "enemy");
      this.dummies.push(d);
      this.group.add(d.group);
    }
  }

  private makeDummy(
    home: THREE.Vector3,
    weaponId: WeaponId,
    faction: Faction,
    arch: FighterArchetype = "grunt",
    maxHealth?: number,
  ): Dummy {
    const group = new THREE.Group();
    group.position.copy(home);

    const mat = new THREE.MeshStandardMaterial({
      color: FACTION_BODY[faction],
      roughness: 0.5,
      metalness: 0.4,
      emissive: REST_EMISSIVE.clone(),
      emissiveIntensity: 1,
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: COLOR_HEAD,
      roughness: 0.4,
      metalness: 0.3,
      emissive: REST_EMISSIVE.clone(),
      emissiveIntensity: 1,
    });
    const kind = getWeapon(weaponId).kind;
    const profile = fighterWeaponProfile(weaponId);
    const accentColor = KIND_COLOR[kind] ?? 0x9fe8ff;
    const accentMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.3,
      metalness: 0.5,
      emissive: new THREE.Color(accentColor),
      emissiveIntensity: 0.6,
    });

    const base = new THREE.Mesh(this.baseGeo, this.baseMat);
    base.position.y = 0.09;
    base.receiveShadow = true;

    const body = new THREE.Mesh(this.bodyGeo, mat);
    body.position.y = 1.1;
    body.castShadow = true;

    const head = new THREE.Mesh(this.headGeo, headMat);
    head.position.y = 1.95;
    head.castShadow = true;

    // A small weapon-coloured bar held to one side, facing forward (+Z local).
    const accent = new THREE.Mesh(this.accentGeo, accentMat);
    accent.position.set(0.5, 1.2, 0.35);
    accent.rotation.x = -0.5;
    accent.castShadow = true;

    group.add(base, body, head, accent);

    const cfg = fighterConfig(arch, maxHealth ? { maxHealth } : {});
    const cc = makeFighterCC(arch, {}, maxHealth ? { maxHealth } : {});
    const d: Dummy = {
      id: this.nextId++,
      group,
      home: home.clone(),
      vel: new THREE.Vector3(),
      velEstimate: new THREE.Vector3(),
      lastSeenPos: home.clone(),
      tilt: new THREE.Vector3(),
      cc,
      arch,
      maxHealth: cfg.maxHealth,
      maxStamina: cfg.maxStamina,
      maxPoise: cfg.maxPoise,
      lastState: "idle",
      lastHitForce: 0,
      flash: 0,
      flashColor: FLASH_COLOR.clone(),
      dead: false,
      respawn: 0,
      isSkeleton: false,
      skeletonRoot: null,
      yaw: 0,
      body,
      head,
      accent,
      mat,
      ownMats: [mat, headMat, accentMat],
      weaponId,
      faction,
      kind,
      state: "idle",
      stateT: 0,
      attackCd: 0.6 + Math.random() * 1.2,
      recoverT: 0,
      defendCd: 0,
      blockHold: 0,
      blockFlipT: 0 as number,
      pendingSkill: false,
      // Stagger initial spell readiness so a fresh ring doesn't all cast at once.
      // Ranged/thrown fighters scale this down so shooting is their primary game.
      spellCd: (3 + Math.random() * 4) * profile.castCdScale,
      castT: 0,
      pendingCastKind: null,
      combatRole: profile.role,
      spellRange: profile.spellRange,
      comboMax: profile.comboMax,
      castKind: profile.castKind,
      castCdScale: profile.castCdScale,
      // Stagger initial turret readiness (longer than spells — it's an occasional play).
      turretCd: 8 + Math.random() * 8,
      deployT: 0,
      stunT: 0,
      shieldBreakT: 0,
      slowT: 0,
      slowMul: 1,
      damageMul: 1,
      avatar: null,
      avatarReady: false,
      deathPlayed: false,
      reactionDelay: 0,
    };
    this.equipBrain(d);
    return d;
  }

  /**
   * Replace a dummy's primitive placeholder body with a real procedural Explorer
   * rig (used by the duel mode so the AI fighters render as full characters). The
   * rig loads asynchronously; the primitive meshes stay visible until it mounts,
   * and the load is guarded so a clear/dispose mid-load can't leak a stray rig.
   */
  private attachAvatar(d: Dummy, weaponId: WeaponId): void {
    const avatar = new ExplorerCharacter(getCharacter("explorer"));
    d.avatar = avatar;
    avatar.setWeaponId(weaponId);
    void avatar.load().then(() => {
      // The dummy was cleared/disposed (or re-attached) while the rig loaded.
      if (d.avatar !== avatar) {
        avatar.dispose();
        return;
      }
      avatar.equipProceduralWeapon(weaponId);
      // The rig is the visible body now — hide the primitive placeholder meshes.
      d.body.visible = false;
      d.head.visible = false;
      d.accent.visible = false;
      d.group.add(avatar.root);
      d.avatarReady = true;
    });
  }

  /** Dispose + detach a dummy's Explorer rig (if any). Safe to call repeatedly. */
  private disposeAvatar(d: Dummy): void {
    if (!d.avatar) return;
    const a = d.avatar;
    d.avatar = null;
    d.avatarReady = false;
    a.root.parent?.remove(a.root);
    a.dispose();
  }

  /**
   * Replace a passive dummy's primitive capsule with a real GLB training-dummy
   * (or ogre/bear) model. Mirrors {@link attachAvatar}: the model loads
   * asynchronously, the primitive body/head/accent stay visible until it mounts,
   * and the load is guarded so a clear/dispose (or kind swap) mid-load can't leak
   * a stray model. The base disc is kept as a small stand under the dummy. The
   * math-based chest hit volume is unchanged, so hiding the meshes never breaks
   * hit registration.
   */
  private attachDummyModel(d: Dummy, kind: DummyKind): void {
    d.modelKind = kind;
    this.dummyModels
      .ensure(kind)
      .then((tpl) => {
        // The dummy was cleared/disposed (or re-requested) while it loaded.
        if (!tpl || d.modelKind !== kind) return;
        const inst = this.dummyModels.create(kind);
        if (!inst) return;
        d.body.visible = false;
        d.head.visible = false;
        d.accent.visible = false;
        d.group.add(inst.root);
        d.model = inst;
        d.modelReady = true;
      })
      .catch(() => {
        // Asset failed to load: leave the primitive body visible as a fallback.
      });
  }

  /** Dispose + detach a dummy's GLB model (if any). Safe to call repeatedly. */
  private disposeModel(d: Dummy): void {
    d.modelKind = undefined;
    d.modelReady = false;
    if (!d.model) return;
    const m = d.model;
    d.model = null;
    m.dispose();
  }

  /** Free a boss's weak-point marker geo/material (if any). Safe to repeat. */
  private disposeBoss(d: Dummy): void {
    if (!d.boss) return;
    d.boss.marker.parent?.remove(d.boss.marker);
    d.boss.markerGeo.dispose();
    d.boss.markerMat.dispose();
    d.boss = undefined;
  }

  get aliveCount(): number {
    let n = 0;
    for (const d of this.dummies) if (!d.dead && d.faction === "enemy") n++;
    return n;
  }

  /**
   * Tab lock-on: advance the selection to the next living enemy (wraps). Clears
   * the selection when no enemies stand.
   */
  cycleSelection(): void {
    const live = this.dummies.filter((d) => !d.dead && d.faction === "enemy");
    if (live.length === 0) {
      this.setSelected(null);
      return;
    }
    // Boss weak-point cycling: while the boss is already locked, Tab steps
    // through its exposed weak points (knees → ... → head/chest) first; only once
    // the cycle wraps past the last point does selection move on to the next foe.
    const cur = live.find((d) => d.id === this.selectedId);
    if (cur?.boss) {
      const phase = bossPhaseFromState(cur.cc.getState());
      const adv = advanceWeakPoint(phase, cur.boss.weakIndex);
      cur.boss.weakIndex = adv.index;
      if (!adv.wrapped) return;
    }
    const idx = live.findIndex((d) => d.id === this.selectedId);
    const next = live[(idx + 1) % live.length];
    this.setSelected(next.id);
  }

  /** Clear the hostile (red) selection / soft-lock highlight (Alt+Tab). */
  clearSelection(): void {
    this.setSelected(null);
  }

  /**
   * The locked-on enemy's head world position + health for the HUD frame, or
   * null when nothing is selected / the target died (auto-clears in that case).
   */
  selectedView(): {
    id: number;
    head: THREE.Vector3;
    health: number;
    maxHealth: number;
    name: string;
    isBoss?: boolean;
    bossHint?: string;
  } | null {
    if (this.selectedId == null) return null;
    const d = this.dummies.find((x) => x.id === this.selectedId);
    if (!d || d.dead) {
      this.setSelected(null);
      return null;
    }
    return {
      id: d.id,
      head: new THREE.Vector3(d.group.position.x, d.group.position.y + 2.25, d.group.position.z),
      health: d.cc.getHealth(),
      maxHealth: d.maxHealth,
      name: d.boss ? this.bossLabel(d) : getWeapon(d.weaponId).label,
      isBoss: d.arch === "boss",
      bossHint: d.boss ? weakPointHint(bossPhaseFromState(d.cc.getState())) : undefined,
    };
  }

  /**
   * Portrait subject for the locked hostile: prefer the mounted GLB dummy model,
   * then the real Explorer avatar rig, falling back to the primitive fighter
   * body. Keys are stable per enemy *type* so each look renders at most once.
   */
  selectedPortrait(): { key: string; object: THREE.Object3D } | null {
    if (this.selectedId == null) return null;
    const d = this.dummies.find((x) => x.id === this.selectedId);
    if (!d || d.dead) return null;
    if (d.modelReady && d.model && d.modelKind) {
      return { key: `dummy:${d.modelKind}`, object: d.model.root };
    }
    if (d.avatarReady && d.avatar) {
      return { key: `avatar:${d.weaponId}`, object: d.avatar.root };
    }
    return { key: `fighter:${d.faction}:${d.weaponId}`, object: d.group };
  }

  /** Boss bar label: "Yellow Bot · <PHASE> · <WEAK POINT>". */
  private bossLabel(d: Dummy): string {
    const phase = bossPhaseFromState(d.cc.getState());
    const wp = activeWeakPoint(phase, d.boss?.weakIndex ?? 0);
    return `Yellow Bot · ${phase.toUpperCase()} · ${wp.toUpperCase()}`;
  }

  /**
   * Full combat readout for the locked enemy (or, when nothing is locked, the
   * nearest living enemy to `from`) for the HUD. Null when no enemy stands.
   */
  focusedCombatView(from: THREE.Vector3): EnemyCombatView | null {
    let d = this.selectedId != null ? this.dummies.find((x) => x.id === this.selectedId && !x.dead) : undefined;
    if (!d) {
      let best: Dummy | null = null;
      let bestD = Infinity;
      for (const o of this.dummies) {
        if (o.dead || o.faction !== "enemy") continue;
        const dd = o.group.position.distanceToSquared(from);
        if (dd < bestD) {
          bestD = dd;
          best = o;
        }
      }
      d = best ?? undefined;
    }
    if (!d) return null;
    return {
      health: d.cc.getHealth(),
      maxHealth: d.maxHealth,
      stamina: d.cc.getStamina(),
      maxStamina: d.maxStamina,
      poise: d.cc.getPoise(),
      maxPoise: d.maxPoise,
      critWindow: d.cc.getCritWindowRemaining(),
      state: d.cc.getState(),
    };
  }

  /** Torso world point of the locked enemy for the lock-on camera, or null. */
  lockPoint(): THREE.Vector3 | null {
    if (this.selectedId == null) return null;
    const d = this.dummies.find((x) => x.id === this.selectedId);
    if (!d || d.dead) return null;
    return this.chest(d);
  }

  /**
   * Engage lock-on: keep the current selection if it's a living enemy, else
   * select the nearest living enemy to `from`. Returns its torso point (or null).
   */
  acquireNearest(from: THREE.Vector3): THREE.Vector3 | null {
    let d = this.dummies.find(
      (x) => x.id === this.selectedId && !x.dead && x.faction === "enemy",
    );
    if (!d) {
      let best: Dummy | null = null;
      let bestD = Infinity;
      for (const o of this.dummies) {
        if (o.dead || o.faction !== "enemy") continue;
        const dd = o.group.position.distanceToSquared(from);
        if (dd < bestD) {
          bestD = dd;
          best = o;
        }
      }
      if (!best) return null;
      this.setSelected(best.id);
      d = best;
    }
    return this.chest(d);
  }

  /** Move the red outline shell to `id` (or hide it when null). */
  private setSelected(id: number | null): void {
    if (this.selectedId === id) return;
    const old = this.dummies.find((d) => d.id === this.selectedId);
    if (old?.outline) old.outline.visible = false;
    this.selectedId = id;
    if (id == null) return;
    const d = this.dummies.find((x) => x.id === id);
    if (d && !d.dead) this.ensureOutline(d).visible = true;
  }

  /**
   * Rotate the GREEN ally selection to the next living ally (wraps), clearing it
   * when no allies stand. Independent of the hostile (Tab) selection — both can
   * be active at once so friendly casts and offensive casts each have a target.
   */
  cycleAllySelection(): void {
    const live = this.dummies.filter((d) => !d.dead && d.faction === "ally");
    if (live.length === 0) {
      this.setAllySelected(null);
      return;
    }
    const idx = live.findIndex((d) => d.id === this.allySelectedId);
    const next = live[(idx + 1) % live.length];
    this.setAllySelected(next.id);
  }

  /** Move the green ally outline shell to `id` (or hide it when null). */
  private setAllySelected(id: number | null): void {
    if (this.allySelectedId === id) return;
    const old = this.dummies.find((d) => d.id === this.allySelectedId);
    if (old?.outline) old.outline.visible = false;
    this.allySelectedId = id;
    if (id == null) return;
    const d = this.dummies.find((x) => x.id === id);
    if (d && !d.dead) this.ensureOutline(d).visible = true;
  }

  /** The selected ally's head frame + health for the HUD (green), or null. */
  selectedAllyView(): { head: THREE.Vector3; health: number; maxHealth: number; name: string } | null {
    if (this.allySelectedId == null) return null;
    const d = this.dummies.find((x) => x.id === this.allySelectedId);
    if (!d || d.dead) {
      this.setAllySelected(null);
      return null;
    }
    return {
      head: new THREE.Vector3(d.group.position.x, d.group.position.y + 2.25, d.group.position.z),
      health: d.cc.getHealth(),
      maxHealth: d.maxHealth,
      name: getWeapon(d.weaponId).label,
    };
  }

  /** The selected ally's group (to anchor a friendly cast's aura), or null. */
  selectedAllyGroup(): THREE.Object3D | null {
    if (this.allySelectedId == null) return null;
    const d = this.dummies.find((x) => x.id === this.allySelectedId && !x.dead);
    return d ? d.group : null;
  }

  /** The locked hostile's group (to anchor an offensive cast's aura), or null. */
  selectedHostileGroup(): THREE.Object3D | null {
    if (this.selectedId == null) return null;
    const d = this.dummies.find((x) => x.id === this.selectedId && !x.dead);
    return d ? d.group : null;
  }

  /**
   * Torso point of the Tab-selected hostile (live enemy), or null. Lets a player
   * offensive ability acquire the red target before falling back to cone/nearest.
   */
  selectedHostilePoint(): THREE.Vector3 | null {
    if (this.selectedId == null) return null;
    const d = this.dummies.find((x) => x.id === this.selectedId && !x.dead && x.faction === "enemy");
    return d ? this.chest(d) : null;
  }

  /**
   * Torso point of the nearest knocked-down (fallen) ENEMY within `radius` of
   * `from`, or null. The Stomp finisher uses this to gate on (and aim at) a
   * prone foe — it should connect with nothing standing.
   */
  nearestDownedPoint(from: THREE.Vector3, radius: number): THREE.Vector3 | null {
    let best: Dummy | null = null;
    let bestDist = radius * radius;
    for (const d of this.dummies) {
      if (d.dead || d.faction !== "enemy") continue;
      if (d.cc.getState() !== "fallen") continue;
      const dd = d.group.position.distanceToSquared(from);
      if (dd <= bestDist) {
        bestDist = dd;
        best = d;
      }
    }
    return best ? this.chest(best) : null;
  }

  /**
   * Per-frame ground-disc descriptors: every living combatant gets a disc whose
   * colour reads its relationship + selection at a glance — Red = primary hostile
   * (Tab), Yellow = other hostiles, Green = selected ally (Shift+Tab), Blue =
   * other friendly/neutral.
   */
  indicatorSnapshot(playerPos?: THREE.Vector3): IndicatorItem[] {
    const out: IndicatorItem[] = [];
    for (const d of this.dummies) {
      if (d.dead) continue;
      let color: IndicatorItem["color"];
      let threat: number | undefined;
      if (d.faction === "enemy") {
        // Locked target OR an enemy actively winding up an attack reads RED; any
        // other hostile reads YELLOW scaled by how much of a threat it poses.
        if (d.id === this.selectedId || this.isAttacking(d)) {
          color = "red";
        } else {
          color = "yellow";
          threat = this.threatOf(d, playerPos);
        }
      } else {
        color = d.id === this.allySelectedId ? "green" : "blue";
      }
      out.push({ x: d.group.position.x, z: d.group.position.z, y: d.group.position.y, color, threat });
    }
    return out;
  }

  /** True while this enemy is telegraphing/committing an attack at the player. */
  private isAttacking(d: Dummy): boolean {
    return d.faction === "enemy" && d.state === "windup";
  }

  /**
   * 0..1 danger this enemy poses to the player, blending proximity, the
   * difficulty tier's aggression, and the AI's posture (winding up > approaching
   * > idle). Wounded/staggered fighters read as less threatening.
   */
  private threatOf(d: Dummy, playerPos?: THREE.Vector3): number {
    let prox = 0.5;
    if (playerPos) {
      const dx = d.group.position.x - playerPos.x;
      const dz = d.group.position.z - playerPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      prox = THREE.MathUtils.clamp(1 - dist / 14, 0, 1);
    }
    const profile = this.difficulty !== "passive" ? DIFFICULTY_PROFILES[this.difficulty] : null;
    const aggro = profile ? THREE.MathUtils.clamp(profile.skillChance + 0.3, 0, 1) : 0.1;
    const posture = d.state === "windup" ? 1 : d.state === "approach" ? 0.6 : 0.2;
    const busy = isBusyState(d.cc.getState()) ? 0.4 : 1;
    return THREE.MathUtils.clamp((0.45 * prox + 0.2 * aggro + 0.35 * posture) * busy, 0, 1);
  }

  /** Head world point of the locked hostile, for the overhead marker, or null. */
  selectedHostileHead(): THREE.Vector3 | null {
    if (this.selectedId == null) return null;
    const d = this.dummies.find((x) => x.id === this.selectedId && !x.dead && x.faction === "enemy");
    if (!d) return null;
    return new THREE.Vector3(d.group.position.x, d.group.position.y + 2.3, d.group.position.z);
  }

  /**
   * Lazily build (and cache) a slightly-inflated BackSide shell on a dummy —
   * red for hostiles, green for allies (chosen by faction so the cached shell
   * always matches its selection colour).
   */
  private ensureOutline(d: Dummy): THREE.Group {
    if (d.outline) return d.outline;
    const mat = d.faction === "ally" ? this.allyOutlineMat : this.outlineMat;
    const g = new THREE.Group();
    // Named so the portrait capture can prune the shell from its clone.
    g.name = PORTRAIT_OMIT_NAME;
    for (const part of [d.body, d.head]) {
      const m = new THREE.Mesh(part.geometry, mat);
      m.position.copy(part.position);
      m.rotation.copy(part.rotation);
      m.scale.copy(part.scale).multiplyScalar(1.09);
      g.add(m);
    }
    g.visible = false;
    d.group.add(g);
    d.outline = g;
    return g;
  }

  /** Switch the sparring difficulty (passive = inert training dummies). */
  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    // Reset AI state so a switch reads cleanly.
    for (const dm of this.dummies) {
      dm.state = "idle";
      dm.stateT = 0;
      dm.attackCd = 0.4 + Math.random() * 1.0;
      dm.brain?.reset();
    }
  }

  getDifficulty(): Difficulty {
    return this.difficulty;
  }

  /** Resize the opponent ring (1-8 fighters). */
  setCount(count: number) {
    this.build(count);
    this.setDifficulty(this.difficulty);
  }

  /**
   * Spawn one additional NPC of `faction` wielding `weaponId`, without disturbing
   * the existing population (additive). Capped at MAX_DUMMIES total.
   */
  spawn(weaponId: WeaponId, faction: Faction): void {
    if (this.dummies.length >= MAX_DUMMIES) return;
    const i = this.dummies.filter((d) => d.faction === faction).length;
    const side = faction === "ally" ? -1 : 1;
    const x = side * (4 + (i % 2) * 1.8) + (Math.random() - 0.5);
    const z = -2 - Math.floor(i / 2) * 1.8 + (Math.random() - 0.5);
    const home = new THREE.Vector3(THREE.MathUtils.clamp(x, -12, 12), 0, THREE.MathUtils.clamp(z, -12, 12));
    const d = this.makeDummy(home, weaponId, faction);
    // Admin-spawned NPCs (both passive training dummies and active enemies) render
    // as real procedural Explorer rigs, not primitive capsules — so they show full
    // locomotion/attack/dodge/death animations like the duel fighters.
    this.attachAvatar(d, weaponId);
    this.dummies.push(d);
    this.group.add(d.group);
    this.setDifficulty(this.difficulty);
  }

  /**
   * Relax (or tighten) the X/Z clamp the dummies are held within. Played voxel
   * maps span a larger grid than the default Danger Room, so the arena widens it.
   */
  setBounds(half: number): void {
    this.bounds = Math.max(1, half);
  }

  /**
   * Spawn one NPC at an exact world position (no cluster placement), wielding
   * `weaponId` for `faction`, optionally an elite/boss archetype or scaled.
   * Used to drop authored map combatants + bosses into the live population.
   */
  spawnAt(
    pos: THREE.Vector3,
    weaponId: WeaponId,
    faction: Faction,
    opts?: {
      scale?: number;
      maxHealth?: number;
      damageMul?: number;
      arch?: FighterArchetype;
      avatar?: boolean;
      reactionDelay?: number;
      /** Mount a passive training-dummy GLB visual instead of the primitive body. */
      dummyModel?: DummyKind;
    },
  ): void {
    if (this.dummies.length >= MAX_DUMMIES) return;
    const home = new THREE.Vector3(pos.x, Math.max(0, pos.y), pos.z);
    const arch = opts?.arch ?? "grunt";
    const d = this.makeDummy(home, weaponId, faction, arch, opts?.maxHealth);
    if (opts?.scale && opts.scale > 0) d.group.scale.setScalar(opts.scale);
    d.damageMul = opts?.damageMul ?? 1;
    d.reactionDelay = opts?.reactionDelay ?? 0;
    if (opts?.avatar) this.attachAvatar(d, weaponId);
    else if (opts?.dummyModel) this.attachDummyModel(d, opts.dummyModel);
    // Weak-point boss: build the tab-targeting state + a floating marker sphere
    // (hidden until this boss is the locked target). It rides over the active
    // weak point's local height, recoloured per phase in the update loop.
    if (arch === "boss") {
      const markerGeo = new THREE.SphereGeometry(0.16, 12, 12);
      const markerMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9 });
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.visible = false;
      d.group.add(marker);
      d.boss = { weakIndex: 0, marker, markerGeo, markerMat };
    }
    // Heavy melee bear: prime its 3-attack rotation cursor.
    if (opts?.dummyModel === "bear") d.bearAttackIndex = -1;
    this.dummies.push(d);
    this.group.add(d.group);
    this.setDifficulty(this.difficulty);
  }

  /** Remove every spawned NPC (both factions) and free their materials. */
  clear(): void {
    for (const t of this.turrets) t.dispose();
    this.turrets.length = 0;
    for (const d of this.dummies) {
      this.group.remove(d.group);
      this.disposeAvatar(d);
      this.disposeModel(d);
      for (const m of d.ownMats) m.dispose();
      this.disposeBoss(d);
    }
    this.dummies.length = 0;
  }

  /**
   * Toggle automatic respawn. With it off, a slain dummy stays down rather than
   * reviving after a beat — duel rounds end the instant a fighter falls.
   */
  setAutoRespawn(on: boolean): void {
    this.autoRespawn = on;
  }

  /** Count of living NPCs per faction (for HUD/panel readouts). */
  factionCounts(): { enemy: number; ally: number } {
    const out = { enemy: 0, ally: 0 };
    for (const d of this.dummies) if (!d.dead) out[d.faction]++;
    return out;
  }

  /**
   * Lightweight per-frame read of every fighter (live CC state + avatar) the
   * A.L.E. Bot polls to derive duel telemetry without touching combat internals.
   */
  fighterViews(): FighterView[] {
    return this.dummies.map((d) => ({
      id: d.id,
      faction: d.faction,
      dead: d.dead,
      group: d.group,
      avatar: d.avatar ?? null,
      health: d.cc.getHealth(),
      maxHealth: d.maxHealth,
      poise: d.cc.getPoise(),
      stamina: d.cc.getStamina(),
      state: d.cc.getState(),
    }));
  }

  /** Live combatant footprints (XZ circles) for Danger Room push-out collision. */
  obstacleCircles(): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    for (const d of this.dummies) {
      if (d.dead) continue;
      // Per-body footprint so the big enemies (boss / bear / ogre) read as solid
      // movement obstacles the player has to path around, not walk through.
      const r =
        d.arch === "boss"
          ? 0.95
          : d.modelKind === "bear"
            ? 0.75
            : d.modelKind === "ogre"
              ? 0.6
              : 0.45;
      out.push({ x: d.group.position.x, z: d.group.position.z, r });
    }
    return out;
  }

  /** Chest-height world position of a dummy. */
  private chest(d: Dummy, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(d.group.position.x, d.group.position.y + 1.1, d.group.position.z);
  }

  /**
   * Host-authoritative roster snapshot of every NPC (living + freshly dead) for
   * broadcast to coop peers. Dummies are procedural (no animation clips), so
   * `clip` is left empty — mirrors derive locomotion from motion. Includes dead
   * NPCs (alive:false) so peers can remove their mirrors before respawn.
   */
  netSnapshot(): NpcState[] {
    const out: NpcState[] = [];
    for (const d of this.dummies) {
      out.push({
        id: String(d.id),
        archetype: d.arch,
        weapon: d.weaponId,
        px: d.group.position.x,
        py: d.group.position.y,
        pz: d.group.position.z,
        ry: d.yaw,
        clip: "",
        hp: Math.max(0, Math.round(d.cc.getHealth())),
        maxHp: d.maxHealth,
        alive: !d.dead,
      });
    }
    return out;
  }

  /**
   * Apply a peer-forwarded hit against a host-owned NPC by id. The host owns NPC
   * health, so damage routes through the same `cc.applyAttack` path as a local
   * strike (knockback origin is the NPC's own chest → a soft, non-directional
   * shove). No-op if the id is unknown or already dead.
   */
  applyNetHit(id: string, amount: number, ctx?: SparringContext): void {
    const d = this.dummies.find((x) => String(x.id) === id);
    if (!d || d.dead) return;
    const center = this.chest(d);
    const result = this.hit(
      d,
      { force: 1, damage: amount, poiseDamage: Math.round(amount * 0.6) },
      center,
      1,
      this.playerCC,
      ctx,
    );
    if (result) this.onPlayerHit?.(result, center);
  }

  /** Nearest living targets to a point, closest first. */
  nearest(from: THREE.Vector3, count: number): TargetHandle[] {
    const live = this.dummies
      .filter((d) => !d.dead && d.faction === "enemy")
      .map((d) => ({ d, dist: this.chest(d).distanceToSquared(from) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, count);
    return live.map(({ d }) => this.handle(d));
  }

  /**
   * Pick the living target the crosshair is pointing at. A direct ray-sphere hit
   * against a dummy's chest sphere wins (closest along the ray); otherwise the
   * best living target inside a soft-aim cone is returned. Returns null when
   * nothing qualifies.
   */
  raycast(ray: THREE.Ray, maxDist: number, softCos: number): TargetHandle | null {
    const chest = new THREE.Vector3();
    const sphere = new THREE.Sphere();
    const hitPt = new THREE.Vector3();
    let best: Dummy | null = null;

    let bestT = Infinity;
    for (const d of this.dummies) {
      if (d.dead || d.faction !== "enemy") continue;
      this.chest(d, chest);
      if (chest.distanceTo(ray.origin) > maxDist + CHEST_RADIUS) continue;
      sphere.set(chest, CHEST_RADIUS);
      if (ray.intersectSphere(sphere, hitPt)) {
        const t = hitPt.distanceTo(ray.origin);
        if (t < bestT) {
          bestT = t;
          best = d;
        }
      }
    }
    if (best) return this.handle(best);

    let bestDot = softCos;
    for (const d of this.dummies) {
      if (d.dead || d.faction !== "enemy") continue;
      this.chest(d, chest);
      const to = chest.sub(ray.origin);
      const dist = to.length();
      if (dist < 1e-3 || dist > maxDist) continue;
      to.multiplyScalar(1 / dist);
      const dot = to.dot(ray.direction);
      if (dot > bestDot) {
        bestDot = dot;
        best = d;
      }
    }
    return best ? this.handle(best) : null;
  }

  private handle(d: Dummy): TargetHandle {
    return {
      get position() {
        return new THREE.Vector3(d.group.position.x, d.group.position.y + 1.1, d.group.position.z);
      },
      get velocity() {
        return new THREE.Vector3(d.velEstimate.x, 0, d.velEstimate.z);
      },
      get alive() {
        return !d.dead;
      },
    };
  }

  /**
   * Resolve a single incoming attack against `d` through its CombatController:
   * the CC decides block/parry/dodge/hit/crit from ITS current state and applies
   * health/poise/stamina internally. We translate the outcome into knockback +
   * flash, punish the attacker on a parry, and mark death when the CC drops.
   */
  private hit(
    d: Dummy,
    payload: AttackPayload,
    source: THREE.Vector3,
    physForce: number,
    attackerCC?: CombatController | null,
    ctx?: SparringContext,
  ): DefensiveResult | null {
    if (d.dead) return null;
    d.lastHitForce = payload.force;
    // Weak-point boss: scale the incoming payload by the currently-targeted weak
    // point's per-phase multipliers BEFORE the CC resolves it, so all damage +
    // poise still flow through `applyAttack` (no ad-hoc HP writes). Armoured knees
    // chip little health but pour poise; the downed head/chest take big bonuses.
    let p = payload;
    if (d.boss) {
      const phase = bossPhaseFromState(d.cc.getState());
      const wp = activeWeakPoint(phase, d.boss.weakIndex);
      const mod = weakPointMod(phase, wp);
      p = {
        ...payload,
        damage: payload.damage * mod.damageMul,
        poiseDamage: (payload.poiseDamage ?? 0) * mod.poiseMul,
      };
    }
    const result = d.cc.applyAttack(p);

    // Boss poise break → drop into the long "downed" knock-down window. The CC
    // enters a brief `stagger` on a poise break; converting it to `fallen` opens
    // the extended head/chest-exposed window (with the crit window held open by
    // the boss config) before the CC auto-recovers and re-armours.
    if (d.boss && d.cc.getState() === "stagger") {
      d.cc.applyVulnerableState("fallen");
    }

    if (attackerCC && result.attackerReaction !== "none") {
      attackerCC.applyVulnerableState(result.attackerReaction);
    }

    const scale = outcomeForceScale(result.outcome);
    if (scale > 0) {
      const push = this.chest(d).sub(source);
      push.y = 0;
      if (push.lengthSq() < 1e-4) push.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      push.normalize();
      d.vel.addScaledVector(push, physForce * scale);
      d.vel.y += physForce * scale * 0.25;
    }

    if (isDefended(result.outcome)) {
      d.flash = 0.3;
      const parried = result.outcome === "perfectParry" || result.outcome === "deflect";
      d.flashColor.copy(parried ? PARRY_COLOR : DEFEND_COLOR);
      const dodged = result.outcome === "dodgeEvade" || result.outcome === "dodgePunish";
      ctx?.onDefend?.(this.chest(d), dodged);
      // A hit soaked on a raised guard plays a DIRECTIONAL guarded-hit react keyed
      // off where the blow came from relative to the AI's facing, then settles back
      // into the held block — the SAME guarded-hit clips the player uses.
      if ((result.outcome === "blockStop" || result.outcome === "deflect") && d.avatar?.reaction) {
        const side = this.guardSide(d, source);
        d.avatar.reaction(guardedHitClip(getWeapon(d.weaponId).group, side), 0.08);
      }
    } else {
      d.flash = 0.25;
      d.flashColor.copy(FLASH_COLOR);
      d.model?.react();
    }

    if (d.cc.getHealth() <= 0 && !d.dead) {
      this.markDead(d);
    }
    return result;
  }

  /**
   * Player attack: resolve a focused combo/heavy hit against the nearest living
   * enemy through its CC (firing {@link onPlayerHit} for impact VFX), then splash
   * lighter AoE damage onto other enemies in range. Returns the focused result,
   * or null when nothing was in reach (then it falls back to a plain blast).
   */
  playerHit(
    center: THREE.Vector3,
    radius: number,
    payload: AttackPayload,
    physForce: number,
    ctx?: SparringContext,
  ): DefensiveResult | null {
    const tmp = new THREE.Vector3();
    let focused: Dummy | null = null;
    let fd = Infinity;
    // Prefer the Tab-selected hostile (red target) when it's a live enemy within
    // reach, so an offensive strike resolves against it even if another enemy is
    // nearer. Otherwise fall back to the nearest enemy to the strike centre.
    const sel =
      this.selectedId != null
        ? this.dummies.find((x) => x.id === this.selectedId && !x.dead && x.faction === "enemy")
        : undefined;
    if (sel) {
      const sd = this.chest(sel, tmp).distanceTo(center);
      if (preferSelectedHostile(sd, radius + 1.0)) {
        focused = sel;
        fd = sd;
      }
    }
    if (!focused) {
      for (const d of this.dummies) {
        if (d.dead || d.faction !== "enemy") continue;
        const dd = this.chest(d, tmp).distanceTo(center);
        if (dd < fd) {
          fd = dd;
          focused = d;
        }
      }
    }
    if (!focused || fd > radius + 1.0) {
      this.blast(center, radius, payload.damage, physForce, ctx);
      return null;
    }

    // Knockback (and the directional guarded-hit react) must originate from the
    // ATTACKER, not the strike centre. `center` sits a full `reach` ahead of the
    // player, so when the focused enemy is closer than that (the common point-
    // blank combo case) `chest − center` points BACK toward the player and the
    // shove inverts — knocking the victim INTO the attacker. Resolve the focused
    // hit from the player's own position so the reaction always travels away from
    // the attacker. (The radial AoE splash below correctly stays centred on the
    // strike point.)
    const knockFrom = ctx?.playerPos ?? center;
    const result = this.hit(focused, payload, knockFrom, physForce, this.playerCC, ctx);
    if (result) this.onPlayerHit?.(result, this.chest(focused));

    // Lighter splash to the OTHER enemies inside the strike area.
    const splashPoise = payload.poiseDamage ?? Math.round(payload.damage * 0.5);
    for (const d of this.dummies) {
      if (d === focused || d.dead || d.faction !== "enemy") continue;
      const falloff = aoeFalloff(this.chest(d, tmp).distanceTo(center), radius);
      if (falloff < 0) continue;
      this.hit(
        d,
        { force: 1, damage: payload.damage * falloff * 0.6, poiseDamage: splashPoise * falloff * 0.6 },
        center,
        physForce * (0.4 + falloff * 0.4),
        this.playerCC,
        ctx,
      );
    }
    return result;
  }

  /** Stagger an opponent (e.g. when the player parries its strike). */
  stagger(handle: TargetHandle, seconds = 0.9) {
    for (const d of this.dummies) {
      if (d.dead) continue;
      if (Math.abs(d.group.position.x - handle.position.x) < 1e-3 && Math.abs(d.group.position.z - handle.position.z) < 1e-3) {
        d.cc.applyVulnerableState("parried");
        d.flash = 0.3;
        d.flashColor.copy(PARRY_COLOR);
        void seconds;
        return;
      }
    }
  }

  /**
   * Stun every living target within `radius` of `center` for `seconds`: they
   * freeze in place, drop any wind-up, and skip every reaction until it expires.
   * Returns how many were stunned. (Orthogonal to the CC — a utility-skill freeze.)
   */
  stun(center: THREE.Vector3, radius: number, seconds = STUN_SECONDS): number {
    let hits = 0;
    const tmp = new THREE.Vector3();
    for (const d of this.dummies) {
      if (d.dead) continue;
      if (this.chest(d, tmp).distanceTo(center) > radius) continue;
      d.stunT = Math.max(d.stunT, seconds);
      d.state = "idle";
      d.stateT = 0;
      d.pendingSkill = false;
      hits++;
    }
    return hits;
  }

  /**
   * Shield-break every living target within `radius` of `center` for `seconds`:
   * they can still act but cannot block/parry/dodge until it expires.
   */
  shieldBreak(center: THREE.Vector3, radius: number, seconds = SHIELD_BREAK_SECONDS): number {
    let hits = 0;
    const tmp = new THREE.Vector3();
    for (const d of this.dummies) {
      if (d.dead) continue;
      if (this.chest(d, tmp).distanceTo(center) > radius) continue;
      d.shieldBreakT = Math.max(d.shieldBreakT, seconds);
      hits++;
    }
    return hits;
  }

  /**
   * Slow every living target within `radius` of `center`: their approach speed is
   * scaled by `mul` (< 1) for `seconds`. Drives the bow's melee-slash debuff —
   * the struck fighter keeps acting but closes/retreats sluggishly. Refreshes
   * (does not stack) by taking the longer remaining timer and the stronger slow.
   */
  slowArea(center: THREE.Vector3, radius: number, mul: number, seconds: number): number {
    let hits = 0;
    const tmp = new THREE.Vector3();
    for (const d of this.dummies) {
      if (d.dead) continue;
      if (this.chest(d, tmp).distanceTo(center) > radius) continue;
      d.slowMul = d.slowT > 0 ? Math.min(d.slowMul, mul) : mul;
      d.slowT = Math.max(d.slowT, seconds);
      hits++;
    }
    return hits;
  }

  /**
   * Utility-kick impact: shove the nearest living enemy within `radius` of
   * `center` out of any raised guard and into a forced stagger. Unlike a normal
   * blockable hit this drives the CC vulnerable state directly (so the stagger
   * lands even against a raised block = guard-break) AND opens a shield-break
   * window so the enemy can't immediately re-block, plus a heavy knockback shove.
   * Returns the struck enemy's chest position (for impact VFX), else null.
   */
  kickStagger(
    center: THREE.Vector3,
    radius: number,
    force: number,
    seconds = SHIELD_BREAK_SECONDS,
    from?: THREE.Vector3,
  ): THREE.Vector3 | null {
    const tmp = new THREE.Vector3();
    let focused: Dummy | null = null;
    let fd = Infinity;
    for (const d of this.dummies) {
      if (d.dead || d.faction !== "enemy") continue;
      const dd = this.chest(d, tmp).distanceTo(center);
      if (dd < fd) {
        fd = dd;
        focused = d;
      }
    }
    if (!focused || fd > radius) return null;
    // Guard-break: force the stunned reaction directly (bypasses block/parry/
    // dodge) and open a shield-break window so a blocking enemy is shoved out of
    // its guard rather than blocking the kick cleanly.
    focused.cc.applyVulnerableState("stunned");
    focused.shieldBreakT = Math.max(focused.shieldBreakT, seconds);
    focused.state = "idle";
    focused.stateT = 0;
    focused.pendingSkill = false;
    // Heavy shove away from the kicker. Use the kicker's own position as the
    // origin (not the kick point ahead of them): if the struck enemy is closer
    // than the kick centre, `chest − center` would invert and shove them BACK
    // into the kicker. Fall back to the kick centre when no origin is supplied.
    const push = this.chest(focused, new THREE.Vector3()).sub(from ?? center);
    push.y = 0;
    if (push.lengthSq() < 1e-4) push.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    push.normalize();
    focused.vel.addScaledVector(push, force);
    focused.vel.y += force * 0.2;
    focused.flash = 0.4;
    focused.flashColor.copy(FLASH_COLOR);
    focused.model?.react();
    return this.chest(focused, new THREE.Vector3());
  }

  /**
   * Area-of-effect blast at `center`: every living enemy within `radius` takes
   * distance-attenuated damage + knockback, resolved through each CC (so a
   * defending enemy can still block/dodge it). Returns how many were struck.
   */
  blast(center: THREE.Vector3, radius: number, damage: number, force: number, ctx?: SparringContext): number {
    let hits = 0;
    const tmp = new THREE.Vector3();
    for (const d of this.dummies) {
      if (d.dead || d.faction !== "enemy") continue;
      const falloff = aoeFalloff(this.chest(d, tmp).distanceTo(center), radius);
      if (falloff < 0) continue;
      this.hit(
        d,
        { force: 1, damage: damage * falloff, poiseDamage: Math.round(damage * falloff * 0.5) },
        center,
        force * (0.5 + falloff * 0.5),
        this.playerCC,
        ctx,
      );
      hits++;
    }
    return hits;
  }

  /**
   * AoE blast restricted to a single faction (e.g. a boss skill hitting the
   * player's allies). Mirrors {@link blast} but filtered by `faction`, so an
   * enemy telegraph can resolve against everyone inside the circle.
   */
  private blastFaction(
    center: THREE.Vector3,
    radius: number,
    damage: number,
    force: number,
    faction: Faction,
    ctx?: SparringContext,
    payloadForce = 1,
  ): number {
    let hits = 0;
    const tmp = new THREE.Vector3();
    for (const d of this.dummies) {
      if (d.dead || d.faction !== faction) continue;
      const falloff = aoeFalloff(this.chest(d, tmp).distanceTo(center), radius);
      if (falloff < 0) continue;
      this.hit(
        d,
        { force: payloadForce, damage: damage * falloff, poiseDamage: Math.round(damage * falloff * 0.5) },
        center,
        force * (0.5 + falloff * 0.5),
        null,
        ctx,
      );
      hits++;
    }
    return hits;
  }

  /**
   * Collect the groups of every living ally within `radius` of `center` — the
   * anchor points a friendly AOE cast tracks. Mirrors {@link blastFaction}'s
   * faction + radius filter, but gathers support targets instead of dealing
   * damage, so a heal/shield/buff can splash everyone in range. Nearest-first.
   */
  alliesInRadius(center: THREE.Vector3, radius: number): THREE.Object3D[] {
    const tmp = new THREE.Vector3();
    const hits: { group: THREE.Object3D; dist: number }[] = [];
    for (const d of this.dummies) {
      if (d.dead || d.faction !== "ally") continue;
      const dist = this.chest(d, tmp).distanceTo(center);
      if (aoeFalloff(dist, radius) < 0) continue;
      hits.push({ group: d.group, dist });
    }
    hits.sort((a, b) => a.dist - b.dist);
    return hits.map((h) => h.group);
  }

  /**
   * Launch living targets near `center` mostly straight up (a launcher kick).
   * Damage is dealt through the CC with an unblockable force so the pop always
   * lands. Returns how many were struck.
   */
  /**
   * Block bounce: push hostiles near the attacker origin away from the blocker,
   * at ~distance metres of horizontal velocity, with optional stun react.
   */
  shoveAway(
    origin: THREE.Vector3,
    awayFrom: THREE.Vector3,
    distance: number,
    stun = true,
  ): void {
    const tmp = new THREE.Vector3();
    const radius = 1.4;
    for (const d of this.dummies) {
      if (d.dead || d.faction !== "enemy") continue;
      if (this.chest(d, tmp).distanceTo(origin) > radius) continue;
      const out = this.chest(d, new THREE.Vector3()).sub(awayFrom);
      out.y = 0;
      if (out.lengthSq() < 1e-4) out.set(0, 0, 1);
      out.normalize();
      // Map metres-ish to dummy vel units used elsewhere (~4–6 for solid shove)
      const speed = Math.max(2.5, distance * 3.2);
      d.vel.addScaledVector(out, speed);
      d.vel.y += 1.2;
      d.flash = 0.28;
      d.flashColor.copy(DEFEND_COLOR);
      if (stun) {
        d.cc.applyVulnerableState("stunned");
        d.avatar?.reaction?.("stunned", 0.1);
        // AI "thinks" to stylish flip recover mid-bounce (~55% chance, slight delay)
        if (Math.random() < 0.55) {
          d.blockFlipT = 0.14 + Math.random() * 0.16;
        } else {
          d.blockFlipT = 0;
        }
      }
    }
  }

  /**
   * AI stylish flip recover off a block bounce (Space equivalent): hop up, cancel
   * residual horizontal shove, play flip/kip clip, re-open for skill-1 style offense.
   */
  private doBlockBounceFlip(d: Dummy): void {
    if (d.dead) return;
    d.blockFlipT = 0;
    // Kill most of the bounce slide; hop straight up
    d.vel.x *= 0.25;
    d.vel.z *= 0.25;
    d.vel.y = Math.max(d.vel.y, 6.2);
    d.flash = 0.2;
    d.flashColor.copy(DEFEND_COLOR);
    // Prefer stylish flip / kip-up; fall back to getUp
    if (d.avatar?.reaction) {
      if (
        !d.avatar.reaction("stylishFlip", 0.08) &&
        !d.avatar.reaction("kipUp", 0.1) &&
        !d.avatar.reaction("getUp", 0.12)
      ) {
        d.avatar.reaction("stunned", 0.08);
      }
    }
    // Brief attack ready — shorten defend CD so skill-1 style offense can follow
    d.attackCd = Math.min(d.attackCd, 0.12);
    d.defendCd = Math.min(d.defendCd, 0.2);
    d.state = "idle";
    d.stateT = 0.15;
  }

  launch(center: THREE.Vector3, radius: number, damage: number, upVel: number): number {
    let hits = 0;
    const tmp = new THREE.Vector3();
    // A strong launcher (kick / uppercut) reads as a CLEAN knock-up: pop the
    // target to a ~2m apex, run the rise → falling-idle → knocked-out chain, and
    // land it prone (and stompable). Small juggle lifts keep the old quick pop.
    const clean = upVel >= 8;
    for (const d of this.dummies) {
      if (d.dead || d.faction !== "enemy") continue;
      const falloff = aoeFalloff(this.chest(d, tmp).distanceTo(center), radius);
      if (falloff < 0) continue;
      const out = this.chest(d, new THREE.Vector3()).sub(center);
      out.y = 0;
      const knockedBack = out.lengthSq() > 0.25; // shoved clear of the strike vs. popped in place
      d.flash = 0.25;
      d.flashColor.copy(FLASH_COLOR);
      d.model?.react();
      if (clean) {
        // v = sqrt(2*g*h) with g = 22 (the update-loop gravity) → ~2m apex.
        d.vel.y = 9.4 * (0.85 + 0.15 * falloff);
        if (out.lengthSq() > 1e-4) d.vel.addScaledVector(out.normalize(), knockedBack ? 2.2 : 1.0);
        d.launchPhase = "rising";
        // Rise clip; the apex/landing swap to falling-idle / knocked-out happens
        // in the update loop. Fall back to the old pop for rigs missing the clip.
        if (d.avatar?.reaction && !d.dead) {
          const rise = knockedBack ? "knockedUpBack" : "knockedUp";
          if (!d.avatar.reaction(rise, 0.06) && !d.avatar.reaction("uppercutLaunch", 0.08))
            d.avatar.reaction("fallDown", 0.1);
        }
      } else {
        d.vel.y += upVel * (0.6 + 0.4 * falloff);
        if (out.lengthSq() > 1e-4) d.vel.addScaledVector(out.normalize(), 1.2);
        // Knock-up read: the dedicated uppercut-launch pop (auto-reverts to its
        // locomotion/idle once the clip ends, so it never freezes mid-pop; rigs
        // without it fall back to the generic tumble).
        if (d.avatar?.reaction && !d.dead) {
          if (!d.avatar.reaction("uppercutLaunch", 0.08)) d.avatar.reaction("fallDown", 0.1);
        }
      }
      if (damage > 0) {
        d.cc.applyAttack({ force: 4, damage: damage * falloff, poiseDamage: damage * falloff });
        if (d.cc.getHealth() <= 0 && !d.dead) {
          d.launchPhase = undefined;
          this.markDead(d);
        }
      }
      hits++;
    }
    return hits;
  }

  bladeDefenders(playerPos: THREE.Vector3): BladeDefender[] {
    const out: BladeDefender[] = [];
    const H = CHARACTER_HEIGHT_M;
    for (const d of this.dummies) {
      if (d.dead || d.faction !== "enemy") continue;
      const p = d.group.position;
      const s = d.group.scale.x || 1;
      const body: BladeDefender["body"] = {
        a: new THREE.Vector3(p.x, p.y + 0.4 * s, p.z),
        b: new THREE.Vector3(p.x, p.y + (H - 0.2) * s, p.z),
        radius: 0.42 * s,
      };
      // Planar approach direction: the blade meets shield/weapon from the player's side.
      const toPlayer = new THREE.Vector3(playerPos.x - p.x, 0, playerPos.z - p.z);
      if (toPlayer.lengthSq() < 1e-6) toPlayer.set(0, 0, 1);
      else toPlayer.normalize();
      const chestY = p.y + 1.15 * s;
      const canDefend = d.shieldBreakT <= 0 && d.stunT <= 0;
      let shield: BladeDefender["shield"] = null;
      if (canDefend && d.blockHold > 0) {
        const cx = p.x + toPlayer.x * 0.5 * s;
        const cz = p.z + toPlayer.z * 0.5 * s;
        shield = {
          a: new THREE.Vector3(cx, chestY - 0.55 * s, cz),
          b: new THREE.Vector3(cx, chestY + 0.45 * s, cz),
          radius: 0.5 * s,
        };
      }
      let weapon: BladeDefender["weapon"] = null;
      const swinging = d.state === "windup" || d.recoverT > 0;
      const group = getWeapon(d.weaponId).group;
      const melee = group === "melee-1h" || group === "melee-2h";
      if (!shield && canDefend && swinging && melee) {
        const base = new THREE.Vector3(p.x, chestY, p.z);
        const reach = 1.3 * s;
        weapon = {
          a: base.clone(),
          b: new THREE.Vector3(base.x + toPlayer.x * reach, chestY, base.z + toPlayer.z * reach),
          radius: 0.14 * s,
        };
      }
      out.push({ id: d.id, body, shield, weapon });
    }
    return out;
  }

  forceGuard(id: number, seconds: number): void {
    const d = this.dummies.find((x) => x.id === id);
    if (!d || d.dead) return;
    d.blockHold = Math.max(d.blockHold, seconds);
    d.cc.startBlock();
  }

  update(dt: number, ctx?: SparringContext) {
    this.clock += dt;
    const damp = Math.exp(-6 * dt);
    const active = this.difficulty !== "passive" && !!ctx;
    for (const d of this.dummies) {
      // Smoothed finite-difference planar velocity for predictive lead by the
      // player's aimed projectiles. Computed from last frame's end position;
      // instantaneous spikes (knockback / teleport / respawn) are clamped so a
      // launch can't make the lead overshoot wildly.
      if (dt > 1e-5) {
        const ivx = THREE.MathUtils.clamp((d.group.position.x - d.lastSeenPos.x) / dt, -30, 30);
        const ivz = THREE.MathUtils.clamp((d.group.position.z - d.lastSeenPos.z) / dt, -30, 30);
        const a = Math.min(1, 8 * dt);
        d.velEstimate.x += (ivx - d.velEstimate.x) * a;
        d.velEstimate.z += (ivz - d.velEstimate.z) * a;
      }
      d.lastSeenPos.set(d.group.position.x, d.group.position.y, d.group.position.z);

      // Advance the passive dummy model's own idle/react clip (dead or alive).
      if (d.modelReady && d.model) d.model.update(dt);
      if (d.dead) {
        d.vel.y -= 22 * dt;
        d.group.position.addScaledVector(d.vel, dt);
        if (d.avatar && !d.isSkeleton) {
          // Avatar fighters play a death clip once; the rig (not a topple tilt)
          // sells the fall, so keep the group upright while the clip runs.
          if (!d.deathPlayed) {
            d.avatar.playRoleOnce("death");
            d.deathPlayed = true;
          }
          d.group.rotation.set(0, d.yaw, 0);
          if (d.avatarReady) d.avatar.update(dt);
        } else if (!d.isSkeleton) {
          d.tilt.x += (Math.PI / 2 - d.tilt.x) * Math.min(1, 8 * dt);
          d.group.rotation.set(d.tilt.x, d.group.rotation.y, d.tilt.z);
        }
        if (d.group.position.y < 0) d.group.position.y = 0;
        d.respawn -= dt;
        // After 2 minutes dead → Skeletons_Free residual (characters).
        if (!d.isSkeleton && d.respawn <= SKELETON_LINGER_S) {
          void this.toSkeleton(d);
        }
        // With auto-respawn off (duel mode) a slain fighter stays as skeleton.
        if (this.autoRespawn && d.respawn <= 0) this.revive(d);
        continue;
      }

      // Tick the combat controller (defense windows, hitstun, regen).
      d.cc.update(dt);

      if (d.attackCd > 0) d.attackCd -= dt;
      if (d.recoverT > 0) d.recoverT = Math.max(0, d.recoverT - dt);
      if (d.defendCd > 0) d.defendCd -= dt;
      if (d.spellCd > 0) d.spellCd -= dt;
      if (d.turretCd > 0) d.turretCd -= dt;
      if (d.stunT > 0) d.stunT = Math.max(0, d.stunT - dt);
      if (d.shieldBreakT > 0) d.shieldBreakT = Math.max(0, d.shieldBreakT - dt);
      if (d.slowT > 0) d.slowT = Math.max(0, d.slowT - dt);

      // Knockback integration with ground clamp + bounds.
      d.vel.y -= 22 * dt;
      d.group.position.addScaledVector(d.vel, dt);
      d.vel.x *= damp;
      d.vel.z *= damp;
      // Clean knock-up chain: swap to the airborne falling pose once past the
      // apex (descending), then on landing force the knocked-down state + the
      // knocked-out collapse so a launch always ends prone, never popped back up.
      if (d.launchPhase === "rising" && d.vel.y <= 0) {
        d.launchPhase = "falling";
        if (d.avatar?.reaction) d.avatar.reaction("fallingIdle", 0.12);
      }
      if (d.group.position.y <= 0) {
        d.group.position.y = 0;
        d.vel.y = 0;
        if (d.launchPhase) {
          d.launchPhase = undefined;
          d.cc.applyVulnerableState("fallen");
          // The clean knock-up lands in the deeper rag-doll KO collapse.
          if (d.avatar?.reaction) d.avatar.reaction("knockedUnconscious", 0.1, true);
          // Fire the knock-down side effects (VFX / flash) that the reaction hook
          // would normally raise on a `fallen` transition...
          this.onEnemyState?.(this.chest(d), "fallen");
          // ...then adopt the forced state so the hook below does NOT also replay
          // the generic fall clip over the knocked-out pose this frame.
          d.lastState = d.cc.getState();
        }
      }

      // One-shot reaction hook when the CC enters / leaves a reaction state. The
      // avatar rig plays the REAL reaction clip per state (stumble / stunned /
      // fall-down) instead of a single generic flinch, and springs back up with a
      // kip-up when it leaves the grounded "fallen" state — no frozen down pose.
      const cs = d.cc.getState();
      if (cs !== d.lastState) {
        if (d.launchPhase) {
          // Airborne clean knock-up owns the rig clip until it lands; just track
          // the CC state so we don't override the rise/falling pose mid-flight.
        } else if (cs === "stagger" || cs === "stunned" || cs === "fallen") {
          this.onEnemyState?.(this.chest(d), cs);
          if (d.avatar?.reaction) {
            // Reaction CLIP comes from the defender's hold-style standard so the
            // AI reacts from the SAME source as the player (a 2H fighter gets the
            // heavier fall/stumble clips, a light kit the lighter ones).
            const def = defenseClips(getWeapon(d.weaponId).group);
            if (cs === "stunned") d.avatar.reaction("stunned", 0.1);
            else if (cs === "fallen") d.avatar.reaction(def.fall, 0.12);
            else d.avatar.reaction(def.stumble, 0.08);
          } else if (d.avatar) {
            d.avatar.playRoleOnce("hurt");
          }
        } else if (d.lastState === "fallen" && d.avatar?.reaction) {
          // Recovered from a knock-down — acrobatic kip-up back to stance.
          d.avatar.reaction("kipUp", 0.18);
        }
        d.lastState = cs;
      }

      if (d.stunT > 0) {
        // Utility-skill stun: frozen in place — no AI, residual knockback bleeds off.
        d.state = "idle";
      } else if (active && ctx) {
        this.updateAi(d, dt, ctx);
      } else {
        d.state = "idle";
        const toHome = d.home.clone().sub(d.group.position);
        toHome.y = 0;
        if (d.vel.lengthSq() < 0.5) d.group.position.addScaledVector(toHome, Math.min(1, 2 * dt));
      }

      d.group.position.x = THREE.MathUtils.clamp(d.group.position.x, -this.bounds, this.bounds);
      d.group.position.z = THREE.MathUtils.clamp(d.group.position.z, -this.bounds, this.bounds);

      // Lean: topple while fallen, else proportional to horizontal speed.
      const speed = Math.hypot(d.vel.x, d.vel.z);
      const targetTilt = cs === "fallen" ? 1.2 : THREE.MathUtils.clamp(speed * 0.06, 0, 0.5);
      d.tilt.x += (targetTilt - d.tilt.x) * Math.min(1, 6 * dt);
      // Avatar fighters stay upright (the rig animates posture); primitives lean.
      d.group.rotation.set(d.avatar ? 0 : d.tilt.x, d.yaw, 0);

      // Drive an attached Explorer rig: locomotion intent from the AI state, plus
      // its own per-frame clip advance. One-shots (attack/defense/death/hurt) are
      // fired from the matching combat events; here we only set the loco layer.
      if (d.avatar && d.avatarReady) {
        if (d.state === "approach") d.avatar.playRole("run");
        else if (speed > 0.8) d.avatar.playRole("walk");
        else d.avatar.playRole("idle");
        d.avatar.update(dt);
      }

      // Emissive priority: hit flash > stun glow > shield-break glow > CC reaction
      // (stagger/stunned/fallen) > wind-up pulse > rest.
      if (d.flash > 0) {
        d.flash = Math.max(0, d.flash - dt);
        const k = d.flash / 0.3;
        d.mat.emissive.copy(REST_EMISSIVE).lerp(d.flashColor, k);
      } else if (d.stunT > 0) {
        const pulse = 0.6 + 0.4 * Math.sin(this.clock * 14);
        d.mat.emissive.copy(REST_EMISSIVE).lerp(STUN_COLOR, 0.5 * pulse);
      } else if (d.shieldBreakT > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * 8);
        d.mat.emissive.copy(REST_EMISSIVE).lerp(SHIELD_BREAK_COLOR, 0.3 + 0.25 * pulse);
      } else if (cs === "stagger" || cs === "stunned" || cs === "fallen") {
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * 12);
        d.mat.emissive.copy(REST_EMISSIVE).lerp(FLASH_COLOR, 0.25 + 0.2 * pulse);
      } else if (cs === "block" || cs === "parry") {
        d.mat.emissive.copy(REST_EMISSIVE).lerp(DEFEND_COLOR, 0.4);
      } else if (d.state === "windup") {
        const pulse = 0.5 + 0.5 * Math.sin(d.stateT * 22);
        d.mat.emissive.copy(REST_EMISSIVE).lerp(WINDUP_COLOR, 0.4 + 0.5 * pulse);
      } else {
        d.mat.emissive.copy(REST_EMISSIVE);
      }

      // Boss weak-point marker: a small floating beacon at the currently-targeted
      // weak point, shown ONLY while the boss is the locked target. It rides the
      // active weak point's local height and recolours by phase (gold while
      // armoured, red while downed) so the player can read which point is live.
      if (d.boss) {
        const selected = d.id === this.selectedId && !d.dead;
        d.boss.marker.visible = selected;
        if (selected) {
          const phase = bossPhaseFromState(d.cc.getState());
          const wp = activeWeakPoint(phase, d.boss.weakIndex);
          d.boss.marker.position.set(0, weakPointLocalHeight(wp), 0);
          d.boss.markerMat.color.setHex(phase === "downed" ? 0xff4d4d : 0xffd23f);
        }
      }
    }

    // Tick AI-deployed turrets (firing + faction-aware damage + cleanup). Needs a
    // wired ctx; when absent (passive/no host) we just drop any standing turrets.
    if (ctx) {
      this.updateTurrets(dt, ctx);
    } else if (this.turrets.length) {
      for (const t of this.turrets) t.dispose();
      this.turrets.length = 0;
    }
  }

  /**
   * Pick the nearest hostile for `d`: enemies hunt the player + allies, allies hunt
   * enemies. Returns the target's chest-height position plus the dummy it belongs to
   * (null `dummy` = the player). Returns null when no hostile exists.
   */
  private hostileTarget(d: Dummy, ctx: SparringContext): { pos: THREE.Vector3; dummy: Dummy | null } | null {
    const from = d.group.position;
    let best: Dummy | null = null;
    let bestD = Infinity;
    for (const o of this.dummies) {
      if (o === d || o.dead) continue;
      if (d.faction === "ally" && o.faction !== "enemy") continue;
      if (d.faction === "enemy" && o.faction !== "ally") continue;
      const dd = o.group.position.distanceToSquared(from);
      if (dd < bestD) {
        bestD = dd;
        best = o;
      }
    }
    if (d.faction === "enemy" && ctx.playerAlive) {
      const pd = ctx.playerPos.distanceToSquared(from);
      if (!best || pd < bestD) return { pos: ctx.playerPos.clone(), dummy: null };
    }
    return best ? { pos: this.chest(best), dummy: best } : null;
  }

  /**
   * Build the goal-driven brain for a fighter: a {@link FighterAgent} adapter
   * (live perception snapshot + action hooks routed into the engine) plus the
   * {@link Think} arbitrator. The action hooks close over `this` + `d` so the
   * generic, engine-free brain can drive combat through the existing contract
   * ({@link executeStrike} / {@link commitDefense}) without touching it.
   */
  private equipBrain(d: Dummy): void {
    const self = this;
    const frame: FighterFrame = {
      dir: new THREE.Vector3(0, 0, 1),
      dist: Infinity,
      combat: weaponCombat(d.weaponId),
      ctx: null,
      target: null,
    };
    const perception: FighterPerception = {
      hasTarget: false,
      distance: Infinity,
      engageRange: 0,
      innerRange: 0,
      lungeRange: 0,
      targetWindingUp: false,
      targetRecovering: false,
      attackReady: false,
      spellReady: false,
      turretReady: false,
      spellRange: SPELL_RANGE,
      canDefend: false,
      health01: 1,
      stamina01: 1,
      poise01: 1,
    };
    const actions: FighterActions = {
      face: (dt) => this.faceToward(d, frame.dir, dt),
      advance: (dt, mul = 1) => this.brainAdvance(d, frame.dir, dt, mul),
      retreat: (dt, mul = 1) => this.brainRetreat(d, frame.dir, dt, mul),
      strafe: (dt, dir) => this.brainStrafe(d, frame.dir, dt, dir),
      gapClose: () => this.brainGapClose(d, frame.dir),
      returnHome: (dt) => this.brainReturnHome(d, dt),
      beginWindup: () => this.brainBeginWindup(d, frame),
      tickWindup: (dt) => this.brainTickWindup(d, frame, dt),
      releaseStrike: () => this.brainReleaseStrike(d, frame),
      cancelWindup: () => {
        d.state = "idle";
        d.stateT = 0;
      },
      continueCombo: () => this.brainContinueCombo(d),
      defend: () => this.brainDefend(d, frame.dir),
      beginCast: () => this.brainBeginCast(d),
      tickCast: (dt) => this.brainTickCast(d, dt),
      releaseCast: () => this.brainReleaseCast(d, frame),
      cancelCast: () => this.brainCancelCast(d),
      beginDeploy: () => this.brainBeginDeploy(d),
      tickDeploy: (dt) => this.brainTickDeploy(d, dt),
      releaseDeploy: () => this.brainReleaseDeploy(d, frame),
      cancelDeploy: () => this.brainCancelDeploy(d),
    };
    const agent: FighterAgent = {
      get bias() {
        return self.biasFor();
      },
      get reactionDelay() {
        return d.reactionDelay;
      },
      perception,
      actions,
    };
    d.frame = frame;
    d.perception = perception;
    d.agent = agent;
    d.brain = createFighterBrain(agent);
  }

  /** The active difficulty's bias weights (zeroed when passive). */
  private biasFor(): FighterBias {
    const p = this.difficulty === "passive" ? null : DIFFICULTY_PROFILES[this.difficulty];
    if (!p) return { aggression: 0, caution: 0, skillFrequency: 0 };
    return { aggression: p.aggression, caution: p.caution, skillFrequency: p.skillChance };
  }

  /** The active difficulty's engine tuning profile (null when passive). */
  private profileOrNull(): DifficultyProfile | null {
    return this.difficulty === "passive" ? null : DIFFICULTY_PROFILES[this.difficulty];
  }

  /** Smoothly rotate a fighter to face `dir` (turn rate scales with difficulty). */
  private faceToward(d: Dummy, dir: THREE.Vector3, dt: number): void {
    const desiredYaw = Math.atan2(dir.x, dir.z);
    const faceRate = this.difficulty === "hard" ? 12 : this.difficulty === "medium" ? 8 : 5;
    d.yaw = dampAngle(d.yaw, desiredYaw, faceRate, dt);
  }

  /** Step toward the target (guarded so knockback isn't fought). */
  private brainAdvance(d: Dummy, dir: THREE.Vector3, dt: number, mul: number): void {
    const p = this.profileOrNull();
    if (!p) return;
    d.state = "approach";
    if (d.vel.lengthSq() < 4)
      d.group.position.addScaledVector(dir, p.approachSpeed * (d.slowT > 0 ? d.slowMul : 1) * mul * dt);
  }

  /** Step away from the target to keep spacing. */
  private brainRetreat(d: Dummy, dir: THREE.Vector3, dt: number, mul: number): void {
    d.state = "idle";
    const p = this.profileOrNull();
    if (!p) return;
    if (d.vel.lengthSq() < 4)
      d.group.position.addScaledVector(dir, -p.approachSpeed * (d.slowT > 0 ? d.slowMul : 1) * mul * 0.4 * dt);
  }

  /**
   * Circle-strafe around the target to hold spacing without backpedalling.
   * `side` (+1/-1) picks the orbit direction; we step along the screen-flat
   * perpendicular of the facing dir. Guarded against knockback like the others.
   */
  private brainStrafe(d: Dummy, dir: THREE.Vector3, dt: number, side: number): void {
    d.state = "idle";
    const p = this.profileOrNull();
    if (!p) return;
    if (d.vel.lengthSq() >= 4) return;
    // Perpendicular of (dir.x, _, dir.z) on the ground plane.
    const perpX = -dir.z * side;
    const perpZ = dir.x * side;
    const speed = p.approachSpeed * (d.slowT > 0 ? d.slowMul : 1) * 0.55 * dt;
    d.group.position.x += perpX * speed;
    d.group.position.z += perpZ * speed;
  }

  /**
   * Commit a one-shot forward dash to close a gap-close-band target: a velocity
   * impulse along the facing dir so the existing dummy integration carries the
   * lunge (and reads as a committed gap-closer, not a glide).
   */
  private brainGapClose(d: Dummy, dir: THREE.Vector3): void {
    const p = this.profileOrNull();
    if (!p) return;
    d.state = "approach";
    // Only kick if not already mid-dash, so repeated calls don't stack speed.
    if (d.vel.lengthSq() < 4) {
      const dash = p.approachSpeed * 2.4;
      // Lead the dash toward where the target is heading so the gap-closer lands
      // in range against a strafing target instead of arriving behind it.
      const aimDir = dir.clone();
      if (d.aimTargetVel) aimDir.addScaledVector(d.aimTargetVel, GAPCLOSE_LEAD_TIME);
      aimDir.y = 0;
      if (aimDir.lengthSq() > 1e-4) aimDir.normalize();
      else aimDir.copy(dir);
      d.vel.x += aimDir.x * dash;
      d.vel.z += aimDir.z * dash;
      // Bear: a brief body-flash so the committed lunge-dash reads as a tell.
      if (d.modelKind === "bear") {
        d.flash = 0.25;
        d.flashColor.copy(WINDUP_COLOR);
      }
    }
  }

  /**
   * Host gate for combo chaining: extend the string only while there's stamina
   * to spend, scaled by the difficulty's aggression (harder = longer strings).
   */
  private brainContinueCombo(d: Dummy): boolean {
    const p = this.profileOrNull();
    if (!p) return false;
    if (d.cc.getStamina() / Math.max(1, d.maxStamina) < 0.25) return false;
    return Math.random() < Math.min(0.85, 0.35 * p.aggression + 0.2);
  }

  /** Drift back toward the home post (no hostile in play). */
  private brainReturnHome(d: Dummy, dt: number): void {
    d.state = "idle";
    const toHome = d.home.clone().sub(d.group.position);
    toHome.y = 0;
    if (d.vel.lengthSq() < 0.5) d.group.position.addScaledVector(toHome, Math.min(1, 2 * dt));
  }

  /** Enter the attack wind-up: telegraph + roll the skill flag from the profile. */
  private brainBeginWindup(d: Dummy, frame: FighterFrame): void {
    const p = this.profileOrNull();
    if (!p) return;
    d.state = "windup";
    d.stateT = p.windup;
    d.pendingSkill = Math.random() < p.skillChance;
    // Bear: pre-pick the next of its 3 rotating attacks so the telegraph length
    // matches the chosen attack's tell; its kit drives damage/AoE explicitly, so
    // clear the generic skill flag and stretch the wind-up by the attack's scale.
    if (d.modelKind === "bear") {
      const pick = nextBearAttack(d.bearAttackIndex ?? -1);
      d.bearAttackIndex = pick.index;
      d.pendingBearAttack = pick.attack;
      d.pendingSkill = false;
      d.stateT = p.windup * pick.attack.windupScale;
    }
    d.windupTotal = d.stateT;
    frame.ctx?.onWindup?.(this.chest(d), d.kind);
  }

  /** Advance the active wind-up, creeping in; returns true once it's ready to land. */
  private brainTickWindup(d: Dummy, frame: FighterFrame, dt: number): boolean {
    const p = this.profileOrNull();
    d.stateT -= dt;
    if (p && frame.dist > frame.combat.range[0])
      d.group.position.addScaledVector(frame.dir, p.approachSpeed * (d.slowT > 0 ? d.slowMul : 1) * 0.35 * dt);
    // Bear: blink-flash the body across ~2 beats so the incoming attack is
    // readable; the slam (AoE) tells in red, the rest in the standard wind-up hue.
    if (d.modelKind === "bear" && d.windupTotal) {
      const elapsed = d.windupTotal - Math.max(0, d.stateT);
      d.flash = 0.3 * telegraphBlink(elapsed, d.windupTotal, 2);
      d.flashColor.copy(d.pendingBearAttack && d.pendingBearAttack.radiusBonus > 0 ? FLASH_COLOR : WINDUP_COLOR);
    }
    return d.stateT <= 0;
  }

  /** Resolve the wound-up strike through the unchanged combat contract. */
  private brainReleaseStrike(d: Dummy, frame: FighterFrame): void {
    const p = this.profileOrNull();
    if (!p || !frame.ctx || !frame.target) {
      d.state = "idle";
      d.stateT = 0;
      return;
    }
    this.executeStrike(d, frame.dir, frame.dist, frame.combat, p, frame.ctx, frame.target);
  }

  /** Pick + commit a defensive move (parry/dodge/block) through the contract. */
  private brainDefend(d: Dummy, dir: THREE.Vector3): void {
    const r = Math.random();
    if (d.modelKind === "bear") {
      // The bear is a guard-heavy bruiser: it mostly blocks, occasionally dodges.
      d.pendingDefense = r < 0.7 ? "block" : "dodge";
    } else {
      // Favour the lateral dodge: it both evades AND creates spacing, so exchanges
      // read as footwork/skill rather than two fighters standing in a block trade.
      d.pendingDefense = r < 0.22 ? "parry" : r < 0.68 ? "dodge" : "block";
    }
    d.pendingDodgeDir = { x: -dir.z, z: dir.x };
    this.commitDefense(d, dir);
  }

  /**
   * Begin a ranged spell cast: pick one of the aimed spells and start the
   * charge-up. The cast tell mirrors the player's own casts — a spell-kind
   * coloured charge-up aura ({@link SparringContext.onCastCharge}) instead of
   * the generic melee wind-up burst — and the rig channels a cast/spell clip
   * rather than the melee "attack" swing. The aura is held for the full
   * {@link CAST_CHARGE} window so the incoming spell stays readable + dodgeable.
   */
  private brainBeginCast(d: Dummy): void {
    if (!this.profileOrNull()) return;
    d.state = "windup";
    d.castT = CAST_CHARGE;
    // Weapon-coherent projectile: ranged fighters loose a bolt, thrown fighters
    // hurl a blade volley, melee fighters fall back to a random flashy spell.
    d.pendingCastKind = d.castKind ?? SPELL_KINDS[(Math.random() * SPELL_KINDS.length) | 0];
    d.frame?.ctx?.onCastCharge?.(this.chest(d), d.pendingCastKind);
    // Channel a spell-cast clip during the charge (rigs without it no-op silently).
    d.avatar?.playClipOnce("cast");
  }

  /** Advance the cast charge; returns true once the projectile should fire. */
  private brainTickCast(d: Dummy, dt: number): boolean {
    d.castT -= dt;
    return d.castT <= 0;
  }

  /**
   * Fire the charged spell: route the projectile + VFX through the host
   * {@link SparringContext.castSpell} hook (homing onto the target's current
   * position), resolving a faction-aware AoE at the projectile's landing point
   * so a player who side-stepped the aim path dodges it. Sets a difficulty-scaled
   * cooldown so casts stay paced.
   */
  private brainReleaseCast(d: Dummy, frame: FighterFrame): void {
    const p = this.profileOrNull();
    const kind = d.pendingCastKind;
    const ctx = frame.ctx;
    if (!p || !kind || !ctx || !ctx.castSpell || !frame.target) {
      this.brainCancelCast(d);
      return;
    }
    const target = frame.target;
    const from = d.group.position.clone();
    const aim = target.pos.clone();
    // Lead a moving target: aim where it will be after the shot's flight so the
    // AI tracks a strafing player, capped to a fraction of the distance so a hard
    // juke still dodges it (predictive reach, not an undodgeable snap).
    if (d.aimTargetVel) {
      const lead = d.aimTargetVel.clone().multiplyScalar(CAST_LEAD_TIME);
      const cap = aim.distanceTo(from) * CAST_LEAD_FRACTION;
      if (lead.lengthSq() > cap * cap) lead.setLength(cap);
      aim.add(lead);
    }
    // Spell impact: a heavy skill-class hit (boss casts are unblockable like
    // their melee skills). Damage scales with difficulty + per-fighter multiplier.
    const damage = Math.round(14 * p.damageScale * d.damageMul);
    const radius = 2.4;
    const force = strikeForceLevel(d.arch === "boss", true);
    const pushFrom = this.chest(d);
    const { hitsPlayer, victimFaction } = aoeVictims(d.faction);
    const onImpact = (center: THREE.Vector3) => {
      if (hitsPlayer) {
        const result = ctx.dealToPlayer(center, radius, damage, force, pushFrom, kind, true);
        if (result && result.attackerReaction !== "none") d.cc.applyVulnerableState(result.attackerReaction);
      }
      this.blastFaction(center, radius, damage, force, victimFaction, ctx, force);
      ctx.onStrike?.(center, kind, radius, true);
    };
    // Release the spell with a magic-attack clip (not the melee swing); rigs
    // without the clip no-op silently.
    d.avatar?.playClipOnce("magicAttack");
    ctx.castSpell(kind, from, aim, onImpact);
    // Difficulty-scaled pacing: harder tiers (higher skillChance) recast sooner.
    // Weapon role scales it further — ranged fighters recast fast (shooting is
    // their primary game), melee keeps the long occasional-spell cadence.
    d.spellCd = (7 - 8 * p.skillChance) * (0.8 + Math.random() * 0.4) * d.castCdScale;
    d.state = "recover";
    d.stateT = 0.5;
    d.recoverT = d.stateT;
    d.pendingCastKind = null;
    d.castT = 0;
  }

  /** Abandon a half-charged cast (interrupted before the projectile fires). */
  private brainCancelCast(d: Dummy): void {
    d.pendingCastKind = null;
    d.castT = 0;
    if (d.state === "windup") {
      d.state = "idle";
      d.stateT = 0;
    }
  }

  /**
   * Begin deploying a turret: start the charge-up, reusing the wind-up telegraph
   * ({@link SparringContext.onWindup}) as the readable tell — the same aura the
   * host already draws for casts/skills.
   */
  private brainBeginDeploy(d: Dummy): void {
    if (!this.profileOrNull()) return;
    d.state = "windup";
    d.deployT = DEPLOY_CHARGE;
    d.frame?.ctx?.onWindup?.(this.chest(d), "turret");
  }

  /** Advance the deploy charge; returns true once the turret should drop. */
  private brainTickDeploy(d: Dummy, dt: number): boolean {
    d.deployT -= dt;
    return d.deployT <= 0;
  }

  /**
   * Drop the charged turret: register a live {@link ActiveTurret} (its firing +
   * faction-aware damage + cleanup are ticked in {@link updateTurrets}) and route
   * the standing-chassis VFX through {@link SparringContext.deployTurret}. Sets a
   * long, difficulty-scaled cooldown so the hazard stays an occasional play.
   */
  private brainReleaseDeploy(d: Dummy, frame: FighterFrame): void {
    const p = this.profileOrNull();
    const ctx = frame.ctx;
    if (!p || !ctx || !ctx.deployTurret || !ctx.turretBolt) {
      this.brainCancelDeploy(d);
      return;
    }
    const at = d.group.position.clone();
    at.y = 0;
    const face = frame.dir.lengthSq() > 1e-6 ? frame.dir.clone() : new THREE.Vector3(0, 0, 1);
    const dispose = ctx.deployTurret(at, face, TURRET_COLOR, TURRET_LIFE);
    const muzzle = at.clone();
    muzzle.y += 1.1;
    this.turrets.push({
      ownerId: d.id,
      faction: d.faction,
      muzzle,
      color: TURRET_COLOR,
      damage: Math.round(TURRET_SHOT_DAMAGE * p.damageScale * d.damageMul),
      // Light, blockable, dodgeable bolts (not a boss-skill unblockable hit).
      force: strikeForceLevel(false, false),
      age: 0,
      life: TURRET_LIFE,
      volleyT: 0.5,
      pending: 0,
      boltT: 0,
      dispose: dispose ?? (() => {}),
    });
    // Swing the rig as it deploys (rigs without a clip no-op silently).
    d.avatar?.playClipOnce("attack");
    d.turretCd = (16 - 14 * p.skillChance) * (0.85 + Math.random() * 0.3);
    d.state = "recover";
    d.stateT = 0.5;
    d.recoverT = d.stateT;
    d.deployT = 0;
  }

  /** Abandon a half-charged deploy (interrupted before the turret drops). */
  private brainCancelDeploy(d: Dummy): void {
    d.deployT = 0;
    if (d.state === "windup") {
      d.state = "idle";
      d.stateT = 0;
    }
  }

  /** True while this fighter already has a turret standing (one-at-a-time rule). */
  private hasTurret(ownerId: number): boolean {
    return this.turrets.some((t) => t.ownerId === ownerId);
  }

  /**
   * Tick every live AI-deployed turret: clean up turrets whose caster died /
   * despawned, whose life elapsed, or once combat goes passive (disposing the
   * chassis VFX), then fire staggered volleys at the current hostile, resolving
   * each dodgeable bolt's damage through the faction-aware combat path.
   */
  private updateTurrets(dt: number, ctx: SparringContext): void {
    for (let i = this.turrets.length - 1; i >= 0; i--) {
      const t = this.turrets[i];
      const owner = this.dummies.find((x) => x.id === t.ownerId);
      if (!owner || owner.dead || t.age >= t.life || this.difficulty === "passive") {
        t.dispose();
        this.turrets.splice(i, 1);
        continue;
      }
      t.age += dt;
      if (t.boltT > 0) t.boltT -= dt;
      t.volleyT -= dt;
      if (t.volleyT <= 0) {
        t.volleyT = TURRET_VOLLEY_GAP;
        t.pending = TURRET_VOLLEY;
      }
      if (t.pending > 0 && t.boltT <= 0) {
        this.fireTurretBolt(t, ctx);
        t.pending -= 1;
        t.boltT = TURRET_BOLT_GAP;
      }
    }
  }

  /**
   * Fire one turret bolt at the turret's current hostile (the player for an enemy
   * turret, else the nearest victim-faction fighter). The bolt is a slow, oversized
   * projectile that resolves a small AoE at its LANDING point — so a hostile that
   * has moved off the firing line dodges it — through the same faction-aware path
   * the AI's spell casts use.
   */
  private fireTurretBolt(t: ActiveTurret, ctx: SparringContext): void {
    if (!ctx.turretBolt) return;
    const { hitsPlayer, victimFaction } = aoeVictims(t.faction);
    const aim = new THREE.Vector3();
    if (hitsPlayer && ctx.playerAlive) {
      aim.copy(ctx.playerPos);
    } else {
      const victim = this.nearestOfFaction(t.muzzle, victimFaction);
      if (!victim) return;
      aim.copy(victim);
    }
    aim.y += 0.9;
    const dir = aim.clone().sub(t.muzzle);
    const dist = dir.length();
    if (dist < 1e-3) return;
    dir.multiplyScalar(1 / dist);
    const radius = TURRET_BOLT_RADIUS;
    const from = t.muzzle.clone();
    ctx.turretBolt(from.clone(), dir, dist, t.color, (p) => {
      if (hitsPlayer) {
        const result = ctx.dealToPlayer(p, radius, t.damage, t.force, from.clone(), "turret", false);
        // (Turret bolts have no live caster CC to punish, so no vulnerable-state
        // reaction is applied — the deployer may have moved or died.)
        void result;
      }
      this.blastFaction(p, radius, t.damage, t.force, victimFaction, ctx, t.force);
    });
  }

  /** Chest position of the nearest living fighter of `faction` to `from`, or null. */
  private nearestOfFaction(from: THREE.Vector3, faction: Faction): THREE.Vector3 | null {
    const tmp = new THREE.Vector3();
    let best: Dummy | null = null;
    let bestD = Infinity;
    for (const d of this.dummies) {
      if (d.dead || d.faction !== faction) continue;
      const dd = this.chest(d, tmp).distanceToSquared(from);
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    return best ? this.chest(best) : null;
  }

  /**
   * Refresh the fighter's perception snapshot, then let its goal-driven brain
   * arbitrate + drive behaviour for the frame. The decision layer lives entirely
   * in the brain ({@link createFighterBrain}); this only bridges world → brain.
   */
  private updateAi(d: Dummy, dt: number, ctx: SparringContext) {
    const cs = d.cc.getState();
    // Hitstun / committed defensive moves: the CC owns the body — stand down.
    // Drop any in-flight intent so an interrupted wind-up can't resume from a
    // stale timer (its `terminate()` unwinds a half-committed strike); the next
    // free frame re-arbitrates and re-telegraphs from scratch.
    if (isBusyState(cs)) {
      d.brain!.reset();
      d.state = "idle";
      return;
    }

    const target = this.hostileTarget(d, ctx);
    const frame = d.frame!;
    const p = d.perception!;
    frame.ctx = ctx;
    frame.target = target;
    frame.combat = weaponCombat(d.weaponId);

    if (!target) {
      p.hasTarget = false;
      d.brain!.process(dt);
      return;
    }

    const to = target.pos.clone().sub(d.group.position);
    to.y = 0;
    const dist = to.length();
    const dir = dist > 1e-4 ? to.clone().multiplyScalar(1 / dist) : new THREE.Vector3(0, 0, 1);
    frame.dir.copy(dir);
    frame.dist = dist;

    // Estimate the target's planar velocity (smoothed) so ranged casts and the
    // dash gap-closer can LEAD a moving target instead of aiming where it just
    // was — the "reaching targets with timing" the AI needs to land hits. The
    // estimate is reset on a target swap so the position jump between two
    // different targets can't spike the lead vector for a frame.
    const targetId = target.dummy ? target.dummy.id : -1;
    if (dt > 1e-4) {
      if (d.aimPrevTarget && d.aimTargetVel && d.aimTargetId === targetId) {
        const inst = target.pos.clone().sub(d.aimPrevTarget).multiplyScalar(1 / dt);
        inst.y = 0;
        d.aimTargetVel.lerp(inst, 0.3);
        d.aimPrevTarget.copy(target.pos);
      } else {
        d.aimPrevTarget = target.pos.clone();
        d.aimTargetVel = new THREE.Vector3();
        d.aimTargetId = targetId;
      }
    }

    // Engagement envelope is derived from the weapon's category hold-style fight
    // band (`fightBand`), padded by body size (SPACING_SCALE) so it grows with the
    // canonical fighter height. Melee/magic space at their strike reach; RANGED
    // holds its true kiting distance rather than walking into melee range.
    const band = fightBand(getWeapon(d.weaponId));
    const engage = band[1] + 0.45 * SPACING_SCALE;
    p.hasTarget = true;
    p.distance = dist;
    p.engageRange = engage;
    p.innerRange = band[0];
    // Weapon-derived ranged envelope + combo cap (set once at spawn): ranged
    // fighters reach far and never chain a melee string, melee chain by family.
    p.spellRange = d.spellRange;
    p.comboMax = d.comboMax;
    // Gap-close band: one committed dash (~2.2m, body-scaled) past engage reach.
    p.lungeRange = engage + 2.2 * SPACING_SCALE;
    p.targetWindingUp = !!(target.dummy && target.dummy.state === "windup");
    // A whiffing/recovering target is a punish window: a dummy in its post-swing
    // recover beat (durable `recoverT`, not the transient `state`), or the player
    // locked in offense-fail recovery.
    p.targetRecovering = target.dummy
      ? target.dummy.recoverT > 0
      : !!ctx.playerRecovering;
    p.attackReady = d.attackCd <= 0;
    p.canDefend = d.shieldBreakT <= 0 && d.defendCd <= 0;
    p.health01 = d.cc.getHealth() / Math.max(1, d.maxHealth);
    p.stamina01 = d.cc.getStamina() / Math.max(1, d.maxStamina);
    p.poise01 = d.cc.getPoise() / Math.max(1, d.maxPoise);
    // Spell readiness is paced entirely host-side: off its difficulty-scaled
    // cooldown, with stamina to spare, and only when a cast sink is wired and
    // the fighter is hostile (never passive).
    p.spellReady =
      d.spellCd <= 0 &&
      p.stamina01 > 0.3 &&
      !!ctx.castSpell &&
      this.difficulty !== "passive";
    // Turret readiness is paced the same way but one-at-a-time: off its (longer)
    // cooldown, with stamina, a deploy sink wired, hostile, and no turret of its
    // own already standing.
    p.turretReady =
      d.turretCd <= 0 &&
      p.stamina01 > 0.3 &&
      !!ctx.deployTurret &&
      !!ctx.turretBolt &&
      this.difficulty !== "passive" &&
      !this.hasTurret(d.id);

    // Block-bounce stylish flip recover (AI Space equivalent)
    if (d.blockFlipT > 0) {
      d.blockFlipT -= dt;
      if (d.blockFlipT <= 0) this.doBlockBounceFlip(d);
    }

    // Holding a proactively-raised block: keep facing, drop it when it expires.
    // (The brain commits the block; this rides out its hold window.)
    if (cs === "block") {
      this.faceToward(d, dir, dt);
      d.blockHold -= dt;
      if (d.blockHold <= 0) {
        d.cc.endBlock();
        d.avatar?.setBlock(false);
      }
      d.state = "idle";
      return;
    }

    d.brain!.process(dt);
  }

  /**
   * Which side of the AI's guard an incoming hit came from, relative to its
   * facing (`d.yaw`): a blow off to the left/right plays the directional guard
   * react, a head-on blow plays the frontal one.
   */
  private guardSide(d: Dummy, source: THREE.Vector3): "left" | "right" | "front" {
    const to = source.clone().sub(d.group.position);
    to.y = 0;
    if (to.lengthSq() < 1e-4) return "front";
    // Facing forward = (sin yaw, 0, cos yaw); player-right basis = (-fwd.z, 0, fwd.x).
    const fx = Math.sin(d.yaw);
    const fz = Math.cos(d.yaw);
    const lateral = (to.x * -fz + to.z * fx) / Math.hypot(to.x, to.z);
    if (lateral > 0.35) return "right";
    if (lateral < -0.35) return "left";
    return "front";
  }

  /**
   * Commit the staged defensive move (`d.pendingDefense`) into the CC + the rig.
   * Shared by the legacy instant path and the duel reaction-gate path so both
   * stay in lockstep with their per-kind cooldowns and avatar one-shots.
   */
  private commitDefense(d: Dummy, dir: THREE.Vector3): void {
    const kind = d.pendingDefense ?? "block";
    // Proactive defense clips come from the defender's hold-style standard, so a
    // ranged fighter back-steps (its category `dodge`) while melee rolls/spins —
    // the SAME source the player's defense reads from.
    const def = defenseClips(getWeapon(d.weaponId).group);
    if (kind === "parry") {
      d.cc.parry();
      d.defendCd = 1.4;
      d.avatar?.playClipOnce(def.parry);
    } else if (kind === "dodge") {
      const side = d.pendingDodgeDir ?? { x: -dir.z, z: dir.x };
      d.cc.dodge(side);
      d.vel.addScaledVector(new THREE.Vector3(side.x, 0, side.z), 4 * (Math.random() < 0.5 ? 1 : -1));
      d.defendCd = 1.2;
      d.avatar?.playClipOnce(def.dodge);
    } else {
      d.cc.startBlock();
      d.blockHold = 0.5 + Math.random() * 0.5;
      d.defendCd = 1.0;
      d.avatar?.setBlock(true);
    }
    d.pendingDefense = undefined;
    d.pendingDodgeDir = undefined;
  }

  /** Resolve an opponent's wind-up into a real strike against its target. */
  private executeStrike(
    d: Dummy,
    dir: THREE.Vector3,
    dist: number,
    combat: ReturnType<typeof weaponCombat>,
    profile: DifficultyProfile,
    ctx: SparringContext,
    target: { pos: THREE.Vector3; dummy: Dummy | null },
  ) {
    // Bear kit: the attack was pre-picked at wind-up (so the telegraph length
    // matched it). Apply its damage/reach/area mods here; its slam (radiusBonus>0)
    // routes through the same ground-telegraph AoE path as a skill swing.
    const bear = d.pendingBearAttack;
    // Avatar fighters swing their rig as the strike resolves. Capture the real
    // clip duration so heavy weapons (axe/greatsword/hammer with long swings)
    // don't get their animation cut off by a fixed recover/cooldown beat. The
    // heavy bear is a model dummy (no avatar): play its distinct per-attack
    // procedural body motion instead and time the recover off that.
    const swingDur =
      d.avatar?.playClipOnce("attack") ?? (bear ? (d.model?.attack?.(bear.name) ?? 0) : 0);
    // Bear: fire the wind-up whoosh as the swing body motion kicks off (the land
    // impact cue is fired below at hit time, deferred for the slam's telegraph).
    if (bear) ctx.onBearAttack?.(this.chest(d), bear, "swing");
    const strike = meleeStrike(combat, { skill: d.pendingSkill, skillForce: 12, damageScale: profile.damageScale * d.damageMul });
    if (bear) {
      strike.damage *= bear.damageMul;
      strike.reach += bear.reachBonus;
      strike.radius += bear.radiusBonus;
    }
    // Respect-through-range (symmetric with the player): scale a BASIC swing by
    // how well this attacker is using its weapon's optimal range. A poke from
    // bad spacing lands weak; a clean strike in-band lands full. Telegraphed
    // skill/AoE swings are special attacks and keep their full authored damage.
    if (!d.pendingSkill) {
      const attackerOWR = weaponOWR(combat, getWeapon(d.weaponId).group, SPACING_SCALE);
      const defenderOWR = weaponOWR(undefined, "melee-1h", SPACING_SCALE);
      const verdict = classifyEngagement({ dist, attacker: attackerOWR, defender: defenderOWR });
      // Apply the verdict multiplier UNCONDITIONALLY so the OWR contract holds
      // symmetrically with the player: a whiff-distance basic swing (damageMul 0)
      // deals nothing rather than leaning on geometry falloff to soften it.
      strike.damage *= verdict.damageMul;
      // Spacing-disadvantage punish: an AI that crowds inside its own optimal
      // band is briefly exposed, mirroring the player's free-counter window.
      if (verdict.staggerLock) d.recoverT = Math.max(d.recoverT, 0.3);
    }
    d.vel.addScaledVector(dir, 4 + 4 * (combat.intensity / 100));
    const center = d.group.position.clone().addScaledVector(dir, Math.min(dist, strike.reach));
    center.y += 1.0;
    // Bosses' skill swings are UNBLOCKABLE (force 4): block leaks full damage,
    // parry only halves — only a clean dodge fully evades. Regular skill swings
    // are heavy (force 2); basic swings are light (force 1).
    const forceLevel = bear ? bear.force : strikeForceLevel(d.arch === "boss", d.pendingSkill);
    const payload: AttackPayload = {
      force: forceLevel,
      damage: strike.damage,
      poiseDamage: Math.round(strike.damage * 0.6 * (bear ? bear.poiseMul : 1)),
    };
    // Skill swings carry the enlarged area radius (meleeStrike adds +0.6 m for a
    // skill) — these ARE the "AOE attacks" the spec wants telegraphed. Basic
    // swings stay instant single-target melee. Boss skills are the unblockable
    // subset (force 4) but telegraph through the same path.
    // Capture the skill flag now: the AoE resolve runs ~1 s later (after the
    // telegraph), by which point `d.pendingSkill` has been reset for the next
    // swing — the deferred closures must see the value from THIS strike.
    // An "AoE" telegraphed strike is either a skill swing OR the bear's slam.
    const wasSkill = d.pendingSkill;
    const aoe = wasSkill || (!!bear && bear.radiusBonus > 0);
    const from = this.chest(d);
    const dealToPlayer = () => {
      // NPC-vs-player: the Studio resolves it against the player CC and returns
      // the result so we can punish a parried/dodge-punished attacker.
      const result = ctx.dealToPlayer(center, strike.radius, strike.damage, strike.force, from, d.kind, aoe);
      if (result && result.attackerReaction !== "none") d.cc.applyVulnerableState(result.attackerReaction);
    };
    // Resolve an AoE at impact time, FACTION-AWARE: an enemy skill hits the player
    // + allied units, an ally skill hits enemy units only (never the player). Damage
    // EVERYONE of the victim faction still inside the circle AND fire the impact VFX,
    // so the visual and the damage land together at the end of the telegraph rather
    // than when it was scheduled. `forceLevel` is carried through so a telegraphed
    // boss skill stays unblockable. Both resolvers are radius-aware (aoeFalloff), so
    // combatants outside the circle take nothing.
    const { hitsPlayer, victimFaction } = aoeVictims(d.faction);
    const resolveAoe = () => {
      if (hitsPlayer) dealToPlayer();
      this.blastFaction(center, strike.radius, strike.damage, strike.force, victimFaction, ctx, forceLevel);
      ctx.onStrike?.(center, d.kind, strike.radius, aoe);
      // Bear slam lands here (deferred behind its ground telegraph): a heavier
      // impact cue (thud + ground shock) than the single-target swipe/maul.
      if (bear) ctx.onBearAttack?.(center, bear, "land");
    };
    if (aoe && ctx.telegraph) {
      // AoE/boss skill (or bear slam): telegraph the ground circle regardless of
      // which entity was initially wound up on (player OR ally), resolve on impact.
      ctx.telegraph(center, strike.radius, resolveAoe);
    } else if (target.dummy) {
      // NPC-vs-NPC basic swing: resolve against the target CC (block/parry/dodge).
      this.hit(target.dummy, payload, this.chest(d), strike.force, d.cc, ctx);
      ctx.onStrike?.(center, d.kind, strike.radius, aoe);
      if (bear) ctx.onBearAttack?.(center, bear, "land");
    } else {
      // Basic swing at the player: instant single-target melee.
      dealToPlayer();
      ctx.onStrike?.(center, d.kind, strike.radius, aoe);
      if (bear) ctx.onBearAttack?.(center, bear, "land");
    }
    d.state = "recover";
    // Ride the recover beat + cooldown off the real swing clip length so long
    // heavy-weapon animations play out fully (axe/greatsword/hammer) instead of
    // snapping back to idle mid-swing. Light weapons keep the snappy defaults.
    d.stateT = Math.max(0.35, swingDur * 0.5);
    // Durable punish-window timer mirroring the recover beat (read by opponents
    // as `targetRecovering`); independent of `state`, which movement overwrites.
    d.recoverT = d.stateT;
    d.attackCd = Math.max(profile.attackInterval * (0.8 + Math.random() * 0.4), swingDur * 0.9);
    d.pendingSkill = false;
    d.pendingBearAttack = undefined;
  }

  /**
   * Apply an intensified visual/physical reaction to the nearest alive dummy
   * (within 3 m), simulating stagger / stunned / fallen from a defensive break.
   * Drives the matching CC vulnerable state so visuals + combat stay unified.
   */
  reactAt(nearPos: THREE.Vector3, reaction: "stagger" | "stunned" | "fallen"): void {
    const tmp = new THREE.Vector3();
    let nearest: Dummy | null = null;
    let nearestDist = Infinity;
    for (const d of this.dummies) {
      if (d.dead) continue;
      const dist = this.chest(d, tmp).distanceTo(nearPos);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = d;
      }
    }
    if (!nearest || nearestDist > 3.0) return;
    if (reaction === "fallen") {
      const outDir = new THREE.Vector3(Math.random() - 0.5, 0.4, Math.random() - 0.5).normalize();
      nearest.vel.addScaledVector(outDir, 5.0);
      nearest.flash = 0.8;
    } else if (reaction === "stunned") {
      const outDir = new THREE.Vector3(Math.random() - 0.5, 0.3, Math.random() - 0.5).normalize();
      nearest.vel.addScaledVector(outDir, 3.5);
      nearest.flash = 0.6;
    } else {
      const outDir = new THREE.Vector3(Math.random() - 0.5, 0.15, Math.random() - 0.5).normalize();
      nearest.vel.addScaledVector(outDir, 2.0);
      nearest.flash = 0.35;
    }
  }

  /** Mark fighter dead — flesh corpse for 2 min, then skeleton residual. */
  private markDead(d: Dummy): void {
    d.dead = true;
    d.isSkeleton = false;
    d.respawn = CORPSE_TO_SKELETON_S + SKELETON_LINGER_S;
    this.onDeath?.(this.chest(d));
  }

  private async toSkeleton(d: Dummy): Promise<void> {
    if (!d.dead || d.isSkeleton) return;
    d.isSkeleton = true;
    // Hide flesh visuals
    d.body.visible = false;
    d.head.visible = false;
    d.accent.visible = false;
    if (d.avatar) {
      try {
        d.avatar.root.visible = false;
      } catch {
        /* avatar may not expose root */
      }
    }
    if (d.model) {
      try {
        (d.model as { root?: THREE.Object3D }).root &&
          ((d.model as { root: THREE.Object3D }).root.visible = false);
      } catch {
        /* ignore */
      }
    }
    d.group.visible = true;
    d.group.rotation.set(0, d.yaw, 0);
    const skel = await createSkeletonCorpse({
      position: new THREE.Vector3(0, 0, 0),
      yaw: d.yaw,
      scale: 1,
      variant: d.combatRole === "ranged" ? "archer" : "humanoid",
      lieDown: true,
    });
    if (skel) {
      d.group.add(skel);
      d.skeletonRoot = skel;
    }
  }

  private revive(d: Dummy) {
    d.dead = false;
    d.isSkeleton = false;
    if (d.skeletonRoot) {
      d.group.remove(d.skeletonRoot);
      d.skeletonRoot = null;
    }
    d.body.visible = true;
    d.head.visible = true;
    d.accent.visible = true;
    if (d.avatar) {
      try {
        d.avatar.root.visible = true;
      } catch {
        /* ignore */
      }
    }
    // Fresh CC so health/poise/stamina/crit all reset cleanly.
    d.cc = makeFighterCC(d.arch, {}, d.maxHealth ? { maxHealth: d.maxHealth } : {});
    d.lastState = "idle";
    // Drop any in-flight knock-up so a fighter killed mid-air doesn't land back
    // into a forced knock-down on its next life.
    d.launchPhase = undefined;
    d.vel.set(0, 0, 0);
    d.tilt.set(0, 0, 0);
    d.flash = 0;
    d.respawn = 0;
    d.yaw = 0;
    d.state = "idle";
    d.stateT = 0;
    d.attackCd = 0.6 + Math.random() * 1.2;
    d.defendCd = 0;
    d.blockHold = 0;
    d.blockFlipT = 0;
    // Stagger spell readiness again so a revived fighter doesn't instantly cast
    // (role-scaled so ranged fighters resume shooting promptly).
    d.spellCd = (3 + Math.random() * 4) * d.castCdScale;
    d.castT = 0;
    d.pendingCastKind = null;
    d.stunT = 0;
    d.shieldBreakT = 0;
    d.slowT = 0;
    d.slowMul = 1;
    // Reset the goal-driven brain + staged defense for a clean next life.
    d.brain?.reset();
    d.pendingDefense = undefined;
    d.pendingDodgeDir = undefined;
    d.deathPlayed = false;
    d.group.position.copy(d.home);
    d.group.rotation.set(0, 0, 0);
    d.mat.emissive.copy(REST_EMISSIVE);
    if (d.avatar) d.avatar.playRole("idle");
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    this.baseMat.dispose();
    this.outlineMat.dispose();
    this.allyOutlineMat.dispose();
    for (const t of this.turrets) t.dispose();
    this.turrets.length = 0;
    for (const d of this.dummies) {
      this.disposeAvatar(d);
      this.disposeModel(d);
      for (const m of d.ownMats) m.dispose();
      this.disposeBoss(d);
    }
    this.dummyModels.dispose();
    this.group.clear();
    this.group.parent?.remove(this.group);
    this.dummies.length = 0;
  }
}

/** Critically-damped angular interpolation that wraps correctly across ±PI. */
function dampAngle(current: number, target: number, rate: number, dt: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * Math.min(1, rate * dt);
}
