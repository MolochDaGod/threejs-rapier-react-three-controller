/**
 * Avatar Edit catalog — the pure data model for the cube modular head builder.
 *
 * Six playable races, each with its own skin palette and sensible default
 * parts, plus a shared catalog of modular slots (hair / eyes / brows / facial
 * hair / ears / tusks / extras) with per-slot style lists and colour swatches.
 * Everything here is data + pure helpers so the composer and UI stay in sync
 * from one source of truth.
 */

export type RaceId = "human" | "barbarian" | "orc" | "undead" | "dwarf" | "elf";

export type HairStyle =
  | "bald"
  | "short"
  | "long"
  | "smooth"
  | "shaggy"
  | "dreads"
  | "mohawk"
  | "topknot"
  | "wild";
export type EyeStyle = "round" | "narrow" | "angry" | "hollow" | "glow";
export type BrowStyle = "none" | "thin" | "thick" | "slant";
export type FacialHairStyle =
  | "none"
  | "stubble"
  | "mustache"
  | "sideburns"
  | "goatee"
  | "full"
  | "braided";
export type EarStyle = "none" | "round" | "pointed" | "long";
export type TuskStyle =
  | "none"
  | "small"
  | "big"
  | "curved" // hook out of the mouth then sweep upward
  | "long" // jut straight out of the face, far forward
  | "flared" // splay wide out to the sides
  | "twin" // double pair: big outer + small inner tusks
  | "broken"; // battle-worn: one full tusk, one snapped stub
export type ExtraStyle = "none" | "scar" | "warpaint" | "freckles" | "stitches";
export type MouthStyle = "neutral" | "smile" | "frown" | "grim";
export type HeadgearStyle = "none" | "headband" | "circlet" | "horns";
export type HatId =
  | "none"
  | "pirateVoxel"
  | "pirate"
  | "cowboy"
  | "witch"
  | "tophat"
  | "princess"
  | "astronaut"
  | "hood";
export type ExpressionId = "normal" | "happy" | "talking" | "angry" | "sad" | "hurt";

/** Adjustable part slots — every accessory that can be nudged/scaled/hidden. */
export type AdjustSlot =
  | "hair"
  | "facialHair"
  | "ears"
  | "nose"
  | "tusks"
  | "headgear"
  | "hat"
  | "extra";

/**
 * Per-part placement tweak. Offsets are in head units (1 pixel = 1/16);
 * `scale` multiplies the part about its own centre; `hide` removes it
 * entirely (3D boxes AND painted pixels).
 */
export interface PartAdjust {
  x: number;
  y: number;
  z: number;
  scale: number;
  hide: boolean;
  /** Rotation in degrees. 3D parts (hat) use all three; painted decals (extras) use rotZ. */
  rotX: number;
  rotY: number;
  rotZ: number;
}

export const DEFAULT_ADJUST: PartAdjust = {
  x: 0,
  y: 0,
  z: 0,
  scale: 1,
  hide: false,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
};

/** Max offset magnitude per axis (head units), scale bounds, rotation bound (deg). */
export const ADJUST_OFFSET_LIMIT = 0.5;
export const ADJUST_SCALE_MIN = 0.25;
export const ADJUST_SCALE_MAX = 3;
export const ADJUST_ROT_LIMIT = 180;

export const ADJUST_SLOTS: { id: AdjustSlot; label: string }[] = [
  { id: "hair", label: "Hair" },
  { id: "facialHair", label: "Facial hair" },
  { id: "ears", label: "Ears" },
  { id: "nose", label: "Nose" },
  { id: "tusks", label: "Tusks" },
  { id: "headgear", label: "Headgear" },
  { id: "hat", label: "Hat" },
  { id: "extra", label: "Extras" },
];

/** The effective adjust for a slot (identity when untouched). */
export function getAdjust(cfg: AvatarConfig, slot: AdjustSlot): PartAdjust {
  return cfg.adjust?.[slot] ?? DEFAULT_ADJUST;
}

