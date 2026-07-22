/**
 * GRUDOX fleet core — shared endpoints, tokens, login, and cross-game launch.
 * Aligned with gameopen (`artifacts/animator/src/lib/fleet.ts` + grudgeAuth).
 *
 * SSOT: Railway Postgres characters · Grudge ID JWT · same-origin /api rewrites.
 * See docs/GRUDOX_UNIFIED_SCHEME.md
 */

export const FLEET = {
  auth: "https://id.grudge-studio.com",
  assets: "https://assets.grudge-studio.com",
  /** Definitions SSOT — info.grudge-studio.com (objectstore catalogs 404 as of 2026-07). */
  definitions: "https://info.grudge-studio.com/api/v1",
  objectStore: "https://info.grudge-studio.com/api/v1",
  objectStoreLegacy: "https://objectstore.grudge-studio.com/api/v1",
  /** Character / account SSOT (never api.grudge-studio.com). */
  gameData: "https://grudge-api-production-0d46.up.railway.app",
  characterStudio: "https://character.grudge-studio.com",
  /** Canonical Open launcher + Animator suite (replaces threejs-rapier hub). */
  gameopen: "https://open.grudge-studio.com",
  gameopenAlias: "https://gameopen.vercel.app",
  warlords: "https://grudgewarlords.com",
  grudox: "https://grudox.grudge-studio.com",
  mineLoaderApi: "https://mine-loader-api-production.up.railway.app",
  arena: "https://grudge-arena.grudge-studio.com",
  /** Realtime (prefer env override). */
  gameopenWs: "wss://gameopen-production.up.railway.app",
  zoneWs: "wss://voxgrudge-grudox-room-production.up.railway.app",
} as const;

/** Write-all / read-any JWT keys (bootstrap + gameopen + Warlords). */
export const FLEET_TOKEN_KEYS = [
  "grudge_auth_token",
  "grudge_session_token",
  "grudge.token",
  "sso_token",
  "grudge_token",
  "grudge.open.token",
] as const;

export type GrudoxGameId =
  | "lobbyWorld"
  | "characters"
  | "minegrudge"
  | "danger"
  | "gameopen"
  | "warlords"
  | "characterStudio"
  | "grudox"
  | "carrier"
  | "waters";

export interface GrudoxGameDef {
  id: GrudoxGameId;
  name: string;
  blurb: string;
  /** Absolute or same-origin path. */
  url: string;
  /** Needs multiplayer WS */
  multiplayer?: boolean;
}

/** Canonical GRUDOX game directory (launcher tiles). */
export const GRUDOX_GAMES: GrudoxGameDef[] = [
  {
    id: "characters",
    name: "Characters",
    blurb: "Campfire roster & creator (charactersgrudox)",
    url: "?door=characters",
  },
  {
    id: "minegrudge",
    name: "GRUDOX Realms",
    blurb: "Networked survival · combat · build · friends (Mine-Loader)",
    url: "?door=minegrudge",
    multiplayer: true,
  },
  {
    id: "lobbyWorld",
    name: "GRUDOX Island",
    blurb: "Persistent harvest / craft / build / PvP island",
    url: "?door=lobbyWorld",
    multiplayer: true,
  },
  {
    id: "danger",
    name: "Danger Room",
    blurb: "Combat sandbox training + multiplayer rooms",
    url: "?door=danger",
    multiplayer: true,
  },
  {
    id: "gameopen",
    name: "Grudge Open",
    blurb: "Fleet launcher + combat sandbox (gameopen.vercel.app)",
    url: FLEET.gameopen,
    multiplayer: true,
  },
  {
    id: "warlords",
    name: "Grudge Warlords",
    blurb: "Full Warlords client — islands, dungeons, progression",
    url: FLEET.warlords,
    multiplayer: true,
  },
  {
    id: "characterStudio",
    name: "Character Studio",
    blurb: "Create / edit Warlords-era heroes",
    url: `${FLEET.characterStudio}?era=warlords`,
  },
  {
    id: "grudox",
    name: "GRUDOX Arcade",
    blurb: "Voxel arcade hub (carrier, waters, brawler)",
    url: FLEET.grudox,
    multiplayer: true,
  },
  {
    id: "carrier",
    name: "Carrier",
    blurb: "Live carrier multiplayer sector",
    url: "https://carrier.grudge-studio.com/",
    multiplayer: true,
  },
  {
    id: "waters",
    name: "Live Waters",
    blurb: "Open water sector via GRUDOX arcade",
    url: `${FLEET.grudox}/arcade/play/waters`,
    multiplayer: true,
  },
];

/** Prefer same-origin /api so Vercel rewrites skip CORS. */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") {
    if (p.startsWith("/api")) return `${FLEET.gameData}${p.replace(/^\/api/, "")}`;
    return `${FLEET.gameData}${p.startsWith("/") ? p : `/${p}`}`;
  }
  if (p.startsWith("/api")) return p;
  return `/api${p}`;
}

/**
 * Absolute Railway URL when same-origin proxy is unavailable (SSR / probes).
 * Prefer {@link apiUrl} in browser.
 */
export function gameDataUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = FLEET.gameData.replace(/\/$/, "");
  if (p.startsWith("/api")) return `${base}${p}`;
  return `${base}/api${p.startsWith("/") ? p : `/${p}`}`;
}

export function readFleetToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    for (const k of FLEET_TOKEN_KEYS) {
      const v = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (v) return v;
    }
  } catch {
    /* private mode */
  }
  return captureSsoFromUrl();
}

