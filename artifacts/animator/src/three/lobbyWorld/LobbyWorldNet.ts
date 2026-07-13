/**
 * Lobby World PvP — reuses Danger Room multiplayer relay in PvP mode so real
 * GRUDOX / Warlords characters can fight each other on the island.
 */

import type { DangerClient } from "../../net/DangerClient";
import type { PlayerSnapshot, PlayerState, CombatEvent } from "@workspace/danger-net";
import type { FleetPlayerLoadout } from "../../auth/fleetCharacter";
import { encodeWirePlayerName } from "../../auth/fleetCharacter";

export const LOBBY_WORLD_ROOM_NAME = "GRUDOX Island";
/** Prefer joining the official Colosseum-style code if present; else create public PvP. */
export const LOBBY_WORLD_JOIN_CODES = ["ISLAND", "WORLD", "GRUDOX"] as const;

export interface LobbyNetHooks {
  onRemoteJoin: (id: string, wireName: string) => void;
  onRemoteLeave: (id: string) => void;
  onSnapshot: (players: PlayerState[]) => void;
  onCombat: (ev: CombatEvent) => void;
  onStatus: (msg: string) => void;
  onConnected: (connected: boolean) => void;
}

/**
 * Attach a shared DangerClient to Lobby World island PvP.
 * Does not own the client lifecycle (App owns it) unless `ownClient` is set.
 */
export class LobbyWorldNet {
  private net: DangerClient;
  private hooks: LobbyNetHooks;
  private offs: Array<() => void> = [];
  private loadout: FleetPlayerLoadout | null = null;
  private joined = false;
  private ownClient: boolean;

  constructor(net: DangerClient, hooks: LobbyNetHooks, opts?: { ownClient?: boolean }) {
    this.net = net;
    this.hooks = hooks;
    this.ownClient = !!opts?.ownClient;
  }

  get roomCode(): string | null {
    return this.net.roomCode;
  }

  get selfId(): string {
    return this.net.selfId;
  }

  get connected(): boolean {
    return this.net.connected;
  }

  get inRoom(): boolean {
    return this.joined && !!this.net.roomCode;
  }

  setLoadout(loadout: FleetPlayerLoadout) {
    this.loadout = loadout;
  }

  start(): void {
    // Drop any previous Danger Room session so island PvP owns the relay.
    if (this.net.roomCode) this.net.leave();
    this.net.connect();
    this.offs.push(
      this.net.on("open", () => {
        this.hooks.onConnected(true);
        this.hooks.onStatus("Relay connected — joining island PvP…");
        this.tryJoinOrCreate();
      }),
    );
    this.offs.push(
      this.net.on("close", () => {
        this.hooks.onConnected(false);
        this.joined = false;
        this.hooks.onStatus("Relay disconnected");
      }),
    );
    this.offs.push(
      this.net.on("welcome", (msg) => {
        this.joined = true;
        this.hooks.onStatus(`In PvP room ${msg.code} · ${msg.mode}`);
        for (const p of msg.players) {
          if (p.id !== msg.self) this.hooks.onRemoteJoin(p.id, p.name);
        }
      }),
    );
    this.offs.push(
      this.net.on("joined", (p) => {
        if (p.id !== this.net.selfId) this.hooks.onRemoteJoin(p.id, p.name);
      }),
    );
    this.offs.push(this.net.on("left", (id) => this.hooks.onRemoteLeave(id)));
    this.offs.push(this.net.on("snapshot", (players) => this.hooks.onSnapshot(players)));
    this.offs.push(this.net.on("combat", (ev) => this.hooks.onCombat(ev)));
    this.offs.push(
      this.net.on("error", (_c, message) => {
        this.hooks.onStatus(message);
      }),
    );
    this.offs.push(
      this.net.on("rooms", (rooms) => {
        if (this.joined) return;
        // Prefer an existing GRUDOX Island / public PvP room
        const want = rooms.find(
          (r) =>
            r.mode === "pvp" &&
            (r.name.toLowerCase().includes("grudox") ||
              r.name.toLowerCase().includes("island") ||
              LOBBY_WORLD_JOIN_CODES.includes(r.code as (typeof LOBBY_WORLD_JOIN_CODES)[number])),
        );
        if (want && this.loadout) {
          this.net.join(want.code, encodeWirePlayerName(this.loadout));
        }
      }),
    );

    if (this.net.connected) {
      this.hooks.onConnected(true);
      this.tryJoinOrCreate();
    }
  }

  private tryJoinOrCreate(): void {
    if (!this.loadout || this.joined) return;
    const player = encodeWirePlayerName(this.loadout);
    // List first — rooms handler may join; then create fallback after short delay
    this.net.list();
    window.setTimeout(() => {
      if (this.joined || !this.loadout) return;
      this.net.create({
        player,
        name: LOBBY_WORLD_ROOM_NAME,
        mode: "pvp",
        visibility: "public",
        content: { kind: "arena", name: LOBBY_WORLD_ROOM_NAME, preset: "holo" },
      });
    }, 1200);
  }

  sendState(snap: PlayerSnapshot): void {
    if (this.inRoom) this.net.sendState(snap);
  }

  sendCombat(ev: CombatEvent): void {
    if (this.inRoom) this.net.sendCombat(ev);
  }

  leave(): void {
    if (this.joined) this.net.leave();
    this.joined = false;
  }

  dispose(): void {
    this.leave();
    for (const off of this.offs) off();
    this.offs = [];
    if (this.ownClient) this.net.dispose();
  }
}