export function isDefaultAdjust(a: PartAdjust): boolean {
  return (
    a.x === 0 &&
    a.y === 0 &&
    a.z === 0 &&
    a.scale === 1 &&
    !a.hide &&
    a.rotX === 0 &&
    a.rotY === 0 &&
    a.rotZ === 0
  );
}

/** True when the slot's part is hidden by an adjust. */
export function isHidden(cfg: AvatarConfig, slot: AdjustSlot): boolean {
  return cfg.adjust?.[slot]?.hide === true;
}

/** One buildable cube head. Colours are packed 0xRRGGBB ints. */
export interface AvatarConfig {
  race: RaceId;
  /** Index into the race's skin palette. */
  skin: number;
  hair: HairStyle;
  hairColor: number;
  eyes: EyeStyle;
  eyeColor: number;
  brows: BrowStyle;
  mouth: MouthStyle;
  facialHair: FacialHairStyle;
  facialHairColor: number;
  ears: EarStyle;
  tusks: TuskStyle;
  headgear: HeadgearStyle;
  headgearColor: number;
  /** 3D model hat worn on top of everything (separate from painted headgear). */
  hat: HatId;
  /** Facial expression — overrides eye/brow/mouth painting when not "normal". */
  expression: ExpressionId;
  extra: ExtraStyle;
  extraColor: number;
  /** Optional per-part placement tweaks (offset/scale/hide); absent = stock. */
  adjust?: Partial<Record<AdjustSlot, PartAdjust>>;
}

export interface RaceDef {
  id: RaceId;
  label: string;
  blurb: string;
  /** Skin tone palette (first entry = default). */
  skins: number[];
  defaults: Omit<AvatarConfig, "race" | "skin">;
}

/** Shared colour swatches. */
export const HAIR_COLORS: number[] = [
  0x2e2117, // dark brown
  0x5b3a21, // brown
  0x8a5a2b, // chestnut
  0xc98a3d, // ginger
  0xd9c38c, // blond
  0xe8e4da, // white
  0x8d9296, // grey
  0x1c1e24, // black
  0x7a2e2e, // deep red
  0x3f6d4e, // moss green
  0x4a5f8a, // slate blue
  0x7a4a8a, // violet
];

export const EYE_COLORS: number[] = [
  0x3a2c1c, // brown
  0x2f5d8a, // blue
  0x3f7a4a, // green
  0x8a7a2f, // amber
  0x8a2f2f, // red
  0x9adfff, // ice
  0xd6f56a, // toxic
  0xe8e4da, // pale
];

export const PAINT_COLORS: number[] = [
  0xc23b3b, // war red
  0x3b76c2, // war blue
  0xe0dcd2, // bone white
  0x2b2e35, // soot black
  0x3f8a4f, // wode green
  0xc2903b, // ochre
];

export const GEAR_COLORS: number[] = [
  0x8a2f2f, // crimson cloth
  0x2f5d8a, // lake blue
  0x3f6d4e, // ranger green
  0x6b5a2f, // worn leather
  0xc2a23b, // gold
  0xb8bcc4, // steel
  0x2b2e35, // blackened iron
  0xe8e0cc, // bone
];

