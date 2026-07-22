/**
 * Bridge: Grudge ID / GRUDOX Warlords characters → Animator playable IDs.
 *
 * Characters are authored on grudox.grudge-studio.com (and fleet apps) and stored
 * via the Railway/API character service. This module resolves the active character
 * into an Animator `characterId` of the form `grudge-{race}-{class}` so Studio can
 * spawn a {@link GrudgeAvatar} (modular race FBX + gear preset) as the player.
 */

import type { WeaponId } from "../three/types";
import {
  FLEET,
  apiUrl,
  captureSsoFromUrl,
  gameDataUrl,
  readFleetToken as readCoreToken,
} from "./fleetCore";

/** Wire-name unit separator (fleet multiplayer display|animId|fleetId). */
const WIRE_SEP = "\u001f";

function encodeWireParts(displayName: string, characterId: string, fleetId: string): string {
  return [displayName || "Player", characterId || "explorer", fleetId || "local"].join(WIRE_SEP);
}

function decodeWireParts(wire: string): {
  displayName: string;
  characterId: string | null;
  fleetId: string | null;
} {
  if (!wire) return { displayName: "Player", characterId: null, fleetId: null };
  if (!wire.includes(WIRE_SEP)) {
    return { displayName: wire, characterId: null, fleetId: null };
  }
  const [displayName, characterId, fleetId] = wire.split(WIRE_SEP);
  return {
    displayName: displayName || "Player",
    characterId: characterId || null,
    fleetId: fleetId || null,
  };
}

export {
  buildFleetLoginUrl,
  buildCharacterCreateUrl,
  buildGrudoxGameUrl,
  launchGameopen,
  GRUDOX_GAMES,
  FLEET,
  captureSsoFromUrl,
  readFleetToken,
  type GrudoxGameId,
} from "./fleetCore";

export type GrudgeRaceSlug =
  | "barbarians"
  | "dwarves"
  | "high-elves"
  | "orcs"
  | "undead"
  | "western-kingdoms";

export type GrudgeClassSlug = "knight" | "warrior" | "ranger" | "mage" | "unarmed";

