/**
 * Production character loadout SSOT — unifies the systems that used to live apart:
 *
 * | System              | Storage / code                         |
 * |---------------------|----------------------------------------|
 * | Cube face           | AV1 + PLAYER_HEAD_KEY                  |
 * | Body scale / role   | AVP1 prefab fields                     |
 * | Armor 4-slot        | armorCatalog storage                   |
 * | Weapons             | Studio weaponId / offHand              |
 * | Voxel body colours  | voxelAvatarSave (optional merge)       |
 * | Grudge gear preset  | gearPresetId                           |
 *
 * Avatar Edit "Save to character" / "Save prefab" both write here so Danger Room,
 * Explorer, and lobby hydrate one production blob.
 */

import type { Faction, WeaponId } from "../types";
import {
  emptyArmorLoadout,
  loadArmorLoadoutFromStorage,
  saveArmorLoadoutToStorage,
  type ArmorLoadout,
} from "../equipment";
import {
  decodeConfig,
  encodeConfig,
  sanitizeConfig,
  type AvatarConfig,
} from "./catalog";
import { loadPlayerHeadConfig, savePlayerHeadConfig } from "./playerHead";
import {
  encodePrefab,
  loadPrefabs,
  makePrefabFromFace,
  raceHeightM,
  type CharacterPrefab,
  type PrefabRole,
} from "./npcPrefab";
import {
  loadVoxelAvatar,
  type VoxelAvatarSave,
} from "../explorer/voxelAvatarSave";

export const PRODUCTION_LOADOUT_KEY = "grudge.productionLoadout.v1";
export const PRODUCTION_LOADOUT_EVENT = "productionLoadout:saved";

export interface ProductionLoadout {
  version: 1;
  /** Active face config (same as Avatar Edit / Explorer head). */
  face: AvatarConfig;
  faceCode: string;
  role: PrefabRole;
  heightScale: number;
  bodyScaleXZ: number;
  heightM: number;
  armorSetId: string | null;
  armorLoadout: ArmorLoadout;
  weaponId: WeaponId;
  offHandId: WeaponId | null;
  gearPresetId?: string;
  /** Latest AVP1 deploy code for this loadout. */
  prefabCode: string;
  /** Optional voxel body colours when Explorer/voxel path is active. */
  voxel?: VoxelAvatarSave | null;
  updatedAt: number;
}

function asWeaponId(v: unknown, fallback: WeaponId = "none"): WeaponId {
  return typeof v === "string" && v.length > 0 ? (v as WeaponId) : fallback;
}

export function buildProductionLoadout(input: {
  face: AvatarConfig;
  role?: PrefabRole;
  heightScale?: number;
  bodyScaleXZ?: number;
  armorSetId?: string | null;
  armorLoadout?: ArmorLoadout;
  weaponId?: WeaponId;
  offHandId?: WeaponId | null;
  gearPresetId?: string;
  prefabName?: string;
}): ProductionLoadout {
  const face = sanitizeConfig(input.face) ?? input.face;
  const heightScale = input.heightScale ?? 1;
  const bodyScaleXZ = input.bodyScaleXZ ?? 1;
  const role = input.role ?? "player";
  const armorLoadout = input.armorLoadout ?? emptyArmorLoadout();
  const weaponId = input.weaponId ?? "none";
  const offHandId = input.offHandId ?? null;
  const prefab = makePrefabFromFace(face, role, {
    name: input.prefabName,
    heightScale,
    bodyScaleXZ,
    armorSetId: input.armorSetId ?? null,
    armorLoadout,
    weaponId,
    offHandId,
    gearPresetId: input.gearPresetId,
    tags: [face.race, role, "production"],
  });
  return {
    version: 1,
    face,
    faceCode: encodeConfig(face),
    role,
    heightScale,
    bodyScaleXZ,
    heightM: raceHeightM(face.race, heightScale),
    armorSetId: input.armorSetId ?? null,
    armorLoadout,
    weaponId,
    offHandId,
    gearPresetId: input.gearPresetId,
    prefabCode: encodePrefab(prefab),
    voxel: loadVoxelAvatar(),
    updatedAt: Date.now(),
  };
}

