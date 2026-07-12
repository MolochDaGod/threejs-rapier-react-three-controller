import type { ActionKey } from "./types";

/**
 * SINGLE SOURCE OF TRUTH for the procedural Explorer rig's animation "verbs" —
 * the named clips it exposes to the Dressing Room "Rig clips" library, the slot
 * editor, and every AI/Studio trigger. Each verb is ONE declarative row here
 * (clip key + UI category + display label + gameplay trigger strategy), so
 * adding or rewiring a clip is a single edit rather than a 6-place lockstep, and
 * the preview path and the in-combat one-shot path resolve every verb the SAME
 * way (see {@link ClipPlay}). All the previously hand-maintained tables
 * (`VERBS`, `PREVIEW_VERB_KEYS`, `CLIP_CATEGORIES`, `VERB_CATEGORY`,
 * `VERB_LABEL_OVERRIDES`) are now DERIVED from {@link CLIP_REGISTRY}.
 */

/** UI category order for the Dressing Room "Rig clips" library (Animations panel). */
export const CLIP_CATEGORY_ORDER = [
  "Melee",
  "Skills & Magic",
  "Greatsword",
  "Defense",
  "Movement",
  "Acrobatics",
  "Finishers",
  "Gunslinger",
  "Gestures",
  "Utility",
] as const;
export type ClipCategory = (typeof CLIP_CATEGORY_ORDER)[number];

/**
 * How a verb is TRIGGERED during gameplay by
 * {@link import("../ExplorerCharacter").ExplorerCharacter.playClipOnce}. Verbs
 * with real gameplay semantics name a dedicated Animator method (combo chain,
 * skill cooldown, directional roll, magic one-shot, …); every other verb uses
 * the default `"clip"` strategy, which resolves the verb's {@link ClipEntry.key}
 * the SAME way the Dressing Room preview does — equipped weapon class first, then
 * `resolveActionAnywhere` across every class and the class-independent
 * globals/reactions — and plays it. That shared resolution is the whole point: a
 * verb can never preview correctly yet silently no-op (or fire a generic attack)
 * in combat.
 */
export type ClipPlay =
  | "clip"
  | "combo"
  | "skill"
  | "slide"
  | "throw"
  | "dash"
  | "dashAttack"
  | "death"
  | "hit"
  | { magic: "castSpell" | "magicAttack" | "magicArea" }
  | { action: ActionKey }
  | { movement: ActionKey; airborne?: boolean }
  | { roll: "F" | "B" | "L" | "R" };

export interface ClipEntry {
  /** Verb id: the library / slot-editor name AND the token passed to playClipOnce. */
  readonly verb: string;
  /** ActionKey naming this verb's clip (preview resolution + offline/vitest validation). */
  readonly key: ActionKey;
  /** Library category. Omitted for combat-only verbs hidden from the panel. */
  readonly category?: ClipCategory;
  /** Display-name override when the auto-humanised label reads poorly. */
  readonly label?: string;
  /** Gameplay trigger strategy (defaults to `"clip"`). */
  readonly play?: ClipPlay;
  /** `false` = combat-only (excluded from the preview library / {@link VERBS}). */
  readonly library?: boolean;
}

/**
 * The registry. Library rows are grouped in {@link CLIP_CATEGORY_ORDER}; the
 * trailing combat-only rows (directional dodges) drive AI defense but are not
 * surfaced in the preview library.
 */
