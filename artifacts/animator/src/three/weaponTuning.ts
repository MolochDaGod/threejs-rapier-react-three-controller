import { getWeapon } from "./assets";
import { WEAPON_GRIPS } from "./arsenal";
import type { WeaponHitShape } from "./types";

/**
 * Persisted per-weapon placement tuning authored in the Dressing Room arsenal
 * tuner: grip transform, longest-axis size, and the swept blade collider. Applied
 * onto the shared weapon catalog at startup so tuned values carry into BOTH the
 * Dressing Room and live combat, and survive a reload.
 *
 * Keyed by weapon id; per-tier grip/size overrides (for tiers with their own
 * model) live under `tiers` so tuning a tier variant also survives a reload.
 */
export interface WeaponTuning {
  grip?: { pos: [number, number, number]; rot: [number, number, number] };
  size?: number;
  hit?: WeaponHitShape;
  /** Per-tier grip/size overrides (tiers that carry their own model). */
  tiers?: Record<number, { grip?: { pos: [number, number, number]; rot: [number, number, number] }; size?: number }>;
}

type TuningMap = Record<string, WeaponTuning>;

const KEY = "animator:weaponTuning:v1";

function load(): TuningMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? (data as TuningMap) : {};
  } catch {
    return {};
  }
}

function save(map: TuningMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage full / unavailable — tuning stays session-only */
  }
}

/** Read the stored tuning for one weapon (empty object when none). */
export function getWeaponTuning(id: string): WeaponTuning {
  return load()[id] ?? {};
}

/** Merge a base-def tuning patch for one weapon and persist it. */
export function patchWeaponTuning(id: string, patch: WeaponTuning): void {
  const map = load();
  map[id] = { ...map[id], ...patch };
  save(map);
}

/** Merge a grip/size patch for one tier variant of a weapon and persist it. */
export function patchWeaponTierTuning(
  id: string,
  tier: number,
  patch: { grip?: { pos: [number, number, number]; rot: [number, number, number] }; size?: number },
): void {
  const map = load();
  const cur = map[id] ?? {};
  const tiers = { ...(cur.tiers ?? {}) };
  tiers[tier] = { ...tiers[tier], ...patch };
  map[id] = { ...cur, tiers };
  save(map);
}

let applied = false;

/**
 * Apply all stored tuning onto the shared weapon catalog. Idempotent + safe to
 * call from multiple engine constructors — only the first call mutates the defs.
 */
export function applyWeaponTuning(): void {
  if (applied) return;
  applied = true;
  const map = load();
  for (const [id, t] of Object.entries(map)) {
    const def = getWeapon(id);
    if (def.id === "none") continue;
    if (t.grip) {
      if (!def.grip) def.grip = { main: { rot: [0, 0, 0], pos: [0, 0, 0] } };
      def.grip.main.pos = [...t.grip.pos];
      def.grip.main.rot = [...t.grip.rot];
      WEAPON_GRIPS[def.id] = def.grip;
    }
    if (t.size != null && def.model) def.model.main.length = t.size;
    if (t.hit) def.hit = { a: [...t.hit.a], b: [...t.hit.b], radius: t.hit.radius };
    if (t.tiers && def.tiers) {
      for (const [ts, tt] of Object.entries(t.tiers)) {
        const tierDef = def.tiers[Number(ts)];
        if (!tierDef) continue;
        if (tt.grip) tierDef.grip = { pos: [...tt.grip.pos], rot: [...tt.grip.rot] };
        if (tt.size != null && tierDef.model) tierDef.model.length = tt.size;
      }
    }
  }
}
