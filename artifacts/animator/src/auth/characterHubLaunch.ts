/**
 * Routes from the Characters GRUDOX campfire hub (4 slots + right menu)
 * into local play-shell modes and external voxel / GRUDOX deployments.
 *
 * Aligns with Fantasy-Scene-Creator charactersgrudox `lib/grudoxLaunch.ts`
 * but uses same-origin doors where this shell hosts the surface.
 */

import { FLEET, readFleetToken } from "./fleetCore";

export const GRUDOX_HOST = FLEET.grudox;
export const OPEN_HOST = FLEET.gameopen;
export const PLAY_SHELL =
  (typeof window !== "undefined" ? window.location.origin : "") ||
  "https://threejs-rapier-react-three-controll.vercel.app";

/** Local App modes this shell can enter without leaving the origin. */
export type LocalHubMode =
  | "danger"
  | "voxel"
  | "editor"
  | "lobby"
  | "lobbyWorld"
  | "minegrudge"
  | "doors"
  | "avatar";

export type HubDestinationId =
  | "island"
  | "pve-danger"
  | "pve-lobby"
  | "pvp"
  | "voxel-editor"
  | "minegrudge-editor"
  | "dressing"
  | "gameopen"
  | "racer"
  | "zombie"
  | "z-brawl"
  | "brawler"
  | "voxgrudge"
  | "arena-arcade"
  | "carrier"
  | "waters"
  | "warlords"
  | "character-studio";

export interface HubLaunchContext {
  characterId?: string | null;
  baseId?: string | null;
  name?: string | null;
  token?: string | null;
}

export interface HubDestination {
  id: HubDestinationId;
  label: string;
  blurb: string;
  /** Visual group in the right menu. */
  group: "play" | "edit" | "arcade" | "fleet";
  /** Same-origin App mode — if set, host navigates without full page load. */
  localMode?: LocalHubMode;
  /** External or full URL builder. */
  external?: (ctx: HubLaunchContext) => string;
}

function withHandoff(url: string, ctx: HubLaunchContext): string {
  try {
    const u = new URL(url, PLAY_SHELL);
    u.searchParams.set("open", "1");
    u.searchParams.set("from", "charactersgrudox");
    if (ctx.characterId) u.searchParams.set("characterId", ctx.characterId);
    if (ctx.baseId) u.searchParams.set("baseId", ctx.baseId);
    if (ctx.name) u.searchParams.set("characterName", ctx.name);
    const token = ctx.token || readFleetToken();
    if (token) {
      u.searchParams.set("grudge_token", token);
      u.searchParams.set("sso_token", token);
    }
    return u.toString();
  } catch {
    return url;
  }
}

export const HUB_DESTINATIONS: HubDestination[] = [
  {
    id: "island",
    label: "GRUDOX Island",
    blurb: "Harvest · craft · build · PvP island",
    group: "play",
    localMode: "lobbyWorld",
  },
  {
    id: "pve-danger",
    label: "Danger Room",
    blurb: "Combat sandbox with your hero",
    group: "play",
    localMode: "danger",
  },
  {
    id: "pve-lobby",
    label: "Multiplayer Lobby",
    blurb: "Rooms & community maps",
    group: "play",
    localMode: "lobby",
  },
  {
    id: "pvp",
    label: "PvP / Spar",
    blurb: "Danger Room PvP path",
    group: "play",
    localMode: "danger",
  },
  {
    id: "minegrudge-editor",
    label: "GRUDOX Realms",
    blurb: "Live survival · build · combat · friends (mine-loader.replit.app)",
    group: "play",
    localMode: "minegrudge",
  },
  {
    id: "voxel-editor",
    label: "Quick Voxel Editor",
    blurb: "Lightweight map authoring in this shell",
    group: "edit",
    localMode: "voxel",
  },
  {
    id: "dressing",
    label: "Dressing Room",
    blurb: "Gear · anim · VFX lab",
    group: "edit",
    localMode: "editor",
  },
  {
    id: "gameopen",
    label: "Grudge Open",
    blurb: "Fleet launcher · combat modes",
    group: "fleet",
    external: (ctx) => withHandoff(OPEN_HOST, ctx),
  },
  {
    id: "racer",
    label: "Voxel Velocity",
    blurb: "Arcade racer cabinet",
    group: "arcade",
    external: (ctx) => withHandoff(`${GRUDOX_HOST}/arcade/play/racer`, ctx),
  },
  {
    id: "zombie",
    label: "Voxel Undead",
    blurb: "Sword survival cabinet",
    group: "arcade",
    external: (ctx) => withHandoff(`${GRUDOX_HOST}/arcade/play/zombie`, ctx),
  },
  {
    id: "z-brawl",
    label: "Z-Brawl",
    blurb: "Arena combat cabinet",
    group: "arcade",
    external: (ctx) => withHandoff(`${GRUDOX_HOST}/arcade/play/z-brawl`, ctx),
  },
  {
    id: "brawler",
    label: "Ruins Brawler",
    blurb: "Twin-stick co-op ruins",
    group: "arcade",
    external: (ctx) => withHandoff(`${GRUDOX_HOST}/arcade/play/brawler`, ctx),
  },
  {
    id: "voxgrudge",
    label: "VoxGrudge World",
    blurb: "Open voxel world",
    group: "arcade",
    external: (ctx) => withHandoff(`${GRUDOX_HOST}/voxgrudge/`, ctx),
  },
  {
    id: "arena-arcade",
    label: "Arcade Lobby",
    blurb: "GRUDOX arcade hub",
    group: "arcade",
    external: (ctx) => withHandoff(`${GRUDOX_HOST}/arcade/`, ctx),
  },
  {
    id: "carrier",
    label: "Carrier",
    blurb: "Fleet command sector",
    group: "fleet",
    external: (ctx) => withHandoff("https://carrier.grudge-studio.com/", ctx),
  },
  {
    id: "waters",
    label: "Live Waters",
    blurb: "Open water sector",
    group: "arcade",
    external: (ctx) => withHandoff(`${GRUDOX_HOST}/arcade/play/waters`, ctx),
  },
  {
    id: "warlords",
    label: "Grudge Warlords",
    blurb: "Full Warlords client",
    group: "fleet",
    external: (ctx) => withHandoff(FLEET.warlords, ctx),
  },
  {
    id: "character-studio",
    label: "Character Studio",
    blurb: "Warlords hero create (GCS)",
    group: "edit",
    external: (ctx) =>
      withHandoff(`${FLEET.characterStudio}?era=warlords`, ctx),
  },
];

