/**
 * Shared types for the skeletal Animator.
 *
 * The Animator drives a blocky (box-geometry) voxel character whose boxes are
 * rigidly parented to the 25-bone Mixamo skeleton (`mixamorig*`). Every motion
 * clip in the three source packs targets that same skeleton, so a single mixer
 * can pool clips from any pack and play them on one character.
 */

/** The weapon loadouts the Animator knows how to drive. */
export type WeaponClass =
  | "unarmed"
  | "sword"
  | "knife"
  | "greatsword"
  | "axe"
  | "mace"
  | "spear"
  | "hammer"
  | "greataxe"
  | "hammer2h"
  | "ranged"
  | "bow"
  | "magic"
  | "pistol";

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
  | "attack5"
  | "attack6"
  /** Straight thrust/stab (blade classes) — dash into an extended main-hand stab. */
  | "stab"
  /** Leaping/airborne overhead — two-handed downward swing used as an aerial finisher. */
  | "jumpAttack"
  | "skill"
  | "blockStart"
  | "blockIdle"
  // --- Full block/parry defense set (class-independent guarded-hit clips). ---
  /** Universal raised-guard hold pose (looped while a block is held). */
  | "blockGuard"
  /** Directional guarded-hit react — guard knocked toward the left. */
  | "blockLeft"
  /** Directional guarded-hit react — guard knocked toward the right. */
  | "blockRight"
  /** Frontal/default guarded-hit recoil (a hit soaked head-on). */
  | "blockReact"
  /** Wide guarded-hit recoil (lighter kits / ranged & magic guards). */
  | "blockReactWide"
  /** Heavy two-handed impact recoil (a big hit rung off a 2H guard). */
  | "blockReactHeavy"
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
  // --- Acrobatic UX movement blends (priority one-shots, class-independent). ---
  /** Aerial evade — air-dodge one-shot fired while airborne. */
  | "airDodge"
  /** Utility/mobility kick — quick kick with a short forward hop, no damage. */
  | "utilityKick"
  /** Forward flip (acrobatic traversal/evade). */
  | "frontFlip"
  /** Forward twisting flip (acrobatic traversal/evade). */
  | "twistFlip"
  /** Butterfly twirl spin (evasive flourish). */
  | "butterflyTwirl"
  /** Standing spin evade. */
  | "spinEvade"
  /** Corkscrew evade roll. */
  | "corkscrewEvade"
  /** Quick sidestep evade — lean/step off the attack line ("evading a threat"). */
  | "evadeThreat"
  // --- Extra footwork / acrobatics + dirty melee (user clip batch). ---
  /** Stylish acrobatic flip (evasive flourish). */
  | "stylishFlip"
  /** Backward evasive jump. */
  | "backJump"
  /** Running forward flip (acrobatic flip carried with forward momentum). */
  | "runningFlip"
  /** Long backward leap (the arcane staff's void-jaunt teleport pose). */
  | "longBackJump"
  /** Right pivot turn-in-place (footwork). */
  | "pivotR"
  /** Medium left side-step (footwork). */
  | "sideStepL"
  /** Drop / jump down off a ledge (traversal). */
  | "jumpDown"
  /** Illegal headbutt — quick dirty close-range melee. */
  | "headbutt"
  /** Spinning hurricane kick (unarmed weapon move). */
  | "hurricaneKick"
  // --- Ground finishers (executions on knocked-down enemies). ---
  /** Stomp — a leaping downward axe-kick onto a fallen enemy. */
  | "stomp"
  | "turnL"
  | "turnR"
  // --- Pistol "kiter" kit one-shots (gunslinger flagship). ---
  /** Close-range pistol-whip melee (skill 2 combo opener). */
  | "pistolWhip"
  /** Rising uppercut finisher (follows the pistol-whip). */
  | "uppercut"
  /** Charged/explosive pistol shot pose (every-5th-round flourish). */
  | "chargedShot"
  /** MMA kick — close-range proximity attack / parry. */
  | "mmaKick"
  /** Acrobatic corkscrew kip-up (evasive recovery). */
  | "kipUp"
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
  /** Focused single-cast pose (vfx-sandbox casting-spell). */
  | "castSpell2"
  /** Sustained two-handed channel (vfx-sandbox standing-2h-magic). */
  | "magicChannel"
  // --- Greatsword variant (vfx-sandbox). ---
  /** Two-handed downward overhead chop. */
  | "overheadSlash"
  // --- Horizontal slash pair (class-independent; readable matched swings). ---
  /** Inward (forehand) horizontal slash — crosses the body inward. */
  | "insideSlash"
  /** Outward (backhand) horizontal slash — sweeps away from the body. */
  | "outsideSlash"
  // --- Personality gesture idles (vfx-sandbox emotes, class-independent). ---
  | "gestureAcknowledge"
  | "gestureCocky"
  | "gestureDismiss"
  | "gestureHappy"
  | "gestureLookAway"
  | "gestureRelievedSigh"
  | "gestureHeadShake"
  | "gestureWeightShift"
  // --- Knock reactions (vfx-sandbox, class-independent). ---
  /** Hard knock straight onto the back. */
  | "flyingBack"
  /** Upward launch pop (uppercut). */
  | "uppercutLaunch"
  /** Heavy body-blow stagger (stays on feet). */
  | "bigBlow"
  /** Full knock-out collapse. */
  | "knockedOut"
  /** Deeper knocked-unconscious collapse — rag-doll landing of a clean knock-up. */
  | "knockedUnconscious"
  /** Evasive leap-away. */
  | "jumpAway"
  /** Clean upward launch — the rising pop of a knock-up. */
  | "knockedUp"
  /** Clean upward launch knocked backward (directional knock-up). */
  | "knockedUpBack"
  /** Airborne falling pose, held after the launch apex until landing. */
  | "fallingIdle"
  // --- Throw one-shot (grenades / bombs / traps). ---
  | "throw"
  // --- Retargeted Mixamo melee combos (class-independent, GLB-sourced). ---
  /** Multi-hit melee combo A (retargeted Mixamo "Attack Combo"). */
  | "meleeComboA"
  /** Multi-hit melee combo B (retargeted Mixamo "Take 001"). */
  | "meleeComboB"
  // --- Sword/dagger 3-hit click combo: the three sliced hits of melee-combo-1. ---
  /** melee-combo-1, first hit (first third of the GLB combo). */
  | "comboHit1"
  /** melee-combo-1, second hit (middle third of the GLB combo). */
  | "comboHit2"
  /** melee-combo-1, third hit (final third of the GLB combo). */
  | "comboHit3"
  // --- Defensive reaction one-shots (shared by all weapon classes). ---
  /** Full-body parry flourish (played on the PARRYING fighter). */
  | "parryReact"
  /** Short stumble / flinch (baseball-hit style). */
  | "stumble"
  /** Jogging stumble — mid-run stagger forward. */
  | "jogStumble"
  /** Transition into the fallen/knocked-down state. */
  | "fallDown"
  /** Looped fallen / knocked-down hold pose. */
  | "fallen"
  /** Stunned standing daze. */
  | "stunned"
  /** Launched into a wall and crashing. */
  | "wallCrash"
  /** Reeling hit-to-head reaction. */
  | "hitHead"
  /** Crawling while injured. */
  | "injuredCrawl"
  /** Getting up from a fallen/knocked-down state. */
  | "getUp";

