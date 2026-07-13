import type { ActionKey, WeaponClass, WeaponClipSet } from "./types";

/**
 * Asset id of the FBX used purely as the SKELETON SOURCE. Every pack clip ships
 * the same 25-bone Mixamo rig, so any file works; the unarmed idle is a stable
 * pick. The Animator clones this scene's bone hierarchy per character.
 */
export const SKELETON_SOURCE_ID = "animations/bow/unarmed-idle-01";

// ─────────────────────────────────────────────────────────────────────────────
// Universal locomotion fallback
//
// The Longbow pack ships the only full 8-directional walk/run/dodge/roll/jump
// set. Any weapon class that lacks directional loco or movement one-shots borrows
// from here instead of dropping the animation. Import UNIVERSAL_LOCO when you
// need the ids directly (e.g. to pre-load them for a host that only loads one
// class but needs rolling to work).
// ─────────────────────────────────────────────────────────────────────────────
export const UNIVERSAL_LOCO = {
  idle:  "animations/bow/unarmed-idle-01",
  walkF: "animations/bow/standing-walk-forward",
  walkB: "animations/bow/standing-walk-back",
  walkL: "animations/bow/standing-walk-left",
  walkR: "animations/bow/standing-walk-right",
  runF:  "animations/bow/standing-run-forward",
  runB:  "animations/bow/standing-run-back",
  runL:  "animations/bow/standing-run-left",
  runR:  "animations/bow/standing-run-right",
} as const;

