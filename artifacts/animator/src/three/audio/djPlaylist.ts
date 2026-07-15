import { asset } from "../assets";

/** Public-facing name of the resident DJ's single looping station. */
export const DJ_STATION_NAME = "CPT RAC Station";

/**
 * CPT RAC producer tag / drop (Racalvin's ID sting). Used for occasional
 * producer drops and as a blend layer on track transitions — not a playlist song.
 */
export const DJ_PRODUCER_TAG_FILE = "audio/dj/producer-tag.m4a";

/** Resolve the producer-tag URL (base-path aware). */
export function djProducerTagUrl(): string {
  return asset(DJ_PRODUCER_TAG_FILE);
}

/** One song on the station. `file` is a path under the artifact's `public/`. */
export interface DjTrack {
  file: string;
  title: string;
}

/**
 * CPT RAC Station playlist — only files verified on the Vercel CDN
 * (threejs-rapier-react-three-controll.vercel.app). Do not list tracks that
 * exist only locally until they are committed + deployed under public/audio/dj/.
 *
 * Note: `racalvin-the-pirate-king.mp3` is NOT used (404); the live file is
 * `racalvin-the-pirate-the-king.mp3`.
 */
export const DJ_TRACKS: readonly DjTrack[] = [
  { file: "audio/dj/rac-the-king.mp3", title: "Rac The King" },
  { file: "audio/dj/racalvin-the-pirate-the-king.mp3", title: "Racalvin The Pirate, The King" },
  { file: "audio/dj/pirate-kings-reign.mp3", title: "Pirate King's Reign" },
  { file: "audio/dj/pirates-trap-anthem.mp3", title: "Pirate's Trap Anthem" },
  { file: "audio/dj/warlords-horns.mp3", title: "Warlord's Horns" },
  { file: "audio/dj/ironworks-bounty.mp3", title: "Ironworks Bounty" },
  { file: "audio/dj/ra-of-the-sea-remix.mp3", title: "Ra Of The Sea (Remix)" },
  { file: "audio/dj/malord.mp3", title: "Malord" },
  { file: "audio/dj/lives-of-the-young-kingpins.mp3", title: "Lives of the Young Kingpins" },
  { file: "audio/dj/let-it-cook.mp3", title: "Let It Cook" },
  { file: "audio/dj/e-to-e-to-e-remix.mp3", title: "E to E to E (Remix)" },
  { file: "audio/dj/the-last-cello-of-the-siege.mp3", title: "The Last Cello of the Siege" },
  { file: "audio/dj/death-of-monty-remix.mp3", title: "Death of Monty (Remix)" },
  { file: "audio/dj/gravity-down.mp3", title: "加速境界 (Gravity Down)" },
] as const;

/** True if a file path or title is already on the CPT RAC set (case-insensitive). */
export function hasDjTrack(fileOrTitle: string): boolean {
  const key = fileOrTitle.trim().toLowerCase();
  const bare = key.replace(/^audio\/dj\//, "").replace(/\.mp3$/, "");
  return DJ_TRACKS.some((t) => {
    const f = t.file.toLowerCase();
    const title = t.title.toLowerCase();
    return (
      f === key ||
      f.endsWith(`/${key}`) ||
      f.endsWith(`/${bare}.mp3`) ||
      title === key ||
      title === bare.replace(/-/g, " ")
    );
  });
}

/** Resolve the station tracks to base-path-aware URLs (via `asset()`). */
export function djStationUrls(): string[] {
  return DJ_TRACKS.map((t) => asset(t.file));
}

/** Track titles, index-aligned with {@link djStationUrls}. */
export function djStationTitles(): string[] {
  return DJ_TRACKS.map((t) => t.title);
}
