/**
 * Danger Room — canonical game catalog entry (GRUDOX / Open library / D1 seed shape).
 *
 * **ONE Danger Room:** this monorepo artifact is the only full Danger Room product.
 *   Repo:    threejs-rapier-react-three-controller
 *   App:     artifacts/animator  (@workspace/animator-app)
 *   Live:    threejs-rapier-react-three-controll.vercel.app  ·  door=danger
 *   Surfaces: login · avatar/dressing · Danger Room Studio · DJ booth · editors
 *
 * Other fleet games (Warlords, Open, Vox) may **copy patterns** (MM motion, soft-lock,
 * status FX, SSO handoff) but must **not** re-implement a second competing Danger Room.
 *
 * Character/account SSOT remains Railway + Grudge ID (see docs/GRUDOX_UNIFIED_SCHEME.md).
 * This file is structured for ObjectStore / D1 game registry rows — no runtime secrets.
 */

export const DANGER_ROOM_GAME_ID = "danger-room" as const;

export interface DangerRoomAssetRef {
  id: string;
  role: string;
  /** Public path under animator host or R2 key when promoted */
  path: string;
  notes?: string;
}

export interface DangerRoomSystemRef {
  id: string;
  module: string;
  description: string;
}

/** Library / fleet registry payload (JSON-serializable). */
export const DANGER_ROOM_GAME = {
  id: DANGER_ROOM_GAME_ID,
  name: "Danger Room",
  brand: "Racalvin · Grudge Studio",
  repo: "threejs-rapier-react-three-controller",
  artifact: "artifacts/animator",
  packageName: "@workspace/animator-app",
  /** Canonical product home — keep intact; ship GRUDOX entry here */
  liveUrls: [
    "https://threejs-rapier-react-three-controll.vercel.app/",
    "https://threejs-rapier-react-three-controll.vercel.app/?door=danger",
  ],
  openLauncher: {
    nativeMode: "danger",
    door: "danger",
    notes: "Open may deep-link door=danger; do not re-host a fork as a second room",
  },
  surfaces: [
    { id: "login", path: "/", notes: "Preferred login / landing" },
    { id: "dressing", path: "/?door=dressing", notes: "Avatar / character kit" },
    { id: "danger", path: "/?door=danger", notes: "Combat sandbox Studio + room" },
    { id: "editor", path: "/?door=editor", notes: "Animator / skill tools" },
    { id: "lobby", path: "/?door=lobby", notes: "Lobby handoff" },
  ],
  dataBindings: {
    identity: "id.grudge-studio.com",
    characters: "Railway grudge-api-production /api/characters",
    definitions: "objectstore.grudge-studio.com/api/v1",
    binaries: "assets.grudge-studio.com (or same-origin public/)",
    assetIndex: "api.grudge-studio.com/assets",
  },
  assets: [
    {
      id: "dj-booth",
      role: "scenery",
      path: "models/dj-booth.glb",
      notes: "Racalvin DJ equipment prop",
    },
    {
      id: "racalvin",
      role: "npc",
      path: "models/racalvin.glb",
      notes: "Resident DJ character",
    },
    {
      id: "music-spread",
      role: "vfx",
      path: "models/vfx/music_spread.glb",
      notes: "pflow music spray from alcove speakers",
    },
    {
      id: "water-splash-spiral",
      role: "vfx",
      path: "models/vfx/water_splash_spiral.glb",
      notes: "Nature staff Nature's Healing — rises/spins under caster",
    },
    {
      id: "magic-runestones",
      role: "vfx",
      path: "models/vfx/magic_runestones.glb",
      notes: "Overhead cast stones (Firebolt/Icewave/Stormfist/Rune) — tint on channel",
    },
    {
      id: "elemental-rune-stones",
      role: "vfx",
      path: "models/vfx/elemental_rune_stones.glb",
      notes: "Fallback cast-stone pack if magic_runestones missing",
    },
    {
      id: "belerick-guard",
      role: "enemy",
      path: "models/enemies/belerick_guard_of_nature.glb",
      notes: "Dungeon nature_guard — Belerick with attack/run/idle/death clips",
    },
    {
      id: "helcurt-shadowbringer",
      role: "enemy",
      path: "models/enemies/helcurt_shadowbringer.glb",
      notes: "Dungeon shadow_assassin — Helcurt with attack/run/idle/death clips",
    },
    {
      id: "lava-golem",
      role: "enemy",
      path: "models/enemies/lava_golem.glb",
      notes: "Dungeon lava_golem — molten rock brute (attack/run/idle/dead)",
    },
    {
      id: "ifrit",
      role: "enemy",
      path: "models/enemies/ifrit.glb",
      notes: "Dungeon ifrit — fire demon elite with skill clips",
    },
    {
      id: "drake",
      role: "enemy",
      path: "models/enemies/drake.glb",
      notes: "Dungeon drake — walk/attack/die/skill pack",
    },
    {
      id: "thorn-beast",
      role: "enemy",
      path: "models/enemies/monsters_x_free.glb",
      notes: "Dungeon thorn_beast — Monsters X free pack",
    },
    {
      id: "free-reptile",
      role: "enemy",
      path: "models/enemies/free_reptile.glb",
      notes: "Dungeon free_reptile — Vadim stylized reptile",
    },
    {
      id: "armored-crab",
      role: "enemy",
      path: "models/enemies/creature_crab.glb",
      notes: "Dungeon armored_crab — coastal crab pack",
    },
    {
      id: "mobile-obstacles",
      role: "prop",
      path: "models/obstacles/mobile_game_obstacles.glb",
      notes: "PBR-upgraded traps: spikes, gears, cylinders, bombs — dungeon seeds + buildable defenses",
    },
    {
      id: "skeleton-corpse",
      role: "prop",
      path: "models/skeletons/Skeleton.glb",
      notes: "Skeletons_Free residual after 2 min dead or skin/loot (Skeleton_Archer.glb for ranged)",
    },
    {
      id: "dj-audio",
      role: "audio",
      path: "audio/dj/",
      notes: "CPT RAC station playlist (local + radio streams)",
    },
  ] satisfies DangerRoomAssetRef[],
  systems: [
    {
      id: "studio",
      module: "three/Studio.ts",
      description: "Single combat engine for danger mode",
    },
    {
      id: "danger-room",
      module: "three/DangerRoom.ts",
      description: "Arena shell + DJ alcove + speakers",
    },
    {
      id: "dj-booth",
      module: "three/DjBooth.ts",
      description: "Racalvin + booth prop + dance retarget",
    },
    {
      id: "music-spread",
      module: "three/fx/MusicSpreadSpeakers.ts",
      description: "Beat-synced particle spray from speakers",
    },
    {
      id: "dungeon-enemies",
      module: "three/dungeon/DungeonEnemies.ts",
      description: "Dungeon population: Belerick/Helcurt + lava_golem/ifrit/drake/thorn/reptile/crab GLBs",
    },
    {
      id: "danger-net",
      module: "net/DangerClient.ts",
      description: "Optional multiplayer relay /api/danger",
    },
  ] satisfies DangerRoomSystemRef[],
  /** Fields games should read from Railway character row when launching into danger */
  characterLaunchFields: [
    "id",
    "name",
    "race",
    "classId",
    "equipment",
    "attributes",
    "model3d",
  ],
  copyPolicy:
    "Port ExplorerAnim / MM / soft-lock / status FX patterns into Warlords; never fork a second Danger Room product surface.",
} as const;

export type DangerRoomGameCatalog = typeof DANGER_ROOM_GAME;

/** JSON blob suitable for ObjectStore `games/danger-room.json` seed. */
export function dangerRoomGameRegistryJson(): string {
  return JSON.stringify(DANGER_ROOM_GAME, null, 2);
}
