import type { ActionKey, WeaponClass, WeaponClipSet } from "./types.js";

/**
 * Asset id of the FBX used purely as the SKELETON SOURCE. Every pack clip ships
 * the same 25-bone Mixamo rig, so any file works; the unarmed idle is a stable
 * pick. The Animator clones this scene's bone hierarchy per character.
 */
export const SKELETON_SOURCE_ID = "animations/bow/unarmed-idle-01";

/**
 * The clip mapping per weapon class.
 *
 * Ids are `@workspace/assets` catalog ids: `animations/<class>/<clip>` where the
 * class folder is `bow` (Pro Longbow pack), `sword` (Lite Sword & Shield pack),
 * or `rifle` (Lite Rifle pack). Clip names are the normalised source filenames.
 *
 * Notes baked in from the source packs:
 * - The Longbow pack carries the only full directional walk/run set, so it backs
 *   BOTH the bow class and the default `unarmed` class (per the design: longbow
 *   locomotion/roll/jump clips double as unarmed locomotion).
 * - The Sword pack has no walk clips, so `walk*` falls back to `run*` (the
 *   Animator time-scales by speed). It has four attacks: three feed the combo
 *   chain, the big wind-up `attack` is the skill.
 * - The Rifle pack is aim + locomotion only (no dedicated fire clip), so a
 *   ranged "attack" snaps to the aim pose; the crouch idle is its skill stance.
 */
