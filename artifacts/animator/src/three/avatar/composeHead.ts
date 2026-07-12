/**
 * Pure cube-head composer: an {@link AvatarConfig} in, pixel faces + 3D
 * protrusion boxes out. No THREE, no DOM — fully deterministic and
 * unit-testable. The stage layer turns the result into canvas textures and
 * box meshes.
 *
 * Face pixel space: 16×16, top-left origin, y down (canvas convention).
 * Protrusion space: head is a unit cube centred at the origin (y up,
 * +z = face front); one pixel = 1/16 world units.
 */
import {
  FACE,
  type Grid,
  hash01,
  hline,
  makeGrid,
  mirror,
  mirrorRect,
  px,
  rect,
  shade,
} from "./pixels";
import { type AdjustSlot, type AvatarConfig, hatCoveredSlots, isHidden, raceDef } from "./catalog";

export type FaceName = "front" | "back" | "left" | "right" | "top" | "bottom";

/**
 * Motion tag for hanging hair/beard volume: renderers wrap the box in a
 * pivot at the anchor and apply wind sway + gravity lean (see hairMotion.ts).
 * Boxes sharing one anchor (segments of a braided lock) swing as one rope.
 */
export interface BoxMotion {
  /** Pivot anchor (head-local) the box swings around — near the roots. */
  ax: number;
  ay: number;
  az: number;
  /** Wind sway amplitude (radians); keep small — this is hair, not a flag. */
  sway: number;
  /** Fraction (0..1) of world-down lean adopted when the head tilts. */
  gravity: number;
  /** Light face-framing hair (fringe/bangs): translucent + faster flutter. */
  light?: boolean;
}

/** Axis-aligned attachment box in head-local units (centre position). */
export interface ProtrusionBox {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: number;
  /**
   * Marks hair volume (crown slabs, curtains, ropes, tufts). Renderers draw
   * these as pixel-textured blocks overlaid with fine instanced strands (see
   * hairStrands.ts) instead of plain plastic boxes.
   */
  hair?: boolean;
  /** Braided volume (dread locks, beard braids): weave texture, no loose strands. */
  braided?: boolean;
  /** Hanging volume that sways in the wind and leans with gravity. */
  motion?: BoxMotion;
  /** Which adjustable part slot owns this box (for offset/scale/hide). */
  slot?: AdjustSlot;
}

export interface ComposedHead {
  faces: Record<FaceName, Grid>;
  protrusions: ProtrusionBox[];
}

const P = 1 / FACE; // one pixel in head units
/** Pixel column/row centre → head-local coordinate (x right, y up). */
const cx = (col: number) => (col + 0.5) * P - 0.5;
const cy = (row: number) => 0.5 - (row + 0.5) * P;

// ---------------------------------------------------------------------------
// base skin
// ---------------------------------------------------------------------------

function paintSkinBase(faces: Record<FaceName, Grid>, cfg: AvatarConfig): void {
  const def = raceDef(cfg.race);
  const skin = def.skins[cfg.skin] ?? def.skins[0];
  const edge = shade(skin, 0.82);
  const soft = shade(skin, 0.92);

  for (const name of Object.keys(faces) as FaceName[]) {
    const g = faces[name];
    const vertical = name !== "top" && name !== "bottom";
    for (let y = 0; y < FACE; y++) {
      // Vertical light gradient: brighter crown, darker jaw — reads as a lit
      // form instead of a flat sticker (skipped on top/bottom caps).
      const grad = vertical ? 1.06 - (y / (FACE - 1)) * 0.14 : 1.0;
      for (let x = 0; x < FACE; x++) {
        // Subtle deterministic mottle so big flats don't read as one flat fill.
        const n = hash01(x, y, name.length * 7 + 13);
        let c = shade(n > 0.86 ? soft : skin, grad);
        if (x === 0 || x === FACE - 1 || y === 0 || y === FACE - 1) c = shade(c, 0.9);
        px(g, x, y, c);
      }
    }
    // corner darkening
    for (const [xx, yy] of [
      [0, 0],
      [FACE - 1, 0],
      [0, FACE - 1],
      [FACE - 1, FACE - 1],
    ])
      px(g, xx, yy, edge);
  }

  const f = faces.front;
  // brow ridge + eye socket shading
  hline(f, 2, 5, 12, soft);
  // temple shading pinches the upper face inward
  mirrorRect(f, 1, 4, 1, 4, shade(skin, 0.88));
  // cheek shading under the eyes
  mirrorRect(f, 2, 9, 3, 1, soft);
  // cheekbone catchlight just below the sockets
  mirrorRect(f, 2, 8, 2, 1, shade(skin, 1.07));
  // jaw shade + chin ambient occlusion
  hline(f, 3, 14, 10, soft);
  hline(f, 5, 15, 6, shade(skin, 0.86));

  // race-flavoured base details
  if (cfg.race === "undead") {
    // rot patches — deterministic scatter of sickly blotches
    const rot = shade(skin, 0.72);
    const rot2 = 0x5f7a52;
    for (let y = 0; y < FACE; y++)
      for (let x = 0; x < FACE; x++) {
        const n = hash01(x, y, 101);
        if (n > 0.93) px(f, x, y, rot);
        else if (n < 0.03) px(f, x, y, rot2);
      }
    // exposed cheekbone
    rect(f, 2, 10, 2, 1, 0xd8d4c4);
  }
  if (cfg.race === "orc") {
    // heavy brow shadow
    hline(f, 2, 5, 12, shade(skin, 0.8));
    hline(f, 2, 4, 12, soft);
  }
  if (cfg.race === "dwarf") {
    // big ruddy nose base + rosy forge-flushed cheeks
    mirrorRect(f, 6, 8, 1, 3, shade(skin, 1.08));
    mirrorRect(f, 2, 10, 3, 2, mix(skin, 0xc0503a, 0.3));
  }
  if (cfg.race === "barbarian") {
    // wind-burned cheekbones + weathered brow nicks from a life outdoors
    mirrorRect(f, 2, 9, 3, 2, mix(skin, 0xb85a3a, 0.22));
    px(f, 3, 3, shade(skin, 0.78));
    px(f, 12, 4, shade(skin, 0.78));
  }
  if (cfg.race === "elf") {
    // luminous high cheekbones + a smooth pale brow ridge — reads ethereal
    mirrorRect(f, 2, 7, 3, 1, shade(skin, 1.14));
    hline(f, 3, 4, 10, shade(skin, 1.06));
  }
}

/** Linear blend of two packed colours (t = weight of `b`). */
function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255,
    ag = (a >> 8) & 255,
    ab = a & 255;
  const br = (b >> 16) & 255,
    bg = (b >> 8) & 255,
    bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}

// ---------------------------------------------------------------------------
// facial features (front face)
// ---------------------------------------------------------------------------

function paintNose(f: Grid, cfg: AvatarConfig): void {
  const def = raceDef(cfg.race);
  const skin = def.skins[cfg.skin] ?? def.skins[0];
  const hi = shade(skin, 1.12);
  const lo = shade(skin, 0.8);
  if (cfg.race === "dwarf") {
    rect(f, 7, 8, 2, 3, hi);
    hline(f, 7, 11, 2, lo);
  } else {
    rect(f, 7, 8, 2, 2, hi);
    hline(f, 7, 10, 2, lo);
  }
}

