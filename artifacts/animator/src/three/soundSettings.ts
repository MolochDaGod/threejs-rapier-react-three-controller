/**
 * Device-local persistence for the sound mixer: the master on/off (mute) plus a
 * master volume and per-category levels (combat one-shots, ambient bed, warning
 * klaxon, background music) — everything routed through {@link CombatSfx}.
 *
 * This is the animator artifact, so NOTHING here may import `@workspace/*`.
 */

export interface SoundSettings {
  /** Hard on/off. When true everything is silenced regardless of the levels. */
  muted: boolean;
  /** Master multiplier applied on top of every category level (0..1). */
  master: number;
  /** Combat one-shot impacts/whooshes/blocks (0..1). */
  combat: number;
  /** Ambient room bed (0..1). */
  ambient: number;
  /** Low-integrity warning klaxon (0..1). */
  klaxon: number;
  /** Background music bed (0..1). */
  music: number;
}

/** A level of 1.0 reproduces the original (pre-mixer) loudness for each bucket. */
export const DEFAULT_SOUND: SoundSettings = {
  muted: false,
  master: 1,
  combat: 1,
  ambient: 1,
  klaxon: 1,
  music: 1,
};

const KEY = "dangerroom:sound";
/** Pre-mixer key that stored only the boolean mute ("1"/"0"). */
const LEGACY_MUTE_KEY = "dangerroom:muted";

function clamp01(n: unknown, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

/** Read the persisted sound settings, migrating the legacy mute-only key. */
export function loadSound(): SoundSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<SoundSettings>;
      return {
        muted: typeof p.muted === "boolean" ? p.muted : DEFAULT_SOUND.muted,
        master: clamp01(p.master, DEFAULT_SOUND.master),
        combat: clamp01(p.combat, DEFAULT_SOUND.combat),
        ambient: clamp01(p.ambient, DEFAULT_SOUND.ambient),
        klaxon: clamp01(p.klaxon, DEFAULT_SOUND.klaxon),
        music: clamp01(p.music, DEFAULT_SOUND.music),
      };
    }
    // Migrate the old boolean-only mute preference if present.
    const legacy = localStorage.getItem(LEGACY_MUTE_KEY);
    if (legacy != null) return { ...DEFAULT_SOUND, muted: legacy === "1" };
  } catch {
    /* storage unavailable — fall through to defaults */
  }
  return { ...DEFAULT_SOUND };
}

/** Persist the full sound settings. */
export function saveSound(s: SoundSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}
