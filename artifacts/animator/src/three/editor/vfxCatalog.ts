import type { VfxPreset } from "./types";

/**
 * The VFX library shown in the editor. Pure data — the engine (`EditorScene`)
 * owns the dispatch switch that maps each id onto a `Vfx` method call at the
 * selected object's position. Keep ids in sync with the switch in
 * `EditorScene.playVfx`.
 */
export const VFX_PRESETS: VfxPreset[] = [
  { id: "impact", label: "Impact Flash", group: "impact" },
  { id: "burst", label: "Spark Burst", group: "impact" },
  { id: "shockwave", label: "Shockwave Ring", group: "impact" },
  { id: "aoeBlast", label: "AoE Blast", group: "impact" },

  { id: "nova", label: "Arcane Nova", group: "energy" },
  { id: "lightning", label: "Lightning", group: "energy" },
  { id: "muzzle", label: "Muzzle Flash", group: "energy" },

  { id: "impactExplode", label: "Fire Explosion", group: "fire" },
  { id: "flame", label: "Flame Plume", group: "fire" },
  { id: "legFlame", label: "Ember Jet", group: "fire" },
  { id: "coneFlame", label: "Flame Cone", group: "fire" },

  { id: "fireDragon", label: "Fire Dragon", group: "energy" },
  { id: "meteor", label: "Meteor Strike", group: "fire" },
  { id: "turret", label: "Deploy Turret", group: "energy" },
  { id: "darkBlades", label: "Dark Blades", group: "energy" },
  { id: "swordVolley", label: "Sword Volley", group: "energy" },

  { id: "stunMark", label: "Stun Mark", group: "status" },
  { id: "shieldBreak", label: "Shield Break", group: "status" },

  { id: "puff", label: "Dust Puff", group: "smoke" },
  { id: "smokePop", label: "Impact Smoke", group: "smoke" },
  { id: "castSwirl", label: "Casting Swirl", group: "smoke" },
  { id: "bulletTrail", label: "Bullet Trail", group: "smoke" },
  { id: "smokeColumn", label: "Smoke Column", group: "smoke" },
  { id: "fireBurst", label: "Fire Shot", group: "smoke" },
];
