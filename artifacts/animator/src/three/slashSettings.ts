/**
 * Device-local tuning for the editor's per-crescent slash-arc authoring tool.
 * Each crescent in `attack-slashes.glb` (indexed deterministically by mesh name)
 * gets its own parameter bundle. Persisted in localStorage, schema-versioned,
 * and clamped on load so a stale/corrupt blob can never feed NaN into the engine.
 *
 * This is the animator artifact, so NOTHING here may import `@workspace/*`.
 */

export interface SlashFxParams {
  /** Roll around the facing axis, in degrees (−180…180). */
  rotate: number;
  /** Overall size multiplier. */
  scale: number;
  /** Yaw aim of the swing, in degrees (−180…180). */
  direction: number;
  /** Curl amount: 0 = template shape, ±1 = strongly bent. */
  bend: number;
  /** Ribbon width multiplier (thin … fat). */
  thickness: number;
  /** Number of additive sparks emitted with the arc (0 = none). */
  particles: number;
  /** Tint as `#rrggbb` (HTML colour-input friendly). */
  color: string;
}

export const SLASH_FX_RANGES = {
  rotate: [-180, 180] as const,
  scale: [0.3, 3] as const,
  direction: [-180, 180] as const,
  bend: [-1, 1] as const,
  thickness: [0.3, 3] as const,
  particles: [0, 40] as const,
};

export type SlashFxNumKey = keyof typeof SLASH_FX_RANGES;

export const DEFAULT_SLASH_FX: SlashFxParams = {
  rotate: 0,
  scale: 1,
  direction: 0,
  bend: 0,
  thickness: 1,
  particles: 0,
  color: "#9fe8ff",
};

/** One stored bundle per crescent index. */
export type SlashFxStore = Record<number, SlashFxParams>;

const KEY = "dangerroom:slashfx";
const SCHEMA = 1;

const clampNum = (v: unknown, [min, max]: readonly [number, number], d: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
const hex = (v: unknown, d: string): string => (isHex(v) ? v.toLowerCase() : d);

function clampParams(o: Partial<SlashFxParams> | undefined): SlashFxParams {
  return {
    rotate: clampNum(o?.rotate, SLASH_FX_RANGES.rotate, DEFAULT_SLASH_FX.rotate),
    scale: clampNum(o?.scale, SLASH_FX_RANGES.scale, DEFAULT_SLASH_FX.scale),
    direction: clampNum(o?.direction, SLASH_FX_RANGES.direction, DEFAULT_SLASH_FX.direction),
    bend: clampNum(o?.bend, SLASH_FX_RANGES.bend, DEFAULT_SLASH_FX.bend),
    thickness: clampNum(o?.thickness, SLASH_FX_RANGES.thickness, DEFAULT_SLASH_FX.thickness),
    particles: Math.round(clampNum(o?.particles, SLASH_FX_RANGES.particles, DEFAULT_SLASH_FX.particles)),
    color: hex(o?.color, DEFAULT_SLASH_FX.color),
  };
}

export function loadSlashFx(): SlashFxStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as { schema?: number; arcs?: Record<string, Partial<SlashFxParams>> };
    if (o.schema !== SCHEMA || !o.arcs) return {};
    const out: SlashFxStore = {};
    for (const k of Object.keys(o.arcs)) {
      const idx = Number(k);
      if (Number.isInteger(idx) && idx >= 0) out[idx] = clampParams(o.arcs[k]);
    }
    return out;
  } catch {
    return {};
  }
}

export function saveSlashFx(store: SlashFxStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ schema: SCHEMA, arcs: store }));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

/** Params for a crescent index, falling back to defaults when untouched. */
export function slashFxFor(store: SlashFxStore, index: number): SlashFxParams {
  return store[index] ?? { ...DEFAULT_SLASH_FX };
}