export const RACES: RaceDef[] = [
  {
    id: "human",
    label: "Human",
    blurb: "Everyman of the realm",
    skins: [0xd9a066, 0xc68d5c, 0xa9714b, 0x8a5a3b, 0xecc493, 0x6b4429, 0x47301e],
    defaults: {
      hair: "short",
      hairColor: 0x5b3a21,
      eyes: "round",
      eyeColor: 0x2f5d8a,
      brows: "thin",
      mouth: "neutral",
      facialHair: "none",
      facialHairColor: 0x5b3a21,
      ears: "round",
      tusks: "none",
      headgear: "none",
      headgearColor: 0x8a2f2f,
      hat: "none",
      expression: "normal",
      extra: "none",
      extraColor: 0xc23b3b,
    },
  },
  {
    id: "barbarian",
    label: "Barbarian",
    blurb: "Northern raider, all fury",
    skins: [0xcf9060, 0xdba474, 0xb5794e, 0xc27f52],
    defaults: {
      hair: "wild",
      hairColor: 0x8a5a2b,
      eyes: "angry",
      eyeColor: 0x3a2c1c,
      brows: "thick",
      mouth: "frown",
      facialHair: "full",
      facialHairColor: 0x8a5a2b,
      ears: "round",
      tusks: "none",
      headgear: "headband",
      headgearColor: 0x6b5a2f,
      hat: "none",
      expression: "normal",
      extra: "warpaint",
      extraColor: 0x3b76c2,
    },
  },
  {
    id: "orc",
    label: "Orc",
    blurb: "Tusked warband bruiser",
    skins: [
      0x6d8a4a, // war-green (default)
      0x55703a, // deep green
      0x7fa057, // pale green
      0x4a5f33, // moss dark
      0x8a8a4a, // olive
      0xc07a3c, // burnt orange
      0x9c4430, // blood red
      0x767a78, // ash grey
    ],
    defaults: {
      hair: "mohawk",
      hairColor: 0x1c1e24,
      eyes: "narrow",
      eyeColor: 0x8a2f2f,
      brows: "slant",
      mouth: "grim",
      facialHair: "none",
      facialHairColor: 0x1c1e24,
      ears: "pointed",
      tusks: "big",
      headgear: "none",
      headgearColor: 0x2b2e35,
      hat: "none",
      expression: "normal",
      extra: "none",
      extraColor: 0xc23b3b,
    },
  },
  {
    id: "undead",
    label: "Undead",
    blurb: "Freshly risen, lightly rotten",
    skins: [0x9aa88a, 0x8a9a9a, 0xa8a88a, 0x7a8a72, 0xb0b8a8, 0x8f9294, 0xd8dcda],
    defaults: {
      hair: "bald",
      hairColor: 0x8d9296,
      eyes: "hollow",
      eyeColor: 0xd6f56a,
      brows: "none",
      mouth: "grim",
      facialHair: "none",
      facialHairColor: 0x8d9296,
      ears: "none",
      tusks: "none",
      headgear: "none",
      headgearColor: 0xe8e0cc,
      hat: "none",
      expression: "normal",
      extra: "stitches",
      extraColor: 0x2b2e35,
    },
  },
  {
    id: "dwarf",
    label: "Dwarf",
    blurb: "Mountain forge-lord",
    skins: [0xd49a6a, 0xc78a55, 0xb57848, 0xe0ab7d, 0x6b4529, 0x7c7268, 0x33261c],
    defaults: {
      hair: "short",
      hairColor: 0xc98a3d,
      eyes: "round",
      eyeColor: 0x3f7a4a,
      brows: "thick",
      mouth: "neutral",
      facialHair: "braided",
      facialHairColor: 0xc98a3d,
      ears: "round",
      tusks: "none",
      headgear: "none",
      headgearColor: 0xc2a23b,
      hat: "none",
      expression: "normal",
      extra: "none",
      extraColor: 0xc23b3b,
    },
  },
  {
    id: "elf",
    label: "Elf",
    blurb: "Moonlit forest sentinel",
    skins: [0xe8c8a0, 0xdec09a, 0xd8b088, 0xc9b8d8, 0xb8c8b0, 0xaec2dc],
    defaults: {
      hair: "long",
      hairColor: 0xd9c38c,
      eyes: "narrow",
      eyeColor: 0x9adfff,
      brows: "thin",
      mouth: "neutral",
      facialHair: "none",
      facialHairColor: 0xd9c38c,
      ears: "long",
      tusks: "none",
      headgear: "circlet",
      headgearColor: 0xc2a23b,
      hat: "none",
      expression: "normal",
      extra: "none",
      extraColor: 0x3f8a4f,
    },
  },
];

export function raceDef(id: RaceId): RaceDef {
  const def = RACES.find((r) => r.id === id);
  if (!def) throw new Error(`unknown race: ${id}`);
  return def;
}

/**
 * The packed 0xRRGGBB skin tone a config resolves to (race palette + index,
 * clamped). Single source for "what colour is this avatar's skin" so the
 * in-game body can be tinted to match the composed head exactly.
 */
