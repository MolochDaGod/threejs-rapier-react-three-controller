/**
 * Characters GRUDOX 4-slot roster bridge (controller / Animator shell).
 *
 * SSOT keys match open.grudge-studio.com + charactersgrudox:
 *   animator.lobby.roster.v1
 *   animator.lobby.roster.v1.u.<grudgeId>
 * Fleet rows fill remaining seats (max 4). Never injects lab cast demos
 * (ikkau / placeholder / accidental hard-coded heroes).
 */

import type { FleetCharacter } from "./fleetCharacter";
import { rememberAnimatorCharacter } from "./fleetCharacter";
import { rememberHeroFromContext, mapBaseToAnimatorId } from "./characterHubLaunch";

export const GRUDOX_MAX_SLOTS = 4;

export type GrudoxSavedCharacter = {
  uuid: string;
  slot: number;
  name: string;
  /** Base form id: explorer, race-human, grudge-western-kingdoms-knight, … */
  baseId: string;
  createdAt?: number;
};

const STORAGE_KEY = "animator.lobby.roster.v1";
const SELECTED_KEYS = [
  "grudge.open.selectedCharacterId",
  "grudge.activeCharId",
  "gruda_active_character",
] as const;

const DEMO_NAME_RE = /ikkau|ikkaku|demo|placeholder|test.?hero/i;

export function baseIdToRaceKey(baseId: string | null | undefined): string {
  const b = (baseId || "").toLowerCase().replace(/_/g, "-");
  if (!b || b === "explorer" || b === "led-monk" || b === "archmage") return "human";
  if (b.includes("orc")) return "orc";
  if (b.includes("undead") || b === "ud") return "undead";
  if (b.includes("barb")) return "barbarian";
  if (b.includes("dwarf") || b.includes("dwf")) return "dwarf";
  if (b.includes("elf")) return "elf";
  if (b.includes("human") || b.includes("kingdom") || b.includes("western") || b === "wk") {
    return "human";
  }
  if (b.startsWith("race-")) {
    const rest = b.slice(5);
    if (rest === "high-elf" || rest === "highelf") return "elf";
    return rest || "human";
  }
  return "human";
}

export function raceKeyToLabel(raceKey: string): string {
  if (raceKey === "elf" || raceKey === "high_elf") return "High Elf";
  const labels: Record<string, string> = {
    human: "Human",
    orc: "Orc",
    undead: "Undead",
    barbarian: "Barbarian",
    dwarf: "Dwarf",
  };
  return labels[raceKey] || "Hero";
}

export function baseIdToAnimatorId(baseId: string | null | undefined): string {
  const b = (baseId || "").toLowerCase();
  if (!b) return "explorer";
  if (b.startsWith("grudge-")) return b;
  if (b.startsWith("race-")) return b;
  if (b === "human") return "race-human";
  if (b === "orc") return "race-orc";
  if (b === "dwarf") return "race-dwarf";
  if (b.includes("elf")) return "race-high-elf";
  if (b.includes("barb")) return "race-barbarian";
  if (b.includes("undead")) return "race-undead";
  if (b === "explorer" || b === "grudge") return "explorer";
  // Prefer fleet modular kits over lab cast
  try {
    return mapBaseToAnimatorId(b);
  } catch {
    return b;
  }
}

function readRosterFromKey(key: string): GrudoxSavedCharacter[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: GrudoxSavedCharacter[] = [];
    for (const item of parsed) {
      const c = item as Partial<GrudoxSavedCharacter>;
      if (!c || typeof c.baseId !== "string") continue;
      const name = typeof c.name === "string" ? c.name : "";
      // Filter unintended demo cast
      if (DEMO_NAME_RE.test(name) || DEMO_NAME_RE.test(c.baseId)) continue;
      const slot = typeof c.slot === "number" ? c.slot : out.length;
      if (slot < 0 || slot >= GRUDOX_MAX_SLOTS) continue;
      const uuid =
        typeof c.uuid === "string" && c.uuid ? c.uuid : `grudox-slot-${slot}-${c.baseId}`;
      out.push({
        uuid,
        slot,
        name: name || "Adventurer",
        baseId: c.baseId,
        createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
      });
    }
    return out.sort((a, b) => a.slot - b.slot).slice(0, GRUDOX_MAX_SLOTS);
  } catch {
    return [];
  }
}

export function loadGrudoxRosterSlots(): GrudoxSavedCharacter[] {
  if (typeof localStorage === "undefined") return [];
  let grudgeId = "";
  try {
    grudgeId =
      localStorage.getItem("grudge_id") ||
      localStorage.getItem("grudge_account_id") ||
      "";
  } catch {
    /* */
  }
  if (grudgeId) {
    const scoped = readRosterFromKey(`${STORAGE_KEY}.u.${grudgeId}`);
    if (scoped.length) return scoped;
  }
  return readRosterFromKey(STORAGE_KEY);
}