export const WEAPON_SETS: Record<WeaponClass, WeaponClipSet> = {
  // -------------------------------------------------------------- unarmed
  // Longbow locomotion + dodges/falls, plus bare-hand melee for attacks.
  unarmed: {
    loco: {
      idle: "animations/bow/unarmed-idle-01",
      walkF: "animations/bow/standing-walk-forward",
      walkB: "animations/bow/standing-walk-back",
      walkL: "animations/bow/standing-walk-left",
      walkR: "animations/bow/standing-walk-right",
      runF: "animations/bow/standing-run-forward",
      runB: "animations/bow/standing-run-back",
      runL: "animations/bow/standing-run-left",
      runR: "animations/bow/standing-run-right",
    },
    actions: {
      attack1: "animations/bow/standing-melee-punch",
      attack2: "animations/bow/standing-melee-kick",
      skill: "animations/bow/standing-melee-kick",
      hit: "animations/bow/standing-react-small-from-front",
      death: "animations/bow/standing-death-forward-01",
      jumpAir: "animations/bow/fall-a-loop",
      land: "animations/bow/fall-a-land-to-standing-idle-01",
      dodgeF: "animations/bow/standing-dodge-forward",
      dodgeB: "animations/bow/standing-dodge-backward",
      dodgeL: "animations/bow/standing-dodge-left",
      dodgeR: "animations/bow/standing-dodge-right",
      dash: "animations/bow/standing-dive-forward",
      dashAttack: "animations/bow/standing-melee-kick",
      turnL: "animations/bow/standing-turn-90-left",
      turnR: "animations/bow/standing-turn-90-right",
    },
    combo: ["attack1", "attack2"],
    strafe: false,
  },

  // -------------------------------------------------------------- sword + shield
  sword: {
    loco: {
      idle: "animations/sword/sword-and-shield-idle",
      walkF: "animations/sword/sword-and-shield-run",
      walkB: "animations/sword/sword-and-shield-run",
      walkL: "animations/sword/sword-and-shield-strafe",
      walkR: "animations/sword/sword-and-shield-strafe-2",
      runF: "animations/sword/sword-and-shield-run",
      runB: "animations/sword/sword-and-shield-run-2",
      runL: "animations/sword/sword-and-shield-strafe",
      runR: "animations/sword/sword-and-shield-strafe-2",
    },
    actions: {
      attack1: "animations/sword/sword-and-shield-attack-2",
      attack2: "animations/sword/sword-and-shield-attack-4",
      attack3: "animations/sword/sword-and-shield-attack-3",
      // Outward slash extends the combo chain (great-sword pack, same rig).
      attack4: "animations/sword/outward-slash",
      skill: "animations/sword/sword-and-shield-attack",
      blockStart: "animations/sword/sword-and-shield-block",
      blockIdle: "animations/sword/sword-and-shield-block-idle",
      draw: "animations/sword/draw-sword-1",
      sheath: "animations/sword/sheath-sword-1",
      death: "animations/sword/sword-and-shield-death",
      // Lunging dash-attack is the great-sword slide attack (covers ground).
      dashAttack: "animations/sword/great-sword-slide-attack",
      turnL: "animations/sword/sword-and-shield-turn",
      turnR: "animations/sword/sword-and-shield-turn-2",
    },
    combo: ["attack1", "attack2", "attack3", "attack4"],
    strafe: false,
  },

  // -------------------------------------------------------------- knife (dagger)
  // A light blade loadout: its own knife idle + stab/slash attacks. The knife
  // pack ships no walk/run set, so locomotion reuses the unarmed (longbow) clips
  // exactly like the sword class reuses its run for walking.
  knife: {
    loco: {
      idle: "animations/knife/knife-idle",
      walkF: "animations/bow/standing-walk-forward",
      walkB: "animations/bow/standing-walk-back",
      walkL: "animations/bow/standing-walk-left",
      walkR: "animations/bow/standing-walk-right",
      runF: "animations/bow/standing-run-forward",
      runB: "animations/bow/standing-run-back",
      runL: "animations/bow/standing-run-left",
      runR: "animations/bow/standing-run-right",
    },
    actions: {
      attack1: "animations/knife/stabbing",
      attack2: "animations/sword/outward-slash",
      skill: "animations/sword/outward-slash",
      dashAttack: "animations/knife/stabbing",
      death: "animations/bow/standing-death-forward-01",
      hit: "animations/bow/standing-react-small-from-front",
    },
    combo: ["attack1", "attack2"],
    strafe: false,
  },

  // -------------------------------------------------------------- ranged (rifle)
  ranged: {
    loco: {
      idle: "animations/rifle/idle",
      walkF: "animations/rifle/run-forward",
      walkB: "animations/rifle/run-backward",
      walkL: "animations/rifle/run-left",
      walkR: "animations/rifle/run-right",
      runF: "animations/rifle/run-forward",
      runB: "animations/rifle/run-backward",
      runL: "animations/rifle/run-left",
      runR: "animations/rifle/run-right",
    },
    actions: {
      aim: "animations/rifle/idle-aiming",
      attack1: "animations/rifle/idle-aiming",
      skill: "animations/rifle/idle-crouching",
      crouchIdle: "animations/rifle/idle-crouching",
      death: "animations/rifle/death-from-front-headshot",
      turnL: "animations/rifle/turn-90-left",
      turnR: "animations/rifle/turn-90-right",
    },
    combo: ["attack1"],
    strafe: true,
  },

  // -------------------------------------------------------------- bow (longbow)
  bow: {
    loco: {
      idle: "animations/bow/standing-idle-01",
      walkF: "animations/bow/standing-aim-walk-forward",
      walkB: "animations/bow/standing-aim-walk-back",
      walkL: "animations/bow/standing-aim-walk-left",
      walkR: "animations/bow/standing-aim-walk-right",
      runF: "animations/bow/standing-run-forward",
      runB: "animations/bow/standing-run-back",
      runL: "animations/bow/standing-run-left",
      runR: "animations/bow/standing-run-right",
    },
    actions: {
      equip: "animations/bow/standing-equip-bow",
      disarm: "animations/bow/standing-disarm-bow",
      aim: "animations/bow/standing-aim-overdraw",
      drawArrow: "animations/bow/standing-draw-arrow",
      release: "animations/bow/standing-aim-recoil",
      attack1: "animations/bow/standing-draw-arrow",
      skill: "animations/bow/standing-melee-kick",
      blockStart: "animations/bow/standing-block",
      blockIdle: "animations/bow/standing-block",
      hit: "animations/bow/standing-react-small-from-front",
      death: "animations/bow/standing-death-forward-01",
      jumpAir: "animations/bow/fall-a-loop",
      land: "animations/bow/fall-a-land-to-standing-idle-01",
      dodgeF: "animations/bow/standing-dodge-forward",
      dodgeB: "animations/bow/standing-dodge-backward",
      dodgeL: "animations/bow/standing-dodge-left",
      dodgeR: "animations/bow/standing-dodge-right",
      dash: "animations/bow/standing-dive-forward",
      turnL: "animations/bow/standing-turn-90-left",
      turnR: "animations/bow/standing-turn-90-right",
    },
    combo: ["attack1"],
    strafe: true,
  },

  // -------------------------------------------------------------- magic (caster)
  // Locomotion from the Magic Locomotion pack (full directional walk/run/turn/
  // jump set); actions from the Magic Spell pack. Casting reads as the "attack".
  magic: {
    loco: {
      idle: "animations/magic-loco/standing-idle",
      walkF: "animations/magic-loco/standing-walk-forward",
      walkB: "animations/magic-loco/standing-walk-back",
      walkL: "animations/magic-loco/standing-walk-left",
      walkR: "animations/magic-loco/standing-walk-right",
      runF: "animations/magic-loco/standing-run-forward",
      runB: "animations/magic-loco/standing-run-back",
      runL: "animations/magic-loco/standing-run-left",
      runR: "animations/magic-loco/standing-run-right",
    },
    actions: {
      attack1: "animations/magic/standing-1h-magic-attack-01",
      attack2: "animations/magic/standing-1h-magic-attack-02",
      attack3: "animations/magic/standing-1h-magic-attack-03",
      skill: "animations/magic/standing-2h-magic-area-attack-01",
      castSpell: "animations/magic/standing-1h-cast-spell-01",
      magicAttack: "animations/magic/standing-1h-magic-attack-01",
      magicArea: "animations/magic/standing-2h-magic-area-attack-01",
      jumpAir: "animations/magic-loco/standing-jump-running",
      land: "animations/magic-loco/standing-land-to-standing-idle",
      turnL: "animations/magic-loco/standing-turn-left-90",
      turnR: "animations/magic-loco/standing-turn-right-90",
    },
    combo: ["attack1", "attack2", "attack3"],
    strafe: false,
  },
};