/** The nine directional locomotion slots a weapon class may fill. */
export interface LocoSet {
  idle: string;
  /**
   * Optional extra idle loops the character rotates through while at rest (the
   * first entry falls back to `idle`). A standing character/NPC cycles these
   * variants instead of holding one pose. Each must be a loopable,
   * weapon-appropriate idle so the equipped grip still reads correctly.
   */
  idles?: readonly string[];
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
  /**
   * Optional head accessory. `ledMask` bakes a hooded LED-visor head (the
   * "machine god" look from the LED Mask studio) over the box head — a static
   * cowl + dark visor + emissive dot-matrix face, no per-frame animation.
   */
  hat: "none" | "cap" | "horns" | "ledMask";
  hatColor: string;
  /**
   * Which swappable LED housing shell the baked `ledMask` head wears (hood /
   * arcade / robot / crystal / …). Ignored unless `hat === "ledMask"`; defaults
   * to the original hood. The id type lives in `../LedMaskShells`.
   */
  ledShell?: import("../LedMaskShells").ShellId;
  /** When true, hang a flowing cape from the upper back (shoulders). */
  cape?: boolean;
  /** Cape colour (defaults to a deep slate when unset). */
  capeColor?: string;
  /**
   * When true, the rig dresses its box head with the player's saved Avatar
   * Edit build (pixel faces + ears/nose/tusks/hair protrusions) if one exists.
   * Ignored while `hat === "ledMask"` (the mask fully encloses the head).
   */
  avatarHead?: boolean;
}