export interface FleetCharacter {
  id: string;
  name?: string;
  race?: string;
  raceId?: string;
  class?: string;
  classId?: string;
  heroClass?: string;
  modelPath?: string;
  appearance?: Record<string, unknown>;
  equipment?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FleetPlayerLoadout {
  /** Animator character catalog id, e.g. grudge-barbarians-knight */
  characterId: string;
  race: GrudgeRaceSlug;
  classSlug: GrudgeClassSlug;
  /** Preferred main-hand weapon for Studio loadout */
  weaponId: WeaponId;
  offHand: WeaponId | null;
  /** Original fleet character row */
  source: FleetCharacter;
  /** Display name for HUD */
  displayName: string;
  /** Railway character UUID */
  fleetId: string;
  /** Combat power hints from class / equipment */
  atk: number;
  maxHp: number;
  /** True when resolved from a signed-in account row (not a local fallback). */
  authenticated: boolean;
}

/** Railway character SSOT — prefer same-origin proxy, then env, then production API. */
const GAME_API =
  (typeof import.meta !== "undefined" &&
    (import.meta.env?.VITE_GAME_API_URL as string | undefined)) ||
  FLEET.gameData;

const ACTIVE_CHAR_KEYS = ["grudge.activeCharId", "gruda_active_character"] as const;

const RACE_MAP: Record<string, GrudgeRaceSlug> = {
  barbarian: "barbarians",
  barbarians: "barbarians",
  brb: "barbarians",
  dwarf: "dwarves",
  dwarves: "dwarves",
  dwf: "dwarves",
  elf: "high-elves",
  elves: "high-elves",
  "high-elf": "high-elves",
  "high-elves": "high-elves",
  highelves: "high-elves",
  elf_high: "high-elves",
  orc: "orcs",
  orcs: "orcs",
  undead: "undead",
  ud: "undead",
  human: "western-kingdoms",
  humans: "western-kingdoms",
  wk: "western-kingdoms",
  "western-kingdoms": "western-kingdoms",
  westernkingdoms: "western-kingdoms",
  kingdom: "western-kingdoms",
  crusade: "western-kingdoms",
};

const CLASS_MAP: Record<string, GrudgeClassSlug> = {
  knight: "knight",
  paladin: "knight",
  captain: "knight",
  warrior: "warrior",
  fighter: "warrior",
  barbarian: "warrior",
  champion: "warrior",
  melee: "warrior",
  ranger: "ranger",
  archer: "ranger",
  hunter: "ranger",
  ranged: "ranger",
  mage: "mage",
  wizard: "mage",
  magic: "mage",
  sorcerer: "mage",
  priest: "mage",
  warlock: "mage",
  witch: "mage",
  unarmed: "unarmed",
  civilian: "unarmed",
  monk: "unarmed",
};

const CLASS_WEAPONS: Record<GrudgeClassSlug, { weaponId: WeaponId; offHand: WeaponId | null }> = {
  knight: { weaponId: "sword", offHand: "shield" },
  warrior: { weaponId: "greataxe", offHand: null },
  ranger: { weaponId: "bow", offHand: null },
  mage: { weaponId: "staffFire", offHand: null },
  unarmed: { weaponId: "none", offHand: null },
};

const CLASS_COMBAT: Record<GrudgeClassSlug, { atk: number; maxHp: number }> = {
  knight: { atk: 16, maxHp: 140 },
  warrior: { atk: 20, maxHp: 120 },
  ranger: { atk: 14, maxHp: 100 },
  mage: { atk: 18, maxHp: 90 },
  unarmed: { atk: 10, maxHp: 110 },
};

/** Map equipment / item name strings onto Animator weapon ids. */
const WEAPON_ALIASES: Record<string, WeaponId> = {
  sword: "sword",
  longsword: "sword",
  blade: "sword",
  greatsword: "greatsword",
  greataxe: "greataxe",
  axe: "axe",
  bow: "bow",
  longbow: "bow",
  staff: "staffFire",
  stafffire: "staffFire",
  staff_fire: "staffFire",
  wand: "staffFire",
  spear: "spear",
  hammer: "hammer",
  mace: "hammer",
  dagger: "dagger",
  knife: "dagger",
  shield: "shield",
  pistol: "pistol",
  rifle: "rifle",
  none: "none",
};

function readToken(): string | null {
  return readCoreToken() || captureSsoFromUrl();
}

function parseWeaponId(raw: unknown): WeaponId | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const n = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (WEAPON_ALIASES[n]) return WEAPON_ALIASES[n];
    if (WEAPON_ALIASES[n.replace(/_/g, "")]) return WEAPON_ALIASES[n.replace(/_/g, "")];
    for (const [k, v] of Object.entries(WEAPON_ALIASES)) {
      if (n.includes(k)) return v;
    }
    return null;
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return (
      parseWeaponId(o.weaponId) ||
      parseWeaponId(o.weapon) ||
      parseWeaponId(o.id) ||
      parseWeaponId(o.itemId) ||
      parseWeaponId(o.slug) ||
      parseWeaponId(o.name)
    );
  }
  return null;
}

/** Pull main-hand / off-hand from character equipment bag if present. */
export function equipmentWeapons(c: FleetCharacter): {
  weaponId: WeaponId | null;
  offHand: WeaponId | null;
} {
  const eq = (c.equipment || c.loadout || c.gear || {}) as Record<string, unknown>;
  const main =
    parseWeaponId(eq.mainHand) ||
    parseWeaponId(eq.mainhand) ||
    parseWeaponId(eq.weapon) ||
    parseWeaponId(eq.rightHand) ||
    parseWeaponId(eq.weaponMain) ||
    parseWeaponId(c.weaponId) ||
    parseWeaponId(c.weapon);
  const off =
    parseWeaponId(eq.offHand) ||
    parseWeaponId(eq.offhand) ||
    parseWeaponId(eq.leftHand) ||
    parseWeaponId(eq.shield) ||
    null;
  return { weaponId: main, offHand: off };
}