export function sanitizeProductionLoadout(raw: unknown): ProductionLoadout | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const face =
    (typeof o.faceCode === "string" ? decodeConfig(o.faceCode) : null) ??
    (o.face ? sanitizeConfig(o.face) : null);
  if (!face) return null;
  return buildProductionLoadout({
    face,
    role: (o.role as PrefabRole) || "player",
    heightScale: Number(o.heightScale) || 1,
    bodyScaleXZ: Number(o.bodyScaleXZ) || 1,
    armorSetId: typeof o.armorSetId === "string" ? o.armorSetId : null,
    armorLoadout: (o.armorLoadout as ArmorLoadout) || emptyArmorLoadout(),
    weaponId: asWeaponId(o.weaponId, "none"),
    offHandId:
      o.offHandId === null || o.offHandId === undefined
        ? null
        : asWeaponId(o.offHandId, "none"),
    gearPresetId: typeof o.gearPresetId === "string" ? o.gearPresetId : undefined,
  });
}

/** Write face + armor + weapon to all production stores (local SSOT). */
export function saveProductionLoadout(loadout: ProductionLoadout): void {
  try {
    localStorage.setItem(PRODUCTION_LOADOUT_KEY, JSON.stringify(loadout));
  } catch {
    /* quota */
  }
  savePlayerHeadConfig(loadout.face);
  saveArmorLoadoutToStorage(loadout.armorLoadout);
  try {
    window.dispatchEvent(
      new CustomEvent(PRODUCTION_LOADOUT_EVENT, { detail: loadout }),
    );
  } catch {
    /* ignore */
  }
}