export function skinToneOf(cfg: Pick<AvatarConfig, "race" | "skin">): number {
  const skins = raceDef(cfg.race).skins;
  const i = Math.min(Math.max(0, Math.floor(cfg.skin)), skins.length - 1);
  return skins[i];
}

/** Slot style lists — single source for the composer and the UI chips. */
export const HAIR_STYLES: { id: HairStyle; label: string }[] = [
  { id: "bald", label: "Bald" },
  { id: "short", label: "Short" },
  { id: "long", label: "Long" },
  { id: "smooth", label: "Smooth" },
  { id: "shaggy", label: "Shaggy" },
  { id: "dreads", label: "Dreads" },
  { id: "mohawk", label: "Mohawk" },
  { id: "topknot", label: "Topknot" },
  { id: "wild", label: "Wild" },
];

export const EYE_STYLES: { id: EyeStyle; label: string }[] = [
  { id: "round", label: "Round" },
  { id: "narrow", label: "Narrow" },
  { id: "angry", label: "Angry" },
  { id: "hollow", label: "Hollow" },
  { id: "glow", label: "Glow" },
];

export const BROW_STYLES: { id: BrowStyle; label: string }[] = [
  { id: "none", label: "None" },
  { id: "thin", label: "Thin" },
  { id: "thick", label: "Thick" },
  { id: "slant", label: "Slanted" },
];

export const FACIAL_HAIR_STYLES: { id: FacialHairStyle; label: string }[] = [
  { id: "none", label: "None" },
  { id: "stubble", label: "Stubble" },
  { id: "mustache", label: "Mustache" },
  { id: "sideburns", label: "Sideburns" },
  { id: "goatee", label: "Goatee" },
  { id: "full", label: "Full Beard" },
  { id: "braided", label: "Braided" },
];

export const EAR_STYLES: { id: EarStyle; label: string }[] = [
  { id: "none", label: "None" },
  { id: "round", label: "Round" },
  { id: "pointed", label: "Pointed" },
  { id: "long", label: "Long" },
];

export const TUSK_STYLES: { id: TuskStyle; label: string }[] = [
  { id: "none", label: "None" },
  { id: "small", label: "Small" },
  { id: "big", label: "Big" },
  { id: "curved", label: "Curved Up" },
  { id: "long", label: "Long" },
  { id: "flared", label: "Flared" },
  { id: "twin", label: "Twin" },
  { id: "broken", label: "Broken" },
];

/**
 * Race-gated part availability. Tusks belong to the brutish races only
 * (orc / undead); the swept "long" elf ears are elf-only, and the smaller
 * "pointed" style stays available to elves and orcs.
 */
export function tuskStylesFor(race: RaceId): { id: TuskStyle; label: string }[] {
  return race === "orc" || race === "undead"
    ? TUSK_STYLES
    : TUSK_STYLES.filter((s) => s.id === "none");
}

export function earStylesFor(race: RaceId): { id: EarStyle; label: string }[] {
  return EAR_STYLES.filter((s) => {
    if (s.id === "long") return race === "elf";
    if (s.id === "pointed") return race === "elf" || race === "orc";
    return true;
  });
}

export const EXTRA_STYLES: { id: ExtraStyle; label: string }[] = [
  { id: "none", label: "None" },
  { id: "scar", label: "Scar" },
  { id: "warpaint", label: "Warpaint" },
  { id: "freckles", label: "Freckles" },
  { id: "stitches", label: "Stitches" },
];

export const MOUTH_STYLES: { id: MouthStyle; label: string }[] = [
  { id: "neutral", label: "Neutral" },
  { id: "smile", label: "Smile" },
  { id: "frown", label: "Frown" },
  { id: "grim", label: "Grim" },
];

export const HEADGEAR_STYLES: { id: HeadgearStyle; label: string }[] = [
  { id: "none", label: "None" },
  { id: "headband", label: "Headband" },
  { id: "circlet", label: "Circlet" },
  { id: "horns", label: "Horns" },
];

