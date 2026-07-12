/**
 * Data-driven Danger Room environment presets. Each preset fully describes the
 * look of the training chamber — floor, walls, grid, pillars, lighting accents
 * and a deliberate prop layout — so {@link DangerRoom} can build (and rebuild)
 * itself from one of these without any hardcoded per-preset branching, and the
 * enemy-roster systems can drop encounters into any preset unchanged.
 *
 * The structural shell (enclosing walls with the door + DJ-alcove window,
 * ceiling and corner pillars) is present in EVERY preset so the dungeon door and
 * the resident DJ booth keep working no matter which environment is selected;
 * presets only re-skin materials/colours, swap the lighting mood, and place
 * their own decorative props.
 */

export type RoomPresetId = "holo" | "foundry" | "colosseum";

/** A single point-light accent baked into the room (themes the lighting mood). */
export interface AccentLight {
  color: number;
  intensity: number;
  /** World position [x, y, z]. */
  pos: [number, number, number];
  distance: number;
}

/**
 * Optional per-environment atmosphere: the scene fog (colour + near/far) and an
 * optional separate background tint. When omitted a preset falls back to the
 * Danger Room's dark baseline. The dungeon keeps its own dark tone regardless.
 */
export interface RoomAtmosphere {
  /** Fog colour (hex). Also the background tint unless {@link background} is set. */
  color: number;
  /** Fog near distance (m) — where the haze starts. */
  near: number;
  /** Fog far distance (m) — where everything fades out. */
  far: number;
  /** Optional separate scene background tint (hex); defaults to {@link color}. */
  background?: number;
}

/**
 * Optional per-environment ambient-sound character shaping the generated noise
 * bed (see `CombatSfx`). Lower cutoffs read darker/rumblier, higher airier;
 * gain multiplies the default bed level; drift is the slow stereo-pan rate (Hz).
 * Omitted fields fall back to the bed's default profile.
 */
export interface RoomAmbience {
  /** Lowpass cutoff (Hz) of the bed — lower = darker rumble, higher = airy hiss. */
  cutoff: number;
  /** Bed level multiplier on top of the default ambient base (1 = default). */
  gain: number;
  /** Stereo drift rate (Hz) of the slow pan (0 = still). */
  drift?: number;
}

/** A decorative prop placed deliberately within a preset (built procedurally). */
export interface PropSpec {
  kind: "crate" | "barrel" | "column" | "banner" | "girder" | "pylon";
  x: number;
  z: number;
  /** Stack height in metres (for crate/barrel) or bar length (girder); default per-kind. */
  height?: number;
  rotY?: number;
  scale?: number;
  color?: number;
  /** Accent/emissive colour (pylon glow, banner trim). */
  glow?: number;
  /** When true the prop contributes a push-out collision circle. */
  collide?: boolean;
}

export interface RoomPreset {
  id: RoomPresetId;
  name: string;
  /** One-line blurb shown in the picker. */
  blurb: string;

  // ── Floor ────────────────────────────────────────────────────────────────
  floorColor: number;
  floorMetalness: number;
  floorRoughness: number;
  /** Wireframe hologrid tiles slightly above the floor (the sci-fi look). */
  showTiles: boolean;
  tileColor: number;

  // ── Grid helper ──────────────────────────────────────────────────────────
  /** 0 hides the grid entirely. */
  gridOpacity: number;
  gridColor1: number;
  gridColor2: number;

  // ── Walls / ceiling ──────────────────────────────────────────────────────
  wallColor: number;
  showSeams: boolean;
  seamColor: number;
  ceilColor: number;

  // ── Pillars ──────────────────────────────────────────────────────────────
  pillarColor: number;
  pillarGlowColor: number;

  // ── Lighting mood ────────────────────────────────────────────────────────
  accents: AccentLight[];

  // ── Atmosphere (optional) ─────────────────────────────────────────────────
  /** Scene fog + background tint; falls back to the dark baseline when omitted. */
  atmosphere?: RoomAtmosphere;
  /** Ambient sound-bed character; falls back to the default profile when omitted. */
  ambience?: RoomAmbience;

  // ── Props ────────────────────────────────────────────────────────────────
  props: PropSpec[];
}

/** Corner anchor (just inside the walls) used to tuck props out of the fight. */
const C = 13;