function paintEyes(f: Grid, cfg: AvatarConfig): void {
  const white = cfg.race === "undead" ? 0xb8b8a8 : 0xf0ede4;
  const pupil = cfg.eyeColor;
  const dark = 0x1a1a20;
  const glint = 0xffffff;
  if (cfg.expression === "hurt") {
    // eyes squeezed shut in a wince: "> <" diagonal slashes, no whites
    mirror(f, 3, 6, dark);
    mirror(f, 4, 7, shade(dark, 1.5));
    mirror(f, 5, 8, dark);
    mirror(f, 3, 8, shade(dark, 2.2)); // scrunch crease under the outer corner
    return;
  }
  // Eye blocks at rows 6-8, mirrored around the centre. Every style gets a
  // dark upper-lid outline + a white glint pixel so the eyes read as alive
  // instead of painted-on.
  switch (cfg.eyes) {
    case "round":
      mirrorRect(f, 3, 6, 3, 2, white);
      mirror(f, 4, 6, pupil);
      mirror(f, 4, 7, shade(pupil, 0.7));
      // upper lid outline
      mirrorRect(f, 3, 5, 3, 1, shade(dark, 1.4));
      // catchlight in the upper-outer corner of the iris
      mirror(f, 3, 6, glint);
      break;
    case "narrow":
      mirrorRect(f, 3, 7, 3, 1, white);
      mirror(f, 4, 7, pupil);
      mirrorRect(f, 3, 6, 3, 1, shade(dark, 1.4));
      mirror(f, 3, 7, glint);
      break;
    case "angry":
      mirrorRect(f, 3, 7, 3, 1, white);
      mirror(f, 4, 7, pupil);
      // inner-top shadow slanting toward the nose
      mirror(f, 5, 6, dark);
      mirror(f, 4, 6, shade(dark, 1.6));
      mirror(f, 3, 7, glint);
      break;
    case "hollow":
      mirrorRect(f, 3, 6, 3, 2, dark);
      mirror(f, 4, 7, pupil); // dim glint deep in the socket
      // sunken rim below the socket
      mirrorRect(f, 3, 8, 3, 1, shade(dark, 2.2));
      break;
    case "glow":
      mirrorRect(f, 3, 6, 3, 2, pupil);
      mirror(f, 4, 6, shade(pupil, 1.45));
      // bloom halo pixels around the glow
      mirror(f, 3, 5, shade(pupil, 0.55));
      mirror(f, 5, 5, shade(pupil, 0.55));
      mirror(f, 3, 8, shade(pupil, 0.55));
      break;
  }
  // expression overlays on top of the chosen style
  if (cfg.expression === "angry") {
    // heavy inner-top shadow slanting toward the nose
    mirror(f, 5, 6, dark);
    mirror(f, 4, 6, shade(dark, 1.6));
  } else if (cfg.expression === "sad") {
    // drooping lower lid + a welling tear under the left eye
    mirrorRect(f, 3, 8, 3, 1, shade(dark, 2.4));
    px(f, 4, 9, 0x9adfff);
    px(f, 4, 10, 0x6fb8e8);
  } else if (cfg.expression === "happy") {
    // lifted lower lid pushes the eyes into a squintier, warmer shape
    mirror(f, 4, 8, shade(white, 0.8));
  }
}

function paintBrows(f: Grid, cfg: AvatarConfig): void {
  if (cfg.brows === "none") return;
  const c = cfg.race === "undead" ? 0x4a4a44 : shade(cfg.hairColor, 0.85);
  // Expressions repose the brows regardless of the picked style (the style
  // still supplies thickness via colour weight below).
  switch (cfg.expression) {
    case "angry":
      // inner ends stab down toward the nose, outer ends ride high
      mirrorRect(f, 5, 5, 2, 1, c);
      mirrorRect(f, 3, 4, 2, 1, c);
      mirror(f, 6, 6, shade(c, 0.8)); // extra inner dip = proper scowl
      return;
    case "sad":
      // the inverse: inner ends lift, outer ends droop
      mirrorRect(f, 5, 4, 2, 1, c);
      mirrorRect(f, 3, 5, 2, 1, c);
      return;
    case "happy":
      // raised a row in a soft arch
      mirrorRect(f, 3, 4, 3, 1, c);
      mirror(f, 5, 3, c);
      return;
    case "hurt":
      // scrunched low and heavy over the wince
      mirrorRect(f, 3, 5, 4, 1, c);
      mirror(f, 6, 6, shade(c, 0.8));
      return;
    default:
      break; // normal / talking fall through to the picked style
  }
  switch (cfg.brows) {
    case "thin":
      mirrorRect(f, 3, 5, 3, 1, c);
      break;
    case "thick":
      mirrorRect(f, 3, 4, 4, 2, c);
      break;
    case "slant":
      mirrorRect(f, 5, 5, 2, 1, c);
      mirrorRect(f, 3, 4, 2, 1, c);
      break;
  }
}

/** Mouth palette shared by the static styles and the talk-loop frames. */
interface MouthPalette {
  x0: number;
  w: number;
  lip: number;
  lipLite: number;
  teeth: number;
  teethDim: number;
  mouthDark: number;
  tongue: number;
  line: number;
  crease: number;
  skin: number;
}

function mouthPalette(cfg: AvatarConfig): MouthPalette {
  const def = raceDef(cfg.race);
  const skin = def.skins[cfg.skin] ?? def.skins[0];
  const teeth = cfg.race === "undead" ? 0xd8d4c4 : 0xf0ede4;
  const wide = cfg.race === "orc"; // wider underbite mouth
  return {
    x0: wide ? 5 : 6,
    w: wide ? 6 : 4,
    lip: shade(skin, 0.62),
    lipLite: shade(skin, 0.78),
    teeth,
    teethDim: shade(teeth, 0.88),
    mouthDark: 0x2a1e1c,
    tongue: 0x9c4f4a,
    line: shade(skin, 0.42),
    crease: shade(skin, 0.72),
    skin,
  };
}

/**
 * Full row of teeth: solid ivory with every other tooth a touch dimmer so
 * the separations read as enamel seams, never as missing teeth.
 */
function toothRow(f: Grid, x: number, y: number, w: number, m: MouthPalette): void {
  for (let i = 0; i < w; i++) px(f, x + i, y, i % 2 ? m.teethDim : m.teeth);
}

/** Frames in the looping talk cycle (closed → parted → wide → mid). */
export const TALK_FRAME_COUNT = 4;

/**
 * One frame of the talking loop. Pure pixel paint over the front face —
 * frame 0 is closed lips, 1 parts them, 2 is wide open (teeth + tongue),
 * 3 half-closes again, so cycling 0→3 reads as continuous speech.
 */
function paintTalkFrame(f: Grid, m: MouthPalette, frame: number): void {
  const { x0, w } = m;
  switch (((frame % TALK_FRAME_COUNT) + TALK_FRAME_COUNT) % TALK_FRAME_COUNT) {
    case 0:
      // lips together between words
      hline(f, x0, 12, w, m.line);
      hline(f, x0, 13, w, m.lipLite);
      break;
    case 1:
      // lips parting: sliver of dark with the top teeth peeking through
      rect(f, x0 + 1, 12, w - 2, 2, m.mouthDark);
      toothRow(f, x0 + 1, 12, w - 2, m);
      px(f, x0, 12, m.lip);
      px(f, x0 + w - 1, 12, m.lip);
      hline(f, x0, 14, w, m.lipLite);
      break;
    case 2:
      // wide open vowel: full dark oval, complete teeth row, tongue below
      rect(f, x0, 11, w, 3, m.mouthDark);
      toothRow(f, x0, 11, w, m);
      rect(f, x0 + 1, 13, w - 2, 1, m.tongue);
      px(f, x0 - 1, 12, m.lip);
      px(f, x0 + w, 12, m.lip);
      hline(f, x0, 14, w, m.lipLite);
      break;
    default:
      // mid-word: tall open oval, teeth just showing at the top
      rect(f, x0 + 1, 11, w - 2, 3, m.mouthDark);
      toothRow(f, x0 + 1, 11, w - 2, m);
      px(f, x0, 12, m.lip);
      px(f, x0 + w - 1, 12, m.lip);
      hline(f, x0 + 1, 14, w - 2, m.lipLite);
      break;
  }
}

