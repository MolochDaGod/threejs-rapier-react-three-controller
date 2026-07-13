/**
 * Mine-Loader / Voxel Realms — live reference + product pillars.
 *
 * Canonical networked game: https://mine-loader.replit.app/
 * Source monorepo: D:\GitHub\minegrudge\Mine-Loader (from minegrudge.zip)
 */

/** Live production reference (REST + world WS + full SPA). */
export const MINE_LOADER_LIVE = "https://mine-loader.replit.app";

/** Local staged SPA under the play shell (offline / custom deploy fallback). */
export const MINE_LOADER_LOCAL_PATH = "/minegrudge/";

/**
 * Staged completeness checklist (after `pnpm stage:minegrudge`):
 * - assets/block-icons (box icons), item-icons, ui-icons
 * - assets models: animals, characters, creatures, props, tools, weapons, tvs, kit
 * - codex/*.md (wiki export from Mine-Loader .agents/memory)
 * - data/blocks.csv, definitions.json, assets.csv (from live API when online)
 * - MANIFEST.json + SOURCE.md
 * Camera: Mine-Loader third-person shoulder; play-shell Danger/Island use threejs-rapier Controller
 */

export type MineLoaderSurface =
  | "home"
  | "play"
  | "lobby"
  | "editor"
  | "boss"
  | "coop"
  | "codex"
  | "join";

/** Product pillars — Minecraft-like GRUDOX survival MMO loop. */
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

/**
 * In-app hash routes on the Mine-Loader SPA (wouter).
 * Live app may map these; we always append as soft deep-links.
 */
export const MINE_LOADER_HASH: Record<MineLoaderSurface, string> = {
  home: "#/",
  play: "#/play",
  lobby: "#/lobby",
  editor: "#/editor",
  boss: "#/play", // boss arenas entered from play/setup maps
  coop: "#/lobby",
  codex: "#/defs",
  join: "#/join",
};

export interface MineLoaderLaunchOpts {
  surface?: MineLoaderSurface;
  /** Prefer live reference for multiplayer (default true). */
  preferLive?: boolean;
  /** Force local staged SPA even if live is preferred. */
  forceLocal?: boolean;
  characterId?: string | null;
  characterName?: string | null;
  baseId?: string | null;
  token?: string | null;
  /** Invite / join code for friend worlds. */
  joinCode?: string | null;
}

/**
 * Build the URL for the Mine-Loader experience.
 * Default: live https://mine-loader.replit.app with SSO + hero handoff.
 */
export function buildMineLoaderUrl(opts: MineLoaderLaunchOpts = {}): string {
  const preferLive = opts.forceLocal ? false : opts.preferLive !== false;
  const surface = opts.surface ?? "lobby";

  let base: string;
  if (preferLive) {
    base = MINE_LOADER_LIVE;
  } else if (typeof window !== "undefined") {
    const prefix = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
    base = `${window.location.origin}${prefix}minegrudge/`.replace(
      /([^:]\/)\/+/g,
      "$1",
    );
  } else {
    base = MINE_LOADER_LOCAL_PATH;
  }

  const url = new URL(base.endsWith("/") || base.includes(".html") ? base : `${base}/`);
  // Live SPA is at /; local is /minegrudge/index.html
  if (!preferLive && !url.pathname.endsWith(".html") && !url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  if (!preferLive && !url.pathname.includes("index.html")) {
    // Ensure we hit the staged index when on play-shell origin
    if (url.pathname.endsWith("/minegrudge") || url.pathname.endsWith("/minegrudge/")) {
      url.pathname = url.pathname.replace(/\/?$/, "/index.html");
    }
  }

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

  // Always prefer live API for multiplayer when embedded local SPA
  if (!preferLive) {
    url.searchParams.set("api", MINE_LOADER_LIVE);
  }

  let hash = MINE_LOADER_HASH[surface] || "#/";
  if (opts.joinCode && surface === "join") {
    hash = `#/join/${encodeURIComponent(opts.joinCode)}`;
  }
  url.hash = hash.replace(/^#/, "#");

  return url.toString();
}

/** Quick open of live lobby for friends / guilds / worlds. */
export function openMineLoaderLive(
  opts: Omit<MineLoaderLaunchOpts, "preferLive" | "forceLocal"> = {},
): void {
  window.open(buildMineLoaderUrl({ ...opts, preferLive: true }), "_blank", "noopener,noreferrer");
}
