/**
 * Advanced combat stack rules — weapon-family buffs/debuffs, rate limits,
 * threshold promotions, and skill-charge primes. Pure data + pure functions
 * (no THREE / DOM) so unit tests and hosts share one SSOT.
 */
import type { StatusId, WeaponId } from "../types";

/** How a weapon hit profiles for proc affinity. */
export type DamageProfile =
  | "blade"
  | "blunt"
  | "point"
  | "fire"
  | "ice"
  | "storm"
  | "nature"
  | "holy"
  | "arcane"
  | "none";

export interface StackRule {
  id: StatusId;
  maxStacks: number;
  /** Duration (s) refreshed on every successful stack add. */
  duration: number;
  /** Min seconds between stack gains (0 = unlimited). */
  stackInterval: number;
  /**
   * When stacks reach `maxStacks` and another apply is attempted, promote to
   * this status and clear the stacking one (e.g. frosted → frozen).
   */
  promoteAtMax?: StatusId;
  /** If true, promotion happens on the NEXT apply after max (threshold full). */
  promoteOnNextAtMax?: boolean;
  /** Self-buff vs target debuff (for HUD grouping / host routing). */
  target: "self" | "hostile";
}

/** Canonical stack rules for combat procs. */
export const STACK_RULES: Partial<Record<StatusId, StackRule>> = {
  // Ice: −1% speed/stack (host), 10s, 1 stack/s, at 5 next ice → frozen 2s
  frosted: {
    id: "frosted",
    maxStacks: 5,
    duration: 10,
    stackInterval: 1,
    promoteOnNextAtMax: true,
    promoteAtMax: "frozen",
    target: "hostile",
  },
  // Fire: smolder stacks → next fire at 5 engulfs (heavy burning)
  smoldering: {
    id: "smoldering",
    maxStacks: 5,
    duration: 10,
    stackInterval: 1,
    promoteOnNextAtMax: true,
    promoteAtMax: "engulfed",
    target: "hostile",
  },
  // Storm: caster charge → 5th skybolt + reset
  chargedStorm: {
    id: "chargedStorm",
    maxStacks: 5,
    duration: 12,
    stackInterval: 0.35,
    promoteOnNextAtMax: true,
    promoteAtMax: "skyboltPrimed",
    target: "self",
  },
  // Arcane: 3 stacks unlock blink dodge proc
  arcaneCharge: {
    id: "arcaneCharge",
    maxStacks: 3,
    duration: 14,
    stackInterval: 0.4,
    promoteOnNextAtMax: true,
    promoteAtMax: "arcaneBlink",
    target: "self",
  },
  // Blade bleed on target
  bleeding: {
    id: "bleeding",
    maxStacks: 5,
    duration: 8,
    stackInterval: 0.45,
    target: "hostile",
  },
  // Blunt slow → 5th stack stun 1.5s + reset
  bluntTrauma: {
    id: "bluntTrauma",
    maxStacks: 5,
    duration: 8,
    stackInterval: 0.5,
    promoteOnNextAtMax: true,
    promoteAtMax: "stunned",
    target: "hostile",
  },
  // Pointed weapons: self shred (stamina cost cut), 6th free skill
  shred: {
    id: "shred",
    maxStacks: 6,
    duration: 12,
    stackInterval: 0.35,
    promoteOnNextAtMax: true,
    promoteAtMax: "freeSkill",
    target: "self",
  },
  // Guard-break debt
  exhausted: {
    id: "exhausted",
    maxStacks: 3,
    duration: 12,
    stackInterval: 0,
    target: "self",
  },
  // Skill-1 charge → empower next skill
  skillCharge: {
    id: "skillCharge",
    maxStacks: 5,
    duration: 20,
    stackInterval: 0,
    promoteOnNextAtMax: true,
    promoteAtMax: "skillPrimed",
    target: "self",
  },
  // Nature / holy softer stacks
  venom: {
    id: "venom",
    maxStacks: 5,
    duration: 9,
    stackInterval: 0.6,
    target: "hostile",
  },
  blessed: {
    id: "blessed",
    maxStacks: 3,
    duration: 10,
    stackInterval: 0.5,
    target: "self",
  },
};

/** Non-stacking primed / mode statuses (duration-only). */
export const PRIMED_DURATIONS: Partial<Record<StatusId, number>> = {
  frozen: 2,
  engulfed: 4,
  stunned: 1.5,
  skyboltPrimed: 6,
  arcaneBlink: 10,
  freeSkill: 8,
  skillPrimed: 12,
  perfectCounter: 3,
  invisible: 4,
  empowered: 8,
  shielded: 10,
  haste: 8,
};

