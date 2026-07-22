import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type {
  AttackPayload,
  CombatController,
  CombatStateName,
  DefensiveResult,
} from "@workspace/epicfight";
import type { CombatTargets, EnemyCombatView, SparringContext, TargetHandle } from "../Targets";
import { PORTRAIT_OMIT_NAME } from "../targetPortraits";
import type { Difficulty, Faction, SkillKind, WeaponId } from "../types";
import type { NpcState } from "@workspace/danger-net";
import {
  fighterConfig,
  makeFighterCC,
  outcomeForceScale,
  isDefended,
  type FighterArchetype,
} from "../combatModel";
import {
  cellCenter,
  findPath,
  heightAt,
  inBounds,
  isWalkable,
  type NavGrid,
  type NavWaypoint,
} from "./navmesh";
import { asset } from "../assets";
import {
  CORPSE_TO_SKELETON_S,
  SKELETON_LINGER_S,
  createSkeletonCorpse,
  preloadSkeletonCorpses,
} from "../corpse/SkeletonCorpse";

export type EnemyKind =
  | "melee"
  | "ranged"
  | "monster"
  | "boss"
  | "nature_guard"
  | "shadow_assassin"
  | "lava_golem"
  | "ifrit"
  | "drake"
  | "thorn_beast"
  | "free_reptile"
  | "armored_crab";

/** Belerick Guard of Nature — GLB with baked combat clips. */
const BELERICK_MODEL = "models/enemies/belerick_guard_of_nature.glb";
const BELERICK_HEIGHT_M = 2.15;
/** Helcurt Shadowbringer — GLB with baked combat clips. */
const HELCURT_MODEL = "models/enemies/helcurt_shadowbringer.glb";
const HELCURT_HEIGHT_M = 2.0;
const LAVA_GOLEM_MODEL = "models/enemies/lava_golem.glb";
const LAVA_GOLEM_HEIGHT_M = 2.4;
const IFRIT_MODEL = "models/enemies/ifrit.glb";
const IFRIT_HEIGHT_M = 2.35;
const DRAKE_MODEL = "models/enemies/drake.glb";
const DRAKE_HEIGHT_M = 1.9;
const THORN_BEAST_MODEL = "models/enemies/monsters_x_free.glb";
const THORN_BEAST_HEIGHT_M = 2.1;
const FREE_REPTILE_MODEL = "models/enemies/free_reptile.glb";
const FREE_REPTILE_HEIGHT_M = 1.85;
const ARMORED_CRAB_MODEL = "models/enemies/creature_crab.glb";
const ARMORED_CRAB_HEIGHT_M = 1.4;

/** Kinds that load a skinned/animated GLB instead of capsule placeholders. */
const GLB_ENEMY_KINDS: ReadonlySet<EnemyKind> = new Set([
  "nature_guard",
  "shadow_assassin",
  "lava_golem",
  "ifrit",
  "drake",
  "thorn_beast",
  "free_reptile",
  "armored_crab",
]);

interface KindProfile {
  name: string;
  health: number;
  /** Capsule/body height (visual scale). */
  scale: number;
  color: number;
  /** Base attack power (raw damage carried in the CC attack payload). */
  attack: number;
  /** Engage range (m) before the enemy attacks. */
  range: number;
  /** Telegraph (windup) seconds before a strike lands. */
  windup: number;
  /** Seconds between attacks. */
  attackInterval: number;
  /** Move speed (m/s) at difficulty "medium" (scaled per difficulty). */
  speed: number;
  /** True for projectile attackers (keep distance + fire bolts). */
  ranged: boolean;
  defense: number;
}

const PROFILES: Record<EnemyKind, KindProfile> = {
  melee: {
    name: "Skeleton",
    health: 60,
    scale: 1,
    color: 0xc9d3e0,
    attack: 16,
    range: 1.9,
    windup: 0.55,
    attackInterval: 1.6,
    speed: 2.8,
    ranged: false,
    defense: 4,
  },
  ranged: {
    name: "Archer",
    health: 45,
    scale: 1,
    color: 0x9ad0a0,
    attack: 14,
    range: 11,
    windup: 0.85,
    attackInterval: 2.2,
    speed: 2.4,
    ranged: true,
    defense: 2,
  },
  monster: {
    name: "Forge Brute",
    health: 160,
    scale: 1.7,
    color: 0xb3563f,
    attack: 30,
    range: 2.6,
    windup: 0.8,
    attackInterval: 2.0,
    speed: 2.2,
    ranged: false,
    defense: 10,
  },
  boss: {
    name: "Moloch Da God",
    health: 1600,
    scale: 3.6,
    color: 0x6a0d0d,
    attack: 52,
    range: 3.4,
    windup: 0.9,
    attackInterval: 2.3,
    speed: 2.0,
    ranged: false,
    defense: 22,
  },
  /** Belerick — Guard of Nature (Mobile Legends pack, full anim set). */
  nature_guard: {
    name: "Belerick",
    health: 220,
    scale: 1.15,
    color: 0x3d7a4a,
    attack: 28,
    range: 2.4,
    windup: 0.7,
    attackInterval: 1.85,
    speed: 2.5,
    ranged: false,
    defense: 12,
  },
  /** Helcurt — Shadowbringer assassin (fast melee). */
  shadow_assassin: {
    name: "Helcurt",
    health: 165,
    scale: 1.05,
    color: 0x4a2d6a,
    attack: 32,
    range: 2.2,
    windup: 0.45,
    attackInterval: 1.45,
    speed: 3.4,
    ranged: false,
    defense: 8,
  },
  lava_golem: {
    name: "Lava Golem",
    health: 280,
    scale: 1.35,
    color: 0xc44a1a,
    attack: 30,
    range: 2.8,
    windup: 0.85,
    attackInterval: 2.1,
    speed: 1.8,
    ranged: false,
    defense: 16,
  },
  ifrit: {
    name: "Ifrit",
    health: 240,
    scale: 1.2,
    color: 0xff5522,
    attack: 34,
    range: 2.6,
    windup: 0.65,
    attackInterval: 1.7,
    speed: 2.6,
    ranged: false,
    defense: 12,
  },
  drake: {
    name: "Drake",
    health: 180,
    scale: 1.1,
    color: 0x8b4513,
    attack: 26,
    range: 2.5,
    windup: 0.6,
    attackInterval: 1.6,
    speed: 2.9,
    ranged: false,
    defense: 10,
  },
  thorn_beast: {
    name: "Thorn Beast",
    health: 150,
    scale: 1.05,
    color: 0x5a7040,
    attack: 24,
    range: 2.4,
    windup: 0.55,
    attackInterval: 1.55,
    speed: 2.8,
    ranged: false,
    defense: 9,
  },
  free_reptile: {
    name: "Wild Reptile",
    health: 95,
    scale: 0.95,
    color: 0x4a7a3a,
    attack: 18,
    range: 2.2,
    windup: 0.5,
    attackInterval: 1.5,
    speed: 2.7,
    ranged: false,
    defense: 6,
  },
  armored_crab: {
    name: "Armored Crab",
    health: 110,
    scale: 0.9,
    color: 0xb85a2a,
    attack: 20,
    range: 2.1,
    windup: 0.7,
    attackInterval: 1.8,
    speed: 2.0,
    ranged: false,
    defense: 14,
  },
};

/**
 * Map each dungeon enemy kind onto a shared combat archetype so every enemy
 * owns a real {@link CombatController} (the single combat authority). The
 * profile's own `health` still overrides the archetype default so the dungeon
 * keeps its tuned HP pools.
 */
