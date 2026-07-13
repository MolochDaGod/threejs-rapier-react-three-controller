/** Lobby World — persistent island survival state types. */

export type PlayerStance = "harvest" | "combat";

export type ItemId =
  | "wood"
  | "stone"
  | "fiber"
  | "ore"
  | "meat"
  | "hide"
  | "planks"
  | "sticks"
  | "stone_brick"
  | "iron_ingot"
  | "torch"
  | "pickaxe"
  | "axe"
  | "sword"
  | "shield"
  | "campfire"
  | "workbench"
  | "wall"
  | "floor"
  | "coin"
  | "potion";

export interface InventorySlot {
  id: ItemId;
  qty: number;
}

export interface PlacedBlock {
  id: string;
  /** Build piece kind. */
  kind: "wall" | "floor" | "campfire" | "workbench" | "torch";
  x: number;
  y: number;
  z: number;
  rot: number;
}

export interface ResourceNodeState {
  id: string;
  kind: "tree" | "rock" | "bush" | "ore";
  x: number;
  y: number;
  z: number;
  /** 0–1 remaining; 0 = depleted (respawns). */
  hp: number;
  maxHp: number;
  respawnAt: number;
}

export interface NpcState {
  id: string;
  role: "vendor" | "guide" | "guard" | "crafter";
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  line: string;
}

export interface MobState {
  id: string;
  kind: "slime" | "wolf" | "skeleton" | "boss";
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  atk: number;
  speed: number;
  aggro: number;
  /** Boss only: phase timer. */
  phaseT?: number;
}

export interface LobbyWorldSave {
  version: 1;
  player: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    hp: number;
    maxHp: number;
    stance: PlayerStance;
    inventory: InventorySlot[];
  };
  dayTime: number;
  blocks: PlacedBlock[];
  resources: ResourceNodeState[];
  /** Epoch ms of last save. */
  savedAt: number;
}

export interface LobbyHudSnapshot {
  hp: number;
  maxHp: number;
  stance: PlayerStance;
  dayTime: number;
  isNight: boolean;
  inventory: InventorySlot[];
  nearbyNpc: string | null;
  targetLabel: string | null;
  message: string | null;
  loading: string | null;
  mapLabel: string;
  mobCount: number;
  craftOpen: boolean;
  vendorOpen: boolean;
  /** GRUDOX / Warlords character identity */
  heroName: string | null;
  heroRace: string | null;
  heroClass: string | null;
  heroFleetId: string | null;
  heroCharacterId: string | null;
  authenticated: boolean;
  weaponId: string | null;
  pvpConnected: boolean;
  pvpRoom: string | null;
  pvpPeers: number;
  /** True when harvest is flushing to Railway account bag. */
  bagCloud: boolean;
}

export const SAVE_KEY = "grudox.lobbyWorld.v1";
export const WORLD_HALF = 48;
export const BLOCK_SIZE = 1;
