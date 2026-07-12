import { DJ_STATION_NAME, djStationUrls, djStationTitles } from "./djPlaylist";
import { musicStation } from "./musicStation";

/**
 * The selectable music stations. "cpt-rac" is the local CPT RAC Station
 * (Racalvin's bundled set); every other station streams free, legal music from
 * Audius (a free music platform with an open, CORS-enabled API — no key needed),
 * filtered to one genre so each reads as its own radio station. Instrumental
 * styles (lo-fi / ambient / classical / jazz) cover "music to build to".
 */
export interface RadioStationDef {
  id: string;
  name: string;
  /** Audius genre filter, or null for the local bundled playlist. */
  genre: string | null;
  /** Short user-facing description (tooltip). */
  hint: string;
}

export const RADIO_STATIONS: readonly RadioStationDef[] = [
  { id: "cpt-rac", name: DJ_STATION_NAME, genre: null, hint: "Racalvin's own set — pirate trap anthems" },
  { id: "lofi", name: "Lo-Fi Beats", genre: "Lo-Fi", hint: "Chill instrumental lo-fi — streamed free from Audius" },
  { id: "ambient", name: "Ambient Drift", genre: "Ambient", hint: "Atmospheric instrumentals — streamed free from Audius" },
  { id: "classical", name: "Classical & Score", genre: "Classical", hint: "Orchestral & piano instrumentals — streamed free from Audius" },
  { id: "jazz", name: "Jazz Lounge", genre: "Jazz", hint: "Jazz — streamed free from Audius" },
  { id: "electronic", name: "Electronic", genre: "Electronic", hint: "Electronic — streamed free from Audius" },
  { id: "hiphop", name: "Hip-Hop", genre: "Hip-Hop/Rap", hint: "Hip-hop & rap — streamed free from Audius" },
  { id: "rock", name: "Rock", genre: "Rock", hint: "Rock — streamed free from Audius" },
] as const;

const STATION_KEY = "dangerroom:radiostation";
const APP_NAME = "grudge-animator";
/** How many trending tracks each Audius station carries. */
const STATION_SIZE = 20;

/** Load the persisted station choice (defaults to the local CPT RAC set). */
export function loadStationId(): string {
  try {
    const id = localStorage.getItem(STATION_KEY);
    if (id && RADIO_STATIONS.some((s) => s.id === id)) return id;
  } catch {
    /* storage unavailable */
  }
  return "cpt-rac";
}

/** Persist the station choice (best-effort). */
export function saveStationId(id: string): void {
  try {
    localStorage.setItem(STATION_KEY, id);
  } catch {
    /* storage unavailable */
  }
}

export interface StationPlaylist {
  urls: string[];
  titles: string[];
}

/**
 * Per-station playlist cache. Audius fetches are cached for the session so a
 * mode switch (Studio rebuild) can re-assert the SAME url list — musicStation's
 * idempotent setPlaylist then leaves playback untouched.
 */
const cache = new Map<string, StationPlaylist>();

interface AudiusTrack {
  id: string;
  title: string;
  duration?: number;
  is_streamable?: boolean;
  user?: { name?: string };
}

/** Resolve a live Audius API host (their root endpoint lists healthy hosts). */
async function audiusHost(): Promise<string> {
  const res = await fetch("https://api.audius.co");
  if (!res.ok) throw new Error(`audius host lookup failed: ${res.status}`);
  const body = (await res.json()) as { data?: string[] };
  const host = body.data?.[0];
  if (!host) throw new Error("audius host lookup returned no hosts");
  return host;
}

/** Fetch a genre's trending tracks from Audius as a ready-to-play playlist. */
async function fetchAudiusPlaylist(genre: string): Promise<StationPlaylist> {
  const host = await audiusHost();
  const url = `${host}/v1/tracks/trending?genre=${encodeURIComponent(genre)}&time=week&app_name=${APP_NAME}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`audius trending failed: ${res.status}`);
  const body = (await res.json()) as { data?: AudiusTrack[] };
  const tracks = (body.data ?? [])
    .filter(
      (t) =>
        t.is_streamable !== false &&
        typeof t.duration === "number" &&
        t.duration >= 60 &&
        t.duration <= 600,
    )
    .slice(0, STATION_SIZE);
  if (tracks.length === 0) throw new Error(`audius returned no playable ${genre} tracks`);
  return {
    urls: tracks.map((t) => `${host}/v1/tracks/${t.id}/stream?app_name=${APP_NAME}`),
    titles: tracks.map((t) => (t.user?.name ? `${t.title} — ${t.user.name}` : t.title)),
  };
}

/**
 * Resolve a station's playlist (local list instantly; Audius via a cached
 * fetch). Throws on network/API failure for Audius stations.
 */
export async function stationPlaylist(id: string): Promise<StationPlaylist> {
  const def = RADIO_STATIONS.find((s) => s.id === id) ?? RADIO_STATIONS[0];
  if (!def.genre) return { urls: djStationUrls(), titles: djStationTitles() };
  const hit = cache.get(def.id);
  if (hit) return hit;
  const list = await fetchAudiusPlaylist(def.genre);
  cache.set(def.id, list);
  return list;
}

/**
 * Re-assert the CURRENTLY SELECTED station's playlist through `apply` (e.g. a
 * freshly-built Studio's CombatSfx). Local station applies synchronously;
 * Audius stations apply from cache when available, else fetch then apply —
 * falling back to the local set if the stream source is unreachable, so a dead
 * network never leaves the room silent. Always safe to call: an unchanged
 * playlist is a no-op inside musicStation.
 */
export function assertStation(apply: (urls: string[], titles: string[]) => void): void {
  const def = RADIO_STATIONS.find((s) => s.id === loadStationId()) ?? RADIO_STATIONS[0];
  musicStation.setStationName(def.name);
  if (!def.genre) {
    apply(djStationUrls(), djStationTitles());
    return;
  }
  const hit = cache.get(def.id);
  if (hit) {
    apply(hit.urls, hit.titles);
    return;
  }
  void stationPlaylist(def.id)
    .then((list) => apply(list.urls, list.titles))
    .catch(() => {
      musicStation.setStationName(DJ_STATION_NAME);
      apply(djStationUrls(), djStationTitles());
    });
}