const KIND_ARCH: Record<EnemyKind, FighterArchetype> = {
  melee: "grunt",
  ranged: "grunt",
  monster: "elite",
  boss: "boss",
  nature_guard: "elite",
  shadow_assassin: "elite",
  lava_golem: "elite",
  ifrit: "elite",
  drake: "elite",
  thorn_beast: "elite",
  free_reptile: "grunt",
  armored_crab: "grunt",
};

/** Per-difficulty multipliers (mirrors the Danger Room's spread, simplified). */
const DIFFICULTY: Record<Difficulty, { speed: number; dmg: number; windup: number; interval: number }> = {
  passive: { speed: 0, dmg: 0, windup: 1.4, interval: 3 },
  easy: { speed: 0.8, dmg: 0.6, windup: 1.3, interval: 1.4 },
  medium: { speed: 1, dmg: 1, windup: 1, interval: 1 },
  hard: { speed: 1.25, dmg: 1.5, windup: 0.7, interval: 0.7 },
};

type EnemyState = "idle" | "chase" | "windup" | "recover" | "stagger" | "stun";

interface Enemy {
  id: number;
  kind: EnemyKind;
  profile: KindProfile;
  /** Navmesh this enemy pathfinds/snaps on (surface map or the pit floor). */
  nav: NavGrid;
  /** Pit dwellers always resolve at the hardest tuning, regardless of setting. */
  hardened: boolean;
  /** Pit dwellers stay dead so clearing the pit is a real climax. */
  noRespawn: boolean;
  /** Shared combat archetype this enemy resolves through. */
  arch: FighterArchetype;
  /** The single combat authority for this enemy (health/poise/defense). */
  cc: CombatController;
  /** Last CC state seen, to fire the one-shot reaction VFX hook on change. */
  lastState: CombatStateName;
  maxStamina: number;
  maxPoise: number;
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  outline?: THREE.Group;
  health: number;
  maxHealth: number;
  dead: boolean;
  /** Seconds until this enemy respawns at its spawn cell (reset). */
  respawn: number;
  /** Flesh → skeleton residual (Skeletons_Free). */
  isSkeleton: boolean;
  skeletonRoot: THREE.Object3D | null;
  spawn: THREE.Vector3;
  yaw: number;
  vel: THREE.Vector3;
  state: EnemyState;
  stateT: number;
  attackCd: number;
  stunT: number;
  /** Movement slowed while > 0 (bow-slash debuff). Move speed × `slowMul`. */
  slowT: number;
  /** Move-speed multiplier applied while `slowT > 0` (1 = no slow). */
  slowMul: number;
  /** Telegraph kind for the current windup. */
  windupKind: SkillKind;
  flash: number;
  walkPhase: number;
  // Pathing
  path: NavWaypoint[];
  pathIdx: number;
  repathT: number;
  ownGeos: THREE.BufferGeometry[];
  ownMats: THREE.Material[];
  /** Optional skinned GLB visual (Belerick / future heroes). */
  glbRoot: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  currentAnim: string;
  /** Hide procedural limbs when GLB is driving the look. */
  useGlbVisual: boolean;
}

interface Projectile {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  damage: number;
  from: THREE.Vector3;
  /** Caster chest at fire time — rebound aim target. */
  casterPos: THREE.Vector3;
  /** Owning enemy id (null when player-reflected). */
  ownerId: number | null;
  /** True after a successful weapon-collider parry rebound. */
  reflected: boolean;
  /** Base travel speed before / after rebound. */
  speed: number;
}

const CHEST_Y = 1.1;
const HEAD_Y = 2.25;

/**
 * The dungeon's living population: humanoid melee, ranged archers (with a
 * telegraphed shot), and a heavy monster. Each is a small procedurally-animated
 * primitive rig (no FBX skeletons — the attached dungeon FBX failed to decode),
 * driven by the shared grid navmesh + A* toward the player. Implements the
 * `CombatTargets` surface so the Studio's player-combat call sites damage these
 * enemies unchanged, and deals damage back through the `SparringContext`.
 */
export class DungeonEnemies implements CombatTargets {
  group = new THREE.Group();
  onDeath: ((pos: THREE.Vector3) => void) | null = null;
  // Combat-unification hooks (shared CombatTargets surface). Every dungeon enemy
  // owns a CombatController, so player hits resolve through `cc.applyAttack` and
  // these fire exactly like the Danger Room's Targets.
  onPlayerHit: ((result: DefensiveResult, pos: THREE.Vector3) => void) | null = null;
  onEnemyState: ((pos: THREE.Vector3, state: CombatStateName) => void) | null = null;

  /** The player's CombatController (so player hits can be parried/credited). */
  private playerCC: CombatController | null = null;
  private scene: THREE.Scene;
  private nav: NavGrid;
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private difficulty: Difficulty = "medium";
  private nextId = 1;
  private selectedId: number | null = null;
  private clock = 0;
  private playerStart: THREE.Vector3;
  private outlineMat: THREE.MeshBasicMaterial;
  private projGeo: THREE.SphereGeometry;
  private projMat: THREE.MeshBasicMaterial;
  /** Hook fired when a projectile/strike should spawn VFX (Studio supplies it). */
  onProjectileImpact: ((pos: THREE.Vector3) => void) | null = null;
  /**
   * Parry probe (Studio): when the player is in `parry` state and supplies a
   * weapon capsule, incoming projectiles that touch the blade rebound at 2×
   * toward the caster. Returns true if the host accepted the parry (anim/VFX).
   */
  tryParryProjectile:
    | ((
        pos: THREE.Vector3,
        incomingVel: THREE.Vector3,
        casterPos: THREE.Vector3,
      ) => { vel: THREE.Vector3; point: THREE.Vector3 } | null)
    | null = null;
  /** Reflected bolt hit an enemy (Studio applies damage / VFX). */
  onProjectileReflectedHit: ((pos: THREE.Vector3, damage: number) => void) | null = null;

  /** Shared skinned enemy templates (Belerick / Helcurt), loaded once each. */
  private glbTpls = new Map<
    EnemyKind,
    { root: THREE.Object3D; clips: THREE.AnimationClip[] }
  >();
  private glbLoading = new Map<EnemyKind, Promise<void>>();

