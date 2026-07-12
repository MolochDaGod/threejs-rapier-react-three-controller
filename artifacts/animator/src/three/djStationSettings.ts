/**
 * Device-local settings for the CPT RAC Station (Racalvin's DJ playlist):
 * auto-mix crossfading, the transition style used between songs, the crossfade
 * length, shuffle order, and whether the set starts on a random track. Persisted
 * in localStorage; mirrors the other dangerroom:* settings stores.
 *
 * This is the animator artifact, so NOTHING here may import `@workspace/*`.
 */

/** How one song blends into the next when auto-mix is on. */
export type DjTransition = "crossfade" | "filter" | "echo" | "cut";

export interface DjStationSettings {
  /** Blend into the next track before the current one ends (vs a plain cut). */
  autoMix: boolean;
  /** The sound of the blend when auto-mix is on. */
  transition: DjTransition;
  /** Crossfade / transition length in seconds (1..12). */
  crossfadeSec: number;
  /** Pick the next track at random instead of in playlist order. */
  shuffle: boolean;
  /** Start the set on a random track each fresh start (vs the top of the list). */
  randomStart: boolean;
}

/** Selectable transition styles, with user-facing labels. */
export const DJ_TRANSITIONS: readonly { id: DjTransition; label: string }[] = [
  { id: "crossfade", label: "Crossfade" },
  { id: "filter", label: "Filter sweep" },
  { id: "echo", label: "Echo out" },
  { id: "cut", label: "Hard cut" },
] as const;

const DEFAULTS: DjStationSettings = {
  autoMix: true,
  transition: "crossfade",
  crossfadeSec: 6,
  shuffle: false,
  randomStart: true,
};

const KEY = "dangerroom:djstation";

/** Load the station settings (falls back to defaults when unset/corrupt). */
export function loadDjStation(): DjStationSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<DjStationSettings>;
    return {
      autoMix: typeof p.autoMix === "boolean" ? p.autoMix : DEFAULTS.autoMix,
      transition: DJ_TRANSITIONS.some((t) => t.id === p.transition)
        ? (p.transition as DjTransition)
        : DEFAULTS.transition,
      crossfadeSec:
        typeof p.crossfadeSec === "number" && isFinite(p.crossfadeSec)
          ? Math.max(1, Math.min(12, p.crossfadeSec))
          : DEFAULTS.crossfadeSec,
      shuffle: typeof p.shuffle === "boolean" ? p.shuffle : DEFAULTS.shuffle,
      randomStart: typeof p.randomStart === "boolean" ? p.randomStart : DEFAULTS.randomStart,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Persist the station settings (best-effort; no-op if storage is unavailable). */
export function saveDjStation(s: DjStationSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}