export interface EntityStackState {
  stacks: number;
  remaining: number;
  duration: number;
  /** Time until another stack may be added. */
  intervalLeft: number;
}

export interface ApplyStackResult {
  id: StatusId;
  stacks: number;
  remaining: number;
  duration: number;
  /** True when a new stack was added (not only refresh). */
  stacked: boolean;
  /** Status promoted into (and stacking id cleared). */
  promoted?: StatusId;
  /** Host-facing flash text. */
  flash?: string;
}

/** Map weapon id → damage profile for proc affinity. */
export function damageProfileForWeapon(weaponId: WeaponId): DamageProfile {
  switch (weaponId) {
    case "sword":
    case "greatsword":
    case "axe":
    case "greataxe":
    case "gunblade":
      return "blade";
    case "hammer":
    case "hammer2h":
    case "mace":
    case "mace2h":
      return "blunt";
    case "dagger":
    case "spear":
    case "javelin":
    case "bow":
    case "pistol":
    case "rifle":
    case "hunter-rifle":
      return "point";
    case "staffFire":
      return "fire";
    case "staffIce":
      return "ice";
    case "staffStorm":
      return "storm";
    case "staffNature":
      return "nature";
    case "staffHoly":
      return "holy";
    case "staffArcane":
    case "staff":
      return "arcane";
    default:
      return "none";
  }
}

/**
 * Status applied on a successful hostile hit for this weapon profile.
 * Self-buffs (shred, storm charge, arcane) are listed separately.
 */
export function hostileProcForProfile(profile: DamageProfile): StatusId | null {
  switch (profile) {
    case "blade":
      return "bleeding";
    case "blunt":
      return "bluntTrauma";
    case "fire":
      return "smoldering";
    case "ice":
      return "frosted";
    case "nature":
      return "venom";
    default:
      return null;
  }
}

/** Self-buff stacks gained on a successful hit / cast for this profile. */
export function selfProcForProfile(profile: DamageProfile): StatusId | null {
  switch (profile) {
    case "point":
      return "shred";
    case "storm":
      return "chargedStorm";
    case "arcane":
      return "arcaneCharge";
    case "holy":
      return "blessed";
    default:
      return null;
  }
}

/** Mutable bag of stacks for one entity. */
export class EntityStacks {
  private map = new Map<StatusId, EntityStackState>();

  get(id: StatusId): EntityStackState | undefined {
    return this.map.get(id);
  }

  has(id: StatusId): boolean {
    return this.map.has(id);
  }

  clear(id: StatusId): void {
    this.map.delete(id);
  }

  clearAll(): void {
    this.map.clear();
  }

  /** Tick timers; remove expired. */
  update(dt: number): void {
    for (const [id, s] of this.map) {
      if (s.intervalLeft > 0) s.intervalLeft = Math.max(0, s.intervalLeft - dt);
      s.remaining -= dt;
      if (s.remaining <= 0) this.map.delete(id);
    }
  }

  /**
   * Apply or stack a status. Handles rate limit, max stacks, and promote-on-next.
   */
  apply(id: StatusId): ApplyStackResult {
    const rule = STACK_RULES[id];
    if (!rule) {
      // Non-stacking / primed duration-only
      const dur = PRIMED_DURATIONS[id] ?? 6;
      this.map.set(id, { stacks: 1, remaining: dur, duration: dur, intervalLeft: 0 });
      return { id, stacks: 1, remaining: dur, duration: dur, stacked: true };
    }

    const cur = this.map.get(id);
    // Already at max and promote-on-next: this apply promotes instead of stacking.
    if (cur && cur.stacks >= rule.maxStacks && rule.promoteOnNextAtMax && rule.promoteAtMax) {
      this.map.delete(id);
      const promo = rule.promoteAtMax;
      const promoDur = PRIMED_DURATIONS[promo] ?? rule.duration;
      this.map.set(promo, {
        stacks: 1,
        remaining: promoDur,
        duration: promoDur,
        intervalLeft: 0,
      });
      return {
        id: promo,
        stacks: 1,
        remaining: promoDur,
        duration: promoDur,
        stacked: true,
        promoted: promo,
        flash: flashForPromotion(promo),
      };
    }

    if (cur && cur.intervalLeft > 0) {
      // Rate-limited: only refresh remaining timer, no new stack.
      cur.remaining = rule.duration;
      return {
        id,
        stacks: cur.stacks,
        remaining: cur.remaining,
        duration: cur.duration,
        stacked: false,
      };
    }

    const stacks = Math.min(rule.maxStacks, (cur?.stacks ?? 0) + 1);
    const next: EntityStackState = {
      stacks,
      remaining: rule.duration,
      duration: rule.duration,
      intervalLeft: rule.stackInterval,
    };
    this.map.set(id, next);

    // Immediate promote when not using promoteOnNext (rare); mostly for neatness.
    if (!rule.promoteOnNextAtMax && stacks >= rule.maxStacks && rule.promoteAtMax) {
      this.map.delete(id);
      const promo = rule.promoteAtMax;
      const promoDur = PRIMED_DURATIONS[promo] ?? rule.duration;
      this.map.set(promo, {
        stacks: 1,
        remaining: promoDur,
        duration: promoDur,
        intervalLeft: 0,
      });
      return {
        id: promo,
        stacks: 1,
        remaining: promoDur,
        duration: promoDur,
        stacked: true,
        promoted: promo,
        flash: flashForPromotion(promo),
      };
    }

    return {
      id,
      stacks,
      remaining: next.remaining,
      duration: next.duration,
      stacked: true,
      flash: stacks >= rule.maxStacks ? `${labelOf(id).toUpperCase()} MAX` : undefined,
    };
  }