export const CLIP_REGISTRY: readonly ClipEntry[] = [
  // ----- Melee -----
  { verb: "attack", key: "attack1", category: "Melee", play: "combo" },
  { verb: "attack2", key: "attack2", category: "Melee", play: "combo" },
  { verb: "attack3", key: "attack3", category: "Melee", play: "combo" },
  { verb: "stab", key: "stab", category: "Melee", play: { action: "stab" } },
  { verb: "insideSlash", key: "insideSlash", category: "Melee" },
  { verb: "outsideSlash", key: "outsideSlash", category: "Melee" },
  { verb: "jumpAttack", key: "jumpAttack", category: "Melee", play: { action: "jumpAttack" } },
  { verb: "meleeCombo1", key: "meleeComboA", category: "Melee", play: { action: "meleeComboA" } },
  { verb: "meleeCombo2", key: "meleeComboB", category: "Melee", play: { action: "meleeComboB" } },
  { verb: "dashAttack", key: "dashAttack", category: "Melee", play: "dashAttack" },
  { verb: "hurricaneKick", key: "hurricaneKick", category: "Melee", play: { action: "hurricaneKick" } },
  { verb: "headbutt", key: "headbutt", category: "Melee" },

  // ----- Skills & Magic -----
  { verb: "skill", key: "skill", category: "Skills & Magic", play: "skill" },
  { verb: "cast", key: "castSpell", category: "Skills & Magic", play: { magic: "castSpell" } },
  { verb: "magicAttack", key: "magicAttack", category: "Skills & Magic", play: { magic: "magicAttack" } },
  { verb: "magicArea", key: "magicArea", category: "Skills & Magic", play: { magic: "magicArea" } },
  { verb: "castSpell2", key: "castSpell2", category: "Skills & Magic" },
  { verb: "magicChannel", key: "magicChannel", category: "Skills & Magic" },

  // ----- Greatsword -----
  { verb: "overheadSlash", key: "overheadSlash", category: "Greatsword" },

  // ----- Defense -----
  { verb: "block", key: "blockStart", category: "Defense" },
  { verb: "blockGuard", key: "blockGuard", category: "Defense" },
  { verb: "blockLeft", key: "blockLeft", category: "Defense" },
  { verb: "blockRight", key: "blockRight", category: "Defense" },
  { verb: "blockReact", key: "blockReact", category: "Defense" },
  { verb: "blockReactWide", key: "blockReactWide", category: "Defense" },
  { verb: "blockReactHeavy", key: "blockReactHeavy", category: "Defense" },
  { verb: "parry", key: "parryReact", category: "Defense" },

  // ----- Movement -----
  { verb: "dash", key: "dash", category: "Movement", play: "dash" },
  { verb: "roll", key: "dodgeF", category: "Movement", play: { roll: "F" } },
  { verb: "jump", key: "jumpAir", category: "Movement" },
  { verb: "slide", key: "slide", category: "Movement", play: "slide" },
  { verb: "pivotR", key: "pivotR", category: "Movement", label: "Pivot Right" },
  { verb: "sideStepL", key: "sideStepL", category: "Movement", label: "Side-Step Left" },
  { verb: "jumpDown", key: "jumpDown", category: "Movement" },

  // ----- Acrobatics -----
  { verb: "airDodge", key: "airDodge", category: "Acrobatics", play: { movement: "airDodge", airborne: true } },
  { verb: "utilityKick", key: "utilityKick", category: "Acrobatics", play: { movement: "utilityKick" } },
  { verb: "frontFlip", key: "frontFlip", category: "Acrobatics", play: { movement: "frontFlip" } },
  { verb: "twistFlip", key: "twistFlip", category: "Acrobatics", play: { movement: "twistFlip" } },
  { verb: "butterflyTwirl", key: "butterflyTwirl", category: "Acrobatics", play: { movement: "butterflyTwirl" } },
  { verb: "spinEvade", key: "spinEvade", category: "Acrobatics", play: { movement: "spinEvade" } },
  { verb: "corkscrewEvade", key: "corkscrewEvade", category: "Acrobatics", play: { movement: "corkscrewEvade" } },
  { verb: "evadeThreat", key: "evadeThreat", category: "Acrobatics" },
  { verb: "stylishFlip", key: "stylishFlip", category: "Acrobatics" },
  { verb: "backJump", key: "backJump", category: "Acrobatics" },
  { verb: "runningFlip", key: "runningFlip", category: "Acrobatics" },
  { verb: "longBackJump", key: "longBackJump", category: "Acrobatics" },
  { verb: "kipUp", key: "kipUp", category: "Acrobatics", label: "Kip-Up", play: { action: "kipUp" } },

  // ----- Finishers -----
  { verb: "stomp", key: "stomp", category: "Finishers" },

  // ----- Gunslinger (pistol "kiter" kit) -----
  { verb: "pistolWhip", key: "pistolWhip", category: "Gunslinger", play: { action: "pistolWhip" } },
  { verb: "uppercut", key: "uppercut", category: "Gunslinger", play: { action: "uppercut" } },
  { verb: "chargedShot", key: "chargedShot", category: "Gunslinger", play: { action: "chargedShot" } },
  { verb: "mmaKick", key: "mmaKick", category: "Gunslinger", label: "MMA Kick", play: { action: "mmaKick" } },

  // ----- Gestures (personality emotes) -----
  { verb: "gestureAcknowledge", key: "gestureAcknowledge", category: "Gestures", label: "Acknowledge" },
  { verb: "gestureCocky", key: "gestureCocky", category: "Gestures", label: "Cocky" },
  { verb: "gestureDismiss", key: "gestureDismiss", category: "Gestures", label: "Dismiss" },
  { verb: "gestureHappy", key: "gestureHappy", category: "Gestures", label: "Happy" },
  { verb: "gestureLookAway", key: "gestureLookAway", category: "Gestures", label: "Look Away" },
  { verb: "gestureRelievedSigh", key: "gestureRelievedSigh", category: "Gestures", label: "Relieved Sigh" },
  { verb: "gestureHeadShake", key: "gestureHeadShake", category: "Gestures", label: "Head Shake" },
  { verb: "gestureWeightShift", key: "gestureWeightShift", category: "Gestures", label: "Weight Shift" },

  // ----- Utility -----
  { verb: "throw", key: "throw", category: "Utility", play: "throw" },
  { verb: "death", key: "death", category: "Utility", play: "death" },
  { verb: "hit", key: "hit", category: "Utility", play: "hit" },

  // ----- Combat-only (AI defense; not in the preview library) -----
  { verb: "dodgeF", key: "dodgeF", play: { roll: "F" }, library: false },
  { verb: "dodgeB", key: "dodgeB", play: { roll: "B" }, library: false },
  { verb: "dodgeL", key: "dodgeL", play: { roll: "L" }, library: false },
  { verb: "dodgeR", key: "dodgeR", play: { roll: "R" }, library: false },
];