export const ROOM_PRESETS: Record<RoomPresetId, RoomPreset> = {
  // ── Holo Grid (default) — the classic X-Men holographic chamber ───────────
  holo: {
    id: "holo",
    name: "Holo Grid",
    blurb: "Classic holographic training chamber — dark panels, glowing blue grid.",
    floorColor: 0x0c1018,
    floorMetalness: 0.7,
    floorRoughness: 0.45,
    showTiles: true,
    tileColor: 0x18406b,
    gridOpacity: 0.5,
    gridColor1: 0x3aa0ff,
    gridColor2: 0x14304d,
    wallColor: 0x10151e,
    showSeams: true,
    seamColor: 0x2a78d0,
    ceilColor: 0x0a0d14,
    pillarColor: 0x1a2230,
    pillarGlowColor: 0x4fc3ff,
    accents: [
      { color: 0x2a78d0, intensity: 2.0, pos: [0, 6, -10], distance: 40 },
      { color: 0x3aa0ff, intensity: 1.4, pos: [-10, 5, 6], distance: 36 },
      { color: 0x3aa0ff, intensity: 1.4, pos: [10, 5, 6], distance: 36 },
    ],
    // Cool, deep-space dark with a faint blue cast; an airy electronic hum.
    atmosphere: { color: 0x05070c, near: 22, far: 46, background: 0x060912 },
    ambience: { cutoff: 520, gain: 1.0, drift: 0.05 },
    props: [
      { kind: "pylon", x: -C, z: -C, glow: 0x4fc3ff, collide: true },
      { kind: "pylon", x: C, z: -C, glow: 0x4fc3ff, collide: true },
      { kind: "pylon", x: -C, z: C, glow: 0x4fc3ff, collide: true },
      { kind: "pylon", x: C, z: C, glow: 0x4fc3ff, collide: true },
    ],
  },

  // ── Foundry — an industrial / derelict variant ────────────────────────────
  foundry: {
    id: "foundry",
    name: "Foundry",
    blurb: "Derelict industrial bay — rusted steel, crates, barrels and girders.",
    floorColor: 0x1a1714,
    floorMetalness: 0.5,
    floorRoughness: 0.8,
    showTiles: false,
    tileColor: 0x000000,
    gridOpacity: 0,
    gridColor1: 0x000000,
    gridColor2: 0x000000,
    wallColor: 0x23201c,
    showSeams: true,
    seamColor: 0xd97a22,
    ceilColor: 0x16130f,
    pillarColor: 0x2b2620,
    pillarGlowColor: 0xff8a3d,
    accents: [
      { color: 0xff8a3d, intensity: 2.2, pos: [0, 7, -8], distance: 34 },
      { color: 0xffb24d, intensity: 1.2, pos: [-11, 4, 8], distance: 26 },
      { color: 0xff6a1e, intensity: 1.0, pos: [11, 3, -10], distance: 24 },
    ],
    // Warm, smoky haze that closes in; a low industrial rumble underneath.
    atmosphere: { color: 0x140d08, near: 16, far: 38, background: 0x180f09 },
    ambience: { cutoff: 220, gain: 1.5, drift: 0.03 },
    props: [
      { kind: "crate", x: -C, z: C, color: 0x6b5236, height: 1.0, collide: true },
      { kind: "crate", x: -C + 1.5, z: C - 0.4, color: 0x5a4630, height: 0.8, rotY: 0.4, collide: true },
      { kind: "crate", x: -C, z: C - 1.7, color: 0x6b5236, height: 0.8, collide: true },
      { kind: "crate", x: C, z: C, color: 0x5a4630, height: 1.2, collide: true },
      { kind: "barrel", x: C, z: -C, color: 0x7a3320, collide: true },
      { kind: "barrel", x: C - 1.3, z: -C + 0.4, color: 0x5e6b2f, collide: true },
      { kind: "barrel", x: C - 0.5, z: -C - 1.2, color: 0x7a3320, collide: true },
      { kind: "barrel", x: -C, z: -C, color: 0x5e6b2f, collide: true },
      { kind: "girder", x: 0, z: -14.5, height: 18, rotY: 0, color: 0x33302a },
      { kind: "girder", x: -14.5, z: 0, height: 18, rotY: Math.PI / 2, color: 0x33302a },
    ],
  },

  // ── Colosseum — a stone arena variant ─────────────────────────────────────
  colosseum: {
    id: "colosseum",
    name: "Colosseum",
    blurb: "Sand-floored stone arena ringed with columns and hanging banners.",
    floorColor: 0xb39a6e,
    floorMetalness: 0.0,
    floorRoughness: 1.0,
    showTiles: false,
    tileColor: 0x000000,
    gridOpacity: 0,
    gridColor1: 0x000000,
    gridColor2: 0x000000,
    wallColor: 0x6b6253,
    showSeams: false,
    seamColor: 0x000000,
    ceilColor: 0x3a342b,
    pillarColor: 0xa89878,
    pillarGlowColor: 0xffcf8a,
    accents: [
      { color: 0xffd9a0, intensity: 2.4, pos: [0, 8, 0], distance: 44 },
      { color: 0xffb24d, intensity: 1.6, pos: [-11, 4, -11], distance: 24 },
      { color: 0xffb24d, intensity: 1.6, pos: [11, 4, -11], distance: 24 },
      { color: 0xffb24d, intensity: 1.6, pos: [-11, 4, 11], distance: 24 },
    ],
    // Open, sunlit dust haze that hangs far back; airy outdoor wind on the bed.
    atmosphere: { color: 0x3a2f1d, near: 30, far: 64, background: 0x5a4a30 },
    ambience: { cutoff: 760, gain: 0.75, drift: 0.08 },
    props: [
      { kind: "column", x: -C, z: -C, color: 0xc9b894, glow: 0xffcf8a, collide: true },
      { kind: "column", x: C, z: -C, color: 0xc9b894, glow: 0xffcf8a, collide: true },
      { kind: "column", x: -C, z: C, color: 0xc9b894, glow: 0xffcf8a, collide: true },
      { kind: "column", x: C, z: C, color: 0xc9b894, glow: 0xffcf8a, collide: true },
      { kind: "column", x: 0, z: -C - 0.5, color: 0xc9b894, glow: 0xffcf8a, collide: true },
      { kind: "banner", x: -8, z: -15.6, color: 0x8a2b2b },
      { kind: "banner", x: 8, z: -15.6, color: 0x2b4d8a },
      { kind: "banner", x: -15.6, z: 0, rotY: Math.PI / 2, color: 0x2b8a4d },
      { kind: "banner", x: 15.6, z: 0, rotY: -Math.PI / 2, color: 0x8a7a2b },
    ],
  },
};

