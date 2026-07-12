/**
 * Weapon Skill System — canonical types.
 *
 * Five slots per weapon, with clearly defined semantic roles:
 *
 *   Slot 1  normal_attack  — the base attack for every weapon in the family.
 *                            One per weapon type (e.g. all swords share "sword.slash").
 *   Slot 2  type_skill     — standard option shared across the weapon type.
 *   Slot 3  type_skill     — second standard option (same type pool, different utility).
 *   Slot 4  variant_skill  — mostly unique per weapon variant; may share across
 *                            rarity tiers of the same named weapon.
 *   Slot 5  signature      — ALWAYS unique to the weapon's name / tier.
 *                            "Bloodfeud Blade" → "bloodfeud-blade.soul-rend"
 *                            "Dragonhorn Bow"  → "dragonhorn-bow.dragon-volley"
 *
 * The registry lives in registry.ts; lookup helpers live in index.ts.
 */

import type { SkillKind, WeaponId } from "../types";
import type { SfxCategory } from "../audio/CombatSfx";

// ── Slot & category ──────────────────────────────────────────────────────────

export type SkillSlot = 1 | 2 | 3 | 4 | 5;

export type SkillCategory =
  | "normal_attack"   // slot 1
  | "type_skill"      // slots 2–3
  | "variant_skill"   // slot 4
  | "signature";      // slot 5

// ── Sub-objects ──────────────────────────────────────────────────────────────

/**
 * A frame window during which the skill's hitbox is active.
 * Multiple windows model multi-hit combos (e.g. a 3-hit chain).
 */
export interface HitWindow {
  /** Seconds from animation start when the window opens. */
  start: number;
  /** Seconds from animation start when the window closes. */
  end: number;
  /** World-space reach in metres from the character origin. */
  reach: number;
  /** Base damage on a 0–100 design scale (actual damage = base × weapon power). */
  damage: number;
  /** AoE radius in metres; 0 means single-target (point hit). */
  aoe?: number;
  /** Optional knockback force applied to the target on hit (metres/s impulse). */
  knockback?: number;
}

/** VFX descriptor — wires the skill into the existing Vfx system. */
export interface SkillVfx {
  /** The Vfx method to invoke: "slash", "slam", "bolt", "nova", "thrust", etc. */
  kind: SkillKind;
  /**
   * Optional CDN asset key for a model-driven trail override
   * (e.g. a custom slash arc GLB). Resolved via `assetUrl()`.
   */
  trail?: string;
  /**
   * Optional CDN asset key for a model-driven impact override.
   * Falls back to the standard Vfx impact for the `kind`.
   */
  impact?: string;
  /**
   * Optional CDN asset key for a travel/projectile effect GLB.
   * Only relevant for skills with a travel phase (bolt, muzzle, soul, etc.).
   */
  travel?: string;
}

/** SFX descriptor — maps into the existing CombatSfx category pools. */
export interface SkillSfx {
  /** Whoosh / swing sound played at animation start. null = silent. */
  swing: SfxCategory | null;
  /** Impact sound played on each hit window registration. null = silent. */
  hit: SfxCategory | null;
  /** Cast sound played before the hit (warm-up / charge). */
  cast?: SfxCategory;
}

// ── Core prefab ──────────────────────────────────────────────────────────────

export interface SkillPrefab {
  /**
   * Unique skill identifier.
   * Slots 1–4: `"<weaponFamily>.<skillName>"` e.g. `"sword.slash"`.
   * Slot 5:    `"<tierKey>.<skillName>"` e.g. `"bloodfeud-blade.soul-rend"`.
   */
  id: string;

  /** Human-readable skill name shown in the HUD. */
  label: string;

  /** Weapon family this skill belongs to. */
  weaponFamily: WeaponId;

  /**
   * Named weapon / tier this skill is bound to.
   * Set only for slot-5 signatures — undefined for slots 1–4.
   */
  weaponName?: string;

  slot: SkillSlot;
  category: SkillCategory;

  /**
   * Abstract animation key resolved by the engine's clip layer.
   * Format: `"<animSet>/<clipAlias>"` e.g. `"sword/outward-slash"`.
   * The engine maps this to the real FBX file for the active rig.
   */
  animKey: string;

  /** Ordered hit windows (a multi-window array = multi-hit combo). */
  hitWindows: readonly HitWindow[];

  vfx: SkillVfx;
  sfx: SkillSfx;

  /** Stamina cost to activate the skill. */
  cost: { stamina: number };

  /** Cooldown in seconds from activation until the skill can be used again. */
  cooldown: number;

  /**
   * Icon served from the asset CDN.
   * Path pattern: `assetUrl("icons/skills/<id>.png")`.
   * Resolved at runtime so a single env-var flip (`VITE_ASSET_BASE_URL`)
   * switches between local dev and the production Cloudflare R2 bucket.
   */
  icon: { cdnUrl: string };
}

// ── Registry shape ───────────────────────────────────────────────────────────

/**
 * One weapon family's complete 5-slot skill set.
 *
 * `base[0..3]` = slots 1–4 (shared across every tier of the weapon).
 * `signatures`  = keyed by the tier's display name (exact match to WeaponDef.tiers[n].name).
 *                 Each entry is the slot-5 skill unique to that named weapon.
 */
export interface WeaponSkillSet {
  base: readonly [SkillPrefab, SkillPrefab, SkillPrefab, SkillPrefab];
  signatures: Readonly<Record<string, SkillPrefab>>;
}