  /** Snapshot for HUD icons. */
  views(): Array<{
    id: StatusId;
    stacks: number;
    remaining: number;
    duration: number;
  }> {
    const out: Array<{ id: StatusId; stacks: number; remaining: number; duration: number }> = [];
    for (const [id, s] of this.map) {
      out.push({ id, stacks: s.stacks, remaining: s.remaining, duration: s.duration });
    }
    return out;
  }
}

function flashForPromotion(id: StatusId): string {
  switch (id) {
    case "frozen":
      return "FROZEN!";
    case "engulfed":
      return "ENGULFED!";
    case "stunned":
      return "STAGGER STUN!";
    case "skyboltPrimed":
      return "SKYBOLT READY!";
    case "arcaneBlink":
      return "ARCANE BLINK!";
    case "freeSkill":
      return "FREE SKILL!";
    case "skillPrimed":
      return "SKILL EMPOWERED!";
    default:
      return id.toUpperCase();
  }
}

function labelOf(id: StatusId): string {
  return id.replace(/([A-Z])/g, " $1").trim();
}

/**
 * Multi-entity combat status board (player + each enemy id).
 * Player key is always {@link PLAYER_STATUS_KEY}.
 */
export const PLAYER_STATUS_KEY = "player";

export class CombatStatusBoard {
  private entities = new Map<string | number, EntityStacks>();

  entity(key: string | number): EntityStacks {
    let e = this.entities.get(key);
    if (!e) {
      e = new EntityStacks();
      this.entities.set(key, e);
    }
    return e;
  }

  apply(key: string | number, id: StatusId): ApplyStackResult {
    return this.entity(key).apply(id);
  }

  clear(key: string | number, id?: StatusId): void {
    const e = this.entities.get(key);
    if (!e) return;
    if (id) e.clear(id);
    else e.clearAll();
  }

  has(key: string | number, id: StatusId): boolean {
    return this.entities.get(key)?.has(id) ?? false;
  }

  getStacks(key: string | number, id: StatusId): number {
    return this.entities.get(key)?.get(id)?.stacks ?? 0;
  }

  views(key: string | number): Array<{
    id: StatusId;
    stacks: number;
    remaining: number;
    duration: number;
  }> {
    return this.entities.get(key)?.views() ?? [];
  }

  update(dt: number): void {
    for (const e of this.entities.values()) e.update(dt);
  }

  /** Stamina cost multiplier from shred stacks (point weapons). */
  staminaCostMul(key: string | number = PLAYER_STATUS_KEY): number {
    if (this.has(key, "freeSkill")) return 0;
    const stacks = this.getStacks(key, "shred");
    // −8% stamina cost per shred stack (floor 40% of original).
    return Math.max(0.4, 1 - stacks * 0.08);
  }

  /** Speed multiplier from frosted (hostile) or chargedStorm/haste (self). */
  speedMul(key: string | number): number {
    const frost = this.getStacks(key, "frosted");
    let mul = 1 - frost * 0.01;
    if (this.has(key, "frozen")) mul *= 0;
    if (this.has(key, "bluntTrauma")) mul *= 1 - this.getStacks(key, "bluntTrauma") * 0.06;
    if (this.has(key, "chargedStorm")) mul *= 1 + this.getStacks(key, "chargedStorm") * 0.03;
    if (this.has(key, "haste")) mul *= 1.12;
    if (this.has(key, "blessed")) mul *= 1.04;
    if (this.has(key, "invisible")) mul *= 1.05;
    return Math.max(0, mul);
  }
}

/** Block: every 5 damage points costs 1 stamina. */
export function blockStaminaFromDamage(damage: number): number {
  return Math.max(0, Math.ceil(Math.max(0, damage) / 5));
}
