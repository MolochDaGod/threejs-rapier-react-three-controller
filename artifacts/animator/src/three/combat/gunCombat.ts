/**
 * Production firearm combat helpers — reload variants (P0–P2) + fire verbs +
 * blend/feel constants (P3).
 *
 * Clip resolution is via Explorer ActionKeys (`reload`, `reloadEmpty`, …);
 * WEAPON_SETS maps those keys per pistol / ranged / shotgun class.
 */

import type { WeaponId } from "../types";
import type { ActionKey } from "../explorer/types";

export type GunReloadKind = "standing" | "empty" | "tactical" | "crouch";

export interface GunMagazineSpec {
  /** Rounds in a full magazine. */
  capacity: number;
  /** Empty-chamber reload duration (s). */
  reloadEmpty: number;
  /** Tactical reload (mag not empty) duration (s). */
  reloadTactical: number;
  /** Standing empty default (alias of reloadEmpty when crouch false). */
  reloadStanding: number;
  /** Crouch reload duration (s). */
  reloadCrouch: number;
}

/**
 * Production blend times (seconds) — snappy fire, readable reloads.
 * Tuned for Mixamo 25-bone packs + additive upper-body overlays.
 */
export const GUN_BLEND = {
  /** Fire / hip-fire / charged shot full-body entry. */
  fire: 0.05,
  /** Upper-body fire overlay fade (matches OVERLAY_FADE ballpark). */
  fireOverlay: 0.06,
  /** Reload family entry (slower, deliberate). */
  reload: 0.14,
  /** Shotgun pump rack. */
  pump: 0.08,
  /** Recovery back to loco after reload. */
  handback: 0.16,
} as const;

/** Min locomotion speed (0..1) before fire prefers upper-body overlay. */
export const GUN_MOVING_FIRE_SPEED = 0.18;

const SPECS: Partial<Record<WeaponId, GunMagazineSpec>> = {
  pistol: {
    capacity: 6,
    reloadEmpty: 1.35,
    reloadTactical: 1.05,
    reloadStanding: 1.25,
    reloadCrouch: 1.45,
  },
  rifle: {
    capacity: 8,
    reloadEmpty: 1.65,
    reloadTactical: 1.25,
    reloadStanding: 1.55,
    reloadCrouch: 1.75,
  },
  "hunter-rifle": {
    capacity: 4,
    reloadEmpty: 2.0,
    reloadTactical: 1.55,
    reloadStanding: 1.9,
    reloadCrouch: 2.1,
  },
  shotgun: {
    capacity: 5,
    reloadEmpty: 2.2,
    reloadTactical: 1.6,
    reloadStanding: 1.9,
    reloadCrouch: 2.3,
  },
  gunblade: {
    capacity: 8,
    reloadEmpty: 1.5,
    reloadTactical: 1.15,
    reloadStanding: 1.35,
    reloadCrouch: 1.55,
  },
};

export function isGunWeapon(id: WeaponId): boolean {
  return id in SPECS;
}

export function gunMagazineSpec(id: WeaponId): GunMagazineSpec | null {
  return SPECS[id] ?? null;
}

/**
 * Choose reload variant:
 * - crouch → crouch reload
 * - ammo remaining > 0 → tactical (faster)
 * - else empty
 */
export function pickReloadKind(opts: {
  ammoInClip: number;
  crouching?: boolean;
}): GunReloadKind {
  if (opts.crouching) return "crouch";
  if (opts.ammoInClip > 0) return "tactical";
  return "empty";
}

export function reloadActionKey(kind: GunReloadKind): ActionKey {
  switch (kind) {
    case "crouch":
      return "reloadCrouch";
    case "tactical":
      return "reloadTactical";
    case "empty":
      return "reloadEmpty";
    default:
      return "reload";
  }
}

export function reloadDuration(spec: GunMagazineSpec, kind: GunReloadKind): number {
  switch (kind) {
    case "crouch":
      return spec.reloadCrouch;
    case "tactical":
      return spec.reloadTactical;
    case "empty":
      return spec.reloadEmpty;
    default:
      return spec.reloadStanding;
  }
}

/**
 * Empty / forced-empty reloads clear the chamber immediately so HUD + gate match.
 * Tactical keeps remaining rounds visible until the timer completes (then fills).
 */
export function clearMagOnReloadStart(kind: GunReloadKind): boolean {
  return kind === "empty" || kind === "standing" || kind === "crouch";
}

/** Fire ActionKey for primary shot (shotgun prefers hipFire). */
export function fireActionKey(weaponId: WeaponId, hip = false): ActionKey {
  if (weaponId === "shotgun") return hip ? "hipFire" : "shoot";
  if (weaponId === "pistol") return "shoot";
  return "shoot";
}

/** After shotgun hip-fire, pump rack verb. */
export function pumpActionKey(): ActionKey {
  return "pump";
}

/**
 * Default fire-rate lock (s) when clip duration is unknown.
 * Prefer max(this, animDur * playthrough) at the call site.
 */
export function defaultFireLock(weaponId: WeaponId): number {
  switch (weaponId) {
    case "shotgun":
      return 0.48;
    case "hunter-rifle":
      return 0.58;
    case "pistol":
      return 0.16;
    case "gunblade":
      return 0.2;
    default:
      return 0.2;
  }
}

/**
 * Resolve a fire lock from played anim duration.
 * `playthrough` keeps most of the shoot pose readable without soft-locking.
 */
export function fireLockFromAnim(weaponId: WeaponId, animDur: number, playthrough = 0.55): number {
  const base = defaultFireLock(weaponId);
  if (!(animDur > 0)) return base;
  return Math.max(base, Math.min(animDur * playthrough, animDur * 0.85));
}

/** Delay (ms) before shotgun pump after hip-fire. */
export function shotgunPumpDelayMs(fireAnimDur: number): number {
  if (fireAnimDur > 0) return Math.round(Math.min(220, Math.max(90, fireAnimDur * 280)));
  return 130;
}
