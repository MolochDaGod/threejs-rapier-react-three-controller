import { asset } from "./assets";
import type { SkillKind, WeaponId } from "./types";

/**
 * Registry for the framed RPG icon set sliced from the two source spritesheets
 * into public/icons/<name>.png. Names mirror the original sheet labels.
 */
export const UI_ICONS = [
  "animator", "skill-vfx-lab", "parkour", "physics", "foot-planting",
  "anim-test", "gear-trial", "camera", "ai-worker", "movement-pad",
  "action-bar", "hud-settings", "building-kit", "weapon-mesh", "animation-editor",
  "vfx-editor", "draggable-dock", "resizable-panel", "skill-slot", "combat-pad",
  "loadout-card", "world-editor", "clip-library", "asset-manager", "scriptable-skills",
] as const;

export const ACTION_ICONS = [
  "attack", "move", "stop", "patrol", "hold",
  "build", "inventory", "defend", "retreat", "charge",
  "guard", "explore", "harvest", "trade", "repair",
  "scout", "ambush", "siege", "rally", "disband",
  "loot", "equip", "unequip", "rest", "pray",
] as const;

export type IconName = (typeof UI_ICONS)[number] | (typeof ACTION_ICONS)[number];

/** Resolve a sliced icon to its public URL under the artifact base path. */
export function iconUrl(name: IconName | string): string {
  return asset(`icons/${name}.png`);
}

/** Each weapon gets a thematically matched action icon. */
export const WEAPON_ICON: Record<WeaponId, IconName> = {
  none: "attack",
  sword: "equip",
  gunblade: "siege",
  greatsword: "siege",
  axe: "charge",
  dagger: "ambush",
  spear: "patrol",
  hammer: "build",
  mace: "charge",
  mace2h: "charge",
  greataxe: "siege",
  hammer2h: "build",
  bow: "scout",
  staff: "skill-vfx-lab",
  staffFire: "charge",
  staffIce: "hold",
  staffStorm: "rally",
  staffNature: "harvest",
  staffHoly: "pray",
  staffArcane: "skill-vfx-lab",
  pistol: "stop",
  rifle: "defend",
  "hunter-rifle": "scout",
  javelin: "patrol",
  shield: "guard",
};

/** Skill VFX kinds map to an action icon for the HUD signature row. */
export const SKILL_KIND_ICON: Record<SkillKind, IconName> = {
  slash: "attack",
  slam: "charge",
  bolt: "scout",
  nova: "skill-vfx-lab",
  muzzle: "stop",
  thrust: "ambush",
  fireDragon: "siege",
  meteor: "charge",
  turret: "defend",
  darkBlades: "ambush",
  swordVolley: "rally",
  soul: "pray",
  laser: "scout",
};
