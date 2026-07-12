import {
  MAX_MOVE_SPEED,
  PVP_HIT_MAX_DAMAGE,
  type CombatEvent,
  type GuardState,
  type HitOutcome,
  type NpcState,
  type PlayerSnapshot,
} from "./types";

/**
 * Relay-side helpers. There is no authoritative character simulation here (see
 * the note in `types.ts`); these are just the small pure utilities both ends
 * share: untrusted-input sanitisation and interpolation math for smooth remote
 * avatars.
 */

const MAX_COORD = 1e6;

function finite(n: unknown, fallback = 0): number {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function clampCoord(n: number): number {
  if (n > MAX_COORD) return MAX_COORD;
  if (n < -MAX_COORD) return -MAX_COORD;
  return n;
}

/**
 * Coerce an untrusted self-snapshot into a safe `PlayerSnapshot`. The WS
 * endpoint is public; a NaN/Infinity field, once stored and rebroadcast, would
 * poison every other client's interpolation. Reject non-finite numbers and clamp
 * coordinates before the room ever stores the value.
 */
export function sanitizeSnapshot(raw: unknown): PlayerSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const clip = typeof s.clip === "string" ? s.clip.slice(0, 64) : "idle";
  const weapon = typeof s.weapon === "string" ? s.weapon.slice(0, 32) : "none";
  return {
    px: clampCoord(finite(s.px)),
    py: clampCoord(finite(s.py)),
    pz: clampCoord(finite(s.pz)),
    ry: finite(s.ry),
    clip,
    weapon,
    hp: finite(s.hp, 100),
    moving: !!s.moving,
    grounded: s.grounded === undefined ? true : !!s.grounded,
    guard: sanitizeGuard(s.guard),
  };
}

/** Coerce an untrusted guard field to a known `GuardState` (defaults to open). */
export function sanitizeGuard(raw: unknown): GuardState {
  return raw === "block" || raw === "parry" || raw === "dodge" ? raw : "open";
}

/** Sanitise a host NPC roster, dropping malformed entries (cap the count). */
export function sanitizeNpcs(raw: unknown, max = 64): NpcState[] {
  if (!Array.isArray(raw)) return [];
  const out: NpcState[] = [];
  for (const item of raw) {
    if (out.length >= max) break;
    if (!item || typeof item !== "object") continue;
    const n = item as Record<string, unknown>;
    if (typeof n.id !== "string") continue;
    out.push({
      id: n.id.slice(0, 64),
      archetype: typeof n.archetype === "string" ? n.archetype.slice(0, 64) : "dummy",
      weapon: typeof n.weapon === "string" ? n.weapon.slice(0, 32) : "none",
      px: clampCoord(finite(n.px)),
      py: clampCoord(finite(n.py)),
      pz: clampCoord(finite(n.pz)),
      ry: finite(n.ry),
      clip: typeof n.clip === "string" ? n.clip.slice(0, 64) : "idle",
      hp: finite(n.hp, 100),
      maxHp: finite(n.maxHp, 100),
      alive: n.alive === undefined ? true : !!n.alive,
    });
  }
  return out;
}

/** Validate a combat event from an untrusted client; null if malformed. */
export function sanitizeCombat(raw: unknown, from: string): CombatEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  switch (e.k) {
    case "attack":
      return { k: "attack", from, action: typeof e.action === "string" ? e.action.slice(0, 64) : "attack" };
    case "death":
      return { k: "death", from };
    case "respawn":
      return { k: "respawn", from };
    case "hit": {
      if (typeof e.to !== "string") return null;
      const target = e.target === "npc" ? "npc" : "player";
      const amount = finite(e.amount, 0);
      if (amount <= 0 || amount > 10000) return null;
      return { k: "hit", from, to: e.to.slice(0, 64), target, amount };
    }
    default:
      return null;
  }
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp a raw damage claim into the server-accepted range. */
export function clampDamage(amount: number): number {
  const n = finite(amount, 0);
  if (n <= 0) return 0;
  return n > PVP_HIT_MAX_DAMAGE ? PVP_HIT_MAX_DAMAGE : n;
}

/** Damage multiplier for a guard stance (block leaks chip; open takes full). */
export function guardFactor(guard: GuardState): number {
  switch (guard) {
    case "block":
      return 0.35;
    case "parry":
    case "dodge":
      return 0; // full avoid — gated by `canAvoid` in `resolvePvpDamage`
    case "open":
    default:
      return 1;
  }
}

/**
 * Resolve how much of an (already validated) PvP hit actually lands, given the
 * victim's reported guard. `canAvoid` is supplied by the room: a parry/dodge only
 * fully negates damage when the victim hasn't spent its avoid window recently, so
 * a client claiming a permanent parry/dodge still eats every hit after the first.
 */
export function resolvePvpDamage(
  amount: number,
  guard: GuardState,
  canAvoid: boolean,
): { applied: number; outcome: HitOutcome } {
  const base = clampDamage(amount);
  if (guard === "parry" || guard === "dodge") {
    if (canAvoid) return { applied: 0, outcome: "avoid" };
    return { applied: Math.round(base), outcome: "hit" }; // avoid on cooldown → lands
  }
  if (guard === "block") return { applied: Math.round(base * guardFactor("block")), outcome: "block" };
  return { applied: Math.round(base), outcome: "hit" };
}

/**
 * Anti-teleport movement clamp. Returns the furthest the player is allowed to be
 * this report given the elapsed time, pulling an over-long jump back toward the
 * previous position. Keeps server-tracked positions trustworthy so PvP hit
 * range-checks (and rebroadcast transforms) can't be spoofed by a teleport.
 */
export function clampMove(
  prev: { x: number; y: number; z: number },
  next: { x: number; y: number; z: number },
  dtSec: number,
): { x: number; y: number; z: number } {
  const dt = Math.max(0, Math.min(1, finite(dtSec, 0)));
  // Allowance: distance at max speed for the elapsed time + a fixed slack so a
  // single laggy report or a legit dash burst isn't rubber-banded.
  const allowed = MAX_MOVE_SPEED * dt + 4;
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const dz = next.z - prev.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist <= allowed || dist < 1e-6) return { x: next.x, y: next.y, z: next.z };
  const s = allowed / dist;
  return { x: prev.x + dx * s, y: prev.y + dy * s, z: prev.z + dz * s };
}

/** Shortest-arc angular interpolation (radians). */
export function lerpAngle(a: number, b: number, t: number): number {
  const TWO_PI = Math.PI * 2;
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return a + d * t;
}