export const ROOM_PRESET_LIST: RoomPreset[] = [
  ROOM_PRESETS.holo,
  ROOM_PRESETS.foundry,
  ROOM_PRESETS.colosseum,
];

const STORAGE_KEY = "dangerroom:preset";

/** Narrow an arbitrary string to a known preset id (or null when unknown). */
export function asRoomPresetId(v: string | null | undefined): RoomPresetId | null {
  return v === "holo" || v === "foundry" || v === "colosseum" ? v : null;
}

/** Read the session-persisted preset choice (defaults to the holo grid). */
export function loadRoomPreset(): RoomPresetId {
  try {
    return asRoomPresetId(sessionStorage.getItem(STORAGE_KEY)) ?? "holo";
  } catch {
    return "holo";
  }
}

/** Persist the preset choice for the current browser session. */
export function saveRoomPreset(id: RoomPresetId): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* no-op */
  }
}

/**
 * Full-scene battle-art backdrops for the Danger Room. Independent of the room
 * preset (which owns the 3D props/fog): a backdrop swaps `scene.background` to a
 * painted battle scene. `null` restores the preset's plain colour background.
 */
export interface Backdrop {
  id: string;
  name: string;
  /** Path relative to BASE_URL (no leading slash). */
  file: string;
}

export const BACKDROPS: Backdrop[] = [
  { id: "clash", name: "Clash of Legions", file: "backdrops/battle-1.webp" },
  { id: "siege", name: "The Siege", file: "backdrops/battle-2.webp" },
  { id: "warfront", name: "Warfront", file: "backdrops/battle-3.webp" },
];

const BACKDROP_KEY = "dangerroom:backdrop";

/** Narrow an arbitrary string to a known backdrop id (or null when unknown). */
export function asBackdropId(v: string | null | undefined): string | null {
  return BACKDROPS.some((b) => b.id === v) ? (v as string) : null;
}

/** Read the session-persisted backdrop choice (null = plain preset background). */
export function loadBackdrop(): string | null {
  try {
    return asBackdropId(sessionStorage.getItem(BACKDROP_KEY));
  } catch {
    return null;
  }
}

/** Persist (or clear, with null) the backdrop choice for this browser session. */
export function saveBackdrop(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(BACKDROP_KEY, id);
    else sessionStorage.removeItem(BACKDROP_KEY);
  } catch {
    /* no-op */
  }
}