/**
 * Traversal locomotion for the non-ground MODEs. Unlike the 9-slot weapon
 * `LocoSet`, traversal is a small directional set: an in-place `idle` (hang /
 * tread), a primary `forward` stroke/climb, and an optional `back` (climb-down).
 * The Animator picks among them by the move intent while the mode is active.
 */
export interface TraversalSet {
  /** Held in place (wall hang / treading water). */
  idle: string;
  /** Moving "forward": climbing up the wall / swimming stroke. */
  forward: string;
  /** Moving "back": climbing down the wall (swim reuses the forward stroke). */
  back: string;
}

export const TRAVERSAL_SETS: Record<"climb" | "swim", TraversalSet> = {
  climb: {
    idle: "animations/climb/climbing",
    forward: "animations/climb/climbing-up-wall",
    back: "animations/climb/climbing-down-wall",
  },
  swim: {
    idle: "animations/swim/treading-water",
    forward: "animations/swim/swimming",
    back: "animations/swim/swimming",
  },
};

/**
 * Class-INDEPENDENT one-shot clips (traversal transitions, farming, magic). These
 * are not tied to a weapon loadout — any character can mantle a ledge, harvest a
 * crop or cast a spell — so they resolve here instead of per `WEAPON_SETS`.
 */
export const GLOBAL_ACTIONS: Partial<Record<ActionKey, string>> = {
  // Traversal transitions (mode exits): root-motion drives the body in lockstep.
  mantle: "animations/climb/climbing-to-top",
  swimExit: "animations/swim/swimming-to-edge",
  // Farming verbs.
  harvest: "animations/farming/dig-and-plant-seeds",
  water: "animations/farming/watering",
  pick: "animations/farming/pick-fruit",
  plantTree: "animations/farming/plant-tree",
  pullPlant: "animations/farming/pull-plant",
  // Magic verbs (also surfaced on the magic class above; available everywhere).
  castSpell: "animations/magic/standing-1h-cast-spell-01",
  magicAttack: "animations/magic/standing-1h-magic-attack-01",
  magicArea: "animations/magic/standing-2h-magic-area-attack-01",
  // Movement / combat verbs available to any loadout.
  slide: "animations/extra/running-slide",
  throw: "animations/extra/grenade-throw",
};

/** Resolve a class-independent one-shot to its clip id, if shipped. */
export function resolveGlobalAction(key: ActionKey): string | undefined {
  return GLOBAL_ACTIONS[key];
}

/** Every distinct clip id referenced by weapon classes, traversal, and globals. */
export function allReferencedClipIds(): string[] {
  const ids = new Set<string>([SKELETON_SOURCE_ID]);
  for (const set of Object.values(WEAPON_SETS)) {
    for (const id of Object.values(set.loco)) if (id) ids.add(id);
    for (const id of Object.values(set.actions)) if (id) ids.add(id);
  }
  for (const set of Object.values(TRAVERSAL_SETS)) {
    for (const id of Object.values(set)) if (id) ids.add(id);
  }
  for (const id of Object.values(GLOBAL_ACTIONS)) if (id) ids.add(id);
  return [...ids];
}

/** The clip ids needed for a single weapon class (plus the skeleton source). */
export function clipIdsForClass(weapon: WeaponClass): string[] {
  const set = WEAPON_SETS[weapon];
  const ids = new Set<string>([SKELETON_SOURCE_ID]);
  for (const id of Object.values(set.loco)) if (id) ids.add(id);
  for (const id of Object.values(set.actions)) if (id) ids.add(id);
  return [...ids];
}