/** Capture SSO handoff from query + hash; dual-store; strip sensitive params. */
export function captureSsoFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const keys = ["sso_token", "token", "grudge_token", "launch_token", "access_token"] as const;
    let found: string | null = null;
    let preferSession = false;
    for (const k of keys) {
      const q = url.searchParams.get(k);
      if (q) {
        found = q;
        preferSession = k === "sso_token" || k === "token";
        break;
      }
    }
    if (!found && url.hash.length > 1) {
      const hp = new URLSearchParams(url.hash.replace(/^#/, ""));
      for (const k of keys) {
        const h = hp.get(k);
        if (h) {
          found = h;
          preferSession = k === "sso_token" || k === "token";
          break;
        }
      }
    }
    const charId = url.searchParams.get("characterId") || url.searchParams.get("charId");
    if (charId) {
      try {
        localStorage.setItem("grudge.activeCharId", charId);
      } catch {
        /* */
      }
    }
    if (found) {
      writeFleetToken(found);
      // Clean URL
      for (const k of [
        ...keys,
        "grudge_id",
        "grudgeId",
        "username",
        "provider",
        "error",
      ]) {
        url.searchParams.delete(k);
      }
      if (url.hash) {
        const hp = new URLSearchParams(url.hash.replace(/^#/, ""));
        for (const k of keys) hp.delete(k);
        url.hash = hp.toString() ? `#${hp}` : "";
      }
      const q = url.searchParams.toString();
      window.history.replaceState({}, "", url.pathname + (q ? `?${q}` : "") + (url.hash || ""));
      void (preferSession ? null : exchangeLaunchToken(found));
    }
    return found;
  } catch {
    return null;
  }
}

export function writeFleetToken(token: string): void {
  try {
    for (const k of FLEET_TOKEN_KEYS) {
      localStorage.setItem(k, token);
    }
  } catch {
    /* */
  }
}

/** Exchange short launch JWT for session when only grudge_token is present. */
async function exchangeLaunchToken(launch: string): Promise<void> {
  try {
    const res = await fetch(apiUrl("/api/auth/session/exchange"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        token: launch,
        grudge_token: launch,
        audience: typeof window !== "undefined" ? window.location.origin : FLEET.gameopen,
      }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { token?: string; access_token?: string; sso_token?: string };
    const next = data.sso_token || data.token || data.access_token;
    if (next) writeFleetToken(next);
  } catch {
    /* exchange optional */
  }
}

/**
 * Grudge ID login with dual-write return aliases (gameopen contract).
 */
export function buildFleetLoginUrl(returnTo?: string, opts?: { app?: string; force?: boolean }): string {
  const redirect =
    returnTo ||
    (typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}${window.location.search || ""}`.replace(
          /[?&](grudge_token|sso_token|token|launch_token|characterId)=[^&]*/g,
          "",
        )
      : FLEET.gameopen);
  const origin = typeof window !== "undefined" ? window.location.origin : FLEET.gameopen;
  const q = new URLSearchParams({
    redirect_uri: redirect,
    redirect,
    return: redirect,
    return_to: redirect,
    origin,
    app: opts?.app || "grudox-play",
  });
  const base = FLEET.auth.replace(/\/$/, "");
  if (opts?.force) return `${base}/login?${q.toString()}`;
  return `${base}/auth/sso-check?${q.toString()}`;
}

export function buildCharacterCreateUrl(returnTo?: string): string {
  const dest =
    returnTo ||
    (typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}?door=lobbyWorld`
      : `${FLEET.gameopen}`);
  return `${FLEET.characterStudio}?era=warlords&redirect_uri=${encodeURIComponent(dest)}`;
}

/**
 * Build a URL into another GRUDOX game carrying the active session + character.
 */
export function buildGrudoxGameUrl(
  gameId: GrudoxGameId,
  opts?: { characterId?: string | null; token?: string | null; extra?: Record<string, string> },
): string {
  const def = GRUDOX_GAMES.find((g) => g.id === gameId);
  if (!def) return FLEET.gameopen;

  const token = opts?.token !== undefined ? opts.token : readFleetToken();
  const characterId =
    opts?.characterId !== undefined
      ? opts.characterId
      : (() => {
          try {
            return localStorage.getItem("grudge.activeCharId");
          } catch {
            return null;
          }
        })();

  // Relative door links stay on this origin
  if (def.url.startsWith("?")) {
    const u = new URL(typeof window !== "undefined" ? window.location.href : "https://localhost/");
    u.search = "";
    const sp = new URLSearchParams(def.url.slice(1));
    if (characterId) sp.set("characterId", characterId);
    if (token) sp.set("sso_token", token);
    sp.set("from", "grudox-play");
    if (opts?.extra) for (const [k, v] of Object.entries(opts.extra)) sp.set(k, v);
    return `${u.origin}${u.pathname}?${sp.toString()}`;
  }

  try {
    const u = new URL(def.url);
    if (characterId) u.searchParams.set("characterId", characterId);
    if (token) u.searchParams.set("sso_token", token);
    u.searchParams.set("from", "grudox-play");
    if (opts?.extra) for (const [k, v] of Object.entries(opts.extra)) u.searchParams.set(k, v);
    return u.toString();
  } catch {
    return def.url;
  }
}

/** Open Grudge Open launcher with current character for combat / fleet games. */
export function launchGameopen(opts?: { characterId?: string | null }): string {
  return buildGrudoxGameUrl("gameopen", opts);
}
