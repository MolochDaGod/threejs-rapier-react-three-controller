/**
 * Mine-Loader / Voxel Realms — fleet-owned hosts only.
 *
 * ALWAYS use the absolute production SPA. Never iframe /minegrudge/ on the
 * play shell (that path 404s on Vercel and was injecting api=replit).
 *
 * Live: https://mine-loader.vercel.app/
 * Auth: Grudge ID JWT query params
 */

export const MINE_LOADER_LIVE =
  (typeof import.meta !== "undefined" &&
    (import.meta.env?.VITE_MINELOADER_URL as string | undefined)?.replace(/\/+$/, "")) ||
  "https://mine-loader.vercel.app";

/** @deprecated Local staged SPA is not deployed on Vercel — do not iframe. */
export const MINE_LOADER_LOCAL_PATH = "/minegrudge/";

export type MineLoaderSurface =
  | "home"
  | "play"
  | "lobby"
  | "editor"
  | "boss"
  | "coop"
  | "codex"
  | "join";

export const MINE_LOADER_PILLARS = [
  {
    id: "survival",
    label: "Survival",
    blurb: "Gather, craft, eat, light the dark, and stay alive underground.",
  },
  {
    id: "combat",
    label: "Combat",
    blurb: "Melee, ranged, magic, armor — fight wildlife, raiders, and bosses.",
  },
  {
    id: "adventure",
    label: "Adventure",
    blurb: "Open world biomes, dungeons, arenas, and hand-authored maps.",
  },
  {
    id: "build",
    label: "Build",
    blurb: "Full block catalog, tools, and world editor that becomes play.",
  },
  {
    id: "social",
    label: "Friends & parties",
    blurb: "Co-op rooms, party tags (no friendly fire), public/private worlds.",
  },
  {
    id: "guilds",
    label: "Guilds & worlds",
    blurb: "Persistent shared worlds, invites, and group adventures online.",
  },
] as const;

export const MINE_LOADER_HASH: Record<MineLoaderSurface, string> = {
  home: "#/",
  play: "#/play",
  lobby: "#/lobby",
  editor: "#/editor",
  boss: "#/play",
  coop: "#/lobby",
  codex: "#/defs",
  join: "#/join",
};

export interface MineLoaderLaunchOpts {
  surface?: MineLoaderSurface;
  characterId?: string | null;
  characterName?: string | null;
  baseId?: string | null;
  token?: string | null;
  joinCode?: string | null;
  /**
   * @deprecated Ignored. Always uses fleet live host — never /minegrudge or Replit.
   */
  preferLive?: boolean;
  forceLocal?: boolean;
}

/**
 * Absolute URL for Mine-Loader Realms (fleet Vercel only).
 * Never returns same-origin /minegrudge or any replit host.
 */
export function buildMineLoaderUrl(opts: MineLoaderLaunchOpts = {}): string {
  const surface = opts.surface ?? "lobby";
  const base = MINE_LOADER_LIVE.replace(/\/+$/, "");
  const url = new URL(`${base}/`);

  url.searchParams.set("from", "grudox");
  url.searchParams.set("open", "1");
  url.searchParams.set("surface", surface);

  if (opts.token) {
    url.searchParams.set("grudge_token", opts.token);
    url.searchParams.set("sso_token", opts.token);
  }
  if (opts.characterId) url.searchParams.set("characterId", opts.characterId);
  if (opts.characterName) url.searchParams.set("characterName", opts.characterName);
  if (opts.baseId) url.searchParams.set("baseId", opts.baseId);
  if (opts.joinCode) url.searchParams.set("join", opts.joinCode);

  // Explicitly set API to fleet host so the SPA never falls back to replit defaults
  url.searchParams.set("api", base);

  let hash = MINE_LOADER_HASH[surface] || "#/";
  if (opts.joinCode && surface === "join") {
    hash = `#/join/${encodeURIComponent(opts.joinCode)}`;
  }
  url.hash = hash;

  let out = url.toString();
  if (/replit/i.test(out) || /\/minegrudge\//i.test(out)) {
    out = out
      .replace(/https?:\/\/[^/"']*replit[^/"']*/gi, base)
      .replace(/mine-loader\.replit\.app/gi, "mine-loader.vercel.app")
      .replace(/https?:\/\/[^/"']+\/minegrudge\/?/gi, `${base}/`);
    console.warn("[mineLoader] sanitized blocked host →", out);
  }
  return out;
}

export function openMineLoaderLive(
  opts: Omit<MineLoaderLaunchOpts, "preferLive" | "forceLocal"> = {},
): void {
  window.open(buildMineLoaderUrl(opts), "_blank", "noopener,noreferrer");
}
