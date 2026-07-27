/**
 * Character prefabs for deploy / generative NPCs / allies / enemies.
 *
 * Face codes use existing AV1.* (encodeConfig / decodeConfig).
 * Full prefabs use AVP1.* = face + body scale + armor + weapons + role.
 *
 * SI height: heightScale multiplies the race base height (~1.55–2.0 m fleet).
 * bodyScaleXZ fattens/slims without changing height (dwarf stocky, elf slim).
 */

import {
  decodeConfig,
  encodeConfig,
  randomConfig,
  surpriseConfig,
  type AvatarConfig,
  type RaceId,
  RACES,
} from "./catalog";
import {
  ARMOR_SETS,
  emptyArmorLoadout,
  loadoutFromSet,
  type ArmorLoadout,
} from "../equipment";
import type { WeaponId } from "../types";
import { WEAPONS } from "../arsenal";

export type PrefabRole =
  | "player"
  | "npc"
  | "ally"
  | "enemy"
  | "vendor"
  | "boss";

export const PREFAB_ROLES: { id: PrefabRole; label: string; blurb: string }[] = [
  { id: "player", label: "Player", blurb: "Deployable hero look" },
  { id: "npc", label: "NPC", blurb: "Ambient / quest giver" },
  { id: "ally", label: "Ally", blurb: "Companion / party" },
  { id: "enemy", label: "Enemy", blurb: "Hostile combatant" },
  { id: "vendor", label: "Vendor", blurb: "Shop / trade NPC" },
  { id: "boss", label: "Boss", blurb: "Elite / larger scale" },
];

/** Race base height in metres (fleet SI — grudge-world-scale). */
export const RACE_BASE_HEIGHT_M: Record<RaceId, number> = {
  human: 1.8,
  barbarian: 2.0,
  orc: 1.95,
  undead: 1.85,
  dwarf: 1.55,
  elf: 1.9,
};

