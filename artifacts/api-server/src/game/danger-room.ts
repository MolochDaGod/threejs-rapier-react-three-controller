/**
 * Danger Room multiplayer relay (client-authoritative).
 *
 * Unlike the space/carrier game rooms this does NOT run an authoritative
 * character simulation. Each client owns its own avatar and reports its
 * transform/anim/combat; the room stores each player's latest self-snapshot and
 * rebroadcasts the full roster at a fixed tick. One player is the host and owns
 * the shared NPCs/world — only the host's NPC roster is relayed. PvP/coop rules
 * are applied to relayed combat events here.
 */
import {
  MAX_PLAYERS,
  MAX_MOVE_SPEED,
  PERSISTENT_ROOMS,
  PLAYER_TIMEOUT_MS,
  PVP_ATTACK_WINDOW_MS,
  PVP_AVOID_COOLDOWN_MS,
  PVP_HIT_MAX_RANGE,
  PVP_HIT_MIN_INTERVAL_MS,
  PVP_MAX_HP,
  PVP_RESPAWN_MS,
  TICK_HZ,
  clampMove,
  encode,
  resolvePvpDamage,
  sanitizeCombat,
  sanitizeNpcs,
  sanitizeSnapshot,
  type CombatEvent,
  type ContentRef,
  type NpcState,
  type PlayerSnapshot,
  type PlayerState,
  type PublicRoomInfo,
  type RoomMode,
  type RoomVisibility,
} from "@workspace/danger-net";

export type Send = (data: string) => void;

const DEFAULT_SNAPSHOT: PlayerSnapshot = {
  px: 0,
  py: 0,
  pz: 0,
  ry: 0,
  clip: "idle",
  weapon: "none",
  hp: PVP_MAX_HP,
  moving: false,
  grounded: true,
  guard: "open",
};

interface RoomPlayer {
  id: string;
  name: string;
  send: Send;
  snap: PlayerSnapshot;
  alive: boolean;
  lastSeen: number;
  /**
   * Server-authoritative health (PvP). In coop this just mirrors the client's
   * self-reported hp; in pvp the server owns it and the client value is ignored.
   */
  hp: number;
  /** Last accepted (teleport-clamped) position, used for hit range-checks. */
  lastPos: { x: number; y: number; z: number };
  /** ms-timestamp of the last accepted state report (for the movement clamp). */
  lastStateAt: number;
  /** ms-timestamp of this player's last `attack` event (hits must follow one). */
  lastAttackAt: number;
  /** ms-timestamp of the last damage this player dealt (per-attacker rate limit). */
  lastHitAt: number;
  /** ms-timestamp of this player's last honoured parry/dodge avoid. */
  lastAvoidAt: number;
  /** When dead (pvp), the time at which the server respawns this player. */
  respawnAt: number;
}

export class DangerRoom {
  readonly code: string;
  readonly visibility: RoomVisibility;
  readonly maxPlayers: number;
  /** Always-on official lobby: never reaped when empty, resets on emptying. */
  readonly persistent: boolean;
  name: string;
  mode: RoomMode;
  content: ContentRef;
  hostId: string | null = null;

  /** Canonical content a persistent room reverts to once it empties. */
  private readonly seedContent: ContentRef;
  private players = new Map<string, RoomPlayer>();
  private npcs: NpcState[] = [];

  constructor(opts: {
    code: string;
    name: string;
    mode: RoomMode;
    visibility: RoomVisibility;
    content: ContentRef;
    maxPlayers?: number;
    persistent?: boolean;
  }) {
    this.code = opts.code;
    this.name = opts.name;
    this.mode = opts.mode;
    this.visibility = opts.visibility;
    this.content = opts.content;
    this.maxPlayers = opts.maxPlayers ?? MAX_PLAYERS;
    this.persistent = opts.persistent ?? false;
    this.seedContent = opts.content;
  }

  get playerCount(): number {
    return this.players.size;
  }

  isEmpty(): boolean {
    return this.players.size === 0;
  }