/**
 * Enclosing hats swallow the 3D parts that would otherwise mesh through
 * them: the hood wraps the top / sides / back (face stays open), and the
 * astronaut helmet fully encloses the head, so anything protruding off the
 * head cube gets hidden. Painted pixels stay — they lie on the head surface
 * inside the hat.
 */
export const HAT_COVERED_SLOTS: Partial<Record<HatId, readonly AdjustSlot[]>> = {
  hood: ["hair", "ears", "headgear"],
  astronaut: ["hair", "ears", "headgear", "nose", "tusks", "facialHair"],
};

/** Slots whose protrusion boxes the current hat swallows (empty when none). */
export function hatCoveredSlots(cfg: AvatarConfig): ReadonlySet<AdjustSlot> {
  if (cfg.hat === "none" || isHidden(cfg, "hat")) return EMPTY_SLOT_SET;
  const covered = HAT_COVERED_SLOTS[cfg.hat];
  return covered ? new Set(covered) : EMPTY_SLOT_SET;
}
const EMPTY_SLOT_SET: ReadonlySet<AdjustSlot> = new Set();

export const HAT_STYLES: { id: HatId; label: string }[] = [
  { id: "none", label: "None" },
  { id: "pirateVoxel", label: "Pirate (voxel)" },
  { id: "pirate", label: "Pirate" },
  { id: "cowboy", label: "Cowboy" },
  { id: "witch", label: "Witch" },
  { id: "tophat", label: "Top Hat" },
  { id: "princess", label: "Princess" },
  { id: "astronaut", label: "Astronaut" },
  { id: "hood", label: "Hood" },
];

export const EXPRESSIONS: { id: ExpressionId; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "happy", label: "Happy" },
  { id: "talking", label: "Talking" },
  { id: "angry", label: "Angry" },
  { id: "sad", label: "Sad" },
  { id: "hurt", label: "Hurt" },
];

/** The race's default head, ready to render. */
export function defaultConfig(race: RaceId): AvatarConfig {
  const def = raceDef(race);
  return { race, skin: 0, ...def.defaults };
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length) % list.length];
}

/**
 * Random head for a race (rng injectable for deterministic tests). Keeps the
 * race's skin palette but rolls every modular slot.
 */
export function randomConfig(race: RaceId, rng: () => number = Math.random): AvatarConfig {
  const def = raceDef(race);
  return {
    race,
    skin: Math.floor(rng() * def.skins.length) % def.skins.length,
    hair: pick(rng, HAIR_STYLES).id,
    hairColor: pick(rng, HAIR_COLORS),
    eyes: pick(rng, EYE_STYLES).id,
    eyeColor: pick(rng, EYE_COLORS),
    brows: pick(rng, BROW_STYLES).id,
    mouth: pick(rng, MOUTH_STYLES).id,
    facialHair: pick(rng, FACIAL_HAIR_STYLES).id,
    facialHairColor: pick(rng, HAIR_COLORS),
    ears: pick(rng, earStylesFor(race)).id,
    tusks:
      race === "orc"
        ? pick(rng, TUSK_STYLES.slice(1)).id // orcs always roll real tusks
        : pick(rng, tuskStylesFor(race)).id,
    headgear: pick(rng, HEADGEAR_STYLES).id,
    headgearColor: pick(rng, GEAR_COLORS),
    // Hats are loud — roll one only half the time so random builds stay varied.
    hat: rng() < 0.5 ? "none" : pick(rng, HAT_STYLES.slice(1)).id,
    expression: pick(rng, EXPRESSIONS).id,
    extra: pick(rng, EXTRA_STYLES).id,
    extraColor: pick(rng, PAINT_COLORS),
  };
}

/** Fully random head: random race AND random build ("surprise me"). */
export function surpriseConfig(rng: () => number = Math.random): AvatarConfig {
  return randomConfig(pick(rng, RACES).id, rng);
}

