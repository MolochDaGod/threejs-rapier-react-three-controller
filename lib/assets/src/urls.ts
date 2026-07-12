/**
 * Bundler-resolved URLs for every curated asset file.
 *
 * Vite statically analyses this `import.meta.glob` call and rewrites each matched
 * file under `lib/assets/models/` to a hashed, served URL (the `?url` query asks
 * for the URL string rather than the file contents, so nothing is fetched until a
 * loader actually requests it). This keeps URL resolution anchored to this module
 * — exactly what `new URL('./path', import.meta.url)` does, but for the whole tree
 * at once — so the library works no matter which app's base path it is mounted under.
 */
const urlMap = import.meta.glob(
  "../models/**/*.{gltf,glb,fbx,obj,mtl,png,jpg,jpeg}",
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>;

const MODELS_PREFIX = "../models/";

/** Map of `category/sub/file.ext` -> resolved URL. */
const byRelPath = new Map<string, string>();
for (const [key, url] of Object.entries(urlMap)) {
  const rel = key.startsWith(MODELS_PREFIX)
    ? key.slice(MODELS_PREFIX.length)
    : key.replace(/^.*\/models\//, "");
  byRelPath.set(rel, url);
}

/** Every curated file's relative path (e.g. `enemies/zombie.gltf`), sorted. */
export function allAssetPaths(): string[] {
  return [...byRelPath.keys()].sort();
}

/** Resolve a relative model path to its bundled URL, or throw if unknown. */
export function resolveAssetUrl(relPath: string): string {
  const url = byRelPath.get(relPath);
  if (!url) {
    throw new Error(`[@workspace/assets] unknown asset path: ${relPath}`);
  }
  return url;
}

/** Lookup without throwing; returns undefined for unknown paths. */
export function tryResolveAssetUrl(relPath: string): string | undefined {
  return byRelPath.get(relPath);
}