/** Save / upsert a slot (create flow). */
export function saveGrudoxSlot(slot: GrudoxSavedCharacter): void {
  const list = loadGrudoxRosterSlots().filter((s) => s.slot !== slot.slot && s.uuid !== slot.uuid);
  list.push(slot);
  list.sort((a, b) => a.slot - b.slot);
  const trimmed = list.slice(0, GRUDOX_MAX_SLOTS);
  try {
    let grudgeId = "";
    try {
      grudgeId =
        localStorage.getItem("grudge_id") || localStorage.getItem("grudge_account_id") || "";
    } catch {
      /* */
    }
    const key = grudgeId ? `${STORAGE_KEY}.u.${grudgeId}` : STORAGE_KEY;
    localStorage.setItem(key, JSON.stringify(trimmed));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* */
  }
}

export type GenesisHeroOption = {
  id: string;
  name: string;
  baseId: string;
  raceKey: string;
  raceLabel: string;
  slot: number;
  source: "grudox" | "fleet";
};

const RACE_LABEL: Record<string, string> = {
  human: "Human",
  orc: "Orc",
  undead: "Undead",
  barbarian: "Barbarian",
  dwarf: "Dwarf",
  elf: "High Elf",
  high_elf: "High Elf",
};

function handoffMeta(): { id: string | null; baseId: string | null; name: string | null } {
  try {
    return {
      id:
        sessionStorage.getItem("grudge.open.selectedCharacterId") ||
        localStorage.getItem("grudge.open.selectedCharacterId") ||
        localStorage.getItem("grudge.activeCharId"),
      baseId:
        sessionStorage.getItem("grudge.open.baseId") ||
        localStorage.getItem("animator.activeCharacterId"),
      name: sessionStorage.getItem("grudge.open.characterName"),
    };
  } catch {
    return { id: null, baseId: null, name: null };
  }
}

/**
 * Build up to 4 campfire seats from account roster only.
 * Empty roster → empty array (UI shows empty seats + create). No lab cast.
 */
export function buildGenesisHeroOptions(
  fleet: Array<
    | FleetCharacter
    | {
        id: string;
        name?: string;
        raceId?: string;
        race?: string;
        class?: string;
        config?: Record<string, unknown>;
      }
  >,
  preferredId?: string | null,
): GenesisHeroOption[] {
  const slots = loadGrudoxRosterSlots();
  const options: GenesisHeroOption[] = [];
  const seen = new Set<string>();
  const handoff = handoffMeta();

  for (const s of slots) {
    if (options.length >= GRUDOX_MAX_SLOTS) break;
    const raceKey = baseIdToRaceKey(s.baseId);
    options.push({
      id: s.uuid,
      name: s.name,
      baseId: s.baseId,
      raceKey,
      raceLabel: RACE_LABEL[raceKey] || "Human",
      slot: s.slot,
      source: "grudox",
    });
    seen.add(s.uuid);
  }

  if (
    handoff.id &&
    !seen.has(handoff.id) &&
    options.length < GRUDOX_MAX_SLOTS &&
    !DEMO_NAME_RE.test(handoff.name || "")
  ) {
    const baseId = handoff.baseId || "explorer";
    const raceKey = baseIdToRaceKey(baseId);
    options.unshift({
      id: handoff.id,
      name: handoff.name || "Hero",
      baseId,
      raceKey,
      raceLabel: RACE_LABEL[raceKey] || "Human",
      slot: 0,
      source: "grudox",
    });
    seen.add(handoff.id);
  }

  for (const c of fleet) {
    if (options.length >= GRUDOX_MAX_SLOTS) break;
    if (!c?.id || seen.has(c.id)) continue;
    const name = c.name || "Hero";
    if (DEMO_NAME_RE.test(name)) continue;
    const cfg = (c as { config?: Record<string, unknown> }).config;
    const raceId = (c as FleetCharacter).raceId || (c as FleetCharacter).race;
    const baseId =
      (typeof cfg?.baseId === "string" && cfg.baseId) ||
      (raceId ? `race-${raceId}` : "explorer");
    const raceKey = baseIdToRaceKey(baseId) || baseIdToRaceKey(raceId);
    options.push({
      id: c.id,
      name,
      baseId,
      raceKey,
      raceLabel: RACE_LABEL[raceKey] || String(raceId || "Hero"),
      slot: options.length,
      source: "fleet",
    });
    seen.add(c.id);
  }

  if (preferredId) {
    const idx = options.findIndex((o) => o.id === preferredId);
    if (idx > 0) {
      const [pick] = options.splice(idx, 1);
      options.unshift(pick);
    }
  }

  return options.slice(0, GRUDOX_MAX_SLOTS);
}

/** Persist active campfire hero for danger room / fleet handoff (all voxel apps). */
export function activateCampfireHero(hero: GenesisHeroOption): string {
  const animId = baseIdToAnimatorId(hero.baseId);
  try {
    for (const k of SELECTED_KEYS) {
      localStorage.setItem(k, hero.id);
      sessionStorage.setItem(k, hero.id);
    }
    localStorage.setItem("grudge.open.baseId", hero.baseId);
    sessionStorage.setItem("grudge.open.baseId", hero.baseId);
    if (hero.name) {
      sessionStorage.setItem("grudge.open.characterName", hero.name);
    }
  } catch {
    /* */
  }
  rememberAnimatorCharacter(animId, hero.id);
  rememberHeroFromContext({
    characterId: hero.id,
    baseId: hero.baseId,
    name: hero.name,
  });
  return animId;
}