/** Clamp + validate a raw adjust map; undefined when empty/absent. */
function sanitizeAdjust(raw: unknown): Partial<Record<AdjustSlot, PartAdjust>> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const src = raw as Record<string, unknown>;
  const clampOff = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.min(ADJUST_OFFSET_LIMIT, Math.max(-ADJUST_OFFSET_LIMIT, v))
      : 0;
  const out: Partial<Record<AdjustSlot, PartAdjust>> = {};
  for (const { id } of ADJUST_SLOTS) {
    const entry = src[id];
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Partial<PartAdjust>;
    const clampRot = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v)
        ? Math.min(ADJUST_ROT_LIMIT, Math.max(-ADJUST_ROT_LIMIT, v))
        : 0;
    const a: PartAdjust = {
      x: clampOff(e.x),
      y: clampOff(e.y),
      z: clampOff(e.z),
      scale:
        typeof e.scale === "number" && Number.isFinite(e.scale)
          ? Math.min(ADJUST_SCALE_MAX, Math.max(ADJUST_SCALE_MIN, e.scale))
          : 1,
      hide: e.hide === true,
      rotX: clampRot(e.rotX),
      rotY: clampRot(e.rotY),
      rotZ: clampRot(e.rotZ),
    };
    if (!isDefaultAdjust(a)) out[id] = a;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Parse + validate a persisted config; null when unusable. */
export function sanitizeConfig(raw: unknown): AvatarConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<AvatarConfig>;
  const def = RACES.find((r) => r.id === c.race);
  if (!def) return null;
  const base = defaultConfig(def.id);
  const has = <T>(list: { id: T }[], v: unknown): v is T => list.some((s) => s.id === v);
  const num = (v: unknown, fb: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.min(0xffffff, Math.max(0, Math.floor(v)))
      : fb;
  return {
    race: def.id,
    skin: Math.min(Math.max(0, Math.floor(num(c.skin, 0))), def.skins.length - 1),
    hair: has(HAIR_STYLES, c.hair) ? c.hair : base.hair,
    hairColor: num(c.hairColor, base.hairColor),
    eyes: has(EYE_STYLES, c.eyes) ? c.eyes : base.eyes,
    eyeColor: num(c.eyeColor, base.eyeColor),
    brows: has(BROW_STYLES, c.brows) ? c.brows : base.brows,
    mouth: has(MOUTH_STYLES, c.mouth) ? c.mouth : base.mouth,
    facialHair: has(FACIAL_HAIR_STYLES, c.facialHair) ? c.facialHair : base.facialHair,
    facialHairColor: num(c.facialHairColor, base.facialHairColor),
    ears: has(earStylesFor(def.id), c.ears) ? c.ears : base.ears,
    tusks: has(tuskStylesFor(def.id), c.tusks) ? c.tusks : base.tusks,
    headgear: has(HEADGEAR_STYLES, c.headgear) ? c.headgear : base.headgear,
    headgearColor: num(c.headgearColor, base.headgearColor),
    hat: has(HAT_STYLES, c.hat) ? c.hat : base.hat,
    expression: has(EXPRESSIONS, c.expression) ? c.expression : base.expression,
    extra: has(EXTRA_STYLES, c.extra) ? c.extra : base.extra,
    extraColor: num(c.extraColor, base.extraColor),
    ...(() => {
      const adjust = sanitizeAdjust(c.adjust);
      return adjust ? { adjust } : {};
    })(),
  };
}

// ---------------------------------------------------------------------------
// shareable build codes
// ---------------------------------------------------------------------------

const CODE_PREFIX = "AV1.";

/** Compact, copy-pasteable build code for a config (versioned, validated). */
export function encodeConfig(cfg: AvatarConfig): string {
  // btoa handles ASCII only — the config is plain ASCII JSON, so this is safe
  // (btoa/atob are global in both browsers and Node 16+).
  const b64 = btoa(JSON.stringify(cfg));
  return CODE_PREFIX + b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Parse a build code back to a validated config; null when malformed. */
export function decodeConfig(code: string): AvatarConfig | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith(CODE_PREFIX)) return null;
  try {
    let b64 = trimmed.slice(CODE_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return sanitizeConfig(JSON.parse(atob(b64)));
  } catch {
    return null;
  }
}
