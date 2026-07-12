import type {
  CombatEvent,
  ContentRef,
  NpcState,
  PlayerSnapshot,
  PlayerState,
  PublicRoomInfo,
  RoomMode,
  RoomVisibility,
} from "./types";

/**
 * Wire protocol for the Danger Room relay. Messages are JSON, discriminated by a
 * `t` tag (mirrors `@workspace/space-net`). `decode*` helpers never throw — a
 * malformed frame returns `null` and is dropped, so one bad client can't crash
 * the room.
 */

export type ClientMessage =
  // ── lobby (pre-room) ──────────────────────────────────────────────────────
  /** Ask for the current public room list. */
  | { t: "list" }
  /** Create a room and join it as the first player + host. */
  | {
      t: "create";
      player: string;
      name: string;
      mode: RoomMode;
      visibility: RoomVisibility;
      content: ContentRef;
    }
  /** Join an existing room by code. */
  | { t: "join"; code: string; player: string }
  // ── in-room ───────────────────────────────────────────────────────────────
  /** Leave the current room (stay connected for the lobby). */
  | { t: "leave" }
  /** Report this client's own avatar state. */
  | { t: "state"; snap: PlayerSnapshot }
  /** Broadcast a combat event (attack/hit/death/respawn). */
  | { t: "combat"; ev: CombatEvent }
  /** Host-only: full NPC roster snapshot. */
  | { t: "npcs"; npcs: NpcState[] }
  /**
   * Host-only: change the room's training-environment preset mid-session. The
   * server updates the stored {@link ContentRef.preset} (so late joiners get it
   * in `welcome`) and re-broadcasts it to everyone so all current joiners switch
   * arenas in lockstep.
   */
  | { t: "preset"; preset: string };

export type ServerMessage =
  /** Response to `list`. */
  | { t: "rooms"; rooms: PublicRoomInfo[] }
  /** Successful join/create. Carries the room config + current roster. */
  | {
      t: "welcome";
      self: string;
      code: string;
      mode: RoomMode;
      content: ContentRef;
      hostId: string;
      players: PlayerState[];
      tickHz: number;
    }
  /** A request failed (e.g. room not found, room full). */
  | { t: "error"; code: string; message: string }
  /** Per-tick roster snapshot of every player's latest state. */
  | { t: "snapshot"; time: number; players: PlayerState[] }
  /** Host-relayed NPC roster. */
  | { t: "npcs"; npcs: NpcState[] }
  /** A relayed combat event (already filtered by room rules). */
  | { t: "combat"; ev: CombatEvent }
  /** A player joined the room. */
  | { t: "joined"; player: PlayerState }
  /** A player left the room. */
  | { t: "left"; id: string }
  /** The host changed (migration after the old host left). */
  | { t: "host"; id: string }
  /** The host changed the room's environment preset; everyone switches arenas. */
  | { t: "preset"; preset: string };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMessage | null {
  try {
    const m = JSON.parse(raw) as ClientMessage;
    if (m && typeof m === "object" && typeof (m as { t?: unknown }).t === "string") {
      return m;
    }
  } catch {
    /* drop malformed frame */
  }
  return null;
}

export function decodeServer(raw: string): ServerMessage | null {
  try {
    const m = JSON.parse(raw) as ServerMessage;
    if (m && typeof m === "object" && typeof (m as { t?: unknown }).t === "string") {
      return m;
    }
  } catch {
    /* drop malformed frame */
  }
  return null;
}