export const HUB_GROUPS: { id: HubDestination["group"]; title: string }[] = [
  { id: "play", title: "Play" },
  { id: "edit", title: "Editors" },
  { id: "arcade", title: "Voxel Arcade" },
  { id: "fleet", title: "Fleet" },
];

/** Read best-effort active hero from roster / fleet keys. */
export function readActiveHeroContext(): HubLaunchContext {
  const token = readFleetToken();
  let characterId: string | null = null;
  let name: string | null = null;
  let baseId: string | null = null;
  try {
    characterId = localStorage.getItem("grudge.activeCharId");
    // charactersgrudox roster cache
    const raw =
      localStorage.getItem("animator.lobby.roster.v1") ||
      localStorage.getItem("animator.lobby.roster");
    if (raw) {
      const list = JSON.parse(raw) as Array<{
        uuid?: string;
        name?: string;
        baseId?: string;
        slot?: number;
      }>;
      if (Array.isArray(list) && list.length) {
        const pick =
          (characterId && list.find((c) => c.uuid === characterId)) || list[0];
        if (pick) {
          characterId = pick.uuid || characterId;
          name = pick.name || null;
          baseId = pick.baseId || null;
        }
      }
    }
  } catch {
    /* */
  }
  return { characterId, name, baseId, token };
}

export function rememberHeroFromContext(ctx: HubLaunchContext) {
  try {
    if (ctx.characterId) localStorage.setItem("grudge.activeCharId", ctx.characterId);
    if (ctx.baseId) localStorage.setItem("animator.activeCharacterId", mapBaseToAnimatorId(ctx.baseId));
  } catch {
    /* */
  }
}

/** Map charactersgrudox baseId → play-shell grudge kit id when possible. */
export function mapBaseToAnimatorId(baseId: string): string {
  const b = baseId.toLowerCase();
  if (b.startsWith("grudge-")) return b;
  if (b === "race-human" || b === "human") return "grudge-western-kingdoms-warrior";
  if (b === "race-orc" || b === "orc") return "grudge-orcs-warrior";
  if (b === "race-dwarf" || b === "dwarf") return "grudge-dwarves-warrior";
  if (b === "race-high-elf" || b.includes("elf")) return "grudge-high-elves-ranger";
  if (b === "race-barbarian" || b.includes("barb")) return "grudge-barbarians-warrior";
  if (b === "race-undead" || b.includes("undead")) return "grudge-undead-warrior";
  if (b === "grudge") return "grudge-western-kingdoms-mage";
  return "explorer";
}

export function launchHubDestination(
  dest: HubDestination,
  ctx: HubLaunchContext,
  opts: {
    onLocal?: (mode: LocalHubMode) => void;
    newTab?: boolean;
  },
): void {
  rememberHeroFromContext(ctx);
  if (dest.localMode && opts.onLocal) {
    opts.onLocal(dest.localMode);
    return;
  }
  if (dest.external) {
    const url = dest.external(ctx);
    if (opts.newTab !== false) window.open(url, "_blank", "noopener,noreferrer");
    else window.location.assign(url);
  }
}