export function loadProductionLoadout(): ProductionLoadout | null {
  try {
    const raw = localStorage.getItem(PRODUCTION_LOADOUT_KEY);
    if (raw) {
      const parsed = sanitizeProductionLoadout(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch {
    /* fall through */
  }
  // Rebuild from scattered stores (legacy installs)
  const face = loadPlayerHeadConfig();
  if (!face) return null;
  return buildProductionLoadout({
    face,
    armorLoadout: loadArmorLoadoutFromStorage(),
    weaponId: "none",
  });
}

/**
 * Snapshot for danger-room / fleet spawn of prefab NPCs.
 * Prefer saved prefabs library; fall back to generative from production face race.
 */
export function listProductionSpawnPrefabs(): CharacterPrefab[] {
  const saved = loadPrefabs();
  if (saved.length) return saved;
  const active = loadProductionLoadout();
  if (!active) return [];
  return [
    makePrefabFromFace(active.face, active.role, {
      heightScale: active.heightScale,
      bodyScaleXZ: active.bodyScaleXZ,
      armorSetId: active.armorSetId,
      armorLoadout: active.armorLoadout,
      weaponId: active.weaponId,
      offHandId: active.offHandId,
      gearPresetId: active.gearPresetId,
      name: `Active ${active.role}`,
    }),
  ];
}

/** What App / Studio should apply on enter play/danger. */
export interface StudioHydratePayload {
  weaponId: WeaponId;
  offHand: WeaponId | null;
  armorLoadout: ArmorLoadout;
  face: AvatarConfig | null;
  heightM: number;
  prefabCode: string | null;
  gearPresetId?: string;
  heightScale: number;
  bodyScaleXZ: number;
  role: PrefabRole;
}

export function productionHydratePayload(): StudioHydratePayload {
  const p = loadProductionLoadout();
  if (!p) {
    return {
      weaponId: "none",
      offHand: null,
      armorLoadout: loadArmorLoadoutFromStorage(),
      face: loadPlayerHeadConfig(),
      heightM: 1.8,
      prefabCode: null,
      heightScale: 1,
      bodyScaleXZ: 1,
      role: "player",
    };
  }
  return {
    weaponId: p.weaponId,
    offHand: p.offHandId,
    armorLoadout: p.armorLoadout,
    face: p.face,
    heightM: p.heightM,
    prefabCode: p.prefabCode,
    gearPresetId: p.gearPresetId,
    heightScale: p.heightScale,
    bodyScaleXZ: p.bodyScaleXZ,
    role: p.role,
  };
}

// ---------------------------------------------------------------------------
// AVP1 prefab → Danger Room / sparring spawn (unifies authoring → combat)
// ---------------------------------------------------------------------------

export type ProductionFighterArch = "grunt" | "boss";

/** Runtime spawn intent derived from a CharacterPrefab (AVP1). */
export interface ProductionSpawnSpec {
  name: string;
  role: PrefabRole;
  weaponId: WeaponId;
  offHandId: WeaponId | null;
  faction: Faction;
  /** Uniform scale on dummy root (heightScale, bosses bumped). */
  scale: number;
  arch: ProductionFighterArch;
  armorLoadout: ArmorLoadout;
  heightM: number;
  prefabCode: string;
  gearPresetId?: string;
}

/** Hostile roles spar as enemies; everyone else as allies (vendors/NPCs train with you). */
export function prefabRoleToFaction(role: PrefabRole): Faction {
  return role === "enemy" || role === "boss" ? "enemy" : "ally";
}

export function prefabToSpawnSpec(prefab: CharacterPrefab): ProductionSpawnSpec {
  const heightM = raceHeightM(prefab.face.race, prefab.heightScale);
  const isBoss = prefab.role === "boss";
  // Map SI height onto Targets baseline (~1.8 m grunt). Clamp so giants stay usable.
  let scale = heightM / 1.8;
  if (isBoss) scale = Math.max(scale, 1.55);
  scale = Math.min(2.4, Math.max(0.65, scale));
  return {
    name: prefab.name,
    role: prefab.role,
    weaponId: prefab.weaponId === "none" ? "sword" : prefab.weaponId,
    offHandId: prefab.offHandId,
    faction: prefabRoleToFaction(prefab.role),
    scale,
    arch: isBoss ? "boss" : "grunt",
    armorLoadout: prefab.armorLoadout,
    heightM,
    prefabCode: encodePrefab(prefab),
    gearPresetId: prefab.gearPresetId,
  };
}

/**
 * Prefabs ready to drop into Danger Room: library first, else active production
 * loadout + generative enemies from the same race for a quick squad.
 */
export function listProductionSpawnSpecs(opts?: {
  /** When library is empty, also generate this many role-biased fillers. */
  fillGenerated?: number;
}): ProductionSpawnSpec[] {
  const prefabs = listProductionSpawnPrefabs();
  const specs = prefabs.map(prefabToSpawnSpec);
  const fill = opts?.fillGenerated ?? 0;
  if (fill > 0 && prefabs.length < fill) {
    // Lazy import avoided — generate via makePrefabFromFace on active face race
    const active = loadProductionLoadout();
    const face = active?.face;
    if (face) {
      const roles: PrefabRole[] = ["enemy", "enemy", "ally", "boss"];
      const need = fill - specs.length;
      for (let i = 0; i < need; i++) {
        const role = roles[i % roles.length];
        const p = makePrefabFromFace(face, role, {
          name: `${role} ${i + 1}`,
          heightScale: role === "boss" ? 1.25 : 0.95 + (i % 3) * 0.05,
          weaponId: active?.weaponId && active.weaponId !== "none" ? active.weaponId : "sword",
          armorSetId: active?.armorSetId ?? null,
          armorLoadout: active?.armorLoadout,
          tags: [face.race, role, "production-fill"],
        });
        specs.push(prefabToSpawnSpec(p));
      }
    }
  }
  return specs;
}
