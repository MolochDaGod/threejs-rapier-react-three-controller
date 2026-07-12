import type { VoxelMap } from "./types";
import { VOXEL_MAP_VERSION } from "./types";

/**
 * Multiple-named-map persistence for the Voxel Editor.
 *
 * The editor used to save a single map to one localStorage slot
 * (`dangerroom:voxelmap`), so authoring a second map overwrote the first. This
 * module gives every map a stable id + display name and stores them
 * independently:
 *   - `dangerroom:voxelmaps`         → JSON index `StoredMapMeta[]`
 *   - `dangerroom:voxelmap:<id>`     → JSON `VoxelMap` payload per map
 * The legacy single slot is migrated into a named entry on first access.
 *
 * No `@workspace/*` imports — this artifact is meant to be liftable on its own.
 */

const INDEX_KEY = "dangerroom:voxelmaps";
const MAP_PREFIX = "dangerroom:voxelmap:";
const LEGACY_KEY = "dangerroom:voxelmap";

/** Lightweight directory entry shown in the maps list. */
export interface StoredMapMeta {
  id: string;
  name: string;
  /** Epoch ms of the last save. */
  updatedAt: number;
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function readIndex(): StoredMapMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as StoredMapMeta[];
    if (!Array.isArray(list)) return [];
    return list.filter((m) => m && typeof m.id === "string" && typeof m.name === "string");
  } catch {
    return [];
  }
}

function writeIndex(list: StoredMapMeta[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

/** Validate a parsed object looks like a VoxelMap. */
function isVoxelMap(v: unknown): v is VoxelMap {
  return !!v && typeof v === "object" && Array.isArray((v as VoxelMap).blocks);
}

/**
 * One-time migration: if the old single-slot map exists and hasn't been
 * imported yet, fold it into the new index under a default name.
 */
function migrateLegacy(): void {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as unknown;
    if (isVoxelMap(map)) {
      const id = newId();
      localStorage.setItem(MAP_PREFIX + id, JSON.stringify(map));
      const index = readIndex();
      index.push({ id, name: "My Map", updatedAt: Date.now() });
      writeIndex(index);
    }
    // Remove the legacy slot so the migration only ever runs once.
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore corrupt legacy data */
  }
}

/** All saved maps, newest first. */
export function listMaps(): StoredMapMeta[] {
  migrateLegacy();
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Load a single map's full payload by id. Returns null if missing/corrupt. */
export function loadMap(id: string): VoxelMap | null {
  try {
    const raw = localStorage.getItem(MAP_PREFIX + id);
    if (!raw) return null;
    const map = JSON.parse(raw) as unknown;
    return isVoxelMap(map) ? (map as VoxelMap) : null;
  } catch {
    return null;
  }
}

/**
 * Save `map` under `name`. If `id` is given and still exists, that entry is
 * updated (and renamed); otherwise a map with a matching trimmed name is
 * overwritten; otherwise a new entry is created. Returns the entry's meta, or
 * null on failure (private mode / quota).
 */
export function saveMap(name: string, map: VoxelMap, id?: string): StoredMapMeta | null {
  const trimmed = name.trim() || "Untitled Map";
  try {
    migrateLegacy();
    const index = readIndex();
    let entry =
      (id && index.find((m) => m.id === id)) ||
      index.find((m) => m.name.toLowerCase() === trimmed.toLowerCase());
    if (entry) {
      entry.name = trimmed;
      entry.updatedAt = Date.now();
    } else {
      entry = { id: newId(), name: trimmed, updatedAt: Date.now() };
      index.push(entry);
    }
    localStorage.setItem(MAP_PREFIX + entry.id, JSON.stringify(map));
    writeIndex(index);
    return { ...entry };
  } catch {
    return null;
  }
}

/** Delete a map (payload + index entry). */
export function deleteMap(id: string): void {
  try {
    localStorage.removeItem(MAP_PREFIX + id);
    writeIndex(readIndex().filter((m) => m.id !== id));
  } catch {
    /* ignore */
  }
}

/** Serialize a map to a shareable JSON string. */
export function exportMap(map: VoxelMap): string {
  return JSON.stringify(map, null, 2);
}

/** Parse a shared JSON string into a VoxelMap. Returns null if invalid. */
export function importMap(json: string): VoxelMap | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!isVoxelMap(parsed)) return null;
    const map = parsed as VoxelMap;
    return {
      version: typeof map.version === "number" ? map.version : VOXEL_MAP_VERSION,
      dungeon: !!map.dungeon,
      blocks: Array.isArray(map.blocks) ? map.blocks : [],
      deployables: Array.isArray(map.deployables) ? map.deployables : [],
    };
  } catch {
    return null;
  }
}
