import * as THREE from "three";
import { assetLoadError, resolveAssetUrl } from "./assetBase";

// Animation packs match the gear-preset `animPack` field. Each pack maps to
// pre-baked Bip001 clips (rotation-only JSON under `/anims/baked/<rel>.json`).
// Paths were probed against assets.grudge-studio.com (2026-08-03).
//
// Organization (CDN + this map = SSOT):
//   /anims/baked/sword_shield/*   — 1H + shield
//   /anims/baked/longbow/*        — full 8-dir walk/run (also directional fill)
//   /anims/baked/magic/*          — caster idle + 8-dir
//   /anims/baked/unarmed/*        — fight idle / punch
//   /anims/baked/locomotion/*     — pack-agnostic walk/run
//   /anims/baked/uploads_2026_06/locomotion/* — dedicated sprint
//
// Explorer (Mixamo) keeps its own SSOT in explorer/clipCatalog.ts under
// public/anim/animations/* — do not retarget Mixamo FBX onto Bip001 at runtime.

export type AnimPack = "magic" | "sword_shield" | "longbow" | "unarmed";

/** Core + optional directional / defense clips for one weapon pack. */
export interface LoadoutClips {
  idle: string;
  walk: string;
  run: string;
  attack: string;
  /** Optional dedicated sprint; falls back to {@link SPRINT_CLIP}. */
  sprint?: string;
  walkB?: string;
  walkL?: string;
  walkR?: string;
  runB?: string;
  runL?: string;
  runR?: string;
  block?: string;
  parry?: string;
  dodgeF?: string;
  dodgeB?: string;
  dodgeL?: string;
  dodgeR?: string;
  hurt?: string;
}

/**
 * Paths relative to `/anims/baked/`, WITHOUT `.json`.
 * Prefer hyphenated CDN names (space-separated Mixamo titles often 404).
 *
 * Directional fills: longbow ships the fullest 8-dir set on CDN; sword_shield
 * borrows longbow body loco for strafe/back (same Bip001 skeleton). Magic uses
 * its own standing-* directional set where present.
 */
export const ANIM_PACK_CLIPS: Record<AnimPack, LoadoutClips> = {
  unarmed: {
    idle: "unarmed/fight_idle",
    walk: "locomotion/walking",
    run: "locomotion/running",
    attack: "unarmed/punching",
    // Body directional from longbow pack (shared Bip001 bake)
    walkB: "longbow/walk-back",
    walkL: "longbow/walk-left",
    walkR: "longbow/walk-right",
    runB: "longbow/run-back",
    runL: "longbow/run-left",
    runR: "longbow/run-right",
  },
  magic: {
    idle: "magic/standing-idle",
    walk: "magic/standing-walk-forward",
    run: "magic/standing-run-forward",
    // No dedicated cast clip on CDN — unarmed punch reads as cast strike
    attack: "unarmed/punching",
    walkB: "magic/standing-walk-back",
    walkL: "magic/standing-walk-left",
    walkR: "magic/standing-walk-right",
    runB: "magic/standing-run-back",
    runL: "magic/standing-run-left",
    runR: "magic/standing-run-right",
  },
  sword_shield: {
    idle: "sword_shield/sword-and-shield-idle",
    walk: "locomotion/walking",
    run: "sword_shield/sword-and-shield-run",
    attack: "sword_shield/sword-and-shield-attack",
    block: "sword_shield/sword-and-shield-block",
    // Parry clip not on CDN yet — block is the raise/react stand-in
    parry: "sword_shield/sword-and-shield-block",
    walkB: "longbow/walk-back",
    walkL: "longbow/walk-left",
    walkR: "longbow/walk-right",
    runB: "longbow/run-back",
    runL: "longbow/run-left",
    runR: "longbow/run-right",
  },
  longbow: {
    idle: "longbow/idle",
    walk: "longbow/walk-forward",
    run: "longbow/run-forward",
    attack: "longbow/draw",
    walkB: "longbow/walk-back",
    walkL: "longbow/walk-left",
    walkR: "longbow/walk-right",
    runB: "longbow/run-back",
    runL: "longbow/run-left",
    runR: "longbow/run-right",
  },
};

/** Flat list of all clip keys we try to load for a pack (core + optional). */
export const LOADOUT_CLIP_KEYS: (keyof LoadoutClips)[] = [
  "idle",
  "walk",
  "run",
  "attack",
  "sprint",
  "walkB",
  "walkL",
  "walkR",
  "runB",
  "runL",
  "runR",
  "block",
  "parry",
  "dodgeF",
  "dodgeB",
  "dodgeL",
  "dodgeR",
  "hurt",
];

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
  "sword_shield/sword-and-shield-block": [
    "sword_shield/sword and shield block",
    "sword_shield/sword-and-shield-block-idle",
  ],
  "magic/standing-idle": ["magic/standing idle", "magic/idle"],
  "magic/standing-walk-forward": ["locomotion/walking", "magic/standing walk forward"],
  "magic/standing-run-forward": ["magic/Standing Run Forward", "locomotion/running"],
  "magic/standing-walk-back": ["magic/standing walk back", "longbow/walk-back"],
  "magic/standing-walk-left": ["magic/standing walk left", "longbow/walk-left"],
  "magic/standing-walk-right": ["magic/standing walk right", "longbow/walk-right"],
  "magic/standing-run-back": ["magic/standing run back", "longbow/run-back"],
  "magic/standing-run-left": ["magic/standing run left", "longbow/run-left"],
  "magic/standing-run-right": ["magic/standing run right", "longbow/run-right"],
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

/**
 * Enumerate every relative path this pack will attempt to load (for docs / audit).
 * Includes sprint fill when pack omits `sprint`.
 */
export function packClipRels(pack: AnimPack): { key: string; rel: string }[] {
  const p = ANIM_PACK_CLIPS[pack];
  const out: { key: string; rel: string }[] = [];
  for (const key of LOADOUT_CLIP_KEYS) {
    const rel = p[key];
    if (rel) out.push({ key, rel });
  }
  if (!p.sprint) out.push({ key: "sprint", rel: SPRINT_CLIP });
  return out;
}
