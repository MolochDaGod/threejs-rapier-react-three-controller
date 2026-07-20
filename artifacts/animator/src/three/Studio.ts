import * as THREE from "three";
import { DangerRoom } from "./DangerRoom";
import {
  asRoomPresetId,
  BACKDROPS,
  loadBackdrop,
  loadRoomPreset,
  ROOM_PRESETS,
  saveBackdrop,
  type RoomPresetId,
} from "./RoomPresets";
import { DUNGEON_MAPS, loadDungeonMap } from "./DungeonMaps";
import { addStudioLights, STUDIO_FOG, STUDIO_TONE_MAPPING_EXPOSURE } from "./studioLighting";
import { DjBooth } from "./DjBooth";
import { CastRuneStones } from "./fx/CastRuneStones";
import { Character } from "./Character";
import { ExplorerCharacter } from "./ExplorerCharacter";
import { GrudgeAvatar } from "./grudge/GrudgeAvatar";
import type { PresetId, RaceId } from "./grudge";
import { Controller } from "./Controller";
import { Recoil, fovKick, screenCenterRay } from "./aim/AimSystem";
import { leadTarget } from "./anim/predictiveLead";
import { Vfx } from "./Vfx";
import { AbilityOrchestrator } from "./abilities/abilityOrchestrator";
import { deployAbility, getAbility, kitAbility, statusAbility, vfxSkill } from "./abilities/abilityRegistry";
import { dispatchStatusRouting, routeStatusScope } from "./abilities/statusScopeRouting";
import type { AbilityDef, StatusScope } from "./abilities/abilityTypes";
import {
  BEAR_TRAP_COOLDOWN,
  BEAR_TRAP_LIFE_SEC,
  BEAR_TRAP_MODEL,
  BEAR_TRAP_RADIUS_M,
  BEAR_TRAP_STUN_SEC,
  canSeeBearTrap,
  enemyInBearTrapZone,
} from "./combat/bearTrap";
import { CombatSfx } from "./audio/CombatSfx";
import { assetUrl } from "./assetHost";
import { assertStation } from "./audio/radioStations";
import { MechSystem } from "./mech/MechSystem";
import { MechReconciler, MECH_PITCH_MIN, MECH_PITCH_MAX } from "./mech/mechReconcile";
import {
  Targets,
  type CombatTargets,
  type TargetHandle,
  type SparringContext,
  STUN_SECONDS,
  SHIELD_BREAK_SECONDS,
} from "./Targets";
import type { BearAttack } from "./bear/bearAttacks";
import { Duel } from "./Duel";
import { AleBot } from "./ale/AleBot";
import type { AleCameraMode, ReplayFrequency } from "./types";
import { invalidateTargetPortrait, requestTargetPortrait } from "./targetPortraits";
import { Dungeon } from "./dungeon/Dungeon";
import { DungeonEnemies } from "./dungeon/DungeonEnemies";
import { DungeonHazards } from "./dungeon/DungeonHazards";
import { isInWaterBand, traversalModeFor } from "./dungeon/water";
import { groundProbeAt, type NavGrid } from "./dungeon/navmesh";
import { WildlifeSystem, type HarvestDrop } from "./wildlife";
import { CastController, type SkillPreset } from "./cast";
import { iceSnakeById, iceSnakeForWeapon } from "./vfx/iceSnakeVariants";
import type { GroundSampler } from "./anim/legIk";
import { VoxelArena } from "./voxel/VoxelArena";
import type { VoxelMap } from "./voxel/types";
import { type ReadinessSnapshot } from "./loading/readiness";
import { BootGate } from "./loading/bootGate";
import { PhysicsSystem } from "./PhysicsSystem";
import { PunchingBags } from "./PunchingBags";
import {
  aoeFalloff,
  meleeStrike,
  preferSelectedHostile,
  weaponOWR,
  classifyEngagement,
  fireComboStep,
  type RangeOutcome,
} from "./combat";
import { StatusController, STATUS_DEFS } from "./fx/StatusFx";
import { TargetIndicators, TelegraphField } from "./fx/Indicators";
import { InputState } from "./input";
import { mountWeaponModel, unmountWeapon, type MountedWeapon } from "./Weapons";
import { applyWeaponTuning } from "./weaponTuning";
import { BladeCollisionSystem, type BladeContact } from "./combat/BladeCollisionSystem";
import { MaceThrowMachine, type MaceThrowEvent } from "./mace/maceThrow";
import type { FireFxParams } from "./fxSettings";
import { loadSound, saveSound, type SoundSettings } from "./soundSettings";
import { loadControls, saveControls } from "./controlsSettings";
import { getCharacter, getWeapon, weaponCombat } from "./assets";
import { offHandEligible } from "./arsenal";
import { ELEMENT_THEME } from "./arsenal/elements";
import type { StaffElement } from "./types";
import { defenseClips, defenseOutcomeClip, guardedHitClip, vulnerableReactionClip } from "./arsenal/holdStyle";
import type { WeaponGroup } from "./arsenal/types";
import type { ActionKey } from "./explorer/types";
import type { VulnerableState } from "@workspace/epicfight";
import { SKILL_KIND_ICON } from "./icons";
import { PLAYER_HEADBUTT_PAYLOAD, PLAYER_HEAVY_PAYLOAD, PLAYER_STOMP_PAYLOAD, SparringCombat } from "./SparringCombat";
import { isDefended, outcomeForceScale } from "./combatModel";
import type { AttackPayload, DefensiveResult } from "@workspace/epicfight";
import { RemoteAvatar } from "./RemoteAvatar";
import type { DangerClient } from "../net/DangerClient";
import {
  STATE_REPORT_MS,
  type CombatEvent,
  type GuardState,
  type PlayerSnapshot,
  type PlayerState,
  type NpcState,
} from "@workspace/danger-net";
import {
  CHARACTER_HEIGHT_M,
  DEFAULT_EDITOR,
  type ActionSlot,
  type Avatar,
  type Difficulty,
  type DuelState,
  type EditorParams,
  type Faction,
  type HudSnapshot,
  type KickSkill,
  type KiterKit,
  type ArcaneKit,
  type TankKit,
  type SkillKind,
  type SlotBinding,
  type StatusId,
  type StrikerCombat,
  type WeaponCombat,
  type WeaponId,
} from "./types";

/** localStorage key for per-character action-slot clip overrides. */
const SLOTS_KEY = "dangerroom:slots";

type SlotMap = Partial<Record<ActionSlot, string>>;

/** Action slots in HUD order, with the input that triggers them. */
const SLOT_META: { slot: ActionSlot; key: string }[] = [
  { slot: "primary", key: "LMB" },
  { slot: "fskill", key: "F" },
  { slot: "sig1", key: "1" },
  { slot: "sig2", key: "2" },
  { slot: "sig3", key: "3" },
  { slot: "sig4", key: "4" },
];

/** Seconds a combo stays chainable after a hit before resetting to hit 0. */
const COMBO_WINDOW = 0.9;

/**
 * Fraction of a swing's real clip duration the combo stays LOCKED before the
 * next hit can chain. Tying the lock to the actual clip length (instead of a
 * fixed ~0.2s) lets each swing play most of the way through — no more truncated
 * "half" hits — while still chaining responsively near the end of the motion.
 */
const COMBO_PLAYTHROUGH = 0.68;

/**
 * Grace (s) added on top of a swing's clip duration during which the next hit
 * still chains before the combo resets to hit 0. Keeps chaining forgiving once
 * the lock lifts.
 */
const COMBO_GRACE = 0.42;

/** Radius (m) an area-of-effect friendly cast splashes its buff onto nearby allies. */
const FRIENDLY_AOE_RADIUS = 6;
/** Max planar distance the Stomp finisher will leap to reach a downed enemy. */
const STOMP_REACH = 3.2;

/** Seconds the Striker kick combo stays chainable (slightly looser than the weapon combo). */
const KICK_COMBO_WINDOW = 1.0;

/** Default arcane bolt colour for a staff with no element (the plain Arcane Staff). */
const STAFF_ARCANE_COLOR = 0xb98cff;
/** Steady-poke cooldown between staff LMB bolts (seconds). */
const STAFF_BOLT_CD = 0.34;
/**
 * Representative travel speeds (m/s) of the player's aimed projectiles, used only
 * to compute a predictive lead point against a moving target — the VFX own the
 * actual flight. Staff spline ~ arc-fast; fire dragon matches `castDragonAt`'s 20.
 */
const STAFF_BOLT_SPEED = 26;
const FIRE_PROJ_SPEED = 20;
/** How far ahead of a target a lead may sit, as a fraction of shooter→target distance (juke-beatable). */
const PROJ_LEAD_FRACTION = 0.5;
/** Levitation float duration a staff double-jump grants (seconds). */
const STAFF_FLOAT_SECONDS = 2.0;

/**
 * Striker per-signature-skill cooldowns in seconds.
 * [sig0 Flanchet Shot, sig1 Launch Kick, sig2 Flame Tornado, sig3 Hover]
 */
const STRIKER_SIG_CD = [2.5, 5.0, 6.0, 7.0] as const;

/** Stamina costs for each Striker signature skill (parallel to STRIKER_SIG_CD). */
const STRIKER_SIG_ST = [12, 20, 25, 15] as const;

/**
 * Pistol "Kiter" (Gunslinger) per-signature-skill cooldowns in seconds.
 * [sig0 Quick Draw, sig1 Smoke Phantom, sig2 Bear Trap, sig3 Hexaring Beam]
 */
const PISTOL_SIG_CD = [3.0, 30.0, 12.0, 16.0] as const;

/** Stamina costs for each Kiter signature skill (parallel to PISTOL_SIG_CD). */
const PISTOL_SIG_ST = [10, 25, 18, 22] as const;

/** Independent cooldowns (s) for the Soulbinder's arcane-staff signature slots. */
const ARCANE_SIG_CD = [4.0, 7.0, 11.0, 14.0] as const;
/** Stamina costs for each arcane signature skill (parallel to ARCANE_SIG_CD). */
const ARCANE_SIG_ST = [8, 16, 20, 24] as const;

/**
 * Gunblade "Tank" (Centurion) per-signature-skill cooldowns in seconds.
 * [sig0 Shield Charge, sig1 Shield Bash, sig2 Blade Flurry, sig3 Super Cannon]
 */
const TANK_SIG_CD = [6.0, 4.0, 8.0, 20.0] as const;
/** Stamina costs for each Tank signature skill (parallel to TANK_SIG_CD). */
const TANK_SIG_ST = [16, 10, 18, 30] as const;

/**
 * Flanged-Mace signature throw (slot 4): a quick throw that stuns the struck
 * target then returns to hand, or — on a re-press while the mace is out — a
 * dash-recall gap-closer. Mace-only; lives on its own per-slot cooldown.
 */
const MACE_THROW_CD = 6.0;
const MACE_THROW_ST = 16;
/** Stun duration (s) applied to the struck target. */
const MACE_THROW_STUN = 1.0;
/** Stun + light-damage radius (m) around the mace's landing point. */
const MACE_THROW_RADIUS = 2.2;
/** Modest impact damage the thrown mace deals on landing. */
const MACE_THROW_DAMAGE = 18;
/** Steel-grey tint for the mace's impact VFX. */
const MACE_THROW_COLOR = 0xc8cdd6;

/**
 * Exo-Armour Mech bespoke kit. Three abilities distinct from the pilot's on-foot
 * combat, only usable while sealed inside the armour. Parallel to `mechCds` and
 * the HUD's mech ability bar:
 *  - 0 Seismic Stomp  (F)  — close ground-pound that LAUNCHES nearby foes.
 *  - 1 Plasma Cannon  (1)  — charged forward beam blast that hits a target at range.
 *  - 2 Grapple Throw  (2)  — grab the foe in front and hurl it for an impact AoE.
 * Keys mirror the on-foot bar: F = no signatureIndex, 1/2 = signatureIndex 0/1.
 */
const MECH_ABILITIES = [
  { key: "F", name: "Seismic Stomp", icon: "charge", cd: 5.0 },
  { key: "1", name: "Plasma Cannon", icon: "scout", cd: 7.0 },
  { key: "2", name: "Grapple Throw", icon: "siege", cd: 6.0 },
] as const;

/**
 * Deployed-turret tuning. A turret stands for `TURRET_LIFE` seconds and, every
 * `TURRET_VOLLEY_GAP` seconds, fires a burst of `TURRET_VOLLEY` slow, oversized
 * bolts at the CLOSEST living enemy. The bolts travel to where the enemy was when
 * fired (no homing) at 50% of the player's bullet speed and 150% of its size, so
 * a moving target can dodge them. Deals collision damage on arrival.
 */
const TURRET_LIFE = 6.0;
const TURRET_VOLLEY = 3;
const TURRET_VOLLEY_GAP = 1.4;
const TURRET_BOLT_SPEED = 24; // 50% of the kiter's 48-speed primary bullet
const TURRET_BOLT_SCALE = 1.5; // 150% of the player's bolt size
const TURRET_SHOT_DAMAGE = 9;
const TURRET_COLOR = 0x8fd0ff;

/**
 * Deployed snare-field tuning. A second user of the deploy ability lifecycle (the
 * zone-control counterpart to the turret): a tar-pit zone that stands for
 * `SNARE_FIELD_LIFE` seconds and, every `SNARE_FIELD_PULSE_GAP` seconds,
 * re-snares every living enemy inside `SNARE_FIELD_RADIUS` — a movement slow plus
 * modest chip damage. The slow lasts a touch longer than a pulse gap so an enemy
 * standing in the field stays continuously snared, and is re-applied each pulse so
 * a target that just wandered in is caught and one that left is released when its
 * slow times out. The deploy schedule (life / first pulse / gap / tail) is seeded
 * + tested in the pure ability registry (`deploy:snareField`).
 */
const SNARE_FIELD_RADIUS = 3.0;
const SNARE_FIELD_SLOW_MUL = 0.4; // cut enemy approach speed to 40%
const SNARE_FIELD_SLOW_SECONDS = 1.2; // > the 0.8s pulse gap, so the snare is continuous
const SNARE_FIELD_CHIP_DAMAGE = 4;
const SNARE_FIELD_COOLDOWN = 9;

/** Local player id for owner-only trap visibility (Danger Room solo). */
const LOCAL_PLAYER_ID = "local";

/** Themed colors for dash skills (mirrors the Vfx THEME palette). */
const SKILL_COLOR: Record<SkillKind, number> = {
  slash: 0x9fe8ff,
  slam: 0xffb24d,
  bolt: 0x6fd6ff,
  nova: 0xb98cff,
  muzzle: 0xfff2a8,
  thrust: 0xff6f6f,
  // Model-driven projectile/spell skills (mirror the Vfx THEME palette).
  fireDragon: 0xff6a1e,
  meteor: 0xff8a3d,
  turret: 0x8fd0ff,
  darkBlades: 0xb070ff,
  swordVolley: 0xa8e6ff,
  soul: 0x8fffe0,
  laser: 0xff5a3c,
};

/**
 * Motion-math scale: 100 motion-math units = 1 metre of body displacement. One
 * tunable knob so attack "MM" descriptors read in the same units the user spec'd.
 */
const MM_TO_M = 0.01;

/**
 * A per-attack motion descriptor in motion-math units. `peak` is the forward
 * displacement at the strike (negative = a retreating attack); when `settle` is
 * given the body springs from `peak` to `settle` afterwards:
 *   `+100`            → lunge to +1m and hold.
 *   `{ +100, -50 }`   → drive to +1m, then recoil to a net -0.5m behind start.
 *   `-50`             → strike while hopping back to -0.5m.
 */
interface MotionProfile {
  peak: number;
  settle?: number;
  /** Fraction of the dash where the strike lands. */
  impactAt: number;
}

/** Attack2 (Z): committed lunge-through that recoils behind the start. */
const ATTACK2_MOTION: MotionProfile = { peak: 100, settle: -50, impactAt: 0.45 };
/** Attack3 (X): a poke that retreats on the same beat. */
const ATTACK3_MOTION: MotionProfile = { peak: -50, impactAt: 0.5 };

/**
 * USER-DIRECTED: forward gap-closer baked into each non-opener combo swing so the
 * 3-hit chain aggressively advances INTO the enemy instead of swinging in place.
 * In motion-math units ({@link MM_TO_M}-scaled): the opener (stage 0) already
 * closes to the locked target, so this rides hits 1-2 — together they carry the
 * body ~1m+ forward across the combo. Most of the lunge is kept (only a slight
 * recoil) so the ground gained each swing isn't given back.
 */
const COMBO_ADVANCE_MM = 55;

/**
 * Fraction of a finisher swing's REAL clip length at which its hit (damage + slash
 * VFX) resolves. Big finisher clips (the dagger's double-dagger cross-stab, the
 * greatsword overhead, ...) land their blade near the END of the animation, so the
 * old fixed `dashDur * impactAt` (~90 ms) fired the hit in empty air while the swing
 * was still winding up. Timing the finisher strike to the clip lands it WITH the
 * swing. Callers clamp this to a sane window so a slow clip never feels laggy.
 */
const FINISHER_IMPACT_FRAC = 0.55;

/**
 * Adapt a dungeon {@link NavGrid} into a foot-IK {@link GroundSampler}. The
 * navmesh layer is deliberately THREE-free (it returns plain `nx,ny,nz`), so we
 * build the `THREE.Vector3` surface normal here. Off-navmesh samples return a
 * non-finite `y` so the grounder treats the foot as off-ground and no-ops there
 * (rather than snapping to a flat fallback at a cliff edge).
 */
function makeNavGroundSampler(nav: NavGrid): GroundSampler {
  return (x, z) => {
    const p = groundProbeAt(nav, x, z);
    if (!p.hit) return { y: NaN, normal: null };
    return { y: p.y, normal: new THREE.Vector3(p.nx, p.ny, p.nz) };
  };
}

/**
 * Play-test loading gate config. Passed to the Studio constructor to boot a
 * session behind a loading screen with a readiness checklist. `arena` is the
 * voxel map to build into the room (play mode / a networked room with a chosen
 * map); omit it for a plain Danger Room play-session (no authored arena).
 */
export interface SessionGate {
  arena?: VoxelMap;
}

/**
 * Snapshot returned for an ungated (legacy instant-start) session, which has no
 * boot gate / checklist. Matches an empty {@link ReadinessManifest}'s snapshot.
 */
const EMPTY_READINESS_SNAPSHOT: ReadinessSnapshot = {
  items: [],
  progress: 1,
  ready: false,
  failed: false,
  error: null,
  current: null,
  slow: false,
};

/** Count the authored NPC deployables in a voxel map (drives the npc checklist item). */
function countArenaNpcs(map: VoxelMap): number {
  let n = 0;
  for (const d of map.deployables) if (d.kind === "npc") n++;
  return n;
}

/**
 * Top-level disposable engine. React mounts it onto a container; it owns the
 * renderer, scene, loop and all subsystems, and pushes HUD snapshots out via a
 * callback. All public mutators are safe to call from React handlers.
 */
export class Studio {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private timer = new THREE.Timer();
  /** Spatial combat SFX (impacts/whooshes/blocks + soft ambient bed). */
  private sfx: CombatSfx | null = null;
  /** Persisted sound mixer (mute + master/combat/ambient/klaxon levels). */
  private sound: SoundSettings = loadSound();
  private room: DangerRoom;
  private djBooth: DjBooth | null = null;
  private vfx: Vfx;
  private targets: CombatTargets;
  /** Quirky animals pack — fauna with pathfinding, AI, corpses, butcher. */
  private wildlife: WildlifeSystem | null = null;
  /** Skillwrite cast aiming (target lock / ground AOE ring). */
  private castCtrl = new CastController();
  /**
   * Overhead magic runestone per skill family while casting/channeling.
   * Firebolt · Icewave · Stormfist · Nature/Holy/Arcane default — tinted on channel.
   */
  private castRunes = new CastRuneStones();
  /** Flame Body remaining time (s); 0 = inactive. */
  private flameBodyT = 0;
  /**
   * After Frost Field (ice staff), re-pressing that skill within this window
   * performs Frost Blink forward instead of another field.
   */
  private frostBlinkWindow = 0;
  /** The Danger Room sparring population, stashed while inside the dungeon. */
  private dangerTargets: Targets | null = null;
  /** AI-vs-AI duel orchestrator (drives `targets`); null until first started. */
  private duel: Duel | null = null;
  /** Difficulty to restore when a duel stops (duels force their own tier). */
  private duelSavedDifficulty: Difficulty | null = null;
  /** A.L.E. Bot: director cameras + highlights + diagnostics over the duel. */
  private ale = new AleBot();
  private status: StatusController;
  /** Under-foot target/faction discs (red hostile, green ally, blue neutral). */
  private indicators: TargetIndicators;
  /** Active AOE/boss-attack ground telegraphs (yellow-blink → red → resolve). */
  private telegraphs: TelegraphField;
  /** The active dungeon level (null in the Danger Room). */
  private dungeon: Dungeon | null = null;
  private dungeonHazards: DungeonHazards | null = null;
  private inDungeon = false;
  /** Foot-IK ground sampler for the active dungeon navmesh; null in the (flat)
   *  Danger Room, where foot IK stays off so its feel is untouched. */
  private dungeonGround: GroundSampler | null = null;
  /**
   * Underwater descent ambience (dungeon water band): an eased 0..1 intensity
   * that tints the scene blue, thickens the fog and emits rising bubbles while
   * the player sinks through the water, clearing on exit above or below.
   */
  private waterFx = 0;
  private bubbleAccum = 0;
  private waterFogColor = new THREE.Color(0x10465f);
  private static readonly FOG_BASE_COLOR: number = STUDIO_FOG.color;
  private static readonly FOG_BASE_NEAR: number = STUDIO_FOG.near;
  private static readonly FOG_BASE_FAR: number = STUDIO_FOG.far;
  private static readonly FOG_WATER_NEAR = 4;
  private static readonly FOG_WATER_FAR = 26;
  /**
   * The dry-fog baseline for the CURRENT location: the active room preset's
   * atmosphere while in the Danger Room, the dark dungeon tone while inside it.
   * The underwater {@link updateWaterFx} lerps from these toward the water tint,
   * so swapping the room preset re-tints the Danger Room without disturbing the
   * dungeon's look or its water-band fog restoration.
   */
  private baseFogColor = new THREE.Color(Studio.FOG_BASE_COLOR);
  private baseFogNear = Studio.FOG_BASE_NEAR;
  private baseFogFar = Studio.FOG_BASE_FAR;
  private baseBgColor = new THREE.Color(Studio.FOG_BASE_COLOR);
  /** Set while the player stands at the door portal (drives the HUD prompt). */
  private doorPrompt = false;
  /** Guards against re-triggering the async dungeon load. */
  private enteringDungeon = false;
  /** The active played voxel map (null unless launched from the Voxel Editor). */
  private arena: VoxelArena | null = null;
  private inArena = false;
  /** Guards against re-triggering the async arena load. */
  private enteringArena = false;
  private physics: PhysicsSystem | null = null;
  private bags: PunchingBags | null = null;
  private input: InputState;
  /** True on touch devices: suppress pointer-lock on tap (on-screen controls). */
  private touchMode = false;
  private resizeObs: ResizeObserver | null = null;
  private character!: Avatar;
  private controller!: Controller;
  private mounted: MountedWeapon | null = null;
  /** Independent off-hand piece (Tower Shield) mounted alongside the main weapon. */
  private mountedOff: MountedWeapon | null = null;
  // ---- Swept-edge blade collision (additive physical layer for the main weapon) ----
  /** Continuous blade-vs-shield/weapon/body sweep for the player's active swing. */
  private readonly blade = new BladeCollisionSystem();
  /** Seconds the current swing's blade window stays open (0 = no active swing). */
  private bladeWindow = 0;
  /** Set when a weapon clash interrupts the swing, so its scheduled hit whiffs. */
  private bladeSwingCancelled = false;
  private readonly _bladeA = new THREE.Vector3();
  private readonly _bladeB = new THREE.Vector3();
  /**
   * Flanged-Mace signature throw (slot 4) state machine + its in-flight visual.
   * Lazily created on first use; null until then. The flying mace is a small
   * owned procedural mesh (so its live position drives the dash-recall), tracked
   * for disposal.
   */
  private maceThrow: MaceThrowMachine | null = null;
  private maceMesh: THREE.Group | null = null;
  private maceMeshGeos: THREE.BufferGeometry[] = [];
  private maceMeshMats: THREE.Material[] = [];
  private readonly maceFrom = new THREE.Vector3();
  private readonly maceTo = new THREE.Vector3();
  private readonly maceImpactPoint = new THREE.Vector3();
  /**
   * Live bear traps (owner-only mesh, 2 m stun trigger). Cleared on dispose.
   * Template mesh is loaded once and cloned per deploy.
   */
  private bearTraps: {
    id: number;
    ownerId: string;
    pos: THREE.Vector3;
    root: THREE.Group;
    armed: boolean;
    life: number;
  }[] = [];
  private bearTrapSeq = 0;
  private bearTrapTemplate: THREE.Object3D | null = null;
  private bearTrapTemplatePromise: Promise<THREE.Object3D | null> | null = null;

  /** Delayed actions (e.g. dash endpoint blast) run from the loop. */
  private pending: { t: number; fn: () => void }[] = [];
  /**
   * Data-driven ability lifecycle (cast → release → travel → impact → status).
   * A small set of representative abilities (fire-dragon sig, bow slash,
   * buff/debuff statuses) are routed through this; the rest stay on their inline
   * paths. Advanced from the main loop with the same `dt` as {@link pending}.
   */
  private readonly abilities = new AbilityOrchestrator();
  /** Set when a Skyfall launch is airborne, waiting to barrage at the apex. */
  private skyfallPending = false;
  /** Fail-safe: barrage at the latest by this time if the apex is never reported. */
  private skyfallPendingTimer = 0;
  private skyfallCooldown = 0;
  /** Aerial crash-down slam in flight (cleared on touchdown or by the fail-safe). */
  private slamPending = false;
  private slamPendingTimer = 0;
  /** Set while an aerial dagger overhead is mid-swing, awaiting its end-of-clip slash. */
  private aerialSlashPending = false;
  private aerialSlashPendingTimer = 0;

  private params: EditorParams = loadControls();
  /** Debounce handle + last-persisted zoom for cheap wheel-zoom persistence. */
  private controlsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSavedCamDist = this.params.cameraDistance;
  /**
   * Global simulation time-scale. The main loop multiplies its per-frame delta by
   * this before threading it through physics, animation, combat timers and
   * scheduled hits, so 1.0 = real time and e.g. 0.25 = quarter-speed slow-motion
   * everywhere at once (rendering still runs at the real frame rate).
   */
  private timeScale = 1;
  private characterId: string;
  private weaponId: WeaponId = "sword";

  /** Persisted per-character clip overrides for the action slots. */
  private allOverrides: Record<string, SlotMap> = {};
  /** The active character's resolved (validated) overrides. */
  private overrides: SlotMap = {};
  private onHud: (h: HudSnapshot) => void;
  /** Fired after a character GLB finishes loading and is committed. */
  onCharacterLoaded: ((id: string) => void) | null = null;
  /**
   * Fired when the room's environment preset changes because of a host broadcast
   * (not a local user action). Lets the host-agnostic React UI keep its menubar
   * selection in sync with the arena every joiner is now in.
   */
  onRoomPresetChanged: ((id: RoomPresetId) => void) | null = null;
  /**
   * Play-test loading & readiness gate. When a session is constructed with a
   * `gate` config it boots behind a loading screen: the scene is built, NPCs +
   * their AI brains are spawned, shaders are pre-warmed, and ONLY THEN does
   * gameplay (input/AI/combat/physics) start. The render loop keeps drawing the
   * (frozen) backdrop so the loading screen has something live behind it.
   *
   * The WebGL-free {@link BootGate} owns the checklist + stall watchdog +
   * pre-warm trigger; null for legacy ungated (instant-start) sessions.
   */
  private bootGate: BootGate | null = null;
  /** True for gated (play / danger play-session) boots; false = legacy instant start. */
  private gated = false;
  /** The gate config (e.g. the voxel arena map to build) for this session. */
  private gate: SessionGate | null = null;
  /** Gameplay-start flag: false holds the loop in render-only mode until ready. */
  private ready = false;
  /** Guards the one-shot gated arena build (so character swaps don't rebuild it). */
  private gateArenaStarted = false;
  /** Fired on every readiness change so the React loading screen can track it. */
  onReadiness: ((s: ReadinessSnapshot) => void) | null = null;
  private loadToken = 0;
  private weaponToken = 0;
  /** Off-hand slot selection (null = empty); only mounts when `offHandEligible`. */
  private offHandId: WeaponId | null = null;
  private offHandToken = 0;
  /** Index into the active character's `loadout` (Heroes of Grudge Q-swap). */
  private loadoutIndex = 0;
  /** Active full-scene backdrop id (null = the preset's plain colour bg). */
  private backdropId: string | null = null;
  private backdropTex: THREE.Texture | null = null;
  private backdropToken = 0;

  private sparring!: SparringCombat;
  /** Transient center-screen flash text (PERFECT PARRY!, SHIELD BREAK!, etc.). */
  private combatFlash = "";
  private combatFlashTimer = 0;
  /** Exo-Armour Mech Mode: suit-up transformation + rideable mech control. */
  private mech!: MechSystem;
  /** Studio-side mech reconciliation (visibility/speed/takeover-teardown glue). */
  private mechReconciler!: MechReconciler;
  /**
   * Independent cooldowns (s) for the mech's bespoke kit, parallel to
   * {@link MECH_ABILITIES}: [Seismic Stomp (F), Plasma Cannon (1), Grapple Throw (2)].
   * These are distinct from the pilot's on-foot skills and only tick/fire while
   * the player is sealed inside the armour.
   */
  private mechCds: [number, number, number] = [0, 0, 0];
  /** Tracks the airborne edge while piloting so a landing slam fires once. */
  private mechWasAirborne = false;
  private onKeyUp = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    // Ctrl (hold) = block: release the guard on key-up.
    if (e.code === "ControlLeft" || e.code === "ControlRight") this.endBlock();
  };

  private health = 100;
  private maxHealth = 100;
  private stamina = 120;
  /** Must match the player CC maxStamina in SparringCombat so the HUD is accurate. */
  private maxStamina = 120;
  private skillCooldown = 0;
  private skillCooldownMax = 0;
  private swingTimer = 0;
  /** Slash colour of the in-progress swing, used by the clean blade-trail ribbon. */
  private swingColor = 0x9fe8ff;
  /** 3-hit melee combo state: next stage (0-2), chain window, and a brief lock. */
  private comboIndex = 0;
  private comboTimer = 0;
  private comboLock = 0;
  /** Staff ranged primary (LMB bolt) cooldown — a steady poke gate independent of
   *  the skill cooldown so you can keep firing bolts while skills recharge. */
  private staffBoltCd = 0;
  /** Soulbinder "Hot Hands" fire-combo state: next stage (0-2), window, lock. */
  private fireComboIndex = 0;
  private fireComboTimer = 0;
  private fireComboLock = 0;
  /**
   * Offense-fail recovery lock: set when the player's attack is blocked, parried
   * or dodged. While it counts down the player cannot start a new attack — they
   * lose the tempo (the "animated fail" beat) so the defender gets a real window
   * to counter or escape. Gates every offensive entrypoint (combo / stab /
   * motion / heavy).
   */
  private recoverLock = 0;
  /** Utility Kick (KeyV) cooldown so the guard-breaking kick can't be spammed. */
  private kickCd = 0;
  /** Throw-bomb (KeyH) cooldown so the thrown grenade can't be spammed. */
  private throwCd = 0;
  /** Heal-potion (KeyJ) cooldown so the consumable can't trivialise fights. */
  private potionCd = 0;
  /** Pending aerial-spin skill: fires a flame-slash projectile when the spin ends. */
  private spinSkill: { skill: KickSkill; pal: StrikerCombat["palette"] } | null = null;
  /** Striker 3-hit kick combo state (separate from weapon combo). */
  private kickComboIndex = 0;
  private kickComboTimer = 0;
  private kickComboLock = 0;
  /** Pistol "Kiter" primary state: rounds fired this clip + a brief fire lock. */
  private pistolShots = 0;
  private pistolLock = 0;
  /** Cooldown gating the kiter backstep's i-frame dodge so rapid fire can't chain
   *  the invuln window into continuous immunity (dodge re-arms every 0.6s). */
  private pistolDodgeCd = 0;
  /** Camera framing, mirrored on the controller so it survives character swaps. */
  private viewMode: "third" | "first" = "third";
  /** Shared recoil model (DGS): kicks the aim on fire, decays each frame. */
  private readonly recoil = new Recoil();
  /** Live additive FOV (deg) for the sprint kick, eased toward 0 / +8. */
  private fovKickCur = 0;
  /** Crosshair spread in px (HUD), from movement + recoil bloom. */
  private aimSpread = 5;
  /** Last computed OWR range band of the nearest enemy (drives the reticle ring). */
  private owrRangeState: "close" | "optimal" | "far" | "none" = "none";
  /** Lazily-created WebAudio context for the OWR edge "beep" cue. */
  private owrAudioCtx: AudioContext | null = null;
  /** Monotonic confirmed-hit counter; bumping it flashes the hit-marker. */
  private hitMarkerCount = 0;
  /** Per-signature-skill cooldowns for characters that use them (e.g. Striker). */
  private sigCooldowns: [number, number, number, number] = [0, 0, 0, 0];
  private sigCooldownMaxes: [number, number, number, number] = [0, 0, 0, 0];
  /** Sparring: player block/parry + damage-taking state. The room boots with
   *  hostile enemies (a weak-point boss, a bear, and grunts) that engage on
   *  entry; drop to "passive" in the Admin panel to make them inert again. */
  private difficulty: Difficulty = "medium";
  private blocking = false;
  /** Always-on soft-lock state: gentle aim assist toward the nearest/Tab'd foe.
   *  Alt+Tab turns it off (free camera); Tab / RMB re-arm it. */
  private softLockEnabled = true;
  /** True while the raised block came from a touch button (so the keyboard-block
   *  auto-release on pointer-unlock doesn't fire for it). */
  private blockViaTouch = false;
  /** True while RMB-hold lock-on stance is engaged (face + strafe the enemy). */
  private locked = false;
  /** Combat-music intensity 0..1: combat events push it up, it decays between
   *  exchanges. Drives the background-music swell via {@link CombatSfx}. */
  private musicHeat = 0;
  /** Counts down after taking a hit (drives the hurt vignette). */
  private hurt = 0;
  /** Invulnerability window after respawning / a successful parry. */
  private invuln = 0;
  /** Cooldown gating the directional dodge-roll so rapid double-taps can't chain
   *  the i-frame window into continuous immunity (re-arms every 0.6s). */
  private dodgeCd = 0;
  private defeated = false;
  /** Reusable context handed to Targets.update each frame (avoids per-frame alloc). */
  private sparCtx: SparringContext;
  /** Seconds left of the Kiter Smoke Phantom invisibility + speed buff (0 = off). */
  private phantomTimer = 0;
  private raf = 0;
  private disposed = false;
  private hudAccum = 0;
  /** Throttle for the looping leg-flame emitter while the Striker hovers. */
  private hoverFlameAccum = 0;
  /** Last flame palette theme pushed to the VFX (avoids redundant per-frame swaps). */
  private fireThemeApplied: "fire" | "chi" = "fire";
  private fps = 60;

  // ── Multiplayer (Danger Room rooms) ────────────────────────────────────────
  /** Live relay client while inside a multiplayer room (null in solo play). */
  private net: DangerClient | null = null;
  /** Unsubscribe handles for the net listeners, cleared on detach/dispose. */
  private netUnsub: (() => void)[] = [];
  /** Remote players by id, interpolated from received snapshots. */
  private remotes = new Map<string, RemoteAvatar>();
  /** Mirrored host NPCs by id (coop non-host clients only). */
  private mirrorNpcs = new Map<string, RemoteAvatar>();
  /** Holds all networked avatars so they're disposed/cleared as a unit. */
  private remoteRoot = new THREE.Group();
  /** Accumulators throttling local state / host NPC roster broadcasts. */
  private stateAccum = 0;
  private npcAccum = 0;
  /** Scratch vector for net hit-distance tests (avoids per-call alloc). */
  private netTmp = new THREE.Vector3();

  private onClick = () => {
    this.sfx?.resume();
    // On touch devices the on-screen controls drive look, so never grab pointer
    // lock from a tap (it would hijack the look-pad / fight the joystick).
    if (this.touchMode) return;
    if (!this.input.locked) this.input.requestLock();
  };
  private onMouseDown = (e: MouseEvent) => {
    this.sfx?.resume();
    if (!this.input.locked) return;
    if (e.button === 0) {
      // Ground AOE / target cast: LMB confirms placement instead of attacking.
      if (this.castCtrl.isActive()) {
        this.confirmSkillCast();
        return;
      }
      this.attack();
    } else if (e.button === 1) {
      // Middle mouse (M3): the relocated motion-attack (formerly KeyT). Sits in
      // place as the knock-up / stagger combo-starter slot.
      e.preventDefault();
      this.motionAttack(ATTACK3_MOTION);
    } else if (e.button === 2) {
      if (this.castCtrl.isActive()) {
        this.castCtrl.cancel();
        this.castRunes.hide();
        return;
      }
      this.toggleLock();
    }
  };
  private onMouseUp = (_e: MouseEvent) => {};
  private onContextMenu = (e: MouseEvent) => e.preventDefault();
  private onResize = () => this.resize();

  constructor(
    container: HTMLElement,
    characterId: string,
    onHud: (h: HudSnapshot) => void,
    opts?: { gate?: SessionGate },
  ) {
    this.container = container;
    this.characterId = characterId;
    this.onHud = onHud;
    // Apply persisted weapon placement tuning onto the shared catalog so grip /
    // size / blade-collider edits authored in the Dressing Room carry into combat.
    applyWeaponTuning();
    if (opts?.gate) this.setupReadinessGate(opts.gate);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = STUDIO_TONE_MAPPING_EXPOSURE;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(Studio.FOG_BASE_COLOR);
    this.scene.fog = new THREE.Fog(Studio.FOG_BASE_COLOR, Studio.FOG_BASE_NEAR, Studio.FOG_BASE_FAR);

    this.camera = new THREE.PerspectiveCamera(this.params.fov, 1, 0.1, 200);
    // Start ~50% closer to the room centre and aimed at the spawn point so the
    // opening view (before the async character load wires up the follow-cam)
    // frames the inside of the arena instead of staring at a far, dark wall.
    this.camera.position.set(0, 2.2, 3.5);
    this.camera.lookAt(0, 1, 0);

    this.room = new DangerRoom({ preset: loadRoomPreset() });
    this.scene.add(this.room.group);
    this.confirmDoorPlacement();
    // Tint the scene fog + background to the active preset's mood (overrides the
    // dark base set just above). The matching ambient bed is applied once the
    // sound system exists, below.
    this.applyRoomAtmosphere(true);
    // Restore any session-persisted battle-art backdrop over the preset bg.
    this.setBackdrop(loadBackdrop());
    // Resident DJ in the lit alcove above the door (scenery; loads async).
    this.djBooth = new DjBooth(this.room.djBoothAnchor);
    this.scene.add(this.djBooth.group);
    void this.djBooth.load().catch((err) => console.warn("[Studio] DJ booth load failed", err));
    this.scene.add(this.remoteRoot);
    this.scene.add(this.ale.overlay);
    this.vfx = new Vfx(this.scene);
    this.mech = new MechSystem(this.scene);
    this.mechReconciler = new MechReconciler(this.mech, {
      spectating: () => this.spectating,
      baseSpeedMul: () => this.baseSpeedMul(),
      setSpeedMultiplier: (m) => this.controller?.setSpeedMultiplier(m),
      setPilotVisible: (v) => {
        if (this.character) this.character.root.visible = v;
      },
      setMechAimActive: (on) => {
        if (!this.controller) return;
        if (on) this.controller.setPitchRange(MECH_PITCH_MIN, MECH_PITCH_MAX);
        else this.controller.resetPitchRange();
      },
      anchor: () => {
        const fwd = this.controller!.forward();
        // Torso aim: map the look elevation onto a cosmetic spine lean. The
        // +0.35 neutral offsets the default downward orbit angle so the torso
        // reads level at the resting camera, tilting up/down as the pilot aims.
        const elev = this.controller!.aimElevation();
        return {
          pos: this.character!.root.position,
          yaw: Math.atan2(fwd.x, fwd.z),
          speed: this.controller!.state.speed,
          aimTilt: THREE.MathUtils.clamp((elev + 0.35) * 0.7, -0.45, 0.45),
        };
      },
    });
    this.targets = new Targets(this.scene);
    this.scene.add(this.castCtrl.ring);
    this.scene.add(this.castRunes.group);
    void this.castRunes.preload();
    // Wildlife pack (Quirky animals): additive fauna — pathfind when nav bound,
    // corpse + butcher. Load async; never blocks player boot.
    this.wildlife = new WildlifeSystem(this.scene);
    void this.wildlife
      .load()
      .then(() => {
        if (this.disposed) return;
        this.wildlife?.spawnDefault(10);
      })
      .catch((err) => console.warn("[Studio] wildlife load failed", err));
    this.status = new StatusController(this.scene);
    this.indicators = new TargetIndicators(this.scene);
    this.telegraphs = new TelegraphField(this.scene);
    this.targets.onDeath = (p) => {
      this.vfx.burst(p, 0xff7a8a, 40, 6);
      this.vfx.shockwave(new THREE.Vector3(p.x, 0.05, p.z), 0xff5a6a, 3, 0.6);
    };
    this.targets.setDifficulty(this.difficulty);
    // The room boots NEUTRAL: nothing is seeded on entry except the player
    // (spawned below) and the resident DJ (Racalvin + his booth/lights, set up
    // above). Enemies — the yellow-bot weak-point boss, the bear, grunts and
    // training dummies — are spawned on demand from the Admin panel
    // (spawnNpc/spawnBoss) or by starting a duel, never automatically.
    this.sparCtx = {
      playerPos: new THREE.Vector3(),
      playerAlive: true,
      playerRecovering: false,
      dealToPlayer: (center, radius, damage, force, from, kind, isSkill) =>
        this.resolveOpponentStrike(center, radius, damage, force, from, kind, isSkill),
      onWindup: (pos, kind) => this.vfx.burst(pos, SKILL_COLOR[kind] ?? 0xffb24d, 6, 1.6),
      onCastCharge: (pos, kind) => this.vfx.castAura(pos, SKILL_COLOR[kind] ?? 0x9fd0ff),
      onStrike: (center, kind, radius, isSkill) => {
        const color = SKILL_COLOR[kind] ?? 0xffb24d;
        this.vfx.impact(center, color, 1.4);
        if (isSkill) this.vfx.aoeBlast(center, color, radius);
      },
      onBearAttack: (at, attack, moment) => this.playBearAttackCue(at, attack, moment),
      onDefend: (pos, dodged) => this.vfx.burst(pos, dodged ? 0x9fe8ff : 0x6fe0ff, 10, dodged ? 3 : 2),
      telegraph: (center, radius, onResolve) => this.telegraphs.add(center, radius, onResolve),
      castSpell: (kind, from, target, onImpact) => {
        // Build a flat forward + facing quaternion from caster → target, then
        // route through the same aimed-spell VFX the player uses (homing onto the
        // aim point). The impact callback resolves the hit at the landing point.
        const fwd = target.clone().sub(from);
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
        fwd.normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), fwd);
        this.vfx.playSkill(kind, from.clone(), fwd, quat, target.clone(), onImpact);
      },
      deployTurret: (at, faceDir, color, life) => {
        // Standing-chassis VFX only — the host (Targets) ticks the firing,
        // faction-aware damage and lifetime; we return the early-remove disposer.
        return this.vfx.spawnTurret(at.clone(), faceDir.clone(), color, life);
      },
      turretBolt: (from, dir, dist, color, onLand) => {
        // Slow, oversized, dodgeable bolt — same VFX the player's turret fires.
        // The bolt object is the damage producer: onLand resolves the host's
        // faction-aware AoE where it lands, so a target off the line dodges it.
        this.vfx.muzzle(from.clone(), dir.clone(), color);
        this.vfx.bolt(
          from.clone(),
          dir.clone(),
          color,
          TURRET_BOLT_SPEED,
          dist + 0.5,
          (p) => {
            this.vfx.aoeBlast(p, color, 1.0);
            onLand(p);
          },
          TURRET_BOLT_SCALE,
        );
      },
    };
    this.setupLights();

    this.sparring = new SparringCombat({
      onPlayerStateChange: (state) => {
        // HUD flash + the heavy knock-down / stun reactions, bound to the CC's
        // vulnerable state so the real fall + kip-up (or stun) sequence plays once.
        // The lighter outcome-bound flinches below override harmlessly if both fire.
        // The loser reaction CLIP is sourced from the player's hold-style standard
        // (vulnerableReactionClip) so player and AI react from ONE source; the
        // flash + the fall→kip-up recovery sequence stay here.
        const clip = vulnerableReactionClip(this.playerGroup(), state as VulnerableState);
        if (state === "stunned") {
          this.setCombatFlash("STUNNED", 1.8);
          if (clip) this.reactWithClip(clip, 0.1);
        } else if (state === "fallen") {
          this.setCombatFlash("KNOCKED DOWN", 1.5);
          if (clip) this.reactWithClip(clip, 0.1);
          this.schedule(0.95, () => this.character?.reaction?.("fallen", 0.15, true));
          this.schedule(1.5, () => this.playPlayerReaction("kipUp"));
        }
      },
      onDummyHitResult: (result, pos) => {
        // Health is tracked inside the sparring CombatController; we read it back
        // in the loop via getPlayerHealth() so no manual decrement here.
        // Player is the DEFENDER: the reaction clip comes from the hold-style
        // standard (defenseOutcomeClip), keyed by the player's weapon group; the
        // hit position drives the directional guarded-hit react.
        this.playPlayerDefenseReaction(result.outcome, pos);
        // Outcome-specific feedback layered on top of the category reaction.
        switch (result.outcome) {
          case "crit":
            this.setCombatFlash("CRIT HIT!", 1.0);
            break;
          case "perfectParry":
            this.setCombatFlash("PERFECT PARRY!", 1.5);
            break;
          case "blockStop":
            if (result.defenderReaction === "stunned") {
              // Guard broke — escalate to a wall-crash stagger.
              this.schedule(0.05, () => this.playPlayerReaction("wallCrash"));
              this.setCombatFlash("GUARD BROKEN!", 1.5);
            }
            break;
        }
      },
    });

    // Bind player-combat VFX hooks onto the current target population.
    this.wireTargetCombatHooks();

    this.input = new InputState(this.renderer.domElement);
    this.renderer.domElement.addEventListener("click", this.onClick);
    this.renderer.domElement.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    this.renderer.domElement.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keyup", this.onKeyUp);
    // Catch container resizes that don't fire a window resize (panel toggles,
    // canvas-board iframe resizing, split-view changes) so the render buffer and
    // camera aspect always track the actual canvas size.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(this.container);
    }

    this.sfx = new CombatSfx(this.camera, this.scene);
    this.sfx.setMuted(this.sound.muted);
    this.sfx.setLevels(this.sound);
    // Give the ambient bed the active preset's character (tone/level/drift). The
    // bed itself starts async after the buffers load, but the profile is stored
    // and picked up when it does.
    this.applyRoomAmbience();
    // Emit the music bed spatially from the DJ booth so it reads as Racalvin's
    // live set (offset up to roughly the booth/speaker height).
    if (this.djBooth) {
      const boothPos = this.room.djBoothAnchor.clone();
      boothPos.y += 1.5;
      this.sfx.setMusicSource(boothPos);
    }
    // Cue the resident DJ's set: re-assert the user's CURRENTLY SELECTED radio
    // station (local CPT RAC playlist or a free Audius genre stream) so a mode
    // switch never clobbers a streaming station back to the bundled set. The
    // DJ's dance + light show sync to whichever set is live.
    assertStation((urls, titles) => this.sfx?.setDjPlaylist(urls, titles));

    this.loadOverrides();
    this.resize();
    void this.spawnCharacter(this.characterId);
    void this.initPhysics();
    this.loop();
  }

  // ---- Play-test loading & readiness gate ----

  /**
   * Stand up the {@link BootGate} for a gated boot. The gate registers the
   * readiness checklist (physics, character, weapon, arena, npcs) and is marked
   * ready / failed by the matching async load as it resolves; once all asset
   * items are in it fires `onAssetsReady`, where we bake + pre-warm shaders and
   * open the gameplay gate. Called from the constructor before any load kicks
   * off, so the manifest already lists every expected item when the UI attaches.
   */
  private setupReadinessGate(gate: SessionGate) {
    this.gated = true;
    this.gate = gate;
    // The gate's checklist + stall/slow watchdog + pre-warm trigger all live in
    // the WebGL-free BootGate (so the whole boot experience is unit-testable
    // headlessly). We keep only the WebGL pieces: forwarding to React, and the
    // shader pre-warm + gate-open once every asset is in.
    this.bootGate = new BootGate(
      {
        hasArena: !!gate.arena,
        npcCount: gate.arena ? countArenaNpcs(gate.arena) : 0,
      },
      {
        onReadiness: (s) => this.onReadiness?.(s),
        onAssetsReady: () => this.prewarmAndOpen(),
        isReady: () => this.ready,
        isDisposed: () => this.disposed,
      },
    );
  }

  /** Current readiness snapshot (used by React to seed the loading screen). */
  readinessSnapshot(): ReadinessSnapshot {
    return this.bootGate?.snapshot() ?? EMPTY_READINESS_SNAPSHOT;
  }

  /** Mark a readiness item ready; no-op when ungated, the item is absent, or disposed. */
  private markReady(key: string) {
    this.bootGate?.markReady(key);
  }

  /** Mark a readiness item failed (surfaces in the loading screen's error state). */
  private markFailed(key: string, error: string) {
    this.bootGate?.markFailed(key, error);
  }

  /**
   * Bake the built scene and pre-warm its shaders so the first live frame draws
   * without the usual first-render compile hitch, then open the gameplay gate.
   * `renderer.compile` walks the scene and uploads every program/material up
   * front; we flush world matrices first so it sees final transforms.
   */
  private prewarmAndOpen() {
    this.scene.updateMatrixWorld(true);
    try {
      this.renderer.compile(this.scene, this.camera);
    } catch (err) {
      console.warn("[Studio] shader pre-warm failed", err);
    }
    // Marking shaders ready emits a final snapshot with `ready: true`, which the
    // loading screen reads to dismiss itself.
    this.markReady("shaders");
    this.ready = true;
    // Boot succeeded — the stall safety net is no longer needed. (Marking shaders
    // ready already auto-stops it on the `ready` snapshot; this is belt-and-braces.)
    this.bootGate?.stopWatchdog();
    // Drop the delta accumulated behind the loading screen so the first gameplay
    // frame steps a normal dt instead of one huge catch-up jump.
    this.timer.update();
  }

  /**
   * Confirm the room's door portal actually landed where the interaction system
   * expects it: the authored door position must be finite and the proximity
   * trigger ({@link DangerRoom.nearDoor}) must fire at that exact spot. Marks the
   * gate's "doors" item ready/failed accordingly — a broken preset can't open a
   * session whose dungeon door is unreachable. Called right after the room is
   * built (door construction is synchronous with the room).
   */
  private confirmDoorPlacement() {
    const p = this.room.doorPos;
    const placed =
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      Number.isFinite(p.z) &&
      this.room.nearDoor(p);
    if (placed) {
      this.markReady("doors");
    } else {
      this.markFailed("doors", "Door portal failed to place.");
    }
  }

  /**
   * Confirm the committed rig actually carries its baseline movement clips
   * (idle at minimum, plus a non-empty clip set) before the boot gate counts
   * the fighter as playable. Marks "requiredClips" ready/failed — a rig whose
   * animation library silently failed to bind would otherwise open the session
   * into a frozen T-pose.
   */
  private confirmRequiredClips(avatar: Avatar) {
    const ok = avatar.clipNames().length > 0 && avatar.hasRole("idle");
    if (ok) {
      this.markReady("requiredClips");
    } else {
      this.markFailed("requiredClips", "Required animation clips failed to load.");
    }
  }

  /**
   * Bring up the Rapier physics core + the hung punching bags. Async (the wasm
   * runtime + bag GLB load off-thread), so the render loop guards on `bags`
   * being present and bails cleanly if the Studio is disposed mid-load.
   */
  private async initPhysics() {
    const physics = new PhysicsSystem();
    try {
      await physics.init();
    } catch (err) {
      console.error("[Studio] physics init failed", err);
      this.markFailed("physics", "Physics engine failed to start.");
      return;
    }
    if (this.disposed || !physics.world) {
      physics.dispose();
      // A live (non-disposed) session that came back without a world can't run —
      // fail the gate explicitly so the loading screen never hangs on physics.
      if (!this.disposed) this.markFailed("physics", "Physics engine failed to start.");
      return;
    }
    // Solid ground so the player capsule and dynamic props rest on it instead of
    // hovering over the Danger Room's purely-visual floor plane.
    physics.addGroundPlane(0);
    const bags = new PunchingBags(this.scene, physics.world);
    try {
      await bags.load();
    } catch (err) {
      console.error("[Studio] punching bags load failed", err);
      bags.dispose();
      physics.dispose();
      this.markFailed("physics", "Failed to build the training props.");
      return;
    }
    if (this.disposed) {
      bags.dispose();
      physics.dispose();
      return;
    }
    this.physics = physics;
    this.bags = bags;
    this.markReady("physics");
  }

  /** Knock any punching bags inside `radius` of `center` (melee/skill impacts). */
  private hitBags(center: THREE.Vector3, radius: number, force: number, damage = 0) {
    this.bags?.blast(center, radius, force, damage);
    this.arena?.blastBags(center, radius, force, damage);
  }

  private setupLights() {
    // Shared Danger Room base rig (see studioLighting.ts) — the same definition
    // the environment-thumbnail renderer uses, so previews can't drift. Shadows
    // are enabled here for the live scene.
    addStudioLights(this.scene, { shadows: true });
  }

  /**
   * Parse fleet / catalog ids into a Grudge modular avatar when possible.
   * Accepts:
   *   grudge-barbarians-knight  (catalog)
   *   grudge:barbarians:knight  (GrudgeAvatar internal)
   *   fleet warlords race+class via the same catalog ids
   */
  private parseGrudgeAvatarId(id: string): { raceId: RaceId; presetId: PresetId } | null {
    const colon = id.match(/^grudge:([a-z0-9-]+):([a-z]+)$/i);
    if (colon) {
      return { raceId: colon[1] as RaceId, presetId: colon[2] as PresetId };
    }
    const dash = id.match(
      /^grudge-(barbarians|dwarves|high-elves|orcs|undead|western-kingdoms)-(knight|warrior|ranger|mage|unarmed)$/i,
    );
    if (dash) {
      const preset = (dash[2].toLowerCase() === "unarmed" ? "unarmed" : dash[2].toLowerCase()) as PresetId;
      // mage kit maps to GrudgeAvatar "mage" preset; others share names
      return { raceId: dash[1].toLowerCase() as RaceId, presetId: preset };
    }
    return null;
  }

  private async spawnCharacter(id: string) {
    const token = ++this.loadToken;
    const grudge = this.parseGrudgeAvatarId(id);
    // Always resolve catalog metadata (loadout, skills, yaw, tank) — even when
    // the live avatar is modular GrudgeAvatar (which was missing `def` before).
    const def = getCharacter(id);
    let next: Avatar;
    if (grudge) {
      // Modular race FBX + gear preset from assets.grudge-studio.com (same kit as GRUDOX / Warlords).
      next = new GrudgeAvatar(grudge.raceId, grudge.presetId);
    } else {
      next = def.procedural ? new ExplorerCharacter(def) : new Character(def);
    }
    try {
      await next.load();
    } catch (err) {
      console.error("[Studio] character load failed", err);
      // Fleet grudge avatars: fall back to catalog GLB Character if modular load fails
      if (grudge) {
        try {
          const fallback: Avatar = def.procedural ? new ExplorerCharacter(def) : new Character(def);
          await fallback.load();
          next = fallback;
        } catch (err2) {
          console.error("[Studio] grudge fallback also failed", err2);
          this.markFailed("character", "Fighter model failed to load.");
          this.markFailed("requiredClips", "Required animation clips failed to load.");
          return;
        }
      } else {
        this.markFailed("character", "Fighter model failed to load.");
        this.markFailed("requiredClips", "Required animation clips failed to load.");
        return;
      }
    }
    // Discard stale loads — only the most recent selection may commit.
    if (this.disposed || token !== this.loadToken) {
      next.dispose();
      return;
    }
    if (this.character) {
      if (this.mounted) {
        unmountWeapon(this.mounted);
        this.mounted = null;
      }
      if (this.mountedOff) {
        unmountWeapon(this.mountedOff);
        this.mountedOff = null;
      }
      this.scene.remove(this.character.root);
      this.character.dispose();
    }
    this.character = next;
    this.character.setBlendTime(this.params.blendTime);
    this.character.setShowSkeleton(this.params.showSkeleton);
    // Foot IK: dungeon uses nav sampler; elsewhere keep feet on flat Y=0.
    // Always on for skinned GLBs so third-person feet stay planted.
    if (this.inDungeon && this.dungeonGround) {
      this.character.setGroundSampler?.(this.dungeonGround);
    }
    this.character.setFootIk?.(true);
    // Honour the spectator invariant: a character swapped in mid-duel must stay
    // hidden (the player is a spectator until the duel stops).
    this.character.root.visible = !this.spectating;
    this.scene.add(this.character.root);
    this.characterId = id;
    // The player's portrait key is stable per character, but the look can
    // change between spawns (Avatar Edit head, wardrobe skins) — drop the
    // cached thumbnail so the HUD frame re-captures this rig.
    invalidateTargetPortrait(`player:${id}`);
    if (!this.controller) {
      this.controller = new Controller(this.character, this.camera, this.input, this.params);
    } else {
      // Rebind controller to the new character.
      this.controller = new Controller(this.character, this.camera, this.input, this.params);
    }
    // Feed the controller live Danger Room obstacle circles (corner pillars,
    // training dummies, and current opponents) so the player collides with them
    // instead of walking through. Re-set here because the controller is recreated
    // on every character swap. The dungeon/arena KCC ignores this when active.
    this.controller.setObstacles(() => {
      const npcs = this.targets instanceof Targets ? this.targets.obstacleCircles() : [];
      return [...this.room.obstacles, ...npcs];
    });
    // Re-apply the camera framing (controller is rebuilt on every swap).
    this.controller.setViewMode(this.viewMode);
    this.resolveOverrides(id);
    // Reset transient Kiter phantom state so a new rig never spawns invisible.
    this.phantomTimer = 0;
    // A character swap cancels any active exo-armour (the new pilot starts unsuited).
    this.mechReconciler?.reset();
    this.mechCds = [0, 0, 0];
    this.controller.setSpeedMultiplier(1);
    // Tank/Centurion is a slow, armoured bruiser — apply its movement penalty on
    // spawn (the gunblade's signature kit + damage mitigation key off the same flag).
    if (def.tank) this.controller.setSpeedMultiplier(def.tank.moveSpeedMul);
    // Clear cross-character combat transients so the fresh rig starts ready: drop
    // any pending scheduled callbacks (decoy shots, beam ticks, kick combos) from
    // the previous character, and zero the shared per-signature + skill cooldowns
    // (the sigCooldowns array is shared, so a Gunslinger skill on cooldown would
    // otherwise block the same slot on the next character, e.g. the Striker).
    this.pending.length = 0;
    this.abilities.cancelAll();
    this.clearBearTraps();
    this.cancelMaceThrow();
    this.aerialSlashPending = false;
    this.aerialSlashPendingTimer = 0;
    this.sigCooldowns = [0, 0, 0, 0];
    this.sigCooldownMaxes = [0, 0, 0, 0];
    this.skillCooldown = 0;
    this.skillCooldownMax = 0;
    // Characters may declare a weapon to spawn with (e.g. the Gunslinger's pistol).
    if (def.defaultWeapon) this.weaponId = def.defaultWeapon;
    // Heroes of Grudge: spawn holding the first loadout weapon + its off-hand
    // (e.g. a Knight's shield). `applyWeapon` re-applies the off-hand once the
    // main mounts, so set the off-hand id first.
    this.loadoutIndex = 0;
    if (def.loadout && def.loadout.length) {
      this.weaponId = def.loadout[0];
      this.offHandId = def.offHand ?? null;
    }
    this.applyWeapon(this.weaponId);
    this.applyModelYaw();
    this.markReady("character");
    this.confirmRequiredClips(next);
    // For a gated boot, the engine — not React — owns the arena build, kicked off
    // once the rig is committed. One-shot so later character swaps (wardrobe /
    // loadout) never rebuild the arena. A gate with no `arena` (plain Danger Room
    // play-session) skips this; its checklist has no arena/npcs items.
    if (this.gated && !this.gateArenaStarted && this.gate?.arena) {
      this.gateArenaStarted = true;
      void this.enterArena(this.gate.arena);
    }
    this.onCharacterLoaded?.(id);
    // Kick-style characters that declare `kickClips` get extra FBX clips injected
    // after commit (Tera-kasi pulls flip_kick/backflip/roll). The Striker declares
    // none and stays native-only, so this is a no-op for it.
    if (def.meleeStyle === "kick") {
      void this.loadKickClips(id);
    }
  }

  // ---- action-slot clip overrides ----

  private loadOverrides() {
    try {
      const raw = localStorage.getItem(SLOTS_KEY);
      this.allOverrides = raw ? JSON.parse(raw) || {} : {};
    } catch {
      this.allOverrides = {};
    }
  }

  private saveOverrides() {
    try {
      localStorage.setItem(SLOTS_KEY, JSON.stringify(this.allOverrides));
    } catch {
      /* best-effort */
    }
  }

  /** Keep only overrides whose clip still exists in the freshly loaded GLB. */
  private resolveOverrides(id: string) {
    const stored = this.allOverrides[id] ?? {};
    const valid: SlotMap = {};
    for (const { slot } of SLOT_META) {
      const clip = stored[slot];
      if (clip && this.character?.hasClip(clip)) valid[slot] = clip;
    }
    this.overrides = valid;
  }

  /** Every clip embedded in the current character's GLB. */
  clipNames(): string[] {
    return this.character?.clipNames() ?? [];
  }

  /** Default action label + clip for a slot (before any override). */
  private slotDefault(slot: ActionSlot): { label: string; clip: string } {
    const def = getCharacter(this.characterId);
    if (slot === "primary") return { label: "Primary Attack", clip: def.clips.attack ?? "" };
    if (slot === "fskill") {
      if (def.fskillKind)
        return { label: def.fskillKind === "turret" ? "Deploy Turret" : "Cast Spell", clip: def.clips.attack ?? "" };
      if (def.weaponless) return { label: "Diable Jambe", clip: def.clips.attack ?? "" };
      const w = getWeapon(this.weaponId);
      const kitAbility = w.skillKit?.ability;
      return {
        label: kitAbility?.label ?? w.skillName,
        clip: kitAbility?.clip ?? def.clips.attack ?? "",
      };
    }
    const i = Number(slot.slice(3)) - 1;
    const kitSig = getWeapon(this.weaponId).skillKit?.signatures[i];
    const sig = def.signatureSkills[i];
    return {
      label: kitSig?.label ?? sig?.label ?? `Signature ${i + 1}`,
      clip: kitSig?.clip ?? sig?.clip ?? "",
    };
  }

  /** Resolved bindings (override or default) for every action slot. */
  getSlotBindings(): SlotBinding[] {
    return SLOT_META.map(({ slot, key }) => {
      const d = this.slotDefault(slot);
      const override = this.overrides[slot];
      return { slot, key, label: d.label, clip: override ?? d.clip, custom: !!override };
    });
  }

  /** Assign (or, with null, clear) the clip a slot triggers; persisted per character. */
  setSlotAssignment(slot: ActionSlot, clip: string | null) {
    if (clip && this.character?.hasClip(clip)) this.overrides[slot] = clip;
    else delete this.overrides[slot];
    if (Object.keys(this.overrides).length) this.allOverrides[this.characterId] = this.overrides;
    else delete this.allOverrides[this.characterId];
    this.saveOverrides();
  }

  /** Play a clip once as a live preview (used by the Animations panel). */
  previewClip(name: string) {
    this.character?.playClipOnce(name, 0.15);
  }

  /** Orient the model: per-character base offset plus the live editor offset. */
  private applyModelYaw() {
    const base = getCharacter(this.characterId).modelYaw ?? 0;
    this.character?.setModelYaw(base + this.params.modelYaw);
  }

  private applyWeapon(id: WeaponId) {
    void this.applyWeaponAsync(id);
  }

  /**
   * Equip a weapon: swap the animation set (per rig) AND mount the real GLB
   * model onto the hand bones. A token guards against overlapping async loads,
   * and a character-swap check prevents a stale mount landing on a new rig.
   */
  private async applyWeaponAsync(id: WeaponId) {
    const token = ++this.weaponToken;
    // Swapping weapons cancels any in-flight mace throw (clears the flying mesh;
    // the held weapon is about to be remounted fresh, so visibility self-heals).
    this.cancelMaceThrow();
    // Remember the choice even for a martial artist, so it re-applies when the
    // player later switches to a weapon-capable character.
    this.weaponId = id;

    // Swap the rig's animation set (procedural Explorer maps id -> animSet clips;
    // the GLB Character has no clip-swap and ignores this).
    this.character?.setWeaponId?.(id);
    // Show the weapon's category ready / guard pose (and draw flourish) on stance
    // entry. Procedural rig only; GLB rigs omit it and keep their own idle.
    this.character?.readyPose?.(id);

    // Clear any currently mounted model before loading the next.
    if (this.mounted) {
      unmountWeapon(this.mounted);
      this.mounted = null;
    }

    const character = this.character;
    const rightHand = character?.rightHand;
    const leftHand = character?.leftHand;
    // No hands to mount onto (some procedural rigs) — a valid "no weapon" state,
    // so the readiness gate counts it done rather than hanging.
    if (!character || !rightHand || !leftHand) {
      this.markReady("weapon");
      return;
    }
    const charDef = getCharacter(this.characterId);
    if (charDef.weaponless || charDef.bakedWeapon) {
      // Martial artist, or rig with a baked-in weapon mesh (e.g. Hippolin Guard).
      this.markReady("weapon");
      return;
    }

    const def = getWeapon(id);
    let mounted: MountedWeapon;
    try {
      mounted = await mountWeaponModel(def, rightHand, leftHand);
    } catch (err) {
      console.error("[Studio] weapon mount failed", err);
      this.markFailed("weapon", "Weapon model failed to load.");
      return;
    }
    // Discard if a newer weapon/character selection superseded this load.
    if (this.disposed || token !== this.weaponToken || this.character !== character) {
      unmountWeapon(mounted);
      return;
    }
    this.mounted = mounted;
    this.markReady("weapon");
    // Re-evaluate the off-hand: switching mains can make a shield (in)eligible.
    this.applyOffHand();
  }

  private applyOffHand() {
    void this.applyOffHandAsync();
  }

  /**
   * Mount (or clear) the independent off-hand piece. It only appears when an
   * off-hand id is selected AND the current main weapon is `offHandEligible`
   * (single 1H / unarmed, not already dual-wielding). The off-hand def's own
   * `hand` ("left" for the Tower Shield) routes it to the correct hand bone.
   */
  private async applyOffHandAsync() {
    const token = ++this.offHandToken;
    if (this.mountedOff) {
      unmountWeapon(this.mountedOff);
      this.mountedOff = null;
    }
    const character = this.character;
    const rightHand = character?.rightHand;
    const leftHand = character?.leftHand;
    if (!character || !rightHand || !leftHand) return;
    if (getCharacter(this.characterId).weaponless) return; // martial artist: bare hands only
    const id = this.offHandId;
    if (!id || !offHandEligible(this.weaponId)) return;
    const mounted = await mountWeaponModel(getWeapon(id), rightHand, leftHand);
    if (this.disposed || token !== this.offHandToken || this.character !== character) {
      unmountWeapon(mounted);
      return;
    }
    this.mountedOff = mounted;
  }

  /**
   * Heroes of Grudge: advance to the next weapon in the active character's
   * `loadout` (bound to Q), swapping the mounted model + animation set and
   * re-applying the off-hand. Returns false when the character has no 2+ weapon
   * loadout, so the caller can fall back to the default Q action (parry).
   */
  private cycleLoadout(): boolean {
    const loadout = getCharacter(this.characterId).loadout;
    if (!loadout || loadout.length < 2) return false;
    this.loadoutIndex = (this.loadoutIndex + 1) % loadout.length;
    this.applyWeapon(loadout[this.loadoutIndex]);
    return true;
  }

  // ---- public API (safe from React) ----

  setCharacter(id: string) {
    if (id === this.characterId && this.character) return;
    void this.spawnCharacter(id);
  }

  setWeapon(id: WeaponId) {
    if (!this.character) {
      this.weaponId = id;
      return;
    }
    this.applyWeapon(id);
  }

  /**
   * Select (or clear with `null`) the independent off-hand piece — e.g. the Tower
   * Shield equipped alongside a single one-handed weapon. The piece only mounts
   * when the current main weapon is `offHandEligible`; the selection is retained
   * either way so it reappears when you switch back to a compatible main.
   */
  setOffHand(id: WeaponId | null) {
    this.offHandId = id;
    this.applyOffHand();
  }

  /** Current off-hand slot selection (null = empty). */
  getOffHand(): WeaponId | null {
    return this.offHandId;
  }

  setParams(p: Partial<EditorParams>) {
    this.params = { ...this.params, ...p };
    this.controller?.setParams(this.params);
    this.character?.setBlendTime(this.params.blendTime);
    this.character?.setShowSkeleton(this.params.showSkeleton);
    this.applyModelYaw();
    this.room.setGridVisible(true);
    // Persist controller/camera/mouse feel so it survives reloads like every
    // other settings group (FX/sound/HUD). Explicit slider changes save now.
    this.lastSavedCamDist = this.params.cameraDistance;
    saveControls(this.params);
  }

  /**
   * Debounced persistence for settings the engine mutates outside `setParams`
   * (currently the wheel-zoomed `cameraDistance`, which the Controller writes
   * straight onto the shared params object each frame). Coalesces a burst of
   * scroll events into a single write a short while after the user stops.
   */
  private queueControlsSave() {
    if (this.controlsSaveTimer !== null) return;
    this.controlsSaveTimer = setTimeout(() => {
      this.controlsSaveTimer = null;
      this.lastSavedCamDist = this.params.cameraDistance;
      saveControls(this.params);
    }, 500);
  }

  getParams(): EditorParams {
    return { ...this.params };
  }

  /**
   * Swap the Danger Room environment preset on the fly. The room rebuilds itself
   * from the new preset; the door portal, DJ booth anchor and combat coordinates
   * are preset-independent, so dungeon entry, the resident DJ and fighting all
   * keep working. Re-shows the grid per the new preset. Persisting the choice for
   * the session is the caller's responsibility (App owns the React/storage state).
   */
  setRoomPreset(id: RoomPresetId, opts: { propagate?: boolean } = {}) {
    this.room.setPreset(id);
    // setParams' grid-visible call may not fire again, so re-assert it here
    // (gated internally by the new preset's grid opacity).
    this.room.setGridVisible(true);
    // Re-tint the scene fog/background + retune the ambient bed for the new mood.
    // Only write to the scene when actually in the Danger Room — inside the
    // dungeon the baseline stays the dungeon's dark tone until we exit.
    this.applyRoomAtmosphere(!this.inDungeon);
    this.applyRoomAmbience();
    // In a networked room the host dictates the shared environment: broadcast the
    // change so every current joiner switches arenas and late joiners inherit it
    // (the server updates the stored ContentRef). Gated to genuine user-initiated
    // changes (`propagate` defaults true) so adopting an incoming/initial preset
    // can't echo back into a loop.
    if (opts.propagate !== false && this.net?.roomCode && this.net.isHost) {
      this.net.sendPreset(id);
    }
  }

  /** Enable/disable the DJ booth's animated GLSL light show (settings toggle).
   *  The show now lives on the alcove back wall, owned by the room. */
  setDjShow(on: boolean) {
    this.room.setDjShowEnabled(on);
  }

  /** Current full-scene backdrop id (null = plain preset background). */
  getBackdropId(): string | null {
    return this.backdropId;
  }

  /**
   * Swap the full-scene battle-art backdrop (`scene.background` becomes a painted
   * texture). `null` restores the room preset's plain colour background. The
   * per-frame fog writes (`writeBaselineFog`, the water tint) only touch a
   * `THREE.Color` background, so a texture backdrop is left untouched by them.
   */
  setBackdrop(id: string | null) {
    this.backdropId = id;
    saveBackdrop(id);
    const token = ++this.backdropToken;
    if (!id) {
      if (this.backdropTex) {
        this.backdropTex.dispose();
        this.backdropTex = null;
      }
      // Restore a Color background so the fog baseline owns it again.
      this.scene.background = this.baseBgColor.clone();
      return;
    }
    const bd = BACKDROPS.find((b) => b.id === id);
    if (!bd) return;
    const url = assetUrl(bd.file);
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        if (this.disposed || token !== this.backdropToken) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        if (this.backdropTex) this.backdropTex.dispose();
        this.backdropTex = tex;
        this.scene.background = tex;
      },
      undefined,
      () => {
        /* backdrop art failed to load — keep the current background. */
      },
    );
  }

  /**
   * Adopt the active room preset's atmosphere as the Danger Room fog baseline.
   * When `applyNow` is set (i.e. we're in the Danger Room, not the dungeon) the
   * fog + background are written to the scene immediately; otherwise only the
   * stored baseline updates so {@link exitDungeon} can restore it later. Presets
   * without an `atmosphere` fall back to the original dark base tone.
   */
  private applyRoomAtmosphere(applyNow: boolean) {
    const atmo = ROOM_PRESETS[this.room.presetId].atmosphere;
    this.baseFogColor.set(atmo?.color ?? Studio.FOG_BASE_COLOR);
    this.baseFogNear = atmo?.near ?? Studio.FOG_BASE_NEAR;
    this.baseFogFar = atmo?.far ?? Studio.FOG_BASE_FAR;
    this.baseBgColor.set(atmo?.background ?? atmo?.color ?? Studio.FOG_BASE_COLOR);
    if (applyNow) this.writeBaselineFog();
  }

  /** Snap the scene fog + background to the current dry baseline (no water tint). */
  private writeBaselineFog() {
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(this.baseFogColor);
      this.scene.fog.near = this.baseFogNear;
      this.scene.fog.far = this.baseFogFar;
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.baseBgColor);
    }
  }

  /** Push the active room preset's ambient-bed character onto the sound system. */
  private applyRoomAmbience() {
    const amb = ROOM_PRESETS[this.room.presetId].ambience;
    if (amb) this.sfx?.setAmbientProfile(amb);
  }

  /** The currently-built Danger Room environment preset id. */
  getRoomPreset(): RoomPresetId {
    return this.room.presetId;
  }

  /**
   * Set the global simulation time-scale (1 = real time, < 1 = slow-motion). The
   * value is clamped to a sane range; the whole sim — physics, animation, combat
   * timers and scheduled hits — runs off the scaled delta from the next frame.
   */
  setTimeScale(scale: number) {
    this.timeScale = THREE.MathUtils.clamp(scale, 0.05, 4);
  }

  /** Current global simulation time-scale (1 = real time). */
  getTimeScale(): number {
    return this.timeScale;
  }

  /** Whether all sound (combat one-shots, ambient bed, klaxon) is muted. */
  isMuted(): boolean {
    return this.sound.muted;
  }

  /** Mute/unmute all sound and persist the choice across sessions. */
  setMuted(muted: boolean): void {
    this.sound.muted = muted;
    this.sfx?.setMuted(muted);
    saveSound(this.sound);
  }

  /** Current sound mixer settings (mute + master/combat/ambient/klaxon levels). */
  soundSettings(): SoundSettings {
    return { ...this.sound };
  }

  /**
   * Set one mixer channel level (0..1) and persist it. Muting still hard-silences
   * everything; these levels are what unmuting restores.
   */
  setSoundLevel(channel: "master" | "combat" | "ambient" | "klaxon" | "music", value: number): void {
    const v = Math.max(0, Math.min(1, value));
    this.sound[channel] = v;
    this.sfx?.setLevels({ [channel]: v });
    saveSound(this.sound);
  }

  /** Live-tune the GPU flame system (trailing fire + impact explode). */
  setFireParams(p: FireFxParams) {
    this.vfx.setFireParams(p);
  }

  /** Fire a test impact-explode burst in front of the current character. */
  testImpactExplode() {
    if (!this.character) return;
    const p = this.character.root.position.clone();
    const fwd = this.controller?.forward() ?? new THREE.Vector3(0, 0, -1);
    p.addScaledVector(fwd, 1.6);
    p.y += 1.1;
    this.vfx.impactExplode(p, this.fireThemeApplied);
  }

  attack() {
    if (!this.character) return;
    if (this.spectating) return;
    if (this.castCtrl.isActive()) {
      this.confirmSkillCast();
      return;
    }
    // Piloting the exo-armour: a scaled-up mech strike replaces the normal combo.
    if (this.mech.isPiloted) {
      this.doMechPunch();
      return;
    }
    // Mid offense-fail recovery: the swing was blocked/parried/dodged and the
    // player is paying the lost-tempo beat — no new attack until it clears.
    if (this.recoverLock > 0) return;
    // Staffs are RANGED casters, not melee: the light attack fires a themed
    // spline bolt instead of a melee combo. On the ground it carries a small
    // back-step (kiting), and while airborne / floating it casts in place. This
    // runs BEFORE the air branch so a floating mage casts a bolt rather than a
    // crash-down ground slam.
    if (this.isStaffEquipped()) {
      this.doStaffBolt();
      return;
    }
    // From the air, a light attack ALWAYS becomes a crash-down ground slam
    // (explosion + force shockwave + knock-up on landing) — never a grounded
    // combo swing. (If a slam is already pending, groundSlam no-ops.)
    if (this.controller && !this.controller.state.grounded) {
      // Dagger loadout: an airborne light attack becomes an angled overhead dagger
      // slash — a diving forward strike that lands at the END of the swing — instead
      // of the generic crash-down slam. Other weapon classes keep the ground slam
      // (gated on the knife animSet + the procedural rig that ships the overhead clip).
      const airWid: WeaponId = getCharacter(this.characterId).weaponless ? "none" : this.weaponId;
      if (getWeapon(airWid).animSet === "knife" && this.character.hasClip("jumpAttack")) {
        this.aerialDaggerSlash();
        return;
      }
      this.groundSlam();
      return;
    }
    // Broadcast a swing so remote clients animate this player's attack.
    if (this.net?.roomCode) {
      this.net.sendCombat({ k: "attack", from: this.net.selfId, action: "attack" });
    }
    const def = getCharacter(this.characterId);
    if (def.meleeStyle === "kick") {
      // Striker 3-hit fire kick combo. Each hit plays a real clip plus themed VFX;
      // a brief lock stops spam from skipping stages, and the chain window resets
      // back to hit 0 when the player pauses between clicks.
      if (this.kickComboLock > 0) return;
      const stage = this.kickComboTimer > 0 ? this.kickComboIndex : 0;
      const dur = this.doKickCombo(stage);
      this.kickComboIndex = (stage + 1) % 3;
      // Lock + chain window ride the real clip length so each kick plays through.
      this.kickComboTimer = dur > 0 ? dur + COMBO_GRACE : KICK_COMBO_WINDOW;
      this.kickComboLock = dur > 0 ? dur * COMBO_PLAYTHROUGH : stage === 2 ? 0.55 : 0.3;
      return;
    }
    // Pistol "Kiter" primary: proximity-adaptive shoot-and-backstep / MMA kick.
    if (def.kiter && this.weaponId === "pistol") {
      this.doPistolPrimary(def.kiter);
      return;
    }
    // Weapon characters run a 3-hit combo. A brief lock stops spam from skipping
    // stages; the chain window (comboTimer) resets the combo to hit 0 when idle.
    if (this.comboLock > 0) return;
    const stage = this.comboTimer > 0 ? this.comboIndex : 0;
    const dur = this.doComboHit(stage);
    this.comboIndex = (stage + 1) % 3;
    // Lock + chain window ride the real clip length so each swing plays through
    // most of the way before the next hit chains (no more truncated half-swings).
    this.comboTimer = dur > 0 ? dur + COMBO_GRACE : COMBO_WINDOW;
    this.comboLock = dur > 0 ? dur * COMBO_PLAYTHROUGH : stage === 0 ? 0.22 : 0.16;
  }

  /**
   * Camera ray from the crosshair (screen centre). Delegates to the shared
   * `AimSystem.screenCenterRay` so both surfaces share one aim-ray definition —
   * this is the same ray in first- and third-person.
   */
  private crosshairRay(): THREE.Ray {
    return screenCenterRay(this.camera);
  }

  /**
   * Pick the living target under the crosshair. The weapon's `direction` (1-100)
   * widens the soft-aim cone: 100 = generous lock-on, low = near-pixel precise.
   */
  private pickCrosshairTarget(combat: WeaponCombat): TargetHandle | null {
    const dirN = THREE.MathUtils.clamp(combat.direction, 0, 100) / 100;
    // Higher softCos = tighter cone. dirN 1 -> ~35deg wide, dirN 0 -> ~7deg tight.
    const softCos = THREE.MathUtils.lerp(0.992, 0.82, dirN);
    return this.targets.raycast(this.crosshairRay(), 18, softCos);
  }

  /** Planar (XZ) direction + distance from the character to a target. */
  private toTargetPlanar(target: TargetHandle): { dir: THREE.Vector3; dist: number } {
    const to = target.position.clone().sub(this.character.root.position);
    to.y = 0;
    const dist = to.length();
    return { dir: dist > 1e-4 ? to.multiplyScalar(1 / dist) : this.facing(), dist };
  }

  /**
   * World position the slash/swing SFX should emanate from: the weapon's blade
   * tip (its collision/damage edge) when armed, else the character's chest.
   */
  private bladeEmitPos(): THREE.Vector3 {
    const out = new THREE.Vector3();
    if (this.mounted?.tip) {
      this.mounted.tip.getWorldPosition(out);
      return out;
    }
    if (this.character) {
      out.copy(this.character.root.position);
      out.y += 1.1;
    }
    return out;
  }

  /**
   * Sweep the MAIN weapon's cutting edge (world-space edge anchors set at mount)
   * against every enemy's blade-collision volumes for the current frame, routing
   * each fresh contact to {@link onBladeContact}. No-op when the weapon has no
   * edge (e.g. weaponless / GLB without anchors) or the arena provides no
   * bladeDefenders.
   */
  private updateBlade() {
    const m = this.mounted;
    if (!m?.edgeA || !m.edgeB || !this.character || !this.targets.bladeDefenders) return;
    const a = m.edgeA.getWorldPosition(this._bladeA);
    const b = m.edgeB.getWorldPosition(this._bladeB);
    const radius = m.edgeRadius > 0 ? m.edgeRadius : 0.12;
    const defenders = this.targets.bladeDefenders(this.character.root.position);
    if (defenders.length === 0) return;
    this.blade.update(a, b, radius, defenders, (c) => this.onBladeContact(c));
  }

  /**
   * React to a physical blade contact. Weapon clash = sparks + mutual recoil +
   * this swing whiffs (steel deflected). Shield contact = clank + spark, force
   * the guard so the scheduled hit resolves as a block, and recoil the attacker.
   * Body contact = a precise contact spark at the true edge point (the combo hit
   * still owns the damage/reaction).
   */
  private onBladeContact(c: BladeContact) {
    if (c.kind === "weapon") {
      this.vfx.impact(c.point, 0xfff1c0, 1.6);
      this.vfx.impact(c.point, 0xffd060, 1.0);
      this.sfx?.play("bladeHit", c.point, { volume: 1 });
      this.recoverLock = Math.max(this.recoverLock, 0.28);
      this.bladeSwingCancelled = true;
      if (this.character && this.controller) {
        const back = this.character.root.position.clone().sub(c.point);
        back.y = 0;
        if (back.lengthSq() > 1e-4) this.controller.dash(back.normalize(), 0.5, 0.14, 0, 0.3);
      }
      this.setCombatFlash("CLASH!", 0.4);
    } else if (c.kind === "shield") {
      this.vfx.impact(c.point, 0xbfe4ff, 1.3);
      this.sfx?.play("bladeHit", c.point, { volume: 0.85 });
      this.targets.forceGuard?.(c.id, 0.25);
      this.recoverLock = Math.max(this.recoverLock, 0.2);
    } else {
      this.vfx.impact(c.point, this.swingColor, 1.0);
    }
  }

  /**
   * One swing of the weapon combo. Hit 0 is a fast dash-closer (with a mesh
   * afterimage tail) that stops inside the weapon's reach band — never past it;
   * hits 1-2 are short momentum lunges, and hit 2 is a heavier finisher. Every
   * hit faces the crosshair target first, and all damage/force/reach/steer scale
   * from the weapon's combat profile.
   */
  private doComboHit(stage: number): number {
    if (!this.character || !this.controller) return 0;
    const weaponless = !!getCharacter(this.characterId).weaponless;
    const wid: WeaponId = weaponless ? "none" : this.weaponId;
    const combat = weaponCombat(wid);
    const intensityN = THREE.MathUtils.clamp(combat.intensity, 1, 100) / 100;
    const dirN = THREE.MathUtils.clamp(combat.direction, 0, 100) / 100;
    const [rMin, rMax] = combat.range;
    const origin = this.character.root.position.clone();

    // Acquire the crosshair target and steer the strike toward it (steer blend
    // scales with `direction`), then commit the body facing before striking.
    const target = this.pickCrosshairTarget(combat);
    const aim = this.controller.forward();
    const dir = aim.clone();
    let targetDist = Infinity;
    if (target) {
      const planar = this.toTargetPlanar(target);
      targetDist = planar.dist;
      const steer = THREE.MathUtils.clamp(THREE.MathUtils.lerp(0.3, 1, dirN) * this.params.attackSteer, 0, 1);
      dir.lerp(planar.dir, steer).normalize();
    }
    this.controller.faceToward(dir, 0.18);

    // The real attack clip drives the joints (no canned motion). When the player
    // is MOVING on the ground and the rig supports it, the swing layers over
    // locomotion as an upper-body additive overlay (a fluid moving attack — legs
    // keep walking) instead of a rooted full-body one-shot. Standing swings, or
    // clips without upper-body tracks, fall back to the rooted one-shot.
    const primary = this.overrides.primary;
    const overlayName = primary && this.character.hasClip(primary) ? primary : null;
    const cstate = this.controller.state;
    const moving = cstate.grounded && cstate.speed > 0.2;
    let dur = 0;
    if (moving && overlayName && this.character.playClipOverlay) {
      dur = this.character.playClipOverlay(overlayName, cstate.speed);
    }
    if (dur <= 0) {
      if (overlayName) dur = this.character.playClipOnce(overlayName, 0.1);
      else if (this.character.hasRole("attack")) dur = this.character.playRoleOnce("attack", 0.1);
    }
    this.swingTimer = dur > 0 ? dur * 0.45 : 0.2;

    // Open the swept-edge blade window for this cut: the update loop sweeps the
    // weapon's cutting edge against enemy shields/weapons/bodies until it closes.
    this.blade.beginSwing();
    this.bladeWindow = Math.max(0.18, (dur > 0 ? dur : 0.35) * 0.9);
    this.bladeSwingCancelled = false;

    const color = SKILL_COLOR[getWeapon(wid).kind] ?? 0x9fe8ff;
    this.swingColor = color;
    const finisher = stage === 2;

    // Slash whoosh for THIS combo cut — emitted from the weapon's blade/edge (its
    // collision-damage part) so the cut sounds like it comes from the steel, not
    // the chest. Finishers get the heavier air-rip.
    this.sfx?.play(
      finisher ? "whooshHeavy" : "whooshLight",
      this.bladeEmitPos(),
      { volume: finisher ? 0.95 : 0.8 },
    );

    // Respect-through-range verdict: classify this swing against the OWR of both
    // fighters. A follow-up swing (stage > 0) is a COMMITTED forward lunge, so it
    // can earn a penetration reward or be punished for a mistimed gap-close. The
    // timing quality is how well the closing distance sits in the optimal band.
    const scale = CHARACTER_HEIGHT_M / 1.8;
    const attackerOWR = weaponOWR(combat, getWeapon(wid).group, scale);
    const defenderOWR = weaponOWR(undefined, "melee-1h", scale);
    const optimalMid = (attackerOWR.optimalMin + attackerOWR.optimalMax) * 0.5;
    const span = Math.max(attackerOWR.outer - attackerOWR.optimalMin, 0.5);
    const timingQuality = Number.isFinite(targetDist)
      ? 1 - THREE.MathUtils.clamp(Math.abs(targetDist - optimalMid) / span, 0, 1)
      : 0;
    const verdict = Number.isFinite(targetDist)
      ? classifyEngagement({
          dist: targetDist,
          attacker: attackerOWR,
          defender: defenderOWR,
          committedLunge: stage > 0,
          timingQuality,
        })
      : null;

    if (stage === 0) {
      // Dash-closer: bring the body to ~mid of the reach band, clamped so we stop
      // INSIDE weapon range and never blow past the target.
      const desired = THREE.MathUtils.lerp(rMin, rMax, 0.5);
      const close = Number.isFinite(targetDist)
        ? THREE.MathUtils.clamp(targetDist - desired, 0, this.params.dashDistance)
        : Math.min(rMax, this.params.dashDistance * 0.5);
      const dashDur = 0.22; // quicker than a normal swing
      const impactAt = 0.7;
      this.controller.dash(dir, close, dashDur, 0, impactAt);
      // Motion-blur tail built from the character's OWN mesh.
      this.vfx.afterimage(this.character.root, origin, dir, Math.max(close, 0.6), color, 4, 0.3);
      this.scheduleComboHit(dashDur * impactAt, dir, rMin, rMax, intensityN, color, finisher, verdict);
    } else {
      // Forward gap-closer lunge (USER-DIRECTED): each follow-up swing drives the
      // body INTO the enemy. Base advance comes from the motion-math knob; a small
      // intensity bonus keeps heavier weapons hitting weightier. Only a slight
      // recoil so the combo keeps the ground it gained (~1m+ across hits 1-2).
      const lunge = COMBO_ADVANCE_MM * MM_TO_M + 0.3 * intensityN;
      const dashDur = 0.18;
      const impactAt = 0.5;
      this.controller.dash(dir, lunge, dashDur, lunge * 0.12, impactAt);
      // The finisher is a big committed swing whose blade lands near the END of the
      // clip; time its hit to the real clip impact (not the ~90 ms dash impact) so
      // the damage/VFX connect with the swing instead of resolving in empty air.
      const hitDelay =
        finisher && dur > 0
          ? THREE.MathUtils.clamp(dur * FINISHER_IMPACT_FRAC, 0.12, 0.7)
          : dashDur * impactAt;
      this.scheduleComboHit(hitDelay, dir, rMin, rMax, intensityN, color, finisher, verdict);
    }
    return dur;
  }

  /**
   * Resolve a combo hit at the expected in-range strike spot. The center sits at
   * the MID of the weapon reach band ahead of the body-at-impact, and the radius
   * covers the band (plus a small forgiveness margin) — both tied to the weapon's
   * range, never scaled past it, so long weapons don't get an oversized AoE.
   */
  private scheduleComboHit(
    delay: number,
    dir: THREE.Vector3,
    rMin: number,
    rMax: number,
    intensityN: number,
    color: number,
    finisher: boolean,
    verdict: ReturnType<typeof classifyEngagement> | null,
  ) {
    this.schedule(delay, () => {
      if (!this.character) return;
      // A mid-swing blade clash (steel met steel) consumed this cut: no damage
      // resolves — the physical clash already fired sparks + mutual recoil.
      if (this.bladeSwingCancelled) return;
      // Shared scriptable-weapon resolution: same path the AI opponents use.
      const strike = meleeStrike(
        { intensity: intensityN * 100, direction: 0, range: [rMin, rMax] },
        { finisher, skillForce: this.params.skillForce },
      );
      // Respect-through-range: scale this hit by the OWR verdict. A clean hit is
      // full damage; a spacing-disadvantage poke is weak; a well-timed
      // penetration is a big reward, a mistimed one barely connects.
      // Respect-timer counter: if a successful defense opened a defender-advantage
      // window, the first swing inside it is a punishing counter. Consumed only on
      // a CONFIRMED landed hit below (a whiff/blocked swing must not waste it).
      const counter = this.respectWindow > 0;
      const dmgMul = (verdict ? verdict.damageMul : 1) * (counter ? 1.5 : 1);
      const center = this.character.root.position.clone().addScaledVector(dir, strike.reach);
      center.y += 1.0;
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.character.root.rotation.y, 0));
      // Always draw the cut from the swinging weapon's world pose so the slash
      // originates from — and points out of — the weapon mesh (the HIT center is
      // unchanged), tagged with the weapon's stable crescent so each weapon keeps
      // one consistent slash throughout.
      const wp = this.weaponPose();
      this.vfx.slashArc(wp ? wp.pos : center, wp ? wp.quat : quat, color, this.slashIndexForWeapon());
      // Unified player attack: resolves against the focused enemy's own
      // CombatController (parry/block/dodge + damage applied internally) with
      // lighter AoE splash to others in range. Impact/reaction VFX fire through
      // targets.onPlayerHit; here we add the swing's generic impact burst.
      const payload: AttackPayload = {
        force: finisher ? 2 : 1,
        damage: strike.damage * dmgMul,
        poiseDamage: Math.round(strike.damage * dmgMul * 0.65),
      };
      const result = this.targets.playerHit(center, strike.radius, payload, strike.force, this.sparCtx);
      const landed = !result || result.outcome === "hit" || result.outcome === "crit";
      if (landed && counter) {
        // The defender-advantage window only burns on a swing that actually
        // connects, so a whiffed/blocked counter keeps its window alive.
        this.respectWindow = 0;
        this.setCombatFlash("COUNTER!", 0.6);
      }
      if (landed) {
        // A connecting blow heats the combat-music bed (finishers hit harder).
        this.bumpMusicHeat(finisher ? 0.45 : 0.28);
        this.vfx.impact(center, color, strike.radius * (finisher ? 1.25 : 1));
        this.vfx.impactExplode(center, this.fireThemeApplied);
        // Connect the strike with the right flesh/steel impact. Bladed groups ring
        // metallic; everything else thuds. Finishers add a heavier hit + a bone snap.
        const grp = this.playerGroup();
        const bladed = grp === "melee-1h" || grp === "melee-2h";
        if (finisher) {
          this.sfx?.play("heavyHit", center, { volume: 1 });
          this.sfx?.play("boneBreak", center, { volume: 0.55 });
        } else {
          this.sfx?.play(bladed ? "bladeHit" : "bodyHit", center, { volume: 0.9 });
        }
        if (finisher) {
          // Finisher knock-up: pop struck enemies into the air + a force shock
          // ring so weapon combos end with a launch (set up aerial follow-ups).
          this.targets.launch(center, strike.radius * 1.1, 0, 5);
          this.vfx.shockwave(new THREE.Vector3(center.x, 0.05, center.z), color, strike.radius * 1.2, 0.5);
        }
      }
      // Respect-through-range feedback + consequences, only when a strike actually
      // connected (so whiffs into empty air don't fire cinematics).
      if (verdict && landed) this.applyRangeConsequence(verdict, center, color);
      this.hitBags(center, strike.radius, strike.force, payload.damage);
      // Wildlife take melee too (additive; doesn't replace fighter hits).
      this.wildlife?.damageNear(center, strike.radius, Math.max(8, Math.round(payload.damage * 0.85)));
      // Forward the strike to networked combatants (PvP players / coop NPCs).
      this.netStrike(center, strike.radius, payload.damage);
    });
  }

  /**
   * Classify the nearest enemy against the player's current weapon OWR for the
   * reticle distance ring, and fire a short WebAudio "edge" beep whenever the
   * band changes — the unmissable cue that you've crossed into/out of optimal
   * range. Cheap: one nearest-target lookup + a band compare per frame.
   */
  private updateOwrRange() {
    if (!this.character) {
      this.owrRangeState = "none";
      return;
    }
    const playerPos = this.character.root.position;
    const near = this.targets.nearest(playerPos, 1);
    let state: "close" | "optimal" | "far" | "none" = "none";
    if (near.length && near[0].alive) {
      const dx = near[0].position.x - playerPos.x;
      const dz = near[0].position.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      const scale = CHARACTER_HEIGHT_M / 1.8;
      const owr = weaponOWR(weaponCombat(this.weaponId), getWeapon(this.weaponId).group, scale);
      if (dist > owr.outer * 1.6) state = "none";
      else if (dist < owr.optimalMin) state = "close";
      else if (dist > owr.optimalMax) state = "far";
      else state = "optimal";
    }
    if (state !== this.owrRangeState) {
      // Edge cue: a soft tone when you ENTER the optimal band, a duller one when
      // you slip out of it. No beep for none<->none churn.
      if (state === "optimal") this.owrEdgeBeep(880, 0.05);
      else if (this.owrRangeState === "optimal") this.owrEdgeBeep(330, 0.07);
      this.owrRangeState = state;
    }
  }

  /** Tiny self-contained WebAudio blip (no asset, no external TTS) for OWR edges. */
  private owrEdgeBeep(freq: number, dur: number) {
    try {
      type WinAudio = typeof window & { webkitAudioContext?: typeof AudioContext };
      if (!this.owrAudioCtx) {
        const Ctor = window.AudioContext ?? (window as WinAudio).webkitAudioContext;
        if (!Ctor) return;
        this.owrAudioCtx = new Ctor();
      }
      const ac = this.owrAudioCtx;
      if (ac.state === "suspended") void ac.resume();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ac.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + dur + 0.02);
    } catch {
      // Audio is a non-essential cue; never let it break the frame.
    }
  }

  /** Streak of consecutive landed combo hits (drives the 3-in-a-row stun). */
  private hitStreak = 0;
  private hitStreakAt = 0;

  /**
   * Respect timer: seconds of defender advantage opened by a successful defense
   * (block / parry / dodge) against an opponent strike. While it ticks, the
   * player's next landed swing is a punishing counter (bonus damage + flash).
   */
  private respectWindow = 0;

  /**
   * Monotonic tokens so overlapping range consequences cannot restore stale
   * state: only the latest-issued restore for each effect actually fires.
   * `slowmoBase` is the time-scale captured when the FIRST slow-mo of a burst
   * began, so the final restore returns to the true pre-slow-mo value.
   */
  private slowmoToken = 0;
  private slowmoBase = 1;
  private exposeToken = 0;

  /**
   * Apply the visible consequence of an OWR verdict on a landed player strike:
   * the penetration-success slow-mo + flash, the spacing-disadvantage punish
   * read-out, and a stun reward for landing three clean hits in a row.
   */
  private applyRangeConsequence(
    verdict: { outcome: RangeOutcome; slowmo: boolean; exposeWindow: number },
    center: THREE.Vector3,
    color: number,
  ) {
    if (verdict.outcome === "penetrationSuccess" || verdict.slowmo) {
      // Brief cinematic: bullet-time + flash on a clean breach. Capture the base
      // time-scale only when no slow-mo is already running, and gate the restore
      // on a monotonic token so an overlapping breach can't get stuck in slow-mo.
      if (this.slowmoToken === 0) this.slowmoBase = this.getTimeScale();
      const tok = ++this.slowmoToken;
      this.setTimeScale(0.32);
      this.setCombatFlash("PENETRATION!", 0.9);
      this.schedule(0.18, () => {
        if (tok !== this.slowmoToken) return; // a later breach owns the restore
        this.setTimeScale(this.slowmoBase);
        this.slowmoToken = 0;
      });
    } else if (verdict.outcome === "penetrationFail") {
      // Mistimed breach: you carried THROUGH the target and left yourself open —
      // a forward momentum carry plus a temporary move-speed cap so you can't
      // instantly reposition out of the punish window the defender just earned.
      // Token-gated restore so overlapping fails can't end an expose early.
      this.setCombatFlash("OVEREXTENDED", 0.7);
      const fwd = this.controller.forward();
      this.controller.applyImpulse(fwd, 6);
      const expose = verdict.exposeWindow > 0 ? verdict.exposeWindow : 0.7;
      const tok = ++this.exposeToken;
      this.controller.setSpeedMultiplier(0.4);
      this.schedule(expose, () => {
        if (tok === this.exposeToken) this.controller.setSpeedMultiplier(this.baseSpeedMul());
      });
    } else if (verdict.outcome === "spacingDisadvantage") {
      this.setCombatFlash("BAD SPACING", 0.7);
    }

    // Reward sustained clean pressure: three clean/penetration hits in a row
    // stun the struck enemy (resets if you go quiet for >2.5 s or whiff).
    const now = this.timer.getElapsed();
    if (verdict.outcome === "clean" || verdict.outcome === "penetrationSuccess") {
      if (now - this.hitStreakAt > 2.5) this.hitStreak = 0;
      this.hitStreak += 1;
      this.hitStreakAt = now;
      if (this.hitStreak >= 3) {
        this.hitStreak = 0;
        this.setCombatFlash("STUN COMBO!", 1.0);
        this.vfx.shockwave(new THREE.Vector3(center.x, 0.05, center.z), color, 2.0, 0.45);
        this.targets.stun(center, 2.2, 1.3);
      }
    } else {
      this.hitStreak = 0;
    }
  }

  // ---- Sparring: difficulty, block/parry, taking damage, respawn ----

  /** Set the sparring difficulty (passive = inert training dummies). */
  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    // While a duel is running it owns the Targets AI tier (the countdown/result
    // phases force "passive"). Route the choice to the duel + the restore-on-stop
    // value instead of writing Targets directly, which would break the freeze.
    if (this.duel?.isActive) {
      this.duelSavedDifficulty = d;
      this.duel.setDifficulty(d);
      return;
    }
    this.targets.setDifficulty(d);
  }

  /** Resize the opponent ring (1-8 fighters). */
  setOpponentCount(n: number) {
    this.targets.setCount(n);
  }

  /** Spawn one NPC of the given faction wielding `weaponId` (additive). */
  spawnNpc(weaponId: WeaponId, faction: Faction) {
    this.targets.spawn(weaponId, faction);
  }

  /**
   * Spawn a single BOSS enemy in front of the player (additive). Bosses use the
   * unified `boss` combat archetype: large health/poise and unblockable skill
   * swings (force 4 → dodge-only). Resolves through the same per-fighter
   * CombatController as every other fighter.
   */
  spawnBoss(weaponId: WeaponId) {
    if (!(this.targets instanceof Targets)) return;
    const p = this.character?.root.position ?? new THREE.Vector3();
    const angle = Math.random() * Math.PI * 2;
    const pos = new THREE.Vector3(
      p.x + Math.cos(angle) * 7,
      0,
      p.z + Math.sin(angle) * 7,
    );
    this.targets.spawnAt(pos, weaponId, "enemy", { scale: 1.7, arch: "boss" });
  }

  /** Remove every spawned NPC (both factions). */
  clearNpcs() {
    this.targets.clear();
  }

  getDifficulty(): Difficulty {
    return this.difficulty;
  }

  /**
   * Start an AI-vs-AI Explorer duel in the Danger Room: hide the player, hand the
   * arena over to the {@link Duel} orchestrator, and switch to a spectator view.
   * No-op inside the dungeon or non-Targets populations.
   */
  startDuel(teamSize = 1) {
    if (this.inDungeon) return;
    if (!(this.targets instanceof Targets)) return;
    if (!this.duel) this.duel = new Duel(this.targets);
    if (this.duel.isActive) return;
    // The player becomes a hidden spectator — tear down any active exo-armour so
    // it doesn't linger in the scene or keep the speed/visibility overrides.
    this.cancelMech();
    this.duelSavedDifficulty = this.difficulty;
    if (this.character) this.character.root.visible = false;
    this.duel.setTeamSize(teamSize);
    this.duel.start(this.difficulty === "passive" ? "hard" : this.difficulty);
    this.ale.onDuelStart(this.duel.state());
  }

  /** Stop the active duel, restore the player + the pre-duel difficulty. */
  stopDuel() {
    if (!this.duel?.isActive) return;
    this.duel.stop();
    this.ale.onDuelStop();
    if (this.character) this.character.root.visible = true;
    if (this.duelSavedDifficulty) {
      this.setDifficulty(this.duelSavedDifficulty);
      this.duelSavedDifficulty = null;
    }
  }

  /** Live duel snapshot for the HUD, or null when no duel is running. */
  duelState(): DuelState | null {
    return this.duel?.isActive ? this.duel.state() : null;
  }

  /** True while a duel is running (player is a spectator: hidden + no offense). */
  private get spectating(): boolean {
    return !!this.duel?.isActive;
  }

  private startBlock() {
    if (this.defeated) return;
    this.blocking = true;
    // Single combat authority: raise the player CC's guard. Block is bound to
    // Ctrl (hold); lock-on is now a separate RMB toggle, so blocking no longer
    // seizes the camera — the always-on soft-lock keeps you roughly facing the
    // foe while you guard.
    this.sparring?.startBlock();
  }
  private endBlock() {
    this.blocking = false;
    this.blockViaTouch = false;
    this.sparring?.endBlock();
  }

  /** Ctrl+Space: an aerial guard — hop while keeping the raised block up. */
  private airBlock() {
    if (this.defeated) return;
    if (!this.blocking) this.startBlock();
    this.controller?.jump();
    this.setCombatFlash("AIR BLOCK", 0.6);
  }

  /**
   * RMB toggle: engage / release the hard lock-on focus. Tapping locks onto the
   * soft-lock target (or nearest living enemy) and commits the camera + body
   * facing (face + strafe); tapping again frees the camera. Distinct from the
   * gentle always-on soft-lock.
   */
  toggleLock() {
    if (this.defeated) return;
    if (this.locked) {
      this.locked = false;
      this.controller?.setLockTarget(null);
      this.setCombatFlash("LOCK OFF", 0.5);
      return;
    }
    const p = this.character?.root.position ?? new THREE.Vector3();
    const lp = this.targets.acquireNearest(p);
    if (lp) {
      this.locked = true;
      this.softLockEnabled = true;
      this.controller?.setLockTarget(lp);
      this.setCombatFlash("LOCK ON", 0.5);
    }
  }

  /** Tab re-arms the always-on soft-lock (used before cycling the target). */
  enableSoftLock() {
    this.softLockEnabled = true;
  }

  /**
   * Alt+Tab: leave the soft-lock and return to a fully free camera. Clears the
   * highlighted target unless a hard lock (RMB) is still holding it.
   */
  exitSoftLock() {
    this.softLockEnabled = false;
    this.controller?.setSoftTarget(null);
    if (!this.locked) this.targets.clearSelection?.();
  }

  /** Mirror of the desktop block for touch controls. */
  touchBlock(on: boolean) {
    if (on) {
      this.blockViaTouch = true;
      this.startBlock();
    } else {
      this.endBlock();
    }
  }

  /**
   * (Re)bind the player-combat VFX hooks onto the current {@link CombatTargets}
   * population. Called after construction and after every danger⇄dungeon swap so
   * impact/reaction VFX keep firing through the shared CombatTargets surface, and
   * the population can resolve the player's defensive exchanges against its CC.
   */
  private wireTargetCombatHooks(): void {
    this.targets.setPlayerCC(this.sparring?.playerCC ?? null);
    this.targets.onPlayerHit = (result, pos) => {
      switch (result.outcome) {
        case "perfectParry":
          // Enemy perfect-parried the player → the player is the loser. Hardest
          // fail: a hard backward recoil + the long wall-crash stagger leave the
          // player wide open for the longest beat.
          this.setCombatFlash("PARRIED!", 1.2);
          this.sfx?.play("block", pos, { volume: 1, rate: 0.85 });
          this.blockShield(pos, true);
          this.vfx.burst(pos, 0xffe0a0, 40, 6);
          this.vfx.shockwave(new THREE.Vector3(pos.x, 0.05, pos.z), 0xffd060, 2.5, 0.5);
          this.playPlayerReaction("wallCrash");
          this.recoverFromFail(0.95, -2.6, pos);
          break;
        case "deflect":
          // Blade rang off the enemy's guard — a clean stance recoil, short beat.
          this.sfx?.play("block", pos, { volume: 0.85, rate: 1.1 });
          this.blockShield(pos);
          this.vfx.burst(pos, 0x88aaff, 20, 3.5);
          this.setCombatFlash("DEFLECTED", 0.7);
          this.reactWithClip(defenseClips(this.playerGroup()).parry, 0.1);
          this.recoverFromFail(0.45, -1.6, pos);
          break;
        case "blockStop":
          // Enemy soaked the hit on its guard. Shield-break (their guard breaks)
          // is GOOD for the player — no recovery; a plain block costs a short beat.
          this.sfx?.play("block", pos, { volume: 0.95 });
          this.blockShield(pos, result.defenderReaction === "stunned");
          this.vfx.burst(pos, 0xaaccff, 18, 3);
          if (result.defenderReaction === "stunned") {
            this.setCombatFlash("SHIELD BREAK!", 1.5);
          } else {
            this.setCombatFlash("BLOCKED", 0.7);
            this.reactWithClip(defenseClips(this.playerGroup()).parry, 0.1);
            this.recoverFromFail(0.4, -1.4, pos);
          }
          break;
        case "dodgeEvade":
          // Enemy slipped the swing — the player over-commits forward into the
          // empty space they just vacated.
          this.vfx.burst(pos, 0x80ff80, 14, 2.5);
          this.setCombatFlash("WHIFF", 0.7);
          this.reactWithClip(defenseClips(this.playerGroup()).stumble, 0.08);
          this.recoverFromFail(0.5, 1.3, pos);
          break;
        case "dodgePunish":
          // Enemy dodged inside the punish window — heavier stumble, longest
          // open window of the avoid outcomes.
          this.setCombatFlash("PUNISH!", 1.0);
          this.vfx.burst(pos, 0x80ff80, 22, 4);
          this.reactWithClip(defenseClips(this.playerGroup()).stumble, 0.08);
          this.recoverFromFail(0.8, 1.7, pos);
          break;
        case "crit":
          this.setCombatFlash("CRIT!", 0.9);
          this.vfx.impactExplode(pos, this.fireThemeApplied);
          break;
        case "hit":
          break;
      }
    };
    this.targets.onEnemyState = (pos, state) => {
      if (state === "stagger") {
        this.vfx.burst(pos, 0xff9040, 14, 3);
      } else if (state === "stunned") {
        this.setCombatFlash("STUNNED!", 1.5);
        this.vfx.burst(pos, 0xffaa40, 26, 5);
        this.vfx.shockwave(new THREE.Vector3(pos.x, 0.05, pos.z), 0xff8020, 1.8, 0.4);
      } else if (state === "fallen") {
        this.setCombatFlash("KNOCKED DOWN!", 1.5);
        this.vfx.burst(pos, 0xffd060, 32, 6);
        this.vfx.shockwave(new THREE.Vector3(pos.x, 0.05, pos.z), 0xff6000, 2.5, 0.5);
      }
    };
  }

  /**
   * Resolve an opponent's strike against the player through the SINGLE combat
   * authority: the player's CombatController applies block/parry/dodge mitigation,
   * health/poise/stamina, and the attacker's reaction internally based on the
   * player's current defensive input. We only add physics recoil + hurt VFX and
   * relay the resolved {@link DefensiveResult} back to the attacker.
   */
  /**
   * Per-attack presentation cue for the heavy bear's three moves, keyed off the
   * attack's {@link BearAttack.impactTier}. `"swing"` plays the wind-up whoosh as
   * the body motion kicks off (lighter air for the jab, heavier for the chop/
   * pound); `"land"` plays the impact at the hit point — the slam (AoE) lands a
   * heavier thud + a bone-snap + a ground shockwave, the swipe/maul a lighter
   * body/heavy hit. Keeps the slam unmistakably the biggest blow.
   */
  private playBearAttackCue(at: THREE.Vector3, attack: BearAttack, moment: "swing" | "land"): void {
    const heavy = attack.impactTier !== "light";
    if (moment === "swing") {
      this.sfx?.play(heavy ? "whooshHeavy" : "whooshLight", at, {
        volume: heavy ? 0.85 : 0.7,
        rate: heavy ? 0.85 : 1.1,
      });
      return;
    }
    if (attack.impactTier === "slam") {
      this.sfx?.play("heavyHit", at, { volume: 1, rate: 0.78 });
      this.sfx?.play("boneBreak", at, { volume: 0.5 });
      this.vfx.shockwave(
        new THREE.Vector3(at.x, 0.05, at.z),
        0xffb24d,
        Math.max(2, attack.radiusBonus + 1.4),
        0.55,
      );
    } else if (attack.impactTier === "heavy") {
      this.sfx?.play("heavyHit", at, { volume: 0.85 });
    } else {
      this.sfx?.play("bodyHit", at, { volume: 0.8 });
    }
  }

  /** Origin of the most recent incoming strike, for directional guard reacts. */
  private lastStrikeFrom: THREE.Vector3 | null = null;

  private resolveOpponentStrike(
    center: THREE.Vector3,
    radius: number,
    damage: number,
    force: number,
    from: THREE.Vector3,
    kind: SkillKind,
    isSkill: boolean,
  ): DefensiveResult | null {
    if (!this.character || this.defeated || this.invuln > 0) return null;
    const chest = this.character.root.position.clone();
    chest.y += 1.0;
    const falloff = aoeFalloff(chest.distanceTo(center), radius);
    if (falloff < 0) return null;

    // Distance-scaled defensive safety: holding guard from your own optimal
    // spacing is safer than eating a blow point-blank inside your guard. Scale
    // the incoming damage by where the attacker sits in the PLAYER's defensive
    // OWR — only while actually blocking (a raw hit takes the full blow).
    let safetyMul = 1;
    if (this.blocking) {
      const scale = CHARACTER_HEIGHT_M / 1.8;
      const defOWR = weaponOWR(weaponCombat(this.weaponId), getWeapon(this.weaponId).group, scale);
      const planar = Math.hypot(chest.x - from.x, chest.z - from.z);
      if (planar < defOWR.optimalMin) safetyMul = 1.2; // crowded — guard is worse
      else if (planar <= defOWR.optimalMax) safetyMul = 0.8; // ideal spacing — safest
      else safetyMul = 0.9; // at reach — still fairly safe
    }

    // Tank/Centurion armour: a flat incoming-damage cut (tankier), plus an extra
    // mitigation step while actively guarding (a sturdier shield). Pure data on
    // the character def — the player's max HP itself stays owned by SparringCombat.
    const cdef = getCharacter(this.characterId);
    let charMul = 1;
    if (cdef.tank) {
      charMul = cdef.tank.damageTakenMul;
      if (this.blocking) charMul *= cdef.tank.blockDamageMul;
    }

    const payload: AttackPayload = {
      force: isSkill ? 2 : 1,
      damage: damage * falloff * safetyMul * charMul,
      poiseDamage: Math.round(damage * falloff * safetyMul * charMul * 0.6),
    };
    // Stash the attacker origin so the defender's guarded-hit react can be
    // directional (chest is the player's own position — useless for side math).
    this.lastStrikeFrom = from.clone();
    const result = this.sparring.resolvePlayerDefense(payload, chest);

    // Respect timer: a successful defense (block / parry / dodge) opens a brief
    // defender-advantage window — the player's next swing lands as a counter.
    if (isDefended(result.outcome)) this.respectWindow = 0.4;

    // Physics recoil scaled by the resolved outcome (0 on a clean parry/dodge).
    const push = chest.clone().sub(from);
    push.y = 0;
    if (push.lengthSq() < 1e-4) push.set(0, 0, 1);
    push.normalize();
    const recoil = outcomeForceScale(result.outcome) * force;
    // Block forcefield + bounce-back: a BIG hit or combo finisher (isSkill, or a
    // heavy physical blow) soaked on a RAISED guard clashes against a hex
    // force-field that pops up around the blocker and shoves them apart with a
    // long, LOW-friction slide. `push` (chest − attacker) is the separation
    // normal — the vector "raycast" from the attack line into the guard sphere —
    // so the blocker slides straight back off the shield instead of soaking it
    // in place. Normal-weight hits keep the original short recoil.
    const bigBlocked = this.blocking && isDefended(result.outcome) && (isSkill || force >= 8);
    if (bigBlocked) {
      // The shield-flash VFX is fired from playPlayerDefenseReaction (synced to
      // the block SFX) so a guarded hit shows exactly one shield; here we keep
      // only the bounce-back impulse — the blocker slides off the guard.
      this.controller?.applyImpulse(push, Math.max(recoil, 7) * 0.7, 0.6, 2.5);
    } else if (recoil > 0) {
      this.controller?.applyImpulse(push, recoil * 0.5, recoil > 8 ? 1.5 : 0);
    }

    if (!isDefended(result.outcome)) {
      this.hurt = 0.5;
      // Taking a blow drives the combat-music bed hardest — the fight is on.
      this.bumpMusicHeat(0.5);
      this.vfx.impact(chest, SKILL_COLOR[kind] ?? 0xff5a6a, 1.2);
      // Heavy opponent hits read on the player the way they do on the dummies:
      // a skill/AOE launches (uppercut), a heavy physical blow staggers (big-blow).
      if (isSkill) this.playPlayerReaction("launched");
      else if (recoil > 8) this.playPlayerReaction("bigBlow");
    } else {
      // A blocked/parried/dodged blow still means an active exchange.
      this.bumpMusicHeat(0.3);
    }
    // In pvp, death is server-authoritative (driven by snapshots / death events);
    // don't let the local CC's health trigger a defeat.
    if (this.net?.mode !== "pvp" && this.sparring.getPlayerHealth() <= 0) this.defeatPlayer();
    return result;
  }

  private defeatPlayer(auto = true) {
    if (this.defeated) return;
    this.defeated = true;
    this.blocking = false;
    // Death drops any in-flight mace throw (restore the held weapon for respawn).
    this.cancelMaceThrow();
    // Drop any RMB lock stance so a desynced mouse state can't leave the camera
    // glued to an enemy through the defeat/respawn beat.
    this.locked = false;
    this.controller?.setLockTarget(null);
    const p = this.character.root.position.clone();
    p.y += 1.0;
    this.vfx.nova(p, 0xff5a6a);
    this.vfx.shockwave(new THREE.Vector3(p.x, 0.05, p.z), 0xff5a6a, 3.2, 0.7);
    // In pvp the server owns the respawn timer (we restore on its respawn event /
    // authoritative alive flag), so skip the local auto-respawn schedule.
    if (!auto) return;
    // Play the knocked-out reaction on defeat (falls back to fallDown if the rig
    // lacks the clip) so death reads as a real KO, not a frozen pose. Local-only:
    // the reaction schedules its own getUp, which must NOT run for pvp deaths
    // where the server drives respawn (handled above by the auto=false return).
    this.playPlayerReaction("knockedOut");
    // Respawn after a beat: heal, brief i-frames.
    this.schedule(1.4, () => {
      this.health = this.maxHealth;
      this.stamina = this.maxStamina;
      this.invuln = 1.6;
      this.defeated = false;
      this.hurt = 0;
      // Dying in the dungeon ejects the player back to the Danger Room (which
      // restores collision, water band, traversal mode, and the sparring
      // population, and drops the player back into the arena healed).
      if (this.inDungeon) {
        this.exitDungeon();
      }
    });
  }

  /**
   * Play an appropriate reaction clip on the current character with the full
   * required vocabulary:
   *
   *   stumble      — a quick flinch (hurt role; fast fade so it doesn't lock pose)
   *   hitHead      — same flinch but harder (hurt role; slower fade for dramatics)
   *   stunned      — staggered stumble + a short stun hold (hurt × 2, spaced 0.3s)
   *   fallen       — tip-over stumble (hurt with slowest fade; simulates falling)
   *   wallCrash    — perfect-parry receiver: hurt with max blend time (~60-frame
   *                  equivalent at ~0.55 s), then a delayed "get up" hurt 1.5 s later
   *   getUp        — delayed recovery after fall (hurt role, slow fade)
   *   parryReact   — the parrier's stance snap (block role, else hurt fallback)
   */
  /** The player's currently-equipped weapon hold-style group. */
  private playerGroup(): WeaponGroup | undefined {
    return getWeapon(this.weaponId)?.group;
  }

  /**
   * Play a category-resolved reaction CLIP on the player rig. The clip key comes
   * from the hold-style standard ({@link defenseOutcomeClip} / {@link
   * vulnerableReactionClip} / {@link defenseClips}) so player and AI react from
   * ONE source. GLB rigs without `reaction` fall back to the generic hurt role.
   * Returns true when the procedural reaction path was taken.
   */
  private reactWithClip(clip: ActionKey, fade: number, hold = false): boolean {
    const c = this.character;
    if (!c) return false;
    if (c.reaction) {
      c.reaction(clip, fade, hold);
      return true;
    }
    if (c.hasRole("hurt")) c.playRoleOnce("hurt", fade);
    return false;
  }

  /**
   * Player-as-DEFENDER reaction to a resolved {@link DefensiveResult.outcome}.
   * The clip is sourced from the player's hold-style standard, so a knockdown
   * outcome (the category `fall` clip) also schedules a get-up beat.
   */
  /**
   * Pop the hex force-field shield at a guarded exchange, synced 1:1 with the
   * block SFX so a shield shows on exactly the frame the block sound plays.
   * `center` is the guard's chest-height world point; `big` widens + lengthens
   * the flash for heavy / shield-breaking blows.
   */
  private blockShield(center: THREE.Vector3, big = false): void {
    const p = center.clone();
    this.vfx.forceField(() => p, big ? 1.4 : 1.1, big ? 0.5 : 0.38);
  }

  private playPlayerDefenseReaction(outcome: DefensiveResult["outcome"], pos?: THREE.Vector3): void {
    const g = this.playerGroup();
    // A hit soaked on a RAISED guard (blocked / deflected) plays a DIRECTIONAL
    // guarded-hit react keyed off where the blow landed relative to the player's
    // facing — the guard snaps to the struck side, then `holdClip()` blends it
    // back into the held block pose while the block is still held.
    if ((outcome === "blockStop" || outcome === "deflect") && this.blocking) {
      const clip = guardedHitClip(g, this.hitSide(this.lastStrikeFrom ?? pos));
      this.reactWithClip(clip, 0.08);
      this.sfx?.play("block", pos ?? this.character?.root.position ?? new THREE.Vector3(), {
        volume: 0.95,
        rate: outcome === "deflect" ? 1.1 : 1,
      });
      // Shield flash around the PLAYER's guard, synced to the block sound above.
      const center = (this.character?.root.position.clone() ?? pos?.clone() ?? new THREE.Vector3());
      center.y += 1.0;
      this.blockShield(center, outcome === "blockStop");
      return;
    }
    const clip = defenseOutcomeClip(g, outcome);
    const knockdown = clip === defenseClips(g).fall;
    this.reactWithClip(clip, knockdown ? 0.12 : 0.08, knockdown);
    if (knockdown) this.schedule(1.4, () => this.playPlayerReaction("getUp"));
  }

  /**
   * Which side of the player's guard an incoming hit landed on, from the player's
   * facing: a blow off to the left/right plays the directional guard react, a
   * head-on blow plays the frontal one. Defaults to a frontal hit when the
   * position or facing is unavailable.
   */
  private hitSide(pos?: THREE.Vector3): "left" | "right" | "front" {
    if (!pos || !this.character) return "front";
    const fwd = this.controller?.forward();
    if (!fwd) return "front";
    const to = pos.clone().sub(this.character.root.position);
    to.y = 0;
    if (to.lengthSq() < 1e-4) return "front";
    // Player-right basis = (-fwd.z, 0, fwd.x). Positive dot ⇒ hit on the right.
    const dot = to.x * -fwd.z + to.z * fwd.x;
    const lateral = dot / Math.hypot(to.x, to.z);
    if (lateral > 0.35) return "right";
    if (lateral < -0.35) return "left";
    return "front";
  }

  private playPlayerReaction(
    kind:
      | "stumble"
      | "hitHead"
      | "stunned"
      | "fallen"
      | "knockBack"
      | "launched"
      | "bigBlow"
      | "knockedOut"
      | "wallCrash"
      | "getUp"
      | "kipUp"
      | "parryReact",
  ) {
    const c = this.character;
    if (!c) return;
    // Procedural rig (Danger Room): play the REAL reaction clip with a per-kind
    // crossfade so each reads distinctly. GLB rigs lack `reaction` and fall back
    // to the generic hurt role (and, where available, a named clip).
    const react = (key: string, fade: number, hold = false): boolean => {
      if (c.reaction) {
        c.reaction(key, fade, hold);
        return true;
      }
      if (c.hasRole("hurt")) c.playRoleOnce("hurt", fade);
      return false;
    };
    switch (kind) {
      case "stumble":
        react("stumble", 0.07);
        break;
      case "hitHead":
        react("hitHead", 0.12);
        break;
      case "stunned":
        react("stunned", 0.1);
        break;
      case "fallen":
        // Tip over, then push up off the ground.
        react("fallDown", 0.12);
        this.schedule(1.4, () => this.playPlayerReaction("getUp"));
        break;
      case "knockBack":
        // Shoved hard onto the back: the dedicated flying-back knock, hold the
        // grounded pose, then kip up. (Falls back to fallDown on rigs lacking it.)
        if (!react("flyingBack", 0.1)) react("fallDown", 0.12);
        this.schedule(0.95, () => this.character?.reaction?.("fallen", 0.15, true));
        this.schedule(1.5, () => this.playPlayerReaction("kipUp"));
        break;
      case "launched":
        // Popped into the air by an uppercut: launch pop, settle, acrobatic kip-up.
        if (!react("uppercutLaunch", 0.08)) react("fallDown", 0.08);
        this.schedule(1.0, () => this.character?.reaction?.("fallen", 0.15, true));
        this.schedule(1.55, () => this.playPlayerReaction("kipUp"));
        break;
      case "bigBlow":
        // Heavy body blow that staggers but keeps the fighter on their feet.
        if (!react("bigBlow", 0.1)) react("stumble", 0.08);
        break;
      case "knockedOut":
        // Full collapse: knock-out drop, hold the grounded pose, then a slow get-up.
        if (!react("knockedOut", 0.12, true)) react("fallDown", 0.12);
        this.schedule(2.0, () => this.playPlayerReaction("getUp"));
        break;
      case "wallCrash": {
        if (c.reaction) {
          c.reaction("wallCrash", 0.4);
        } else {
          // GLB fallback: try a named clip ("wall_crash" / "Wall Crash"), else hurt.
          const hasWallCrash = c.hasClip("wall_crash") || c.hasClip("Wall Crash");
          if (hasWallCrash) c.playClipOnce(c.hasClip("wall_crash") ? "wall_crash" : "Wall Crash", 0.55);
          else if (c.hasRole("hurt")) c.playRoleOnce("hurt", 0.55);
        }
        this.schedule(1.8, () => this.playPlayerReaction("getUp"));
        break;
      }
      case "getUp":
        if (c.reaction) {
          c.reaction("getUp", 0.2);
        } else {
          const hasGetUp = c.hasClip("get_up") || c.hasClip("Get Up");
          if (hasGetUp) c.playClipOnce(c.hasClip("get_up") ? "get_up" : "Get Up", 0.22);
          else if (c.hasRole("hurt")) c.playRoleOnce("hurt", 0.18);
        }
        break;
      case "kipUp":
        react("kipUp", 0.18);
        break;
      case "parryReact":
        if (c.reaction) c.reaction("parryReact", 0.1);
        else if (c.hasRole("block")) c.playRoleOnce("block", 0.1);
        else if (c.hasRole("hurt")) c.playRoleOnce("hurt", 0.12);
        break;
    }
  }

  /**
   * Apply the player's offense-fail recovery after a swing was blocked, parried
   * or dodged: lock out offense for `lock` seconds (the lost-tempo beat that
   * hands the defender a window) and shove the body along/against the swing line
   * for a subtle physical read. Positive `lunge` over-commits FORWARD (whiffed
   * into empty air); negative recoils BACKWARD (rang off a guard). The reaction
   * clip is played by the caller so each outcome reads distinctly.
   */
  private recoverFromFail(lock: number, lunge: number, hitPos: THREE.Vector3) {
    this.recoverLock = Math.max(this.recoverLock, lock);
    // Break the combo chain so the next press starts a fresh stage-0 swing.
    this.comboTimer = 0;
    this.fireComboTimer = 0;
    this.fireComboIndex = 0;
    this.comboLock = Math.max(this.comboLock, lock);
    if (lunge !== 0 && this.controller && this.character) {
      // Recoil along the actual attack line: player → defender at impact. This is
      // correct for every offense path (combo/stab/motion/heavy/skill) without
      // tracking a per-path swing vector.
      const dir = hitPos.clone().sub(this.character.root.position);
      dir.y = 0;
      if (dir.lengthSq() < 1e-4) dir.copy(this.facing());
      dir.normalize();
      if (lunge < 0) dir.negate();
      this.controller.applyImpulse(dir, Math.abs(lunge), 0);
    }
  }

  /** Show a brief center-screen combat flash label. */
  private setCombatFlash(text: string, duration = 1.4) {
    this.combatFlash = text;
    this.combatFlashTimer = duration;
  }

  /**
   * Unified blast helper: routes the player's skill damage through the focused
   * enemy's CombatController (parry/block/dodge + damage applied internally) with
   * lighter AoE splash to others in range. Returns the focused {@link
   * DefensiveResult} (or null when nothing was in reach — then it fell back to a
   * plain blast) so callers can add extra VFX.
   */
  private sparringBlast(
    center: THREE.Vector3,
    radius: number,
    damage: number,
    force: number,
    poiseDamageRatio = 0.65,
  ): DefensiveResult | null {
    const payload: AttackPayload = {
      force: force >= this.params.skillForce ? 2 : 1,
      damage,
      poiseDamage: Math.round(damage * poiseDamageRatio),
    };
    // A skill/AoE blast is a heavy offensive beat — swell the combat music.
    this.bumpMusicHeat(0.4);
    return this.targets.playerHit(center, radius, payload, force, this.sparCtx);
  }

  /**
   * Player's heavy "R" shield-break skill when a target is nearby.
   * Routes through the sparring model (force-3 + shieldBreak:true) so a
   * blocking dummy gets stunned, opening a 2-second guaranteed crit window.
   */
  private doHeavyAttack() {
    if (!this.character || !this.controller) return;
    // The pistol Kiter's heavy is a tactical retreat + turret drop, not a slam.
    if (getCharacter(this.characterId).kiter && this.weaponId === "pistol") {
      this.doKiterRetreat();
      return;
    }
    if (this.skyfallCooldown > 0 || this.recoverLock > 0) return;
    // From the air, the heavy ALWAYS becomes a targeted crash-down slam.
    if (!this.controller.state.grounded) {
      this.groundSlam();
      return;
    }

    const origin = this.character.root.position.clone();
    const aim = this.controller.forward();
    const cfg = this.assistConfig();
    const picked = this.pickTargetInFront(origin, aim, cfg.acqRange, cfg.minDot);
    if (!picked) {
      // No close target — fall through to skyfall.
      this.skyfall();
      return;
    }

    const dir = this.steerToward(aim, origin, picked, cfg.steer);
    this.controller.faceToward(dir, 0.22);
    if (this.character.hasRole("attack")) this.character.playRoleOnce("attack", 0.1);

    const reach = THREE.MathUtils.clamp(picked.dist - 0.9, 0.4, cfg.maxReach);
    const color = 0xff8040;
    const endpoint = origin.clone().addScaledVector(dir, reach);
    this.vfx.dashStreak(origin, endpoint, color);
    this.controller.dash(dir, reach, 0.24, reach * 0.3, 0.5);

    this.abilities.cast(kitAbility("heavyAttack", "slam", color, 0.12), {
      onImpact: () => {
        if (!this.character) return;
        const hitPos = this.character.root.position.clone().addScaledVector(dir, reach * 0.7);
        hitPos.y += 1.0;
        // Heavy shield-break (force-3 + shieldBreak) resolved through the focused
        // enemy's CC: a blocking enemy gets stunned, opening a crit window.
        const result = this.targets.playerHit(
          picked.position,
          2.5,
          PLAYER_HEAVY_PAYLOAD,
          this.params.skillForce * 0.9,
          this.sparCtx,
        );
        if (result && result.outcome === "blockStop" && result.defenderReaction === "stunned") {
          this.vfx.aoeBlast(hitPos, 0xff4400, 2.5);
          this.vfx.burst(hitPos, 0xff7030, 50, 7);
          this.vfx.shockwave(new THREE.Vector3(hitPos.x, 0.05, hitPos.z), 0xff5500, 2.0, 0.45);
        } else if (!result || result.outcome === "hit" || result.outcome === "crit") {
          this.vfx.aoeBlast(hitPos, color, 2.2);
          this.vfx.burst(hitPos, 0xff9050, 36, 6);
        } else {
          this.vfx.burst(hitPos, 0x88aaff, 20, 3.5);
        }
      },
    });

    this.skyfallCooldown = 2.0;
    this.stamina = Math.max(0, this.stamina - 18);
  }

  /**
   * The pistol Kiter's "R": optimal evasive movement directly away from the
   * closest enemy (keeping the gun trained on them) with a brief i-frame slip,
   * and a turret left behind to cover the ground just vacated.
   */
  private doKiterRetreat() {
    if (!this.character || !this.controller) return;
    if (this.skyfallCooldown > 0 || this.recoverLock > 0) return;
    const playerPos = this.character.root.position.clone();
    const enemy = this.targets.nearest(playerPos, 1).find((h) => h.alive);
    const away = new THREE.Vector3();
    if (enemy) {
      away.copy(playerPos).sub(enemy.position).setY(0);
      if (away.lengthSq() < 1e-4) away.copy(this.facing()).negate().setY(0);
      away.normalize();
      const toEnemy = enemy.position.clone().sub(playerPos).setY(0);
      if (toEnemy.lengthSq() > 1e-4) this.controller.faceToward(toEnemy.normalize(), 0.3);
    } else {
      away.copy(this.facing()).negate().setY(0).normalize();
    }
    // Leave the turret where we stand BEFORE sliding away, so it screens the
    // retreat, then slip back with a short i-frame window.
    this.deployTurret(playerPos);
    this.controller.dash(away, 4.0, 0.3, 0, 0.6);
    this.invuln = Math.max(this.invuln, 0.3);
    if (this.character.hasClip("airDodge")) this.character.playClipOnce("airDodge", 0.1);
    this.skyfallCooldown = 6.0;
    this.stamina = Math.max(0, this.stamina - 20);
  }

  /**
   * Deploy a stationary turret at `at`. It stands for a few seconds and, each
   * volley gap, fires a burst of slow, oversized bolts at the closest living
   * enemy (see {@link TURRET_LIFE} et al). Used by the Archmage's F-skill and
   * the Kiter's retreat.
   */
  private deployTurret(at: THREE.Vector3, faceDir?: THREE.Vector3) {
    if (!this.character) return;
    const base = at.clone();
    base.y = 0;
    const facing = faceDir ?? this.facing();
    const muzzle = base.clone();
    muzzle.y += 1.1;
    // A turret is a deployed entity, not a one-shot cast: route it through the
    // ability lifecycle's deploy phase so it shares the same timing + cancelAll
    // teardown as every other ability. `deployAbility` derives the volley count
    // from the lifetime exactly as the old inline `floor((life - 0.4)/gap)` did,
    // and `abilities.update` runs with the same `dt` adjacent to `updatePending`,
    // so each volley fires on the same frame the legacy `schedule` would have.
    // onDeploy spawns the (self-timed) VFX turret; each onTick re-acquires the
    // nearest enemy and fires a volley. The 0.4s `tail` reproduces the original's
    // end dead-time; the entity has no extra teardown so onExpire is omitted.
    this.abilities.cast(
      deployAbility("turret", "turret", TURRET_COLOR, {
        life: TURRET_LIFE,
        firstTick: 0.5,
        interval: TURRET_VOLLEY_GAP,
        tail: 0.4,
      }),
      {
        onDeploy: () => this.vfx.spawnTurret(base, facing, TURRET_COLOR, TURRET_LIFE),
        onTick: () => this.fireTurretVolley(muzzle),
      },
    );
  }

  /** Fire one turret volley of slow, oversized, dodgeable bolts at its nearest enemy. */
  private fireTurretVolley(muzzle: THREE.Vector3) {
    if (this.disposed) return;
    const enemy = this.targets.nearest(muzzle, 1).find((h) => h.alive);
    if (!enemy) return;
    for (let i = 0; i < TURRET_VOLLEY; i++) {
      this.schedule(i * 0.16, () => {
        if (this.disposed) return;
        // Re-acquire if the captured target died mid-volley so shots aren't wasted.
        const e = enemy.alive ? enemy : this.targets.nearest(muzzle, 1).find((h) => h.alive);
        if (!e) return;
        const aim = e.position.clone();
        aim.y += 0.9;
        const dir = aim.clone().sub(muzzle);
        const dist = dir.length();
        if (dist < 1e-3) return;
        dir.multiplyScalar(1 / dist);
        this.vfx.muzzle(muzzle.clone(), dir, TURRET_COLOR);
        this.vfx.bolt(
          muzzle.clone(),
          dir,
          TURRET_COLOR,
          TURRET_BOLT_SPEED,
          dist + 0.5,
          (p) => {
            // The bolt object is the damage producer: it deals collision damage
            // where it lands, so a target that has moved off the firing line
            // takes nothing (dodgeable).
            this.vfx.aoeBlast(p, TURRET_COLOR, 1.0);
            this.targets.blast(p, 1.0, TURRET_SHOT_DAMAGE, this.params.skillForce * 0.4);
          },
          TURRET_BOLT_SCALE,
        );
      });
    }
  }

  /**
   * Deploy a stationary snare field at `at`. It stands for a few seconds and, each
   * pulse, re-snares every living enemy inside it (a movement slow + modest chip
   * damage) — a persistent zone-control gadget, the support counterpart to the
   * turret. Like the turret it is a deployed entity (not a one-shot cast), so it
   * runs through the ability lifecycle's deploy phase: it shares the same timing +
   * `cancelAll` teardown, and `abilities.update` runs with the same `dt` adjacent
   * to `updatePending` so each pulse fires on the frame the schedule reaches. The
   * deploy schedule (life / first pulse / gap / tail) is seeded + tested in the
   * pure ability registry. onDeploy marks the zone, each onTick re-acquires every
   * enemy in range and snares them, onExpire fades the marker. Used by the LED
   * Monk's F-skill.
   */
  private deploySnareField(at: THREE.Vector3) {
    if (!this.character) return;
    const base = at.clone();
    base.y = 0;
    const def =
      getAbility("deploy:snareField") ??
      deployAbility("snareField", "nova", 0x86e3a0, { life: 6.0, firstTick: 0.4, interval: 0.8, tail: 0.4 });
    this.abilities.cast(def, {
      onDeploy: () => this.spawnSnareFieldVfx(base, def.color),
      onTick: () => this.pulseSnareField(base, def.color),
      onExpire: () => {
        if (this.disposed) return;
        this.vfx.shockwave(new THREE.Vector3(base.x, 0.05, base.z), def.color, SNARE_FIELD_RADIUS, 0.5);
      },
    });
  }

  /** Mark a freshly deployed snare field with a settling ground ring + aura. */
  private spawnSnareFieldVfx(base: THREE.Vector3, color: number) {
    if (this.disposed) return;
    this.vfx.auraRing(base.clone().setY(0.06), color, SNARE_FIELD_RADIUS, 1.0);
    this.vfx.shockwave(new THREE.Vector3(base.x, 0.06, base.z), color, SNARE_FIELD_RADIUS, 0.6);
  }

  /** One snare pulse: slow + chip every living enemy currently inside the field. */
  private pulseSnareField(base: THREE.Vector3, color: number) {
    if (this.disposed) return;
    // Re-acquire + re-snare every pulse: an enemy that just stepped in is caught,
    // and one that left is released when its (slightly-longer-than-a-pulse) slow
    // times out, so the field keeps exactly whoever is standing in it snared.
    this.targets.slowArea(base, SNARE_FIELD_RADIUS, SNARE_FIELD_SLOW_MUL, SNARE_FIELD_SLOW_SECONDS);
    this.targets.blast(base, SNARE_FIELD_RADIUS, SNARE_FIELD_CHIP_DAMAGE, this.params.skillForce * 0.15);
    // Telegraph the pulse: a quick ground ring + a few rising motes.
    this.vfx.shockwave(new THREE.Vector3(base.x, 0.06, base.z), color, SNARE_FIELD_RADIUS * 0.9, 0.4);
    this.vfx.burst(base.clone().setY(0.3), color, 14, SNARE_FIELD_RADIUS);
  }

  // ---- Bear trap (owner-only mesh, 2 m stun trigger) ----

  /** Lazy-load the shared bear-trap GLB template (cloned per deploy). */
  private loadBearTrapTemplate(): Promise<THREE.Object3D | null> {
    if (this.bearTrapTemplate) return Promise.resolve(this.bearTrapTemplate);
    if (this.bearTrapTemplatePromise) return this.bearTrapTemplatePromise;
    this.bearTrapTemplatePromise = (async () => {
      try {
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(assetUrl(BEAR_TRAP_MODEL));
        const root = gltf.scene;
        // Normalize: ~1 m across, jaws on the ground.
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxXZ = Math.max(size.x, size.z, 1e-3);
        const s = 1.05 / maxXZ;
        root.scale.multiplyScalar(s);
        root.updateMatrixWorld(true);
        const box2 = new THREE.Box3().setFromObject(root);
        root.position.y -= box2.min.y;
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
            m.frustumCulled = false;
          }
        });
        this.bearTrapTemplate = root;
        return root;
      } catch (err) {
        console.warn("[Studio] bear trap model failed to load", err);
        return null;
      }
    })();
    return this.bearTrapTemplatePromise;
  }

  /**
   * Deploy a bear trap at `at`. Mesh is visible ONLY to the owner (local player).
   * Armed after a short settle; any enemy entering the 2 m horizontal cylinder
   * is stunned and the trap one-shots (removed). Untriggered traps expire after
   * {@link BEAR_TRAP_LIFE_SEC}. Used by Explorer F-skill (`gadget: bearTrap`).
   */
  private deployBearTrap(at: THREE.Vector3, ownerId: string = LOCAL_PLAYER_ID) {
    if (!this.character || this.disposed) return;
    const base = at.clone();
    base.y = 0;
    const root = new THREE.Group();
    root.name = "BearTrap";
    root.position.copy(base);
    // Owner-only visibility: enemies / other players never see the mesh.
    root.visible = canSeeBearTrap(ownerId, LOCAL_PLAYER_ID);
    this.scene.add(root);

    // Placeholder ring while the GLB loads (owner-only, same visibility).
    const placeGeo = new THREE.RingGeometry(0.25, 0.45, 24);
    const placeMat = new THREE.MeshBasicMaterial({
      color: 0xc4a574,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const place = new THREE.Mesh(placeGeo, placeMat);
    place.rotation.x = -Math.PI / 2;
    place.position.y = 0.02;
    root.add(place);

    const trap = {
      id: ++this.bearTrapSeq,
      ownerId,
      pos: base.clone(),
      root,
      armed: false,
      life: BEAR_TRAP_LIFE_SEC,
    };
    this.bearTraps.push(trap);

    // Arm after a brief settle so the caster doesn't instantly trip their own trap.
    this.schedule(0.45, () => {
      if (this.disposed) return;
      const live = this.bearTraps.find((t) => t.id === trap.id);
      if (live) live.armed = true;
    });

    void this.loadBearTrapTemplate().then((tpl) => {
      if (this.disposed || !tpl) return;
      const live = this.bearTraps.find((t) => t.id === trap.id);
      if (!live) return;
      place.removeFromParent();
      placeGeo.dispose();
      placeMat.dispose();
      const clone = tpl.clone(true);
      live.root.add(clone);
    });

    // Soft owner-only deploy cue (shockwave only the owner sees alongside mesh).
    if (canSeeBearTrap(ownerId, LOCAL_PLAYER_ID)) {
      this.vfx.shockwave(new THREE.Vector3(base.x, 0.04, base.z), 0xc4a574, 0.9, 0.35);
    }

    // Lifecycle: poll proximity via deploy ticks; cleanup on expire.
    const def =
      getAbility("deploy:bearTrap") ??
      deployAbility("bearTrap", "nova", 0xc4a574, {
        life: BEAR_TRAP_LIFE_SEC,
        firstTick: 0.05,
        interval: 0.08,
        tail: 0.2,
      });
    this.abilities.cast(def, {
      onTick: () => this.pollBearTrap(trap.id),
      onExpire: () => this.removeBearTrap(trap.id, false),
    });
  }

  /** Proximity poll: if any living enemy is in the 2 m zone, stun and snap shut. */
  private pollBearTrap(id: number) {
    if (this.disposed) return;
    const trap = this.bearTraps.find((t) => t.id === id);
    if (!trap || !trap.armed) return;
    const enemies = this.targets.nearest(trap.pos, 32);
    let tripped = false;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (enemyInBearTrapZone(trap.pos.x, trap.pos.z, e.position.x, e.position.z, BEAR_TRAP_RADIUS_M)) {
        tripped = true;
        break;
      }
    }
    if (!tripped) return;
    // Stun every enemy inside the 2 m AOE; play a short ground snap VFX.
    const hits = this.targets.stun(trap.pos, BEAR_TRAP_RADIUS_M, BEAR_TRAP_STUN_SEC);
    this.targets.reactAt(trap.pos, "stunned");
    this.vfx.shockwave(new THREE.Vector3(trap.pos.x, 0.05, trap.pos.z), 0xff7050, BEAR_TRAP_RADIUS_M * 0.85, 0.45);
    this.vfx.burst(trap.pos.clone().setY(0.35), 0xffa070, 18, 1.2);
    if (hits > 0) {
      // Small chip so the snap reads as a hit, not only CC.
      this.targets.blast(trap.pos, BEAR_TRAP_RADIUS_M * 0.6, 6, this.params.skillForce * 0.2);
    }
    this.removeBearTrap(id, true);
  }

  /** Remove a trap mesh; `snapped` chooses a hard pop vs quiet despawn. */
  private removeBearTrap(id: number, snapped: boolean) {
    const idx = this.bearTraps.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const [trap] = this.bearTraps.splice(idx, 1);
    trap.armed = false;
    // Clones share the template's geometry/materials — only detach from the
    // scene; never dispose shared GPU resources.
    if (snapped && canSeeBearTrap(trap.ownerId, LOCAL_PLAYER_ID)) {
      // Brief scale-down so the jaws "close" before removal.
      const start = performance.now();
      const root = trap.root;
      const tick = () => {
        if (this.disposed) {
          root.removeFromParent();
          return;
        }
        const u = Math.min(1, (performance.now() - start) / 180);
        root.scale.setScalar(1 - u * 0.85);
        if (u < 1) requestAnimationFrame(tick);
        else root.removeFromParent();
      };
      requestAnimationFrame(tick);
    } else {
      trap.root.removeFromParent();
    }
  }

  /** Drop every live bear trap (scene reset / dispose). */
  private clearBearTraps() {
    for (const t of [...this.bearTraps]) this.removeBearTrap(t.id, false);
    this.bearTraps.length = 0;
  }

  /**
   * Aerial crash-down. From the air, lunge toward the soft-locked enemy then drop
   * hard; the on-land hook (consumeSlamLanded) detonates a ground explosion that
   * knocks nearby enemies UP and OUT. Returns false if a slam is already pending
   * so callers can fall through to the normal grounded attack.
   */
  private groundSlam(): boolean {
    if (!this.character || !this.controller) return false;
    // Mutually exclusive with the aerial dagger overhead so two airborne attacks
    // can never both resolve from one jump.
    if (this.slamPending || this.aerialSlashPending) return false;
    this.slamPending = true;
    this.slamPendingTimer = 1.5;
    const origin = this.character.root.position.clone();
    const aim = this.controller.forward();
    const cfg = this.assistConfig();
    const picked = this.pickTargetInFront(origin, aim, cfg.acqRange, cfg.minDot);
    const dir = this.steerToward(aim, origin, picked, cfg.steer);
    if (picked && picked.dist > 1.0) {
      const close = THREE.MathUtils.clamp(picked.dist - 1.0, 0, this.params.dashDistance * 1.5);
      if (close > 0.2) this.controller.dash(dir, close, 0.18, 0, 0.6);
    }
    this.controller.faceToward(dir, 0.3);
    if (this.character.hasRole("attack")) this.character.playRoleOnce("attack", 0.08);
    this.controller.slamDown(28);
    return true;
  }

  /**
   * Ground explosion fired the instant a slam touches down: layered shockwaves +
   * spark burst + themed explosion, plus a force wave that deals heavy radial
   * damage (blast-back) and pops every nearby enemy upward (knock-up).
   */
  private doSlamImpact() {
    if (!this.character) return;
    const chi = this.fireThemeApplied === "chi";
    const color = chi ? 0x7fd0ff : 0xffb24d;
    const p = this.character.root.position.clone();
    const ground = new THREE.Vector3(p.x, 0.05, p.z);
    const radius = 4.2;
    this.vfx.aoeBlast(p.clone().add(new THREE.Vector3(0, 0.4, 0)), color, radius);
    this.vfx.shockwave(ground, color, radius * 1.4, 0.7);
    this.vfx.shockwave(ground, 0xffffff, radius * 0.7, 0.4);
    this.vfx.burst(p.clone().add(new THREE.Vector3(0, 0.3, 0)), color, 60, radius * 2);
    this.vfx.impactExplode(p, this.fireThemeApplied);
    // Force wave: heavy radial damage + knock-up across the blast radius.
    this.sparringBlast(p, radius, 30, this.params.skillForce * 1.6);
    this.targets.launch(p, radius, 0, 9);
    this.hitBags(p, radius, this.params.skillForce * 1.6, 30);
    this.netStrike(p, radius, 30);
  }

  /** Trigger the equipped weapon's signature skill (or a character signature). */
  useSkill(signatureIndex?: number) {
    if (!this.character) return false;
    if (this.spectating) return false;
    // Piloting the exo-armour: the skill bar fires the mech's bespoke kit
    // (Stomp on F, Plasma Cannon on 1, Grapple Throw on 2) instead of the pilot's.
    if (this.mech.isPiloted) {
      return this.doMechSkill(signatureIndex);
    }
    // Skills are offense too — a blocked/parried/dodged swing taxes them as well,
    // so the defender's counter window can't be skill-cancelled out of.
    if (this.recoverLock > 0) return false;
    const def = getCharacter(this.characterId);
    const isSig = signatureIndex != null;

    // Striker (pure martial artist): each sig has its own independent cooldown —
    // bypass the shared skillCooldown gate entirely so a lingering cooldown from
    // a previous character never blocks Striker skills.
    if (def.meleeStyle === "kick") {
      return this.doKickSig(isSig ? signatureIndex! : 0);
    }

    // Pistol "Kiter" (Gunslinger): three bespoke signature skills on slots 2-4
    // plus a simple fan-fire on slot 1, each with its own independent cooldown —
    // bypass the shared skillCooldown gate like the kick fighter does.
    if (def.kiter && this.weaponId === "pistol" && isSig) {
      return this.doPistolSig(signatureIndex!, def.kiter);
    }

    // Arcane Staff "Soulbinder": four bespoke soul/void signature skills, each
    // with its own independent cooldown — bypass the shared skillCooldown gate
    // like the kick + kiter kits do.
    if (def.arcane && this.weaponId === "staff" && isSig) {
      return this.doArcaneSig(signatureIndex!, def.arcane);
    }

    // Gunblade "Tank" (Centurion): four bespoke shield/cannon signature skills,
    // each with its own independent cooldown — bypass the shared skillCooldown
    // gate like the kick / kiter / arcane kits do.
    if (def.tank && this.weaponId === "gunblade" && isSig) {
      return this.doTankSig(signatureIndex!, def.tank);
    }

    // Flanged Mace signature (slot 4): throw → stun → recall, or a dash-recall
    // gap-closer on a re-press while the mace is out. Mace-only; other weapons'
    // slot 4 is unchanged. Bypasses the shared skillCooldown gate — it uses its
    // own per-slot cooldown like the bespoke kits.
    if (this.weaponId === "mace" && isSig && signatureIndex === 3) {
      return this.doMaceThrow();
    }

    // Arcane Staff "Soulbinder": the F key (no signature slot) channels a chained
    // "Hot Hands" fire spell-combo with its own combo lock — bypass the shared
    // skillCooldown gate like the sig kits do.
    if (def.arcane && this.weaponId === "staff" && !isSig) {
      return this.doFireCombo();
    }

    // Skillwrite presets on weapon skillKit (staffs): arm target / ground AOE
    // cast mode, or fire instant presets immediately.
    {
      const w = getWeapon(this.weaponId);
      const entry = isSig ? w.skillKit?.signatures[signatureIndex!] : w.skillKit?.ability;
      if (entry?.preset) {
        // Frost blink re-press must ignore skillCd while the 2s window is open.
        const frostBlinkReady =
          this.frostBlinkWindow > 0 &&
          this.weaponId === "staffIce" &&
          (entry.preset.id === "frost_aoe_blink" || entry.preset.vfx === "frostAoe");
        if (this.skillCooldown > 0 && !frostBlinkReady) return false;
        return this.armOrCastPreset(entry.preset);
      }
      if (entry && entry.kind === "fireDragon" && w.element === "fire") {
        return this.doElementalCast("fire");
      }
    }

    // Staff scatter/nova only when the weapon has NO skillKit (storm/holy).
    if (
      this.isStaffEquipped() &&
      !(def.arcane && this.weaponId === "staff") &&
      !getWeapon(this.weaponId).skillKit
    ) {
      if (isSig && signatureIndex === 1) return this.doStaffScatter();
      if (isSig && signatureIndex === 2) return this.doStaffNova();
    }

    // Elemental staffs without a skillKit (storm / holy): themed homing bolt.
    {
      const w = getWeapon(this.weaponId);
      if (w.element && !w.skillKit) return this.doElementalCast(w.element);
    }

    if (this.skillCooldown > 0) return false;
    const slot: ActionSlot = isSig ? (`sig${signatureIndex! + 1}` as ActionSlot) : "fskill";
    const override = this.overrides[slot];

    const fwd = this.facing();
    const origin = this.character.root.position.clone();
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.character.root.rotation.y, 0));

    // Signature slot (1-4): play its clip (override or character default) + VFX.
    // Weapon skillKit (exemplar: mace2h) supplies labels/kinds when present —
    // other weapons keep character signatureSkills only (no behaviour change).
    if (isSig) {
      const kitSkill = getWeapon(this.weaponId).skillKit?.signatures[signatureIndex!];
      const sig = def.signatureSkills[signatureIndex!];
      const clip = override ?? sig?.clip ?? kitSkill?.clip;
      // Nothing assigned to this slot and no kit/native signature — no-op.
      if (!clip && !sig && !kitSkill) return false;
      let dur = 0;
      if (clip && this.character.hasClip(clip)) {
        dur = this.character.playClipOnce(clip, 0.12);
      } else if (this.character.hasRole("attack")) {
        // Kit may name Explorer verbs (skill/dashAttack) the GLB lacks — still VFX.
        dur = this.character.playRoleOnce("attack", 0.12);
      }
      const kind = kitSkill?.kind ?? sig?.kind ?? "slash";
      const dashMode = kitSkill?.mode === "dash" || sig?.mode === "dash";
      if (dashMode) {
        this.doDashSkill(kind, origin, fwd, dur);
      } else {
        // Aimed spells: home onto a locked/front target so the projectile arcs
        // toward the enemy instead of firing straight ahead.
        const aimed =
          kind === "fireDragon" ||
          kind === "meteor" ||
          kind === "darkBlades" ||
          kind === "swordVolley" ||
          kind === "soul" ||
          kind === "laser";
        const picked = aimed ? this.pickTargetInFront(origin, fwd, 22, -0.2) : null;
        const pose = this.colliderPose() ?? undefined;
        if (aimed) {
          // Data-driven path: every aimed signature spell runs through the
          // orchestrator. The projectile arc + blast are owned entirely by the
          // Vfx subsystem, so the cast is instant (duration 0) and `playSkill`
          // fires synchronously inside `cast()` — identical to the pre-refactor
          // inline call, but routed through the shared lifecycle so character
          // swap / dispose `cancelAll()` covers stale closures. fireDragon +
          // dark-blades carry a descriptive travel motion (projectile archetypes).
          const def2: AbilityDef =
            kind === "fireDragon"
              ? getAbility("fireDragonSig") ?? vfxSkill(kind, SKILL_COLOR[kind], { target: "aimed", travel: "dragon", maxFlight: 3 })
              : vfxSkill(kind, SKILL_COLOR[kind], {
                  target: "aimed",
                  ...(kind === "darkBlades" ? { travel: "darkBlades" as const, maxFlight: 3 } : {}),
                });
          this.abilities.cast(def2, {
            onCast: () => this.vfx.playSkill(kind, origin, fwd, quat, picked?.position, undefined, pose),
          });
        } else {
          this.vfx.playSkill(kind, origin, fwd, quat, picked?.position, undefined, pose);
        }
      }
      this.skillCooldownMax = Math.max(dur, 1.4);
      this.skillCooldown = this.skillCooldownMax;
      this.stamina = Math.max(0, this.stamina - 20);
      return true;
    }

    // Deployable-gadget F-skill: a character can bind a persistent autonomous
    // entity (snare field, etc.) to the F key — dropped at the caster's feet
    // instead of the weapon swing, unless a slot override wins. Like the turret
    // it is a real deployed entity, routed through the ability lifecycle's deploy
    // phase rather than the cosmetic-only Vfx path.
    if (def.gadget && !override) {
      if (this.character.hasRole("attack")) this.character.playRoleOnce("attack", 0.1);
      // Aim gadget where the casting hand POINTS (ground-projected) when the rig
      // is collider-bound, else flat body facing — matching the turret deploy —
      // and stand it a fixed distance ahead so it never drops on top of the caster.
      const pose = this.colliderPose();
      const ground = (pose ? pose.aim : fwd).clone().setY(0);
      if (ground.lengthSq() < 1e-4) ground.set(0, 0, 1);
      ground.normalize();
      const baseAt = origin.clone().addScaledVector(ground, 2.2);
      if (def.gadget === "snareField") {
        this.deploySnareField(baseAt);
        this.skillCooldownMax = SNARE_FIELD_COOLDOWN;
      } else if (def.gadget === "bearTrap") {
        this.deployBearTrap(baseAt, LOCAL_PLAYER_ID);
        this.skillCooldownMax = BEAR_TRAP_COOLDOWN;
      } else {
        this.skillCooldownMax = SNARE_FIELD_COOLDOWN;
      }
      this.skillCooldown = this.skillCooldownMax;
      this.stamina = Math.max(0, this.stamina - 18);
      return true;
    }

    // Caster F-skill: a character can bind its 5th spell (no signature slot) to
    // the F key — cast it directly (no weapon swing), unless an override wins.
    if (def.fskillKind && !override) {
      if (this.character.hasRole("attack")) this.character.playRoleOnce("attack", 0.1);
      if (def.fskillKind === "turret") {
        // The turret is a real deployed entity (it shoots enemies), so route it
        // through the Studio rather than the cosmetic-only Vfx muzzle flash.
        // Collider-bound (opt-in): aim it where the casting hand POINTS
        // (ground-projected) so it matches the Skill Lab; else flat body facing.
        // We keep the original standing distance (2.2m ahead of the body) so
        // gameplay balance is preserved — only the deploy DIRECTION follows the
        // hand. Anchoring on the hand's own ground position could drop the turret
        // on top of the caster, so we project from the body along the hand aim.
        const pose = this.colliderPose();
        const ground = (pose ? pose.aim : fwd).clone().setY(0);
        if (ground.lengthSq() < 1e-4) ground.set(0, 0, 1);
        ground.normalize();
        const baseAt = origin.clone().addScaledVector(ground, 2.2);
        this.deployTurret(baseAt, ground);
        this.skillCooldownMax = 8;
      } else {
        // Data-driven path: a caster F-skill is a pure-VFX instant cast (the
        // spell visuals are owned by the Vfx subsystem). Routed through the
        // orchestrator so it shares the lifecycle + cancelAll teardown; playSkill
        // fires synchronously inside cast(), identical to the inline call.
        const fk = def.fskillKind;
        this.abilities.cast(vfxSkill(fk, SKILL_COLOR[fk]), {
          onCast: () => this.vfx.playSkill(fk, origin, fwd, quat, undefined, undefined, this.colliderPose() ?? undefined),
        });
        this.skillCooldownMax = 2.2;
      }
      this.skillCooldown = this.skillCooldownMax;
      this.stamina = Math.max(0, this.stamina - 18);
      return true;
    }

    // F skill — weapon skill, or an assigned clip overriding the default swing.
    const w = getWeapon(this.weaponId);
    // USER-DIRECTED bow special: its F-skill is a quick lunging melee SLASH that
    // SLOWS whatever it hits (a faster variant of the greatsword slide-attack).
    // Unlike the generic VFX-only F-skill it lunges, lands a real hit and applies
    // a movement-slow debuff at the strike point. An assigned override still wins.
    if (this.weaponId === "bow" && !override) {
      return this.doBowSlash(origin, fwd, quat);
    }
    // Javelin: the F-skill THROWS a real javelin projectile (additive trail) that
    // deals impact damage where it lands — instead of the generic VFX-only cast.
    if (this.weaponId === "javelin" && !override) {
      return this.doJavelinThrow(origin, fwd);
    }
    // Kit ability (mace2h Smite) can name Explorer verbs; GLB falls back to attack.
    const kitAbility = w.skillKit?.ability;
    const fClip = override ?? kitAbility?.clip;
    if (fClip && this.character.hasClip(fClip)) this.character.playClipOnce(fClip, 0.1);
    else if (this.character.hasRole("attack")) this.character.playRoleOnce("attack", 0.1);
    // VFX kind: kit ability when present, else weapon.kind (unchanged for non-kit weapons).
    const fKind = kitAbility?.kind ?? w.kind;
    this.abilities.cast(vfxSkill(fKind, SKILL_COLOR[fKind]), {
      onCast: () => this.vfx.playSkill(fKind, origin, fwd, quat, undefined, undefined, this.colliderPose() ?? undefined),
    });
    this.skillCooldownMax = w.cooldown;
    this.skillCooldown = w.cooldown;
    this.stamina = Math.max(0, this.stamina - 15);
    return true;
  }

  /**
   * Opt-in (`CharacterDef.colliderVfx`): derive the swinging hand's world frame
   * so combat skill VFX emit from the hand (position + 3D angle), matching the
   * Dressing Room Skill Lab's `slashFromCollider` preview. Returns null — i.e.
   * unchanged flat-facing behavior — when the flag is off or no hand is present.
   *
   * The aim direction is taken from the hand's ORIENTATION, not its displacement:
   * each local axis is projected through the hand quaternion and the one pointing
   * most outward from the chest is chosen, so rotating the hand in place re-aims
   * the cast (mirrors EditorScene.playVfx). The chest->hand vector only
   * disambiguates which axis/sign reads as "forward" (bone conventions vary).
   */
  private colliderPose(): { pos: THREE.Vector3; quat: THREE.Quaternion; aim: THREE.Vector3 } | null {
    if (!this.character) return null;
    if (!getCharacter(this.characterId).colliderVfx) return null;
    const hand = this.character.rightHand;
    if (!hand) return null;
    hand.updateWorldMatrix(true, false);
    const pos = hand.getWorldPosition(new THREE.Vector3());
    const quat = hand.getWorldQuaternion(new THREE.Quaternion());
    const chest = this.character.root.position.clone();
    chest.y += 1.0;
    const ref = pos.clone().sub(chest);
    if (ref.lengthSq() > 1e-5) ref.normalize();
    else ref.copy(this.facing());
    const axes = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
    ];
    const aim = new THREE.Vector3();
    let bestDot = -Infinity;
    for (const ax of axes) {
      ax.applyQuaternion(quat);
      const d = ax.dot(ref);
      if (d > bestDot) {
        bestDot = d;
        aim.copy(ax);
      }
    }
    aim.normalize();
    return { pos, quat, aim };
  }

  /**
   * World pose of the equipped weapon (the right-hand mount the weapon model is
   * attached to), independent of the {@link colliderPose} `colliderVfx` opt-in.
   * Used so the slash crescent always originates from — and points out of — the
   * weapon's mesh, regardless of character. Returns null when there is no hand.
   */
  private weaponPose(): { pos: THREE.Vector3; quat: THREE.Quaternion } | null {
    const hand = this.character?.rightHand;
    if (!hand) return null;
    hand.updateWorldMatrix(true, false);
    return {
      pos: hand.getWorldPosition(new THREE.Vector3()),
      quat: hand.getWorldQuaternion(new THREE.Quaternion()),
    };
  }

  /**
   * Stable crescent index for the equipped weapon, hashed from its id, so the
   * same weapon always shows the SAME slash arc throughout (no per-swing random).
   */
  private slashIndexForWeapon(): number {
    const id = this.weaponId ?? "none";
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  /**
   * A dash signature: ease the body forward (spline motion) while the real skill
   * clip plays, then land an AoE at the strike point. The blast fires on impact
   * (mid-lunge), not when the slide ends, so the hit reads with the animation.
   */
  private doDashSkill(kind: SkillKind, origin: THREE.Vector3, fwd: THREE.Vector3, clipDur = 0) {
    // Apply the character's direction-assist + dash-rating: acquire a target in
    // the assist cone, steer toward it, and scale the lunge distance by rating.
    const cfg = this.assistConfig();
    const picked = this.pickTargetInFront(origin, fwd, cfg.acqRange, cfg.minDot);
    const dir = this.steerToward(fwd, origin, picked, cfg.steer);
    const dist = picked
      ? THREE.MathUtils.clamp(picked.dist - 1.0, 0.6, cfg.maxReach)
      : cfg.maxReach;
    // Tie the slide to the real clip so the body and the animation stay in sync.
    const dur = THREE.MathUtils.clamp(clipDur > 0 ? clipDur * 0.5 : 0.42, 0.3, 0.7);
    const impactAt = 0.55;
    const endpoint = origin.clone().addScaledVector(dir, dist);
    endpoint.x = THREE.MathUtils.clamp(endpoint.x, -15, 15);
    endpoint.z = THREE.MathUtils.clamp(endpoint.z, -15, 15);
    const color = SKILL_COLOR[kind];
    this.controller?.dash(dir, dist, dur, 0, impactAt);
    this.vfx.dashStreak(origin, endpoint, color);
    // Data-driven path: the dash/streak/cooldown stay inline; only the delayed
    // AoE blast moves into the orchestrator's impact phase. The wind-up duration
    // is the runtime slide delay, so the impact lands at exactly the same time
    // the legacy `schedule(dur * impactAt, …)` fired (orchestrator.update runs
    // adjacent to updatePending with the same dt). cancelAll covers teardown.
    const base = getAbility("dashSkill");
    const def2: AbilityDef = base
      ? { ...base, kind, color, cast: { ...base.cast, duration: dur * impactAt } }
      : { id: "dashSkill", name: "Dash Skill", kind, color, target: "aimed", cast: { duration: dur * impactAt } };
    this.abilities.cast(def2, {
      onImpact: () => {
        const center = endpoint.clone();
        center.y += 1.0;
        this.vfx.aoeBlast(center, color, this.params.aoeRadius);
        this.sparringBlast(center, this.params.aoeRadius, 45, this.params.skillForce);
      },
    });
  }

  /**
   * USER-DIRECTED bow F-skill: a quick lunging melee SLASH that SLOWS its victim.
   * Plays the slash clip, lunges toward an assist-cone target, and on impact lands
   * a single hit + applies a movement-slow debuff (slower than a full dash skill's
   * AoE, focused on the slow utility). Read as a faster slide-attack slash.
   */
  private doBowSlash(origin: THREE.Vector3, fwd: THREE.Vector3, quat: THREE.Quaternion): boolean {
    if (!this.character) return false;
    const SLASH_CLIP = "animations/sword/great-sword-slide-attack";
    const RADIUS = 2.0;
    const DAMAGE = 22;
    const SLOW_MUL = 0.45; // approach speed cut to 45% while slowed
    const SLOW_SECONDS = 3.0;
    // Play the slash; "quicker" via a slightly faster fade-in than the heavy slide.
    const dur = this.character.hasClip(SLASH_CLIP)
      ? this.character.playClipOnce(SLASH_CLIP, 0.08)
      : this.character.hasRole("attack")
        ? this.character.playRoleOnce("attack", 0.08)
        : 0.4;
    // Lunge toward an assist-cone target (mirrors doDashSkill's steering).
    const cfg = this.assistConfig();
    const picked = this.pickTargetInFront(origin, fwd, cfg.acqRange, cfg.minDot);
    const dir = this.steerToward(fwd, origin, picked, cfg.steer);
    const dist = picked
      ? THREE.MathUtils.clamp(picked.dist - 1.0, 0.6, cfg.maxReach)
      : Math.min(cfg.maxReach, 3.5);
    const slideDur = THREE.MathUtils.clamp(dur > 0 ? dur * 0.45 : 0.34, 0.24, 0.55);
    const impactAt = 0.55;
    const endpoint = origin.clone().addScaledVector(dir, dist);
    endpoint.x = THREE.MathUtils.clamp(endpoint.x, -15, 15);
    endpoint.z = THREE.MathUtils.clamp(endpoint.z, -15, 15);
    const color = SKILL_COLOR.slash;
    this.controller?.dash(dir, dist, slideDur, 0, impactAt);
    this.vfx.dashStreak(origin, endpoint, color);
    // Data-driven path (proof migration): the orchestrator owns the wind-up →
    // impact lifecycle. The cast clip + lunge + streak fire here (the cast phase,
    // already played above), and the impact phase lands the hit + slow debuff at
    // the same delay the legacy `schedule(slideDur * impactAt, …)` used.
    const base = getAbility("bowSlash");
    const def2: AbilityDef = base
      ? { ...base, cast: { ...base.cast, duration: slideDur * impactAt } }
      : { id: "bowSlash", name: "Bow Slash", kind: "slash", color, target: "aimed", cast: { duration: slideDur * impactAt } };
    this.abilities.cast(def2, {
      onImpact: () => {
        const center = endpoint.clone();
        center.y += 1.0;
        this.vfx.playSkill("slash", center, fwd, quat);
        this.sparringBlast(center, RADIUS, DAMAGE, this.params.skillForce);
        this.targets.slowArea(center, RADIUS, SLOW_MUL, SLOW_SECONDS);
      },
    });
    this.skillCooldownMax = Math.max(getWeapon(this.weaponId).cooldown, 1.2);
    this.skillCooldown = this.skillCooldownMax;
    this.stamina = Math.max(0, this.stamina - 15);
    return true;
  }

  /**
   * Javelin F-skill: hurl the javelin as a real projectile toward an assist-cone
   * target (or straight ahead). The thrown javelin.glb flies with an additive
   * trail and lands a sharp single-point blast where it impacts.
   */
  private doJavelinThrow(origin: THREE.Vector3, fwd: THREE.Vector3): boolean {
    if (!this.character) return false;
    const DAMAGE = 32;
    const RADIUS = 1.5;
    // Wind-up/release pose: the dedicated throw clip if present, else the generic
    // attack role (both no-op cleanly on rigs lacking either).
    if (this.character.hasClip("throw")) this.character.playClipOnce("throw", 0.1);
    else if (this.character.hasRole("attack")) this.character.playRoleOnce("attack", 0.1);
    // Lead toward an assist-cone target so the throw tracks an enemy in front.
    const cfg = this.assistConfig();
    const picked = this.pickTargetInFront(origin, fwd, cfg.acqRange, cfg.minDot);
    const dir = this.steerToward(fwd, origin, picked, cfg.steer);
    // Launch from the throwing hand (chest height) along the aim line.
    const from = origin.clone();
    from.y += 1.2;
    const color = SKILL_COLOR[getWeapon(this.weaponId).kind] ?? 0x9fe8ff;
    this.vfx.castJavelin(from, dir, color, (p) => {
      this.sparringBlast(p, RADIUS, DAMAGE, this.params.skillForce);
    });
    this.skillCooldownMax = Math.max(getWeapon(this.weaponId).cooldown, 1.2);
    this.skillCooldown = this.skillCooldownMax;
    this.stamina = Math.max(0, this.stamina - 15);
    return true;
  }

  // ----------------------------------------------------------- Pistol Kiter kit

  /** Muzzle world position (pistol tip if mounted, else a fist-height point ahead). */
  private muzzleOrigin(dir: THREE.Vector3): THREE.Vector3 {
    const pos = new THREE.Vector3();
    if (this.mounted?.tip) {
      this.mounted.tip.getWorldPosition(pos);
    } else {
      pos.copy(this.character.root.position);
      pos.y += 1.3;
      pos.addScaledVector(dir, 0.4);
    }
    return pos;
  }

  /**
   * Pistol "Kiter" primary fire. Proximity-adaptive: with a target inside
   * `kickRange` it becomes a close MMA kick (parry/stun); otherwise it shoots a
   * bullet and back-steps away (gunslinger mobility). A `clipSize`-round clip
   * reloads automatically, and the final round is a colorful explosive bullet.
   */
  private doPistolPrimary(kit: KiterKit) {
    if (!this.character || !this.controller || this.pistolLock > 0) return;
    const combat = weaponCombat("pistol");
    const target = this.pickCrosshairTarget(combat);
    let dist = Infinity;
    let dir = this.controller.forward();
    if (target) {
      const planar = this.toTargetPlanar(target);
      dist = planar.dist;
      dir = planar.dir.clone();
    }
    // Always face where we're firing (so the backstep reads as a kiter backpedal).
    this.controller.faceToward(dir, 0.3);

    if (target && dist <= kit.kickRange) {
      this.doPistolKick(kit, dir);
      this.pistolLock = 0.42;
    } else {
      this.doPistolShot(kit, dir, target, dist);
      this.pistolLock = 0.18;
    }
  }

  /** Close-quarters MMA kick: a short step-in strike with knockback + stun flash. */
  private doPistolKick(kit: KiterKit, dir: THREE.Vector3) {
    if (!this.character || !this.controller) return;
    const dur = this.character.playClipOnce("mmaKick", 0.1);
    this.controller.dash(dir, 0.5, 0.18, 0, 0.5);
    this.abilities.cast(kitAbility("pistolKick", "slam", 0xfff2a8, dur > 0 ? dur * 0.4 : 0.18), {
      onImpact: () => {
        if (!this.character) return;
        const center = this.character.root.position.clone().addScaledVector(dir, kit.kickRange * 0.7);
        center.y += 1.0;
        this.targets.blast(center, kit.kickRange + 0.4, kit.kickDamage, this.params.skillForce * 1.5);
        this.vfx.impact(center, 0xfff2a8, kit.kickRange + 0.6);
        this.vfx.shockwave(new THREE.Vector3(center.x, 0.05, center.z), 0xffe08a, 1.6, 0.4);
      },
    });
  }

  /**
   * Fire one ranged round toward the aimed target (or crosshair), then back-step
   * away. Ordinary rounds are precise tracers; the final round of the clip is an
   * explosive colorful bullet with an AoE blast, after which the clip reloads.
   */
  private doPistolShot(kit: KiterKit, dir: THREE.Vector3, target: TargetHandle | null, dist: number) {
    if (!this.character || !this.controller) return;
    this.pistolShots += 1;
    const explosive = this.pistolShots >= kit.clipSize;
    const color = explosive ? 0xff8a3c : 0xfff2a8;
    // Recoil kick (decays over the next frames) + hit-marker on a confirmed target.
    this.recoil.kick(explosive ? 0.05 : 0.025, explosive ? 0.05 : 0.025);
    if (target) this.hitMarkerCount += 1;

    // The explosive round uses the charged pose; ordinary rounds the gunplay attack.
    if (explosive) this.character.playClipOnce("chargedShot", 0.1);
    else if (this.character.hasRole("attack")) this.character.playRoleOnce("attack", 0.1);

    const origin = this.muzzleOrigin(dir);
    this.vfx.burst(origin, color, explosive ? 16 : 9, 3);
    const range = target ? THREE.MathUtils.clamp(dist + 0.3, 2, 24) : 24;
    const speed = explosive ? 34 : 48;
    this.vfx.bolt(origin, dir, color, speed, range, (p) => {
      if (explosive) {
        this.vfx.aoeBlast(p, color, kit.blastRadius);
        this.vfx.shockwave(new THREE.Vector3(p.x, 0.05, p.z), 0xff5a2a, kit.blastRadius, 0.5);
        this.targets.blast(p, kit.blastRadius, kit.blastDamage, this.params.skillForce * 1.6);
      } else {
        this.vfx.impact(p, color, 1.4);
        this.targets.blast(p, 0.8, kit.shotDamage, this.params.skillForce * 0.5);
      }
    });

    // Kiter mobility: reverse-motion-math back-step away from the aim line after
    // firing. The hop grants a brief i-frame window so the backpedal reads as a
    // real evasive dodge (the kiter's shoot-and-slip fantasy) rather than a
    // cosmetic shuffle. A cooldown gates the i-frames so rapid fire (re-fire lock
    // is only 0.18s) can't chain the 0.22s window into continuous immunity — the
    // dodge covers one backstep, then there's a real vulnerable beat before it
    // re-arms. Only the ranged backstep dodges, never the close-range MMA kick.
    this.controller.dash(dir.clone().negate(), kit.backstep, 0.22, 0, 0.5);
    if (this.pistolDodgeCd <= 0) {
      this.invuln = Math.max(this.invuln, 0.22);
      this.pistolDodgeCd = 0.6;
    }
    if (explosive) this.pistolShots = 0;
  }

  // ------------------------------------------------- Kiter signature skills (1-4)

  /**
   * Stun every living target within `radius` of `center` for real (they freeze +
   * skip reactions) and float the matching stun-star VFX above each, timed to the
   * same duration so the cosmetic marks line up with the status timer.
   */
  private markStun(center: THREE.Vector3, radius: number, seconds = STUN_SECONDS) {
    this.targets.stun(center, radius, seconds);
    for (const h of this.targets.nearest(center, 8)) {
      if (h.position.distanceTo(center) <= radius) {
        const p = h.position.clone();
        p.y += 1.0;
        this.vfx.stunMark(p, 0xffe24a, seconds);
      }
    }
  }

  /** Dispatch a Kiter signature skill (slot index 0-3); independent cooldowns. */
  private doPistolSig(idx: number, kit: KiterKit): boolean {
    if (idx < 0 || idx > 3) return false;
    if (this.sigCooldowns[idx] > 0) return false;
    switch (idx) {
      case 0:
        return this.doPistolSig0(kit);
      case 1:
        return this.doPistolSig1(kit);
      case 2:
        return this.doPistolSig2(kit);
      case 3:
        return this.doPistolSig3(kit);
      default:
        return false;
    }
  }

  private armSig(idx: number) {
    this.sigCooldowns[idx] = PISTOL_SIG_CD[idx];
    this.sigCooldownMaxes[idx] = PISTOL_SIG_CD[idx];
    this.stamina = Math.max(0, this.stamina - PISTOL_SIG_ST[idx]);
  }

  /** Sig 1 — Quick Draw: a quick three-round fan at the crosshair target. */
  private doPistolSig0(kit: KiterKit): boolean {
    if (!this.character || !this.controller) return false;
    const combat = weaponCombat("pistol");
    const target = this.pickCrosshairTarget(combat);
    let dir = this.controller.forward();
    let dist = 22;
    if (target) {
      const planar = this.toTargetPlanar(target);
      dir = planar.dir.clone();
      dist = planar.dist;
    }
    this.controller.faceToward(dir, 0.2);
    this.character.playClipOnce("chargedShot", 0.1);
    for (let i = 0; i < 3; i++) {
      this.abilities.cast(kitAbility("pistolQuickDraw", "bolt", 0xfff2a8, i * 0.12), {
        onImpact: () => {
          if (!this.character) return;
          const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (i - 1) * 0.08).normalize();
          const origin = this.muzzleOrigin(d);
          this.vfx.muzzle(origin, d, 0xfff2a8);
          const range = THREE.MathUtils.clamp(dist + 1, 3, 24);
          this.vfx.bolt(origin, d, 0xfff2a8, 50, range, (p) => {
            this.vfx.impact(p, 0xfff2a8, 1.3);
            this.targets.blast(p, 0.9, kit.shotDamage, this.params.skillForce * 0.5);
          });
        },
      });
    }
    this.armSig(0);
    return true;
  }

  /**
   * Sig 2 — Smoke Phantom: drop a smoke decoy that fires ~3 shots over 2s, vanish
   * (invisible) with +100% move speed for ~4s, and unleash a pistol-whip →
   * uppercut close combo on the nearest target.
   */
  private doPistolSig1(kit: KiterKit): boolean {
    if (!this.character || !this.controller) return false;
    const decoyPos = this.character.root.position.clone();
    this.vfx.smokeClone(decoyPos, 2.2);
    this.vfx.shockwave(new THREE.Vector3(decoyPos.x, 0.05, decoyPos.z), 0x8893a6, 2.2, 0.5);

    // Phantom: invisible + double speed for ~4s (restored by the loop timer).
    this.character.root.visible = false;
    this.controller.setSpeedMultiplier(2);
    this.phantomTimer = 4;

    // Decoy auto-fires three shots over ~2s toward the nearest target.
    for (let i = 0; i < 3; i++) {
      this.abilities.cast(kitAbility("pistolPhantomShot", "bolt", 0xc8d4e6, 0.3 + i * 0.6), {
        onImpact: () => {
          const near = this.targets.nearest(decoyPos, 1)[0];
          const muzzle = decoyPos.clone();
          muzzle.y += 1.3;
          const dir = near
            ? near.position.clone().sub(muzzle).normalize()
            : this.facing();
          this.vfx.muzzle(muzzle, dir, 0xc8d4e6);
          const range = near
            ? THREE.MathUtils.clamp(near.position.distanceTo(muzzle) + 0.5, 3, 24)
            : 18;
          this.vfx.bolt(muzzle, dir, 0xc8d4e6, 48, range, (p) => {
            this.vfx.impact(p, 0xc8d4e6, 1.2);
            this.targets.blast(p, 0.8, kit.shotDamage, this.params.skillForce * 0.4);
          });
        },
      });
    }

    // Pistol-whip → uppercut close combo on the nearest target.
    const near = this.targets.nearest(this.character.root.position, 1)[0];
    const cdir = near ? this.toTargetPlanar(near).dir.clone() : this.facing();
    this.controller.faceToward(cdir, 0.2);
    const d1 = this.character.playClipOnce("pistolWhip", 0.1);
    this.abilities.cast(kitAbility("pistolWhip", "slam", 0xc8d4e6, d1 > 0 ? d1 * 0.4 : 0.18), {
      onImpact: () => {
        if (!this.character) return;
        const c = this.character.root.position.clone().addScaledVector(cdir, kit.kickRange * 0.7);
        c.y += 1.0;
        this.targets.blast(c, kit.kickRange + 0.5, kit.kickDamage, this.params.skillForce * 1.2);
        this.vfx.impact(c, 0xc8d4e6, kit.kickRange + 0.6);
        this.markStun(c, kit.kickRange + 0.6);
        // Uppercut finisher launches the target up.
        this.character.playClipOnce("uppercut", 0.1);
        this.abilities.cast(kitAbility("pistolUppercut", "slam", 0xfff2a8, 0.18), {
          onImpact: () => {
            if (!this.character) return;
            const u = this.character.root.position.clone().addScaledVector(cdir, kit.kickRange * 0.6);
            u.y += 1.2;
            this.targets.launch(u, kit.kickRange + 0.4, kit.kickDamage, 8);
            this.vfx.burst(u, 0xfff2a8, 24, 4);
          },
        });
      },
    });

    this.armSig(1);
    return true;
  }

  /**
   * Sig 3 — Bear Trap: lob a thrown bear-trap to the aimed point that detonates on
   * landing, blasting + stunning everything in radius.
   */
  private doPistolSig2(kit: KiterKit): boolean {
    if (!this.character || !this.controller) return false;
    this.character.playClipOnce("mmaKick", 0.1);
    const target = this.pickCrosshairTarget(weaponCombat("pistol"));
    const from = this.muzzleOrigin(this.controller.forward());
    let to: THREE.Vector3;
    if (target) {
      to = target.position.clone();
      to.y = 0.2;
    } else {
      to = this.character.root.position.clone().addScaledVector(this.facing(), 6);
      to.y = 0.2;
      to.x = THREE.MathUtils.clamp(to.x, -14, 14);
      to.z = THREE.MathUtils.clamp(to.z, -14, 14);
    }
    this.vfx.thrownProp("models/props/bear-trap.glb", from, to, 0xc0c8d4, (p) => {
      this.vfx.aoeBlast(p, 0xffd24a, kit.blastRadius * 0.8);
      this.targets.blast(p, kit.blastRadius * 0.8, kit.kickDamage, this.params.skillForce * 0.8);
      this.markStun(p, kit.blastRadius * 0.8);
    });
    this.armSig(2);
    return true;
  }

  /**
   * Sig 4 — Hexaring Beam: leap and float (~2.5s), conjure spinning hexarings at
   * the muzzle, charge ~0.5s, then sweep a ~1.5s beam that shield-breaks + stuns
   * targets along the aim before descending gently.
   */
  private doPistolSig3(kit: KiterKit): boolean {
    if (!this.character || !this.controller) return false;
    this.character.playClipOnce("chargedShot", 0.1);
    this.controller.startHover(2.4, 2.5);
    // Lock onto the crosshair target so the beam — and the damage resolved along
    // its swept line below — tracks the aimed enemy instead of firing straight
    // down the camera. The beam object is itself the damage producer: damage is
    // dealt where the beam visually lands (on the crosshair).
    const aimTarget = this.pickCrosshairTarget(weaponCombat("pistol"));
    const aimDir = () => {
      if (aimTarget && aimTarget.alive) {
        const base = this.character!.root.position.clone();
        base.y += 1.3;
        const d = aimTarget.position.clone().sub(base);
        if (d.lengthSq() > 1e-4) return d.normalize();
      }
      return this.controller!.forward();
    };
    const muzzleGetter = () => this.muzzleOrigin(aimDir());
    const dirGetter = aimDir;
    const BEAM_LEN = 22;

    // Spinning hexarings at the muzzle during charge + beam.
    this.vfx.hexaring(muzzleGetter, 0x9fd8ff, 2.0);
    this.abilities.cast(kitAbility("pistolHexBurst", "laser", 0x9fd8ff, 0.0), {
      onImpact: () => this.vfx.burst(muzzleGetter(), 0x9fd8ff, 16, 2),
    });
    this.abilities.cast(kitAbility("pistolHexBurst", "laser", 0x9fd8ff, 0.25), {
      onImpact: () => this.vfx.burst(muzzleGetter(), 0x9fd8ff, 16, 2),
    });

    // Fire the beam after a 0.5s charge; it lasts ~1.5s and ticks 5 times.
    this.abilities.cast(kitAbility("pistolBeam", "laser", 0x9fd8ff, 0.5), {
      onImpact: () => {
        if (!this.character || !this.controller || this.disposed) return;
        this.vfx.beam(muzzleGetter, dirGetter, 0x9fd8ff, BEAM_LEN, 1.5);
        for (let i = 0; i < 5; i++) {
          this.abilities.cast(kitAbility("pistolBeamTick", "laser", 0x9fd8ff, i * 0.3), {
            onImpact: () => {
              if (!this.controller || !this.character) return;
              const o = muzzleGetter();
              const d = dirGetter().clone().normalize();
              for (const h of this.targets.nearest(this.character.root.position, 8)) {
                const v = h.position.clone().sub(o);
                const proj = v.dot(d);
                if (proj < 0 || proj > BEAM_LEN) continue;
                const closest = o.clone().addScaledVector(d, proj);
                if (closest.distanceTo(h.position) <= 1.4) {
                  const center = h.position.clone();
                  this.targets.blast(center, 0.6, kit.shotDamage, this.params.skillForce * 0.3);
                  // Real crowd-control: strip the target's guard, then stun it.
                  this.targets.shieldBreak(center, 0.9, SHIELD_BREAK_SECONDS);
                  this.targets.stun(center, 0.9, STUN_SECONDS);
                  const mp = h.position.clone();
                  mp.y += 1.0;
                  this.vfx.shieldBreak(mp, 0x9fd8ff);
                  this.vfx.stunMark(mp, 0xffe24a, STUN_SECONDS);
                }
              }
            },
          });
        }
      },
    });
    this.armSig(3);
    return true;
  }

  // ------------------------------------------------ Arcane Staff (Soulbinder) kit

  /** Arm an arcane signature slot: set its cooldown (for the HUD) + spend stamina. */
  private armArcaneSig(idx: number) {
    this.sigCooldowns[idx] = ARCANE_SIG_CD[idx];
    this.sigCooldownMaxes[idx] = ARCANE_SIG_CD[idx];
    this.stamina = Math.max(0, this.stamina - ARCANE_SIG_ST[idx]);
  }

  /** Dispatch a Soulbinder arcane-staff signature skill (slot 0-3). */
  private doArcaneSig(idx: number, kit: ArcaneKit): boolean {
    if (idx < 0 || idx > 3) return false;
    if (this.sigCooldowns[idx] > 0) return false;
    switch (idx) {
      case 0:
        return this.doArcaneStep(kit);
      case 1:
        return this.doArcaneSouls(kit);
      case 2:
        return this.doArcaneJaunt(kit);
      case 3:
        return this.doArcaneNova(kit);
      default:
        return false;
    }
  }

  /** Sig 1 — Soul Step: a quick spectral backstep that wisps the caster away. */
  private doArcaneStep(kit: ArcaneKit): boolean {
    if (!this.character || !this.controller) return false;
    const color = SKILL_COLOR.soul;
    const back = this.facing().negate();
    const origin = this.character.root.position.clone();
    origin.y += 1.0;
    this.character.playClipOnce("backJump", 0.1);
    this.vfx.smokePop(origin, color, 1.1);
    this.vfx.puff(origin, color, 14, 1.2);
    this.controller.dash(back, kit.backstep, 0.42, 0, 0.5);
    this.armArcaneSig(0);
    return true;
  }

  /**
   * Sig 2 — Soul Release: launch a fan of homing soul bolts. Each seeks a nearby
   * living target (homing burst + AoE on impact); with no targets in range the
   * souls drift out in a forward fan and burst where they land.
   */
  private doArcaneSouls(kit: ArcaneKit): boolean {
    if (!this.character || !this.controller) return false;
    const color = SKILL_COLOR.soul;
    this.character.playClipOnce("magicAttack", 0.12);
    const center = this.character.root.position.clone();
    const fwd = this.facing();
    const muzzle = () => {
      // Collider-bound (opt-in via colliderVfx): stream the souls from the
      // swinging casting hand's world pose; else a chest-height body point. The
      // souls still home onto their targets — only the launch origin moves.
      const pose = this.colliderPose();
      if (pose) return pose.pos.clone();
      const m = this.character!.root.position.clone();
      m.y += 1.3;
      return m;
    };
    const seekable = this.targets
      .nearest(center, kit.soulCount)
      .filter((h) => h.alive && h.position.distanceTo(center) <= 18);
    const onHit = (p: THREE.Vector3) => {
      this.vfx.aoeBlast(p, color, kit.soulRadius);
      this.sparringBlast(p, kit.soulRadius, kit.soulDamage, this.params.skillForce * 0.7);
    };
    for (let i = 0; i < kit.soulCount; i++) {
      this.abilities.cast(kitAbility("arcaneSoul", "soul", color, i * 0.1), {
        onImpact: () => {
          if (!this.character || this.disposed) return;
          const from = muzzle();
          const tgt = seekable.length ? seekable[i % seekable.length] : undefined;
          if (tgt && tgt.alive) {
            this.vfx.castSoulAt(from, tgt.position.clone(), color, onHit);
          } else {
            const spread = (i - (kit.soulCount - 1) / 2) * 0.22;
            const dir = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spread).normalize();
            this.vfx.castSoul(from, dir, color, onHit);
          }
        },
      });
    }
    this.armArcaneSig(1);
    return true;
  }

  /**
   * Sig 3 — Void Jaunt: drop a cluster of timed soul-bombs at the launch point,
   * then blink the caster backward out of danger. The bombs detonate after
   * `bombDelay`s, blasting everything still standing in the vacated spot.
   */
  private doArcaneJaunt(kit: ArcaneKit): boolean {
    if (!this.character || !this.controller) return false;
    const color = SKILL_COLOR.soul;
    const origin = this.character.root.position.clone();
    this.character.playClipOnce("longBackJump", 0.1);

    // Lob the bombs from the caster's hand to a small ring around the launch point.
    const hand = origin.clone();
    hand.y += 1.2;
    for (let i = 0; i < kit.bombCount; i++) {
      const ang = (i / Math.max(1, kit.bombCount)) * Math.PI * 2;
      const spread = kit.bombCount > 1 ? 1.1 : 0;
      const to = origin.clone().add(new THREE.Vector3(Math.cos(ang) * spread, 0.15, Math.sin(ang) * spread));
      to.x = THREE.MathUtils.clamp(to.x, -14, 14);
      to.z = THREE.MathUtils.clamp(to.z, -14, 14);
      this.vfx.thrownProp("models/props/soul-bomb.glb", hand, to, color, (p) => {
        // Fuse telegraph (a slow soul ring) that resolves into the detonation.
        this.vfx.shockwave(new THREE.Vector3(p.x, 0.05, p.z), color, kit.bombRadius * 0.6, kit.bombDelay);
        this.abilities.cast(kitAbility("arcaneSoulBomb", "soul", color, kit.bombDelay), {
          onImpact: () => {
            if (this.disposed) return;
            this.vfx.aoeBlast(p, color, kit.bombRadius);
            this.sparringBlast(p, kit.bombRadius, kit.bombDamage, this.params.skillForce * 1.2);
          },
        });
      });
    }

    // Blink backward out of the blast zone, with a soul-wisp at both endpoints.
    const dest = origin.clone().addScaledVector(this.facing().negate(), kit.blinkDist);
    this.abilities.cast(kitAbility("arcaneJaunt", "soul", color, 0.12), {
      onImpact: () => {
        if (!this.controller || !this.character || this.disposed) return;
        const from = this.character.root.position.clone();
        from.y += 1.0;
        this.vfx.smokePop(from, color, 1.3);
        this.controller.blinkTo(dest);
        const land = this.character.root.position.clone();
        land.y += 1.0;
        this.vfx.smokePop(land, color, 1.3);
        this.vfx.puff(land, color, 16, 1.3);
        this.controller.faceToward(this.facing(), 0.3);
      },
    });
    this.armArcaneSig(2);
    return true;
  }

  /**
   * Sig 4 — Soul Nova: a spectral detonation around the caster — an outward soul
   * shockwave that blasts every nearby target. The kit's panic / finisher button
   * for when foes close the gap.
   */
  private doArcaneNova(kit: ArcaneKit): boolean {
    if (!this.character || !this.controller) return false;
    const color = SKILL_COLOR.soul;
    this.character.playClipOnce("magicArea", 0.12);
    this.abilities.cast(kitAbility("arcaneNova", "nova", color, 0.18), {
      onImpact: () => {
        if (!this.character || this.disposed) return;
        const c = this.character.root.position.clone();
        this.vfx.aoeBlast(c, color, kit.novaRadius);
        const up = c.clone();
        up.y += 1.0;
        this.vfx.burst(up, color, 34, kit.novaRadius);
        this.sparringBlast(c, kit.novaRadius, kit.novaDamage, this.params.skillForce * 1.4);
      },
    });
    this.armArcaneSig(3);
    return true;
  }

  // -------------------------------------------------------------- Elemental cast

  /**
   * Element-flavored staff cast. Every elemental staff (fire / ice / storm /
   * nature / holy) shares the proven caster feel but launches its OWN themed
   * homing projectile that, on impact, blasts the area + applies the element's
   * status — burn / freeze / shock / poison for the offensive schools, or a
   * self-regen for holy. Driven entirely by the equipped weapon's `element`
   * data (see `arsenal/elements.ts`), so any character wielding the staff casts.
   */
  private doElementalCast(element: StaffElement): boolean {
    if (!this.character || !this.controller) return false;
    if (this.skillCooldown > 0) return false;
    const theme = ELEMENT_THEME[element];
    const color = theme.color;
    // Overhead elemental stone while cast animation plays
    this.castRunes.show({
      skillId: `elem:${element}`,
      element,
      school: element,
      channelColor: color,
    });
    this.castRunes.release(0.45);
    const origin = this.character.root.position.clone();
    const fwd = this.facing();
    if (this.character.hasClip(theme.castClip)) this.character.playClipOnce(theme.castClip, 0.12);
    const muzzle = () => {
      // Collider-bound (opt-in): stream from the casting hand's world pose; else
      // a chest-height body point. The projectile still homes onto its target.
      const pose = this.colliderPose();
      if (pose) return pose.pos.clone();
      const m = this.character!.root.position.clone();
      m.y += 1.3;
      return m;
    };
    const picked = this.pickTargetInFront(origin, fwd, 22, -0.2);
    const onHit = (p: THREE.Vector3) => {
      if (this.disposed) return;
      this.vfx.aoeBlast(p, color, 2.0);
      this.sparringBlast(p, 2.0, 26, this.params.skillForce * 0.9);
      this.applyStatusScoped(theme.status, theme.scope);
    };
    this.abilities.cast(kitAbility(`elem:${element}`, "bolt", color, 0), {
      onImpact: () => {
        if (!this.character || this.disposed) return;
        const from = muzzle();
        const to = picked ? picked.position.clone() : from.clone().addScaledVector(fwd, 16);
        switch (theme.projectile) {
          case "dragon":
            this.vfx.castDragonAt(from, to, color, onHit);
            break;
          case "darkBlades":
            this.vfx.castDarkBladesAt(from, to, color, onHit);
            break;
          case "laser":
            this.vfx.castLaserAt(from, to, color, onHit);
            break;
          case "soul":
            this.vfx.castSoulAt(from, to, color, onHit);
            break;
        }
      },
    });
    this.skillCooldownMax = 1.4;
    this.skillCooldown = this.skillCooldownMax;
    this.stamina = Math.max(0, this.stamina - 18);
    return true;
  }

  // ------------------------------------------------------------------ Staff kit

  /** True while the equipped weapon is a staff (the `magic` weapon group). */
  private isStaffEquipped(): boolean {
    return getWeapon(this.weaponId).group === "magic";
  }

  /** Themed bolt/blast colour for the equipped staff (element tint, else arcane). */
  private staffColor(): number {
    const el = getWeapon(this.weaponId).element;
    return el ? ELEMENT_THEME[el].color : STAFF_ARCANE_COLOR;
  }

  /** Casting-hand world muzzle (collider-bound when available) else chest height. */
  private staffMuzzle(): THREE.Vector3 {
    const pose = this.colliderPose();
    if (pose) return pose.pos.clone();
    const m = this.character!.root.position.clone();
    m.y += 1.3;
    return m;
  }

  /**
   * Staff LMB primary: a themed spline bolt at the crosshair target (Part 3b).
   * On the ground it carries a short kiting BACK-STEP (Part 3a); while airborne /
   * floating it casts in place (Part 3e — the double-jump levitation cast). Gated
   * by its own light cooldown so it's a steady ranged poke, not a melee combo.
   */
  private doStaffBolt() {
    if (!this.character || !this.controller) return;
    if (this.staffBoltCd > 0) return;
    this.staffBoltCd = STAFF_BOLT_CD;
    const color = this.staffColor();
    const grounded = this.controller.state.grounded;

    // Face + aim at the crosshair target (soft-aim cone from the staff combat).
    const combat = weaponCombat(this.weaponId);
    const origin = this.character.root.position.clone();
    const target = this.pickCrosshairTarget(combat);
    const fwd = this.controller.forward();
    let aimDir = fwd.clone();
    if (target) {
      const planar = this.toTargetPlanar(target);
      aimDir = planar.dir.clone();
    }
    this.controller.faceToward(aimDir, 0.2);

    // Grounded: kite back a short hop away from the foe. Airborne: cast in place.
    if (grounded) {
      const back = aimDir.clone().multiplyScalar(-1);
      this.controller.dash(back, 1.4, 0.26, 0, 0.5);
    }

    if (this.character.hasClip("magicAttack")) this.character.playClipOnce("magicAttack", 0.1);
    this.sfx?.play("whooshLight", this.staffMuzzle(), { volume: 0.6 });

    const from = this.staffMuzzle();
    // Predictive lead: aim where a moving target WILL be when the bolt arrives
    // (clamped so a real juke still dodges). Stationary targets resolve to their
    // current position (zero velocity → zero lead).
    let to: THREE.Vector3;
    if (target) {
      const led = leadTarget(from, target.position, target.velocity, STAFF_BOLT_SPEED, {
        maxLeadFraction: PROJ_LEAD_FRACTION,
      });
      to = new THREE.Vector3(led.x, target.position.y, led.z);
    } else {
      to = origin.clone().addScaledVector(fwd, 16).setY(from.y);
    }
    const onHit = (p: THREE.Vector3) => {
      if (this.disposed) return;
      this.vfx.aoeBlast(p, color, 1.2);
      this.sparringBlast(p, 1.2, 16, this.params.skillForce * 0.5);
    };
    this.vfx.splineStrike(from, to, color, onHit);
    this.stamina = Math.max(0, this.stamina - 4);
  }

  /**
   * Staff signature (slot 2): an AOE spline BARRAGE with scatter (Part 3c). Fires
   * a fan of themed spline bolts that rain onto SCATTERED points around the aim
   * target, each detonating its own small blast — area denial / multi-hit.
   */
  private doStaffScatter(): boolean {
    if (!this.character || !this.controller) return false;
    if (this.skillCooldown > 0) return false;
    const color = this.staffColor();
    const origin = this.character.root.position.clone();
    const fwd = this.controller.forward();
    const picked = this.pickTargetInFront(origin, fwd, 22, -0.2);
    const center = picked ? picked.position.clone() : origin.clone().addScaledVector(fwd, 12);
    center.y = 0;
    if (this.character.hasClip("magicArea")) this.character.playClipOnce("magicArea", 0.12);

    const BOLTS = 6;
    const SCATTER = 2.6;
    // Capture the weapon generation so a mid-volley weapon/character swap (which
    // clears `pending`) can't spawn stale bolts from the old staff.
    const token = this.weaponToken;
    for (let i = 0; i < BOLTS; i++) {
      const ang = (i / BOLTS) * Math.PI * 2 + Math.random() * 0.6;
      const r = SCATTER * (0.35 + Math.random() * 0.65);
      const to = center.clone();
      to.x += Math.cos(ang) * r;
      to.z += Math.sin(ang) * r;
      const onHit = (p: THREE.Vector3) => {
        if (this.disposed) return;
        this.vfx.aoeBlast(p, color, 1.6);
        this.sparringBlast(p, 1.6, 14, this.params.skillForce * 0.7);
      };
      // Stagger the launches via the cancellable scheduler so the barrage reads as
      // a volley, not a ring — and so swaps/disposal cancel any unlaunched bolts.
      this.schedule(i * 0.07, () => {
        if (this.disposed || token !== this.weaponToken) return;
        this.vfx.splineStrike(this.staffMuzzle(), to, color, onHit);
      });
    }
    this.skillCooldownMax = 2.6;
    this.skillCooldown = this.skillCooldownMax;
    this.stamina = Math.max(0, this.stamina - 24);
    return true;
  }

  /**
   * Staff signature (slot 3): a caster-centred NOVA — an AOE pushback + stun
   * around the mage (Part 3d). Knocks back and stuns every nearby foe, buying
   * space for the ranged kit.
   */
  private doStaffNova(): boolean {
    if (!this.character || !this.controller) return false;
    if (this.skillCooldown > 0) return false;
    const color = this.staffColor();
    const center = this.character.root.position.clone();
    const RADIUS = this.params.aoeRadius * 1.2;
    if (this.character.hasClip("magicArea")) this.character.playClipOnce("magicArea", 0.12);
    this.vfx.aoeBlast(center, color, RADIUS);
    // Heavy force so the blast genuinely shoves foes outward, plus a stun window.
    this.sparringBlast(center, RADIUS, 22, this.params.skillForce * 1.6);
    this.markStun(center, RADIUS);
    this.skillCooldownMax = 3.2;
    this.skillCooldown = this.skillCooldownMax;
    this.stamina = Math.max(0, this.stamina - 28);
    return true;
  }

  // ------------------------------------------------------------------- Tank kit

  private armTankSig(idx: number) {
    this.sigCooldowns[idx] = TANK_SIG_CD[idx];
    this.sigCooldownMaxes[idx] = TANK_SIG_CD[idx];
    this.stamina = Math.max(0, this.stamina - TANK_SIG_ST[idx]);
  }

  /** Dispatch a Tank/Centurion gunblade signature skill (slot 0-3). */
  private doTankSig(idx: number, kit: TankKit): boolean {
    if (idx < 0 || idx > 3) return false;
    if (this.sigCooldowns[idx] > 0) return false;
    switch (idx) {
      case 0:
        return this.doTankCharge(kit);
      case 1:
        return this.doTankBash(kit);
      case 2:
        return this.doTankFlurry(kit);
      case 3:
        return this.doTankCannon(kit);
      default:
        return false;
    }
  }

  /**
   * Sig 1 — Shield Charge: a committed forward shield-bash dash that closes onto
   * the aimed target, knocking back + stunning everything in the impact zone.
   */
  private doTankCharge(kit: TankKit): boolean {
    if (!this.character || !this.controller) return false;
    const origin = this.character.root.position.clone();
    const fwd = this.controller.forward();
    const cfg = this.assistConfig();
    const picked = this.pickTargetInFront(origin, fwd, cfg.acqRange, cfg.minDot);
    const dir = this.steerToward(fwd, origin, picked, cfg.steer);
    this.controller.faceToward(dir, 0.2);
    if (this.character.hasClip("dashAttack")) this.character.playClipOnce("dashAttack", 0.1);

    const dist = picked
      ? THREE.MathUtils.clamp(picked.dist - 1.0, 1.5, kit.chargeDistance)
      : kit.chargeDistance;
    const color = SKILL_COLOR.slam;
    const endpoint = origin.clone().addScaledVector(dir, dist);
    this.vfx.dashStreak(origin, endpoint, color);
    this.controller.dash(dir, dist, 0.34, dist * 0.12, 0.8);

    this.abilities.cast(kitAbility("tankCharge", "slam", color, 0.26), {
      onImpact: () => {
        if (!this.character || this.disposed) return;
        const hit = this.character.root.position.clone().addScaledVector(dir, kit.chargeRadius * 0.6);
        const flat = new THREE.Vector3(hit.x, 0.05, hit.z);
        this.vfx.aoeBlast(hit, color, kit.chargeRadius);
        this.vfx.shockwave(flat, color, kit.chargeRadius, 0.4);
        this.sparringBlast(hit, kit.chargeRadius, kit.chargeDamage, this.params.skillForce * 1.6);
        this.markStun(hit, kit.chargeRadius);
      },
    });
    this.armTankSig(0);
    return true;
  }

  /**
   * Sig 2 — Shield Bash: a fast point-blank scutum slam in front of the tank that
   * staggers (stuns) and shoves back anything pressing the guard.
   */
  private doTankBash(kit: TankKit): boolean {
    if (!this.character || !this.controller) return false;
    const origin = this.character.root.position.clone();
    const fwd = this.controller.forward();
    const cfg = this.assistConfig();
    const picked = this.pickTargetInFront(origin, fwd, cfg.acqRange, cfg.minDot);
    const dir = this.steerToward(fwd, origin, picked, cfg.steer);
    this.controller.faceToward(dir, 0.22);
    if (this.character.hasClip("stab")) this.character.playClipOnce("stab", 0.1);
    this.controller.dash(dir, 1.2, 0.18, 1.2 * 0.3, 0.6);

    const color = SKILL_COLOR.thrust;
    this.abilities.cast(kitAbility("tankBash", "thrust", color, 0.12), {
      onImpact: () => {
        if (!this.character || this.disposed) return;
        const hit = this.character.root.position.clone().addScaledVector(dir, kit.bashRadius * 0.7);
        hit.y += 1.0;
        this.vfx.impact(hit, color, 1.4);
        this.vfx.burst(hit, color, 24, kit.bashRadius * 2);
        this.sparringBlast(hit, kit.bashRadius, kit.bashDamage, this.params.skillForce * 1.2);
        this.markStun(hit, kit.bashRadius);
      },
    });
    this.armTankSig(1);
    return true;
  }

  /**
   * Sig 3 — Blade Flurry: a committed sword+shield flurry of `flurryHits` rapid
   * cuts driven by the sword combo clips, each resolving a forward AoE swing.
   */
  private doTankFlurry(kit: TankKit): boolean {
    if (!this.character || !this.controller) return false;
    const origin = this.character.root.position.clone();
    const fwd = this.controller.forward();
    const cfg = this.assistConfig();
    const picked = this.pickTargetInFront(origin, fwd, cfg.acqRange, cfg.minDot);
    const dir = this.steerToward(fwd, origin, picked, cfg.steer);
    this.controller.faceToward(dir, 0.2);
    const color = SKILL_COLOR.slash;
    const clips = ["comboHit1", "comboHit2", "comboHit3", "attack4"];
    const gap = 0.16;

    for (let i = 0; i < kit.flurryHits; i++) {
      this.abilities.cast(kitAbility("tankFlurry", "slash", color, i * gap), {
        onImpact: () => {
          if (!this.character || !this.controller || this.disposed) return;
          const swing = clips[i % clips.length];
          if (this.character.hasClip(swing)) this.character.playClipOnce(swing, 0.08);
          // A small forward step on each cut so the flurry presses the target.
          this.controller.dash(dir, 0.9, gap, 0, 0.5);
          const hit = this.character.root.position.clone().addScaledVector(dir, kit.flurryRadius * 0.6);
          hit.y += 1.0;
          this.vfx.impact(hit, color, 1.1);
          this.vfx.burst(hit, color, 14, kit.flurryRadius * 1.6);
          this.sparringBlast(hit, kit.flurryRadius, kit.flurryDamage, this.params.skillForce * 0.8);
        },
      });
    }
    this.armTankSig(2);
    return true;
  }

  /**
   * Sig 4 — Super Cannon: the gunblade's capstone. A brief brace/charge windup,
   * then a heavy beam fired straight from the barrel that detonates in a big AoE
   * blast at the first target it reaches (or the end of its range).
   */
  private doTankCannon(kit: TankKit): boolean {
    if (!this.character || !this.controller) return false;
    const cfg = this.assistConfig();
    const origin = this.character.root.position.clone();
    const fwd = this.controller.forward();
    const picked = this.pickTargetInFront(origin, fwd, kit.cannonRange, -0.2);
    const dir = this.steerToward(fwd, origin, picked, cfg.steer);
    this.controller.faceToward(dir, 0.25);
    if (this.character.hasClip("skill")) this.character.playClipOnce("skill", 0.12);

    const color = SKILL_COLOR.laser;
    // Charge telegraph at the muzzle during the windup.
    const windup = 0.45;
    const chargeAt = this.muzzleOrigin(dir);
    this.vfx.shockwave(new THREE.Vector3(chargeAt.x, 0.05, chargeAt.z), color, 2.0, windup);

    this.abilities.cast(kitAbility("tankCannon", "laser", color, windup), {
      onImpact: () => {
        if (!this.character || this.disposed) return;
        const muzzle = this.muzzleOrigin(dir);
        this.vfx.muzzle(muzzle, dir, color);
        const range = picked
          ? THREE.MathUtils.clamp(picked.dist + 1, 4, kit.cannonRange)
          : kit.cannonRange;
        // A fat, fast beam that blasts a big AoE where it lands.
        this.vfx.bolt(muzzle, dir, color, 90, range, (p) => {
          this.vfx.aoeBlast(p, color, kit.cannonRadius);
          this.vfx.burst(p, color, 48, kit.cannonRadius * 1.8);
          this.vfx.shockwave(new THREE.Vector3(p.x, 0.05, p.z), color, kit.cannonRadius, 0.5);
          this.sparringBlast(p, kit.cannonRadius, kit.cannonDamage, this.params.skillForce * 2);
        });
      },
    });
    this.armTankSig(3);
    return true;
  }

  // ---------------------------------------------------------------- Striker kit

  /**
   * The Striker's 3-hit LMB fire combo, driven by the per-stage `kick.combo[]`
   * config in assets.ts (single source of truth for clip + tuning). Each step
   * names a real GLB clip and carries reach / bounce / force / radius / damage
   * plus optional `lift` (pop the target up) and `hop` (self bounce-away). The
   * stage-specific fire VFX flavour stays here (cosmetic only). Stage 0 = bounce
   * kick up, 1 = fire-foot downward strike, 2 = spinning finisher + cone flame.
   */
  private doKickCombo(stage: number): number {
    if (!this.character || !this.controller) return 0;
    const combo = getCharacter(this.characterId).kick?.combo ?? [];
    const step = combo[Math.min(stage, combo.length - 1)];
    if (!step) return 0;
    const last = stage >= combo.length - 1;

    const cfg = this.assistConfig();
    const origin = this.character.root.position.clone();
    const aim = this.controller.forward();
    const picked = this.pickTargetInFront(origin, aim, cfg.acqRange, cfg.minDot);
    const dir = this.steerToward(aim, origin, picked, cfg.steer);
    this.controller.faceToward(dir, 0.20);

    // Per-stage clip from config; fall back to the attack role when the rig is
    // missing that native GLB clip so the strike still animates.
    let dur = 0;
    if (step.clip && this.character.hasClip(step.clip)) dur = this.character.playClipOnce(step.clip, 0.1);
    else if (this.character.hasRole("attack")) dur = this.character.playRoleOnce("attack", 0.1);

    // Reach: close to the picked target, else the step's nominal reach (config).
    const reach = picked
      ? THREE.MathUtils.clamp(picked.dist - 0.9, 0.4, cfg.maxReach)
      : Math.min(step.reach, cfg.maxReach);

    // Lunge in over a slice of the clip, springing back by `bounce` of reach.
    const impactAt = last ? 0.50 : 0.45;
    const lungeDur = THREE.MathUtils.clamp(dur > 0 ? dur * 0.5 : 0.4, 0.22, 0.58);
    this.controller.dash(dir, reach, lungeDur, reach * step.bounce, impactAt);
    // Self bounce-away (flaming-foot hop) at takeoff if the step asks for it.
    if (step.hop) this.controller.hop(step.hop);

    const facing = this.facing();
    this.abilities.cast(kitAbility("kickCombo", "slam", 0xff6020, lungeDur * impactAt), {
      onImpact: () => {
        if (!this.character) return;
        const hit = this.character.root.position.clone().addScaledVector(dir, reach * 0.6);
        // Stage-specific fire VFX flavour (cosmetic; numeric tuning is config-driven).
        if (stage === 0) {
          hit.y += 1.2;
          this.vfx.burst(hit, 0xffe0a0, 22, 4.5);
          this.vfx.impact(hit, 0xffcc70, 1.6);
        } else if (!last) {
          hit.y += 0.7;
          this.vfx.legFlame(hit);
          this.vfx.burst(hit, 0xff6820, 28, 5);
          this.vfx.impact(hit, 0xff8030, 1.9);
        } else {
          hit.y += 1.0;
          this.vfx.legFlame(hit);
          this.vfx.coneFlame(hit, facing);
          this.vfx.burst(hit, 0xff5010, 40, 7);
          this.vfx.impact(hit, 0xff6020, 2.4);
          this.vfx.impactExplode(hit, this.kickChi ? "chi" : "fire");
        }
        // Damage + knockback from config; `lift` pops the struck target upward.
        this.sparringBlast(hit, step.radius, step.damage, this.params.skillForce * step.force);
        this.hitBags(hit, step.radius, this.params.skillForce * step.force, step.damage);
        if (step.lift) this.targets.launch(hit, step.radius, 0, step.lift);
        if (picked) this.controller?.faceToward(dir, 0.25);
      },
    });
    return dur;
  }

  /** Per-sig cooldown for the active kick character (falls back to the Striker baseline). */
  private kickSigCd(i: number): number {
    return getCharacter(this.characterId).kick?.skills[i]?.cooldown ?? STRIKER_SIG_CD[i];
  }

  /** True when the active kick character uses the electric "chi" VFX theme (Tera-kasi). */
  private get kickChi(): boolean {
    return getCharacter(this.characterId).kick?.fx === "chi";
  }

  /**
   * Dispatcher for all four Striker signature skills. Each has its own cooldown
   * so they can be used independently; `idx 0` is also the F-key action.
   */
  private doKickSig(idx: number): boolean {
    if (idx < 0 || idx > 3) return false;
    if (this.sigCooldowns[idx] > 0) return false;
    switch (idx) {
      case 0: return this.doKickSig0();
      case 1: return this.doKickSig1();
      case 2: return this.doKickSig2();
      case 3: return this.doKickSig3();
      default: return false;
    }
  }

  /** Sig 0 — Flanchet Shot: quick bolt-kick toward the aimed target. */
  private doKickSig0(): boolean {
    if (!this.character || !this.controller) return false;
    const clip = "Flanchet Shot";
    if (this.character.hasClip(clip)) this.character.playClipOnce(clip, 0.1);
    else if (this.character.hasRole("attack")) this.character.playRoleOnce("attack", 0.1);
    const fwd = this.facing();
    const origin = this.character.root.position.clone();
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.character.root.rotation.y, 0));
    // Short lunge + bolt VFX for the "shooting kick" feel.
    const cfg = this.assistConfig();
    const picked = this.pickTargetInFront(origin, fwd, cfg.acqRange, cfg.minDot);
    const dir = this.steerToward(fwd, origin, picked, cfg.steer);
    this.controller.faceToward(dir, 0.18);
    this.controller.dash(dir, Math.min(1.8, cfg.maxReach), 0.25, 0.8, 0.45);
    this.vfx.playSkill("bolt", origin, fwd, quat);
    if (this.kickChi) this.vfx.lightning(origin.clone().add(new THREE.Vector3(0, 1.0, 0)), 1.1);
    this.sigCooldowns[0] = this.kickSigCd(0);
    this.sigCooldownMaxes[0] = this.kickSigCd(0);
    this.stamina = Math.max(0, this.stamina - STRIKER_SIG_ST[0]);
    return true;
  }

  /**
   * Sig 1 — Launch Kick: a high rising kick that launches the target upward,
   * followed by a snap-back procedural backflip with afterimage blur.
   */
  private doKickSig1(): boolean {
    if (!this.character || !this.controller) return false;
    const origin = this.character.root.position.clone();
    const cfg = this.assistConfig();
    const aim = this.controller.forward();
    const picked = this.pickTargetInFront(origin, aim, cfg.acqRange, cfg.minDot);
    const dir = this.steerToward(aim, origin, picked, cfg.steer);
    this.controller.faceToward(dir, 0.20);

    let dur = 0;
    if (this.character.hasClip("Have a Taste")) dur = this.character.playClipOnce("Have a Taste", 0.1);
    else if (this.character.hasRole("attack")) dur = this.character.playRoleOnce("attack", 0.1);

    const reach = picked
      ? THREE.MathUtils.clamp(picked.dist - 0.8, 0.5, cfg.maxReach)
      : Math.min(2.4, cfg.maxReach);
    const lungeDur = THREE.MathUtils.clamp(dur > 0 ? dur * 0.45 : 0.38, 0.22, 0.52);

    // Lunge into the target with no bounce (body stays put for the backflip).
    this.controller.dash(dir, reach, lungeDur, 0, 0.42);

    const color = SKILL_COLOR["slam"];
    this.vfx.dashStreak(origin, origin.clone().addScaledVector(dir, reach), color);

    this.abilities.cast(kitAbility("kickLaunch", "slam", color, lungeDur * 0.42), {
      onImpact: () => {
        if (!this.character || !this.controller) return;
        const hit = this.character.root.position.clone().addScaledVector(dir, reach * 0.5);
        hit.y += 1.4; // high kick
        this.vfx.legFlame(hit);
        this.vfx.burst(hit, 0xff9030, 32, 6);
        this.vfx.impact(hit, 0xff7020, 2.2);
        if (this.kickChi) this.vfx.lightning(hit, 1.3);
        // Upward launch force on targets.
        this.sparringBlast(hit, 2.2, 38, this.params.skillForce * 1.4);
        // Snap the body back with an afterimage blur (procedural backflip).
        const backDir = dir.clone().negate();
        this.vfx.afterimage(this.character.root, this.character.root.position.clone(), backDir, 2.0, 0xff9040, 5, 0.42);
        this.controller.dash(backDir, 1.6, 0.24, 0, 1.0);
      },
    });

    this.sigCooldowns[1] = this.kickSigCd(1);
    this.sigCooldownMaxes[1] = this.kickSigCd(1);
    this.stamina = Math.max(0, this.stamina - STRIKER_SIG_ST[1]);
    return true;
  }

  /**
   * Sig 2 — Flame Tornado: spin with a flaming leg, then fire a wide flame-slash
   * at the crosshair target. From the ground the body launches upward first;
   * from hover (or while already airborne) the spin fires immediately without a
   * re-launch, so skills 1/2/3 are all usable during hover as intended.
   */
  private doKickSig2(): boolean {
    if (!this.character || !this.controller) return false;
    const cs = this.controller.state;
    const hovering = this.controller.isHovering;
    // Usable from ground OR while hovering; blocked during a normal jump arc
    // so the player can't chain-fire it by double-jumping then pressing 3.
    if (!cs.grounded && !hovering) return false;

    let dur = 0;
    if (this.character.hasClip("Diable Jambe")) dur = this.character.playClipOnce("Diable Jambe", 0.1);
    else if (this.character.hasRole("attack")) dur = this.character.playRoleOnce("attack", 0.1);
    void dur; // timing is procedural; clip drives the joint animation

    // Ground activation gets a full upward launch; hover stays airborne.
    if (cs.grounded) {
      this.controller.skyLaunch(this.params.jumpHeight * 0.75);
    }

    // Leg-flame bursts during the rise/spin sell the tornado silhouette.
    const spinDur = hovering ? 0.8 : 1.4; // faster fire when already aloft
    for (let i = 0; i < 5; i++) {
      this.abilities.cast(kitAbility("kickTornadoFlame", "slash", 0xff6020, i * (spinDur / 5)), {
        onImpact: () => {
          if (!this.character) return;
          const pos = this.character.root.position.clone();
          pos.y += 0.6;
          this.vfx.legFlame(pos);
          this.vfx.burst(pos, 0xff6020, 8, 2.5);
        },
      });
    }

    // At the apex/spin-end, fire the flame-slash toward the soft-aimed target.
    // Use the crosshair ray + soft-aim acquisition (same pipeline as combat) so
    // the projectile tracks the aimed enemy rather than flying off-axis.
    this.abilities.cast(kitAbility("kickTornadoFire", "slash", 0xff6020, spinDur), {
      onImpact: () => {
        if (!this.character) return;
        const fireOrigin = this.character.root.position.clone();
        fireOrigin.y += 1.1;
        // Soft-aim: try to resolve a crosshair target, fall back to camera ray.
        const ray = this.crosshairRay();
        const softCos = 0.82; // ~35 deg cone — generous lock-on
        const target = this.targets.raycast(ray, 20, softCos);
        let fireDir: THREE.Vector3;
        if (target) {
          // Aim at the resolved target's centre.
          fireDir = target.position.clone().sub(fireOrigin).normalize();
        } else {
          // No target in cone — fly along camera ray direction.
          fireDir = ray.direction.clone().normalize();
        }
        this.vfx.flameSlash(fireOrigin, fireDir, (hitPos) => {
          this.vfx.burst(hitPos, 0xff5010, 40, 7);
          this.vfx.shockwave(new THREE.Vector3(hitPos.x, 0.05, hitPos.z), 0xff6020, 3.5, 0.6);
          if (this.kickChi) this.vfx.lightning(hitPos.clone().add(new THREE.Vector3(0, 0.8, 0)), 1.4);
          this.sparringBlast(hitPos, 3.0, 50, this.params.skillForce * 1.5);
        });
        this.vfx.coneFlame(fireOrigin, fireDir);
      },
    });

    this.sigCooldowns[2] = this.kickSigCd(2);
    this.sigCooldownMaxes[2] = this.kickSigCd(2);
    this.stamina = Math.max(0, this.stamina - STRIKER_SIG_ST[2]);
    return true;
  }

  /**
   * Sig 3 — Hover: hop backward ~1.5 m, then levitate ~2 m above the floor for
   * ~2.2 seconds. During hover the player keeps one mid-air jump (to exit) and
   * can still fire sigs 0-2. Landing triggers the roll-out recovery.
   */
  private doKickSig3(): boolean {
    if (!this.character || !this.controller) return false;
    const backDir = this.facing().negate();
    // Quick backward hop before the levitation begins.
    this.controller.dash(backDir, 1.5, 0.22, 0, 1.0);
    this.abilities.cast(kitAbility("kickHover", "slam", 0xff9030, 0.22), {
      onImpact: () => {
        if (!this.controller || this.disposed) return;
        this.controller.startHover(2.0, 2.2);
        if (this.character) {
          const pos = this.character.root.position.clone();
          pos.y += 0.3;
          this.vfx.burst(pos, 0xff9030, 20, 4);
          this.vfx.shockwave(new THREE.Vector3(pos.x, 0.05, pos.z), 0xff6020, 2.0, 0.45);
          if (this.kickChi) this.vfx.lightning(pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 1.2);
        }
      },
    });
    this.sigCooldowns[3] = this.kickSigCd(3);
    this.sigCooldownMaxes[3] = this.kickSigCd(3);
    this.stamina = Math.max(0, this.stamina - STRIKER_SIG_ST[3]);
    return true;
  }

  /**
   * Load a kick-style character's extra FBX clips and inject them into the rig's
   * action map under synthetic `striker:*` names, keyed off `CharacterDef.kickClips`
   * (Tera-kasi pulls the reserved flip_kick.fbx as its combo opener). Characters
   * without `kickClips` (the Striker) stay native-only and skip this entirely. Runs
   * after the GLB is committed; falls back gracefully if any clip fails to load.
   */
  private async loadKickClips(id: string) {
    const char = this.character;
    if (!char || this.disposed) return;
    const def = getCharacter(id);
    const clips = def.kickClips;
    if (!clips || clips.length === 0) return;
    const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
    const loader = new FBXLoader();
    await Promise.all(
      clips.map(async ({ name, file }) => {
        try {
          const group = await loader.loadAsync(assetUrl(file));
          const clip = group.animations[0];
          if (clip && char === this.character && !this.disposed) {
            // Character has no public addClip — escape to any so FBX clip
            // registration still works at runtime while keeping other code typed.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this.character as unknown as any).addClip?.(name, clip);
          }
        } catch {
          // Clip missing or FBX failed — fallback GLB clips are used instead.
        }
      }),
    );
  }

  /**
   * Striker's foot-fighting move: face the best target in view, play the REAL
   * attack/skill clip (joint motion), lunge the body in along an eased spline,
   * land the hit at the strike point, then spring back like a ninja (bounce).
   * No canned/forced animation — the clip drives the body. Returns clip length.
   */
  private doKickLunge(opts: {
    clip?: string;
    damage: number;
    force: number;
    radius: number;
    kind?: SkillKind;
  }): number {
    if (!this.character || !this.controller) return 0;
    const origin = this.character.root.position.clone();
    // Aim down the camera, but steer the lunge toward a target using the
    // character's direction-assist (cone width + snap blend).
    const cfg = this.assistConfig();
    const aim = this.controller.forward();
    const picked = this.pickTargetInFront(origin, aim, cfg.acqRange, cfg.minDot);
    const dir = this.steerToward(aim, origin, picked, cfg.steer);

    // Real clip drives the joints; fall back to the attack role if it's missing.
    let dur = 0;
    if (opts.clip && this.character.hasClip(opts.clip)) dur = this.character.playClipOnce(opts.clip, 0.1);
    else if (this.character.hasRole("attack")) dur = this.character.playRoleOnce("attack", 0.1);

    // Reach toward the target (stop just short), else a short committed step.
    // Dash rating scales how far the lunge commits (cfg.maxReach).
    const reach = picked
      ? THREE.MathUtils.clamp(picked.dist - 0.9, 0.4, cfg.maxReach)
      : Math.min(2.2, cfg.maxReach);
    // Lunge timed to the clip so spline + joint motion stay in lockstep.
    const lungeDur = THREE.MathUtils.clamp(dur > 0 ? dur * 0.55 : 0.4, 0.26, 0.6);
    const impactAt = 0.45;
    const bounce = reach * 0.78; // spring most of the way back -> ninja recoil
    this.controller.dash(dir, reach, lungeDur, bounce, impactAt);

    const strike = origin.clone().addScaledVector(dir, reach);
    const color = opts.kind ? SKILL_COLOR[opts.kind] : 0xffe6a8;
    this.vfx.dashStreak(origin, strike, color);

    this.abilities.cast(kitAbility("kickLunge", opts.kind ?? "slam", color, lungeDur * impactAt), {
      onImpact: () => {
        const hit = strike.clone();
        hit.y += 1.0;
        if (opts.kind) {
          // Signature flavor (bolt shot / slam shock / arc) layered on the kick.
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(dir.x, dir.z), 0));
          const skillOrigin = this.character ? this.character.root.position.clone() : strike.clone();
          this.vfx.playSkill(opts.kind, skillOrigin, dir, q);
        }
        this.vfx.burst(hit, 0xfff0c6, 26, 5);
        this.vfx.shockwave(new THREE.Vector3(hit.x, 0.05, hit.z), color, opts.radius, 0.42);
        this.targets.blast(hit, opts.radius, opts.damage, opts.force);
      },
    });
    return dur;
  }

  /**
   * Resolve the active character's attack-assist tuning into concrete steering
   * numbers. `directionAssist` (0-100) widens the acquisition cone and the snap
   * blend toward a target; `dashRating` (0-100) scales how far a strike lunges
   * (50 = the editor's Dash Distance, 100 = double).
   */
  /**
   * The current character's baseline move-speed multiplier — the value any
   * transient speed change (expose slow, phantom buff) must restore TO, not a
   * bare `1`. The Tank/Centurion is permanently slow, so resetting to 1 would
   * silently strip its identity after a recovery window.
   */
  private baseSpeedMul(): number {
    return getCharacter(this.characterId).tank?.moveSpeedMul ?? 1;
  }

  private assistConfig() {
    const def = getCharacter(this.characterId);
    const assist = THREE.MathUtils.clamp(def.directionAssist ?? 50, 0, 100) / 100;
    const dash = THREE.MathUtils.clamp(def.dashRating ?? 50, 0, 100) / 100;
    return {
      // 0 -> no steer (pure camera aim); 1 -> snap onto the target. Scaled live by
      // the editor's Attack Steer knob so auto-aim strength is tunable at runtime.
      steer: THREE.MathUtils.clamp(assist * this.params.attackSteer, 0, 1),
      // 0 -> narrow ~32deg cone; 1 -> wide 90deg cone (never acquires behind).
      minDot: THREE.MathUtils.lerp(0.85, 0.0, assist),
      // Acquisition reach grows a little with assist.
      acqRange: (this.params.dashDistance + 2.5) * (0.6 + 0.8 * assist),
      // 0.5 rating -> 1x Dash Distance; 1.0 -> 2x.
      maxReach: Math.max(1.2, this.params.dashDistance * dash * 2),
    };
  }

  /** Steer `base` toward the picked target by the assist blend (in place safe). */
  private steerToward(
    base: THREE.Vector3,
    origin: THREE.Vector3,
    picked: { position: THREE.Vector3 } | null,
    steer: number,
  ): THREE.Vector3 {
    const dir = base.clone();
    if (picked && steer > 0) {
      const to = picked.position.clone().sub(origin);
      to.y = 0;
      if (to.lengthSq() > 1e-4) dir.lerp(to.normalize(), steer).normalize();
    }
    return dir;
  }

  /**
   * Soulbinder "Hot Hands": a chained fire spell-combo on the F key. Each press
   * within the window advances an escalating 3-stage chain — an ember fireball, a
   * flame dragon, then a meteor finisher that LAUNCHES the target — all locked
   * onto the aimed/selected hostile and resolving with growing knockback force.
   * The casting hand blazes (`hotHands`) on every cast. Gated by its own combo
   * lock + stamina (not the shared skillCooldown), so the chain reads as a fluid
   * channel. Tuning is the pure `fireComboStep`; this only orchestrates it.
   */
  private doFireCombo(): boolean {
    if (!this.character || !this.controller) return false;
    if (this.fireComboLock > 0 || this.recoverLock > 0) return false;
    if (this.stamina < 12) return false;

    const stage = this.fireComboTimer > 0 ? this.fireComboIndex : 0;
    const step = fireComboStep(stage);
    const color = SKILL_COLOR.fireDragon;
    const origin = this.character.root.position.clone();
    const fwd = this.facing();

    // @target: pickTargetInFront prefers the Tab-selected red hostile, else the
    // nearest in the forward cone.
    const picked = this.pickTargetInFront(origin, fwd, 24, -0.2);
    const aimDir = picked
      ? picked.position.clone().sub(origin).setY(0).normalize()
      : fwd;
    if (picked) this.controller.faceToward(aimDir, 0.25);

    // Cast clip (no-ops on rigs lacking it) + the blazing casting hand.
    const dur = this.character.hasClip("magicAttack")
      ? this.character.playClipOnce("magicAttack", 0.12)
      : 0;
    const pose = this.colliderPose();
    const from = pose ? pose.pos.clone() : origin.clone().setY(origin.y + 1.3);
    this.vfx.hotHands(from, color, step.handScale);

    // The point the spell flies toward: a predictive lead on a moving locked
    // target (clamped so a juke still beats it), else a point ahead. Facing
    // tracks the target's CURRENT position above; only the impact point leads.
    let to: THREE.Vector3;
    if (picked) {
      const led = leadTarget(from, picked.position, picked.velocity, FIRE_PROJ_SPEED, {
        maxLeadFraction: PROJ_LEAD_FRACTION,
      });
      to = new THREE.Vector3(led.x, picked.position.y + 1.0, led.z);
    } else {
      to = origin.clone().addScaledVector(aimDir, 12).setY(origin.y + 1.0);
    }

    // Resolve one impact: AoE blast VFX + escalating knockback force, plus a
    // vertical launch on the finisher.
    const resolve = (p: THREE.Vector3) => {
      this.vfx.aoeBlast(p, color, step.radius);
      this.sparringBlast(p, step.radius, step.damage, this.params.skillForce * step.forceMul);
      if (step.launch > 0) this.targets.launch(p, step.radius, 0, step.launch);
    };

    // Data-driven path: the spell VFX launch routes through the orchestrator
    // (shared lifecycle + cancelAll teardown), mirroring the caster F-skill.
    // The projectile arc + impact resolution are owned by the Vfx subsystem (the
    // `resolve` onHit callback), so the cast is instant (duration 0) and `onCast`
    // fires synchronously inside `cast()` — identical to the inline launch.
    const fireKind: SkillKind = stage === 2 ? "meteor" : "fireDragon";
    this.abilities.cast(vfxSkill(fireKind, color, { target: "aimed" }), {
      onCast: () => {
        if (stage === 0) {
          this.vfx.castDragonAt(from, to, color, resolve);
        } else if (stage === 1) {
          this.vfx.flameCone(from, aimDir, color, 4);
          this.vfx.castDragonAt(from, to, color, resolve);
        } else {
          this.vfx.coneFlame(from, aimDir);
          this.vfx.castMeteor(from, aimDir, color, resolve, to);
        }
      },
    });

    // Advance the chain. The finisher resets it and imposes a longer recovery
    // lock so the whole combo can't be re-fired instantly.
    this.stamina = Math.max(0, this.stamina - 12);
    if (step.finisher) {
      this.fireComboIndex = 0;
      this.fireComboTimer = 0;
      this.fireComboLock = dur > 0 ? Math.max(dur, 0.9) : 0.9;
    } else {
      this.fireComboIndex = stage + 1;
      this.fireComboTimer = (dur > 0 ? dur : 0.5) + COMBO_WINDOW;
      this.fireComboLock = dur > 0 ? dur * COMBO_PLAYTHROUGH : 0.3;
    }
    return true;
  }

  /** Nearest living target within `maxDist` and inside the forward cone (dot >= minDot). */
  private pickTargetInFront(
    origin: THREE.Vector3,
    fwd: THREE.Vector3,
    maxDist: number,
    minDot: number,
  ): { position: THREE.Vector3; dist: number; velocity: THREE.Vector3 } | null {
    // Honor the Tab-selected hostile (red target) first: an offensive ability
    // locks onto it even if it's outside the aim cone or another enemy is nearer,
    // as long as it's within the ability's acquisition range. Cone/nearest below
    // is the fallback only when no red target is selected or it's out of range.
    // `selectedHostilePoint` is a bare point (no handle), so its velocity is
    // unknown → zero (no lead); the cone/nearest branch carries the real velocity.
    const sel = this.targets.selectedHostilePoint?.() ?? null;
    if (sel) {
      const to = sel.clone().sub(origin);
      to.y = 0;
      const d = to.length();
      if (preferSelectedHostile(d, maxDist)) return { position: sel, dist: d, velocity: new THREE.Vector3() };
    }
    const cands = this.targets.nearest(origin, 6);
    for (const h of cands) {
      const to = h.position.clone().sub(origin);
      to.y = 0;
      const d = to.length();
      if (d < 1e-3 || d > maxDist) continue;
      to.normalize();
      if (to.dot(fwd) >= minDot) return { position: h.position.clone(), dist: d, velocity: h.velocity.clone() };
    }
    return null;
  }

  /**
   * Skyfall special: leap up with a twist-flip + taunt, then at the apex summon
   * energy ABOVE the player that arcs up and rains down onto nearby targets.
   * Castable from the ground OR mid-air (the "2nd jump" launch).
   */
  skyfall() {
    if (!this.character || !this.controller) return;
    if (this.skyfallCooldown > 0 || this.skyfallPending) return;
    this.skyfallCooldown = 3.5;
    this.skyfallPending = true;
    this.skyfallPendingTimer = 1.5;
    // Twist-flip launch straight up; the taunt clip (when the rig has one) plays
    // over the rising flip so the body taunts and flips at the same time.
    this.controller.skyLaunch(this.params.jumpHeight * 1.5);
    const taunt = this.character.clipNames().find((n) => /taunt|cheer|victory|provoke|flex|wave|dance/i.test(n));
    if (taunt) this.character.playClipOnce(taunt, 0.12);
    // Charge flare around the player as the leap begins.
    const center = this.character.root.position.clone();
    center.y += 1.1;
    this.vfx.burst(center, 0xd8b8ff, 40, this.params.aoeRadius * 2);
  }

  private fireSkyfall() {
    const player = this.character.root.position.clone();
    // Energy gathers in a node ABOVE the player's head, then bolts spring up from
    // it, arc higher, and dive onto each target (rise -> fall, per the reference).
    const source = player.clone();
    source.y += 5.2;
    this.vfx.aoeBlast(source, 0xb98cff, this.params.aoeRadius * 1.2);
    this.vfx.burst(source, 0xd8b8ff, 56, this.params.aoeRadius * 2);
    const bolts = Math.max(1, Math.round(this.params.skyfallBolts));
    const targets = this.targets.nearest(player, bolts);
    for (let i = 0; i < bolts; i++) {
      const tgt = targets[i];
      let to: THREE.Vector3;
      if (tgt) {
        to = tgt.position.clone();
      } else {
        // No target — strike a random nearby ground point.
        const ang = Math.random() * Math.PI * 2;
        const r = 2 + Math.random() * 6;
        to = new THREE.Vector3(player.x + Math.cos(ang) * r, 0.5, player.z + Math.sin(ang) * r);
        to.x = THREE.MathUtils.clamp(to.x, -14, 14);
        to.z = THREE.MathUtils.clamp(to.z, -14, 14);
      }
      const from = source.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1, (Math.random() - 0.5) * 1.5));
      const rise = 4 + Math.random() * 3;
      this.schedule(i * 0.08, () => {
        this.vfx.skyfallStrike(from, to, 0xb98cff, rise, (p) => {
          this.vfx.aoeBlast(p, 0xb98cff, this.params.aoeRadius * 1.4);
          this.vfx.burst(p, 0xd8b8ff, 64, this.params.aoeRadius * 2.2);
          this.sparringBlast(p, this.params.aoeRadius * 1.15, 60, this.params.skillForce);
        });
      });
    }
  }

  /** Run `fn` after `delay` seconds (driven by the main loop). */
  private schedule(delay: number, fn: () => void) {
    this.pending.push({ t: delay, fn });
  }

  private updatePending(dt: number) {
    if (this.pending.length === 0) return;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) {
        this.pending.splice(i, 1);
        p.fn();
      }
    }
  }

  private facing(): THREE.Vector3 {
    const y = this.character.root.rotation.y;
    return new THREE.Vector3(Math.sin(y), 0, Math.cos(y)).normalize();
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    // Container is hidden/zero-sized (e.g. behind a full-screen panel): skip so we
    // don't allocate a 0×0 buffer or divide by zero on the aspect.
    if (w === 0 || h === 0) return;
    // Re-apply DPR every resize: it changes when the window moves between displays
    // or the user zooms, and a stale ratio renders blurry or oversized.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Underwater ambience while sinking through the dungeon's water band: ease a
   * 0..1 factor toward 1 in water / 0 out, then lerp the scene fog + background
   * from the base dark tone toward a murky blue and thicken the fog so the
   * descent reads as a real underwater section. A slow rising bubble stream is
   * emitted around the player while submerged. Everything clears smoothly on
   * exit above or below the band (and is snapped to base when leaving the dungeon).
   */
  private updateWaterFx(dt: number, inWater: boolean) {
    const target = inWater ? 1 : 0;
    // ~0.4s ease either direction so the tint fades rather than snaps.
    this.waterFx += (target - this.waterFx) * Math.min(1, dt * 6);
    if (this.waterFx < 0.001) this.waterFx = 0;
    const k = this.waterFx;
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      fog.color.copy(this.baseFogColor).lerp(this.waterFogColor, k);
      fog.near = THREE.MathUtils.lerp(this.baseFogNear, Studio.FOG_WATER_NEAR, k);
      fog.far = THREE.MathUtils.lerp(this.baseFogFar, Studio.FOG_WATER_FAR, k);
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.baseBgColor).lerp(this.waterFogColor, k);
    }
    // Rising bubbles around the player while genuinely submerged.
    if (inWater && this.character) {
      this.bubbleAccum += dt;
      const interval = 0.16;
      while (this.bubbleAccum >= interval) {
        this.bubbleAccum -= interval;
        this.vfx.bubbles(this.character.root.position);
      }
    } else {
      this.bubbleAccum = 0;
    }
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update();
    const raw = Math.min(this.timer.getDelta(), 0.05);
    // One global time-scale slows (or restores) the whole simulation: physics,
    // animation, combat timers and scheduled hits all run off this scaled delta.
    // The A.L.E. Bot layers its own slow-mo beat on top during highlights so the
    // user's manual time-scale slider stays independent.
    const dt = raw * this.timeScale * this.ale.timeScale();
    const t = this.timer.getElapsed();
    // FPS tracks the real frame rate, independent of the simulation time-scale.
    this.fps += (1 / Math.max(raw, 0.0001) - this.fps) * 0.1;

    // ── Instant replay ──
    // While an instant replay is playing, live combat is frozen: the A.L.E. Bot
    // re-poses the recorded fighters in slow-mo and drives the camera, fully
    // decoupled from the duel/AI/physics, then we render & resume below.
    if (this.ale.isReplaying) {
      const rdt = raw * this.timeScale;
      const views = this.targets instanceof Targets ? this.targets.fighterViews() : [];
      this.ale.updateReplay(rdt, views);
      this.ale.applyCamera(this.camera);
      this.renderer.render(this.scene, this.camera);
      this.hudAccum += rdt;
      if (this.hudAccum >= 0.1) {
        this.hudAccum = 0;
        this.pushHud();
      }
      return;
    }

    // ── Play-test loading gate ──
    // Until every readiness item is satisfied (and shaders pre-warmed), gameplay
    // — input, AI, combat, physics — stays frozen. We still animate + render the
    // backdrop (room ambience, DJ booth) so the loading screen has a live scene
    // behind it, but no simulation runs and no dt is consumed by gameplay.
    if (this.gated && !this.ready) {
      this.room.update(t, this.sfx?.getMusicPulse()?.intensity ?? 0);
      this.djBooth?.update(dt, this.sfx?.getMusicPulse() ?? null);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.room.update(t, this.sfx?.getMusicPulse()?.intensity ?? 0);
    this.djBooth?.update(dt, this.sfx?.getMusicPulse() ?? null);
    // Overhead cast stones follow caster while aiming / after release flash
    this.castRunes.update(dt, this.character?.root.position ?? null, {
      channeling: this.castCtrl.isActive(),
      intensity: this.castCtrl.isActive() ? 0.6 : 0,
    });
    // Door portal prompt: lit only in the Danger Room while standing at the arch.
    this.doorPrompt =
      !this.inDungeon &&
      !this.enteringDungeon &&
      !this.inArena &&
      this.character != null &&
      this.room.nearDoor(this.character.root.position);
    if (this.controller && this.character) {
      // Release a keyboard-held block if pointer lock was lost (the Ctrl key-up
      // can be swallowed when focus leaves the canvas mid-guard).
      if (this.blocking && !this.blockViaTouch && !this.input.locked) this.endBlock();
      // Track the live enemy each frame; release the stance if the target dies.
      if (this.locked) {
        const lp = this.targets.lockPoint();
        if (lp) this.controller.setLockTarget(lp);
        else {
          this.locked = false;
          this.controller.setLockTarget(null);
        }
        this.controller.setSoftTarget(null);
      } else if (this.softLockEnabled) {
        // Always-on soft-lock: keep the nearest (or Tab-selected) enemy as the
        // gentle aim-assist anchor. acquireNearest keeps the current pick while
        // it's a living enemy, so Tab's choice sticks until it dies.
        this.controller.setSoftTarget(this.targets.acquireNearest(this.character.root.position));
      } else {
        this.controller.setSoftTarget(null);
      }
      // Shared aim feel: decay recoil and feed the live offset to the camera,
      // ease the sprint FOV kick, and size the crosshair spread — all before the
      // controller positions the camera this frame.
      this.recoil.update(dt);
      this.controller.setAimOffset(this.recoil.pitch, this.recoil.yaw);
      const spd = this.controller.state.speed;
      const sprinting = spd > this.params.moveSpeed * 1.1 && this.controller.state.grounded;
      this.fovKickCur = fovKick(this.fovKickCur, 0, 8, sprinting, dt);
      this.controller.setFovKick(this.fovKickCur);
      this.aimSpread = 5 + Math.min(spd, 8) * 1.5 + this.recoil.bloom * 200;
      this.controller.update(dt);
      // The Controller mutates cameraDistance directly on wheel-zoom (shared
      // params object); persist it (debounced) so zoom level survives reloads.
      if (this.params.cameraDistance !== this.lastSavedCamDist) this.queueControlsSave();
      // Dodge-roll input is stance-gated for a clear action/combat-mode split:
      //  • RMB held (combat stance) → a single A / D tap rolls (lateral dodge).
      //  • free movement            → A / D strafe; DOUBLE-tap rolls.
      // Drain every queue each frame so stale taps can't carry across the stance.
      const pressA = this.input.consumePress("KeyA");
      const pressD = this.input.consumePress("KeyD");
      const dblA = this.input.consumeDoubleTap("KeyA");
      const dblD = this.input.consumeDoubleTap("KeyD");
      const rollLeft = this.blocking ? pressA : dblA;
      const rollRight = this.blocking ? pressD : dblD;
      if (rollLeft) this.dodgeRoll("L");
      else if (rollRight) this.dodgeRoll("R");
      if (this.controller.consumeDoubleJump()) {
        const p = this.character.root.position.clone();
        p.y += 0.4;
        // Staffs: the double-jump becomes a ~2s levitation float (WASD-steerable,
        // gravity suspended) instead of an air-lunge — a caster's hover from which
        // LMB rains element bolts. The hover height tracks the current apex.
        if (this.isStaffEquipped()) {
          this.vfx.burst(p, this.staffColor(), 18, 3);
          const apex = Math.max(2.2, this.character.root.position.y + 1.0);
          this.controller.startHover(apex, STAFF_FLOAT_SECONDS);
        } else {
          this.vfx.burst(p, 0x9fe8ff, 16, 3);
          // Deterministic air-lunge toward the crosshair target (vertical arc kept).
          const weaponless = !!getCharacter(this.characterId).weaponless;
          const combat = weaponCombat(weaponless ? "none" : this.weaponId);
          const target = this.pickCrosshairTarget(combat);
          if (target) {
            const { dir, dist } = this.toTargetPlanar(target);
            if (dist > 0.6) {
              const close = THREE.MathUtils.clamp(dist - combat.range[0], 0.6, this.params.dashDistance * 1.4);
              this.controller.dash(dir, close, 0.4, 0, 0.9);
              this.controller.faceToward(dir, 0.25);
            }
          }
        }
      }
      // Slam touchdown: detonate the ground explosion + force wave. This takes
      // priority over (and suppresses) the generic landing flair below.
      const didSlam = this.controller.consumeSlamLanded();
      if (didSlam) {
        this.slamPending = false;
        this.doSlamImpact();
      }
      // Landing: Striker does a roll-out recovery after a double-jump or hover;
      // other characters (and grounded Striker jumps) get the generic shockwave.
      const didLand = this.controller.consumeLanded();
      const didRollLand = this.controller.consumeRollLanding();
      const rdef = getCharacter(this.characterId);
      if (didSlam) {
        // Ground blast already fired above; skip the generic land flair.
      } else if (didRollLand && rdef.meleeStyle === "kick") {
        // Roll-out recovery: themed fire flash + a procedural body roll (this rig
        // has no native roll clip, so the controller's tumble sells the recovery).
        const p = this.character.root.position.clone();
        this.vfx.shockwave(p, 0xffaa50, 1.6, 0.38);
        this.vfx.burst(p.clone().add(new THREE.Vector3(0, 0.15, 0)), 0xffc060, 16, 3);
        if (rdef.kick && !this.controller.isBusy) {
          this.controller.rollOut(this.controller.forward(), 0.55);
          this.vfx.flame(p, rdef.kick.palette.ember, 18, 3);
        }
      } else if (didLand) {
        const p = this.character.root.position.clone();
        this.vfx.shockwave(p, 0xbcd2ff, 1.8, 0.4);
        this.vfx.burst(p.clone().add(new THREE.Vector3(0, 0.1, 0)), 0xdfe9ff, 14, 2.5);
        // Striker: roll out of a hard or double-jump landing to absorb the impact.
        const ldef = getCharacter(this.characterId);
        if (ldef.meleeStyle === "kick" && ldef.kick && !this.controller.isBusy) {
          const info = this.controller.landingInfo;
          const hard = info.speed > Math.sqrt(2 * this.params.gravity * this.params.jumpHeight) * 1.15;
          if (info.doubled || hard) {
            this.controller.rollOut(this.controller.forward(), 0.55);
            this.vfx.flame(p, ldef.kick.palette.ember, 18, 3);
          }
        }
      }
      // Aerial-spin finisher: fire a flame-slash projectile toward the crosshair.
      if (this.controller.consumeSpinEnd() && this.spinSkill) {
        const { skill, pal } = this.spinSkill;
        this.spinSkill = null;
        const start = this.character.root.position.clone();
        start.y += 0.6;
        const target = this.pickCrosshairTarget(weaponCombat("none"));
        let dir: THREE.Vector3;
        let range = 16;
        if (target) {
          const to = target.position.clone().sub(start);
          dir = to.clone().normalize();
          range = THREE.MathUtils.clamp(to.length() + 2, 4, 20);
        } else {
          dir = this.crosshairRay().direction.clone();
        }
        this.vfx.flameSlashProjectile(start, dir, pal.flame, pal.ember, 24, range, (p) => {
          this.vfx.flameCone(p, dir, pal.flame, skill.radius + 1);
          this.sparringBlast(p, skill.radius, skill.damage, this.params.skillForce * skill.force);
        });
      }
      // Per-frame fire while the Striker is spinning or hovering.
      const fdef = getCharacter(this.characterId);
      // Keep the flame palette in sync with the active character (fire vs chi).
      const desiredTheme = fdef.kick?.fx === "chi" ? "chi" : "fire";
      if (desiredTheme !== this.fireThemeApplied) {
        this.vfx.setFireTheme(desiredTheme);
        this.fireThemeApplied = desiredTheme;
      }
      if (fdef.kick && (this.controller.spinning || this.controller.hovering)) {
        const pal = fdef.kick.palette;
        const fp = this.character.root.position.clone();
        const spin = this.controller.spinning;
        fp.y += spin ? 1.1 : 0.3;
        this.vfx.flame(fp, spin ? pal.flame : pal.ember, spin ? 6 : 3, 2);
        // GPU trailing flame around the spinning/hovering body.
        this.vfx.flameTrailPoint(fp);
      }
      // Looping leg-flame jets beneath the Striker's feet while hovering, so the
      // power state reads as sustained thrust. Throttled to keep particle counts
      // sane, and the accumulator resets the moment hover ends/jumps out so it
      // fires immediately on the next hover.
      if (this.controller.isHovering) {
        this.hoverFlameAccum += dt;
        const HOVER_FLAME_INTERVAL = 0.1;
        while (this.hoverFlameAccum >= HOVER_FLAME_INTERVAL) {
          this.hoverFlameAccum -= HOVER_FLAME_INTERVAL;
          const base = this.character.root.position;
          const yaw = this.character.root.rotation.y;
          const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
          for (const s of [-0.22, 0.22]) {
            const foot = base.clone().addScaledVector(side, s);
            foot.y += 0.1;
            this.vfx.legFlame(foot);
          }
        }
      } else {
        this.hoverFlameAccum = 0;
      }
      if (this.skyfallPending) {
        this.skyfallPendingTimer -= dt;
        // Barrage at the apex, or fail-safe if the apex is never reported (so the
        // pending flag can never deadlock future casts).
        if (this.controller.consumeApex() || this.skyfallPendingTimer <= 0) {
          this.skyfallPending = false;
          this.fireSkyfall();
        }
      }
      // Fail-safe: clear a stuck slam flag if the touchdown is never reported, so
      // the next airborne attack can never deadlock.
      if (this.slamPending) {
        this.slamPendingTimer -= dt;
        if (this.slamPendingTimer <= 0) {
          this.slamPending = false;
          this.controller.cancelSlam();
        }
      }
      // Fail-safe for the aerial dagger overhead: if its scheduled end-of-clip slash
      // never fires (e.g. character swapped mid-swing), clear the flag so the next
      // airborne dagger attack can't deadlock.
      if (this.aerialSlashPending) {
        this.aerialSlashPendingTimer -= dt;
        if (this.aerialSlashPendingTimer <= 0) this.aerialSlashPending = false;
      }
    }
    this.character?.update(dt);
    // Spine aim IK AFTER mixer + foot plant (needs live camera + weapon stance).
    if (this.character && this.controller) {
      const gun =
        this.weaponId === "pistol" ||
        this.weaponId === "rifle" ||
        this.weaponId === "hunter-rifle" ||
        this.weaponId === "gunblade" ||
        this.weaponId === "bow" ||
        this.blocking;
      this.character.applySpineAim?.(this.camera, {
        firstPerson: this.controller.isFirstPerson,
        gunEngaged: gun,
        pitch: this.controller.aimElevation(),
      });
    }
    // Step real physics + slave the punching-bag visuals to their bodies.
    this.physics?.step(dt);
    this.bags?.sync(dt, this.camera);
    // Drive the sparring opponents with the live player position + damage hooks.
    if (this.character) {
      this.sparCtx.playerPos.copy(this.character.root.position);
      this.sparCtx.playerPos.y += 1.0;
      // Reuse the swim traversal clips + underwater ambience while descending
      // through the dungeon's water band; switch back to ground locomotion and
      // ease the tint out above/below it.
      let inWater = false;
      if (this.inDungeon && this.dungeon) {
        const y = this.character.root.position.y;
        const band = { top: this.dungeon.waterTop, bottom: this.dungeon.waterBottom };
        inWater = isInWaterBand(y, band);
        this.character.setTraversalMode?.(traversalModeFor(y, band));
      }
      this.updateWaterFx(dt, inWater);
    }
    this.sparCtx.playerAlive = !this.defeated && this.invuln <= 0;
    // Offense-fail lockout = the player just whiffed/got blocked; opponents read
    // this as a punish window.
    this.sparCtx.playerRecovering = this.recoverLock > 0;
    if (this.duel?.isActive) {
      // Spectator view: the player is hidden + out of the fight, so the duelling
      // AI must never target the player. Advance the duel before the AI tick so
      // any phase change (spawn / difficulty release) lands this frame.
      this.sparCtx.playerAlive = false;
      this.duel.update(dt);
    }
    this.targets.update(dt, this.sparCtx);
    // Wildlife AI + corpses (additive; independent of combat Targets).
    if (this.wildlife && this.character) {
      this.wildlife.update(dt, this.character.root.position);
    }
    // Dungeon obstacle traps (spikes / gears / bombs from mobile pack).
    if (this.inDungeon && this.dungeonHazards) {
      this.dungeonHazards.update(dt, this.character?.root.position ?? null);
    }
    // Skillwrite cast aim ring + Flame Body trail.
    this.updateCastAim(dt);
    if (this.flameBodyT > 0 && this.character) {
      this.flameBodyT = Math.max(0, this.flameBodyT - dt);
      this.vfx.flameBodyPulse(this.character.root.position, 0xff6a1e);
    }
    if (this.frostBlinkWindow > 0) {
      this.frostBlinkWindow = Math.max(0, this.frostBlinkWindow - dt);
    }
    // A.L.E. Bot polls fighter state AFTER the AI tick so it reads this frame's
    // outcomes (cameras, highlights, diagnostics, telemetry).
    if (this.duel?.isActive && this.targets instanceof Targets) {
      this.ale.update(dt, this.targets.fighterViews(), this.duel.state());
    }
    this.arena?.update(dt, this.camera);
    if (this.character) this.status.update(dt, this.character.root.position);
    this.indicators.set(this.targets.indicatorSnapshot?.(this.character?.root.position) ?? []);
    this.indicators.setOverhead(this.targets.selectedHostileHead?.() ?? null);
    this.indicators.update(dt);
    this.telegraphs.update(dt);
    this.updatePending(dt);
    // Advance data-driven abilities here (same `dt`, adjacent to updatePending)
    // so their cast/impact phases land on the same frame as the legacy schedule.
    this.abilities.update(dt);
    // Advance the Flanged-Mace throw flight (stun on impact, catch on return,
    // fail-safe recall) and reposition the in-flight mace.
    this.updateMaceThrow(dt);
    // Advance the exo-armour transformation + sync the mech to the player.
    this.updateMech(dt);
    // Swell/settle the background music from the live combat state.
    this.updateMusicIntensity(dt);

    // Player combat timers: hurt vignette, invulnerability.
    if (this.hurt > 0) this.hurt = Math.max(0, this.hurt - dt);
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    if (this.pistolDodgeCd > 0) this.pistolDodgeCd = Math.max(0, this.pistolDodgeCd - dt);
    if (this.dodgeCd > 0) this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    if (this.respectWindow > 0) this.respectWindow = Math.max(0, this.respectWindow - dt);

    // Single combat authority: tick the player CC and read CC-authoritative
    // health/stamina back so gating code (skill cost checks, etc.) stays in sync.
    this.sparring.update(dt);
    // In pvp the server owns the player's HP (read back from snapshots); only
    // mirror the local CC health in solo/coop. Stamina stays CC-authoritative.
    if (this.net?.mode !== "pvp") this.health = this.sparring.getPlayerHealth();
    this.stamina = this.sparring.getPlayerStamina();

    // Combat flash: countdown and clear when expired.
    if (this.combatFlashTimer > 0) {
      this.combatFlashTimer = Math.max(0, this.combatFlashTimer - dt);
      if (this.combatFlashTimer === 0) this.combatFlash = "";
    }

    // Clean blade-trail ribbon swept along the blade while swinging (grip → tip).
    // A thin additive streak instead of the bloomy GPU flame trail (that stays
    // reserved for flame-themed skills).
    if (this.swingTimer > 0 && this.mounted?.tip) {
      this.swingTimer -= dt;
      const tipPos = new THREE.Vector3();
      this.mounted.tip.getWorldPosition(tipPos);
      const basePos = new THREE.Vector3();
      (this.mounted.tip.parent ?? this.character!.root).getWorldPosition(basePos);
      this.vfx.bladeTrailSegment(basePos, tipPos, this.swingColor);
    }

    if (this.skillCooldown > 0) this.skillCooldown = Math.max(0, this.skillCooldown - dt);
    if (this.staffBoltCd > 0) this.staffBoltCd = Math.max(0, this.staffBoltCd - dt);
    this.mechReconciler.tickCooldown(dt);
    for (let i = 0; i < this.mechCds.length; i++) {
      if (this.mechCds[i] > 0) this.mechCds[i] = Math.max(0, this.mechCds[i] - dt);
    }
    if (this.skyfallCooldown > 0) this.skyfallCooldown = Math.max(0, this.skyfallCooldown - dt);
    if (this.comboLock > 0) this.comboLock = Math.max(0, this.comboLock - dt);
    if (this.recoverLock > 0) this.recoverLock = Math.max(0, this.recoverLock - dt);
    // Swept-edge blade sweep for the active swing: continuous blade-vs-enemy
    // shield/weapon/body detection while the swing window is open.
    if (this.bladeWindow > 0) {
      this.bladeWindow = Math.max(0, this.bladeWindow - dt);
      this.updateBlade();
      if (this.bladeWindow === 0) this.blade.endSwing();
    }
    if (this.kickCd > 0) this.kickCd = Math.max(0, this.kickCd - dt);
    if (this.throwCd > 0) this.throwCd = Math.max(0, this.throwCd - dt);
    if (this.potionCd > 0) this.potionCd = Math.max(0, this.potionCd - dt);
    if (this.comboTimer > 0) {
      this.comboTimer = Math.max(0, this.comboTimer - dt);
      if (this.comboTimer === 0) this.comboIndex = 0;
    }
    // Striker kick combo timers.
    if (this.kickComboLock > 0) this.kickComboLock = Math.max(0, this.kickComboLock - dt);
    if (this.kickComboTimer > 0) {
      this.kickComboTimer = Math.max(0, this.kickComboTimer - dt);
      if (this.kickComboTimer === 0) this.kickComboIndex = 0;
    }
    // Soulbinder "Hot Hands" fire-combo timers.
    if (this.fireComboLock > 0) this.fireComboLock = Math.max(0, this.fireComboLock - dt);
    if (this.fireComboTimer > 0) {
      this.fireComboTimer = Math.max(0, this.fireComboTimer - dt);
      if (this.fireComboTimer === 0) this.fireComboIndex = 0;
    }
    // Per-signature-skill cooldowns (Striker + Kiter).
    for (let i = 0; i < 4; i++) {
      if (this.sigCooldowns[i] > 0) this.sigCooldowns[i] = Math.max(0, this.sigCooldowns[i] - dt);
    }
    // Kiter Smoke Phantom: restore visibility + normal speed when the buff ends.
    if (this.phantomTimer > 0) {
      this.phantomTimer = Math.max(0, this.phantomTimer - dt);
      if (this.phantomTimer === 0) {
        // While suited up the pilot is hidden and the mech owns the speed
        // multiplier — let the mech keep ownership instead of clobbering it.
        this.mechReconciler.restorePilotIfMechInactive();
      }
    }
    // Stamina is read from the CC each frame (see getPlayerStamina below the loop);
    // do NOT regen it locally — the CombatController handles regen internally.

    this.vfx.update(dt);
    // Network snapshot cadence must stay real-time so slow-mo (a local tuning
    // tool) never throttles outbound multiplayer reports — drive it off `raw`.
    this.updateNet(raw);
    // A.L.E. director camera overrides the player camera last (when active) so a
    // duel can be watched from a selected POV/drone view without touching the
    // player Controller.
    this.ale.applyCamera(this.camera);
    this.renderer.render(this.scene, this.camera);

    this.hudAccum += dt;
    if (this.hudAccum >= 0.1) {
      this.hudAccum = 0;
      this.pushHud();
    }
  };

  private pushHud() {
    const weaponless = !!getCharacter(this.characterId).weaponless;
    const def = getCharacter(this.characterId);
    const w = getWeapon(weaponless ? "none" : this.weaponId);
    const cs = this.controller?.state;
    const isKick = def.meleeStyle === "kick";
    // Kiter (Gunslinger) also drives per-slot signature cooldowns on slots 1-4.
    // The Flanged Mace drives its own slot-4 throw cooldown the same way.
    const perSig =
      isKick || (!!def.kiter && this.weaponId === "pistol") || this.weaponId === "mace";
    // Project the Tab-locked enemy's head to screen pixels for the floating frame.
    let selectedTarget: HudSnapshot["selectedTarget"] = null;
    const tv = this.targets.selectedView();
    if (tv) {
      const ndc = tv.head.clone().project(this.camera);
      // Require the point to be in front of the camera AND within the frustum;
      // a bare `z <= 1` lets behind-camera points (which still map to on-screen
      // x/y) draw a ghost frame.
      if (ndc.z >= -1 && ndc.z <= 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1) {
        const el = this.renderer.domElement;
        const w = el.clientWidth || el.width;
        const h = el.clientHeight || el.height;
        // Kick a one-off portrait render for this enemy type (cached per key,
        // so re-locking the same kind never re-renders).
        const portrait = this.targets.selectedPortrait?.() ?? null;
        if (portrait) requestTargetPortrait(portrait.key, portrait.object);
        selectedTarget = {
          id: tv.id,
          x: (ndc.x * 0.5 + 0.5) * w,
          y: (-ndc.y * 0.5 + 0.5) * h,
          health: tv.health,
          maxHealth: tv.maxHealth,
          name: tv.name,
          portraitKey: portrait?.key ?? null,
        };
      }
    }
    // Project the Shift+Tab-selected ally's head for its (green) floating frame.
    let selectedAllyTarget: HudSnapshot["selectedAllyTarget"] = null;
    const av = this.targets.selectedAllyView?.();
    if (av) {
      const ndc = av.head.clone().project(this.camera);
      if (ndc.z >= -1 && ndc.z <= 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1) {
        const el = this.renderer.domElement;
        const w = el.clientWidth || el.width;
        const h = el.clientHeight || el.height;
        selectedAllyTarget = {
          x: (ndc.x * 0.5 + 0.5) * w,
          y: (-ndc.y * 0.5 + 0.5) * h,
          health: av.health,
          maxHealth: av.maxHealth,
          name: av.name,
        };
      }
    }
    // Focused enemy combat readout (HUD bars) from the unified CombatTargets.
    const ecv = this.targets.focusedCombatView(
      this.character?.root.position ?? new THREE.Vector3(),
    );
    // Dungeon zone cue: surface / underwater / pit, derived from the player's Y
    // against the same water band that drives swim mode (see update loop). Null
    // outside the dungeon so the HUD shows no zone label.
    let zone: HudSnapshot["zone"] = null;
    if (this.inDungeon && this.dungeon && this.character) {
      const y = this.character.root.position.y;
      zone =
        y > this.dungeon.waterTop
          ? "surface"
          : y >= this.dungeon.waterBottom
            ? "underwater"
            : "pit";
    }
    // Distinct boss bar: only when the locked hostile is a boss-tier enemy
    // (e.g. Moloch Da God in the pit). Reuses the selectedView read above.
    const boss: HudSnapshot["boss"] = tv?.isBoss
      ? {
          name: tv.name,
          health: Math.round(tv.health),
          maxHealth: tv.maxHealth,
          hint: tv.bossHint ?? "",
        }
      : null;
    // OWR reticle ring + edge SFX: classify the nearest enemy vs the current
    // weapon's optimal band right before the snapshot so the cue stays in sync.
    this.updateOwrRange();
    // The player's own face thumbnail (the user's avatar) for the status
    // frame. Cached per character, so this is a cheap no-op every frame after
    // the first capture; spawnCharacter invalidates it on look changes.
    let playerPortraitKey: string | null = null;
    if (this.character) {
      playerPortraitKey = `player:${this.characterId}`;
      requestTargetPortrait(playerPortraitKey, this.character.root);
    }
    this.onHud({
      character: def.name,
      playerPortraitKey,
      weapon: weaponless ? "none" : this.weaponId,
      weaponLabel: weaponless ? "Black Leg" : w.label,
      skillName: weaponless ? "Diable Jambe" : w.skillName,
      health: this.health,
      maxHealth: this.maxHealth,
      stamina: Math.round(this.stamina),
      maxStamina: this.maxStamina,
      poise: Math.round(this.sparring.getPlayerPoise()),
      maxPoise: this.sparring.getPlayerMaxPoise(),
      combatState: this.sparring.getPlayerState(),
      critWindow: this.sparring.getPlayerCritWindow(),
      combatFlash: this.combatFlash,
      enemyHealth: ecv ? Math.round(ecv.health) : 0,
      enemyMaxHealth: ecv?.maxHealth ?? 0,
      enemyStamina: ecv ? Math.round(ecv.stamina) : 0,
      enemyMaxStamina: ecv?.maxStamina ?? 0,
      enemyPoise: ecv ? Math.round(ecv.poise) : 0,
      enemyMaxPoise: ecv?.maxPoise ?? 0,
      enemyCritWindow: ecv?.critWindow ?? 0,
      enemyCombatState: ecv?.state ?? "idle",
      // For the kick fighter the F-slot fires sig 0 (Flanchet Shot) and its
      // cooldown is tracked in sigCooldowns[0], not the shared skillCooldown.
      skillReady: isKick ? this.sigCooldowns[0] <= 0 : this.skillCooldown <= 0,
      skillCooldown: isKick ? this.sigCooldowns[0] : this.skillCooldown,
      skillCooldownMax: isKick ? this.sigCooldownMaxes[0] : this.skillCooldownMax,
      skyfallCooldown: this.skyfallCooldown,
      skyfallCooldownMax: 3.5,
      // Striker + Kiter expose per-skill cooldowns for each sig slot.
      sigCooldowns: perSig ? [...this.sigCooldowns] : [0, 0, 0, 0],
      sigCooldownMaxes: perSig ? [...this.sigCooldownMaxes] : [0, 0, 0, 0],
      hovering: this.controller?.isHovering ?? false,
      locked: this.input.locked,
      firstPerson: this.viewMode === "first",
      aimSpread: this.aimSpread,
      owrRange: this.owrRangeState,
      hitMarker: this.hitMarkerCount,
      grounded: cs?.grounded ?? true,
      jumpsLeft: cs?.jumpsLeft ?? 2,
      speed: cs ? Math.round(cs.speed * 100) / 100 : 0,
      fps: Math.round(this.fps),
      targetsAlive: this.targets.aliveCount,
      difficulty: this.difficulty,
      blocking: this.blocking,
      hurt: this.hurt,
      defeated: this.defeated,
      selectedTarget,
      selectedAllyTarget,
      zone,
      boss,
      clip: this.character?.currentClipName() ?? "",
      slots: this.getSlotBindings(),
      statuses: this.status.views(),
      prompt: this.doorPrompt
        ? "Hit E to Enter"
        : this.inDungeon
          ? "Hit E to Leave"
          : null,
      inDungeon: this.inDungeon,
      mech: this.mech.isPiloted
        ? {
            abilities: MECH_ABILITIES.map((a, i) => ({
              key: a.key,
              name: a.name,
              icon: a.icon,
              cd: this.mechCds[i],
              cdMax: a.cd,
            })),
          }
        : null,
      duel: this.duelState(),
      ale: this.ale.snapshot(),
    });
  }

  /** Select the A.L.E. duel camera ("off" hands the view back to the player). */
  setDuelCamera(mode: AleCameraMode): void {
    this.ale.setCameraMode(mode);
  }

  /** Toggle the A.L.E. diagnostics lens (colliders + markers). Returns new state. */
  toggleDuelDiagnostics(on?: boolean): boolean {
    return this.ale.toggleDiagnostics(on);
  }

  /** Play an instant replay of the last seconds of recorded fight footage. */
  startReplay(): boolean {
    return this.ale.startReplay();
  }

  /** Pause/resume the active replay's playhead (scrub controls). */
  setReplayPaused(paused: boolean): void {
    this.ale.setReplayPaused(paused);
  }

  /** Toggle pause on the active replay; returns the new paused state. */
  toggleReplayPaused(): boolean {
    return this.ale.toggleReplayPaused();
  }

  /** Set the active replay's playback rate (1 = recorded real-time). */
  setReplaySpeed(speed: number): void {
    this.ale.setReplaySpeed(speed);
  }

  /** Scrub the active replay's playhead to a 0..1 position in the window. */
  seekReplay(progress: number): void {
    this.ale.seekReplay(progress);
  }

  /** Cut to a different camera while a replay is playing. */
  setReplayCamera(mode: AleCameraMode): void {
    this.ale.setReplayCamera(mode);
  }

  /** End the active replay early, restoring live poses + camera. */
  stopReplay(): void {
    this.ale.stopReplay();
  }

  /** Choose how often KOs/highlights auto-trigger an instant replay. */
  setReplayFrequency(freq: ReplayFrequency): void {
    this.ale.setReplayFrequency(freq);
  }

  // ---- Dungeon Mode ---------------------------------------------------------

  /**
   * Door-portal interaction (bound to E by App). While inside the dungeon this
   * leaves it; in the Danger Room it enters only when the player stands at the
   * arch. Returns true when the key was consumed (so App skips the editor panel).
   */
  tryEnterDoor(): boolean {
    if (this.inArena) return false;
    if (this.inDungeon) {
      this.exitDungeon();
      return true;
    }
    if (this.enteringDungeon) return true;
    if (this.character && this.room.nearDoor(this.character.root.position)) {
      void this.enterDungeon();
      return true;
    }
    return false;
  }

  /** Load + mount the dungeon level and swap to its enemy population. */
  private async enterDungeon() {
    if (this.inDungeon || this.enteringDungeon || !this.character) return;
    // A duel owns the Danger Room population + the spectator view; tear it down
    // before swapping to the dungeon so the player re-enters as a live fighter.
    this.stopDuel();
    this.cancelMaceThrow();
    this.enteringDungeon = true;
    this.doorPrompt = false;

    let dungeon: Dungeon | null = null;
    try {
      const dmap = DUNGEON_MAPS[loadDungeonMap()];
      dungeon = new Dungeon(this.scene, { file: dmap.file, scale: dmap.scale });
      await dungeon.load();
      if (this.disposed) {
        dungeon.dispose();
        return;
      }

      // Hide the Danger Room + stash its sparring population (kept alive to restore).
      this.room.group.visible = false;
      if (this.targets instanceof Targets) {
        this.dangerTargets = this.targets;
        this.dangerTargets.group.visible = false;
      }

      // Swap to the dungeon population (same CombatTargets surface). The pit
      // navmesh + spawn drive the sealed end-game brute pack + Moloch Da God.
      const enemies = new DungeonEnemies(this.scene, dungeon.nav, dungeon.spawn, {
        nav: dungeon.pitNav,
        spawn: dungeon.pitSpawn,
      });
      enemies.onDeath = (p) => {
        this.vfx.burst(p, 0xff7a8a, 40, 6);
        this.vfx.shockwave(new THREE.Vector3(p.x, p.y + 0.05, p.z), 0xff5a6a, 3, 0.6);
      };
      enemies.onProjectileImpact = (p) => this.vfx.impact(p, 0xffe27a, 1.2);
      enemies.setDifficulty(this.difficulty);
      this.targets = enemies;
      this.wireTargetCombatHooks();

      this.dungeon = dungeon;
      this.inDungeon = true;
      this.locked = false;
      this.controller?.setLockTarget(null);

      // Seed mobile-obstacle traps on surface + pit (deterministic seed from map id).
      this.dungeonHazards?.dispose();
      const trapSeed =
        (dmap.id ?? "default")
          .split("")
          .reduce((a, ch) => a + ch.charCodeAt(0), 0) ^ 0x6f627374; // "obst"
      const hazards = new DungeonHazards(this.scene, trapSeed);
      hazards.setDamageHandler((amount, at, label) => {
        if (this.defeated || this.invuln > 0) return;
        this.health = Math.max(0, this.health - amount);
        this.vfx.burst(at, 0xff5522, 18, 4);
        this.vfx.shockwave(new THREE.Vector3(at.x, at.y + 0.05, at.z), 0xff7744, 1.6, 0.35);
        if (this.health <= 0) this.defeated = true;
        console.info(`[DungeonHazards] hit by ${label} dmg=${amount}`);
      });
      hazards.setBombHandler((at) => {
        this.vfx.burst(at, 0xffaa22, 48, 8);
        this.vfx.shockwave(new THREE.Vector3(at.x, at.y + 0.05, at.z), 0xff6600, 4, 0.7);
      });
      void hazards.seed(dungeon.nav, dungeon.spawn, dungeon.pitNav, dungeon.pitSpawn);
      this.dungeonHazards = hazards;

      // The dungeon keeps its own dark dry tone regardless of the room preset, so
      // reset the fog baseline (the water-band fx lerps from this) to the base.
      this.baseFogColor.set(Studio.FOG_BASE_COLOR);
      this.baseFogNear = Studio.FOG_BASE_NEAR;
      this.baseFogFar = Studio.FOG_BASE_FAR;
      this.baseBgColor.set(Studio.FOG_BASE_COLOR);
      this.writeBaselineFog();

      // Fresh start + hand the Controller the dungeon collision + camera occluders.
      this.health = this.maxHealth;
      this.stamina = this.maxStamina;
      this.defeated = false;
      this.controller?.setCollision(dungeon.collision, dungeon.spawn);
      this.controller?.setCameraOccluders(dungeon.occluders);
      // The player sinks (rather than plummets) while inside the water band on
      // the descent from the surface map down to the pit.
      this.controller?.setWaterBand(dungeon.waterTop, dungeon.waterBottom);
      // Foot-to-ground IK: the dungeon has real uneven terrain, so plant feet on
      // the navmesh floor (height + slope normal). Off in the flat Danger Room.
      this.dungeonGround = makeNavGroundSampler(dungeon.nav);
      this.character?.setGroundSampler?.(this.dungeonGround);
      this.character?.setFootIk?.(true);
      // Wildlife A* on the same surface nav as dungeon enemies.
      this.wildlife?.setNav(dungeon.nav);
    } catch (err) {
      console.error("[Studio] dungeon load failed", err);
      dungeon?.dispose();
      // Roll back any partial swap so the Danger Room stays usable.
      if (!this.inDungeon) {
        this.dungeon = null;
        this.room.group.visible = true;
        if (this.dangerTargets) {
          this.dangerTargets.group.visible = true;
          this.targets = this.dangerTargets;
          this.dangerTargets = null;
        }
      }
    } finally {
      this.enteringDungeon = false;
    }
  }

  /** Tear down the dungeon and restore the Danger Room. */
  private exitDungeon() {
    if (!this.inDungeon) return;
    this.cancelMaceThrow();
    this.targets.dispose();
    this.dungeonHazards?.dispose();
    this.dungeonHazards = null;
    this.dungeon?.dispose();
    this.dungeon = null;
    // Back to flat Danger Room — wildlife wander without grid.
    this.wildlife?.setNav(null);
    this.inDungeon = false;
    this.locked = false;
    this.controller?.setLockTarget(null);

    // Restore the Danger Room zone (see DANGER_ROOM_ZONE in dungeon/water.ts):
    // null collision = room-bound clamp + Y=0 floor, no occluders, no water band,
    // ground traversal, and the sparring population re-shown below.
    this.controller?.setCollision(null);
    this.controller?.setCameraOccluders([]);
    this.controller?.clearWaterBand();
    this.character?.setTraversalMode?.("ground");
    // Back on the flat Danger Room floor: flat ground sampler, foot IK stays on.
    this.dungeonGround = null;
    this.character?.setGroundSampler?.((x, z) => ({ y: 0, normal: new THREE.Vector3(0, 1, 0) }));
    this.character?.setFootIk?.(true);
    // Snap the underwater tint/fog back to the Danger Room baseline immediately.
    // Adopt the active room preset's atmosphere (not the bare base) so the room
    // returns to its own mood, and re-tune the ambient bed to match.
    this.waterFx = 0;
    this.bubbleAccum = 0;
    this.applyRoomAtmosphere(true);
    this.applyRoomAmbience();
    this.room.group.visible = true;

    const danger = this.dangerTargets ?? new Targets(this.scene);
    danger.group.visible = true;
    danger.onDeath = (p) => {
      this.vfx.burst(p, 0xff7a8a, 40, 6);
      this.vfx.shockwave(new THREE.Vector3(p.x, 0.05, p.z), 0xff5a6a, 3, 0.6);
    };
    this.targets = danger;
    this.wireTargetCombatHooks();
    this.dangerTargets = null;

    // Drop the player back just inside the arena, healed.
    this.character?.root.position.set(0, 0, 4);
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.defeated = false;
  }

  /**
   * Load a serialized {@link VoxelMap} into the live Danger Room and drop the
   * authored combatants into the existing sparring population so the player can
   * actually play the map they built. The Danger Room floor/atmosphere stays
   * visible (the map sits on it); blocks/heavy bags become solid colliders,
   * physics bags react to hits, NPCs spawn armed + difficulty-scaled, and the
   * player spawns at the start marker. Exiting disposes the whole Studio.
   */
  async enterArena(map: VoxelMap): Promise<void> {
    if (this.inArena || this.enteringArena || this.disposed) return;
    this.enteringArena = true;
    this.doorPrompt = false;

    let arena: VoxelArena | null = null;
    try {
      arena = new VoxelArena(this.scene);
      await arena.load(map);
      if (this.disposed) {
        arena.dispose();
        return;
      }

      this.arena = arena;
      this.inArena = true;
      this.locked = false;
      this.controller?.setLockTarget(null);
      // Terrain/voxel map is built and committed to the scene.
      this.markReady("arena");

      // Spawn the authored NPCs (and their AI brains, built synchronously by
      // Targets.spawnAt) into the existing Danger Room population.
      if (this.targets instanceof Targets) {
        const t = this.targets;
        t.setBounds(arena.bounds);
        for (const npc of arena.npcs) {
          t.spawnAt(npc.pos, npc.weapon, "enemy", {
            scale: npc.scale,
            maxHealth: npc.maxHealth,
            damageMul: npc.damageMul,
          });
        }
      }
      // Opponents + their AI brains are in. (No-op when the gate has no npc item.)
      this.markReady("npcs");

      // Fresh start + hand the Controller the arena collision + camera occluders.
      this.health = this.maxHealth;
      this.stamina = this.maxStamina;
      this.defeated = false;
      this.controller?.setCollision(arena.collision, arena.spawn);
      this.controller?.setCameraOccluders(arena.occluders);
    } catch (err) {
      console.error("[Studio] arena load failed", err);
      arena?.dispose();
      if (!this.inArena) this.arena = null;
      this.markFailed("arena", "Arena failed to load.");
    } finally {
      this.enteringArena = false;
    }
  }

  // ---- Touch / on-screen control API (driven by the React TouchControls) ----

  /** Toggle touch mode (suppresses pointer-lock-on-tap). */
  setTouchMode(on: boolean) {
    this.touchMode = on;
    if (on) this.input.exitLock();
    else {
      // Leaving touch mode: drop any held virtual input.
      this.input.setMove(0, 0);
      this.input.lookActive = false;
      this.input.touchSprint = false;
    }
  }

  /** Analog joystick movement (x = strafe, y = forward), each -1..1. */
  touchMoveInput(x: number, y: number) {
    this.input.setMove(x, y);
  }

  /** Look-pad drag delta (screen px); call touchLookEnd when the finger lifts. */
  touchLook(dx: number, dy: number) {
    this.input.lookActive = true;
    this.input.addLook(dx, dy);
  }
  touchLookEnd() {
    this.input.lookActive = false;
  }

  setTouchSprint(on: boolean) {
    this.input.touchSprint = on;
  }

  touchJump() {
    this.controller?.jump();
  }
  touchAttack() {
    this.attack();
  }
  /** F-skill when index is omitted, else signature skill 0-3. */
  touchSkill(index?: number) {
    this.useSkill(index);
  }
  touchSkyfall() {
    this.skyfall();
  }

  /**
   * Apply (or refresh) a status effect: spawns its aura + notifier chip. The
   * cast is routed by kind — friendly buffs follow the Shift+Tab-selected ally
   * (green), offensive debuffs follow the Tab-locked hostile (red), and anything
   * unrouted (no valid target) lands on the player.
   *
   * When `aoe` is set, a friendly buff instead splashes onto every ally within
   * {@link FRIENDLY_AOE_RADIUS} of the selected ally (or the caster when none is
   * selected) — each affected ally wears its own aura, mirroring boss AOE splash.
   */
  applyStatus(id: StatusId, aoe = false) {
    // Data-driven path (proof migration): a buff/debuff is an instant, status-only
    // ability. The orchestrator runs cast → release → impact → status synchronously
    // (no wind-up, no travel), firing the scope-routed application below — identical
    // to the previous direct call, but expressed through the shared lifecycle.
    const def = statusAbility(id, STATUS_DEFS[id]?.kind, aoe);
    const scope = def.status?.scope ?? "self";
    this.abilities.cast(def, { onStatus: () => this.applyStatusScoped(id, scope) });
  }

  /**
   * Apply a status by scope, mirroring the historical {@link applyStatus}
   * routing exactly: ally buffs follow the Shift+Tab ally (AOE splashes onto
   * every ally in {@link FRIENDLY_AOE_RADIUS}), hostile debuffs follow the
   * Tab-locked enemy, and anything with no valid target lands on the caster.
   */
  private applyStatusScoped(id: StatusId, scope: StatusScope) {
    const selectedAlly = this.targets.selectedAllyGroup?.() ?? null;
    const center = selectedAlly ? selectedAlly.position : this.character?.root.position;
    const aoeAllies =
      scope === "aoeAlly" && center
        ? this.targets.alliesInRadius?.(center, FRIENDLY_AOE_RADIUS) ?? []
        : [];
    const routing = routeStatusScope(scope, {
      aoeAllies,
      selectedAlly,
      selectedHostile: this.targets.selectedHostileGroup?.() ?? null,
    });
    dispatchStatusRouting(
      routing,
      (g) => g.position,
      {
        apply: (anchor) => this.status.apply(id, anchor),
        applyAll: (anchors) => this.status.applyAll(id, anchors),
      },
    );
  }
  clearStatuses() {
    this.status.clearAll();
  }

  /** Tab: cycle the locked-on enemy (red outline + floating health frame). */
  cycleTarget() {
    this.targets.cycleSelection();
  }

  /** Shift+Tab: rotate the selected ally (green outline + floating frame). */
  cycleAllyTarget() {
    this.targets.cycleAllySelection?.();
  }

  /** KeyB: toggle first/third-person framing (mirrored so swaps keep the mode). */
  toggleView() {
    this.viewMode = this.viewMode === "first" ? "third" : "first";
    this.controller?.setViewMode(this.viewMode);
  }

  /** Wire keyboard skill/jump shortcuts that need engine-side actions. */
  handleKey(code: string) {
    if (code === "Space") {
      // Ctrl+Space (block held) = air block: a hop with the guard kept up.
      if (this.blocking) this.airBlock();
      else this.controller?.jump();
    }
    else if (code === "ControlLeft" || code === "ControlRight") this.startBlock();
    else if (code === "KeyR") this.doHeavyAttack();
    else if (code === "KeyF") this.useSkill();
    else if (code === "KeyQ") {
      // Heroes of Grudge cycle their 2-weapon loadout on Q; every other
      // character keeps Q as the parry.
      if (!this.cycleLoadout()) this.sparring.parry();
    }
    else if (code === "KeyX") {
      // Dodge-roll: direction from camera forward (or back-step if no dir key held).
      const dir = this.controller ? this.controller.forward().clone() : new THREE.Vector3(0, 0, 1);
      this.sparring.dodge({ x: dir.x, z: dir.z });
      // "dodge" is not an AnimRole — fall back to hurt (a quick flinch-step).
      if (this.character?.hasRole("hurt")) this.character.playRoleOnce("hurt", 0.08);
    }
    else if (code === "KeyG") this.evade();
    // KeyM = suit up into / exit the Exo-Armour Mech.
    else if (code === "KeyM") this.toggleMech();
    // KeyZ = straight stab: a dash into an extended main-hand thrust, blade
    // classes only (sword + knife); no-ops otherwise. KeyT's motion-attack moved
    // to the middle mouse button (M3); see onMouseDown.
    else if (code === "KeyZ") this.stab();
    // KeyT = Stomp finisher: a leaping execution that only fires when a
    // knocked-down (fallen) enemy is within reach; no-ops otherwise.
    else if (code === "KeyT") this.stomp();
    else if (code === "KeyV") this.utilityKick();
    // KeyH = throw a bomb (quick-draw overhand throw → arcing grenade → AoE blast).
    else if (code === "KeyH") this.throwBomb();
    // KeyJ = drink a heal potion (quick-draw use → restore HP). No-op at full HP.
    else if (code === "KeyJ") this.healPotion();
    else if (code === "KeyC") this.headbutt();
    // KeyN = skin/butcher nearest wildlife corpse (meat + leather; 2 min window).
    else if (code === "KeyN") this.butcherWildlife();
    else if (code === "Escape" && this.castCtrl.isActive()) {
      this.castCtrl.cancel();
      this.castRunes.hide();
    }
    else if (code === "KeyB") this.toggleView();
    else if (code === "Digit1") this.useSkill(0);
    else if (code === "Digit2") this.useSkill(1);
    else if (code === "Digit3") this.useSkill(2);
    else if (code === "Digit4") this.useSkill(3);
  }

  /**
   * Acrobatic evade (KeyQ): an air-dodge when airborne, a corkscrew ground
   * evade otherwise. Mobility only — drives a short {@link Controller.dash}
   * displacement, never any combat. Only procedural rigs ship these clips, so it
   * no-ops on GLB characters (matching the existing dodge behaviour).
   */
  private evade() {
    if (!this.controller || !this.character) return;
    if (this.controller.isBusy) return;
    const airborne = !this.controller.state.grounded;
    const clip = airborne ? "airDodge" : "evadeThreat";
    if (!this.character.hasClip(clip)) return;
    const dir = this.controller.forward();
    this.controller.faceToward(dir, 0.25);
    const dur = this.character.playClipOnce(clip, 0.1);
    const reach = airborne ? 1.6 : 2.4;
    this.controller.dash(dir, reach, dur > 0 ? dur * 0.9 : 0.4, 0, 0.4);
  }

  // ─────────────────────────── Exo-Armour Mech Mode ───────────────────────────

  /**
   * Suit up into (or exit) the rideable exo-armour. The armour assembles around
   * the current fighter, hides the pilot once sealed, and hands control to the
   * mech; pressing again re-opens the armour and releases the pilot. The mech
   * tracks the (hidden) pilot root each frame, so the existing Controller still
   * drives movement — just heavier — while suited.
   */
  toggleMech() {
    if (!this.character || !this.controller) return;
    if (this.spectating || this.defeated) return;
    const action = this.mech.toggle();
    if (action === "enter") this.setCombatFlash("EXO-ARMOUR ONLINE", 1.6);
    else if (action === "exit") this.setCombatFlash("ARMOUR RELEASED", 1.4);
  }

  /**
   * Instantly tear down any active exo-armour and restore the pilot's control
   * state. Used when entering contexts (e.g. duel spectating) that take over the
   * player avatar and must not leave a stray mech in the scene.
   */
  private cancelMech() {
    this.mechReconciler.cancel();
    this.mechCds = [0, 0, 0];
    this.mechWasAirborne = false;
    // No longer piloting: kill any active low-integrity klaxon. (updateMech may
    // not run again before a takeover context's loop early-returns.)
    this.sfx?.setKlaxon(false);
  }

  /**
   * Advance the mech transformation each frame and sync the armour to the player.
   * Hides/restores the pilot mesh per the state machine, and applies (and later
   * restores) a movement-weight speed penalty on the piloted edge.
   */
  private updateMech(dt: number) {
    if (!this.character || !this.controller) return;
    const frame = this.mechReconciler.update(dt);
    const snap = frame.snap;

    // Staged assemble / release feel + heavy-step punctuation.
    if (frame.justOpened) this.onMechAssembleStart();
    if (frame.justSealed) this.onMechSealed();
    if (frame.justReleased) this.onMechRelease();
    if (frame.footstep) this.onMechFootstep(frame.footstep);

    // Heavy landing slam: detect the airborne→grounded edge while piloting.
    if (snap.mechControlled) {
      const grounded = this.controller.isGrounded;
      if (grounded && this.mechWasAirborne) this.onMechLanding();
      this.mechWasAirborne = !grounded;
    } else {
      this.mechWasAirborne = false;
    }

    // Low-integrity warning klaxon: loops while piloting and armour integrity is
    // critically low (<=25%) — the same condition the cockpit's red-alert uses.
    // Stops automatically when integrity recovers or the mech is released. The
    // alarm escalates (faster/higher/louder) as integrity falls from 25% to 0%.
    const integrityFrac = this.maxHealth > 0 ? this.health / this.maxHealth : 0;
    const klaxonOn = this.mech.isPiloted && integrityFrac <= 0.25;
    const klaxonIntensity = Math.max(0, Math.min(1, (0.25 - integrityFrac) / 0.25));
    this.sfx?.setKlaxon(klaxonOn, klaxonIntensity);
  }

  /** Heat the combat-music bed by `amount` (clamped 0..1). Called from combat
   *  events (blows landed/taken, blocks, AoE blasts); decays in the loop. */
  private bumpMusicHeat(amount: number) {
    this.musicHeat = Math.min(1, this.musicHeat + amount);
  }

  /**
   * Drive the background-music swell from the live combat state. The per-event
   * {@link musicHeat} decays between exchanges (~3s falloff) so the bed eases off
   * when idle; an active, non-passive fight (or a running duel) holds a gentle
   * floor so it stays engaged through a lull. Loudness still rides the mixer.
   */
  private updateMusicIntensity(dt: number) {
    const DECAY_PER_SEC = 0.33; // ~3s to fall from a peak hit back to calm
    const COMBAT_FLOOR = 0.3; // baseline while a real fight is underway
    this.musicHeat = Math.max(0, this.musicHeat - dt * DECAY_PER_SEC);
    let target = this.musicHeat;
    const fighting = this.difficulty !== "passive" && this.targets.aliveCount > 0 && !this.defeated;
    if (fighting || this.duel?.isActive) target = Math.max(target, COMBAT_FLOOR);
    this.sfx?.setMusicIntensity(target);
  }

  /** Suit-up start: parts arrive in a ring of sparks + steam, with a servo whoosh. */
  private onMechAssembleStart() {
    if (!this.character) return;
    const p = this.character.root.position;
    const base = new THREE.Vector3(p.x, p.y + 0.1, p.z);
    this.vfx.smokeColumn(base.clone(), 0x9fb0c0, 1.1, 2.4);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const fp = new THREE.Vector3(p.x + Math.cos(a) * 0.7, p.y + 0.1, p.z + Math.sin(a) * 0.7);
      this.vfx.burst(fp, 0xffd58a, 14, 5, { spread: 0.2, sizeScale: 0.8 });
      this.vfx.puff(fp, 0xc8d2dc, 8, 0.9);
    }
    this.sfx?.play("whooshHeavy", base, { volume: 0.8, rate: 0.7 });
  }

  /** Seal-shut: the armour clamps closed — a chest spark blast, smoke pop + shake. */
  private onMechSealed() {
    if (!this.character) return;
    const p = this.character.root.position;
    const chest = new THREE.Vector3(p.x, p.y + 1.7, p.z);
    this.vfx.burst(chest, 0xfff0c0, 26, 7, { spread: 0.5, sizeScale: 1.1 });
    this.vfx.smokePop(chest, 0xffcaa0, 1.4);
    this.vfx.shockwave(new THREE.Vector3(p.x, 0.05, p.z), 0xbfd0e0, 2.4, 0.4);
    this.sfx?.play("heavyHit", chest, { volume: 1 });
    this.controller?.addCameraShake(0.55);
  }

  /** Release: the armour cracks open with a steam hiss + sparks before letting go. */
  private onMechRelease() {
    if (!this.character) return;
    const p = this.character.root.position;
    const mid = new THREE.Vector3(p.x, p.y + 1.4, p.z);
    this.vfx.smokeColumn(new THREE.Vector3(p.x, p.y + 0.2, p.z), 0xaeb8c2, 1.4, 2.0);
    this.vfx.burst(mid, 0xffe2a0, 16, 4.5, { spread: 0.5, sizeScale: 0.9 });
    this.vfx.puff(mid, 0xd8e0e8, 12, 1.2);
    this.sfx?.play("block", mid, { volume: 0.7, rate: 0.6 });
    this.controller?.addCameraShake(0.3);
  }

  /** A heavy foot just planted: a dust puff + ground ring, a thud and a rattle. */
  private onMechFootstep(pos: THREE.Vector3) {
    const foot = new THREE.Vector3(pos.x, Math.max(0.02, pos.y + 0.02), pos.z);
    this.vfx.puff(foot, 0xcdd6df, 14, 1.3);
    this.vfx.shockwave(new THREE.Vector3(foot.x, 0.04, foot.z), 0xc6d2dd, 1.6, 0.32);
    this.sfx?.play("heavyHit", foot, { volume: 0.55, rate: 0.7 });
    this.controller?.addCameraShake(0.22);
  }

  /** A piloted landing: a big dust ring, a ground shockwave, a thud and a hard kick. */
  private onMechLanding() {
    if (!this.character) return;
    const p = this.character.root.position;
    const foot = new THREE.Vector3(p.x, 0.04, p.z);
    this.vfx.puff(new THREE.Vector3(p.x, p.y + 0.05, p.z), 0xccd6e0, 22, 1.8);
    this.vfx.shockwave(foot, 0xbcd0e2, 3.0, 0.45);
    this.vfx.burst(new THREE.Vector3(p.x, p.y + 0.1, p.z), 0xffe0a0, 18, 5, { spread: 0.6 });
    this.sfx?.play("heavyHit", foot, { volume: 0.95, rate: 0.6 });
    this.controller?.addCameraShake(0.6);
  }

  /** Mech basic attack (LMB): a scaled-up forward smash that reuses the impact VFX. */
  private doMechPunch() {
    if (!this.character || !this.controller) return;
    const fwd = this.controller.forward();
    const center = this.character.root.position.clone().add(fwd.clone().multiplyScalar(2.6));
    center.y += 1.5;
    this.vfx.impact(center, 0xffd27a, 2.6);
    this.vfx.shockwave(center, 0xffe7a0, 2.2, 0.32);
    this.targets.blast(center, 2.8, 26, this.params.skillForce * 1.6, this.sparCtx);
    this.controller.dash(fwd, 1.2, 0.26, 0.16, 0.6);
    this.sfx?.play("heavyHit", center, { volume: 0.85 });
    this.controller.addCameraShake(0.3);
  }

  /**
   * Dispatch the mech's bespoke skill kit by the same key index the on-foot bar
   * uses: F (no index) → Seismic Stomp, 1 (index 0) → Plasma Cannon, 2 (index 1)
   * → Grapple Throw. Slots 3/4 fall back to the stomp. Each ability has its own
   * cooldown (`mechCds`); this returns true once the press is consumed so the
   * caller treats it as a handled skill.
   */
  private doMechSkill(signatureIndex?: number): boolean {
    if (!this.character || !this.controller) return false;
    // F → 0 (Stomp); Digit1 → 1 (Cannon); Digit2 → 2 (Grapple). Higher slots reuse Stomp.
    const ability = signatureIndex == null ? 0 : Math.min(signatureIndex + 1, 2);
    if (this.mechCds[ability] > 0) return false;
    switch (ability) {
      case 1:
        this.doMechCannon();
        break;
      case 2:
        this.doMechGrapple();
        break;
      default:
        this.doMechStomp();
        break;
    }
    this.mechCds[ability] = MECH_ABILITIES[ability].cd;
    return true;
  }

  /** Mech ability 0 — Seismic Stomp: a heavy ground-pound that LAUNCHES nearby foes. */
  private doMechStomp() {
    if (!this.character) return;
    const p = this.character.root.position.clone();
    this.vfx.aoeBlast(p, 0xffa64d, 6.0);
    this.vfx.impact(p.clone().setY(p.y + 1.0), 0xfff0c0, 4.0);
    this.vfx.shockwave(new THREE.Vector3(p.x, 0.05, p.z), 0xff8a3a, 6.0, 0.6);
    // A knock-up (not a flat blast) so the stomp reads as a ground-pound.
    this.targets.launch(p, 6.0, 44, 9.6);
    this.setCombatFlash("SEISMIC STOMP!", 1.0);
    this.sfx?.play("heavyHit", p, { volume: 1 });
    this.controller?.addCameraShake(0.7);
  }

  /**
   * Mech ability 1 — Plasma Cannon: a charged forward energy beam. Fires a long
   * additive beam down the mech's facing and blasts whatever it lands on (a
   * picked target at range, else a point straight ahead) for heavy ranged damage.
   */
  private doMechCannon() {
    if (!this.character || !this.controller) return;
    // Fire along the AIMED direction (camera pitch included) so the widened
    // mech pitch range lets the cannon shoot up at fliers / down from ledges.
    const fwd = this.controller.aimForward();
    const origin = this.character.root.position.clone();
    origin.y += 1.6;
    const picked = this.pickTargetInFront(origin, fwd, 28, -0.2);
    const hit = picked?.position ?? origin.clone().addScaledVector(fwd, 16);
    this.vfx.beam(() => origin.clone(), () => fwd.clone(), 0x7fd8ff, 30, 0.55);
    this.vfx.impact(hit.clone().setY(hit.y + 0.6), 0xbfeaff, 3.4);
    this.vfx.shockwave(new THREE.Vector3(hit.x, 0.05, hit.z), 0x7fd8ff, 4.0, 0.45);
    this.targets.blast(hit, 4.0, 60, this.params.skillForce * 2.0, this.sparCtx);
    this.setCombatFlash("PLASMA CANNON!", 0.9);
    this.sfx?.play("heavyHit", hit, { volume: 0.95 });
  }

  /**
   * Mech ability 2 — Grapple Throw: lunge at the foe in front and hurl it. Closes
   * to a target straight ahead, dashes the mech in, then detonates an impact AoE
   * at the grab point that launches the gripped foe and anyone next to it.
   */
  private doMechGrapple() {
    if (!this.character || !this.controller) return;
    const fwd = this.controller.forward();
    const origin = this.character.root.position.clone();
    origin.y += 1.0;
    const picked = this.pickTargetInFront(origin, fwd, 6.5, 0.1);
    const grab = picked?.position ?? origin.clone().addScaledVector(fwd, 3.0);
    // Lunge the mech onto the grab point so the throw reads as a real grapple.
    this.controller.dash(fwd, 2.0, 0.2, 0, 0.6);
    this.vfx.impact(grab.clone().setY(grab.y + 1.2), 0xffcaa0, 3.0);
    this.vfx.shockwave(new THREE.Vector3(grab.x, 0.05, grab.z), 0xffae6a, 4.5, 0.5);
    // Hurl: a strong launch at the grab point throws the foe (and nearby ones) clear.
    this.targets.launch(grab, 3.5, 54, 11.0);
    this.setCombatFlash("GRAPPLE THROW!", 0.9);
    this.sfx?.play("heavyHit", grab, { volume: 1 });
    this.controller.addCameraShake(0.5);
  }

  /**
   * Directional dodge-roll (double-tap A = left, D = right). Plays the real
   * sideways dodge clip on procedural rigs, slides the body along the strafe
   * axis while keeping the body facing forward, spawns a full-mesh "blink"
   * afterimage and grants a brief damage-immunity (i-frame) window. No-ops on
   * GLB rigs (they ship no directional roll clip).
   */
  private dodgeRoll(side: "L" | "R") {
    const ch = this.character;
    if (!this.controller || !ch || this.defeated) return;
    if (this.dodgeCd > 0 || this.controller.isBusy) return;
    if (!ch.hasClip("roll") || !ch.rollDir) return;
    const fwd = this.controller.forward();
    // Screen-right on the floor (matches WASD strafe: D = +right, A = -right).
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();
    const dir = side === "R" ? right : right.negate();
    const origin = ch.root.position.clone();
    const dur = ch.rollDir(side);
    const dashDur = dur > 0 ? THREE.MathUtils.clamp(dur * 0.7, 0.22, 0.5) : 0.34;
    this.controller.dash(dir, 3.0, dashDur, 0, 0.45);
    // Roll sideways while keeping the body facing forward (strafe-roll), so the
    // L/R dodge clip reads correctly instead of diving in the travel direction.
    this.controller.faceToward(fwd, 0);
    // "Blink": a full-mesh afterimage phase plus the i-frame window.
    this.vfx.afterimage(ch.root, origin, dir, 3.0, 0xaee6ff, 5, 0.3);
    this.sfx?.play("somersault", origin.clone().setY(origin.y + 0.8), { volume: 0.7 });
    this.invuln = Math.max(this.invuln, 0.4);
    this.dodgeCd = 0.6;
  }

  /**
   * Motion-math attack (M3 = Attack3; the reserved Attack2 profile is kept for
   * the future KeyZ tactical ability): drives the body along a
   * {@link MotionProfile} ({@link MM_TO_M}-scaled peak/settle) into a real strike
   * resolved through the shared combo-hit path. Steers toward the crosshair
   * target like the LMB combo, so it lands in weapon range regardless of MM.
   */
  private motionAttack(profile: MotionProfile) {
    if (!this.character || !this.controller) return;
    if (this.controller.isBusy || this.recoverLock > 0) return;
    const weaponless = !!getCharacter(this.characterId).weaponless;
    const wid: WeaponId = weaponless ? "none" : this.weaponId;
    const combat = weaponCombat(wid);
    const intensityN = THREE.MathUtils.clamp(combat.intensity, 1, 100) / 100;
    const dirN = THREE.MathUtils.clamp(combat.direction, 0, 100) / 100;
    const [rMin, rMax] = combat.range;
    const origin = this.character.root.position.clone();

    const target = this.pickCrosshairTarget(combat);
    const dir = this.controller.forward();
    if (target) {
      const planar = this.toTargetPlanar(target);
      const steer = THREE.MathUtils.clamp(THREE.MathUtils.lerp(0.3, 1, dirN) * this.params.attackSteer, 0, 1);
      dir.lerp(planar.dir, steer).normalize();
    }
    this.controller.faceToward(dir, 0.2);

    // The real attack clip drives the joints; the motion profile drives the body.
    const primary = this.overrides.primary;
    let clipDur = 0;
    if (primary && this.character.hasClip(primary)) clipDur = this.character.playClipOnce(primary, 0.1);
    else if (this.character.hasRole("attack")) clipDur = this.character.playRoleOnce("attack", 0.1);
    this.swingTimer = clipDur > 0 ? clipDur * 0.45 : 0.2;

    const color = SKILL_COLOR[getWeapon(wid).kind] ?? 0x9fe8ff;
    this.swingColor = color;
    const dashDur = clipDur > 0 ? THREE.MathUtils.clamp(clipDur * 0.7, 0.18, 0.5) : 0.24;
    const peakM = profile.peak * MM_TO_M;
    const settleM = (profile.settle ?? profile.peak) * MM_TO_M;
    this.controller.dash(dir, peakM, dashDur, peakM - settleM, profile.impactAt);
    if (peakM > 0.4) {
      this.vfx.afterimage(this.character.root, origin, dir, Math.max(peakM, 0.6), color, 4, 0.3);
    }
    this.scheduleComboHit(dashDur * profile.impactAt, dir, rMin, rMax, intensityN, color, true, null);
  }

  /**
   * Utility kick (KeyV): an overdriven guard-breaking shove. When it connects
   * with an enemy in front it forces a stagger that bypasses a raised guard
   * (guard-break) and shoves them back with heavy knockback + an impact burst.
   * When nothing is in reach it stays a pure mobility hop (no regression).
   * Procedural rigs only (no-ops on GLB rigs that ship no `utilityKick` clip).
   */
  private utilityKick() {
    if (!this.controller || !this.character) return;
    if (this.controller.isBusy || this.kickCd > 0) return;
    if (!this.character.hasClip("utilityKick")) return;

    // Steer the overdriven lunge toward a target in front so the shove connects.
    const cfg = this.assistConfig();
    const origin = this.character.root.position.clone();
    const aim = this.controller.forward();
    const picked = this.pickTargetInFront(origin, aim, cfg.acqRange, cfg.minDot);
    const dir = this.steerToward(aim, origin, picked, cfg.steer);
    this.controller.faceToward(dir, 0.25);

    const dur = this.character.playClipOnce("utilityKick", 0.1);
    // Overdrive: a longer, snappier lunge that closes onto the target (capped to
    // the assist reach) instead of the old fixed 0.9 m hop.
    const reach = picked
      ? THREE.MathUtils.clamp(picked.dist - 0.6, 0.8, cfg.maxReach)
      : 1.6;
    const lungeDur = dur > 0 ? dur * 0.5 : 0.26;
    const impactAt = 0.5;
    this.controller.dash(dir, reach, lungeDur, 0, impactAt);

    // Resolve the guard-breaking stagger at the moment of contact.
    this.abilities.cast(kitAbility("utilityKick", "slam", 0xffd27a, lungeDur * impactAt), {
      onImpact: () => {
        if (!this.character) return;
        const hit = this.character.root.position.clone().addScaledVector(dir, reach * 0.5);
        hit.y += 1.0;
        // Heavy guard-breaking shove against the nearest enemy in kick reach.
        const kickFrom = this.character.root.position.clone();
        kickFrom.y += 1.0;
        const hitPos = this.targets.kickStagger(hit, 2.0, this.params.skillForce * 1.4, undefined, kickFrom);
        if (hitPos) {
          const impact = hitPos.clone();
          this.vfx.impact(impact, 0xffd27a, 2.2);
          this.vfx.burst(impact, 0xffe0a0, 34, 6);
          this.vfx.impactExplode(impact, this.fireThemeApplied);
          this.vfx.shockwave(new THREE.Vector3(impact.x, 0.05, impact.z), 0xffb24d, 1.6, 0.4);
        }
      },
    });

    // Pacing: responsive but not instantly spammable.
    this.kickCd = 0.6;
  }

  /**
   * Throw a bomb (KeyH): a quick-draw overhand throw that lobs a hand-grenade
   * prop along an arc to the aimed point (or the nearest target in front), then
   * detonates on landing with an AoE blast that damages every enemy in range.
   * Works on any rig — the `throw` clip no-ops to duration 0 on GLB rigs that
   * lack it, but the grenade still flies on a default release beat. Cooldowned.
   */
  private throwBomb() {
    if (!this.character || !this.controller || this.defeated) return;
    if (this.controller.isBusy || this.throwCd > 0) return;

    const cfg = this.assistConfig();
    const origin = this.character.root.position.clone();
    const aim = this.controller.forward();
    // Wide acquire so a loose aim still lands the lob near an enemy.
    const picked = this.pickTargetInFront(origin, aim, cfg.acqRange * 1.6, cfg.minDot * 0.4);
    this.controller.faceToward(aim, 0.2);

    // Quick-draw overhand throw (returns 0 on rigs without the clip).
    const dur = this.character.playClipOnce("throw", 0.1);

    // Lob from the throwing hand (chest height) to the target / a point ahead.
    const hand = origin.clone();
    hand.y += 1.4;
    const to = picked
      ? picked.position.clone().setY(0.2)
      : origin.clone().addScaledVector(aim, 6).setY(0.2);

    const RADIUS = 3.6;
    // Release at the throw's apex (mid-clip) so the grenade leaves the hand on cue.
    const release = dur > 0 ? dur * 0.42 : 0.24;
    this.abilities.cast(kitAbility("throwBomb", "slam", 0xffd27a, release), {
      onImpact: () => {
        this.vfx.thrownProp("models/props/hand-grenade.glb", hand, to, 0xffd27a, (p) =>
          this.bombDetonation(p, RADIUS, 50),
        );
      },
    });

    this.throwCd = 1.2;
  }

  /**
   * Big, satisfying frag detonation: a layered fire/ember/shockwave VFX stack
   * plus a real concussive result — AoE damage AND a knock-up that shoves every
   * enemy outward and topples them (impact reactions). The damage routes through
   * {@link sparringBlast} (defensive resolution + difficulty/PvP scaling) while
   * the knockback uses a zero-damage {@link CombatTargets.launch} so we don't
   * double-count damage. `upVel >= 8` triggers the clean knock-up chain.
   */
  private bombDetonation(p: THREE.Vector3, radius: number, damage: number) {
    if (this.disposed) return;
    const ground = new THREE.Vector3(p.x, 0.05, p.z);
    const HOT = 0xfff0c0;
    const FIRE = 0xff8c2a;
    const EMBER = 0xffb24d;

    // --- Visual stack: white-hot core flash → fire eruption → embers → smoke. ---
    this.vfx.impact(p, HOT, radius * 1.15); // bright ground burst + glow sphere
    this.vfx.impactExplode(p); // GPU fireball
    this.vfx.fireBurst(p.clone().setY(p.y + 0.3)); // hot upward puff + smoke
    this.vfx.aoeBlast(p, FIRE, radius); // radial flame tongues + ember spray
    this.vfx.nova(p.clone().setY(p.y + 0.4), 0xffc060); // energy ring pop
    this.vfx.burst(p.clone().setY(p.y + 0.4), 0xffe0a0, 80, 12); // shrapnel sparks
    // Twin expanding shockwaves (tight bright + wide faint) sell the blast wave.
    this.vfx.shockwave(ground, EMBER, radius * 1.1, 0.42);
    this.vfx.shockwave(ground, FIRE, radius * 1.7, 0.7);
    // Lingering smoke plume.
    this.vfx.smokeColumn(ground, 0x35302b, 1.9, 2.6);
    this.vfx.smokePop(p.clone().setY(p.y + 0.6), 0x4a443c, 1.4);

    // --- Concussive result: damage + knockback/topple on every enemy in range. ---
    this.sparringBlast(p, radius, damage, this.params.skillForce * 1.6, 0.8);
    this.targets.launch(p, radius, 0, 9.4);
  }

  /**
   * Drink a heal potion (KeyJ): a quick-draw "use" that restores a chunk of HP
   * after a short windup, with a green restorative burst. Routed through the
   * player CombatController (which owns HP in solo/coop, so a raw `this.health`
   * write would be overwritten by the per-frame sync next frame). Cooldowned,
   * and a no-op at full health.
   */
  private healPotion() {
    if (!this.character || !this.controller || this.defeated) return;
    if (this.controller.isBusy || this.potionCd > 0) return;
    if (this.health >= this.maxHealth) return;

    // Reuse the quick overhand-throw clip as a fast "draw + use" gesture.
    const dur = this.character.playClipOnce("throw", 0.1);
    const heal = Math.round(this.maxHealth * 0.35);
    const applyAt = dur > 0 ? dur * 0.5 : 0.3;

    this.abilities.cast(kitAbility("healPotion", "nova", 0x66ffaa, applyAt), {
      onImpact: () => {
        if (!this.character) return;
        // HP lives on the player CombatController in solo/coop; heal it there so
        // the per-frame `this.health = sparring.getPlayerHealth()` sync persists it.
        // (No raw `this.health` write: that would fight PvP's snapshot authority.)
        this.sparring.healPlayer(heal);
        const base = this.character.root.position.clone();
        const ground = new THREE.Vector3(base.x, 0.05, base.z);
        const core = base.clone().setY(base.y + 1.0);
        const GREEN = 0x66ffaa;
        // Restorative bloom: rising swirl + aura ring + soft nova, green motes
        // streaming up the body, grounded by a gentle ring (no fiery blast).
        this.vfx.castSwirl(core, 0x9affc0, 0.9, 1.0);
        this.vfx.auraRing(core, GREEN, 1.5, 0.9);
        this.vfx.nova(core, 0x88ffb0);
        this.vfx.burst(base.clone().setY(base.y + 0.4), 0xa8ffd0, 44, 5);
        this.vfx.shockwave(ground, GREEN, 1.6, 0.55);
      },
    });

    this.potionCd = 8;
  }

  // ---- Flanged Mace signature throw (slot 4) ----

  private ensureMaceThrow(): MaceThrowMachine {
    if (!this.maceThrow) this.maceThrow = new MaceThrowMachine();
    return this.maceThrow;
  }

  /**
   * Slot-4 press while the Flanged Mace is equipped. From a clean state it
   * launches the throw; while the mace is already out (either flight phase) it
   * recalls the mace and dashes the player to it instead — a gap-closer. All the
   * automatic transitions (impact stun, return catch, fail-safe recall) are
   * driven from the loop by {@link updateMaceThrow}.
   */
  private doMaceThrow(): boolean {
    if (!this.character || !this.controller || this.defeated) return false;
    const m = this.ensureMaceThrow();
    // Re-press: recall + dash regardless of cooldown (the throw is already paid).
    if (m.isOut) {
      this.applyMaceEvents(m.press());
      return true;
    }
    if (this.controller.isBusy) return false;
    if (this.sigCooldowns[3] > 0) return false;
    this.beginMaceThrow();
    m.press();
    // Stamina is spent up-front (the cost of throwing), but the cooldown only
    // starts once the throw RESOLVES — see onMaceCaught. This means the slot-4
    // radial reads "ready/in-use" while the mace is out, never ticking down.
    this.stamina = Math.max(0, this.stamina - MACE_THROW_ST);
    return true;
  }

  /** Set up the throw: aim, hide the held mace, and spawn the flying one. */
  private beginMaceThrow() {
    if (!this.character || !this.controller) return;
    const origin = this.character.root.position.clone();
    const aim = this.controller.forward();
    const cfg = this.assistConfig();
    // Wide acquire so a loose aim still lands the throw near an enemy.
    const picked = this.pickTargetInFront(origin, aim, cfg.acqRange * 1.6, cfg.minDot * 0.4);
    this.controller.faceToward(aim, 0.2);

    const hand = origin.clone();
    hand.y += 1.4;
    this.maceFrom.copy(hand);
    this.maceTo.copy(
      picked ? picked.position.clone().setY(0.9) : origin.clone().addScaledVector(aim, 8).setY(0.9),
    );
    this.maceImpactPoint.copy(this.maceTo);

    this.hideHeldWeapon();
    this.spawnMaceMesh(hand);
    // Overhand throw gesture (no-ops on GLB rigs lacking the clip).
    this.character.playClipOnce("throw", 0.1);
  }

  /** Apply the machine's events (impact stun, return catch, dash-recall). */
  private applyMaceEvents(events: MaceThrowEvent[]) {
    for (const ev of events) {
      if (ev === "impact") this.onMaceImpact();
      else if (ev === "caught") this.onMaceCaught();
      else if (ev === "dash") this.onMaceDash();
    }
  }

  /** Mace reached the target: stun + light damage + impact VFX. */
  private onMaceImpact() {
    const p = this.maceTo.clone();
    this.maceImpactPoint.copy(p);
    this.vfx.impact(p, MACE_THROW_COLOR, 1.4);
    this.vfx.smokePop(p.clone().setY(p.y + 0.4), 0xb0b6c0, 1.2);
    this.vfx.stunMark(p.clone().setY(p.y + 1.9), 0xffe24a, MACE_THROW_STUN + 0.4);
    this.targets.stun(p, MACE_THROW_RADIUS, MACE_THROW_STUN);
    this.sparringBlast(p, MACE_THROW_RADIUS, MACE_THROW_DAMAGE, this.params.skillForce * 0.6);
  }

  /**
   * Mace is back in hand: restore the held weapon, drop the flying mesh, and
   * NOW start the slot-4 cooldown. This is the single terminal resolution for
   * both throw outcomes — the auto-return catch and the dash-recall (which emits
   * "dash" then "caught") — so the cooldown begins exactly once per throw, only
   * after it has fully resolved.
   */
  private onMaceCaught() {
    this.showHeldWeapon();
    this.removeMaceMesh();
    this.sigCooldowns[3] = MACE_THROW_CD;
    this.sigCooldownMaxes[3] = MACE_THROW_CD;
  }

  /** Re-press recall: dash the player to the mace, landing beside the target. */
  private onMaceDash() {
    if (!this.character || !this.controller) return;
    const target = (this.maceMesh ? this.maceMesh.position : this.maceTo).clone();
    const from = this.character.root.position;
    const to = new THREE.Vector3(target.x - from.x, 0, target.z - from.z);
    const dist = to.length();
    if (dist > 1e-3) {
      const dir = to.multiplyScalar(1 / dist);
      this.controller.faceToward(dir, 0.2);
      // Stop ~1.2m short so we arrive beside the (stunned) target, not on top.
      const reach = Math.max(0, dist - 1.2);
      this.controller.dash(dir, reach, 0.2, 0, 0.85);
      this.vfx.smokePop(from.clone().setY(0.5), 0xb0b6c0, 1);
    }
  }

  /** Advance the mace throw timers + reposition the flying mesh (loop-driven). */
  private updateMaceThrow(dt: number) {
    const m = this.maceThrow;
    if (!m || !m.isOut) return;
    this.applyMaceEvents(m.step(dt));
    if (!this.maceMesh || !m.isOut) return;
    const k = m.progress();
    if (m.phase === "outbound") {
      this.quadBezier(this.maceFrom, this.maceTo, k, this.maceMesh.position);
    } else {
      // Return arc: from the impact point back to the player's live hand.
      const handY = this.character ? this.character.root.position.y + 1.4 : this.maceFrom.y;
      const hand = this.character
        ? new THREE.Vector3(this.character.root.position.x, handY, this.character.root.position.z)
        : this.maceFrom;
      this.quadBezier(this.maceImpactPoint, hand, k, this.maceMesh.position);
    }
    this.maceMesh.rotation.x += dt * 18;
    this.maceMesh.rotation.y += dt * 12;
  }

  /** Quadratic arc between two points (apex lifted above the higher end). */
  private quadBezier(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) {
    const mid = a.clone().lerp(b, 0.5);
    mid.y = Math.max(a.y, b.y) + 2.2;
    const u = 1 - t;
    out.set(
      u * u * a.x + 2 * u * t * mid.x + t * t * b.x,
      u * u * a.y + 2 * u * t * mid.y + t * t * b.y,
      u * u * a.z + 2 * u * t * mid.z + t * t * b.z,
    );
  }

  private hideHeldWeapon() {
    if (this.mounted) for (const o of this.mounted.objects) o.visible = false;
  }

  private showHeldWeapon() {
    if (this.mounted) for (const o of this.mounted.objects) o.visible = true;
  }

  /** Build + add the small procedural flying mace (owned; disposed on catch). */
  private spawnMaceMesh(at: THREE.Vector3) {
    this.removeMaceMesh();
    const g = new THREE.Group();
    const shaftGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.7, 8);
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 0.85 });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.castShadow = true;
    g.add(shaft);
    const headGeo = new THREE.IcosahedronGeometry(0.16, 0);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x8a929e, metalness: 0.7, roughness: 0.35 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 0.4;
    head.castShadow = true;
    g.add(head);
    g.position.copy(at);
    this.scene.add(g);
    this.maceMesh = g;
    this.maceMeshGeos = [shaftGeo, headGeo];
    this.maceMeshMats = [shaftMat, headMat];
  }

  private removeMaceMesh() {
    if (this.maceMesh) this.scene.remove(this.maceMesh);
    for (const geo of this.maceMeshGeos) geo.dispose();
    for (const mat of this.maceMeshMats) mat.dispose();
    this.maceMesh = null;
    this.maceMeshGeos = [];
    this.maceMeshMats = [];
  }

  /**
   * Forced teardown (weapon swap, death, dungeon/room change, dispose): recall
   * the mace, drop the flying mesh, and restore the held weapon if it was out.
   * Safe (a no-op) when the mace was never thrown.
   */
  private cancelMaceThrow() {
    const wasOut = this.maceThrow?.cancel() ?? false;
    this.removeMaceMesh();
    if (wasOut) this.showHeldWeapon();
  }

  /**
   * Illegal headbutt (KeyC): a quick, dirty close-range melee. Steers a short
   * lunge onto the nearest target in front, plays the headbutt one-shot, and
   * lands a light {@link PLAYER_HEADBUTT_PAYLOAD} hit (low damage, solid poise
   * stagger) at head height on contact. Gated like the other one-shots so it
   * can't fire mid-attack; no-ops on rigs without the clip.
   */
  private headbutt() {
    if (!this.character || !this.controller || this.defeated) return;
    if (this.controller.isBusy || this.recoverLock > 0) return;
    if (!this.character.hasClip("headbutt")) return;

    const cfg = this.assistConfig();
    const origin = this.character.root.position.clone();
    const aim = this.controller.forward();
    const picked = this.pickTargetInFront(origin, aim, cfg.acqRange, cfg.minDot);
    const dir = this.steerToward(aim, origin, picked, cfg.steer);
    this.controller.faceToward(dir, 0.25);

    const dur = this.character.playClipOnce("headbutt", 0.1);
    this.swingTimer = dur > 0 ? dur * 0.5 : 0.3;
    this.swingColor = 0xff5a5a;

    // Short lunge into head-butt range (close most of the gap to the target).
    const reach = picked
      ? THREE.MathUtils.clamp(picked.dist - 0.5, 0.4, cfg.maxReach)
      : 0.9;
    const lungeDur = dur > 0 ? dur * 0.45 : 0.22;
    const impactAt = 0.55;
    this.controller.dash(dir, reach, lungeDur, 0, impactAt);

    // Light disruptive hit at head height on contact.
    this.abilities.cast(kitAbility("headbutt", "thrust", 0xff5a5a, lungeDur * impactAt), {
      onImpact: () => {
        if (!this.character) return;
        const here = this.character.root.position.clone().addScaledVector(dir, reach * 0.5);
        here.y += 1.5;
        this.targets.playerHit(here, 1.2, PLAYER_HEADBUTT_PAYLOAD, this.params.skillForce, this.sparCtx);
        this.vfx.impact(here, 0xff7a7a, 1.4);
        this.vfx.burst(here, 0xffb0b0, 22, 5);
        this.vfx.impactExplode(here, this.fireThemeApplied);
      },
    });
  }

  /**
   * Aerial dagger overhead (airborne light attack with a knife): an angled,
   * overdriven two-handed leaping-overhead swing that DIVES forward and throws a
   * forward slash reaching ~2 m ahead, landing a real hit at the END of the swing.
   * Replaces the generic crash-down slam for the dagger loadout. The hit is timed
   * to the clip's true impact frame (not a fixed early offset), so the big aerial
   * swing connects instead of whiffing into empty air. A pending flag + fail-safe
   * timer guarantee the airborne attack state can never deadlock.
   */
  private aerialDaggerSlash() {
    if (!this.character || !this.controller) return;
    // Mutually exclusive with the crash-down slam so two airborne attacks can never
    // both resolve from one jump.
    if (this.recoverLock > 0 || this.aerialSlashPending || this.slamPending) return;
    this.aerialSlashPending = true;
    this.aerialSlashPendingTimer = 1.5;

    const weaponless = !!getCharacter(this.characterId).weaponless;
    const wid: WeaponId = weaponless ? "none" : this.weaponId;
    const combat = weaponCombat(wid);
    const intensityN = THREE.MathUtils.clamp(combat.intensity, 1, 100) / 100;
    const dirN = THREE.MathUtils.clamp(combat.direction, 0, 100) / 100;
    const origin = this.character.root.position.clone();

    // Aim the dive at the crosshair target so the overhead comes down on it.
    const target = this.pickCrosshairTarget(combat);
    const dir = this.controller.forward();
    let targetDist = Infinity;
    if (target) {
      const planar = this.toTargetPlanar(target);
      targetDist = planar.dist;
      const steer = THREE.MathUtils.clamp(THREE.MathUtils.lerp(0.3, 1, dirN) * this.params.attackSteer, 0, 1);
      dir.lerp(planar.dir, steer).normalize();
    }
    this.controller.faceToward(dir, 0.25);

    const color = SKILL_COLOR[getWeapon(wid).kind] ?? 0x9fe8ff;
    this.swingColor = color;
    const dur = this.character.playClipOnce("jumpAttack", 0.1);
    this.swingTimer = dur > 0 ? dur * 0.5 : 0.3;

    // Angled overdrive: carry the body forward through the descent so the overhead
    // reads as a diving forward slash, not a vertical drop. Closes toward the
    // target (clamped) or commits a fixed forward dive when nothing is locked.
    const close = Number.isFinite(targetDist)
      ? THREE.MathUtils.clamp(targetDist - 1.0, 0.6, this.params.dashDistance * 1.3)
      : Math.min(2.0, this.params.dashDistance);
    const diveDur = dur > 0 ? THREE.MathUtils.clamp(dur * 0.6, 0.25, 0.6) : 0.4;
    this.controller.dash(dir, close, diveDur, 0, 0.85);
    if (close > 0.4) {
      this.vfx.afterimage(this.character.root, origin, dir, Math.max(close, 0.6), color, 4, 0.3);
    }

    // Resolve the forward slash + hit at the clip's true end-of-animation impact,
    // so the blade connects with the swing instead of resolving in empty air.
    const hitDelay = dur > 0 ? THREE.MathUtils.clamp(dur * 0.85, 0.25, 1.0) : 0.5;
    this.abilities.cast(kitAbility("aerialDaggerSlash", "slash", color, hitDelay), {
      onImpact: () => {
      if (!this.character) return;
      this.aerialSlashPending = false;
      // A long forward reach band (~2 m ahead) — much longer than the dagger's
      // grounded poke — so the diving overhead sweeps the ground in front of it.
      const strike = meleeStrike(
        { intensity: intensityN * 100, direction: 0, range: [0.8, 2.2] },
        { finisher: true, skillForce: this.params.skillForce },
      );
      const center = this.character.root.position.clone().addScaledVector(dir, strike.reach);
      center.y += 0.8;
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.character.root.rotation.y, 0));
      // Draw the diving cut from the swinging weapon's world pose so it emanates
      // from the weapon mesh; the HIT center stays tied to the body so combat is
      // unchanged. Tag with the weapon's stable crescent for a consistent slash.
      const wp = this.weaponPose();
      this.vfx.slashArc(wp ? wp.pos : center, wp ? wp.quat : quat, color, this.slashIndexForWeapon());
      const payload: AttackPayload = {
        force: 2,
        damage: strike.damage,
        poiseDamage: Math.round(strike.damage * 0.7),
      };
      const result = this.targets.playerHit(center, strike.radius, payload, strike.force, this.sparCtx);
      if (!result || result.outcome === "hit" || result.outcome === "crit") {
        this.vfx.impact(center, color, strike.radius * 1.25);
        this.vfx.impactExplode(center, this.fireThemeApplied);
        this.vfx.shockwave(new THREE.Vector3(center.x, 0.05, center.z), color, strike.radius * 1.2, 0.45);
      }
      this.hitBags(center, strike.radius, strike.force);
      this.netStrike(center, strike.radius, payload.damage);
      },
    });
  }

  /**
   * Straight stab (KeyZ): a normal forward dash into an extended main-hand
   * thrust, for the blade classes (sword + knife) only. Unlike the slashing
   * combo it barely steers — it commits to a straight line — and its hit band
   * reaches a touch past the swing arc so the lunging thrust reads as a poke,
   * not a slash. Plays the dedicated `stab` clip; no-ops on non-blade loadouts
   * and on GLB rigs (which ship no stab clip).
   */
  private stab() {
    if (!this.character || !this.controller) return;
    if (this.controller.isBusy || this.recoverLock > 0) return;
    if (!this.character.hasClip("stab")) return;
    const weaponless = !!getCharacter(this.characterId).weaponless;
    const wid: WeaponId = weaponless ? "none" : this.weaponId;
    // Blade-only move: the thrust only reads with a sword or dagger in hand.
    const cls = getWeapon(wid).animSet;
    if (cls !== "sword" && cls !== "knife") return;
    const combat = weaponCombat(wid);
    const intensityN = THREE.MathUtils.clamp(combat.intensity, 1, 100) / 100;
    const [rMin, rMax] = combat.range;
    const origin = this.character.root.position.clone();

    // Aim straight down the camera forward; only a light soft-aim nudge toward a
    // crosshair target so the stab still connects without curving off-line.
    const target = this.pickCrosshairTarget(combat);
    const dir = this.controller.forward();
    let targetDist = Infinity;
    if (target) {
      const planar = this.toTargetPlanar(target);
      targetDist = planar.dist;
      const steer = THREE.MathUtils.clamp(0.35 * this.params.attackSteer, 0, 1);
      dir.lerp(planar.dir, steer).normalize();
    }
    this.controller.faceToward(dir, 0.18);

    const dur = this.character.playClipOnce("stab", 0.1);
    this.swingTimer = dur > 0 ? dur * 0.45 : 0.2;
    const color = SKILL_COLOR[getWeapon(wid).kind] ?? 0x9fe8ff;
    this.swingColor = color;

    // Normal dash that closes to just inside the (extended) thrust reach.
    const reachMid = THREE.MathUtils.lerp(rMin, rMax, 0.6);
    const close = Number.isFinite(targetDist)
      ? THREE.MathUtils.clamp(targetDist - reachMid, 0, this.params.dashDistance)
      : Math.min(rMax, this.params.dashDistance * 0.6);
    const dashDur = dur > 0 ? THREE.MathUtils.clamp(dur * 0.5, 0.18, 0.4) : 0.24;
    const impactAt = 0.55;
    this.controller.dash(dir, close, dashDur, 0, impactAt);
    if (close > 0.4) {
      this.vfx.afterimage(this.character.root, origin, dir, Math.max(close, 0.6), color, 4, 0.3);
    }
    // Extend the hit band outward a touch: a thrust pokes past the swing arc.
    this.scheduleComboHit(dashDur * impactAt, dir, rMin, rMax + 0.4, intensityN, color, false, null);
  }

  /**
   * Stomp finisher (KeyT): a leaping downward axe-kick that executes a
   * knocked-down (fallen) enemy. It is gated — nothing happens unless a fallen
   * foe is within reach — so it reads as a true ground execution rather than a
   * free attack. On trigger the player leaps onto the prone target, the stomp
   * one-shot plays, and a heavy {@link PLAYER_STOMP_PAYLOAD} lands at the foot-
   * fall with slam VFX. No-ops on GLB rigs (no stomp clip) and while busy.
   */
  private stomp() {
    if (!this.character || !this.controller || this.defeated) return;
    if (this.controller.isBusy || this.recoverLock > 0) return;
    if (!this.character.hasClip("stomp")) return;
    const origin = this.character.root.position.clone();
    const targetPos = this.targets.nearestDownedPoint(origin, STOMP_REACH);
    if (!targetPos) return; // finisher only lands on a downed enemy

    const dir = targetPos.clone().sub(origin);
    dir.y = 0;
    const dist = dir.length();
    if (dist > 1e-3) dir.normalize();
    else dir.copy(this.controller.forward());
    this.controller.faceToward(dir, 0.15);

    const dur = this.character.playClipOnce("stomp", 0.1);
    this.swingTimer = dur > 0 ? dur * 0.5 : 0.3;
    const color = 0xffb24d; // slam-orange
    this.swingColor = color;

    // Leap onto the prone target: close most of the gap, landing on top of it.
    const close = THREE.MathUtils.clamp(dist - 0.4, 0, STOMP_REACH);
    const dashDur = dur > 0 ? THREE.MathUtils.clamp(dur * 0.55, 0.2, 0.6) : 0.32;
    const impactAt = 0.6;
    this.controller.dash(dir, close, dashDur, 0, impactAt);
    if (close > 0.4) {
      this.vfx.afterimage(this.character.root, origin, dir, Math.max(close, 0.6), color, 4, 0.3);
    }

    // Heavy execution hit at the foot-fall. Strict finisher semantics: only land
    // damage if a downed enemy is STILL prone here (re-acquire so a foe that slid
    // a touch still gets stomped, but one that already got up does not). A whiff
    // still plays the ground slam VFX at the foot-fall for feedback.
    this.abilities.cast(kitAbility("stomp", "slam", color, dashDur * impactAt), {
      onImpact: () => {
        if (!this.character) return;
        const here = this.character.root.position;
        const downed = this.targets.nearestDownedPoint(here, STOMP_REACH + 0.6);
        const hitPos = downed ?? new THREE.Vector3(here.x, 0.6, here.z);
        if (downed) {
          this.targets.playerHit(downed, 1.8, PLAYER_STOMP_PAYLOAD, this.params.skillForce, this.sparCtx);
        }
        const ground = new THREE.Vector3(hitPos.x, 0.05, hitPos.z);
        this.vfx.aoeBlast(new THREE.Vector3(hitPos.x, hitPos.y + 0.2, hitPos.z), color, 2.0);
        this.vfx.burst(hitPos, 0xffd27a, 40, 6);
        this.vfx.shockwave(ground, color, 2.2, 0.4);
        this.vfx.smokePop(ground, 0xffcaa0, 1.2);
      },
    });
  }

  signatureSkills(): { label: string; icon: string }[] {
    // Prefer the equipped weapon's complete kit (mace2h only today) so HUD
    // shows weapon skills when you swap weapons — not the character's defaults.
    const kit = getWeapon(this.weaponId).skillKit;
    if (kit) {
      return kit.signatures.map((s) => ({
        label: s.label,
        icon: SKILL_KIND_ICON[s.kind],
      }));
    }
    return getCharacter(this.characterId).signatureSkills.map((s) => ({
      label: s.label,
      icon: SKILL_KIND_ICON[s.kind],
    }));
  }

  // ── Multiplayer wiring ─────────────────────────────────────────────────────

  /**
   * Attach a live relay client so this Studio joins a multiplayer room: it
   * broadcasts the local player's transform/anim each report tick, renders the
   * other players as interpolated avatars, and (in coop) either owns the NPC
   * roster as host or mirrors the host's roster as a peer. Safe to call after the
   * room `welcome` has already arrived — remotes are seeded from the first
   * snapshot, so no welcome handoff is required.
   */
  attachNet(net: DangerClient): void {
    this.detachNet();
    this.net = net;
    // A coop peer (non-host) must NOT run its own AI/spawns — the host is the
    // sole authority for NPCs, mirrored in via `npcs` broadcasts.
    if (net.mode === "coop" && !net.isHost) {
      this.targets.setCount(0);
      this.targets.setDifficulty("passive");
    }
    this.netUnsub.push(
      net.on("joined", (p) => this.spawnRemote(p.id, p.name)),
      net.on("left", (id) => this.removeRemote(id)),
      net.on("snapshot", (players) => this.onNetSnapshot(players)),
      net.on("combat", (ev) => this.onNetCombat(ev)),
      net.on("npcs", (npcs) => this.onNetNpcs(npcs)),
      net.on("preset", (preset) => this.onNetPreset(preset)),
    );
  }

  /**
   * Apply a host-broadcast environment preset change so this joiner switches to
   * the same arena. Unknown/invalid values are ignored (the lib stays decoupled
   * from the animator's preset set). `propagate: false` keeps this from echoing
   * back to the relay; the React UI is notified so its menubar stays in sync.
   */
  private onNetPreset(preset: string): void {
    const id = asRoomPresetId(preset);
    if (!id || id === this.room.presetId) return;
    this.setRoomPreset(id, { propagate: false });
    this.onRoomPresetChanged?.(id);
  }

  /** Detach the relay client and tear down all networked avatars. */
  detachNet(): void {
    for (const off of this.netUnsub) off();
    this.netUnsub.length = 0;
    for (const a of this.remotes.values()) {
      this.remoteRoot.remove(a.root);
      a.dispose();
    }
    this.remotes.clear();
    for (const a of this.mirrorNpcs.values()) {
      this.remoteRoot.remove(a.root);
      a.dispose();
    }
    this.mirrorNpcs.clear();
    this.net = null;
  }

  /** Get-or-create a remote player avatar (async rig load; idempotent by id). */
  private spawnRemote(id: string, name: string): RemoteAvatar {
    const existing = this.remotes.get(id);
    if (existing) return existing;
    const avatar = new RemoteAvatar(id, name);
    this.remotes.set(id, avatar);
    this.remoteRoot.add(avatar.root);
    void avatar.load();
    return avatar;
  }

  private removeRemote(id: string): void {
    const a = this.remotes.get(id);
    if (!a) return;
    this.remotes.delete(id);
    this.remoteRoot.remove(a.root);
    a.dispose();
  }

  /** Reconcile remote players against the authoritative snapshot list. */
  private onNetSnapshot(players: PlayerState[]): void {
    const net = this.net;
    if (!net) return;
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === net.selfId) {
        // PvP: the server owns our HP — read it back here (the loop no longer
        // overwrites this.health from the local CC in pvp). Death/respawn
        // transitions are driven by explicit combat events, but mirror them off
        // the authoritative alive flag too in case an event was missed.
        if (net.mode === "pvp") {
          this.health = p.hp;
          if (!p.alive && !this.defeated) this.defeatPlayer(false);
          else if (p.alive && this.defeated) this.restorePlayer();
        }
        continue;
      }
      seen.add(p.id);
      const a = this.spawnRemote(p.id, p.name);
      a.applyTransform(p.px, p.py, p.pz, p.ry, p.moving, p.grounded, p.weapon);
    }
    for (const id of [...this.remotes.keys()]) {
      if (!seen.has(id)) this.removeRemote(id);
    }
  }

  /** Reconcile mirrored host NPCs (coop peers only). */
  private onNetNpcs(npcs: NpcState[]): void {
    const net = this.net;
    if (!net || net.mode !== "coop" || net.isHost) return;
    const seen = new Set<string>();
    for (const n of npcs) {
      if (!n.alive) continue;
      seen.add(n.id);
      let a = this.mirrorNpcs.get(n.id);
      if (!a) {
        a = new RemoteAvatar(n.id, "");
        this.mirrorNpcs.set(n.id, a);
        this.remoteRoot.add(a.root);
        void a.load();
      }
      a.applyTransform(n.px, n.py, n.pz, n.ry, false, true, n.weapon);
    }
    for (const id of [...this.mirrorNpcs.keys()]) {
      if (!seen.has(id)) {
        const a = this.mirrorNpcs.get(id)!;
        this.mirrorNpcs.delete(id);
        this.remoteRoot.remove(a.root);
        a.dispose();
      }
    }
  }

  /** Handle an incoming combat event from another player. */
  private onNetCombat(ev: CombatEvent): void {
    const net = this.net;
    if (!net) return;
    switch (ev.k) {
      case "attack":
        if (ev.from !== net.selfId) this.remotes.get(ev.from)?.playAttack();
        return;
      case "hit":
        if (ev.target === "player") {
          // PvP hits are resolved server-side: the broadcast carries the already
          // applied (post-guard) amount + outcome. The local player reads its
          // authoritative HP from snapshots, so on a self-hit we only play
          // VFX/recoil — never decrement HP locally (that would double-count).
          if (ev.to === net.selfId) this.reactNetPlayerHit(ev.amount, ev.outcome, ev.from);
          else this.remotes.get(ev.to)?.playHurt();
        } else if (ev.target === "npc" && net.isHost) {
          // Host owns NPC health: resolve the peer-forwarded hit on the dummy CC.
          this.targets.applyNetHit(ev.to, ev.amount, this.sparCtx);
        }
        return;
      case "death":
        // Server-authoritative death (pvp). On self, enter the defeat state but
        // do NOT auto-respawn — the server owns the respawn timer.
        if (ev.from === net.selfId) this.defeatPlayer(false);
        else this.remotes.get(ev.from)?.playHurt();
        return;
      case "respawn":
        // Server-authoritative respawn (pvp). Restore the local player on self.
        if (ev.from === net.selfId) this.restorePlayer();
        return;
    }
  }

  /**
   * React to a server-resolved PvP hit on the local player: VFX + recoil only.
   * The server already applied the (post-guard) damage to authoritative HP, which
   * arrives via snapshots — never decrement HP here. `outcome` is the server's
   * resolution (hit/block/avoid) so the reaction matches what actually landed.
   */
  private reactNetPlayerHit(amount: number, outcome: string | undefined, fromId: string): void {
    if (!this.character || this.defeated) return;
    const defended = outcome === "block" || outcome === "avoid";
    const chest = this.character.root.position.clone();
    chest.y += 1.0;
    const from = this.remotes.get(fromId)?.position(new THREE.Vector3()) ?? chest.clone();
    const push = chest.clone().sub(from);
    push.y = 0;
    if (push.lengthSq() < 1e-4) push.set(0, 0, 1);
    push.normalize();
    // Bigger recoil on a clean hit, lighter nudge when blocked; none when avoided.
    const recoil = outcome === "avoid" ? 0 : defended ? 3 : 6;
    if (recoil > 0) this.controller?.applyImpulse(push, recoil * 0.5, recoil > 4 ? 1.5 : 0);
    if (!defended && amount > 0) {
      this.hurt = 0.5;
      this.vfx.impact(chest, 0xff5a6a, 1.2);
    } else if (outcome === "block") {
      this.vfx.impact(chest, 0x6ad0ff, 0.8);
    }
  }

  /** Restore the local player after a server-authoritative pvp respawn. */
  private restorePlayer(): void {
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.invuln = 1.6;
    this.defeated = false;
    this.hurt = 0;
  }

  /**
   * Forward a local melee/skill strike to networked combatants: in pvp, hit
   * remote players in range; as a coop peer, forward hits onto mirrored host
   * NPCs (the host resolves the damage). No-op in solo play.
   */
  private netStrike(center: THREE.Vector3, radius: number, damage: number): void {
    const net = this.net;
    if (!net || !net.roomCode) return;
    const reach = radius + 1.0;
    const amount = Math.max(1, Math.round(damage));
    if (net.mode === "pvp") {
      for (const [id, a] of this.remotes) {
        if (a.position(this.netTmp).distanceTo(center) <= reach) {
          net.sendCombat({ k: "hit", from: net.selfId, to: id, target: "player", amount });
        }
      }
    } else if (net.mode === "coop" && !net.isHost) {
      for (const [id, a] of this.mirrorNpcs) {
        if (a.position(this.netTmp).distanceTo(center) <= reach) {
          net.sendCombat({ k: "hit", from: net.selfId, to: id, target: "npc", amount });
          this.vfx.impact(a.position(this.netTmp), 0xff7a8a, 1.0);
        }
      }
    }
  }

  /** Build the local player's snapshot for broadcast. */
  private buildSnapshot(): PlayerSnapshot {
    const root = this.character?.root;
    const cs = this.controller?.state;
    const weaponless = !!getCharacter(this.characterId).weaponless;
    // Report the current defensive stance so the server can mitigate PvP damage
    // authoritatively (block/parry/dodge map straight through; else "open").
    const cstate = this.sparring.getPlayerState();
    const guard: GuardState =
      cstate === "block" || cstate === "parry" || cstate === "dodge" ? cstate : "open";
    return {
      px: root?.position.x ?? 0,
      py: root?.position.y ?? 0,
      pz: root?.position.z ?? 0,
      ry: root?.rotation.y ?? 0,
      clip: this.character?.currentClipName() ?? "",
      weapon: weaponless ? "none" : this.weaponId,
      hp: Math.round(this.health),
      moving: (cs?.speed ?? 0) > 0.1,
      grounded: cs?.grounded ?? true,
      guard,
    };
  }

  /** Per-frame multiplayer pump: broadcast + interpolate networked avatars. */
  private updateNet(dt: number): void {
    const net = this.net;
    if (!net) return;
    if (net.roomCode) {
      this.stateAccum += dt;
      if (this.stateAccum >= STATE_REPORT_MS / 1000) {
        this.stateAccum = 0;
        net.sendState(this.buildSnapshot());
      }
      if (net.mode === "coop" && net.isHost) {
        this.npcAccum += dt;
        if (this.npcAccum >= STATE_REPORT_MS / 1000) {
          this.npcAccum = 0;
          net.sendNpcs(this.targets.netSnapshot());
        }
      }
    }
    for (const a of this.remotes.values()) a.update(dt);
    for (const a of this.mirrorNpcs.values()) a.update(dt);
  }

  // ── Skillwrite cast modes (target / ground AOE) ───────────────────────────

  /** Arm a preset (target/ground) or cast immediately if instant. */
  private armOrCastPreset(preset: SkillPreset): boolean {
    // Ice staff: second press of Frost Field within 2s → Frost Blink forward.
    if (
      (preset.id === "frost_aoe_blink" || preset.vfx === "frostAoe") &&
      this.frostBlinkWindow > 0 &&
      this.weaponId === "staffIce"
    ) {
      return this.executeSkillPreset(
        {
          id: "frost_blink",
          label: "Frost Blink",
          acquire: "instant",
          duration: 0.35,
          vfx: "frostBlink",
          color: 0x9fdcff,
          cooldown: 0.35,
          stamina: 8,
        },
        {
          ground: this.character?.root.position.clone() ?? new THREE.Vector3(),
          targetPos: null,
          targetFriendly: true,
        },
      );
    }
    if (preset.acquire === "instant") {
      // Brief overhead stone during instant cast wind-up
      this.showCastStoneForPreset(preset);
      const ok = this.executeSkillPreset(preset, {
        ground: this.character?.root.position.clone() ?? new THREE.Vector3(),
        targetPos: null,
        targetFriendly: true,
      });
      if (ok) this.castRunes.release(0.32);
      else this.castRunes.hide();
      return ok;
    }
    const armed = this.castCtrl.begin(preset);
    if (armed) {
      this.showCastStoneForPreset(preset);
      this.setCombatFlash(preset.label.toUpperCase(), 0.9);
    }
    return armed;
  }

  /** Pick Firebolt / Icewave / Stormfist / nature-holy-arcane stone and show over head. */
  private showCastStoneForPreset(preset: SkillPreset): void {
    const el = getWeapon(this.weaponId).element;
    this.castRunes.show({
      skillId: preset.id,
      vfx: preset.vfx,
      element: el,
      school: el,
      channelColor: preset.color,
    });
  }

  private updateCastAim(_dt: number): void {
    if (!this.castCtrl.isActive() || !this.character || !this.controller) return;
    const ray = this.crosshairRay();
    const hostile = this.targets.selectedHostileGroup?.() ?? null;
    const ally = this.targets.selectedAllyGroup?.() ?? null;
    this.castCtrl.updateAim({
      ray,
      hostilePos: hostile?.position ?? null,
      allyPos: ally?.position ?? null,
      casterPos: this.character.root.position,
      preferFriendly: this.castCtrl.getPreset()?.vfx === "naturesHealing",
    });
  }

  private confirmSkillCast(): void {
    const snap = this.castCtrl.confirm();
    if (!snap?.preset) return;
    // Channel complete — stone pulses skill color then dismisses
    this.castRunes.release(0.38);
    this.executeSkillPreset(snap.preset, {
      ground: snap.ground,
      targetPos: snap.targetPos,
      targetFriendly: snap.targetFriendly,
    });
  }

  /**
   * Fire a skillwrite preset at the confirmed aim. Damage/status use existing
   * sparringBlast + applyStatusScoped so combat stays consistent.
   */
  private executeSkillPreset(
    preset: SkillPreset,
    aim: { ground: THREE.Vector3 | null; targetPos: THREE.Vector3 | null; targetFriendly: boolean },
  ): boolean {
    if (!this.character) return false;
    const origin = this.character.root.position.clone();
    const fwd = this.facing();
    const at = aim.targetPos?.clone() ?? aim.ground?.clone() ?? origin.clone().addScaledVector(fwd, 6);
    at.y = Math.max(0.05, at.y);

    if (this.character.hasClip("skill")) this.character.playClipOnce("skill", 0.1);
    else if (this.character.hasRole("attack")) this.character.playRoleOnce("attack", 0.1);

    const color = preset.color;
    const dmg = preset.damage ?? 20;
    const radius = preset.aoeRadius ?? 2.5;

    switch (preset.vfx) {
      case "meteor":
        this.vfx.castMeteor(origin, fwd, color, (p) => {
          this.sparringBlast(p, radius, dmg, this.params.skillForce);
          if (preset.status) this.applyStatusScoped(preset.status, "hostile");
        }, at);
        break;
      case "blizzard":
        this.vfx.castBlizzard(at, color, radius, preset.duration ?? 4, (p) => {
          this.sparringBlast(p, radius, dmg * 0.35, this.params.skillForce * 0.4);
          if (preset.status) this.applyStatusScoped(preset.status, "hostile");
        });
        break;
      case "iceSnake": {
        const from = this.staffMuzzle();
        const to = at.clone().setY(at.y + 0.9);
        // Prefer explicit variant on preset, else weapon's snake, else glacial.
        const variant =
          (preset.iceSnakeVariantId ? iceSnakeById(preset.iceSnakeVariantId) : undefined) ??
          iceSnakeForWeapon(this.weaponId) ??
          iceSnakeById("snake_glacial")!;
        this.vfx.castIceSnake(
          from,
          to,
          {
            color: variant.color,
            color2: variant.color2,
            radius: variant.radius,
            trailWidth: variant.trailWidth,
            lengthScale: variant.lengthScale,
            speed: variant.speed,
            sway: variant.sway,
            swayFreq: variant.swayFreq,
            stopDistance: variant.stopDistance,
            aoeRadius: variant.aoeRadius,
          },
          variant.stopDistance,
          (p) => {
            // Impact at stop point — dodge the last gap. AOE uses variant radius.
            this.sparringBlast(p, variant.aoeRadius, variant.damage, this.params.skillForce * 0.7);
            this.applyStatusScoped(variant.status, "hostile");
            // Secondary tags: stun already via stunned; slow via slowed if present.
            if (variant.tags.includes("slow") && variant.status !== "slowed" && variant.status !== "frozen") {
              this.applyStatusScoped("slowed", "hostile");
            }
          },
        );
        break;
      }
      case "moonbeam":
        this.vfx.castMoonbeam(at, color, preset.duration ?? 3.5, false, (p) => {
          this.sparringBlast(p, radius, dmg * 0.4, this.params.skillForce * 0.3);
          if (preset.status) this.applyStatusScoped(preset.status, "hostile");
        });
        break;
      case "naturesHealing": {
        // Water splash spiral rises from under caster (opaque, spinning).
        // Friendly: also spiral on target; beam keeps HoT ticks.
        const casterFeet = origin.clone();
        this.vfx.castNatureHealingSpiral(casterFeet, color, {
          life: 1.4,
          peakHeight: 2.15,
          spin: 26,
          scale: 1.05,
        });
        if (aim.targetFriendly) {
          this.vfx.castNatureHealingSpiral(at.clone(), color, {
            life: 1.25,
            peakHeight: 2.0,
            spin: 22,
            scale: 0.95,
          });
          if (preset.heal) this.health = Math.min(this.maxHealth, this.health + (preset.heal ?? 0));
          if (preset.statusOnFriendly) this.applyStatusScoped(preset.statusOnFriendly, "ally");
        }
        this.vfx.castMoonbeam(at, color, Math.min(4, preset.duration ?? 4), true, (p) => {
          if (aim.targetFriendly) {
            if (preset.heal) this.health = Math.min(this.maxHealth, this.health + preset.heal * 0.12);
          } else {
            this.sparringBlast(p, radius, dmg * 0.25, this.params.skillForce * 0.25);
            if (preset.statusOnHostile) this.applyStatusScoped(preset.statusOnHostile, "hostile");
          }
        });
        break;
      }
      case "earthWall":
        this.vfx.castEarthWall(at, color, radius, preset.duration ?? 6);
        if (preset.status) this.applyStatusScoped(preset.status, "self");
        break;
      case "earthWave":
        this.vfx.castEarthWave(at, color, radius, preset.duration ?? 0.9, (p, r) => {
          this.sparringBlast(p, r, dmg * 0.5, this.params.skillForce * 0.8);
          if (preset.status) this.applyStatusScoped(preset.status, "hostile");
        });
        break;
      case "turret":
        this.deployTurret(at, fwd);
        break;
      case "flameBody":
        this.flameBodyT = preset.duration ?? 6;
        this.vfx.flameBodyFlash(origin, color);
        if (preset.status) this.applyStatusScoped(preset.status, "self");
        break;
      case "muzzleFlash":
        this.vfx.muzzleFlash(this.staffMuzzle(), fwd, color, 1.2);
        break;
      case "portal": {
        const dest = at.clone().setY(0);
        this.vfx.castPortal(origin.clone().setY(0.1), dest, color, preset.duration ?? 1.2);
        // Flame Body ghost at both ends for teleport readability.
        this.vfx.flameBodyFlash(origin, color);
        this.vfx.flameBodyFlash(dest.clone().setY(origin.y), color);
        break;
      }
      case "flameSlash":
        this.vfx.flameSlash(this.staffMuzzle(), fwd, (p) => {
          this.sparringBlast(p, 2.0, dmg, this.params.skillForce * 0.6);
          if (preset.status) this.applyStatusScoped(preset.status, "hostile");
        });
        break;
      case "frostSlash":
        this.vfx.frostSlash(this.staffMuzzle(), fwd, color, (p) => {
          this.sparringBlast(p, 2.0, dmg, this.params.skillForce * 0.6);
          if (preset.status) this.applyStatusScoped(preset.status, "hostile");
        });
        break;
      case "frostAoe":
        this.vfx.castFrostAoe(at, color, radius, preset.duration ?? 2.8, (p, r) => {
          this.sparringBlast(p, r, dmg * 0.4, this.params.skillForce * 0.35);
          if (preset.status) this.applyStatusScoped(preset.status, "hostile");
        });
        // Ice staff: arm 2s Frost Blink window (re-press Frost Field).
        if (this.weaponId === "staffIce" || preset.id === "frost_aoe_blink") {
          this.frostBlinkWindow = 2.0;
          this.setCombatFlash("BLINK READY", 1.2);
        }
        break;
      case "roots":
        this.vfx.castRoots(at, color, radius, preset.duration ?? 3.5, (p) => {
          this.sparringBlast(p, radius, dmg, this.params.skillForce * 0.5);
          if (preset.status) this.applyStatusScoped(preset.status, "hostile");
          this.applyStatusScoped("slowed", "hostile");
        });
        break;
      case "polymorph": {
        const host = aim.targetPos ?? at;
        this.vfx.castPolymorph(host.clone().setY(host.y + 0.9), color, preset.duration ?? 1.2);
        this.sparringBlast(host, radius, dmg, this.params.skillForce * 0.3);
        this.applyStatusScoped("hexed", "hostile");
        this.applyStatusScoped("stunned", "hostile");
        break;
      }
      case "frostBlink": {
        if (!this.controller) break;
        const from = origin.clone();
        const dest = from.clone().addScaledVector(fwd, 7.5);
        dest.y = from.y;
        this.vfx.castFrostBlink(from, dest, color);
        this.controller.blinkTo(dest);
        this.frostBlinkWindow = 0;
        this.invuln = Math.max(this.invuln, 0.2);
        break;
      }
      case "natureBlink": {
        if (!this.controller) break;
        const from = origin.clone();
        const dest = from.clone().addScaledVector(fwd, 8.0);
        dest.y = from.y;
        this.vfx.castNatureBlink(from, dest, color);
        this.controller.blinkTo(dest);
        this.invuln = Math.max(this.invuln, 0.22);
        break;
      }
      case "shockwavePush":
        this.vfx.castShockwavePush(origin, fwd, color, radius, (center, dir, r) => {
          // Push cone in front of caster.
          const pushCenter = center.clone().addScaledVector(dir, r * 0.45);
          pushCenter.y = center.y + 0.5;
          this.sparringBlast(pushCenter, r * 0.85, dmg, this.params.skillForce * 1.35);
          if (preset.status) this.applyStatusScoped(preset.status, "hostile");
        });
        break;
      case "rapidFire": {
        const muzzle = this.staffMuzzle();
        this.vfx.castRapidFire(muzzle, fwd, color, 7, 0.09, (_from, dir) => {
          // Each bolt: light damage along aim (end of short ray).
          const hit = muzzle.clone().addScaledVector(dir, 14);
          this.sparringBlast(hit, 1.1, dmg, this.params.skillForce * 0.35);
        });
        if (preset.status) this.applyStatusScoped(preset.status, "hostile");
        break;
      }
      case "standing2h":
        if (this.character.hasClip("skill")) this.character.playClipOnce("skill", 0.08);
        this.vfx.castStanding2hMagic(origin, color, preset.duration ?? 1.35, radius, (p, r) => {
          this.sparringBlast(p, r, dmg, this.params.skillForce * 0.55);
        });
        if (preset.status) this.applyStatusScoped(preset.status, "self");
        break;
      default:
        this.vfx.nova(at.clone().setY(1), color);
        this.sparringBlast(at, radius, dmg, this.params.skillForce);
        break;
    }

    this.skillCooldownMax = preset.cooldown;
    this.skillCooldown = preset.cooldown;
    this.stamina = Math.max(0, this.stamina - preset.stamina);
    this.setCombatFlash(preset.label.toUpperCase(), 0.7);
    return true;
  }

  /**
   * Skin & butcher the nearest dead animal within reach (KeyN).
   * Drops meat/leather for up to 2 minutes after death.
   */
  butcherWildlife(): HarvestDrop[] | null {
    if (!this.wildlife || !this.character) return null;
    const drops = this.wildlife.tryHarvest(this.character.root.position);
    if (drops?.length) {
      this.setCombatFlash("BUTCHERED", 0.8);
      this.vfx.burst(drops[0].position, 0xc9a27a, 18, 3);
    }
    return drops;
  }

  /** Bind dungeon/island nav so wildlife A* uses the same mesh as enemies. */
  bindWildlifeNav(nav: NavGrid | null): void {
    this.wildlife?.setNav(nav);
  }

  dispose() {
    this.disposed = true;
    this.clearBearTraps();
    this.wildlife?.dispose();
    this.wildlife = null;
    this.castCtrl.dispose();
    this.castRunes.dispose();
    this.flameBodyT = 0;
    this.frostBlinkWindow = 0;
    // Stop the boot stall watchdog so it can't fire against a torn-down session.
    this.bootGate?.stopWatchdog();
    // Drop the readiness callback so any late async load that resolves after
    // teardown can't push a stale snapshot into a new session's loading screen.
    this.onReadiness = null;
    // Flush any pending (debounced) controls save so the last zoom/feel sticks.
    if (this.controlsSaveTimer !== null) {
      clearTimeout(this.controlsSaveTimer);
      this.controlsSaveTimer = null;
      saveControls(this.params);
    }
    this.detachNet();
    this.remoteRoot.clear();
    cancelAnimationFrame(this.raf);
    this.renderer.domElement.removeEventListener("click", this.onClick);
    this.renderer.domElement.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.renderer.domElement.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keyup", this.onKeyUp);
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.input.exitLock();
    this.input.dispose();
    this.cancelMaceThrow();
    if (this.backdropTex) {
      this.backdropTex.dispose();
      this.backdropTex = null;
    }
    if (this.mounted) unmountWeapon(this.mounted);
    this.character?.dispose();
    this.djBooth?.dispose();
    this.room.dispose();
    this.sfx?.dispose();
    this.vfx.dispose();
    this.ale.dispose();
    this.targets.dispose();
    this.dangerTargets?.dispose();
    this.arena?.dispose();
    this.bags?.dispose();
    this.physics?.dispose();
    this.status.dispose();
    this.mech.dispose();
    this.indicators.dispose();
    this.telegraphs.dispose();
    this.pending.length = 0;
    this.abilities.cancelAll();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
