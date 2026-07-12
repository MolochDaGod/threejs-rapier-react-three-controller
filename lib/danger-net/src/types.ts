/**
 * Shared types for the Danger Room multiplayer relay.
 *
 * Dependency-free (no three / no ws / no node-only APIs beyond numbers + JSON)
 * so the browser client and the node api-server can both import it.
 *
 * Unlike `@workspace/space-net`, this is NOT an authoritative deterministic
 * simulation. Character combat/physics (Rapier + epicfight) is not cheaply made
 * deterministic, so we use a *client-authoritative relay*: every client owns its
 * own avatar and reports its transform/anim/combat; one player is the host and
 * owns the shared NPCs/world. The server validates + rebroadcasts; it does not
 * re-simulate characters.
 */

/** WebSocket path the danger room server claims (proxy forwards /api/* unrewritten). */
export const WS_PATH = "/api/danger";

/** Relay rebroadcast rate (player snapshots → all room members). */
export const TICK_HZ = 20;
export const TICK_DT = 1 / TICK_HZ;

/** How often a client should report its own state, in ms. */
export const STATE_REPORT_MS = 50;

/** A player with no traffic for this long is dropped as stale/disconnected. */
export const PLAYER_TIMEOUT_MS = 15000;

/** Default / maximum players for an ad-hoc, player-created room. */
export const MAX_PLAYERS = 8;

/**
 * Capacity of the always-on "official" lobbies (see {@link PERSISTENT_ROOMS}).
 * Kept smaller than the ad-hoc ceiling so a duel/co-op session in one of the
 * permanent arenas stays tight (4-up).
 */
export const PERSISTENT_ROOM_MAX_PLAYERS = 4;

// ── Server-authoritative PvP duel rules ──────────────────────────────────────
// In PvP rooms the server owns each player's HP and validates every hit (the
// space/carrier rooms own entity HP the same way). These bound what an untrusted
// client can claim: damage is capped + rate-limited + range-checked + tied to a
// recent attack, movement is teleport-clamped, and HP is server-applied. Full
// Rapier/epicfight re-simulation is infeasible, so this is the achievable
// authoritative model rather than a deterministic resim.

/** Starting / max health for an authoritative PvP combatant. */
export const PVP_MAX_HP = 100;
/** Per-hit damage ceiling the server will accept (clamps spoofed amounts). */
export const PVP_HIT_MAX_DAMAGE = 200;
/** Max distance (world units) between attacker and victim for a hit to land. */
export const PVP_HIT_MAX_RANGE = 30;
/** Min interval (ms) between two damage applications from the same attacker. */
export const PVP_HIT_MIN_INTERVAL_MS = 90;
/** A hit only counts if the attacker swung within this window before it (ms). */
export const PVP_ATTACK_WINDOW_MS = 900;
/** Respawn delay after a PvP death (ms). */
export const PVP_RESPAWN_MS = 3500;
/** Anti-teleport: max plausible player movement speed (world units/sec). */
export const MAX_MOVE_SPEED = 60;
/** A full parry/dodge avoid is honoured at most once per this window (ms). */
export const PVP_AVOID_COOLDOWN_MS = 450;

/** Room rules. */
export type RoomMode = "coop" | "pvp";
export type RoomVisibility = "public" | "private";

/**
 * Spec for an always-on "official" lobby that the server seeds at startup and
 * never reaps when empty (an ad-hoc room is deleted the moment its last player
 * leaves). These give the lobby a stable set of rooms players can always drop
 * into. Pure data so both the server (which builds the rooms) and the client
 * (which can label them) share one source of truth.
 */
export interface PersistentRoomSpec {
  /** Stable, human-stable room code (also the join code). */
  code: string;
  /** Display name shown in the lobby. */
  name: string;
  mode: RoomMode;
  /** Training-environment preset id this lobby always renders. */
  preset: string;
  /** Capacity for this lobby. */
  maxPlayers: number;
}

/**
 * The official always-on lobbies. The named "Danger Room" (co-op holo training)
 * and "Colosseum" (PvP stone arena) each cap at {@link PERSISTENT_ROOM_MAX_PLAYERS}.
 */
