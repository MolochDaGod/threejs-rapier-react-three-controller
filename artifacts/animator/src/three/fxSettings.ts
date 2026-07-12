/**
 * Device-local tuning for the GPU flame system (trailing weapon fire + impact
 * explode). Persisted in localStorage, schema-versioned, and clamped on load so
 * a stale/corrupt blob can never feed NaN into the shader uniforms.
 *
 * This is the animator artifact, so NOTHING here may import `@workspace/*`.
 */

export interface FireFxParams {
  /** Overall additive brightness multiplier. */
  brightness: number;
  /** Sideways sin/cos sway amount of rising embers. */
  turbulence: number;
  /** Point-sprite size multiplier. */
  sizeMult: number;
  /** Life-cycle speed multiplier (how fast embers rise + recycle). */
  speedMult: number;
  /** Horizontal drift bias (-1 left … +1 right). */
  sideBias: number;
  /** 4-stop palette, inner → outer, as `#rrggbb` (HTML colour-input friendly). */
  core: string;
  mid: string;
  edge: string;
  dark: string;
}

export const FIRE_FX_RANGES = {
  brightness: [0.5, 3] as const,
  turbulence: [0.5, 4] as const,
  sizeMult: [1, 5] as const,
  speedMult: [0.5, 3] as const,
  sideBias: [-1, 1] as const,
};

export type FireFxNumKey = keyof typeof FIRE_FX_RANGES;

/** Reference flaming-sword defaults. */
export const DEFAULT_FIRE_FX: FireFxParams = {
  brightness: 2.0,
  turbulence: 2.5,
  sizeMult: 3.0,
  speedMult: 1.6,
  sideBias: 0.6,
  core: "#fff099",
  mid: "#ff8a1a",
  edge: "#f22703",
  dark: "#660f03",
};

/** Cool "chi" palette for energy-themed characters (Tera-kasi). */
export const CHI_FIRE_COLORS = {
  core: "#ddf4ff",
  mid: "#4fa8ff",
  edge: "#2b6cff",
  dark: "#05123a",
} as const;

const KEY = "dangerroom:firefx";
const SCHEMA = 1;

const clampNum = (v: unknown, [min, max]: readonly [number, number], d: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
const hex = (v: unknown, d: string): string => (isHex(v) ? v.toLowerCase() : d);

export function loadFireFx(): FireFxParams {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_FIRE_FX };
    const o = JSON.parse(raw) as Partial<FireFxParams> & { schema?: number };
    if (o.schema !== SCHEMA) return { ...DEFAULT_FIRE_FX };
    return {
      brightness: clampNum(o.brightness, FIRE_FX_RANGES.brightness, DEFAULT_FIRE_FX.brightness),
      turbulence: clampNum(o.turbulence, FIRE_FX_RANGES.turbulence, DEFAULT_FIRE_FX.turbulence),
      sizeMult: clampNum(o.sizeMult, FIRE_FX_RANGES.sizeMult, DEFAULT_FIRE_FX.sizeMult),
      speedMult: clampNum(o.speedMult, FIRE_FX_RANGES.speedMult, DEFAULT_FIRE_FX.speedMult),
      sideBias: clampNum(o.sideBias, FIRE_FX_RANGES.sideBias, DEFAULT_FIRE_FX.sideBias),
      core: hex(o.core, DEFAULT_FIRE_FX.core),
      mid: hex(o.mid, DEFAULT_FIRE_FX.mid),
      edge: hex(o.edge, DEFAULT_FIRE_FX.edge),
      dark: hex(o.dark, DEFAULT_FIRE_FX.dark),
    };
  } catch {
    return { ...DEFAULT_FIRE_FX };
  }
}

export function saveFireFx(p: FireFxParams): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...p, schema: SCHEMA }));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}