export const UNIVERSAL_MOVEMENT = {
  dodgeF:    "animations/bow/standing-dodge-forward",
  dodgeB:    "animations/bow/standing-dodge-backward",
  dodgeL:    "animations/bow/standing-dodge-left",
  dodgeR:    "animations/bow/standing-dodge-right",
  dash:      "animations/bow/standing-dive-forward",
  jumpAir:   "animations/bow/fall-a-loop",
  land:      "animations/bow/fall-a-land-to-standing-idle-01",
  // Acrobatic UX movement blends (priority one-shots, any loadout).
  airDodge:       "animations/extra/aerial-evade",
  utilityKick:    "animations/extra/utility-kick",
  frontFlip:      "animations/extra/front-flip",
  twistFlip:      "animations/extra/front-twist-flip",
  butterflyTwirl: "animations/extra/butterfly-twirl",
  spinEvade:      "animations/extra/spinning",
  corkscrewEvade: "animations/extra/corkscrew-evade",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Shared melee locomotion pools
//
// The expanded melee roster (axe, mace, hammer, spear, greataxe, 2h-hammer) has
// no bespoke walk/run packs, so the one-handed classes borrow the Sword pack's
// stance and the two-handed classes borrow the Greatsword pack's stance. Each
// weapon still owns a DISTINCT attack/combo set below — only the footwork is
// shared. Import these when pre-loading a single melee class for a host.
// ─────────────────────────────────────────────────────────────────────────────
export const ONE_HAND_MELEE_LOCO = {
  idle:  "animations/sword/sword-and-shield-idle",
  walkF: "animations/sword/sword-and-shield-run",
  walkB: "animations/sword/sword-and-shield-run-2",
  walkL: "animations/sword/sword-and-shield-strafe",
  walkR: "animations/sword/sword-and-shield-strafe-2",
  runF:  "animations/sword/sword-and-shield-run",
  runB:  "animations/sword/sword-and-shield-run-2",
  runL:  "animations/sword/sword-and-shield-strafe",
  runR:  "animations/sword/sword-and-shield-strafe-2",
} as const;

export const TWO_HAND_MELEE_LOCO = {
  idle:  "animations/greatsword/great-sword-idle",
  walkF: "animations/greatsword/great-sword-walk",
  walkB: "animations/greatsword/great-sword-walk-2",
  walkL: "animations/greatsword/great-sword-strafe",
  walkR: "animations/greatsword/great-sword-strafe-2",
  runF:  "animations/greatsword/great-sword-run",
  runB:  "animations/greatsword/great-sword-run-2",
  runL:  "animations/greatsword/great-sword-strafe-3",
  runR:  "animations/greatsword/great-sword-strafe-4",
} as const;

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
      idle: UNIVERSAL_LOCO.idle,
      // Two neutral bare-hand idle loops the rig rotates through at rest for a
      // more alive, less static stand (both ride the shared unarmed/longbow rig).
      idles: ["animations/bow/unarmed-idle-01", "animations/bow/standing-idle-01"],
      walkF: UNIVERSAL_LOCO.walkF,
      walkB: UNIVERSAL_LOCO.walkB,
      walkL: UNIVERSAL_LOCO.walkL,
      walkR: UNIVERSAL_LOCO.walkR,
      runF: UNIVERSAL_LOCO.runF,
      runB: UNIVERSAL_LOCO.runB,
      runL: UNIVERSAL_LOCO.runL,
      runR: UNIVERSAL_LOCO.runR,
    },
    actions: {
      attack1: "animations/bow/standing-melee-punch",
      // USER-DIRECTED (new batch): bare-hand attack2 is now a fast quick-kick (was
      // a dup of the melee kick) — also the new finisher of the LMB hand combo.
      attack2: "animations/striker/quick-kick",
      // USER-DIRECTED bare-hand combo: one flowing punch->elbow strike chain
      // delivered as a single assisted-blend clip. Wired via comboHit1 (not
      // attack1) so the universal single jab stays intact for enemies/fallbacks,
      // while the LMB combo plays this whole chain per commit and rides its REAL
      // duration (same single-entry pattern as the Battle Axe / greatsword).
      comboHit1: "animations/striker/punch-to-elbow-combo",
      // Second bare-hand combo beat: a knee-jab flurry into a rising uppercut
      // (its own committed clip). Chains after the punch->elbow combo so the LMB
      // chain is a real two-part hand-to-hand combo (rides each clip's duration).
      comboHit2: "animations/striker/knee-jabs-to-uppercut",
      // Signature unarmed special: an acrobatic flip-kick (was a dup of the kick).
      skill: "animations/striker/flip-kick",
      hit: "animations/bow/standing-react-small-from-front",
      death: "animations/bow/standing-death-forward-01",
      jumpAir: UNIVERSAL_MOVEMENT.jumpAir,
      land: UNIVERSAL_MOVEMENT.land,
      dodgeF: UNIVERSAL_MOVEMENT.dodgeF,
      dodgeB: UNIVERSAL_MOVEMENT.dodgeB,
      dodgeL: UNIVERSAL_MOVEMENT.dodgeL,
      dodgeR: UNIVERSAL_MOVEMENT.dodgeR,
      dash: UNIVERSAL_MOVEMENT.dash,
      // New-batch quick-kick doubles as the lunging dash-attack (was the kick).
      dashAttack: "animations/striker/quick-kick",
      // Acrobatic UX movement blends — resolveMovement() falls every class back
      // to the unarmed set, so registering them here makes them universal.
      airDodge: UNIVERSAL_MOVEMENT.airDodge,
      utilityKick: UNIVERSAL_MOVEMENT.utilityKick,
      frontFlip: UNIVERSAL_MOVEMENT.frontFlip,
      twistFlip: UNIVERSAL_MOVEMENT.twistFlip,
      butterflyTwirl: UNIVERSAL_MOVEMENT.butterflyTwirl,
      spinEvade: UNIVERSAL_MOVEMENT.spinEvade,
      corkscrewEvade: UNIVERSAL_MOVEMENT.corkscrewEvade,
      // Spinning hurricane kick is an unarmed weapon move (combo finisher).
      hurricaneKick: "animations/extra/hurricane-kick",
      turnL: "animations/bow/standing-turn-90-left",
      turnR: "animations/bow/standing-turn-90-right",
    },
    // USER-DIRECTED: the LMB chain is a two-part bare-hand combo — the flowing
    // punch->elbow clip (comboHit1) into a knee-jab->uppercut flurry (comboHit2),
    // one committed clip per click, each riding its real duration. The punch /
    // kick / hurricane attacks above stay defined for action overrides.
    combo: ["comboHit1", "comboHit2", "attack2"],
    strafe: false,
  },

  // -------------------------------------------------------------- sword + shield
  sword: {
    loco: {
      idle: "animations/sword/sword-and-shield-idle",
      walkF: "animations/sword/sword-and-shield-run",
      // Dedicated guarded backpedal (RMB-back sword&shield run) so retreating with
      // a shield reads as a real backward run, not a forward run played in reverse.
      walkB: "animations/sword/sword-and-shield-run-back",
      walkL: "animations/sword/sword-and-shield-strafe",
      walkR: "animations/sword/sword-and-shield-strafe-2",
      runF: "animations/sword/sword-and-shield-run",
      runB: "animations/sword/sword-and-shield-run-back",
      runL: "animations/sword/sword-and-shield-strafe",
      runR: "animations/sword/sword-and-shield-strafe-2",
    },
    actions: {
      attack1: "animations/sword/sword-and-shield-attack-2",
      // USER-DIRECTED: the old attack2 (sword-and-shield-attack-4) read poorly as a
      // swing — replaced with a full single committed slash on the same rig.
      attack2: "animations/sword/sword-and-shield-attack",
      attack3: "animations/sword/sword-and-shield-attack-3",
      // Committed inward slash — the new sword combo FINISHER (last entry of
      // `combo`): a full single cross-body cut that caps the 3-hit chain.
      attack4: "animations/sword/inward-slash",
      // Extra combo finishers from the new sword batch (same rig).
      attack5: "animations/sword/sword-and-shield-attack-5",
      attack6: "animations/sword/two-hand-sword-combo",
      // USER-DIRECTED: the LMB combo is now the 3-hit melee-combo-1 (one hit per
      // click). These keys point at the three sliced thirds of that GLB combo
      // (see loader GLB_SUBCLIPS). The attack1..6 sword swings above stay defined
      // (still usable via action-slot overrides) but no longer drive the chain.
      comboHit1: "animations/combo/melee-combo-1-hit1",
      comboHit2: "animations/combo/melee-combo-1-hit2",
      comboHit3: "animations/combo/melee-combo-1-hit3",
      // The class special is now a sword-and-shield spell-casting flourish.
      skill: "animations/sword/sword-and-shield-casting",
      blockStart: "animations/sword/sword-and-shield-block",
      blockIdle: "animations/sword/sword-and-shield-block-idle",
      draw: "animations/sword/draw-sword-1",
      sheath: "animations/sword/sheath-sword-1",
      death: "animations/sword/sword-and-shield-death",
      // Lunging dash-attack is the advancing slash (a committed forward lunge that
      // covers ground while slashing).
      dashAttack: "animations/sword/slash-advance",
      // Straight thrust: the knife stab clip drives the shared rig into a clean
      // forward main-hand lunge-stab (reads as a sword thrust on this loadout).
      stab: "animations/knife/stabbing",
      turnL: "animations/sword/sword-and-shield-turn",
      turnR: "animations/sword/sword-and-shield-turn-2",
    },
    // USER-DIRECTED: the 3-hit melee-combo-1 (one sliced hit per click) now caps
    // with a committed inward-slash finisher (attack4) for a 4-hit chain.
    combo: ["comboHit1", "comboHit2", "comboHit3", "attack4"],
    strafe: false,
  },

  // -------------------------------------------------------------- greatsword
  // Heavy two-handed blade with its OWN dedicated pack (idle/walk/run/strafe/turn,
  // five slashes, a high-spin AOE special, block, draw, death, impact). Movement
  // one-shots (dodge/jump/dash/acrobatics) fall back to the unarmed set via
  // resolveMovement, so only locomotion + attack/defense clips live here.
  greatsword: {
    loco: {
      idle: "animations/greatsword/great-sword-idle",
      walkF: "animations/greatsword/great-sword-walk",
      walkB: "animations/greatsword/great-sword-walk-2",
      walkL: "animations/greatsword/great-sword-strafe",
      walkR: "animations/greatsword/great-sword-strafe-2",
      runF: "animations/greatsword/great-sword-run",
      runB: "animations/greatsword/great-sword-run-2",
      runL: "animations/greatsword/great-sword-strafe-3",
      runR: "animations/greatsword/great-sword-strafe-4",
    },
    actions: {
      // USER-DIRECTED combo: one flowing multi-swing greatsword chain delivered as
      // a SINGLE retargeted clip. Like the Battle Axe (melee-combo-2), the combo
      // array holds this single entry and the combo lock/recovery ride the clip's
      // REAL duration, so the whole chain plays through per commit (see
      // Animator.attack + Studio.doComboHit). The individual slashes below stay
      // defined for action-slot overrides and the Dressing Room clip preview.
      attack1: "animations/greatsword/great-sword-combo",
      // Heavy follow-up swing — a big committed two-hander cleave that caps the
      // combo chain after the flowing great-sword-combo opener (new batch clip).
      attack2: "animations/greatsword/heavy-weapon-swing",
      attack3: "animations/greatsword/great-sword-slash-3",
      attack4: "animations/greatsword/great-sword-slash-4",
      attack5: "animations/greatsword/great-sword-slash-5",
      // The class special is a sweeping high-spin AOE swing.
      skill: "animations/greatsword/great-sword-high-spin-attack",
      // Lunging dash-attack covers ground (slide attack from the sword pack).
      // USER-DIRECTED: this lunging slide ALSO opens the combo chain (see `combo`).
      dashAttack: "animations/sword/great-sword-slide-attack",
      // Quick committed slash — a fast single cut (KeyZ), snappier than the
      // heavy combo slashes (was the slow leaping-overhead jump-attack).
      stab: "animations/greatsword/quick-slash",
      blockStart: "animations/greatsword/great-sword-blocking-2",
      blockIdle: "animations/greatsword/great-sword-blocking-2",
      draw: "animations/greatsword/draw-great-sword-1",
      // draw-great-sword-2.fbx fails FBXLoader parse ("Unknown property type") so it
      // never loaded; reuse the working draw clip for the sheath verb.
      sheath: "animations/greatsword/draw-great-sword-1",
      death: "animations/greatsword/two-handed-sword-death",
      hit: "animations/greatsword/great-sword-impact",
      // New-batch movement (data-only): a launching jump (jumpAir), an evasive
      // leap-away backstep (dodgeB), and a crouch-to-sprint burst (dash) — override
      // the unarmed fallbacks so the heavy blade gets its own weighty movement.
      jumpAir: "animations/extra/jump-up",
      dodgeB: "animations/extra/jump-away",
      dash: "animations/extra/crouch-to-sprint",
      turnL: "animations/greatsword/great-sword-turn",
      turnR: "animations/greatsword/great-sword-turn-2",
    },
    // USER-DIRECTED: the LMB combo opens with the flowing two-hand-sword combo
    // clip (attack1) and caps with a heavy committed cleave (attack2), each
    // played in full per commit and riding its real duration.
    combo: ["attack1", "attack2"],
    strafe: false,
  },

  // -------------------------------------------------------------- knife (dagger)
  // A light blade loadout: its own knife idle + stab/slash attacks. The knife
  // pack ships no walk/run set, so locomotion reuses the unarmed (longbow) clips
  // exactly like the sword class reuses its run for walking.
  knife: {
    loco: {
      idle: "animations/knife/knife-idle",
      walkF: UNIVERSAL_LOCO.walkF,
      walkB: UNIVERSAL_LOCO.walkB,
      walkL: UNIVERSAL_LOCO.walkL,
      walkR: UNIVERSAL_LOCO.walkR,
      runF: UNIVERSAL_LOCO.runF,
      runB: UNIVERSAL_LOCO.runB,
      runL: UNIVERSAL_LOCO.runL,
      runR: UNIVERSAL_LOCO.runR,
    },
    actions: {
      attack1: "animations/knife/stabbing",
      // Twin-blade cross-stab — the knife combo FINISHER (last entry of `combo`).
      attack2: "animations/knife/double-dagger-stab",
      attack3: "animations/sword/outward-slash",
      // USER-DIRECTED: the dagger LMB combo is the 3-hit melee-combo-1 (one sliced
      // hit per click) — same thirds as the sword. attack1..3 stay defined (usable
      // via action-slot overrides) but no longer drive the default chain.
      comboHit1: "animations/combo/melee-combo-1-hit1",
      comboHit2: "animations/combo/melee-combo-1-hit2",
      comboHit3: "animations/combo/melee-combo-1-hit3",
      // USER-DIRECTED: it's really a PARRYING knife — give it a shield-less guard
      // stance so RMB block/parry reads visually. The parry timing window and the
      // parry-react flourish are weapon-independent (see Studio + sparring).
      blockStart: "animations/bow/standing-block",
      blockIdle: "animations/bow/standing-block",
      // Dedicated dual-blade flurry special (was borrowing the sword slash).
      skill: "animations/knife/dual-weapon-combo",
      dashAttack: "animations/knife/stabbing",
      // Straight main-hand thrust (dash-stab); same clip as the dagger jab.
      stab: "animations/knife/stabbing",
      // Airborne overhead: reuse the two-handed leaping-overhead clip, angled into
      // a diving forward dagger slash (see Studio.aerialDaggerSlash).
      // New-batch running leap attack — a committed diving forward strike (was the
      // borrowed greatsword leaping-overhead); see Studio.aerialDaggerSlash.
      jumpAttack: "animations/extra/run-jump-attack",
      death: "animations/bow/standing-death-forward-01",
      hit: "animations/bow/standing-react-small-from-front",
    },
    // USER-DIRECTED: the 3-hit melee-combo-1, one sliced hit per click (same as
    // the sword). The old attack-based dagger chain is retired (kept as actions).
    combo: ["comboHit1", "comboHit2", "comboHit3"],
    strafe: false,
  },

  // -------------------------------------------------------------- axe (1h)
  // Brutal hooking chops on the one-handed stance. Recombines the unused heavy
  // overhead swing + outward hook + a finisher, with the GLB melee combo as a
  // wild spinning special. Distinct from the sword's clean fencing rhythm.
  axe: {
    loco: { ...ONE_HAND_MELEE_LOCO },
    actions: {
      // USER-DIRECTED: the Battle Axe's attack combo IS the retargeted Mixamo
      // multi-swing combo (meleeComboB). It's one long GLB clip that contains the
      // whole chain, so the combo array holds a single entry and the combo lock +
      // recovery ride the clip's REAL duration (see Animator.attack and
      // Targets.executeStrike) rather than fixed beats — keeping swings, hits and
      // lock windows in sync across its full length.
      attack1: "animations/combo/melee-combo-2",
      // New-batch one-handed horizontal hook — appended as the combo finisher (see
      // `combo`) so the Battle Axe chain caps with a wide cross-body swing.
      attack2: "animations/sword/melee-horizontal",
      // Leaping overhead cleave as the signature special (distinct from the combo).
      skill: "animations/greatsword/great-sword-jump-attack",
      dashAttack: "animations/sword/great-sword-slide-attack",
      // Straight thrust is now a rising upward thrust (new batch) — an uppercutting
      // axe poke instead of the borrowed knife stab.
      stab: "animations/spear/rising-thrust",
      blockStart: "animations/sword/sword-and-shield-block",
      blockIdle: "animations/sword/sword-and-shield-block-idle",
      death: "animations/sword/sword-and-shield-death",
      hit: "animations/greatsword/great-sword-impact",
      turnL: "animations/sword/sword-and-shield-turn",
      turnR: "animations/sword/sword-and-shield-turn-2",
    },
    combo: ["attack1", "attack2"],
    strafe: false,
  },

  // -------------------------------------------------------------- mace (1h)
  // Bludgeoning two-beat: a quick jab into a heavy crushing bash, with the other
  // GLB melee combo as its signature flurry. Slower, heavier cadence than axe.
  mace: {
    loco: { ...ONE_HAND_MELEE_LOCO },
    actions: {
      // Dedicated flanged-mace slams (the "Hell Slammer" pair) — a two-beat
      // crushing combo, replacing the borrowed sword swings.
      attack1: "animations/mace/hell-slammer-a",
      attack2: "animations/mace/hell-slammer-b",
      // New-batch overhead chop — appended as the mace combo finisher (see `combo`)
      // so the two-beat slam chain caps with a crushing downward blow.
      attack3: "animations/sword/melee-downward",
      // Crushing flurry special (the first GLB melee combo, retargeted).
      skill: "animations/combo/melee-combo-1",
      dashAttack: "animations/sword/great-sword-slide-attack",
      // Straight thrust is now a rising upward thrust (new batch) — a crushing
      // uppercut poke instead of the borrowed knife stab.
      stab: "animations/spear/rising-thrust",
      blockStart: "animations/sword/sword-and-shield-block",
      blockIdle: "animations/sword/sword-and-shield-block-idle",
      death: "animations/sword/sword-and-shield-death",
      hit: "animations/greatsword/great-sword-impact",
      turnL: "animations/sword/sword-and-shield-turn",
      turnR: "animations/sword/sword-and-shield-turn-2",
    },
    combo: ["attack1", "attack2", "attack3"],
    strafe: false,
  },

  // -------------------------------------------------------------- spear (2h)
  // Thrust-and-reach style on the two-handed stance: stab → sweeping cut →
  // leaping lunge, with a ground-covering charge as the special. Poke rhythm.
  spear: {
    loco: { ...TWO_HAND_MELEE_LOCO },
    actions: {
      // Real spear motions (new batch): a rising upward thrust opener and a
      // leaping spartan lance lunge as the chain finisher (was borrowed knife /
      // greatsword clips). attack2's sweeping cut sits between them.
      attack1: "animations/spear/upward-thrust",
      // Middle combo beat is now a committed inward cross-slash (new batch, 2nd
      // use of the sword inward-slash) — a sweeping cut between the thrust opener
      // and the lance finisher.
      attack2: "animations/sword/inward-slash",
      attack3: "animations/spear/lance-spartan",
      // Ground-covering lunging charge (slide attack).
      skill: "animations/sword/great-sword-slide-attack",
      // Dash-attack is now the leaping spartan lance lunge (new batch, 2nd use) —
      // a real spear gap-closer instead of the borrowed slide-attack.
      dashAttack: "animations/spear/lance-spartan",
      // Straight thrust now uses the dedicated upward-thrust (was knife stab).
      stab: "animations/spear/upward-thrust",
      blockStart: "animations/greatsword/great-sword-blocking-2",
      blockIdle: "animations/greatsword/great-sword-blocking-2",
      death: "animations/greatsword/two-handed-sword-death",
      hit: "animations/greatsword/great-sword-impact",
      // New-batch launching jump — a real spear leap (was the unarmed fall-loop).
      jumpAir: "animations/extra/jump-up",
      turnL: "animations/greatsword/great-sword-turn",
      turnR: "animations/greatsword/great-sword-turn-2",
    },
    combo: ["attack1", "attack2", "attack3"],
    strafe: false,
  },

  // -------------------------------------------------------------- hammer (1h)
  // One-handed warhammer: rising → side → crushing overhead smash, finished by a
  // sweeping spin. Heaviest of the one-handers, ground-and-pound cadence.
  hammer: {
    loco: { ...ONE_HAND_MELEE_LOCO },
    actions: {
      attack1: "animations/sword/sword-and-shield-attack-3",
      // New-batch swings: a wide one-handed horizontal hook (attack2) into a
      // crushing overhead chop (attack3) — both ride the hammer combo chain.
      attack2: "animations/sword/melee-horizontal",
      attack3: "animations/sword/melee-downward",
      // Sweeping whirl special (great-sword high-spin reads as a hammer sweep).
      skill: "animations/greatsword/great-sword-high-spin-attack",
      dashAttack: "animations/sword/great-sword-slide-attack",
      stab: "animations/knife/stabbing",
      blockStart: "animations/sword/sword-and-shield-block",
      blockIdle: "animations/sword/sword-and-shield-block-idle",
      death: "animations/sword/sword-and-shield-death",
      hit: "animations/greatsword/great-sword-impact",
      turnL: "animations/sword/sword-and-shield-turn",
      turnR: "animations/sword/sword-and-shield-turn-2",
    },
    combo: ["attack1", "attack2", "attack3"],
    strafe: false,
  },

  // -------------------------------------------------------------- greataxe (2h)
  // Heavy two-handed cleaves: alternating wide slashes into a big combo finisher,
  // with a leaping cleave special. Wide, committed arcs vs the greatsword rhythm.
  greataxe: {
    loco: { ...TWO_HAND_MELEE_LOCO },
    actions: {
      // USER-DIRECTED combo: a dedicated great-axe multi-swing chain in one clip.
      // The chain now caps with a heavy committed cleave (attack2); the great-axe
      // combo opener + the cleave both ride their REAL duration (Battle Axe
      // pattern). attack3 remains for action-slot overrides / preview.
      attack1: "animations/greataxe/great-axe-combo",
      attack2: "animations/greatsword/heavy-weapon-swing",
      attack3: "animations/sword/two-hand-sword-combo",
      // Signature special is now a running leap attack (new batch, 2nd use) — a
      // committed forward-leaping cleave that covers ground.
      skill: "animations/extra/run-jump-attack",
      dashAttack: "animations/sword/great-sword-slide-attack",
      stab: "animations/greatsword/great-sword-jump-attack",
      blockStart: "animations/greatsword/great-sword-blocking-2",
      blockIdle: "animations/greatsword/great-sword-blocking-2",
      death: "animations/greatsword/two-handed-sword-death",
      hit: "animations/greatsword/great-sword-impact",
      // New-batch movement: an evasive leap-away backstep (dodgeB, 2nd use) and a
      // crouch-to-sprint burst (dash, 2nd use), overriding the unarmed fallbacks.
      dodgeB: "animations/extra/jump-away",
      dash: "animations/extra/crouch-to-sprint",
      turnL: "animations/greatsword/great-sword-turn",
      turnR: "animations/greatsword/great-sword-turn-2",
    },
    // USER-DIRECTED: the LMB combo opens with the flowing great-axe combo clip
    // (attack1) and caps with a heavy committed cleave (attack2), each played in
    // full per commit and riding its real duration.
    combo: ["attack1", "attack2"],
    strafe: false,
  },

  // -------------------------------------------------------------- hammer2h (2h)
  // Two-handed maul: heavy alternating swings into an overhead slam, with a
  // whirling maul special. The most ponderous of the roster — pure impact.
  hammer2h: {
    loco: { ...TWO_HAND_MELEE_LOCO },
    actions: {
      // Dedicated heavy maul swing opener (new batch) — was a borrowed greatsword
      // slash; gives the 2h-hammer its own ponderous committed cleave.
      attack1: "animations/greatsword/heavy-weapon-swing",
      attack2: "animations/greatsword/great-sword-slash-2",
      attack3: "animations/greatsword/great-sword-jump-attack",
      // Whirling maul sweep special.
      skill: "animations/greatsword/great-sword-high-spin-attack",
      dashAttack: "animations/sword/great-sword-slide-attack",
      stab: "animations/greatsword/great-sword-jump-attack",
      blockStart: "animations/greatsword/great-sword-blocking-2",
      blockIdle: "animations/greatsword/great-sword-blocking-2",
      death: "animations/greatsword/two-handed-sword-death",
      hit: "animations/greatsword/great-sword-impact",
      turnL: "animations/greatsword/great-sword-turn",
      turnR: "animations/greatsword/great-sword-turn-2",
    },
    combo: ["attack1", "attack2", "attack3"],
    strafe: false,
  },

  // -------------------------------------------------------------- mace2h (2h guardian maul)
  // Warlords SSOT: Smite (F), Whirlwind Slash (dash), 2H GS combo (LMB).
  // GLB Hippolin plays native walk/attack; Explorer uses this Mixamo set.
  mace2h: {
    loco: {
      idle: "animations/greatsword/great-sword-idle",
      walkF: "animations/greatsword/great-sword-walk",
      walkB: "animations/greatsword/great-sword-walk-2",
      walkL: "animations/greatsword/great-sword-strafe",
      walkR: "animations/greatsword/great-sword-strafe-2",
      runF: "animations/greatsword/great-sword-run",
      runB: "animations/greatsword/great-sword-run-2",
      runL: "animations/greatsword/great-sword-strafe-3",
      runR: "animations/greatsword/great-sword-strafe-4",
    },
    actions: {
      // LMB: same 2H combo structure as greatsword (flowing multi-swing → heavy cleave).
      attack1: "animations/greatsword/great-sword-combo",
      attack2: "animations/greatsword/heavy-weapon-swing",
      attack3: "animations/greatsword/great-sword-slash-3",
      attack4: "animations/greatsword/great-sword-slash-4",
      attack5: "animations/greatsword/great-sword-slash-5",
      // F skill "Smite" (MACE ability) — cast flourish → impact.
      skill: "animations/sword/sword-and-shield-casting",
      // Whirlwind Slash body: high-spin (secondary GS).
      stab: "animations/greatsword/great-sword-high-spin-attack",
      // Slide into range for Whirlwind Slash.
      dashAttack: "animations/sword/great-sword-slide-attack",
      blockStart: "animations/greatsword/great-sword-blocking-2",
      blockIdle: "animations/greatsword/great-sword-blocking-2",
      draw: "animations/greatsword/draw-great-sword-1",
      sheath: "animations/greatsword/draw-great-sword-1",
      death: "animations/greatsword/two-handed-sword-death",
      hit: "animations/greatsword/great-sword-impact",
      jumpAir: "animations/extra/jump-up",
      dodgeB: "animations/extra/jump-away",
      dash: "animations/extra/crouch-to-sprint",
      turnL: "animations/greatsword/great-sword-turn",
      turnR: "animations/greatsword/great-sword-turn-2",
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
      // New-batch dedicated combat aim idle (was the rifle pack's idle-aiming).
      aim: "animations/extra/aim-idle",
      attack1: "animations/rifle/idle-aiming",
      skill: "animations/rifle/idle-crouching",
      crouchIdle: "animations/rifle/idle-crouching",
      // Rifle-specific dash: a sprint-start lunge (overrides the shared dive-forward).
      dash: "animations/rifle/start-run",
      // Rifle/crossbow backward dodge: a quick hop-back (overrides the shared bow
      // dodge-backward) for backpedaling out of melee while keeping the gun up.
      dodgeB: "animations/rifle/jump-backward",
      death: "animations/rifle/death-from-front-headshot",
      turnL: "animations/rifle/turn-90-left",
      turnR: "animations/rifle/turn-90-right",
    },
    combo: ["attack1"],
    strafe: true,
  },

  // -------------------------------------------------------------- pistol (gunslinger)
  // Dedicated single-pistol locomotion pack: idle, directional walk/run, strafes,
  // and a kneeling stance. The pack ships no dedicated fire clip, so (like the
  // rifle class) the "attack" snaps to the aim/idle pose and the kneel is the
  // skill stance. Jump/land + death + react fall back to the shared bow/rifle clips.
  pistol: {
    loco: {
      idle: "animations/pistol/idle",
      walkF: "animations/pistol/walk-forward",
      walkB: "animations/pistol/walk-backward",
      walkL: "animations/pistol/strafe-left",
      walkR: "animations/pistol/strafe-right",
      runF: "animations/pistol/run-forward",
      runB: "animations/pistol/run-backward",
      runL: "animations/pistol/strafe-left",
      runR: "animations/pistol/strafe-right",
    },
    actions: {
      // New-batch dedicated combat aim idle (was the pistol idle pose, 2nd use).
      aim: "animations/extra/aim-idle",
      // Real one-shot fire clip (was a frozen idle pose): drives the attack
      // clock via its own duration like every other one-shot action.
      attack1: "animations/pistol/gunplay",
      // Quick-draw from the holster.
      draw: "animations/pistol/drawing-gun",
      skill: "animations/pistol/kneeling-idle",
      crouchIdle: "animations/pistol/kneeling-idle",
      jumpAir: UNIVERSAL_MOVEMENT.jumpAir,
      land: UNIVERSAL_MOVEMENT.land,
      hit: "animations/bow/standing-react-small-from-front",
      death: "animations/rifle/death-from-front-headshot",
      turnL: "animations/rifle/turn-90-left",
      turnR: "animations/rifle/turn-90-right",
      // --- Kiter kit one-shots (see ActionKey docs). ---
      pistolWhip: "animations/pistol/pistol-whip",
      uppercut: "animations/pistol/uppercut",
      chargedShot: "animations/pistol/charged-pistol",
      mmaKick: "animations/pistol/mma-kick",
      kipUp: "animations/extra/corkscrew-kip-up",
    },
    combo: ["attack1"],
    strafe: true,
  },

  // -------------------------------------------------------------- bow (longbow)
  bow: {
    loco: {
      idle: "animations/bow/standing-idle-01",
      // Relaxed archer idles rotated at rest (weapon lowered, not aiming).
      idles: ["animations/bow/standing-idle-01", "animations/bow/unarmed-idle-01"],
      walkF: "animations/bow/standing-aim-walk-forward",
      walkB: "animations/bow/standing-aim-walk-back",
      walkL: "animations/bow/standing-aim-walk-left",
      walkR: "animations/bow/standing-aim-walk-right",
      runF: UNIVERSAL_LOCO.runF,
      runB: UNIVERSAL_LOCO.runB,
      runL: UNIVERSAL_LOCO.runL,
      runR: UNIVERSAL_LOCO.runR,
    },
    actions: {
      equip: "animations/bow/standing-equip-bow",
      disarm: "animations/bow/standing-disarm-bow",
      aim: "animations/bow/standing-aim-overdraw",
      drawArrow: "animations/bow/standing-draw-arrow",
      release: "animations/bow/standing-aim-recoil",
      // USER-DIRECTED: the bow's primary attack is a simple, full arrow shoot
      // (nock -> draw -> loose in one clip), riding its real duration per click.
      attack1: "animations/bow/shooting-arrow",
      // USER-DIRECTED: the bow's F-skill is a quick lunging melee SLASH (a faster
      // variant of the greatsword's slide-attack) that SLOWS whatever it hits.
      // The damage + slow debuff are applied engine-side (Studio.doBowSlash →
      // Targets slow); this clip is just the visible dash-slash motion.
      dashAttack: "animations/sword/great-sword-slide-attack",
      skill: "animations/sword/great-sword-slide-attack",
      // USER-DIRECTED: the archer's guard is a quick-draw off-hand dagger that
      // snaps out to parry/block (and holds it for the guard idle), instead of
      // the old empty-handed bow block.
      blockStart: "animations/extra/intoout",
      blockIdle: "animations/extra/intoout",
      hit: "animations/bow/standing-react-small-from-front",
      death: "animations/bow/standing-death-forward-01",
      jumpAir: UNIVERSAL_MOVEMENT.jumpAir,
      land: UNIVERSAL_MOVEMENT.land,
      dodgeF: UNIVERSAL_MOVEMENT.dodgeF,
      dodgeB: UNIVERSAL_MOVEMENT.dodgeB,
      dodgeL: UNIVERSAL_MOVEMENT.dodgeL,
      dodgeR: UNIVERSAL_MOVEMENT.dodgeR,
      dash: UNIVERSAL_MOVEMENT.dash,
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
      // standing-2h-magic-area-attack-01.fbx fails FBXLoader parse ("Unknown property
      // type") so it never loaded (skill + magicArea both silently no-op'd); repointed
      // to the working two-handed magic channel clip.
      skill: "animations/magic/standing-2h-magic",
      castSpell: "animations/magic/standing-1h-cast-spell-01",
      magicAttack: "animations/magic/standing-1h-magic-attack-01",
      magicArea: "animations/magic/standing-2h-magic",
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
  magicArea: "animations/magic/standing-2h-magic",
  // Extra casting bodies (vfx-sandbox library): a focused single-cast pose and a
  // sustained two-handed channel — used as projectile/spell cast animations.
  castSpell2: "animations/magic/casting-spell",
  magicChannel: "animations/magic/standing-2h-magic",
  // Greatsword variant (available everywhere; pair with heavy/cast skills).
  overheadSlash: "animations/greatsword/great-sword-overhead",
  // Horizontal slash PAIR (class-independent). The outward swing is the sword
  // pack's backhand outward slash; the inward swing is the committed forehand
  // sword slash that crosses the body the other way — a matched in/out pair.
  insideSlash: "animations/sword/sword-and-shield-attack",
  outsideSlash: "animations/sword/outward-slash",
  // Universal raised-guard hold — the looped block pose used as a class-independent
  // fallback so any weapon (or a class missing a bespoke block) still guards.
  blockGuard: "animations/block/standing-block-idle",
  // Personality gesture idles (vfx-sandbox library) — class-independent emotes.
  gestureAcknowledge: "animations/gestures/acknowledging",
  gestureCocky: "animations/gestures/being-cocky",
  gestureDismiss: "animations/gestures/dismissing-gesture",
  gestureHappy: "animations/gestures/happy-hand-gesture",
  gestureLookAway: "animations/gestures/look-away-gesture",
  gestureRelievedSigh: "animations/gestures/relieved-sigh",
  gestureHeadShake: "animations/gestures/thoughtful-head-shake",
  gestureWeightShift: "animations/gestures/weight-shift",
  // Movement / combat verbs available to any loadout.
  slide: "animations/extra/running-slide",
  throw: "animations/extra/grenade-throw",
  // Quick sidestep evade ("evading a threat") — the default ground evade one-shot.
  evadeThreat: "animations/extra/evading-a-threat",
  // Ground finisher: a leaping stomp/axe-kick onto a knocked-down (fallen) enemy.
  stomp: "animations/extra/stomp",
  // Extra movement / combat verbs (user clip batch): a stylish flip + backward
  // evasive jump (acrobatics), a right pivot + medium left side-step (footwork),
  // a drop-down off a ledge, and a dirty close-range headbutt.
  stylishFlip: "animations/extra/stylish-flip",
  backJump: "animations/extra/backwards-jump",
  // Running forward flip — an acrobatic flip carried with forward momentum.
  runningFlip: "animations/extra/running-forward-flip",
  // Long backward leap — the arcane staff's void-jaunt teleport pose.
  longBackJump: "animations/extra/long-backward-jump",
  pivotR: "animations/extra/right-pivot",
  sideStepL: "animations/extra/left-side-step",
  jumpDown: "animations/extra/jumping-down",
  headbutt: "animations/extra/illegal-headbutt",
  // Retargeted Mixamo melee combos. These are GLB assets (not FBX) and load
  // through a rotation-only retarget — see `GLB_CLIP_IDS` and the loader.
  meleeComboA: "animations/combo/melee-combo-1",
  meleeComboB: "animations/combo/melee-combo-2",
};

/**
 * Catalog ids whose clips are hosted as GLB (not FBX) and require Mixamo
 * retargeting at load time. The loader routes these through `GLTFLoader` +
 * `retargetMixamoClip`; every other id loads as FBX. Keep this in sync with any
 * `animations/<...>` id that points at a `.glb` asset.
 */
export const GLB_CLIP_IDS: ReadonlySet<string> = new Set([
  "animations/combo/melee-combo-1",
  "animations/combo/melee-combo-2",
  // Sliced thirds of melee-combo-1 — the sword/dagger 3-hit click combo. No
  // standalone files back these ids; the loader derives them from the parent
  // GLB via GLB_SUBCLIPS. Listed here so loadClips routes them through the GLB
  // path (retarget + full-clip endFactor).
  "animations/combo/melee-combo-1-hit1",
  "animations/combo/melee-combo-1-hit2",
  "animations/combo/melee-combo-1-hit3",
]);

/**
 * Class-INDEPENDENT defensive REACTION clips. These animate the result of a
 * defensive exchange — stumbles, stuns, falling, wall-crashes, get-ups — and are
 * available to every weapon class via `resolveReaction` / `GLOBAL_REACTIONS`.
 *
 * Clip ids reference `animations/reactions/<name>.fbx` files hosted in the
 * animator's `public/anim/` folder (same convention as all other catalog ids).
 */
export const GLOBAL_REACTIONS: Partial<Record<ActionKey, string>> = {
  // Parry flourish on the defending fighter (upgraded clip from the block pack).
  parryReact:   "animations/block/parry",
  // Directional + weighted guarded-hit reacts — played when a hit lands on a
  // raised guard, then blended back into the held guard pose. Class-independent
  // so EVERY weapon gets a real reaction (no silent no-op on a soaked hit).
  blockLeft:        "animations/block/left-block",
  blockRight:       "animations/block/right-block",
  blockReact:       "animations/block/standing-block-react-large",
  blockReactWide:   "animations/block/block-react-large",
  blockReactHeavy:  "animations/block/great-sword-impact",
  // Stumble reactions (short stagger / loss of footing).
  stumble:      "animations/extra/baseball-hit",
  jogStumble:   "animations/reactions/jogging-stumble",
  // Fall / knock-down sequence.
  fallDown:     "animations/reactions/falling",
  fallen:       "animations/reactions/fallen",
  getUp:        "animations/reactions/get-up",
  // Daze reactions.
  stunned:      "animations/reactions/stunned",
  hitHead:      "animations/reactions/hit-to-head",
  // Launched / wall reactions.
  wallCrash:    "animations/reactions/wall-crash",
  // Injured locomotion.
  injuredCrawl: "animations/reactions/running-crawl",
  // Knock reactions (vfx-sandbox library): a hard knock onto the back, an
  // upward launch pop, a heavy body-blow stagger, a full knock-out collapse,
  // and an evasive leap-away.
  flyingBack:      "animations/reactions/flying-back",
  uppercutLaunch:  "animations/reactions/uppercut",
  bigBlow:         "animations/reactions/big-body-blow",
  // knocked-out.fbx ships EMPTY (0 tracks, 0s) so it never animated — and because
  // an empty clip still registers, the Studio KO reaction silently no-op'd instead
  // of falling back. Repointed to the working knocked-unconscious collapse.
  knockedOut:      "animations/reactions/knocked-unconscious",
  // Deeper KO collapse — used as the grounded landing pose of a clean knock-up.
  knockedUnconscious: "animations/reactions/knocked-unconscious",
  jumpAway:        "animations/reactions/jump-away",
  // Clean knock-up launcher chain: the upward pop (knockedUp, or knockedUpBack
  // when shoved clear), the airborne falling pose held after the apex
  // (fallingIdle), then the grounded knockedUnconscious collapse (above) on landing.
  knockedUp:       "animations/reactions/knocked-up",
  knockedUpBack:   "animations/reactions/knocked-up-and-back",
  fallingIdle:     "animations/reactions/falling-idle",
};

/** Resolve a class-independent one-shot to its clip id, if shipped. */
export function resolveGlobalAction(key: ActionKey): string | undefined {
  return GLOBAL_ACTIONS[key] ?? GLOBAL_REACTIONS[key];
}

/**
 * Resolve an action key to ANY concrete clip id the library ships for it,
 * regardless of the equipped weapon class. Search order: class-independent
 * globals, defensive reactions, the universal movement/loco fallbacks, then the
 * first weapon set that defines the key. Used by the Dressing Room clip preview
 * so every verb plays its OWN same-named animation even when the equipped class
 * ships no clip for it (e.g. previewing `jumpAttack`/`pistolWhip`/`hurricaneKick`
 * on a sword loadout). Returns undefined only for a key nothing defines.
 */
export function resolveActionAnywhere(key: ActionKey): string | undefined {
  const universal =
    (UNIVERSAL_MOVEMENT as Record<string, string>)[key] ??
    (UNIVERSAL_LOCO as Record<string, string>)[key];
  const fromGlobal = GLOBAL_ACTIONS[key] ?? GLOBAL_REACTIONS[key] ?? universal;
  if (fromGlobal) return fromGlobal;
  for (const set of Object.values(WEAPON_SETS)) {
    const id = set.actions[key];
    if (id) return id;
  }
  return undefined;
}

/** True when `name` is a known class-independent action verb (GLOBAL_ACTIONS). */
export function isGlobalAction(name: string): name is ActionKey {
  return Object.prototype.hasOwnProperty.call(GLOBAL_ACTIONS, name);
}

/**
 * Resolve a defensive-reaction clip id. Falls back to `stumble` for unknown
 * keys so a defensive exchange ALWAYS animates a real reaction — no silent
 * no-ops when a category maps an outcome to a key the rig ships no clip for.
 */
export function resolveReaction(key: ActionKey): string | undefined {
  return GLOBAL_REACTIONS[key] ?? GLOBAL_REACTIONS.stumble;
}

/**
 * Add every clip id in a (partial) LocoSet to `ids`, flattening the optional
 * `idles` variant pool (a `readonly string[]`) alongside the scalar slots.
 */
function addLocoIds(loco: WeaponClipSet["loco"], ids: Set<string>): void {
  for (const value of Object.values(loco)) {
    if (!value) continue;
    if (typeof value === "string") {
      ids.add(value);
    } else {
      for (const id of value) if (id) ids.add(id);
    }
  }
}

/** Every distinct clip id referenced by weapon classes, traversal, and globals. */
export function allReferencedClipIds(): string[] {
  const ids = new Set<string>([SKELETON_SOURCE_ID]);
  for (const set of Object.values(WEAPON_SETS)) {
    addLocoIds(set.loco, ids);
    for (const id of Object.values(set.actions)) if (id) ids.add(id);
  }
  for (const set of Object.values(TRAVERSAL_SETS)) {
    for (const id of Object.values(set)) if (id) ids.add(id);
  }
  for (const id of Object.values(GLOBAL_ACTIONS)) if (id) ids.add(id);
  for (const id of Object.values(GLOBAL_REACTIONS)) if (id) ids.add(id);
  return [...ids];
}

/** The clip ids needed for a single weapon class (plus the skeleton source). */
export function clipIdsForClass(weapon: WeaponClass): string[] {
  const set = WEAPON_SETS[weapon];
  const ids = new Set<string>([SKELETON_SOURCE_ID]);
  addLocoIds(set.loco, ids);
  for (const id of Object.values(set.actions)) if (id) ids.add(id);
  return [...ids];
}

/**
 * The clip ids for all global reaction clips (class-independent). Hosts that
 * need to guarantee reaction animations are playable should include these
 * alongside their class-specific ids.
 */
export function reactionClipIds(): string[] {
  return Object.values(GLOBAL_REACTIONS).filter(Boolean) as string[];
}