export const PERSISTENT_ROOMS: readonly PersistentRoomSpec[] = [
  {
    code: "DANGER",
    name: "Danger Room",
    mode: "coop",
    preset: "holo",
    maxPlayers: PERSISTENT_ROOM_MAX_PLAYERS,
  },
  {
    code: "ARENA",
    name: "Colosseum",
    mode: "pvp",
    preset: "colosseum",
    maxPlayers: PERSISTENT_ROOM_MAX_PLAYERS,
  },
];

/**
 * Coarse defensive stance a client reports each tick. The server can't re-run
 * the rich epicfight block/parry/dodge timing, so it mitigates incoming PvP
 * damage off this single field (see `resolvePvpDamage`). Full parry/dodge avoids
 * are rate-limited server-side so a client claiming a permanent guard can't go
 * invincible.
 */
export type GuardState = "open" | "block" | "parry" | "dodge";

/** Resolved category of an applied PvP hit (server → clients, for reactions). */
export type HitOutcome = "hit" | "block" | "avoid";

/** What world/content a room runs. `arena` = the built-in default Danger Room. */
export type ContentKind = "scene" | "dungeon" | "arena";

/** A reference to the playable content a room loads. */
export interface ContentRef {
  kind: ContentKind;
  /** Gallery post id backing this content; omitted for the default arena. */
  postId?: number;
  /** Display name (room/content label). */
  name?: string;
  /**
   * Training-environment preset id (the Danger Room shell skin) the room renders
   * for every joiner. A plain string so this lib stays decoupled from the
   * animator's preset set; the client validates it and falls back to its own
   * default when the value is missing or unknown.
   */
  preset?: string;
}

/**
 * A player's self-reported state. Plain numbers only; the client maps these onto
 * a Three avatar, the server never renders.
 */
export interface PlayerSnapshot {
  px: number;
  py: number;
  pz: number;
  /** Yaw / facing in radians. */
  ry: number;
  /** Current locomotion/action clip key (drives the remote avatar's animation). */
  clip: string;
  /** Equipped weapon id. */
  weapon: string;
  /** Current health. */
  hp: number;
  /** True while actively moving (lets remotes pick a stride blend). */
  moving: boolean;
  /** True while grounded; false mid-air (jump/fall). */
  grounded: boolean;
  /** Defensive stance, drives server-side PvP damage mitigation. */
  guard: GuardState;
}

/** The server's view of a player: identity + latest snapshot + room role. */
export interface PlayerState extends PlayerSnapshot {
  id: string;
  name: string;
  host: boolean;
  alive: boolean;
}

/** Host-owned NPC state, broadcast from the host and relayed to everyone else. */
export interface NpcState {
  id: string;
  /** Archetype/character key used to pick the rig. */
  archetype: string;
  weapon: string;
  px: number;
  py: number;
  pz: number;
  ry: number;
  clip: string;
  hp: number;
  maxHp: number;
  alive: boolean;
}

/**
 * A combat event. `target` distinguishes player-vs-player hits (subject to the
 * room's pvp/coop rule) from hits against host-owned NPCs (always forwarded to
 * the host, which owns NPC health).
 */
export type CombatEvent =
  | { k: "attack"; from: string; action: string }
  | {
      k: "hit";
      from: string;
      to: string;
      target: "player" | "npc";
      amount: number;
      /**
       * Resolved category, set by the server on the authoritative re-broadcast of
       * a PvP hit (the client's own claim omits it). Lets the victim/onlookers
       * play the right reaction without re-deriving damage.
       */
      outcome?: HitOutcome;
    }
  | { k: "death"; from: string }
  | { k: "respawn"; from: string };

/** Compact public room listing for the lobby. */
export interface PublicRoomInfo {
  code: string;
  name: string;
  mode: RoomMode;
  content: ContentRef;
  players: number;
  maxPlayers: number;
  hostName: string;
  /** True for an always-on official lobby (see {@link PERSISTENT_ROOMS}). */
  persistent: boolean;
}
