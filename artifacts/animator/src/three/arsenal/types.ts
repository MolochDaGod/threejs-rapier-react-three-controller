/**
 * Shared helpers for the weapon-prefab arsenal.
 *
 * Each weapon prefab is a single self-contained {@link WeaponDef} module that
 * bundles its real GLB model, hand-mount grip, animation set (→ clip combo +
 * signature skill via `WEAPON_SETS`), and VFX kind. The arsenal composes these
 * prefabs into the single `WEAPONS` table the rest of the app equips from.
 */
export type {
  WeaponDef,
  WeaponGroup,
  WeaponGripDef,
  WeaponGripTransform,
  WeaponTier,
} from "../types";

/** A quarter turn — the canonical "grip at base, blade up +Y" hold rotation. */
export const PI2 = Math.PI / 2;