  constructor(
    scene: THREE.Scene,
    nav: NavGrid,
    playerStart: THREE.Vector3,
    pit?: { nav: NavGrid; spawn: THREE.Vector3 },
  ) {
    this.scene = scene;
    this.nav = nav;
    this.playerStart = playerStart.clone();
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0xff4d5e, side: THREE.BackSide });
    this.projGeo = new THREE.SphereGeometry(0.16, 8, 8);
    this.projMat = new THREE.MeshBasicMaterial({ color: 0xffe27a });
    this.scene.add(this.group);
    preloadSkeletonCorpses();
    // Kick GLB loads early so heroes can mount visuals ASAP
    for (const kind of GLB_ENEMY_KINDS) void this.ensureGlbTpl(kind);
    this.spawnWave();
    if (pit) this.spawnPit(pit.nav, pit.spawn);
  }

  private glbSpec(
    kind: EnemyKind,
  ): { path: string; height: number; label: string } | null {
    switch (kind) {
      case "nature_guard":
        return { path: BELERICK_MODEL, height: BELERICK_HEIGHT_M, label: "Belerick" };
      case "shadow_assassin":
        return { path: HELCURT_MODEL, height: HELCURT_HEIGHT_M, label: "Helcurt" };
      case "lava_golem":
        return { path: LAVA_GOLEM_MODEL, height: LAVA_GOLEM_HEIGHT_M, label: "Lava Golem" };
      case "ifrit":
        return { path: IFRIT_MODEL, height: IFRIT_HEIGHT_M, label: "Ifrit" };
      case "drake":
        return { path: DRAKE_MODEL, height: DRAKE_HEIGHT_M, label: "Drake" };
      case "thorn_beast":
        return { path: THORN_BEAST_MODEL, height: THORN_BEAST_HEIGHT_M, label: "Thorn Beast" };
      case "free_reptile":
        return { path: FREE_REPTILE_MODEL, height: FREE_REPTILE_HEIGHT_M, label: "Wild Reptile" };
      case "armored_crab":
        return { path: ARMORED_CRAB_MODEL, height: ARMORED_CRAB_HEIGHT_M, label: "Armored Crab" };
      default:
        return null;
    }
  }

  /** Lazy-load skinned enemy pack (model + attack/run/idle/death clips). */
  private ensureGlbTpl(kind: EnemyKind): Promise<void> {
    const spec = this.glbSpec(kind);
    if (!spec) return Promise.resolve();
    if (this.glbTpls.has(kind)) return Promise.resolve();
    const inflight = this.glbLoading.get(kind);
    if (inflight) return inflight;

    const loading = (async () => {
      try {
        const gltf = await new GLTFLoader().loadAsync(asset(spec.path));
        const root = gltf.scene;
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        if (size.y > 1e-4) root.scale.multiplyScalar(spec.height / size.y);
        const box2 = new THREE.Box3().setFromObject(root);
        const center = box2.getCenter(new THREE.Vector3());
        root.position.x -= center.x;
        root.position.z -= center.z;
        root.position.y -= box2.min.y;
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        this.glbTpls.set(kind, { root, clips: gltf.animations?.slice() ?? [] });
        for (const e of this.enemies) {
          if (e.kind === kind && !e.glbRoot) this.mountGlbVisual(e);
        }
        const clips = this.glbTpls.get(kind)!.clips.map((c) => c.name).join(",");
        console.info(`[DungeonEnemies] ${spec.label} loaded clips=${clips}`);
      } catch (err) {
        console.warn(`[DungeonEnemies] ${spec.label} load failed — capsule fallback`, err);
        this.glbLoading.delete(kind);
      }
    })();
    this.glbLoading.set(kind, loading);
    return loading;
  }

  private mountGlbVisual(e: Enemy): void {
    const tpl = this.glbTpls.get(e.kind);
    if (!tpl || e.glbRoot) return;
    const clone = tpl.root.clone(true);
    clone.scale.multiplyScalar(e.profile.scale);
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const src = Array.isArray(m.material) ? m.material : [m.material];
      m.material = Array.isArray(m.material)
        ? src.map((x) => (x as THREE.Material).clone())
        : (src[0] as THREE.Material).clone();
    });
    e.group.add(clone);
    e.glbRoot = clone;
    e.useGlbVisual = true;
    e.body.visible = false;
    e.head.visible = false;
    e.legL.visible = false;
    e.legR.visible = false;
    e.armL.visible = false;
    e.armR.visible = false;

    const mixer = new THREE.AnimationMixer(clone);
    e.mixer = mixer;
    e.actions = new Map();
    for (const clip of tpl.clips) {
      const key = this.classifyHeroClip(clip.name);
      if (!key || e.actions.has(key)) continue;
      const action = mixer.clipAction(clip);
      action.enabled = true;
      e.actions.set(key, action);
    }
    this.playEnemyAnim(e, "idle", true);
  }

  /** Map pack clip names (Belerick / Helcurt / Ziambetov / Ifrit / Drake) → combat roles. */
  private classifyHeroClip(name: string): string | null {
    const n = name.toLowerCase();
    if (n.includes("dead") || n.includes("death") || n === "die") return "dead";
    if (
      n.includes("fight_idle") ||
      n.includes("wait_1") ||
      n.includes("wait_inhand") ||
      (n.includes("idle") && !n.includes("skill"))
    )
      return "idle";
    if (
      n.includes("fastrun") ||
      n.includes("run2") ||
      n.includes("run3") ||
      n.includes("run1") ||
      n.includes("run") ||
      n === "walk"
    )
      return "run";
    if (
      n.includes("attack1") ||
      n.includes("attack2") ||
      n.includes("attack3") ||
      n.includes("attack_01") ||
      n.includes("attack") ||
      n.includes("use_skill")
    )
      return "attack";
    if (n.includes("skill1") || n.includes("skill2") || n.includes("skill3") || n.includes("skill_"))
      return "skill";
    if (n.includes("taunt") || n.includes("verigo") || n.includes("shout") || n.includes("get hit") || n.includes("behit") || n.includes("hit"))
      return "taunt";
    return null;
  }

  private playEnemyAnim(e: Enemy, role: string, loop: boolean): void {
    if (!e.mixer || e.actions.size === 0) return;
    if (e.currentAnim === role) return;
    const next = e.actions.get(role) ?? e.actions.get("idle");
    if (!next) return;
    const prev = e.currentAnim ? e.actions.get(e.currentAnim) : null;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next) prev.crossFadeTo(next, 0.18, false);
    e.currentAnim = role;
  }

  // ---- Spawning -----------------------------------------------------------

  /** Pick `n` walkable cells on `g` far enough from `avoid` to be fair. */
  private pickSpawnCells(
    n: number,
    minDist: number,
    g: NavGrid = this.nav,
    avoid: THREE.Vector3 = this.playerStart,
    spacing = 2.5,
  ): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    let guard = 0;
    while (out.length < n && guard < 4000) {
      guard++;
      const c = Math.floor(Math.random() * g.cols);
      const r = Math.floor(Math.random() * g.rows);
      if (!isWalkable(g, c, r)) continue;
      const ctr = cellCenter(g, c, r);
      const y = g.height[r * g.cols + c];
      const p = new THREE.Vector3(ctr.x, y, ctr.z);
      if (p.distanceTo(avoid) < minDist) continue;
      if (out.some((q) => q.distanceTo(p) < spacing)) continue;
      out.push(p);
    }
    return out;
  }

  /** Surface wave: skeletons, archers, brute + GLB elites / wildlife pack. */
  private spawnWave() {
    const plan: EnemyKind[] = [
      "melee",
      "melee",
      "ranged",
      "ranged",
      "monster",
      "nature_guard",
      "shadow_assassin",
      "free_reptile",
      "free_reptile",
      "thorn_beast",
      "armored_crab",
      "drake",
      "lava_golem",
      "ifrit",
    ];
    const cells = this.pickSpawnCells(plan.length, 6);
    for (let i = 0; i < cells.length; i++) {
      this.enemies.push(this.makeEnemy(plan[i % plan.length], cells[i], this.nav));
    }
  }

  /**
   * Populate the sealed end-game pit: a dense pack of the strongest brutes plus
   * the lone oversized boss "Moloch Da God". Pit dwellers are hardened (always
   * resolve at the hardest tuning) and never respawn, so clearing the pit is the
   * real climax. The boss anchors at the pit centre; brutes ring around it.
   */
  private spawnPit(pitNav: NavGrid, pitSpawn: THREE.Vector3) {
    const BRUTE_COUNT = 8;
    const cells = this.pickSpawnCells(BRUTE_COUNT, 0, pitNav, pitSpawn, 3);
    for (const cell of cells) {
      this.enemies.push(this.makeEnemy("monster", cell, pitNav, { hardened: true, noRespawn: true }));
    }
    // GLB elites flank the boss (hardened, no respawn).
    const elitePlan: EnemyKind[] = [
      "nature_guard",
      "shadow_assassin",
      "lava_golem",
      "ifrit",
      "drake",
      "thorn_beast",
    ];
    const eliteCells = this.pickSpawnCells(elitePlan.length, 0, pitNav, pitSpawn, 3.5);
    for (let i = 0; i < eliteCells.length; i++) {
      this.enemies.push(
        this.makeEnemy(elitePlan[i % elitePlan.length], eliteCells[i], pitNav, {
          hardened: true,
          noRespawn: true,
        }),
      );
    }
    // The boss stands at the centre of the pit floor.
    this.enemies.push(
      this.makeEnemy("boss", pitSpawn.clone(), pitNav, { hardened: true, noRespawn: true }),
    );
  }

  private makeEnemy(
    kind: EnemyKind,
    at: THREE.Vector3,
    nav: NavGrid,
    opts: { hardened?: boolean; noRespawn?: boolean } = {},
  ): Enemy {
    const profile = PROFILES[kind];
    const arch = KIND_ARCH[kind];
    const cfg = fighterConfig(arch, { maxHealth: profile.health });
    const cc = makeFighterCC(arch, {}, { maxHealth: profile.health });
    const s = profile.scale;
    const group = new THREE.Group();
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];

    const mat = new THREE.MeshStandardMaterial({ color: profile.color, metalness: 0.2, roughness: 0.7 });
    mats.push(mat);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xf0e4cf, metalness: 0.1, roughness: 0.6 });
    mats.push(headMat);

    const bodyGeo = new THREE.CapsuleGeometry(0.34 * s, 0.9 * s, 6, 12);
    geos.push(bodyGeo);
    const body = new THREE.Mesh(bodyGeo, mat);
    body.position.y = (1.0 + 0.0) * s;
    body.castShadow = true;
    group.add(body);

    const headGeo = new THREE.SphereGeometry(0.26 * s, 12, 12);
    geos.push(headGeo);
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.75 * s;
    head.castShadow = true;
    group.add(head);

    const limbGeo = new THREE.CapsuleGeometry(0.1 * s, 0.55 * s, 4, 8);
    geos.push(limbGeo);
    const mkLimb = (x: number, y: number) => {
      const m = new THREE.Mesh(limbGeo, mat);
      m.position.set(x, y, 0);
      m.castShadow = true;
      group.add(m);
      return m;
    };
    const legL = mkLimb(-0.18 * s, 0.4 * s);
    const legR = mkLimb(0.18 * s, 0.4 * s);
    const armL = mkLimb(-0.46 * s, 1.1 * s);
    const armR = mkLimb(0.46 * s, 1.1 * s);

    // A small weapon hint so kinds read apart: monster claws / archer bow stub.
    if (kind === "ranged") {
      const bowGeo = new THREE.TorusGeometry(0.3 * s, 0.03 * s, 6, 12, Math.PI);
      geos.push(bowGeo);
      const bowMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a });
      mats.push(bowMat);
      const bow = new THREE.Mesh(bowGeo, bowMat);
      bow.position.set(0.5 * s, 1.1 * s, 0.1 * s);
      bow.rotation.z = Math.PI / 2;
      group.add(bow);
    }

    // Moloch reads as a distinct, oversized silhouette via a pair of
    // forward-swept horns atop the already-large boss body.
    if (kind === "boss") {
      const hornGeo = new THREE.ConeGeometry(0.12 * s, 0.6 * s, 8);
      geos.push(hornGeo);
      const hornMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.3, roughness: 0.6 });
      mats.push(hornMat);
      const mkHorn = (x: number) => {
        const h = new THREE.Mesh(hornGeo, hornMat);
        h.position.set(x, 1.95 * s, 0.12 * s);
        h.rotation.x = 0.5;
        h.rotation.z = x > 0 ? -0.35 : 0.35;
        h.castShadow = true;
        group.add(h);
      };
      mkHorn(-0.16 * s);
      mkHorn(0.16 * s);
    }

    group.position.copy(at);
    this.group.add(group);

    const enemy: Enemy = {
      id: this.nextId++,
      kind,
      profile,
      nav,
      hardened: opts.hardened ?? false,
      noRespawn: opts.noRespawn ?? false,
      arch,
      cc,
      lastState: cc.getState(),
      maxStamina: cfg.maxStamina,
      maxPoise: cfg.maxPoise,
      group,
      body,
      head,
      legL,
      legR,
      armL,
      armR,
      health: profile.health,
      maxHealth: profile.health,
      dead: false,
      respawn: 0,
      isSkeleton: false,
      skeletonRoot: null,
      spawn: at.clone(),
      yaw: 0,
      vel: new THREE.Vector3(),
      state: "idle",
      stateT: 0,
      attackCd: 0.6 + Math.random() * 1.2,
      stunT: 0,
      slowT: 0,
      slowMul: 1,
      windupKind: profile.ranged ? "bolt" : "slash",
      flash: 0,
      walkPhase: Math.random() * Math.PI * 2,
      path: [],
      pathIdx: 0,
      repathT: Math.random() * 0.5,
      ownGeos: geos,
      ownMats: mats,
      glbRoot: null,
      mixer: null,
      actions: new Map(),
      currentAnim: "",
      useGlbVisual: false,
    };

    // Skinned GLB enemies — mount mesh when template ready
    if (GLB_ENEMY_KINDS.has(kind)) {
      void this.ensureGlbTpl(kind).then(() => {
        const e = this.enemies.find((x) => x.id === enemy.id);
        if (e) this.mountGlbVisual(e);
      });
    }

    return enemy;
  }

  // ---- CombatTargets: selection + queries ---------------------------------

  get aliveCount(): number {
    let n = 0;
    for (const e of this.enemies) if (!e.dead) n++;
    return n;
  }

  cycleSelection(): void {
    const live = this.enemies.filter((e) => !e.dead);
    if (live.length === 0) {
      this.setSelected(null);
      return;
    }
    const idx = live.findIndex((e) => e.id === this.selectedId);
    this.setSelected(live[(idx + 1) % live.length].id);
  }

  selectedView() {
    if (this.selectedId == null) return null;
    const e = this.enemies.find((x) => x.id === this.selectedId);
    if (!e || e.dead) {
      this.setSelected(null);
      return null;
    }
    const s = e.profile.scale;
    return {
      id: e.id,
      head: new THREE.Vector3(e.group.position.x, e.group.position.y + HEAD_Y * s, e.group.position.z),
      health: e.health,
      maxHealth: e.maxHealth,
      name: e.profile.name,
      isBoss: e.kind === "boss",
    };
  }

  lockPoint(): THREE.Vector3 | null {
    if (this.selectedId == null) return null;
    const e = this.enemies.find((x) => x.id === this.selectedId);
    if (!e || e.dead) return null;
    return this.chest(e);
  }

  /**
   * Portrait subject for the locked enemy: its full procedural rig, keyed per
   * dungeon kind so each enemy type renders a portrait at most once.
   */
  selectedPortrait(): { key: string; object: THREE.Object3D } | null {
    if (this.selectedId == null) return null;
    const e = this.enemies.find((x) => x.id === this.selectedId);
    if (!e || e.dead) return null;
    return { key: `dungeon:${e.kind}`, object: e.group };
  }

  /** Nearest knocked-down (fallen) enemy torso within `radius`, or null. Powers
   *  the Stomp finisher (the dungeon is all-enemy, so no faction filter). */
  nearestDownedPoint(from: THREE.Vector3, radius: number): THREE.Vector3 | null {
    let best: Enemy | null = null;
    let bestDist = radius * radius;
    for (const e of this.enemies) {
      if (e.dead || e.cc.getState() !== "fallen") continue;
      const dd = e.group.position.distanceToSquared(from);
      if (dd <= bestDist) {
        bestDist = dd;
        best = e;
      }
    }
    return best ? this.chest(best) : null;
  }

  acquireNearest(from: THREE.Vector3): THREE.Vector3 | null {
    let e = this.enemies.find((x) => x.id === this.selectedId && !x.dead);
    if (!e) {
      let best: Enemy | null = null;
      let bestD = Infinity;
      for (const o of this.enemies) {
        if (o.dead) continue;
        const dd = o.group.position.distanceToSquared(from);
        if (dd < bestD) {
          bestD = dd;
          best = o;
        }
      }
      if (!best) return null;
      this.setSelected(best.id);
      e = best;
    }
    return this.chest(e);
  }

  private setSelected(id: number | null) {
    if (this.selectedId === id) return;
    const old = this.enemies.find((e) => e.id === this.selectedId);
    if (old?.outline) old.outline.visible = false;
    this.selectedId = id;
    if (id == null) return;
    const e = this.enemies.find((x) => x.id === id);
    if (e && !e.dead) this.ensureOutline(e).visible = true;
  }

  private ensureOutline(e: Enemy): THREE.Group {
    if (e.outline) return e.outline;
    const g = new THREE.Group();
    // Named so the portrait capture can prune the shell from its clone.
    g.name = PORTRAIT_OMIT_NAME;
    for (const part of [e.body, e.head]) {
      const m = new THREE.Mesh(part.geometry, this.outlineMat);
      m.position.copy(part.position);
      m.rotation.copy(part.rotation);
      m.scale.copy(part.scale).multiplyScalar(1.1);
      g.add(m);
    }
    g.visible = false;
    e.group.add(g);
    e.outline = g;
    return g;
  }

  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    for (const e of this.enemies) {
      if (e.state !== "stagger" && e.state !== "stun") {
        e.state = "idle";
        e.stateT = 0;
      }
    }
  }

  getDifficulty(): Difficulty {
    return this.difficulty;
  }

  /** Re-roll the whole population to `count` enemies (used by reset). */
  setCount(count: number): void {
    this.clear();
    const kinds: EnemyKind[] = ["melee", "ranged", "monster"];
    const cells = this.pickSpawnCells(count, 6);
    for (let i = 0; i < cells.length; i++) {
      this.enemies.push(this.makeEnemy(kinds[i % kinds.length], cells[i], this.nav));
    }
  }

  /** Additive spawn (faction ignored — the dungeon is all enemies). */
  spawn(_weaponId: WeaponId, _faction: Faction): void {
    const cell = this.pickSpawnCells(1, 6)[0];
    if (cell) this.enemies.push(this.makeEnemy("melee", cell, this.nav));
  }

  clear(): void {
    for (const e of this.enemies) {
      this.group.remove(e.group);
      for (const g of e.ownGeos) g.dispose();
      for (const m of e.ownMats) m.dispose();
    }
    this.enemies.length = 0;
    this.setSelected(null);
  }

  factionCounts(): { enemy: number; ally: number } {
    let enemy = 0;
    for (const e of this.enemies) if (!e.dead) enemy++;
    return { enemy, ally: 0 };
  }

  private chest(e: Enemy, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(e.group.position.x, e.group.position.y + CHEST_Y * e.profile.scale, e.group.position.z);
  }

  private handle(e: Enemy): TargetHandle {
    const self = this;
    return {
      get position() {
        return self.chest(e);
      },
      get velocity() {
        // Dungeon enemies track only a knockback velocity (no smoothed locomotion
        // estimate); expose its planar component so predictive lead has a source.
        return new THREE.Vector3(e.vel.x, 0, e.vel.z);
      },
      get alive() {
        return !e.dead;
      },
    };
  }

  nearest(from: THREE.Vector3, count: number): TargetHandle[] {
    return this.enemies
      .filter((e) => !e.dead)
      .map((e) => ({ e, dist: this.chest(e).distanceToSquared(from) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, count)
      .map(({ e }) => this.handle(e));
  }

  raycast(ray: THREE.Ray, maxDist: number, softCos: number): TargetHandle | null {
    const chest = new THREE.Vector3();
    const sphere = new THREE.Sphere();
    const hitPt = new THREE.Vector3();
    let best: Enemy | null = null;
    let bestT = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      this.chest(e, chest);
      sphere.set(chest, 0.95 * e.profile.scale);
      if (ray.intersectSphere(sphere, hitPt)) {
        const t = hitPt.distanceTo(ray.origin);
        if (t <= maxDist && t < bestT) {
          bestT = t;
          best = e;
        }
      }
    }
    if (best) return this.handle(best);

    // Soft-aim cone fallback.
    let bestDot = softCos;
    const toT = new THREE.Vector3();
    for (const e of this.enemies) {
      if (e.dead) continue;
      this.chest(e, chest);
      toT.subVectors(chest, ray.origin);
      const dist = toT.length();
      if (dist > maxDist || dist < 1e-3) continue;
      toT.divideScalar(dist);
      const dot = toT.dot(ray.direction);
      if (dot > bestDot) {
        bestDot = dot;
        best = e;
      }
    }
    return best ? this.handle(best) : null;
  }

  // ---- CombatTargets: damage in ------------------------------------------

  /**
   * Resolve one player attack against an enemy through its CombatController —
   * the single combat authority. Applies the attacker's reaction back onto the
   * player CC (parry/dodge-punish), shoves by the resolved outcome force, and
   * kills the enemy when its CC health hits zero. Returns the DefensiveResult.
   */
  private hitEnemy(
    e: Enemy,
    payload: AttackPayload,
    from: THREE.Vector3,
    physForce: number,
  ): DefensiveResult | null {
    if (e.dead) return null;
    const result = e.cc.applyAttack(payload);
    if (this.playerCC && result.attackerReaction !== "none") {
      this.playerCC.applyVulnerableState(result.attackerReaction);
    }
    e.health = e.cc.getHealth();
    e.flash = isDefended(result.outcome) ? 0.12 : 0.18;
    const scale = outcomeForceScale(result.outcome);
    if (scale > 0) {
      const dir = new THREE.Vector3().subVectors(e.group.position, from);
      dir.y = 0;
      if (dir.lengthSq() > 1e-4) e.vel.addScaledVector(dir.normalize(), physForce * 0.15 * scale);
    }
    if (e.cc.getHealth() <= 0) this.kill(e);
    return result;
  }

  private kill(e: Enemy) {
    e.dead = true;
    e.health = 0;
    e.isSkeleton = false;
    // Corpse phase 2 min → skeleton residual → then respawn (surface) or stay bones (pit).
    e.respawn = e.noRespawn
      ? CORPSE_TO_SKELETON_S + SKELETON_LINGER_S
      : CORPSE_TO_SKELETON_S + SKELETON_LINGER_S;
    if (e.useGlbVisual && e.actions.has("dead")) {
      this.playEnemyAnim(e, "dead", false);
    }
    // After death pose settles, leave body visible until skeleton swap.
    window.setTimeout(() => {
      if (!e.dead || e.isSkeleton) return;
      // Keep group visible as corpse; no hide.
    }, 1800);
    if (this.selectedId === e.id) this.setSelected(null);
    this.onDeath?.(this.chest(e));
    // Schedule skeleton at 2 minutes (characters aren't skinned; time-only).
    window.setTimeout(() => {
      if (e.dead && !e.isSkeleton) void this.toSkeleton(e);
    }, CORPSE_TO_SKELETON_S * 1000);
  }

  private async toSkeleton(e: Enemy): Promise<void> {
    if (!e.dead || e.isSkeleton) return;
    e.isSkeleton = true;
    // Hide original body parts / GLB
    if (e.glbRoot) e.glbRoot.visible = false;
    e.body.visible = false;
    e.head.visible = false;
    e.legL.visible = false;
    e.legR.visible = false;
    e.armL.visible = false;
    e.armR.visible = false;
    e.mixer?.stopAllAction();
    e.group.visible = true;

    const variant = e.profile.ranged ? "archer" : "humanoid";
    const skel = await createSkeletonCorpse({
      position: new THREE.Vector3(0, 0, 0),
      yaw: e.yaw,
      scale: Math.max(0.7, Math.min(1.35, e.profile.scale)),
      variant,
      lieDown: true,
    });
    if (skel) {
      e.group.add(skel);
      e.skeletonRoot = skel;
    }
  }

  reactAt(nearPos: THREE.Vector3, reaction: "stagger" | "stunned" | "fallen"): void {
    const tmp = new THREE.Vector3();
    let nearest: Enemy | null = null;
    let nearestDist = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dist = this.chest(e, tmp).distanceTo(nearPos);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = e;
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

  /** Register the player's CombatController so player hits can be parried. */
  setPlayerCC(cc: CombatController | null): void {
    this.playerCC = cc;
  }

  /**
   * Net surface (shared {@link CombatTargets} contract). Dungeon play is solo —
   * multiplayer rooms run the Danger Room population, never this one — so NPC
   * networking is intentionally inert here.
   */
  netSnapshot(): NpcState[] {
    return [];
  }

  applyNetHit(_id: string, _amount: number, _ctx?: SparringContext): void {
    /* dungeon NPCs are not networked */
  }

  /**
   * Player attack against the dungeon population: resolve the nearest enemy
   * through its CC (firing {@link onPlayerHit} for impact VFX), then splash
   * lighter AoE onto the others in range. Returns the focused result, or null
   * when nothing was in reach (then it falls back to a plain blast).
   */
  playerHit(
    center: THREE.Vector3,
    radius: number,
    payload: AttackPayload,
    physForce: number,
    ctx?: SparringContext,
  ): DefensiveResult | null {
    const tmp = new THREE.Vector3();
    let focused: Enemy | null = null;
    let fd = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dd = this.chest(e, tmp).distanceTo(center);
      if (dd < fd) {
        fd = dd;
        focused = e;
      }
    }
    if (!focused || fd > radius + 1.0) {
      this.blast(center, radius, payload.damage, physForce, ctx);
      return null;
    }

    // Knockback originates from the ATTACKER, not the strike centre (which sits a
    // full reach ahead of the player). When the focused enemy is closer than the
    // centre, `pos − center` points back toward the player and inverts the shove —
    // so resolve from the player's own position when available.
    const knockFrom = ctx?.playerPos ?? center;
    const result = this.hitEnemy(focused, payload, knockFrom, physForce);
    if (result) this.onPlayerHit?.(result, this.chest(focused));

    // Lighter splash to the OTHER enemies inside the strike area.
    const splashPoise = payload.poiseDamage ?? Math.round(payload.damage * 0.5);
    for (const e of this.enemies) {
      if (e === focused || e.dead) continue;
      const d = this.chest(e, tmp).distanceTo(center);
      if (d > radius) continue;
      const falloff = Math.max(0.15, 1 - d / radius);
      this.hitEnemy(
        e,
        { force: 1, damage: payload.damage * falloff * 0.6, poiseDamage: splashPoise * falloff * 0.6 },
        center,
        physForce * (0.4 + falloff * 0.4),
      );
    }
    return result;
  }

  /** Live combat readout for the nearest enemy, for the HUD (or null). */
  focusedCombatView(from: THREE.Vector3): EnemyCombatView | null {
    let best: Enemy | null = null;
    let bestD = Infinity;
    const tmp = new THREE.Vector3();
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dd = this.chest(e, tmp).distanceToSquared(from);
      if (dd < bestD) {
        bestD = dd;
        best = e;
      }
    }
    if (!best) return null;
    return {
      health: best.cc.getHealth(),
      maxHealth: best.maxHealth,
      stamina: best.cc.getStamina(),
      maxStamina: best.maxStamina,
      poise: best.cc.getPoise(),
      maxPoise: best.maxPoise,
      critWindow: best.cc.getCritWindowRemaining(),
      state: best.cc.getState(),
    };
  }

  blast(center: THREE.Vector3, radius: number, damage: number, force: number, _ctx?: SparringContext): number {
    let hits = 0;
    const chest = new THREE.Vector3();
    for (const e of this.enemies) {
      if (e.dead) continue;
      this.chest(e, chest);
      const d = chest.distanceTo(center);
      if (d > radius) continue;
      const falloff = Math.max(0.15, 1 - d / radius);
      const dmg = damage * falloff;
      this.hitEnemy(e, { force: 1, damage: dmg, poiseDamage: Math.round(dmg * 0.5) }, center, force);
      hits++;
    }
    return hits;
  }

  launch(center: THREE.Vector3, radius: number, damage: number, upVel: number): number {
    let hits = 0;
    const chest = new THREE.Vector3();
    for (const e of this.enemies) {
      if (e.dead) continue;
      this.chest(e, chest);
      const d = chest.distanceTo(center);
      if (d > radius) continue;
      const falloff = Math.max(0.2, 1 - d / radius);
      const dmg = damage * falloff;
      this.hitEnemy(e, { force: 2, damage: dmg, poiseDamage: Math.round(dmg * 0.6) }, center, 0);
      e.vel.y += upVel * 0.3;
      hits++;
    }
    return hits;
  }

  stun(center: THREE.Vector3, radius: number, seconds = 1.6): number {
    let hits = 0;
    const chest = new THREE.Vector3();
    for (const e of this.enemies) {
      if (e.dead) continue;
      this.chest(e, chest);
      if (chest.distanceTo(center) > radius) continue;
      e.state = "stun";
      e.stunT = Math.max(e.stunT, seconds);
      e.stateT = 0;
      hits++;
    }
    return hits;
  }

  shieldBreak(center: THREE.Vector3, radius: number, seconds = 2): number {
    // Dungeon enemies have no shields; treat as a brief stun for parity.
    return this.stun(center, radius, seconds * 0.5);
  }

  /**
   * Slow every living enemy within `radius` of `center` (bow-slash debuff): their
   * move speed is scaled by `mul` (< 1) for `seconds`. Refreshes rather than
   * stacks — keeps the longer remaining timer and the stronger slow.
   */
  slowArea(center: THREE.Vector3, radius: number, mul: number, seconds: number): number {
    let hits = 0;
    const chest = new THREE.Vector3();
    for (const e of this.enemies) {
      if (e.dead) continue;
      this.chest(e, chest);
      if (chest.distanceTo(center) > radius) continue;
      e.slowMul = e.slowT > 0 ? Math.min(e.slowMul, mul) : mul;
      e.slowT = Math.max(e.slowT, seconds);
      hits++;
    }
    return hits;
  }

  stagger(handle: TargetHandle, seconds = 0.9): void {
    const chest = handle.position;
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = this.chest(e).distanceToSquared(chest);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best && bestD < 1) {
      best.state = "stagger";
      best.stateT = seconds;
    }
  }

  kickStagger(center: THREE.Vector3, radius: number, force: number, _seconds?: number, from?: THREE.Vector3): THREE.Vector3 | null {
    const chest = new THREE.Vector3();
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = this.chest(e, chest).distanceTo(center);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best || bestD > radius) return null;
    // Dungeon enemies have no shields; a forced stagger + knockback shove.
    best.state = "stagger";
    best.stateT = Math.max(best.stateT, 0.9);
    // Shove away from the kicker's position, not the kick point ahead of them,
    // so a point-blank enemy isn't knocked back into the player.
    const push = this.chest(best, new THREE.Vector3()).sub(from ?? center);
    push.y = 0;
    if (push.lengthSq() < 1e-4) push.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    push.normalize();
    best.vel.addScaledVector(push, force);
    best.vel.y += force * 0.2;
    return this.chest(best, new THREE.Vector3());
  }

  // ---- Update loop --------------------------------------------------------

  update(dt: number, ctx?: SparringContext): void {
    this.clock += dt;
    const diff = DIFFICULTY[this.difficulty];
    for (const e of this.enemies) {
      if (e.dead) {
        e.respawn -= dt;
        // When only skeleton-linger time remains, swap flesh → bones.
        if (!e.isSkeleton && e.respawn <= SKELETON_LINGER_S) {
          void this.toSkeleton(e);
        }
        if (e.respawn <= 0) {
          if (e.noRespawn) {
            // Pit climax: leave skeleton residual (or hide after linger).
            e.group.visible = !!e.skeletonRoot;
            e.respawn = Infinity;
          } else {
            this.reviveEnemy(e);
          }
        }
        continue;
      }
      // Hardened pit dwellers always fight at the hardest tuning regardless of
      // the dungeon-wide difficulty so the pit stays the climax.
      this.updateEnemy(e, dt, e.hardened ? DIFFICULTY.hard : diff, ctx);
    }
    this.updateProjectiles(dt, ctx);
  }

  private reviveEnemy(e: Enemy) {
    const cell = this.pickSpawnCells(1, 6, e.nav, e.hardened ? e.spawn : this.playerStart)[0] ?? e.spawn;
    e.group.position.copy(cell);
    e.spawn.copy(cell);
    e.cc = makeFighterCC(e.arch, {}, { maxHealth: e.profile.health });
    e.lastState = e.cc.getState();
    e.health = e.maxHealth;
    e.dead = false;
    e.isSkeleton = false;
    if (e.skeletonRoot) {
      e.group.remove(e.skeletonRoot);
      e.skeletonRoot = null;
    }
    if (e.glbRoot) e.glbRoot.visible = true;
    e.body.visible = !e.useGlbVisual;
    e.head.visible = !e.useGlbVisual;
    e.legL.visible = !e.useGlbVisual;
    e.legR.visible = !e.useGlbVisual;
    e.armL.visible = !e.useGlbVisual;
    e.armR.visible = !e.useGlbVisual;
    e.group.visible = true;
    e.state = "idle";
    e.stateT = 0;
    e.vel.set(0, 0, 0);
    e.attackCd = 1 + Math.random();
    e.group.visible = true;
    e.currentAnim = "";
    if (e.useGlbVisual) this.playEnemyAnim(e, "idle", true);
  }

  private updateEnemy(
    e: Enemy,
    dt: number,
    diff: { speed: number; dmg: number; windup: number; interval: number },
    ctx?: SparringContext,
  ) {
    e.flash = Math.max(0, e.flash - dt);
    if (e.useGlbVisual && e.glbRoot) {
      e.glbRoot.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const sm = mat as THREE.MeshStandardMaterial;
          if (!sm?.isMeshStandardMaterial) continue;
          if (e.flash > 0) {
            sm.emissive.setHex(0xff4040);
            sm.emissiveIntensity = e.flash * 4;
          } else {
            sm.emissive.setHex(0x000000);
            sm.emissiveIntensity = 0;
          }
        }
      });
    } else {
      const mat = e.body.material as THREE.MeshStandardMaterial;
      mat.emissive.setHex(e.flash > 0 ? 0xff4040 : 0x000000);
      mat.emissiveIntensity = e.flash > 0 ? e.flash * 5 : 0;
    }

    // Bow-slash slow debuff ticks down regardless of state.
    if (e.slowT > 0) {
      e.slowT = Math.max(0, e.slowT - dt);
      if (e.slowT === 0) e.slowMul = 1;
    }

    // Damp the knockback velocity each frame.
    e.vel.multiplyScalar(Math.max(0, 1 - 6 * dt));
    e.group.position.x += e.vel.x * dt;
    e.group.position.z += e.vel.z * dt;

    // Tick the combat controller (defense windows, hitstun, poise/stamina regen)
    // and reflect any CC-driven reaction state as a full incapacitation.
    e.cc.update(dt);
    e.health = e.cc.getHealth();
    const cs = e.cc.getState();
    if (cs !== e.lastState) {
      if (cs === "stagger" || cs === "stunned" || cs === "fallen") {
        this.onEnemyState?.(this.chest(e), cs);
      }
      e.lastState = cs;
    }
    if (cs === "stagger" || cs === "stunned" || cs === "fallen" || cs === "getUp") {
      if (e.state === "windup") e.state = "idle";
      this.snapToFloor(e);
      this.animateEnemy(e, dt, 0);
      return;
    }

    // Stun/stagger: hold still, count down.
    if (e.state === "stun") {
      e.stunT -= dt;
      if (e.stunT <= 0) e.state = "idle";
      this.snapToFloor(e);
      this.animateEnemy(e, dt, 0);
      return;
    }
    if (e.state === "stagger") {
      e.stateT -= dt;
      if (e.stateT <= 0) e.state = "idle";
      this.snapToFloor(e);
      this.animateEnemy(e, dt, 0);
      return;
    }

    const player = ctx?.playerPos;
    const canAct = ctx != null && ctx.playerAlive && diff.speed > 0 && player != null;
    if (!canAct || !player) {
      this.snapToFloor(e);
      this.animateEnemy(e, dt, 0);
      return;
    }

    const toPlayer = new THREE.Vector3().subVectors(player, e.group.position);
    toPlayer.y = 0;
    const distToPlayer = toPlayer.length();
    const profile = e.profile;
    const range = profile.range;

    // Face the player.
    if (distToPlayer > 0.05) {
      e.yaw = Math.atan2(toPlayer.x, toPlayer.z);
      e.group.rotation.y = e.yaw;
    }

    e.attackCd -= dt;
    let moveSpeed = 0;

    if (e.state === "windup") {
      e.stateT -= dt;
      if (e.stateT <= 0) {
        this.resolveStrike(e, diff, ctx);
        e.state = "recover";
        e.stateT = 0.35;
        e.attackCd = profile.attackInterval * diff.interval;
      }
    } else if (e.state === "recover") {
      e.stateT -= dt;
      if (e.stateT <= 0) e.state = "idle";
    } else {
      // idle/chase: decide to attack or move along the navmesh path.
      const inRange = profile.ranged
        ? distToPlayer <= range && distToPlayer > 2.5
        : distToPlayer <= range;
      if (inRange && e.attackCd <= 0) {
        e.state = "windup";
        e.stateT = profile.windup * diff.windup;
        e.windupKind = profile.ranged ? "bolt" : "slash";
        ctx.onWindup?.(this.chest(e), e.windupKind);
      } else {
        // Ranged kites: back off if too close.
        if (profile.ranged && distToPlayer < 2.5) {
          moveSpeed = -profile.speed * diff.speed * e.slowMul;
          toPlayer.normalize();
          e.group.position.addScaledVector(toPlayer, moveSpeed * dt);
        } else if (!inRange) {
          moveSpeed = profile.speed * diff.speed * e.slowMul;
          this.followPath(e, player, moveSpeed, dt);
        }
      }
    }

    this.snapToFloor(e);
    this.animateEnemy(e, dt, Math.abs(moveSpeed) / Math.max(0.1, profile.speed));
  }

  /** Walk the A* path toward the player, repathing periodically. */
  private followPath(e: Enemy, player: THREE.Vector3, speed: number, dt: number) {
    e.repathT -= dt;
    if (e.repathT <= 0 || e.pathIdx >= e.path.length) {
      e.path = findPath(e.nav, e.group.position.x, e.group.position.z, player.x, player.z);
      e.pathIdx = 0;
      e.repathT = 0.4 + Math.random() * 0.3;
    }
    if (e.pathIdx >= e.path.length) {
      // No path — steer straight (best effort).
      const dir = new THREE.Vector3(player.x - e.group.position.x, 0, player.z - e.group.position.z);
      if (dir.lengthSq() > 1e-4) {
        dir.normalize();
        e.group.position.addScaledVector(dir, speed * dt);
      }
      return;
    }
    const wp = e.path[e.pathIdx];
    const dir = new THREE.Vector3(wp.x - e.group.position.x, 0, wp.z - e.group.position.z);
    const d = dir.length();
    if (d < 0.25) {
      e.pathIdx++;
      return;
    }
    dir.divideScalar(d);
    e.group.position.addScaledVector(dir, speed * dt);
  }

  private resolveStrike(
    e: Enemy,
    diff: { speed: number; dmg: number; windup: number; interval: number },
    ctx: SparringContext,
  ) {
    const profile = e.profile;
    const crit = Math.random() < 0.1;
    const rawDamage = Math.max(
      0,
      Math.round(profile.attack * diff.dmg * (crit ? 1.6 : 1) + (Math.random() - 0.5) * 4),
    );
    if (profile.ranged) {
      this.fireProjectile(e, ctx.playerPos.clone(), rawDamage);
    } else {
      // Melee: only land if the player is still in range at strike time. The
      // player CC resolves the defense; if the player parried/dodge-punished,
      // apply the attacker reaction back onto this enemy's CC.
      const chest = this.chest(e);
      const toPlayer = new THREE.Vector3().subVectors(ctx.playerPos, chest);
      const dist = toPlayer.length();
      if (dist <= profile.range + 0.6) {
        ctx.onStrike?.(ctx.playerPos.clone(), e.windupKind, 1.2, false);
        const res = ctx.dealToPlayer(ctx.playerPos.clone(), 1.4, rawDamage, 8, chest, e.windupKind, false);
        if (res && res.attackerReaction !== "none") e.cc.applyVulnerableState(res.attackerReaction);
      }
    }
  }

  private fireProjectile(e: Enemy, target: THREE.Vector3, damage: number) {
    const origin = this.chest(e);
    const mesh = new THREE.Mesh(this.projGeo, this.projMat.clone());
    mesh.position.copy(origin);
    this.scene.add(mesh);
    const dir = new THREE.Vector3().subVectors(target, origin);
    const dist = dir.length();
    dir.normalize();
    const speed = 16;
    this.projectiles.push({
      mesh,
      vel: dir.multiplyScalar(speed),
      life: Math.min(2.5, dist / speed + 0.3),
      damage,
      from: origin.clone(),
      casterPos: origin.clone(),
      ownerId: e.id,
      reflected: false,
      speed,
    });
  }

  private updateProjectiles(dt: number, ctx?: SparringContext) {
    const playerChest = ctx?.playerPos;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      let hit = false;

      // ── Player parry rebound: weapon collider + parry state (Studio probe) ──
      if (!p.reflected && this.tryParryProjectile && ctx?.playerAlive) {
        const reb = this.tryParryProjectile(p.mesh.position, p.vel, p.casterPos);
        if (reb) {
          p.reflected = true;
          p.ownerId = null;
          p.vel.copy(reb.vel);
          p.speed = reb.vel.length();
          p.life = Math.max(p.life, 1.4);
          p.damage = Math.round(p.damage * 1.25);
          // Hot ricochet look
          const mat = p.mesh.material as THREE.MeshBasicMaterial;
          if (mat?.color) mat.color.setHex(0xfff0a0);
          p.mesh.scale.setScalar(1.25);
          // Snap to blade contact so the connect reads on the weapon
          p.mesh.position.copy(reb.point);
          continue;
        }
      }

      if (p.reflected) {
        // Home slightly more each frame toward original caster for a direct kill path
        const toCaster = p.casterPos.clone().sub(p.mesh.position);
        if (toCaster.lengthSq() > 0.01) {
          toCaster.normalize();
          p.vel.lerp(toCaster.multiplyScalar(p.speed), 0.12);
          // Keep speed locked at 2× after steer
          const sp = p.vel.length();
          if (sp > 1e-4) p.vel.multiplyScalar(p.speed / sp);
        }
        // Hit any living enemy near the bolt (prefer original caster volume)
        for (const e of this.enemies) {
          if (e.dead) continue;
          const chest = this.chest(e);
          if (p.mesh.position.distanceTo(chest) < 0.85) {
            const dmg = Math.max(1, Math.round(p.damage));
            this.hitEnemy(
              e,
              { force: 2, damage: dmg, poiseDamage: Math.round(dmg * 0.7) },
              p.mesh.position.clone(),
              10,
            );
            this.onProjectileReflectedHit?.(p.mesh.position.clone(), dmg);
            this.onProjectileImpact?.(p.mesh.position.clone());
            hit = true;
            break;
          }
        }
      } else if (playerChest && ctx?.playerAlive) {
        if (p.mesh.position.distanceTo(playerChest) < 0.7) {
          ctx.dealToPlayer(p.mesh.position.clone(), 0.8, p.damage, 5, p.from, "bolt", false);
          this.onProjectileImpact?.(p.mesh.position.clone());
          hit = true;
        }
      }
      if (hit || p.life <= 0) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  /** Clamp the enemy to the navmesh floor height under its feet. */
  private snapToFloor(e: Enemy) {
    const g = e.nav;
    const c = Math.round((e.group.position.x - g.originX) / g.cell);
    const r = Math.round((e.group.position.z - g.originZ) / g.cell);
    if (inBounds(g, c, r) && isWalkable(g, c, r)) {
      e.group.position.y = heightAt(g, e.group.position.x, e.group.position.z, e.group.position.y);
    }
  }

  /** Procedural limb swing, or Belerick GLB clip mixer. */
  private animateEnemy(e: Enemy, dt: number, moveT: number) {
    if (e.useGlbVisual && e.mixer) {
      e.mixer.update(dt);
      if (e.dead) return;
      if (e.state === "windup") {
        // One-shot attack/skill telegraph (don't re-roll every frame)
        if (e.currentAnim !== "attack" && e.currentAnim !== "skill") {
          this.playEnemyAnim(e, "attack", false);
        }
      } else if (e.state === "recover") {
        this.playEnemyAnim(e, "idle", true);
      } else if (moveT > 0.15) {
        this.playEnemyAnim(e, "run", true);
      } else {
        this.playEnemyAnim(e, "idle", true);
      }
      return;
    }

    const s = e.profile.scale;
    e.walkPhase += dt * (4 + moveT * 6);
    const swing = Math.sin(e.walkPhase) * 0.5 * (0.2 + moveT);
    e.legL.rotation.x = swing;
    e.legR.rotation.x = -swing;
    e.armL.rotation.x = -swing * 0.7;
    if (e.state === "windup") {
      // Raise the attacking arm as a telegraph.
      const t = 1 - Math.max(0, e.stateT) / Math.max(0.01, e.profile.windup);
      e.armR.rotation.x = -2.2 * t;
    } else if (e.state === "recover") {
      e.armR.rotation.x = 1.0;
    } else {
      e.armR.rotation.x = swing * 0.7;
    }
    // Slight bob.
    e.body.position.y = 1.0 * s + Math.abs(Math.sin(e.walkPhase)) * 0.04 * moveT;
  }

  dispose(): void {
    this.clear();
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles.length = 0;
    this.scene.remove(this.group);
    this.outlineMat.dispose();
    this.projGeo.dispose();
    this.projMat.dispose();
  }
}
