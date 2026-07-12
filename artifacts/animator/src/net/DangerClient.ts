/**
 * Browser-side client for the Danger Room multiplayer relay (`/api/danger`).
 *
 * Thin typed wrapper over a WebSocket: handles connect/reconnect, exposes
 * lobby actions (list/create/join/leave) and in-room reporting
 * (state/combat/npcs), and emits decoded server messages to subscribers. A
 * single instance is created in the Lobby and handed to the Studio so the
 * session survives the lobby → room transition.
 */
import {
  WS_PATH,
  decodeServer,
  encode,
  type CombatEvent,
  type ContentRef,
  type NpcState,
  type PlayerSnapshot,
  type PlayerState,
  type PublicRoomInfo,
  type RoomMode,
  type RoomVisibility,
} from "@workspace/danger-net";

export interface WelcomeData {
  self: string;
  code: string;
  mode: RoomMode;
  content: ContentRef;
  hostId: string;
  players: PlayerState[];
  tickHz: number;
}

export interface DangerClientEvents {
  open: () => void;
  close: () => void;
  rooms: (rooms: PublicRoomInfo[]) => void;
  welcome: (msg: WelcomeData) => void;
  snapshot: (players: PlayerState[], time: number) => void;
  joined: (player: PlayerState) => void;
  left: (id: string) => void;
  host: (id: string) => void;
  npcs: (npcs: NpcState[]) => void;
  combat: (ev: CombatEvent) => void;
  preset: (preset: string) => void;
  error: (code: string, message: string) => void;
}

type Listener<K extends keyof DangerClientEvents> = DangerClientEvents[K];

/**
 * Resolve the WebSocket URL for the Danger Room relay.
 *
 * When `VITE_GAME_SERVER_URL` is configured (e.g. a dedicated VPS-hosted game
 * server), it is used as the origin and the relay path is appended — accepting
 * either an `http(s)://` or `ws(s)://` base. When unset, falls back to the
 * same-origin relay (the Replit deployment), preserving existing behavior.
 */
function relayUrl(): string {
  const configured = import.meta.env.VITE_GAME_SERVER_URL?.trim();
  if (configured) {
    const base = configured.replace(/\/+$/, "");
    const wsBase = base.replace(/^http(s?):\/\//i, (_m, s: string) => `ws${s}://`);
    return `${wsBase}${WS_PATH}`;
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${WS_PATH}`;
}

export class DangerClient {
  private ws: WebSocket | null = null;
  private listeners: { [K in keyof DangerClientEvents]: Set<Listener<K>> } = {
    open: new Set(),
    close: new Set(),
    rooms: new Set(),
    welcome: new Set(),
    snapshot: new Set(),
    joined: new Set(),
    left: new Set(),
    host: new Set(),
    npcs: new Set(),
    combat: new Set(),
    preset: new Set(),
    error: new Set(),
  };

  private wantOpen = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private outbox: string[] = [];

  // Last known room identity (also used to auto-rejoin after a reconnect).
  selfId = "";
  roomCode: string | null = null;
  hostId: string | null = null;
  mode: RoomMode = "coop";

  on<K extends keyof DangerClientEvents>(event: K, cb: Listener<K>): () => void {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  private emit<K extends keyof DangerClientEvents>(
    event: K,
    ...args: Parameters<Listener<K>>
  ): void {
    for (const cb of this.listeners[event]) {
      (cb as (...a: Parameters<Listener<K>>) => void)(...args);
    }
  }

  get isHost(): boolean {
    return !!this.selfId && this.selfId === this.hostId;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.wantOpen = true;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(relayUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      // Flush anything queued while connecting.
      for (const frame of this.outbox.splice(0)) ws.send(frame);
      this.emit("open");
    };
    ws.onclose = () => {
      this.emit("close");
      if (this.wantOpen) this.scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
    ws.onmessage = (e) => this.handle(typeof e.data === "string" ? e.data : "");
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.wantOpen) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  }

  private handle(raw: string): void {
    const msg = decodeServer(raw);
    if (!msg) return;
    switch (msg.t) {
      case "rooms":
        this.emit("rooms", msg.rooms);
        return;
      case "welcome":
        this.selfId = msg.self;
        this.roomCode = msg.code;
        this.hostId = msg.hostId;
        this.mode = msg.mode;
        this.emit("welcome", {
          self: msg.self,
          code: msg.code,
          mode: msg.mode,
          content: msg.content,
          hostId: msg.hostId,
          players: msg.players,
          tickHz: msg.tickHz,
        });
        return;
      case "snapshot":
        this.emit("snapshot", msg.players, msg.time);
        return;
      case "joined":
        this.emit("joined", msg.player);
        return;
      case "left":
        this.emit("left", msg.id);
        return;
      case "host":
        this.hostId = msg.id;
        this.emit("host", msg.id);
        return;
      case "npcs":
        this.emit("npcs", msg.npcs);
        return;
      case "combat":
        this.emit("combat", msg.ev);
        return;
      case "preset":
        this.emit("preset", msg.preset);
        return;
      case "error":
        this.emit("error", msg.code, msg.message);
        return;
    }
  }

  private send(frame: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(frame);
    } else {
      // Only worth queuing control frames; high-rate state can be dropped.
      this.outbox.push(frame);
      if (this.outbox.length > 16) this.outbox.shift();
    }
  }

  // ── lobby ──────────────────────────────────────────────────────────────────
  list(): void {
    this.send(encode({ t: "list" }));
  }

  create(opts: {
    player: string;
    name: string;
    mode: RoomMode;
    visibility: RoomVisibility;
    content: ContentRef;
  }): void {
    this.send(encode({ t: "create", ...opts }));
  }

  join(code: string, player: string): void {
    this.send(encode({ t: "join", code: code.toUpperCase(), player }));
  }

  leave(): void {
    this.roomCode = null;
    this.hostId = null;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode({ t: "leave" }));
  }

  // ── in-room ──────────────────────────────────────────────────────────────
  sendState(snap: PlayerSnapshot): void {
    // Drop self-state if the socket isn't live; the next tick will resend.
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode({ t: "state", snap }));
  }

  sendCombat(ev: CombatEvent): void {
    this.send(encode({ t: "combat", ev }));
  }

  sendNpcs(npcs: NpcState[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode({ t: "npcs", npcs }));
  }

  /** Host-only: broadcast a mid-session environment preset change to the room. */
  sendPreset(preset: string): void {
    this.send(encode({ t: "preset", preset }));
  }

  /** Tear down for good (no reconnect). */
  dispose(): void {
    this.wantOpen = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    for (const key of Object.keys(this.listeners) as (keyof DangerClientEvents)[]) {
      this.listeners[key].clear();
    }
  }
}