function paintMouth(f: Grid, cfg: AvatarConfig, talkFrame?: number): void {
  const m = mouthPalette(cfg);
  const { x0, w } = m;
  // An explicit talk frame owns the mouth outright — in-game speech loops
  // override whatever style/expression the face was saved with.
  if (talkFrame !== undefined) {
    paintTalkFrame(f, m, talkFrame);
    return;
  }
  // Expressions own the mouth outright — they replace the picked style.
  switch (cfg.expression) {
    case "happy": {
      // open grin: dark mouth under a FULL top teeth row, corners hooked up
      rect(f, x0, 12, w, 2, m.mouthDark);
      toothRow(f, x0, 12, w, m);
      px(f, x0 - 1, 11, m.lip);
      px(f, x0 + w, 11, m.lip);
      hline(f, x0, 14, w, m.lipLite);
      return;
    }
    case "talking":
      // static preview = the wide-open frame of the loop; renderers animate
      // the full cycle via composeTalkFrames()
      paintTalkFrame(f, m, 2);
      return;
    case "angry": {
      // snarl: complete clenched-teeth row with corners dragged down
      hline(f, x0, 11, w, m.mouthDark); // shadow above the bite
      toothRow(f, x0, 12, w, m);
      px(f, x0 - 1, 13, m.lip);
      px(f, x0 + w, 13, m.lip);
      hline(f, x0, 13, w, shade(m.skin, 0.7));
      return;
    }
    case "sad": {
      // deep frown: bowed lip with both corners dropping two rows
      hline(f, x0, 12, w, m.lip);
      px(f, x0 - 1, 13, m.lip);
      px(f, x0 + w, 13, m.lip);
      px(f, x0 - 1, 14, shade(m.lip, 0.8));
      px(f, x0 + w, 14, shade(m.lip, 0.8));
      return;
    }
    case "hurt": {
      // pained grimace: wide full clenched-teeth row pulled down at corners
      const gx = Math.max(1, x0 - 1);
      const gw = Math.min(FACE - 2 - gx, w + 2);
      hline(f, gx, 11, gw, m.mouthDark);
      toothRow(f, gx, 12, gw, m);
      px(f, gx - 1, 13, m.lip);
      px(f, gx + gw, 13, m.lip);
      hline(f, gx, 13, gw, shade(m.skin, 0.68));
      return;
    }
    default:
      break; // normal → the picked style below
  }
  // Style lines use a clearly-dark tone (not the soft lip shade) so the four
  // pickable mouths read as different silhouettes even on the small 3D head.
  switch (cfg.mouth) {
    case "neutral":
      // straight resting slit
      hline(f, x0, 12, w, m.line);
      hline(f, x0, 13, w, m.lipLite); // soft lower lip
      break;
    case "smile":
      // upturned bow: both corners hook a full row up, fuller lower lip
      hline(f, x0, 12, w, m.line);
      px(f, x0 - 1, 11, m.line);
      px(f, x0 + w, 11, m.line);
      px(f, x0 - 1, 10, m.crease); // smile dimples above the corners
      px(f, x0 + w, 10, m.crease);
      hline(f, x0, 13, w, m.lipLite);
      break;
    case "frown":
      // downturned bow: corners drop a full row, crease shadows below
      hline(f, x0, 12, w, m.line);
      px(f, x0 - 1, 13, m.line);
      px(f, x0 + w, 13, m.line);
      px(f, x0 - 1, 14, m.crease); // sag creases under the corners
      px(f, x0 + w, 14, m.crease);
      hline(f, x0 + 1, 11, w - 2, shade(m.skin, 0.82)); // sulking upper-lip shadow
      break;
    case "grim": {
      // wide clenched-teeth grit: extends past the normal mouth corners.
      // The bite is a COMPLETE row of teeth (dark line above, jaw shadow
      // below) — never alternating gaps that read as missing teeth.
      const gx = x0 - 1;
      const gw = w + 2;
      hline(f, gx, 11, gw, m.mouthDark);
      toothRow(f, gx, 12, gw, m);
      hline(f, gx, 13, gw, shade(m.skin, 0.7));
      px(f, gx - 1, 12, m.lip);
      px(f, gx + gw, 12, m.lip);
      break;
    }
  }
}

/** Extra face marks owned by the expression (bruise + sweat for "hurt"). */
function paintExpressionMarks(f: Grid, cfg: AvatarConfig): void {
  if (cfg.expression !== "hurt") return;
  const skin = raceDef(cfg.race).skins[cfg.skin] ?? 0xc09070;
  const bruise = 0x6a4a7a;
  // bruised cheekbone under the right eye (viewer's right)
  px(f, 11, 9, bruise);
  px(f, 12, 9, shade(bruise, 0.8));
  px(f, 11, 10, shade(bruise, 1.2));
  px(f, 12, 10, shade(skin, 0.7));
  // sweat drop sliding off the left temple
  px(f, 1, 5, 0x9adfff);
  px(f, 1, 6, 0x6fb8e8);
}

/**
 * Painted ear detail on the side faces — an inner-ear shadow patch so the 3D
 * ear boxes read as ears instead of plain skin tabs.
 */
function paintEars(faces: Record<FaceName, Grid>, cfg: AvatarConfig): void {
  if (cfg.ears === "none") return;
  const skin = raceDef(cfg.race).skins[cfg.skin] ?? 0xc09070;
  const inner = shade(skin, 0.7);
  const rim = shade(skin, 0.88);
  for (const name of ["left", "right"] as const) {
    const g = faces[name];
    rect(g, 6, 6, 3, 3, rim);
    rect(g, 7, 7, 1, 1, inner);
    px(g, 7, 8, shade(inner, 0.85));
  }
}

// ---------------------------------------------------------------------------
// facial hair
// ---------------------------------------------------------------------------

