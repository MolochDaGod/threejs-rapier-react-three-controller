import {
  DJ_STATION_NAME,
  djStationUrls,
  djStationTitles,
  djProducerTagUrl,
} from "./djPlaylist";
import { musicStation } from "./musicStation";

/**
 * The selectable music stations. "cpt-rac" is the local CPT RAC Station
 * (Racalvin's bundled set); every other station streams free, legal music from
 * Audius (open music catalog, free tier, no API key) — one genre per station so
 * each reads as its own radio channel.
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
  { id: "lofi", name: "Lo-Fi Beats", genre: "Lo-Fi", hint: "Chill instrumental lo-fi — free via Audius" },
  { id: "ambient", name: "Ambient Drift", genre: "Ambient", hint: "Atmospheric instrumentals — free via Audius" },
  { id: "classical", name: "Classical & Score", genre: "Classical", hint: "Orchestral & piano — free via Audius" },
  { id: "jazz", name: "Jazz Lounge", genre: "Jazz", hint: "Jazz — free via Audius" },
  { id: "electronic", name: "Electronic", genre: "Electronic", hint: "Electronic — free via Audius" },
  { id: "hiphop", name: "Hip-Hop", genre: "Hip-Hop/Rap", hint: "Hip-hop & rap — free via Audius" },
  { id: "rock", name: "Rock", genre: "Rock", hint: "Rock — free via Audius" },
] as const;

const STATION_KEY = "dangerroom:radiostation";
const APP_NAME = "grudge-animator";
/** How many tracks each free stream station carries. */
const STATION_SIZE = 20;

/**
 * Known-good Audius API hosts. Discovery used to return a rotating list of
 * provider URLs; the root endpoint now often only returns api.audius.co itself.
 * We still try discovery first, then fall through this stable list.
 */
const AUDIUS_HOSTS = [
  "https://api.audius.co",
  "https://discoveryprovider.audius.co",
  "https://audius-discovery-1.cultur3stake.com",
  "https://audius-discovery-2.cultur3stake.com",
] as const;

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
 * Per-station playlist cache. Fetches are cached for the session so a mode
 * switch can re-assert the SAME url list — musicStation's idempotent setPlaylist
 * then leaves playback untouched.
 */
const cache = new Map<string, StationPlaylist>();

interface AudiusTrack {
  id: string;
  title: string;
  duration?: number;
  is_streamable?: boolean;
  is_stream_gated?: boolean;
  access?: { stream?: boolean };
  stream?: { url?: string };
  user?: { name?: string };
}

/** True when a track is free-to-stream in the browser. */
function isPlayable(t: AudiusTrack): boolean {
  if (t.is_streamable === false) return false;
  if (t.is_stream_gated === true) return false;
  if (t.access && t.access.stream === false) return false;
  if (typeof t.duration === "number" && (t.duration < 45 || t.duration > 900)) return false;
  return Boolean(t.id && t.title);
}

/** Stream URL: prefer the signed CDN URL from the API when present. */
function streamUrl(host: string, t: AudiusTrack): string | null {
  const signed = t.stream?.url;
  if (signed && /^https?:\/\//i.test(signed)) return signed;
  if (!t.id) return null;
  return `${host}/v1/tracks/${encodeURIComponent(t.id)}/stream?app_name=${APP_NAME}`;
}

/**
 * Resolve a live Audius API host. Tries discovery, then known-good hosts with a
 * cheap HEAD/GET probe so a dead node doesn't break every station.
 */
async function audiusHost(): Promise<string> {
  const candidates: string[] = [];
  try {
    const res = await fetch("https://api.audius.co", { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const body = (await res.json()) as { data?: string[] };
      for (const h of body.data ?? []) {
        if (typeof h === "string" && h.startsWith("http") && !candidates.includes(h)) {
          candidates.push(h.replace(/\/$/, ""));
        }
      }
    }
  } catch {
    /* discovery failed — fall through to static list */
  }
  for (const h of AUDIUS_HOSTS) {
    if (!candidates.includes(h)) candidates.push(h);
  }

  for (const host of candidates) {
    try {
      const probe = await fetch(
        `${host}/v1/tracks/trending?app_name=${APP_NAME}&limit=1`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (probe.ok) return host;
    } catch {
      /* try next host */
    }
  }
  // Last resort: first candidate even if probe failed (network may recover).
  return candidates[0] ?? AUDIUS_HOSTS[0];
}

/** Fetch trending tracks for a genre; fall back to search if trending is empty. */
async function fetchAudiusTracks(host: string, genre: string): Promise<AudiusTrack[]> {
  const trendingUrl =
    `${host}/v1/tracks/trending?genre=${encodeURIComponent(genre)}` +
    `&time=week&app_name=${APP_NAME}&limit=${STATION_SIZE * 2}`;
  const res = await fetch(trendingUrl, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`audius trending failed: ${res.status}`);
  const body = (await res.json()) as { data?: AudiusTrack[] };
  let tracks = (body.data ?? []).filter(isPlayable);

  if (tracks.length < 5) {
    // Genre trending can be thin — search is a reliable free fallback.
    const q = encodeURIComponent(genre.replace("/", " "));
    const searchUrl = `${host}/v1/tracks/search?query=${q}&app_name=${APP_NAME}&limit=${STATION_SIZE * 2}`;
    const sRes = await fetch(searchUrl, { signal: AbortSignal.timeout(12000) });
    if (sRes.ok) {
      const sBody = (await sRes.json()) as { data?: AudiusTrack[] };
      const more = (sBody.data ?? []).filter(isPlayable);
      const seen = new Set(tracks.map((t) => t.id));
      for (const t of more) {
        if (!seen.has(t.id)) {
          tracks.push(t);
          seen.add(t.id);
        }
      }
    }
  }

  return tracks.slice(0, STATION_SIZE);
}

/** Build a ready-to-play playlist from free Audius streams for one genre. */
async function fetchAudiusPlaylist(genre: string): Promise<StationPlaylist> {
  const host = await audiusHost();
  const tracks = await fetchAudiusTracks(host, genre);
  const urls: string[] = [];
  const titles: string[] = [];
  for (const t of tracks) {
    const url = streamUrl(host, t);
    if (!url) continue;
    urls.push(url);
    titles.push(t.user?.name ? `${t.title} — ${t.user.name}` : t.title);
  }
  if (urls.length === 0) throw new Error(`audius returned no playable ${genre} tracks`);
  return { urls, titles };
}

/**
 * Resolve a station's playlist (local list instantly; Audius via a cached
 * fetch). Throws on network/API failure for stream stations.
 */
export async function stationPlaylist(id: string): Promise<StationPlaylist> {
  const def = RADIO_STATIONS.find((s) => s.id === id) ?? RADIO_STATIONS[0];
  // Producer tag is CPT RAC–only (local set); free stream channels clear it.
  musicStation.setProducerTag(def.genre ? null : djProducerTagUrl());
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
 * stream stations apply from cache when available, else fetch then apply —
 * falling back to the local set if the free stream source is unreachable, so a
 * dead network never leaves the room silent. Always safe to call: an unchanged
 * playlist is a no-op inside musicStation.
 */
export function assertStation(apply: (urls: string[], titles: string[]) => void): void {
  const def = RADIO_STATIONS.find((s) => s.id === loadStationId()) ?? RADIO_STATIONS[0];
  musicStation.setStationName(def.name);
  musicStation.setProducerTag(def.genre ? null : djProducerTagUrl());
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
      musicStation.setProducerTag(djProducerTagUrl());
      apply(djStationUrls(), djStationTitles());
    });
}