export interface CharacterPrefab {
  version: 1;
  id: string;
  name: string;
  role: PrefabRole;
  face: AvatarConfig;
  /** Multiplier on race base height (1 = default). Clamp 0.55–1.45. */
  heightScale: number;
  /** Horizontal bulk (1 = default). Clamp 0.7–1.35. */
  bodyScaleXZ: number;
  /** Armor set id when equipping a full set, else null. */
  armorSetId: string | null;
  armorLoadout: ArmorLoadout;
  weaponId: WeaponId;
  offHandId: WeaponId | null;
  /** Optional grudge modular preset (mage/knight/ranger/warrior/unarmed). */
  gearPresetId?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export const PREFAB_CODE_PREFIX = "AVP1.";
export const PREFAB_STORE_KEY = "avatarEdit:prefabs:v1";
export const PREFAB_SAVED_EVENT = "avatarPrefab:saved";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function uid(): string {
  return `pf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function raceHeightM(race: RaceId, heightScale = 1): number {
  return RACE_BASE_HEIGHT_M[race] * clamp(heightScale, 0.55, 1.45);
}

export function sanitizeLoadout(raw: unknown): ArmorLoadout {
  const empty = emptyArmorLoadout();
  if (!raw || typeof raw !== "object") return empty;
  const o = raw as Record<string, unknown>;
  const out = emptyArmorLoadout();
  for (const slot of ["head", "chest", "legs", "feet"] as const) {
    const v = o[slot];
    out[slot] = typeof v === "string" && v.length > 0 ? v : null;
  }
  return out;
}

export function sanitizePrefab(raw: unknown): CharacterPrefab | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  let face: AvatarConfig | null = null;
  if (typeof o.faceCode === "string") face = decodeConfig(o.faceCode);
  if (!face && o.face && typeof o.face === "object") {
    try {
      face = decodeConfig(encodeConfig(o.face as AvatarConfig));
    } catch {
      face = null;
    }
  }
  if (!face || !face.race) return null;
  const role = PREFAB_ROLES.some((r) => r.id === o.role)
    ? (o.role as PrefabRole)
    : "npc";
  const weaponId = (
    typeof o.weaponId === "string" && WEAPONS.some((w) => w.id === o.weaponId)
      ? o.weaponId
      : "none"
  ) as WeaponId;
  const offHandId = (
    typeof o.offHandId === "string" && WEAPONS.some((w) => w.id === o.offHandId)
      ? o.offHandId
      : null
  ) as WeaponId | null;
  const armorSetId =
    typeof o.armorSetId === "string" && ARMOR_SETS.some((s) => s.id === o.armorSetId)
      ? o.armorSetId
      : null;
  return {
    version: 1,
    id: typeof o.id === "string" && o.id ? o.id : uid(),
    name:
      typeof o.name === "string" && o.name.trim()
        ? o.name.trim().slice(0, 48)
        : `${face.race} ${role}`,
    role,
    face,
    heightScale: clamp(Number(o.heightScale) || 1, 0.55, 1.45),
    bodyScaleXZ: clamp(Number(o.bodyScaleXZ) || 1, 0.7, 1.35),
    armorSetId,
    armorLoadout: sanitizeLoadout(o.armorLoadout) ?? (armorSetId ? loadoutFromSet(armorSetId) : emptyArmorLoadout()),
    weaponId,
    offHandId,
    gearPresetId: typeof o.gearPresetId === "string" ? o.gearPresetId : undefined,
    tags: Array.isArray(o.tags)
      ? o.tags.filter((t): t is string => typeof t === "string").slice(0, 12)
      : [],
    createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : Date.now(),
  };
}

/** Compact deploy code: face + body + loadout. */
export function encodePrefab(prefab: CharacterPrefab): string {
  const payload = {
    v: 1,
    n: prefab.name,
    r: prefab.role,
    f: encodeConfig(prefab.face),
    h: prefab.heightScale,
    x: prefab.bodyScaleXZ,
    a: prefab.armorSetId,
    L: prefab.armorLoadout,
    w: prefab.weaponId,
    o: prefab.offHandId,
    g: prefab.gearPresetId,
    t: prefab.tags,
  };
  const b64 = btoa(JSON.stringify(payload));
  return (
    PREFAB_CODE_PREFIX +
    b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  );
}

export function decodePrefab(code: string): CharacterPrefab | null {
  const trimmed = code.trim();
  // Face-only AV1 → promote to prefab shell
  if (trimmed.startsWith("AV1.")) {
    const face = decodeConfig(trimmed);
    if (!face) return null;
    return makePrefabFromFace(face, "npc");
  }
  if (!trimmed.startsWith(PREFAB_CODE_PREFIX)) return null;
  try {
    let b64 = trimmed.slice(PREFAB_CODE_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const p = JSON.parse(atob(b64)) as Record<string, unknown>;
    const face =
      typeof p.f === "string" ? decodeConfig(p.f) : null;
    if (!face) return null;
    return sanitizePrefab({
      version: 1,
      id: uid(),
      name: p.n,
      role: p.r,
      face,
      faceCode: p.f,
      heightScale: p.h,
      bodyScaleXZ: p.x,
      armorSetId: p.a,
      armorLoadout: p.L,
      weaponId: p.w,
      offHandId: p.o,
      gearPresetId: p.g,
      tags: p.t,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  } catch {
    return null;
  }
}

export function makePrefabFromFace(
  face: AvatarConfig,
  role: PrefabRole = "player",
  partial: Partial<CharacterPrefab> = {},
): CharacterPrefab {
  const now = Date.now();
  const armorSetId = partial.armorSetId ?? null;
  return {
    version: 1,
    id: partial.id ?? uid(),
    name: partial.name ?? `${face.race} ${role}`,
    role,
    face,
    heightScale: partial.heightScale ?? (role === "boss" ? 1.25 : 1),
    bodyScaleXZ: partial.bodyScaleXZ ?? (face.race === "dwarf" ? 1.12 : face.race === "elf" ? 0.92 : 1),
    armorSetId,
    armorLoadout:
      partial.armorLoadout ??
      (armorSetId ? loadoutFromSet(armorSetId) : emptyArmorLoadout()),
    weaponId: (partial.weaponId as WeaponId) ?? "none",
    offHandId: partial.offHandId ?? null,
    gearPresetId: partial.gearPresetId,
    tags: partial.tags ?? [face.race, role],
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
  };
}

/** Role-biased generative roll for NPCs / enemies / allies. */
export function generatePrefab(
  role: PrefabRole = "enemy",
  race?: RaceId,
  rng: () => number = Math.random,
): CharacterPrefab {
  const face = race ? randomConfig(race, rng) : surpriseConfig(rng);
  const melee = WEAPONS.filter((w) => w.group === "melee-1h" || w.group === "melee-2h");
  const magic = WEAPONS.filter((w) => w.group === "magic");
  const ranged = WEAPONS.filter((w) => w.group === "ranged");
  const pickW = (list: typeof WEAPONS) =>
    list.length ? list[Math.floor(rng() * list.length)].id : ("none" as WeaponId);

  let weaponId: WeaponId = "none";
  let armorSetId: string | null = null;
  let heightScale = 1;
  let gearPresetId: string | undefined;

  switch (role) {
    case "enemy":
      weaponId = pickW(melee.length ? melee : WEAPONS);
      armorSetId = rng() > 0.4 ? ARMOR_SETS[Math.floor(rng() * ARMOR_SETS.length)].id : "leather";
      heightScale = 0.95 + rng() * 0.2;
      gearPresetId = "warrior";
      break;
    case "ally":
      weaponId = pickW([...melee, ...ranged]);
      armorSetId = "iron";
      gearPresetId = "knight";
      break;
    case "vendor":
      weaponId = "none";
      armorSetId = "leather";
      gearPresetId = "unarmed";
      break;
    case "boss":
      weaponId = pickW(melee.length ? melee : WEAPONS);
      armorSetId = "magic-arcane";
      heightScale = 1.2 + rng() * 0.2;
      gearPresetId = "warrior";
      break;
    case "npc":
      weaponId = rng() > 0.7 ? pickW(melee) : "none";
      armorSetId = rng() > 0.6 ? "leather" : null;
      gearPresetId = "unarmed";
      break;
    case "player":
    default:
      weaponId = pickW([...melee, ...ranged, ...magic]);
      armorSetId = "iron";
      gearPresetId = "knight";
      break;
  }

  return makePrefabFromFace(face, role, {
    weaponId,
    armorSetId,
    armorLoadout: armorSetId ? loadoutFromSet(armorSetId) : emptyArmorLoadout(),
    heightScale,
    gearPresetId,
    tags: [face.race, role, "generated"],
  });
}

/** Generate a small squad for deploy tests. */
export function generateSquad(
  count = 4,
  roles: PrefabRole[] = ["ally", "enemy", "enemy", "vendor"],
  rng: () => number = Math.random,
): CharacterPrefab[] {
  const out: CharacterPrefab[] = [];
  for (let i = 0; i < count; i++) {
    const role = roles[i % roles.length];
    const race = RACES[Math.floor(rng() * RACES.length)].id;
    out.push(generatePrefab(role, race, rng));
  }
  return out;
}

export function loadPrefabs(): CharacterPrefab[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFAB_STORE_KEY) ?? "[]") as unknown[];
    if (!Array.isArray(raw)) return [];
    return raw.map(sanitizePrefab).filter((p): p is CharacterPrefab => !!p);
  } catch {
    return [];
  }
}

export function savePrefabs(list: CharacterPrefab[]): void {
  try {
    localStorage.setItem(PREFAB_STORE_KEY, JSON.stringify(list.slice(0, 80)));
    window.dispatchEvent(new CustomEvent(PREFAB_SAVED_EVENT, { detail: { count: list.length } }));
  } catch {
    /* quota */
  }
}

export function upsertPrefab(prefab: CharacterPrefab): CharacterPrefab[] {
  const list = loadPrefabs();
  const i = list.findIndex((p) => p.id === prefab.id);
  const next = { ...prefab, updatedAt: Date.now() };
  if (i >= 0) list[i] = next;
  else list.unshift(next);
  savePrefabs(list);
  return list;
}

export function removePrefab(id: string): CharacterPrefab[] {
  const list = loadPrefabs().filter((p) => p.id !== id);
  savePrefabs(list);
  return list;
}

/** JSON export for fleet / Mine-Loader / deploy pipelines. */
export function exportPrefabsJson(list: CharacterPrefab[]): string {
  return JSON.stringify(
    {
      format: "grudge.characterPrefab.v1",
      exportedAt: Date.now(),
      count: list.length,
      prefabs: list.map((p) => ({
        ...p,
        faceCode: encodeConfig(p.face),
        heightM: raceHeightM(p.face.race, p.heightScale),
        deployCode: encodePrefab(p),
      })),
    },
    null,
    2,
  );
}