function paintFacialHair(faces: Record<FaceName, Grid>, cfg: AvatarConfig): void {
  if (cfg.facialHair === "none") return;
  const f = faces.front;
  const c = cfg.facialHairColor;
  const dark = shade(c, 0.8);
  const lite = shade(c, 1.15);

  switch (cfg.facialHair) {
    case "stubble": {
      for (let y = 11; y < FACE; y++)
        for (let x = 2; x < FACE - 2; x++) {
          if (y === 11 && (x < 5 || x > 10)) continue;
          if (hash01(x, y, 77) > 0.55) px(f, x, y, dark);
        }
      break;
    }
    case "mustache":
      rect(f, 5, 11, 6, 1, c);
      mirror(f, 4, 11, dark);
      mirror(f, 4, 12, dark);
      break;
    case "goatee":
      rect(f, 6, 13, 4, 3, c);
      rect(f, 7, 13, 2, 3, lite);
      hline(f, 5, 11, 6, dark); // mustache bridge
      break;
    case "sideburns": {
      // burnside strips down the cheeks (front edge) + onto the side faces
      mirrorRect(f, 1, 7, 2, 6, c);
      mirrorRect(f, 2, 9, 1, 4, dark); // inner shadow line
      mirrorRect(f, 1, 12, 2, 1, lite); // lit jaw tip
      rect(faces.left, 12, 7, 4, 7, c);
      rect(faces.right, 0, 7, 4, 7, c);
      break;
    }
    case "full": {
      // The reference look: beard wraps the whole lower face + jaw sides.
      rect(f, 2, 11, 12, 5, c);
      rect(f, 1, 12, 14, 4, c);
      // mouth gap
      hline(f, 6, 12, 4, dark);
      // texture streaks
      for (let y = 11; y < FACE; y++)
        for (let x = 1; x < FACE - 1; x++)
          if (hash01(x, y, 31) > 0.8 && (f[y * FACE + x] === c || f[y * FACE + x] === dark))
            px(f, x, y, y % 2 ? lite : dark);
      // sideburns up the cheeks
      mirrorRect(f, 1, 8, 2, 4, c);
      // jaw wrap onto side + bottom faces
      rect(faces.left, 10, 11, 6, 5, c);
      rect(faces.right, 0, 11, 6, 5, c);
      rect(faces.bottom, 2, 10, 12, 6, c);
      break;
    }
    case "braided": {
      // Dwarf pride: full base + two long braids (rendered as protrusions too)
      rect(f, 2, 11, 12, 5, c);
      rect(f, 1, 12, 14, 4, c);
      hline(f, 6, 12, 4, dark);
      // braid banding on the face bottom
      mirrorRect(f, 4, 13, 2, 1, lite);
      mirrorRect(f, 4, 15, 2, 1, lite);
      mirrorRect(f, 1, 8, 2, 4, c);
      rect(faces.left, 10, 11, 6, 5, c);
      rect(faces.right, 0, 11, 6, 5, c);
      rect(faces.bottom, 2, 10, 12, 6, c);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// hair
// ---------------------------------------------------------------------------

function paintHair(faces: Record<FaceName, Grid>, cfg: AvatarConfig): void {
  if (cfg.hair === "bald") return;
  const c = cfg.hairColor;
  const dark = shade(c, 0.8);
  const lite = shade(c, 1.18);
  const streak = (g: Grid, x0: number, y0: number, w: number, h: number, seed: number) => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const n = hash01(x, y, seed);
        px(g, x, y, n > 0.78 ? lite : n < 0.16 ? dark : c);
      }
  };

  // Side parting groove down the top face — makes the crown read as combed
  // hair instead of a solid painted cap.
  const parting = (col: number) => {
    for (let y = 0; y < FACE; y++)
      if (hash01(col, y, 91) > 0.25) px(faces.top, col, y, dark);
  };

  switch (cfg.hair) {
    case "short":
      streak(faces.top, 0, 0, 16, 16, 3);
      parting(5);
      streak(faces.front, 0, 0, 16, 3, 4);
      // hairline dips at the temples
      mirror(faces.front, 0, 3, c);
      mirror(faces.front, 1, 3, c);
      streak(faces.left, 0, 0, 16, 4, 5);
      streak(faces.right, 0, 0, 16, 4, 6);
      streak(faces.back, 0, 0, 16, 6, 7);
      break;
    case "long":
      streak(faces.top, 0, 0, 16, 16, 8);
      parting(8);
      streak(faces.front, 0, 0, 16, 3, 9);
      mirrorRect(faces.front, 0, 3, 2, 6, c);
      streak(faces.left, 0, 0, 16, 12, 10);
      streak(faces.right, 0, 0, 16, 12, 11);
      streak(faces.back, 0, 0, 16, 16, 12);
      // vertical strand streaks down the back so long hair reads as strands
      for (let x = 1; x < FACE; x += 3)
        for (let y = 4; y < FACE; y++)
          if (hash01(x, y, 93) > 0.35) px(faces.back, x, y, y % 2 ? lite : dark);
      // matching strands down the painted sides (under the 3D curtains)
      for (const [g, seed] of [[faces.left, 94], [faces.right, 95]] as const)
        for (let x = 2; x < FACE - 1; x += 3)
          for (let y = 3; y < 12; y++)
            if (hash01(x, y, seed) > 0.45) px(g, x, y, y % 2 ? dark : lite);
      break;
    case "smooth": {
      // sleek combed-back sheet: near-solid colour, thin sheen lines instead
      // of noise — reads as polished, brushed hair
      rect(faces.top, 0, 0, 16, 16, c);
      for (let y = 0; y < FACE; y++) {
        px(faces.top, 4, y, lite);
        px(faces.top, 11, y, lite);
      }
      // clean straight hairline with swept temple points
      rect(faces.front, 0, 0, 16, 2, c);
      mirrorRect(faces.front, 0, 2, 2, 4, c);
      mirror(faces.front, 2, 2, dark);
      rect(faces.left, 0, 0, 16, 10, c);
      rect(faces.right, 0, 0, 16, 10, c);
      rect(faces.back, 0, 0, 16, 14, c);
      // vertical comb lines down sides + back
      for (const g of [faces.left, faces.right, faces.back])
        for (let x = 2; x < FACE; x += 4) for (let y = 1; y < 13; y++) px(g, x, y, y % 3 ? c : lite);
      break;
    }
    case "shaggy": {
      // unkempt mid-length mop: deep jagged fringe over the brow + ragged
      // uneven bottom edges down the sides and back
      streak(faces.top, 0, 0, 16, 16, 31);
      for (let x = 0; x < FACE; x++) {
        const depth = 3 + Math.floor(hash01(x, 1, 32) * 4);
        for (let y = 0; y < depth; y++) px(faces.front, x, y, hash01(x, y, 33) > 0.75 ? lite : c);
      }
      for (const [g, base, seed] of [
        [faces.left, 10, 34],
        [faces.right, 10, 35],
        [faces.back, 13, 36],
      ] as const) {
        streak(g, 0, 0, 16, base, seed);
        for (let x = 0; x < FACE; x++) {
          const extra = Math.floor(hash01(x, 2, seed + 40) * 3);
          for (let y = base; y < Math.min(FACE, base + extra); y++) px(g, x, y, dark);
        }
      }
      break;
    }
    case "dreads": {
      // sectioned crown: dark parting grid so the top reads as twisted rows;
      // the hanging locks themselves are 3D rope protrusions
      streak(faces.top, 0, 0, 16, 16, 27);
      for (const col of [3, 8, 12])
        for (let y = 0; y < FACE; y++) if (hash01(col, y, 92) > 0.2) px(faces.top, col, y, dark);
      for (const row of [4, 10])
        for (let x = 0; x < FACE; x++) if (hash01(x, row, 96) > 0.3) px(faces.top, x, row, dark);
      streak(faces.front, 0, 0, 16, 2, 28);
      // rows keep going down the sides and back (painted under the ropes)
      for (const [g, h, seed] of [
        [faces.left, 7, 29],
        [faces.right, 7, 30],
        [faces.back, 11, 37],
      ] as const) {
        streak(g, 0, 0, 16, h, seed);
        for (let x = 1; x < FACE; x += 3)
          for (let y = 1; y < h; y++) if (hash01(x, y, seed + 50) > 0.4) px(g, x, y, dark);
      }
      break;
    }
    case "mohawk":
      // shaved sides — strip stays skin; crest is geometry (protrusions)
      streak(faces.top, 6, 0, 4, 16, 13);
      streak(faces.front, 6, 0, 4, 2, 14);
      streak(faces.back, 6, 0, 4, 3, 15);
      break;
    case "topknot":
      streak(faces.top, 0, 0, 16, 16, 16);
      streak(faces.front, 0, 0, 16, 2, 17);
      streak(faces.left, 0, 0, 16, 3, 18);
      streak(faces.right, 0, 0, 16, 3, 19);
      streak(faces.back, 0, 0, 16, 5, 20);
      break;
    case "wild":
      streak(faces.top, 0, 0, 16, 16, 21);
      // jagged fringe
      for (let x = 0; x < FACE; x++) {
        const depth = 2 + Math.floor(hash01(x, 0, 22) * 4);
        for (let y = 0; y < depth; y++) px(faces.front, x, y, hash01(x, y, 23) > 0.7 ? lite : c);
      }
      streak(faces.left, 0, 0, 16, 9, 24);
      streak(faces.right, 0, 0, 16, 9, 25);
      streak(faces.back, 0, 0, 16, 13, 26);
      break;
  }
}

// ---------------------------------------------------------------------------
// extras
// ---------------------------------------------------------------------------

/**
 * Paint the extra decal honouring its placement adjust: the raw decal is
 * painted into a scratch grid, then blitted onto the face translated
 * (x / y offsets in head units → pixels), rotated about the decal centre
 * (rotZ, degrees) and scaled — nearest-neighbour, so it stays pixel-art.
 */
function paintExtraAdjusted(f: Grid, cfg: AvatarConfig): void {
  if (cfg.extra === "none") return;
  const a = cfg.adjust?.extra;
  if (!a || (a.x === 0 && a.y === 0 && a.rotZ === 0 && a.scale === 1)) {
    paintExtra(f, cfg);
    return;
  }
  const scratch: Grid = new Array(FACE * FACE).fill(-1);
  paintExtra(scratch, cfg);
  let minX = FACE, minY = FACE, maxX = -1, maxY = -1;
  for (let y = 0; y < FACE; y++)
    for (let x = 0; x < FACE; x++)
      if (scratch[y * FACE + x] >= 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  if (maxX < 0) return;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rad = (a.rotZ * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ox = a.x * FACE; // head units → pixels
  const oy = -a.y * FACE; // +y is up on screen; grid y grows downward
  for (let y = 0; y < FACE; y++) {
    for (let x = 0; x < FACE; x++) {
      // inverse-map the destination pixel back into the raw decal
      const dx = x - cx - ox;
      const dy = y - cy - oy;
      const sx = (dx * cos + dy * sin) / a.scale + cx;
      const sy = (-dx * sin + dy * cos) / a.scale + cy;
      const ix = Math.round(sx);
      const iy = Math.round(sy);
      if (ix < 0 || iy < 0 || ix >= FACE || iy >= FACE) continue;
      const c = scratch[iy * FACE + ix];
      if (c >= 0) px(f, x, y, c);
    }
  }
}

function paintExtra(f: Grid, cfg: AvatarConfig): void {
  if (cfg.extra === "none") return;
  switch (cfg.extra) {
    case "scar": {
      const c = shade(raceDef(cfg.race).skins[cfg.skin] ?? 0xc09070, 0.6);
      // diagonal slash over the right eye (viewer's left)
      px(f, 2, 4, c);
      px(f, 3, 5, c);
      px(f, 3, 6, c);
      px(f, 4, 8, c);
      px(f, 4, 9, c);
      px(f, 5, 10, c);
      break;
    }
    case "warpaint": {
      const c = cfg.extraColor;
      // twin stripes under each eye + one across the brow
      mirrorRect(f, 3, 9, 3, 1, c);
      mirrorRect(f, 3, 10, 2, 1, shade(c, 0.8));
      hline(f, 1, 3, 14, shade(c, 0.9));
      break;
    }
    case "freckles": {
      const c = shade(raceDef(cfg.race).skins[cfg.skin] ?? 0xc09070, 0.72);
      for (let y = 8; y < 11; y++)
        for (let x = 2; x < FACE - 2; x++)
          if (hash01(x, y, 55) > 0.82) px(f, x, y, c);
      break;
    }
    case "stitches": {
      const c = cfg.extraColor;
      // stitched seam across the forehead and one on the cheek
      hline(f, 3, 2, 9, c);
      for (let x = 4; x < 12; x += 2) px(f, x, 1, c);
      for (let x = 4; x < 12; x += 2) px(f, x, 3, c);
      px(f, 11, 9, c);
      px(f, 12, 10, c);
      px(f, 11, 11, c);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// headgear (painted band; horns are protrusions)
// ---------------------------------------------------------------------------

function paintHeadgear(faces: Record<FaceName, Grid>, cfg: AvatarConfig): void {
  if (cfg.headgear === "none" || cfg.headgear === "horns") return;
  const c = cfg.headgearColor;
  const dark = shade(c, 0.78);
  const lite = shade(c, 1.25);
  if (cfg.headgear === "headband") {
    // 2px cloth band wrapping all four vertical faces above the brows
    for (const name of ["front", "back", "left", "right"] as const) {
      const g = faces[name];
      rect(g, 0, 3, 16, 2, c);
      // woven texture flecks
      for (let x = 0; x < FACE; x++) if (hash01(x, 3, 61) > 0.7) px(g, x, 3, dark);
    }
    // knot trails on the back
    rect(faces.back, 9, 5, 2, 3, c);
    rect(faces.back, 9, 5, 1, 3, dark);
  } else {
    // circlet: 1px metal band with a centre gem on the front
    for (const name of ["front", "back", "left", "right"] as const) {
      const g = faces[name];
      hline(g, 0, 3, 16, c);
      for (let x = 1; x < FACE; x += 4) px(g, x, 3, lite); // polished glints
    }
    px(faces.front, 7, 3, 0x66e0ff);
    px(faces.front, 8, 3, 0x9adfff);
  }
}

// ---------------------------------------------------------------------------
// protrusions (ears / tusks / nose / hair geometry / braids / horns)
// ---------------------------------------------------------------------------

function buildProtrusions(cfg: AvatarConfig): ProtrusionBox[] {
  const out: ProtrusionBox[] = [];
  const def = raceDef(cfg.race);
  const skin = def.skins[cfg.skin] ?? def.skins[0];
  const skinDark = shade(skin, 0.85);

  // --- ears (both sides, x = ±0.5 faces) — shaped per race ---
  const earY = cy(7); // eye level
  const earStart = out.length;
  if (cfg.ears !== "none") {
    // dwarves grow big ears, barbarians slightly oversized; undead flesh rots
    const es = cfg.race === "dwarf" ? 1.35 : cfg.race === "barbarian" ? 1.15 : cfg.race === "undead" ? 0.85 : 1;
    const earSkin = cfg.race === "undead" ? shade(skin, 0.78) : skin;
    const earDark = cfg.race === "undead" ? shade(skinDark, 0.72) : skinDark;
    if (cfg.ears === "round") {
      for (const s of [-1, 1]) {
        out.push({ x: s * (0.5 + 0.03 * es), y: earY, z: 0, w: 0.06 * es, h: 3 * es * P, d: 2.4 * es * P, color: earDark });
        if (cfg.race === "dwarf")
          // fleshy lobe under the big ear
          out.push({ x: s * (0.5 + 0.025), y: earY - 2.2 * P, z: 0.3 * P, w: 0.05, h: 1.4 * P, d: 1.6 * P, color: earSkin });
      }
      if (cfg.race === "barbarian")
        // battle-notched left ear: a chunk bitten out of the top
        out.push({ x: -(0.5 + 0.035), y: earY + 1.6 * P, z: -0.4 * P, w: 0.065, h: 0.9 * P, d: 1 * P, color: shade(skin, 0.5) });
    } else if (cfg.ears === "pointed") {
      if (cfg.race === "orc") {
        // orc fins: wide bat-like ears raking up and back
        for (const s of [-1, 1]) {
          out.push({ x: s * (0.5 + 0.04), y: earY, z: -0.04, w: 0.08, h: 3.2 * P, d: 3 * P, color: earDark });
          out.push({ x: s * (0.5 + 0.05), y: earY + 2.6 * P, z: -0.1, w: 0.06, h: 2 * P, d: 2 * P, color: earSkin });
          out.push({ x: s * (0.5 + 0.055), y: earY + 4.6 * P, z: -0.16, w: 0.045, h: 1.5 * P, d: 1.3 * P, color: earSkin });
        }
      } else {
        for (const s of [-1, 1]) {
          out.push({ x: s * (0.5 + 0.035 * es), y: earY, z: -0.02, w: 0.07 * es, h: 3 * es * P, d: 2.6 * es * P, color: earDark });
          out.push({ x: s * (0.5 + 0.035 * es), y: earY + 2.2 * es * P, z: -0.06, w: 0.05 * es, h: 1.6 * es * P, d: 1.4 * es * P, color: earSkin });
        }
        if (cfg.race === "undead")
          // the right ear tip has rotted off — replace it with a ragged stub
          out.push({ x: 0.5 + 0.03, y: earY + 1.8 * P, z: -0.05, w: 0.04, h: 0.8 * P, d: 0.9 * P, color: 0x5f7a52 });
      }
    } else if (cfg.ears === "long") {
      for (const s of [-1, 1]) {
        out.push({ x: s * (0.5 + 0.03 * es), y: earY, z: -0.03, w: 0.06 * es, h: 2.6 * es * P, d: 3 * es * P, color: earDark });
        out.push({ x: s * (0.5 + 0.05 * es), y: earY + 2 * es * P, z: -0.1, w: 0.05 * es, h: 1.8 * es * P, d: 2.2 * es * P, color: earSkin });
        // undead long ears end ragged — the swept tip is torn off
        if (cfg.race !== "undead")
          out.push({ x: s * (0.5 + 0.06 * es), y: earY + 4 * es * P, z: -0.17, w: 0.04 * es, h: 1.4 * es * P, d: 1.6 * es * P, color: earSkin });
      }
      if (cfg.race === "undead")
        out.push({ x: -(0.5 + 0.055), y: earY + 3.6 * P, z: -0.14, w: 0.035, h: 1 * P, d: 1.1 * P, color: 0x5f7a52 });
      if (cfg.race === "elf")
        // extra swept tip: elves' long ears rake further up and back
        for (const s of [-1, 1])
          out.push({ x: s * (0.5 + 0.065), y: earY + 5.4 * P, z: -0.24, w: 0.032, h: 1.1 * P, d: 1.2 * P, color: shade(skin, 1.05) });
    }
  }

  for (let i = earStart; i < out.length; i++) out[i].slot = "ears";

  // --- nose (a real 3D wedge off the front face — the profile silhouette) ---
  const noseStart = out.length;
  {
    const noseY = cy(9);
    const hi = shade(skin, 1.05);
    if (cfg.race === "dwarf") {
      // big ruddy bulb
      out.push({ x: 0, y: noseY - 0.4 * P, z: 0.5 + 0.035, w: 3 * P, h: 3.2 * P, d: 0.08, color: shade(skin, 1.1) });
    } else if (cfg.race === "orc") {
      // broad flat snout
      out.push({ x: 0, y: noseY, z: 0.5 + 0.022, w: 3.4 * P, h: 2.2 * P, d: 0.05, color: skinDark });
    } else if (cfg.race === "elf") {
      // slim delicate ridge
      out.push({ x: 0, y: noseY + 0.4 * P, z: 0.5 + 0.02, w: 1.4 * P, h: 2.6 * P, d: 0.045, color: hi });
    } else if (cfg.race === "undead") {
      // mostly rotted away — just a small stub
      out.push({ x: 0, y: noseY, z: 0.5 + 0.014, w: 1.6 * P, h: 1.4 * P, d: 0.032, color: skinDark });
    } else {
      // human / barbarian standard wedge
      out.push({ x: 0, y: noseY, z: 0.5 + 0.026, w: 2 * P, h: 2.6 * P, d: 0.06, color: hi });
    }
  }

  for (let i = noseStart; i < out.length; i++) out[i].slot = "nose";

  // --- horns headgear (curved twin spikes off the upper skull) ---
  const gearStart = out.length;
  if (cfg.headgear === "horns") {
    const c = cfg.headgearColor;
    for (const s of [-1, 1]) {
      out.push({ x: s * 0.42, y: 0.42, z: 0.05, w: 2.4 * P, h: 2.4 * P, d: 2.8 * P, color: shade(c, 0.85) });
      out.push({ x: s * 0.5, y: 0.52, z: 0.02, w: 2 * P, h: 2.6 * P, d: 2.2 * P, color: c });
      out.push({ x: s * 0.54, y: 0.62, z: 0.06, w: 1.4 * P, h: 2.2 * P, d: 1.6 * P, color: shade(c, 1.2) });
    }
  }

  for (let i = gearStart; i < out.length; i++) out[i].slot = "headgear";

  // --- tusks (rise from the mouth corners on the front face) ---
  const tuskStart = out.length;
  if (cfg.tusks !== "none") {
    const ivory = 0xe8e0cc;
    const lite = shade(ivory, 1.06);
    const worn = shade(ivory, 0.86);
    const zF = 0.5 + 0.028; // just proud of the front face
    // Base of every tusk sits at the mouth corners (pixel col 11, row 12).
    const baseY = (h: number) => cy(12) + h / 2 - P * 0.4;
    /** One straight tusk (base box + optional brighter tip above). */
    const straight = (s: number, h: number, w: number, xPix = 11, tip = false) => {
      const y = baseY(h);
      out.push({ x: s * cx(xPix), y, z: zF, w, h, d: 0.055, color: ivory });
      if (tip)
        out.push({ x: s * cx(xPix), y: y + h / 2 + 0.6 * P, z: 0.5 + 0.02, w: w * 0.66, h: 1.2 * P, d: 0.04, color: lite });
    };
    /** A full big tusk on side `s` (shared by "big" and "broken"). */
    const bigTusk = (s: number) => straight(s, 3.4 * P, 1.6 * P, 11, true);
    switch (cfg.tusks) {
      case "small":
        for (const s of [-1, 1]) straight(s, 2.2 * P, 1.2 * P);
        break;
      case "big":
        for (const s of [-1, 1]) bigTusk(s);
        break;
      case "curved": {
        // hook: thick base, mid segment stepping up + out, bright tip curling higher
        for (const s of [-1, 1]) {
          const h = 2.4 * P;
          const y = baseY(h);
          out.push({ x: s * cx(11), y, z: zF, w: 1.6 * P, h, d: 0.055, color: ivory });
          out.push({ x: s * (cx(11) + 0.7 * P), y: y + h / 2 + 0.6 * P, z: zF, w: 1.3 * P, h: 1.7 * P, d: 0.05, color: ivory });
          out.push({ x: s * (cx(11) + 1.3 * P), y: y + h / 2 + 2.0 * P, z: 0.5 + 0.022, w: P, h: 1.8 * P, d: 0.045, color: lite });
        }
        break;
      }
      case "long": {
        // boar jut: segments march forward off the face, tilting up at the tip
        for (const s of [-1, 1]) {
          const h = 2.6 * P;
          const y = baseY(h);
          out.push({ x: s * cx(11), y, z: 0.5 + 0.045, w: 1.6 * P, h, d: 0.09, color: ivory });
          out.push({ x: s * cx(11), y: y + 0.8 * P, z: 0.5 + 0.11, w: 1.3 * P, h: 1.6 * P, d: 0.09, color: ivory });
          out.push({ x: s * cx(11), y: y + 1.8 * P, z: 0.5 + 0.165, w: P, h: 1.3 * P, d: 0.07, color: lite });
        }
        break;
      }
      case "flared": {
        // splay: each segment steps further sideways past the cheek
        for (const s of [-1, 1]) {
          const h = 2.4 * P;
          const y = baseY(h);
          out.push({ x: s * cx(11), y, z: zF, w: 1.5 * P, h, d: 0.055, color: ivory });
          out.push({ x: s * (cx(11) + 1.1 * P), y: y + h / 2 + 0.3 * P, z: zF, w: 1.2 * P, h: 1.8 * P, d: 0.05, color: ivory });
          out.push({ x: s * (cx(11) + 2.1 * P), y: y + h / 2 + 1.4 * P, z: 0.5 + 0.022, w: P, h: 1.5 * P, d: 0.045, color: lite });
        }
        break;
      }
      case "twin":
        // double pair: big hooks at the corners + short inner fangs
        for (const s of [-1, 1]) {
          straight(s, 3.0 * P, 1.4 * P, 11, true);
          straight(s, 1.8 * P, P, 9);
        }
        break;
      case "broken":
        // battle-worn: left tusk intact, right snapped to a chipped stub
        bigTusk(-1);
        out.push({ x: cx(11), y: baseY(1.5 * P), z: zF, w: 1.6 * P, h: 1.5 * P, d: 0.05, color: worn });
        break;
    }
  }

  for (let i = tuskStart; i < out.length; i++) out[i].slot = "tusks";

  // --- hair geometry ---
  // Every box pushed from here until the beard section is hair volume; they
  // are tagged `hair: true` in one sweep after the section (see below).
  const hairStart = out.length;
  const hc = cfg.hairColor;
  const hcDark = shade(hc, 0.82);
  const hcLite = shade(hc, 1.15);
  // A hat covers the crown — suppress hair volume that would clip through it.
  const hatted = cfg.hat !== "none";
  if (!hatted && cfg.hair !== "bald" && cfg.hair !== "mohawk") {
    // Stepped crown dome: stacked shrinking layers approximate a curved
    // scalp instead of one flat square slab — the silhouette picks up real
    // angles and a rounded profile from every side.
    const big = cfg.hair === "wild";
    const layers: { w: number; d: number; h: number; lift: number; tone: number }[] = big
      ? [
          { w: 1.12, d: 1.12, h: 1.1 * P, lift: 0.55 * P, tone: 0.94 },
          { w: 1.0, d: 1.02, h: 1.0 * P, lift: 1.55 * P, tone: 1.0 },
          { w: 0.78, d: 0.84, h: 0.9 * P, lift: 2.5 * P, tone: 1.1 },
        ]
      : [
          { w: 1.06, d: 1.06, h: 0.8 * P, lift: 0.4 * P, tone: 0.92 },
          { w: 0.98, d: 1.0, h: 0.75 * P, lift: 1.15 * P, tone: 1.0 },
          { w: 0.86, d: 0.9, h: 0.7 * P, lift: 1.85 * P, tone: 1.06 },
          { w: 0.62, d: 0.7, h: 0.6 * P, lift: 2.45 * P, tone: 1.14 },
        ];
    for (const l of layers)
      out.push({
        x: 0,
        y: 0.5 + l.lift,
        // upper layers drift back a touch — a swept, combed-over curve
        z: -0.015 - l.lift * 0.6,
        w: l.w,
        h: l.h,
        d: l.d,
        color: shade(hc, l.tone),
      });
    if (cfg.hair === "short" || cfg.hair === "long" || cfg.hair === "smooth")
      // light fringe over the brow — flutters and leans with the head
      out.push({
        x: 0,
        y: cy(0.6),
        z: 0.5 + 0.018,
        w: 0.9,
        h: 1.6 * P,
        d: 0.045,
        color: hcDark,
        motion: { ax: 0, ay: cy(0.6) + 0.8 * P, az: 0.5 + 0.018, sway: 0.07, gravity: 0.3, light: true },
      });
    if (cfg.hair === "shaggy")
      // ragged double fringe: two offset overhangs at slightly different depths
      for (const [dx, dz, w] of [
        [-0.12, 0.02, 0.6],
        [0.16, 0.032, 0.5],
      ] as const)
        out.push({
          x: dx,
          y: cy(0.8),
          z: 0.5 + dz,
          w,
          h: 2 * P,
          d: 0.04,
          color: dx < 0 ? hcDark : hc,
          motion: { ax: dx, ay: cy(0.8) + P, az: 0.5 + dz, sway: 0.09, gravity: 0.3, light: true },
        });
  }
  if (cfg.hair === "long") {
    // side curtains framing the face + a full back sheet — long hair reads
    // as a 3D mane, not painted sides
    for (const s of [-1, 1]) {
      const curtain = { ax: s * (0.5 + 0.022), ay: 0.46, az: -0.06, sway: 0.045, gravity: 0.5 };
      out.push({ x: s * (0.5 + 0.022), y: 0.06, z: -0.06, w: 0.045, h: 0.8, d: 0.82, color: s < 0 ? hc : hcDark, motion: curtain });
      out.push({ x: s * (0.5 + 0.04), y: -0.18, z: -0.16, w: 0.035, h: 0.42, d: 0.5, color: hcLite, motion: { ...curtain, ax: s * (0.5 + 0.04), ay: 0.03, az: -0.16, sway: 0.06 } });
    }
    const backSheet = { ax: 0, ay: 0.45, az: -0.5 - 0.028, sway: 0.035, gravity: 0.5 };
    out.push({ x: 0, y: -0.02, z: -0.5 - 0.028, w: 0.96, h: 0.94, d: 0.055, color: hc, motion: backSheet });
    out.push({ x: 0.18, y: -0.1, z: -0.5 - 0.05, w: 0.22, h: 0.7, d: 0.03, color: hcDark, motion: { ...backSheet, az: -0.5 - 0.05, sway: 0.05 } });
    out.push({ x: -0.2, y: -0.16, z: -0.5 - 0.05, w: 0.18, h: 0.6, d: 0.03, color: hcLite, motion: { ...backSheet, az: -0.5 - 0.05, sway: 0.055 } });
  }
  if (cfg.hair === "mohawk" && !hatted) {
    // crest of blocks running back over the crown
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const height = (2.4 + Math.sin(t * Math.PI) * 2.2) * P;
      out.push({
        x: 0,
        y: 0.5 + height / 2 - 0.005,
        z: 0.36 - t * 0.78,
        w: 3.4 * P,
        h: height,
        d: 2.4 * P,
        color: i % 2 ? hc : shade(hc, 1.15),
      });
    }
  } else if (cfg.hair === "topknot" && !hatted) {
    out.push({ x: 0, y: 0.5 + 1.2 * P, z: -0.12, w: 3 * P, h: 2.4 * P, d: 3 * P, color: hc });
    out.push({ x: 0, y: 0.5 + 3.2 * P, z: -0.12, w: 2 * P, h: 2 * P, d: 2 * P, color: shade(hc, 1.15) });
  } else if (cfg.hair === "wild" && !hatted) {
    // unruly tufts poking off the crown
    const tufts: [number, number, number][] = [
      [-0.3, 0.2, 0.25],
      [0.28, 0.3, -0.05],
      [-0.1, 0.42, -0.3],
      [0.12, 0.16, 0.38],
      [0.36, 0.1, 0.3],
      [-0.36, 0.34, -0.18],
    ];
    tufts.forEach(([x, dy, z], i) =>
      out.push({ x, y: 0.5 + dy * 0.28, z, w: 2 * P, h: (1.6 + (i % 3)) * P, d: 2 * P, color: i % 2 ? hc : shade(hc, 0.85) }),
    );
  } else if (cfg.hair === "long") {
    // hair falls past the jawline behind the head; swings from the nape
    const fall = { ax: 0, ay: -0.4, az: -0.5 + 2.4 * P, sway: 0.05, gravity: 0.6 };
    out.push({ x: 0, y: -0.5 - 1.4 * P, z: -0.5 + 2.4 * P, w: 0.92, h: 3 * P, d: 4.6 * P, color: hc, motion: fall });
    out.push({ x: 0, y: -0.5 - 3.6 * P, z: -0.5 + 2 * P, w: 0.7, h: 2 * P, d: 3.6 * P, color: shade(hc, 0.85), motion: fall });
  }
  if (cfg.hair === "smooth") {
    // combed-back sheet hugging the back of the skull, tapering to the nape —
    // hangs below any hat brim so it intentionally survives `hatted`
    out.push({ x: 0, y: 0.08, z: -0.5 - 0.025, w: 0.94, h: 0.72, d: 0.05, color: hc });
    out.push({ x: 0, y: -0.32, z: -0.5 - 0.02, w: 0.68, h: 0.24, d: 0.04, color: hcDark });
    // slicked side panels above the ears
    for (const s of [-1, 1])
      out.push({ x: s * (0.5 + 0.016), y: 0.24, z: -0.08, w: 0.032, h: 0.4, d: 0.7, color: s < 0 ? hc : hcDark });
  }
  if (cfg.hair === "dreads") {
    // Tight braided locks hanging from the crown edge around the sides +
    // back. Each lock is a stack of short tapering segments with an
    // alternating weave offset (the braid), capped by a darker tie bead. All
    // segments of one lock share a motion anchor at the roots so the whole
    // braid swings as a rigid rope (wind + gravity — see hairMotion.ts).
    // They fall below any hat rim, so they are NOT gated on `hatted`.
    const lock = (x: number, z: number, len: number, i: number) => {
      const body = i % 3 === 0 ? hcLite : i % 2 ? hc : hcDark;
      const side = Math.abs(x) > 0.45; // side locks weave in z, back locks in x
      const motion = { ax: x, ay: 0.42, az: z, sway: 0.05 + (i % 3) * 0.012, gravity: 0.65 };
      const segs = Math.max(4, Math.round(len / (1.5 * P)));
      const segH = len / segs;
      for (let s = 0; s < segs; s++) {
        const t = s / Math.max(1, segs - 1);
        const weave = (s % 2 ? 1 : -1) * 0.28 * P * (1 - t * 0.4);
        const w = 1.35 * P * (1 - t * 0.3); // tight: thinner than the old ropes
        out.push({
          x: x + (side ? 0 : weave),
          y: 0.42 - segH * (s + 0.5),
          z: z + (side ? weave : 0),
          w,
          h: segH * 1.08, // slight overlap so the weave has no gaps
          d: w,
          color: s % 2 ? shade(body, 0.86) : body, // braid banding
          braided: true,
          motion,
        });
      }
      // tie bead + darker tip
      out.push({ x, y: 0.42 - len - 0.4 * P, z, w: 1.15 * P, h: 0.8 * P, d: 1.15 * P, color: shade(hc, 1.25), braided: true, motion });
      out.push({ x, y: 0.42 - len - 1.5 * P, z, w: 0.95 * P, h: 1.5 * P, d: 0.95 * P, color: shade(hc, 0.6), braided: true, motion });
    };
    // back row — tighter packing (7 locks instead of 5)
    [-0.39, -0.26, -0.13, 0, 0.13, 0.26, 0.39].forEach((x, i) =>
      lock(x, -0.5 - 0.03, 0.6 + (i % 3) * 0.11, i),
    );
    // side locks (framing the face + behind the ears)
    for (const s of [-1, 1]) {
      lock(s * (0.5 + 0.03), 0.26, 0.68, s < 0 ? 1 : 2);
      lock(s * (0.5 + 0.03), 0.02, 0.8, s < 0 ? 3 : 4);
      lock(s * (0.5 + 0.03), -0.22, 0.88, s < 0 ? 5 : 0);
      lock(s * (0.5 + 0.03), -0.42, 0.56, s < 0 ? 2 : 3);
    }
  }
  if (cfg.hair === "shaggy") {
    if (!hatted) {
      // messy crown tufts jutting past the slab edges (covered by a hat)
      const tufts: [number, number, number, number][] = [
        [-0.42, 0.06, 0.18, 2.2],
        [0.44, 0.1, -0.1, 1.8],
        [-0.2, 0.14, -0.42, 2.6],
        [0.3, 0.04, 0.4, 2],
      ];
      tufts.forEach(([x, dy, z, h], i) =>
        out.push({ x, y: 0.5 + dy, z, w: 2.2 * P, h: h * P, d: 2.2 * P, color: i % 2 ? hc : hcDark }),
      );
    }
    // uneven side + nape locks below the hat line (always present) — loose
    // shaggy locks catch the wind more than combed styles
    for (const s of [-1, 1]) {
      out.push({ x: s * (0.5 + 0.02), y: 0.1, z: -0.1, w: 0.04, h: 0.5, d: 0.6, color: s < 0 ? hc : hcDark, motion: { ax: s * (0.5 + 0.02), ay: 0.35, az: -0.1, sway: 0.06, gravity: 0.45 } });
      out.push({ x: s * (0.5 + 0.03), y: -0.14, z: -0.22, w: 0.03, h: 0.26, d: 0.34, color: hcLite, motion: { ax: s * (0.5 + 0.03), ay: -0.01, az: -0.22, sway: 0.08, gravity: 0.5 } });
    }
    out.push({ x: 0.06, y: -0.06, z: -0.5 - 0.03, w: 0.8, h: 0.62, d: 0.05, color: hc, motion: { ax: 0.06, ay: 0.25, az: -0.5 - 0.03, sway: 0.045, gravity: 0.45 } });
    out.push({ x: -0.18, y: -0.3, z: -0.5 - 0.025, w: 0.3, h: 0.22, d: 0.04, color: hcDark, motion: { ax: -0.18, ay: -0.19, az: -0.5 - 0.025, sway: 0.07, gravity: 0.5 } });
    out.push({ x: 0.22, y: -0.34, z: -0.5 - 0.025, w: 0.26, h: 0.18, d: 0.04, color: hcLite, motion: { ax: 0.22, ay: -0.25, az: -0.5 - 0.025, sway: 0.075, gravity: 0.5 } });
  }
  for (let i = hairStart; i < out.length; i++) {
    out[i].hair = true;
    out[i].slot = "hair";
  }

  // --- braided beard hangs below the chin ---
  const beardStart = out.length;
  if (cfg.facialHair === "braided") {
    const bc = cfg.facialHairColor;
    // twin chin braids: tight woven segments swinging from the jaw, capped
    // by a bright tie bead (dwarf pride, now with real weave + gravity)
    for (const s of [-1, 1]) {
      const bx = s * cx(11);
      const motion = { ax: bx, ay: -0.5, az: 0.5 - 1.6 * P, sway: 0.055, gravity: 0.6 };
      const len = 5.6 * P;
      const segs = 4;
      const segH = len / segs;
      for (let i = 0; i < segs; i++) {
        const t = i / (segs - 1);
        const weave = (i % 2 ? 1 : -1) * 0.3 * P * (1 - t * 0.35);
        const w = 1.6 * P * (1 - t * 0.25);
        out.push({
          x: bx + weave,
          y: -0.5 - segH * (i + 0.5),
          z: 0.5 - 1.6 * P,
          w,
          h: segH * 1.08,
          d: w,
          color: i % 2 ? shade(bc, 0.85) : bc,
          braided: true,
          motion,
        });
      }
      out.push({ x: bx, y: -0.5 - len - 0.5 * P, z: 0.5 - 1.6 * P, w: 1.3 * P, h: P, d: 1.3 * P, color: shade(bc, 1.3), braided: true, motion });
    }
    out.push({ x: 0, y: -0.5 - 1.2 * P, z: 0.5 - 1.6 * P, w: 3 * P, h: 2.4 * P, d: 1.8 * P, color: shade(bc, 0.85), motion: { ax: 0, ay: -0.5, az: 0.5 - 1.6 * P, sway: 0.03, gravity: 0.4 } });
  }
  if (cfg.facialHair === "full") {
    // beard bulk drops slightly below the chin line; heavy, so it barely
    // sways but still leans with gravity when the head tilts
    const bc = cfg.facialHairColor;
    out.push({ x: 0, y: -0.5 - 1 * P, z: 0.5 - 2.6 * P, w: 0.8, h: 2 * P, d: 5 * P, color: bc, motion: { ax: 0, ay: -0.5, az: 0.5 - 2.6 * P, sway: 0.02, gravity: 0.35 } });
  }
  if (cfg.facialHair === "sideburns") {
    // slim burnside plates hugging the jaw sides (front half), flaring into
    // a slightly darker chop below the cheekbone — short, so barely any sway
    const bc = cfg.facialHairColor;
    for (const s of [-1, 1]) {
      const x = s * (0.5 + 0.02);
      const motion = { ax: x, ay: 0.16, az: 0.32, sway: 0.015, gravity: 0.25 };
      out.push({ x, y: -0.04, z: 0.32, w: 0.045, h: 0.4, d: 0.22, color: bc, motion });
      out.push({ x, y: -0.3, z: 0.34, w: 0.05, h: 0.14, d: 0.26, color: shade(bc, 0.85), motion });
    }
  }
  for (let i = beardStart; i < out.length; i++) out[i].slot = "facialHair";

  const adjusted = applyAdjustments(out, cfg);
  // Enclosing hats (hood / astronaut helmet) swallow parts that would mesh
  // through them — cull AFTER adjustments so even moved/scaled parts can't
  // poke out of the helmet.
  const covered = hatCoveredSlots(cfg);
  return covered.size
    ? adjusted.filter((b) => !b.slot || !covered.has(b.slot))
    : adjusted;
}

/**
 * Apply per-slot placement tweaks to the freshly built boxes: hidden slots
 * are removed; the rest are scaled about the slot group's bounding-box
 * centre, then offset. Mutates + filters the just-created array (safe: boxes
 * are never shared).
 */
function applyAdjustments(out: ProtrusionBox[], cfg: AvatarConfig): ProtrusionBox[] {
  const adjust = cfg.adjust;
  if (!adjust) return out;
  let boxes = out;
  for (const key of Object.keys(adjust) as AdjustSlot[]) {
    const a = adjust[key];
    if (!a) continue;
    if (a.hide) {
      boxes = boxes.filter((b) => b.slot !== key);
      continue;
    }
    const group = boxes.filter((b) => b.slot === key);
    if (!group.length) continue;
    // bounding-box centre of the whole part, so multi-box parts scale coherently
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const b of group) {
      minX = Math.min(minX, b.x - b.w / 2);
      maxX = Math.max(maxX, b.x + b.w / 2);
      minY = Math.min(minY, b.y - b.h / 2);
      maxY = Math.max(maxY, b.y + b.h / 2);
      minZ = Math.min(minZ, b.z - b.d / 2);
      maxZ = Math.max(maxZ, b.z + b.d / 2);
    }
    const cX = (minX + maxX) / 2;
    const cY = (minY + maxY) / 2;
    const cZ = (minZ + maxZ) / 2;
    for (const b of group) {
      b.x = cX + (b.x - cX) * a.scale + a.x;
      b.y = cY + (b.y - cY) * a.scale + a.y;
      b.z = cZ + (b.z - cZ) * a.scale + a.z;
      b.w *= a.scale;
      b.h *= a.scale;
      b.d *= a.scale;
      // Motion pivots must ride with the part or swings detach from the mesh.
      if (b.motion)
        b.motion = {
          ...b.motion,
          ax: cX + (b.motion.ax - cX) * a.scale + a.x,
          ay: cY + (b.motion.ay - cY) * a.scale + a.y,
          az: cZ + (b.motion.az - cZ) * a.scale + a.z,
        };
    }
  }
  return boxes;
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/** Optional per-compose overrides (used by the talking loop). */
export interface ComposeOptions {
  /** When set, the mouth paints this frame of the talk cycle instead of the
   * configured style/expression. */
  talkFrame?: number;
}

/**
 * The front-face grids of the full talking loop, in cycle order. Pure —
 * renderers compose these once and flip the front CanvasTexture between
 * them (~8 fps) while a character is speaking.
 */
export function composeTalkFrames(cfg: AvatarConfig): Grid[] {
  const frames: Grid[] = [];
  for (let i = 0; i < TALK_FRAME_COUNT; i++)
    frames.push(composeHead(cfg, { talkFrame: i }).faces.front);
  return frames;
}

/** Compose the full head. Pure + deterministic for a given config. */
export function composeHead(cfg: AvatarConfig, opts?: ComposeOptions): ComposedHead {
  const faces: Record<FaceName, Grid> = {
    front: makeGrid(0),
    back: makeGrid(0),
    left: makeGrid(0),
    right: makeGrid(0),
    top: makeGrid(0),
    bottom: makeGrid(0),
  };

  paintSkinBase(faces, cfg);
  if (!isHidden(cfg, "ears")) paintEars(faces, cfg); // before hair so long hair can fall over the ears
  if (!isHidden(cfg, "nose")) paintNose(faces.front, cfg);
  paintEyes(faces.front, cfg);
  paintBrows(faces.front, cfg);
  paintMouth(faces.front, cfg, opts?.talkFrame);
  if (!isHidden(cfg, "extra")) paintExtraAdjusted(faces.front, cfg);
  paintExpressionMarks(faces.front, cfg); // bruise/sweat sit over extras
  if (!isHidden(cfg, "facialHair")) paintFacialHair(faces, cfg);
  if (!isHidden(cfg, "hair")) paintHair(faces, cfg);
  if (!isHidden(cfg, "headgear")) paintHeadgear(faces, cfg); // last: bands sit over hair

  return { faces, protrusions: buildProtrusions(cfg) };
}