  isFull(): boolean {
    return this.players.size >= this.maxPlayers;
  }

  info(): PublicRoomInfo {
    const host = this.hostId ? this.players.get(this.hostId) : undefined;
    return {
      code: this.code,
      name: this.name,
      mode: this.mode,
      content: this.content,
      players: this.players.size,
      maxPlayers: this.maxPlayers,
      hostName: host?.name ?? "—",
      persistent: this.persistent,
    };
  }

  private playerState(p: RoomPlayer): PlayerState {
    // In pvp the server owns hp/alive; expose the authoritative value (not the
    // client's self-reported snapshot field) so a spoofed `state.hp` is ignored.
    const hp = this.mode === "pvp" ? p.hp : p.snap.hp;
    return {
      ...p.snap,
      hp,
      id: p.id,
      name: p.name,
      host: p.id === this.hostId,
      alive: this.mode === "pvp" ? p.alive : hp > 0,
    };
  }

  private roster(): PlayerState[] {
    return [...this.players.values()].map((p) => this.playerState(p));
  }

  private broadcast(data: string, exceptId?: string): void {
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      try {
        p.send(data);
      } catch {
        /* a dead socket is reaped on its own close/error */
      }
    }
  }

  /** Add a player (first joiner becomes host). Sends them the welcome roster. */
  addPlayer(id: string, name: string, send: Send): void {
    const now = Date.now();
    const player: RoomPlayer = {
      id,
      name: (name || "Player").slice(0, 32),
      send,
      snap: { ...DEFAULT_SNAPSHOT },
      alive: true,
      lastSeen: now,
      hp: PVP_MAX_HP,
      lastPos: { x: DEFAULT_SNAPSHOT.px, y: DEFAULT_SNAPSHOT.py, z: DEFAULT_SNAPSHOT.pz },
      lastStateAt: now,
      lastAttackAt: 0,
      lastHitAt: 0,
      lastAvoidAt: 0,
      respawnAt: 0,
    };
    if (this.hostId === null) this.hostId = id;
    this.players.set(id, player);

    send(
      encode({
        t: "welcome",
        self: id,
        code: this.code,
        mode: this.mode,
        content: this.content,
        hostId: this.hostId,
        players: this.roster(),
        tickHz: TICK_HZ,
      }),
    );
    // Tell everyone else a player joined.
    this.broadcast(encode({ t: "joined", player: this.playerState(player) }), id);
  }

  setState(id: string, raw: unknown): void {
    const p = this.players.get(id);
    if (!p) return;
    const snap = sanitizeSnapshot(raw);
    if (!snap) return;
    const now = Date.now();

    // Anti-teleport: clamp the reported position against the last accepted one so
    // a client can't blink across the arena (which would also defeat hit
    // range-checks). The clamped value is what we store + rebroadcast.
    const dt = (now - p.lastStateAt) / 1000;
    const clamped = clampMove(p.lastPos, { x: snap.px, y: snap.py, z: snap.pz }, dt);
    snap.px = clamped.x;
    snap.py = clamped.y;
    snap.pz = clamped.z;

    if (this.mode === "pvp") {
      // Server owns pvp hp: ignore the client's self-reported value but keep the
      // rebroadcast snapshot in agreement with the authoritative hp/alive.
      snap.hp = p.hp;
    } else {
      // Coop has no friendly fire; trust the client's self-reported hp.
      p.hp = snap.hp;
      p.alive = snap.hp > 0;
    }

    p.snap = snap;
    p.lastPos = clamped;
    p.lastStateAt = now;
    p.lastSeen = now;
  }

  setNpcs(id: string, raw: unknown): void {
    const p = this.players.get(id);
    if (!p) return;
    p.lastSeen = Date.now();
    // Only the host owns the shared NPC roster.
    if (id !== this.hostId) return;
    this.npcs = sanitizeNpcs(raw);
    this.broadcast(encode({ t: "npcs", npcs: this.npcs }));
  }

  /**
   * Host-only: change the room's environment preset mid-session. Updates the
   * stored {@link ContentRef.preset} so late joiners get the current arena in
   * their `welcome`, then re-broadcasts it to every other member so all current
   * joiners switch in lockstep. The host already applied it locally, so it's
   * excluded from the broadcast.
   */
  setPreset(id: string, raw: unknown): void {
    const p = this.players.get(id);
    if (!p) return;
    p.lastSeen = Date.now();
    // Only the host dictates the shared environment.
    if (id !== this.hostId) return;
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 64) return;
    this.content = { ...this.content, preset: raw };
    this.broadcast(encode({ t: "preset", preset: raw }), id);
  }

  handleCombat(id: string, raw: unknown): void {
    const p = this.players.get(id);
    if (!p) return;
    const now = Date.now();
    p.lastSeen = now;
    const ev = sanitizeCombat(raw, id);
    if (!ev) return;
    this.relayCombat(p, ev, now);
  }

  private relayCombat(from: RoomPlayer, ev: CombatEvent, now: number): void {
    switch (ev.k) {
      case "attack":
        // Record the swing so a subsequent hit claim can be tied to a real
        // attack window (a hit out of the blue is rejected), then play it back.
        from.lastAttackAt = now;
        this.broadcast(encode({ t: "combat", ev }), ev.from);
        return;
      case "death":
      case "respawn":
        // Cosmetic / self-authoritative: everyone else plays it back.
        this.broadcast(encode({ t: "combat", ev }), ev.from);
        return;
      case "hit": {
        if (ev.target === "npc") {
          // The host owns NPC health — forward the claim to the host only.
          const host = this.hostId ? this.players.get(this.hostId) : undefined;
          if (host && host.id !== ev.from) host.send(encode({ t: "combat", ev }));
          else if (host && host.id === ev.from) {
            /* host hit its own NPC; it already applied locally */
          }
          return;
        }
        // Player-vs-player damage: server-authoritative in PvP only (friendly
        // fire is off in co-op).
        if (this.mode !== "pvp") return;
        this.resolvePvpHit(from, ev.to, ev.amount, now);
        return;
      }
    }
  }

  /**
   * Validate + apply a PvP hit on the server. The attacker only *claims* a hit;
   * the server is the authority. A claim is dropped unless: both fighters exist,
   * are distinct and alive; the attacker swung recently (within the attack
   * window) and isn't spamming faster than the per-attacker rate limit; and the
   * victim is within range of the attacker's (teleport-clamped) position. Damage
   * is capped and mitigated by the victim's guard, applied to server-owned hp,
   * and the resolved hit is broadcast to everyone for reactions.
   */
  private resolvePvpHit(attacker: RoomPlayer, victimId: string, amount: number, now: number): void {
    const victim = this.players.get(victimId);
    if (!victim || victim.id === attacker.id) return;
    if (!attacker.alive || !victim.alive) return;

    // Must follow a real swing and respect the per-attacker rate limit.
    if (now - attacker.lastAttackAt > PVP_ATTACK_WINDOW_MS) return;
    if (now - attacker.lastHitAt < PVP_HIT_MIN_INTERVAL_MS) return;

    // Range check against the server's trusted positions.
    const dx = victim.lastPos.x - attacker.lastPos.x;
    const dy = victim.lastPos.y - attacker.lastPos.y;
    const dz = victim.lastPos.z - attacker.lastPos.z;
    if (dx * dx + dy * dy + dz * dz > PVP_HIT_MAX_RANGE * PVP_HIT_MAX_RANGE) return;

    const canAvoid = now - victim.lastAvoidAt >= PVP_AVOID_COOLDOWN_MS;
    const { applied, outcome } = resolvePvpDamage(amount, victim.snap.guard, canAvoid);
    attacker.lastHitAt = now;
    if (outcome === "avoid") victim.lastAvoidAt = now;

    if (applied > 0) {
      victim.hp = Math.max(0, victim.hp - applied);
      victim.snap.hp = victim.hp;
    }

    // Broadcast the resolved hit to everyone (incl. attacker + victim) so the
    // victim plays a reaction; authoritative hp rides the next snapshot.
    this.broadcast(
      encode({
        t: "combat",
        ev: { k: "hit", from: attacker.id, to: victim.id, target: "player", amount: applied, outcome },
      }),
    );

    if (victim.hp <= 0 && victim.alive) {
      victim.alive = false;
      victim.respawnAt = now + PVP_RESPAWN_MS;
      this.broadcast(encode({ t: "combat", ev: { k: "death", from: victim.id } }));
    }
  }

  /** Remove a player; reassign the host if it was them. */
  remove(id: string): void {
    if (!this.players.delete(id)) return;
    this.broadcast(encode({ t: "left", id }));
    if (this.hostId === id) {
      const next = this.players.keys().next();
      this.hostId = next.done ? null : next.value;
      if (this.hostId) this.broadcast(encode({ t: "host", id: this.hostId }));
    }
    // A persistent lobby is never deleted, so reset it to its canonical state
    // when the last player leaves — the next visitor walks into the official
    // arena (correct preset, no stale host-owned NPCs), not whatever the last
    // host had reconfigured it into.
    if (this.persistent && this.players.size === 0) {
      this.content = this.seedContent;
      this.npcs = [];
    }
  }

  /** Per-tick: drop stale players, respawn the dead, rebroadcast the roster. */
  tick(now: number): void {
    for (const [id, p] of this.players) {
      if (now - p.lastSeen > PLAYER_TIMEOUT_MS) this.remove(id);
    }
    if (this.mode === "pvp") {
      for (const p of this.players.values()) {
        if (!p.alive && p.respawnAt > 0 && now >= p.respawnAt) {
          p.hp = PVP_MAX_HP;
          p.snap.hp = PVP_MAX_HP;
          p.alive = true;
          p.respawnAt = 0;
          this.broadcast(encode({ t: "combat", ev: { k: "respawn", from: p.id } }));
        }
      }
    }
    if (this.players.size === 0) return;
    this.broadcast(encode({ t: "snapshot", time: now, players: this.roster() }));
  }
}