function readActiveCharId(): string | null {
  try {
    for (const k of ACTIVE_CHAR_KEYS) {
      const v = localStorage.getItem(k);
      if (v) return v;
    }
    // gruda_active_character_<gid>
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("gruda_active_character_") && localStorage.getItem(key)) {
        return localStorage.getItem(key);
      }
    }
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    const p = new URLSearchParams(window.location.search);
    return p.get("characterId") || p.get("charId");
  }
  return null;
}

function norm(s: string | undefined | null): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

export function mapRace(raw: string | undefined | null): GrudgeRaceSlug {
  const n = norm(raw);
  if (RACE_MAP[n]) return RACE_MAP[n];
  // fuzzy
  if (n.includes("barb")) return "barbarians";
  if (n.includes("dwarf")) return "dwarves";
  if (n.includes("elf")) return "high-elves";
  if (n.includes("orc")) return "orcs";
  if (n.includes("undead") || n.includes("dead")) return "undead";
  return "western-kingdoms";
}

export function mapClass(raw: string | undefined | null): GrudgeClassSlug {
  const n = norm(raw);
  if (CLASS_MAP[n]) return CLASS_MAP[n];
  if (n.includes("mage") || n.includes("magic") || n.includes("wiz")) return "mage";
  if (n.includes("range") || n.includes("arch") || n.includes("bow")) return "ranger";
  if (n.includes("knight") || n.includes("paladin")) return "knight";
  if (n.includes("war") || n.includes("melee") || n.includes("fight")) return "warrior";
  return "warrior";
}

/** Build Animator character id used by Studio + AdminPanel catalog. */
export function toAnimatorCharacterId(race: GrudgeRaceSlug, cls: GrudgeClassSlug): string {
  // Catalog entries use grudge-{slug}-{class}; unarmed falls back to warrior kit with none weapon
  const kit = cls === "unarmed" ? "warrior" : cls;
  return `grudge-${race}-${kit}`;
}

export function fleetCharacterToLoadout(c: FleetCharacter, authenticated = true): FleetPlayerLoadout {
  const race = mapRace(c.raceId || c.race || (c.appearance as { race?: string } | undefined)?.race);
  const classSlug = mapClass(
    c.classId || c.class || c.heroClass || (c.appearance as { class?: string } | undefined)?.class,
  );
  const defaults = CLASS_WEAPONS[classSlug];
  const combat = CLASS_COMBAT[classSlug];
  const fromEq = equipmentWeapons(c);
  const characterId = toAnimatorCharacterId(race, classSlug);
  // Optional HP from progress / stats envelopes
  const stats = (c.stats || c.attributes || c.progress || {}) as Record<string, unknown>;
  const maxHpRaw = Number(stats.maxHp ?? stats.hp ?? stats.health ?? c.maxHp ?? c.hp);
  const maxHp = Number.isFinite(maxHpRaw) && maxHpRaw > 20 ? maxHpRaw : combat.maxHp;
  const atkRaw = Number(stats.atk ?? stats.attack ?? stats.power ?? c.atk);
  const atk = Number.isFinite(atkRaw) && atkRaw > 0 ? atkRaw : combat.atk;
  return {
    characterId,
    race,
    classSlug,
    weaponId: fromEq.weaponId || defaults.weaponId,
    offHand: fromEq.offHand ?? defaults.offHand,
    source: c,
    displayName: c.name || `${race} ${classSlug}`,
    fleetId: String(c.id || ""),
    atk,
    maxHp,
    authenticated,
  };
}

/** Guest kit when not signed in — still Warlords modular mesh, not account-bound. */
export function guestLoadout(): FleetPlayerLoadout {
  return fleetCharacterToLoadout(
    {
      id: "guest",
      name: "Guest Adventurer",
      race: "western-kingdoms",
      class: "warrior",
    },
    false,
  );
}

/** Wire name for multiplayer: display + animator id + fleet uuid (unit-separator). */
export function encodeWirePlayerName(loadout: FleetPlayerLoadout): string {
  return encodeWireParts(
    loadout.displayName,
    loadout.characterId,
    loadout.fleetId || "local",
  );
}

