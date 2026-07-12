/**
 * Shared types for the skeletal Animator.
 *
 * The Animator drives a blocky (box-geometry) voxel character whose boxes are
 * rigidly parented to the 25-bone Mixamo skeleton (`mixamorig*`). Every motion
 * clip in the three source packs targets that same skeleton, so a single mixer
 * can pool clips from any pack and play them on one character.
 */

/** The weapon loadouts the Animator knows how to drive. */
export type WeaponClass = "unarmed" | "sword" | "knife" | "ranged" | "bow" | "magic";

/**
 * Traversal MODE: how the body is moving through the world. It composes WITH the
 * weapon class — `ground` uses the equipped class's locomotion, while `climb` and
 * `swim` swap in their own traversal locomotion (see `TRAVERSAL_SETS`). One-shots
 * (mantle, swim-to-edge, farming, magic) stay available in any mode.
 */
export type TraversalMode = "ground" | "climb" | "swim";

/**
 * Per-frame locomotion intent supplied by the game engine.
 *
 * `x`/`z` are the movement direction in the character's LOCAL frame
 * (`+z` forward, `+x` right), each in `-1..1`. `speed` is a `0..1` intensity
 * used to pick idle vs. walk vs. run and to time-scale the clip. `running`
 * forces the run tier when the engine knows the player is sprinting.
 */
export interface MoveInput {
  x: number;
  z: number;
  speed: number;
  running: boolean;
}

/** Logical one-shot / sustained actions, resolved to a clip per weapon class. */
export type ActionKey =
  | "attack1"
  | "attack2"
  | "attack3"
  | "attack4"
  | "skill"
  | "blockStart"
  | "blockIdle"
  | "draw"
  | "sheath"
  | "equip"
  | "disarm"
  | "aim"
  | "drawArrow"
  | "release"
  | "hit"
  | "death"
  | "jumpAir"
  | "land"
  | "crouchIdle"
  | "dodgeF"
  | "dodgeB"
  | "dodgeL"
  | "dodgeR"
  | "dash"
  | "dashAttack"
  | "slide"
  | "turnL"
  | "turnR"
  // --- Traversal one-shots (mode transitions). ---
  | "mantle"
  | "swimExit"
  // --- Farming one-shots. ---
  | "harvest"
  | "water"
  | "pick"
  | "plantTree"
  | "pullPlant"
  // --- Magic one-shots. ---
  | "castSpell"
  | "magicAttack"
  | "magicArea"
  // --- Throw one-shot (grenades / bombs / traps). ---
  | "throw";

/** The nine directional locomotion slots a weapon class may fill. */
export interface LocoSet {
  idle: string;
  walkF: string;
  walkB: string;
  walkL: string;
  walkR: string;
  runF: string;
  runB: string;
  runL: string;
  runR: string;
}

/**
 * The full clip mapping for one weapon class. `loco` is partial because not
 * every pack ships every directional clip (the Animator falls back along
 * run -> walk -> idle). `combo` is the ordered melee chain; `dashAttack`/`skill`
 * point into `actions`.
 */
export interface WeaponClipSet {
  /** Directional locomotion clips (asset ids). */
  loco: Partial<LocoSet>;
  /** One-shot / sustained action clips (asset ids), keyed by ActionKey. */
  actions: Partial<Record<ActionKey, string>>;
  /** Ordered melee combo (ActionKeys into `actions`). */
  combo: ActionKey[];
  /** Whether this class strafes (body faces aim, directional clips) by default. */
  strafe: boolean;
}

/** Recolourable look for the box avatar. All values are CSS/hex colours. */
export interface CharacterLook {
  skin: string;
  shirt: string;
  pants: string;
  /** Optional head accessory. */
  hat: "none" | "cap" | "horns";
  hatColor: string;
}