export class DangerRoomManager {
  private rooms = new Map<string, DangerRoom>();
  private timer: ReturnType<typeof setInterval>;

  constructor() {
    this.seedPersistentRooms();
    this.timer = setInterval(() => this.tick(), 1000 / TICK_HZ);
    // Don't keep the process alive solely for this relay timer.
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  /** Create the always-on official lobbies (Danger Room, Colosseum). */
  private seedPersistentRooms(): void {
    for (const spec of PERSISTENT_ROOMS) {
      const code = spec.code.toUpperCase();
      this.rooms.set(
        code,
        new DangerRoom({
          code,
          name: spec.name,
          mode: spec.mode,
          visibility: "public",
          content: { kind: "arena", name: spec.name, preset: spec.preset },
          maxPlayers: spec.maxPlayers,
          persistent: true,
        }),
      );
    }
  }

  private newCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = "";
      for (let i = 0; i < 5; i++) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    // Extremely unlikely fallback.
    return `R${Date.now().toString(36).toUpperCase()}`;
  }

  createRoom(opts: {
    name: string;
    mode: RoomMode;
    visibility: RoomVisibility;
    content: ContentRef;
  }): DangerRoom {
    const code = this.newCode();
    const room = new DangerRoom({ code, ...opts });
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code: string): DangerRoom | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  deleteRoomIfEmpty(code: string): void {
    const room = this.rooms.get(code);
    // Persistent (official) lobbies are never deleted, even when empty.
    if (room && !room.persistent && room.isEmpty()) this.rooms.delete(code);
  }

  publicRooms(): PublicRoomInfo[] {
    return [...this.rooms.values()]
      .filter((r) => r.visibility === "public" && (r.persistent || !r.isEmpty()))
      .map((r) => r.info());
  }

  private tick(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      room.tick(now);
      // Reap empty ad-hoc rooms; keep the always-on official lobbies alive.
      if (!room.persistent && room.isEmpty()) this.rooms.delete(code);
    }
  }
}