/** Decode multiplayer wire name — fleet SSOT `@workspace/grudge-runtime`. */
export function decodeWirePlayerName(wire: string): {
  displayName: string;
  characterId: string | null;
  fleetId: string | null;
} {
  return decodeWireParts(wire);
}

function parseCharactersPayload(raw: unknown): FleetCharacter[] {
  if (Array.isArray(raw)) return raw as FleetCharacter[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { characters?: unknown }).characters)) {
    return (raw as { characters: FleetCharacter[] }).characters;
  }
  return [];
}

/** Fetch Warlords-era characters for the signed-in account (empty if logged out). */
export async function listFleetCharacters(opts?: {
  apiBase?: string;
  token?: string | null;
}): Promise<FleetCharacter[]> {
  const gf =
    (typeof window !== "undefined" &&
      (window as unknown as { GrudgeFleet?: GrudgeFleetLike }).GrudgeFleet) ||
    null;
  if (gf?.getCharacters) {
    try {
      await gf.ready?.();
      const list = gf.getCharacters?.() || [];
      if (list.length) return list as FleetCharacter[];
    } catch {
      /* fall through to HTTP */
    }
  }

  captureSsoFromUrl();
  const token = opts?.token !== undefined ? opts.token : readToken();
  if (!token) return [];

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  // Prefer same-origin proxy (Vercel rewrite → Railway), then absolute SSOT.
  const urls = [
    apiUrl("/api/characters?era=warlords"),
    apiUrl("/api/characters"),
    opts?.apiBase
      ? `${opts.apiBase.replace(/\/+$/, "")}/api/characters?era=warlords`
      : "",
    gameDataUrl("/api/characters?era=warlords"),
    `${GAME_API.replace(/\/+$/, "")}/api/characters?era=warlords`,
  ].filter(Boolean);

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, credentials: "include", mode: "cors" });
      if (!res.ok) continue;
      const list = parseCharactersPayload(await res.json());
      if (list.length) return list;
    } catch {
      /* try next */
    }
  }
  return [];
}

/**
 * Fetch the player's characters from the fleet API and return the active one's loadout.
 * Returns null when not signed in or no characters exist.
 */
export async function resolveFleetPlayerLoadout(opts?: {
  apiBase?: string;
  token?: string | null;
  characterId?: string | null;
}): Promise<FleetPlayerLoadout | null> {
  // Prefer live GrudgeFleet if the host page injected it (GRUDOX iframe / embed)
  const gf =
    (typeof window !== "undefined" &&
      (window as unknown as { GrudgeFleet?: GrudgeFleetLike }).GrudgeFleet) ||
    null;
  if (gf?.getActiveCharacter) {
    try {
      await gf.ready?.();
      const active = gf.getActiveCharacter();
      if (active) return fleetCharacterToLoadout(active as FleetCharacter);
      const list = gf.getCharacters?.() || [];
      if (list.length) return fleetCharacterToLoadout(list[0] as FleetCharacter);
    } catch (e) {
      console.warn("[fleetCharacter] GrudgeFleet bridge failed", e);
    }
  }

  const list = await listFleetCharacters(opts);
  if (!list.length) return null;

  const prefer = opts?.characterId || readActiveCharId();
  const chosen =
    (prefer && list.find((c) => c.id === prefer || String(c.id) === prefer)) || list[0];
  return fleetCharacterToLoadout(chosen);
}

interface GrudgeFleetLike {
  ready?: () => Promise<unknown>;
  getActiveCharacter?: () => FleetCharacter | null;
  getCharacters?: () => FleetCharacter[];
}

/** Persist animator selection so reloads keep the fleet character. */
export function rememberAnimatorCharacter(characterId: string, fleetCharId?: string): void {
  try {
    localStorage.setItem("animator.activeCharacterId", characterId);
    if (fleetCharId) localStorage.setItem("grudge.activeCharId", fleetCharId);
  } catch {
    /* ignore */
  }
}

export function readRememberedAnimatorCharacter(): string | null {
  try {
    return localStorage.getItem("animator.activeCharacterId");
  } catch {
    return null;
  }
}