/** Registry rows surfaced in the Dressing Room preview library / slot editor. */
const LIBRARY = CLIP_REGISTRY.filter((e) => e.library !== false);

/** Verb → its full registry row (library + combat-only), for gameplay dispatch. */
export const CLIP_BY_VERB: ReadonlyMap<string, ClipEntry> = new Map(
  CLIP_REGISTRY.map((e) => [e.verb, e]),
);

/** Ordered preview-library verbs (the Dressing Room "Rig clips" list). */
export const VERBS: readonly string[] = LIBRARY.map((e) => e.verb);

/**
 * Each preview {@link VERBS verb} → the {@link ActionKey} that names its clip, so
 * the library plays the SAME-NAMED animation regardless of equipped weapon
 * (resolved equipped-class-first, then across all classes/globals).
 */
export const PREVIEW_VERB_KEYS: Record<string, ActionKey> = Object.fromEntries(
  LIBRARY.map((e) => [e.verb, e.key]),
);

/**
 * Use-case grouping for the verb library, surfaced by the Animations panel so the
 * clip list reads by category rather than as one flat list. Order follows
 * {@link CLIP_CATEGORY_ORDER}; empty categories are omitted.
 */
export const CLIP_CATEGORIES: ReadonlyArray<{ label: ClipCategory; verbs: readonly string[] }> =
  CLIP_CATEGORY_ORDER.map((label) => ({
    label,
    verbs: LIBRARY.filter((e) => e.category === label).map((e) => e.verb),
  })).filter((g) => g.verbs.length > 0);

/** verb → its built-in {@link CLIP_CATEGORIES} section label (the default grouping in the library). */
export const VERB_CATEGORY: Record<string, string> = Object.fromEntries(
  LIBRARY.filter((e) => e.category).map((e) => [e.verb, e.category as string]),
);

/**
 * Display-name overrides for verbs the generic humaniser can't title-case nicely
 * (acronyms, hyphenated terms, the redundant "gesture" prefix on emotes).
 */
export const VERB_LABEL_OVERRIDES: Record<string, string> = Object.fromEntries(
  CLIP_REGISTRY.filter((e) => e.label).map((e) => [e.verb, e.label as string]),
);

/**
 * Group an arbitrary clip-name list into the {@link CLIP_CATEGORIES} use-case
 * sections (preserving category order), appending any unrecognised clips to a
 * trailing "Other" group. Empty groups are omitted.
 */
export function categorizeClips(clips: string[]): { label: string; clips: string[] }[] {
  const remaining = new Set(clips);
  const groups: { label: string; clips: string[] }[] = [];
  for (const cat of CLIP_CATEGORIES) {
    const present = cat.verbs.filter((v) => remaining.has(v));
    for (const v of present) remaining.delete(v);
    if (present.length) groups.push({ label: cat.label, clips: present });
  }
  if (remaining.size) groups.push({ label: "Other", clips: [...remaining] });
  return groups;
}

/**
 * Turn a clip id or verb into a human label: drop any path prefix, split
 * camelCase and letter/digit boundaries, swap dashes/underscores for spaces, and
 * Title-Case it (`"animations/sword/outward-slash"` → "Outward Slash",
 * `"jumpAttack"` → "Jump Attack", `"meleeCombo1"` → "Melee Combo 1").
 */
export function humanizeClipId(id: string): string {
  const tail = id.split("/").pop() ?? id;
  return tail
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Human-readable label for a preview {@link VERBS verb} (override first, else humanised). */
export function verbLabel(verb: string): string {
  return VERB_LABEL_OVERRIDES[verb] ?? humanizeClipId(verb);
}
