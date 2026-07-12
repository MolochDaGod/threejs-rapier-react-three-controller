/**
 * Central asset-host resolution for every public media file (models, anim FBX,
 * audio, rooms, frames, backdrops, avatar packs).
 *
 * By default assets resolve against Vite's `BASE_URL` (same-origin — how the
 * Replit deployment serves them). Setting `VITE_ASSET_BASE_URL` at build time
 * points all media at an external asset host instead (e.g. a Cloudflare R2
 * public bucket / custom CDN domain), which keeps the static bundle small and
 * sidesteps per-file size limits on static hosts like Cloudflare Pages.
 *
 * Keep this module dependency-free: it is imported from both `src/three/` and
 * `src/components/`, and must never create an import cycle.
 */

const configured = import.meta.env.VITE_ASSET_BASE_URL?.trim();

/** Effective asset host (no trailing slash). Empty string means same-origin root. */
export const ASSET_BASE: string = (configured && configured.length > 0
  ? configured
  : import.meta.env.BASE_URL
).replace(/\/+$/, "");

/** Resolve a public asset path (e.g. `"anim/x.fbx"`, `"/models/y.glb"`) to a full URL. */
export function assetUrl(path: string): string {
  return `${ASSET_BASE}/${path.replace(/^\/+/, "")}`;
}
