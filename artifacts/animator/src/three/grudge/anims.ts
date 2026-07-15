import * as THREE from "three";
import { assetLoadError, resolveAssetUrl } from "./assetBase";

// Animation packs match the gear-preset `animPack` field. Each pack maps to a
// set of pre-baked Bip001 clips (idle / walk / run / attack). The clips were
// retargeted offline to Bip001 by the viewer's bake tool and shipped as JSON
// under `/anims/baked/<rel>.json`; we load them directly (no runtime retarget).
export type AnimPack = "magic" | "sword_shield" | "longbow" | "unarmed";

export interface LoadoutClips {
  idle: string;
  walk: string;
  run: string;
  attack: string;
}

/**
 * Paths relative to `/anims/baked/`, WITHOUT `.json`.
 * SSOT on CDN `assets.grudge-studio.com` uses **hyphenated** names
 * (probed 2026-07-15). Space-separated Mixamo titles 404.
 */
export const ANIM_PACK_CLIPS: Record<AnimPack, LoadoutClips> = {
  unarmed: {
    idle: "unarmed/fight_idle",
    walk: "locomotion/walking",
    run: "locomotion/running",
    attack: "unarmed/punching",
  },
  magic: {
    idle: "magic/standing-idle",
    walk: "magic/standing-walk-forward",
    run: "magic/standing-run-forward",
    // No dedicated cast clip on CDN yet — unarmed punch reads as cast strike
    attack: "unarmed/punching",
  },
  sword_shield: {
    idle: "sword_shield/sword-and-shield-idle",
    walk: "locomotion/walking",
    run: "sword_shield/sword-and-shield-run",
    attack: "sword_shield/sword-and-shield-attack",
  },
  longbow: {
    idle: "longbow/idle",
    walk: "longbow/walk-forward",
    run: "longbow/run-forward",
    attack: "longbow/draw",
  },
};

/** Alternate rels to try when the primary path 404s (legacy space names, aliases). */
export const CLIP_PATH_ALIASES: Record<string, string[]> = {
  "sword_shield/sword-and-shield-idle": [
    "sword_shield/sword and shield idle",
    "sword_shield/sword_and_shield_idle",
  ],
  "sword_shield/sword-and-shield-run": [
    "sword_shield/sword and shield run",
  ],
  "sword_shield/sword-and-shield-attack": [
    "sword_shield/sword and shield attack",
  ],
  "magic/standing-idle": ["magic/standing idle", "magic/idle"],
  "magic/standing-walk-forward": ["locomotion/walking", "magic/standing walk forward"],
  "magic/standing-run-forward": ["magic/Standing Run Forward", "locomotion/running"],
  "longbow/idle": ["longbow/standing idle 01", "longbow/standing-idle-01", "longbow/aim-idle"],
  "longbow/walk-forward": ["locomotion/walking", "longbow/standing walk forward"],
  "longbow/run-forward": ["longbow/standing run forward", "locomotion/running"],
  "longbow/draw": ["longbow/recoil", "longbow/standing aim recoil", "longbow/aim-recoil"],
  "unarmed/fight_idle": ["unarmed/fight-idle", "unarmed/idle"],
  "unarmed/punching": ["unarmed/punch", "unarmed/fight_idle"],
  "locomotion/walking": ["locomotion/walk"],
  "locomotion/running": ["locomotion/run", "uploads_2026_06/locomotion/running"],
  "uploads_2026_06/locomotion/running": ["locomotion/running"],
};

export function asAnimPack(value: string): AnimPack {
  return value in ANIM_PACK_CLIPS ? (value as AnimPack) : "unarmed";
}

// Dedicated sprint locomotion clip (uploaded 2026-06). Pack-agnostic body
// locomotion the world crossfades to while sprinting, instead of time-scaling
// the run clip (which causes foot-slide). Baked rotation-only like the rest, so
// it works on every race at any scale.
export const SPRINT_CLIP = "uploads_2026_06/locomotion/running";

// Build the URL for a baked clip, resolved against the configured asset base.
export function bakedClipUrl(rel: string, baseOverride?: string): string {
  const path = `/anims/baked/${rel}.json`;
  if (baseOverride !== undefined) {
    return `${baseOverride.replace(/\/+$/, "")}${path}`;
  }
  return resolveAssetUrl(path);
}

// Rotation-only conformation — bone lengths come from the MODEL skeleton, motion
// (rotations) comes from the clip. Baked Bip001 clips are already rotation-only,
// so this is effectively a no-op for them, but it stays as a safety net.
export function toRotationOnlyClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => t.name.endsWith(".quaternion"));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** Build candidate rel paths: primary, hyphen/space swaps, aliases. */
function clipRelCandidates(rel: string): string[] {
  const clean = rel.replace(/\.json$/i, "").replace(/^\/+/, "");
  const out: string[] = [clean];
  // space ↔ hyphen ↔ underscore
  out.push(clean.replace(/\s+/g, "-"));
  out.push(clean.replace(/\s+/g, "_"));
  out.push(clean.replace(/-/g, " "));
  out.push(clean.replace(/_/g, "-"));
  for (const alt of CLIP_PATH_ALIASES[clean] ?? []) out.push(alt);
  // de-dupe preserve order
  return [...new Set(out.filter(Boolean))];
}

// Fetch + parse a baked Bip001 clip as a rotation-only AnimationClip.
// Tries hyphenated CDN names + legacy space names so idles never hard-fail.
export async function loadBakedClip(rel: string, baseOverride?: string): Promise<THREE.AnimationClip> {
  const candidates = clipRelCandidates(rel);
  let lastErr: unknown;
  for (const c of candidates) {
    const url = bakedClipUrl(c, baseOverride);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastErr = assetLoadError(`${url} (HTTP ${res.status})`);
        continue;
      }
      const json = (await res.json()) as THREE.AnimationClipJSON;
      return toRotationOnlyClip(THREE.AnimationClip.parse(json));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : assetLoadError(bakedClipUrl(rel, baseOverride), lastErr);
}
