// Configurable asset base for the vendored Grudge character-kit.
//
// Vendored into the Animator (which forbids `@workspace` imports) from the
// grudge-game `character-kit`. Every model / texture / baked-clip URL the kit
// builds is ROOT-RELATIVE (`/assets/...`, `/anims/baked/...`). Those files live
// in the Grudge R2 bucket, NOT in the Animator artifact — so the default base
// here points at that bucket. Root-relative paths would 404 against the
// Animator's own origin.
//
// Override at build time with `VITE_ASSET_BASE` (e.g. to point at a staging
// bucket or a local mirror), or at runtime via `setAssetBase()`.

const DEFAULT_ASSET_BASE = "https://assets.grudge-studio.com";

function initialBase(): string {
  const env = (import.meta.env?.VITE_ASSET_BASE as string | undefined) ?? "";
  return (env || DEFAULT_ASSET_BASE).replace(/\/+$/, "");
}

let assetBase = initialBase();

// Set the absolute origin (or origin+path prefix) that serves `/assets/*` and
// `/anims/*`. Trailing slashes are trimmed so callers can pass either form.
export function setAssetBase(base: string | undefined | null): void {
  assetBase = (base ?? "").replace(/\/+$/, "");
}

// The currently configured asset base.
export function getAssetBase(): string {
  return assetBase;
}

// Resolve a root-relative asset path against the configured base. Absolute URLs
// (http(s)://, protocol-relative //, or data:) are returned untouched.
export function resolveAssetUrl(path: string): string {
  if (/^([a-z]+:)?\/\//i.test(path) || path.startsWith("data:")) return path;
  const rel = path.startsWith("/") ? path : `/${path}`;
  return `${assetBase}${rel}`;
}

// Build a loud, actionable Error for a failed asset fetch/load. The most common
// cause is that the resolved URL points at a host that does not actually serve
// these files. The message names the URL and the configured base so the failure
// is obvious instead of a silent empty scene.
export function assetLoadError(url: string, cause?: unknown): Error {
  const base = assetBase || "(root-relative — same origin)";
  const hint =
    "These files (/assets/*, /anims/*) come from the configured asset host (assetBase), " +
    `which defaults to ${DEFAULT_ASSET_BASE}. Override via setAssetBase() / VITE_ASSET_BASE.`;
  const err = new Error(`[grudge-kit] failed to load asset: ${url} (assetBase=${base}). ${hint}`);
  if (cause !== undefined) (err as { cause?: unknown }).cause = cause;
  return err;
}

// Probe whether the configured asset host is reachable. Fetches the asset
// manifest and resolves to true only on an OK response. Never throws — returns
// false on any network/HTTP error so callers can render a clear warning.
export async function probeAssetHost(
  signal?: AbortSignal,
): Promise<{ ok: boolean; url: string; status?: number; error?: string }> {
  const url = resolveAssetUrl("/assets/manifest.json");
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store", signal });
    return { ok: res.ok, url, status: res.status };
  } catch (err) {
    return { ok: false, url, error: err instanceof Error ? err.message : String(err) };
  }
}
