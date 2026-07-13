import { describe, expect, it } from "vitest";
import { TALK_FRAME_COUNT, composeHead, composeTalkFrames } from "./composeHead";
import {
  ADJUST_OFFSET_LIMIT,
  ADJUST_ROT_LIMIT,
  ADJUST_SCALE_MAX,
  DEFAULT_ADJUST,
  RACES,
  decodeConfig,
  defaultConfig,
  earStylesFor,
  encodeConfig,
  randomConfig,
  sanitizeConfig,
  skinToneOf,
  surpriseConfig,
  tuskStylesFor,
  type AvatarConfig,
} from "./catalog";
import { FACE } from "./pixels";

const FACE_NAMES = ["front", "back", "left", "right", "top", "bottom"] as const;

describe("composeHead", () => {
  it("produces six fully-opaque 16x16 faces for every race default", () => {
    for (const race of RACES) {
      const head = composeHead(defaultConfig(race.id));
      for (const name of FACE_NAMES) {
        const g = head.faces[name];
        expect(g).toHaveLength(FACE * FACE);
        for (const c of g) {
          expect(Number.isInteger(c)).toBe(true);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(0xffffff);
        }
      }
    }
  });

  it("is deterministic: identical config composes an identical head", () => {
    const a = composeHead(defaultConfig("barbarian"));
    const b = composeHead(defaultConfig("barbarian"));
    expect(a).toEqual(b);
  });

  it("changing the skin tone changes the base pixels", () => {
    const base = defaultConfig("human");
    const a = composeHead(base);
    const b = composeHead({ ...base, skin: 3 });
    expect(a.faces.back).not.toEqual(b.faces.back);
  });

  it("orc default grows tusk protrusions on the face front", () => {
    const head = composeHead(defaultConfig("orc"));
    const tusks = head.protrusions.filter((p) => p.z > 0.5);
    expect(tusks.length).toBeGreaterThanOrEqual(2);
    // mirrored pair
    expect(tusks.some((p) => p.x < 0)).toBe(true);
    expect(tusks.some((p) => p.x > 0)).toBe(true);
  });

  it("elf long ears extend past both side faces", () => {
    const head = composeHead(defaultConfig("elf"));
    const left = head.protrusions.filter((p) => p.x < -0.5);
    const right = head.protrusions.filter((p) => p.x > 0.5);
    expect(left.length).toBeGreaterThanOrEqual(2);
    expect(right.length).toBeGreaterThanOrEqual(2);
  });

  it("undead default has no ear protrusions", () => {
    const head = composeHead(defaultConfig("undead"));
    expect(head.protrusions.filter((p) => Math.abs(p.x) > 0.5)).toHaveLength(0);
  });

  it("dwarf braided beard hangs boxes below the chin", () => {
    const head = composeHead(defaultConfig("dwarf"));
    expect(head.protrusions.filter((p) => p.y < -0.5).length).toBeGreaterThanOrEqual(2);
  });

  it("hair paints the front hairline for painted styles and skips it for bald", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), extra: "none" };
    const bald = composeHead({ ...base, hair: "bald" });
    const short = composeHead({ ...base, hair: "short" });
    expect(bald.faces.front.slice(0, FACE)).not.toEqual(short.faces.front.slice(0, FACE));
    // bald top face equals a no-hair compose (skin only)
    const bald2 = composeHead({ ...base, hair: "bald" });
    expect(bald.faces.top).toEqual(bald2.faces.top);
  });

  it("mohawk crest rises above the crown", () => {
    const head = composeHead({ ...defaultConfig("orc"), hair: "mohawk" });
    expect(head.protrusions.filter((p) => p.y > 0.5).length).toBeGreaterThanOrEqual(4);
  });

  it("every race grows a nose protrusion off the front face", () => {
    for (const race of RACES) {
      const head = composeHead(defaultConfig(race.id));
      const noses = head.protrusions.filter((p) => p.x === 0 && p.z > 0.5);
      expect(noses.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("mouth styles change the front face", () => {
    const base = defaultConfig("human");
    const smile = composeHead({ ...base, mouth: "smile" });
    const frown = composeHead({ ...base, mouth: "frown" });
    expect(smile.faces.front).not.toEqual(frown.faces.front);
  });

  it("all four mouth styles are pairwise distinct (normal expression)", () => {
    for (const race of ["human", "orc"] as const) {
      const base: AvatarConfig = {
        ...defaultConfig(race),
        expression: "normal",
        facialHair: "none",
      };
      const seen = new Map<string, string>();
      for (const mouth of ["neutral", "smile", "frown", "grim"] as const) {
        const key = composeHead({ ...base, mouth }).faces.front.join(",");
        expect(seen.has(key), `${race}: ${mouth} matches ${seen.get(key)}`).toBe(false);
        seen.set(key, mouth);
      }
    }
  });

  it("every expression paints a distinct front face", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), extra: "none" };
    const seen = new Map<string, string>();
    for (const expression of ["normal", "happy", "talking", "angry", "sad", "hurt"] as const) {
      const head = composeHead({ ...base, expression });
      const key = head.faces.front.join(",");
      for (const [other, otherKey] of seen) {
        expect(key, `${expression} should differ from ${other}`).not.toBe(otherKey);
      }
      seen.set(expression, key);
    }
  });

  it("hurt expression adds bruise/sweat marks and composes for every race", () => {
    for (const race of RACES) {
      const cfg: AvatarConfig = { ...defaultConfig(race.id), expression: "hurt" };
      expect(() => composeHead(cfg)).not.toThrow();
      const normal = composeHead({ ...cfg, expression: "normal" });
      expect(composeHead(cfg).faces.front).not.toEqual(normal.faces.front);
    }
  });

  it("race flavours the same ear style differently (dwarf vs human round)", () => {
    const human = composeHead({ ...defaultConfig("human"), ears: "round" });
    const dwarf = composeHead({ ...defaultConfig("dwarf"), ears: "round" });
    const earBoxes = (h: ReturnType<typeof composeHead>) =>
      h.protrusions.filter((p) => Math.abs(p.x) > 0.5);
    const humanEars = earBoxes(human);
    const dwarfEars = earBoxes(dwarf);
    expect(dwarfEars.length).toBeGreaterThanOrEqual(humanEars.length);
    const maxH = (b: typeof humanEars) => Math.max(...b.map((p) => p.h));
    expect(maxH(dwarfEars)).toBeGreaterThan(maxH(humanEars));
  });

  it("orc pointed ears fan out wider than a human's", () => {
    const orc = composeHead({ ...defaultConfig("orc"), ears: "pointed" });
    const human = composeHead({ ...defaultConfig("human"), ears: "pointed" });
    const count = (h: ReturnType<typeof composeHead>) =>
      h.protrusions.filter((p) => Math.abs(p.x) > 0.5).length;
    expect(count(orc)).toBeGreaterThan(count(human));
  });

  it("painted ear patch appears on side faces when ears are visible", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), hair: "bald" };
    const withEars = composeHead({ ...base, ears: "round" });
    const noEars = composeHead({ ...base, ears: "none" });
    expect(withEars.faces.left).not.toEqual(noEars.faces.left);
    expect(withEars.faces.right).not.toEqual(noEars.faces.right);
  });

  it("long hair grows 3D curtains and a back sheet", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), ears: "none" };
    const short = composeHead({ ...base, hair: "short" });
    const long = composeHead({ ...base, hair: "long" });
    // side curtains hang past the side faces
    expect(long.protrusions.filter((p) => Math.abs(p.x) > 0.5).length).toBeGreaterThanOrEqual(4);
    // back sheet hangs behind the head
    expect(long.protrusions.filter((p) => p.z < -0.5).length).toBeGreaterThanOrEqual(1);
    expect(long.protrusions.length).toBeGreaterThan(short.protrusions.length);
  });

  it("non-bald hair grows a 3D crown slab that a hat suppresses", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), ears: "none", headgear: "none" };
    const crown = (cfg: AvatarConfig) =>
      composeHead(cfg).protrusions.filter((p) => p.y > 0.5 && p.w > 1).length;
    expect(crown({ ...base, hair: "short" })).toBeGreaterThanOrEqual(1);
    expect(crown({ ...base, hair: "bald" })).toBe(0);
    expect(crown({ ...base, hair: "short", hat: "cowboy" })).toBe(0);
  });

  it("hats also suppress mohawk crest and topknot bun", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), ears: "none", headgear: "none" };
    const above = (cfg: AvatarConfig) =>
      composeHead(cfg).protrusions.filter((p) => p.y > 0.5).length;
    expect(above({ ...base, hair: "mohawk" })).toBeGreaterThanOrEqual(4);
    expect(above({ ...base, hair: "mohawk", hat: "pirate" })).toBe(0);
    expect(above({ ...base, hair: "topknot" })).toBeGreaterThanOrEqual(2);
    expect(above({ ...base, hair: "topknot", hat: "pirate" })).toBe(0);
  });

  it("a hat suppresses only crown volume — long-hair curtains and back sheet survive", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), ears: "none", headgear: "none" };
    const hatted = composeHead({ ...base, hair: "long", hat: "cowboy" });
    // no crown volume poking through the hat
    expect(hatted.protrusions.filter((p) => p.y > 0.5).length).toBe(0);
    // side curtains still frame the face (thin mirrored slabs at |x| > 0.5)
    expect(hatted.protrusions.some((p) => p.x > 0.5)).toBe(true);
    expect(hatted.protrusions.some((p) => p.x < -0.5)).toBe(true);
    // back sheet + below-jaw fall still present behind/below the head
    expect(hatted.protrusions.some((p) => p.z < -0.5)).toBe(true);
    expect(hatted.protrusions.some((p) => p.y < -0.5)).toBe(true);
  });

  it("smooth, shaggy and dreads each paint a distinct head", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), ears: "none", extra: "none" };
    const seen = new Map<string, string>();
    for (const hair of ["short", "long", "smooth", "shaggy", "dreads", "wild"] as const) {
      const head = composeHead({ ...base, hair });
      const key =
        head.faces.top.join(",") + "|" + head.faces.back.join(",") + "|" + head.faces.front.join(",");
      for (const [other, otherKey] of seen) {
        expect(key, `${hair} should differ from ${other}`).not.toBe(otherKey);
      }
      seen.set(hair, key);
    }
  });

  it("dreads grow hanging rope locks on the sides and back", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), ears: "none", headgear: "none" };
    const head = composeHead({ ...base, hair: "dreads" });
    // back-row ropes behind the head
    expect(head.protrusions.filter((p) => p.z < -0.5).length).toBeGreaterThanOrEqual(5);
    // mirrored side ropes framing the face
    expect(head.protrusions.filter((p) => p.x > 0.5).length).toBeGreaterThanOrEqual(3);
    expect(head.protrusions.filter((p) => p.x < -0.5).length).toBeGreaterThanOrEqual(3);
    // ropes hang low (below the jawline)
    expect(head.protrusions.some((p) => p.y - p.h / 2 < -0.4)).toBe(true);
  });

  it("dread locks are tight braided segments swinging from shared anchors", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), ears: "none", headgear: "none" };
    const head = composeHead({ ...base, hair: "dreads" });
    const braided = head.protrusions.filter((p) => p.braided);
    // every braided box is tagged for motion
    expect(braided.length).toBeGreaterThanOrEqual(30);
    expect(braided.every((p) => p.motion)).toBe(true);
    // segments of one lock share a motion anchor → far fewer anchors than boxes
    const anchors = new Set(braided.map((p) => `${p.motion!.ax},${p.motion!.az}`));
    expect(anchors.size).toBeGreaterThanOrEqual(10); // many locks…
    expect(anchors.size).toBeLessThan(braided.length / 2); // …each multi-segment
    // tight: braid segments stay slim
    for (const p of braided) expect(Math.max(p.w, p.d)).toBeLessThan(0.12);
  });

  it("crown hair is a stepped dome (stacked layers shrinking upward)", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), ears: "none", headgear: "none" };
    const crown = composeHead({ ...base, hair: "short" }).protrusions.filter(
      (p) => p.y > 0.5 && p.slot === "hair" && p.w > 0.5,
    );
    expect(crown.length).toBeGreaterThanOrEqual(3);
    const sorted = [...crown].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].w).toBeLessThan(sorted[i - 1].w);
      // upper layers drift back — a curved, swept silhouette
      expect(sorted[i].z).toBeLessThanOrEqual(sorted[i - 1].z);
    }
  });

  it("fringe boxes are light + moving; long hair curtains and falls move too", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), ears: "none", headgear: "none" };
    const short = composeHead({ ...base, hair: "short" });
    const fringe = short.protrusions.filter((p) => p.motion?.light);
    expect(fringe.length).toBeGreaterThanOrEqual(1);
    for (const f of fringe) expect(f.z).toBeGreaterThan(0.5); // over the brow
    const long = composeHead({ ...base, hair: "long" });
    // side curtains, back sheet and the below-jaw fall all sway
    expect(long.protrusions.some((p) => p.x > 0.5 && p.motion)).toBe(true);
    expect(long.protrusions.some((p) => p.z < -0.5 && p.motion)).toBe(true);
    expect(long.protrusions.some((p) => p.y < -0.5 && p.motion)).toBe(true);
  });

  it("beards move: braided beard is woven, full beard leans with gravity", () => {
    const dwarf = composeHead(defaultConfig("dwarf"));
    const beard = dwarf.protrusions.filter((p) => p.slot === "facialHair");
    expect(beard.some((p) => p.braided)).toBe(true);
    expect(beard.every((p) => p.motion)).toBe(true);
    const full = composeHead({ ...defaultConfig("human"), facialHair: "full" });
    const bulk = full.protrusions.filter((p) => p.slot === "facialHair");
    expect(bulk.length).toBeGreaterThanOrEqual(1);
    expect(bulk.every((p) => p.motion && p.motion.gravity > 0)).toBe(true);
  });

  it("sideburns paint the cheeks and add jaw-side facialHair boxes", () => {
    const head = composeHead({ ...defaultConfig("human"), facialHair: "sideburns" });
    const burns = head.protrusions.filter((p) => p.slot === "facialHair");
    // two plates per side (main strip + darker chop)
    expect(burns.length).toBe(4);
    // mirrored left/right, hugging the head sides
    expect(burns.some((p) => p.x > 0.5)).toBe(true);
    expect(burns.some((p) => p.x < -0.5)).toBe(true);
    // short and tight: minimal sway, some gravity lean
    expect(burns.every((p) => p.motion && p.motion.sway <= 0.02)).toBe(true);
    // never tagged as scalp hair (renderers key beard treatment off slot)
    expect(burns.every((p) => !p.hair)).toBe(true);
  });

  it("part adjustments carry motion anchors along with the boxes", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), ears: "none", headgear: "none" };
    const plain = composeHead({ ...base, hair: "dreads" });
    const moved = composeHead({
      ...base,
      hair: "dreads",
      adjust: { hair: { x: 0.1, y: -0.2, z: 0, scale: 1, rotY: 0, rotZ: 0 } },
    });
    const a = plain.protrusions.find((p) => p.motion && p.braided)!;
    const b = moved.protrusions.find((p) => p.motion && p.braided)!;
    expect(b.motion!.ax).toBeCloseTo(a.motion!.ax + 0.1, 9);
    expect(b.motion!.ay).toBeCloseTo(a.motion!.ay - 0.2, 9);
    // anchor stays glued to its box: offset from box centre is preserved
    expect(b.motion!.ay - b.y).toBeCloseTo(a.motion!.ay - a.y, 9);
  });

  it("dread ropes survive a hat while the crown slab is suppressed", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), ears: "none", headgear: "none" };
    const hatted = composeHead({ ...base, hair: "dreads", hat: "cowboy" });
    expect(hatted.protrusions.filter((p) => p.y > 0.5).length).toBe(0);
    expect(hatted.protrusions.filter((p) => p.z < -0.5).length).toBeGreaterThanOrEqual(5);
    expect(hatted.protrusions.some((p) => p.x > 0.5)).toBe(true);
  });

  it("smooth hair grows a back sheet + side panels that survive a hat", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), ears: "none", headgear: "none" };
    const bare = composeHead({ ...base, hair: "smooth" });
    expect(bare.protrusions.filter((p) => p.z < -0.5).length).toBeGreaterThanOrEqual(2);
    const hatted = composeHead({ ...base, hair: "smooth", hat: "tophat" });
    expect(hatted.protrusions.filter((p) => p.y > 0.5).length).toBe(0);
    expect(hatted.protrusions.filter((p) => p.z < -0.5).length).toBeGreaterThanOrEqual(2);
    expect(hatted.protrusions.some((p) => Math.abs(p.x) > 0.5)).toBe(true);
  });

  it("shaggy crown tufts are suppressed by a hat but side/nape locks survive", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), ears: "none", headgear: "none" };
    const bare = composeHead({ ...base, hair: "shaggy" });
    expect(bare.protrusions.filter((p) => p.y > 0.5).length).toBeGreaterThanOrEqual(4);
    const hatted = composeHead({ ...base, hair: "shaggy", hat: "witch" });
    expect(hatted.protrusions.filter((p) => p.y > 0.5).length).toBe(0);
    expect(hatted.protrusions.some((p) => Math.abs(p.x) > 0.5)).toBe(true);
    expect(hatted.protrusions.some((p) => p.z < -0.5)).toBe(true);
  });

  it("every race paints a distinct front face from every other race", () => {
    const fronts = new Map<string, string>();
    for (const race of RACES) {
      // same slots for all so only race flavour differs
      const cfg: AvatarConfig = {
        ...defaultConfig(race.id),
        hair: "bald",
        eyes: "round",
        brows: "thin",
        mouth: "neutral",
        facialHair: "none",
        ears: "none",
        tusks: "none",
        headgear: "none",
        hat: "none",
        expression: "normal",
        extra: "none",
      };
      const key = composeHead(cfg).faces.front.join(",");
      for (const [other, otherKey] of fronts) {
        expect(key, `${race.id} should differ from ${other}`).not.toBe(otherKey);
      }
      fronts.set(race.id, key);
    }
  });

  it("headband paints all four side faces; horns use 3D GLB (no box protrusions)", () => {
    const base = defaultConfig("human");
    const none = composeHead({ ...base, headgear: "none" });
    const band = composeHead({ ...base, headgear: "headband" });
    for (const name of ["front", "back", "left", "right"] as const) {
      expect(band.faces[name]).not.toEqual(none.faces[name]);
    }
    const horns = composeHead({ ...base, headgear: "horns" });
    // painted faces identical to none — horns mount via mountHat("horns")
    expect(horns.faces.front).toEqual(none.faces.front);
    expect(horns.protrusions.length).toBe(none.protrusions.length);
  });
});

describe("catalog config helpers", () => {
  it("randomConfig always yields a sanitize-stable config", () => {
    let n = 0.0001;
    const rng = () => {
      n = (n * 9301 + 0.2113) % 1;
      return n;
    };
    for (const race of RACES) {
      for (let i = 0; i < 20; i++) {
        const cfg = randomConfig(race.id, rng);
        expect(sanitizeConfig(cfg)).toEqual(cfg);
        expect(() => composeHead(cfg)).not.toThrow();
      }
    }
  });

  it("surpriseConfig yields a sanitize-stable config across races", () => {
    let n = 0.377;
    const rng = () => {
      n = (n * 9301 + 0.2113) % 1;
      return n;
    };
    for (let i = 0; i < 40; i++) {
      const cfg = surpriseConfig(rng);
      expect(sanitizeConfig(cfg)).toEqual(cfg);
      expect(() => composeHead(cfg)).not.toThrow();
    }
  });

  it("encodeConfig/decodeConfig roundtrip every race default and random builds", () => {
    for (const race of RACES) {
      const cfg = defaultConfig(race.id);
      expect(decodeConfig(encodeConfig(cfg))).toEqual(cfg);
    }
    let n = 0.61;
    const rng = () => {
      n = (n * 9301 + 0.2113) % 1;
      return n;
    };
    for (let i = 0; i < 10; i++) {
      const cfg = surpriseConfig(rng);
      expect(decodeConfig(encodeConfig(cfg))).toEqual(cfg);
    }
  });

  it("decodeConfig rejects junk", () => {
    expect(decodeConfig("")).toBeNull();
    expect(decodeConfig("not-a-code")).toBeNull();
    expect(decodeConfig("AV1.%%%")).toBeNull();
    expect(decodeConfig("AV2.abc")).toBeNull();
  });

  it("skinToneOf resolves the race palette entry and clamps out-of-range indices", () => {
    for (const race of RACES) {
      expect(skinToneOf({ race: race.id, skin: 0 })).toBe(race.skins[0]);
      expect(skinToneOf({ race: race.id, skin: race.skins.length - 1 })).toBe(
        race.skins[race.skins.length - 1],
      );
      expect(skinToneOf({ race: race.id, skin: 99 })).toBe(race.skins[race.skins.length - 1]);
      expect(skinToneOf({ race: race.id, skin: -5 })).toBe(race.skins[0]);
    }
  });

  it("new hair styles sanitize + roundtrip", () => {
    for (const hair of ["smooth", "shaggy", "dreads"] as const) {
      const cfg: AvatarConfig = { ...defaultConfig("human"), hair };
      expect(sanitizeConfig(cfg)).toEqual(cfg);
      expect(decodeConfig(encodeConfig(cfg))).toEqual(cfg);
      expect(() => composeHead(cfg)).not.toThrow();
    }
  });

  it("adjust offset translates the nose boxes without resizing them", () => {
    const base = defaultConfig("human");
    const plain = composeHead(base).protrusions.filter((p) => p.slot === "nose");
    const moved = composeHead({
      ...base,
      adjust: { nose: { ...DEFAULT_ADJUST, x: 0.125, y: -0.0625, z: 0.25 } },
    }).protrusions.filter((p) => p.slot === "nose");
    expect(moved.length).toBe(plain.length);
    for (let i = 0; i < plain.length; i++) {
      expect(moved[i].x).toBeCloseTo(plain[i].x + 0.125, 6);
      expect(moved[i].y).toBeCloseTo(plain[i].y - 0.0625, 6);
      expect(moved[i].z).toBeCloseTo(plain[i].z + 0.25, 6);
      expect(moved[i].w).toBeCloseTo(plain[i].w, 6);
      expect(moved[i].h).toBeCloseTo(plain[i].h, 6);
      expect(moved[i].d).toBeCloseTo(plain[i].d, 6);
    }
  });

  it("adjust scale grows the tusk group about its own centre", () => {
    const base = defaultConfig("orc");
    const plain = composeHead(base).protrusions.filter((p) => p.slot === "tusks");
    const scaled = composeHead({
      ...base,
      adjust: { tusks: { ...DEFAULT_ADJUST, scale: 2 } },
    }).protrusions.filter((p) => p.slot === "tusks");
    expect(plain.length).toBeGreaterThan(0);
    expect(scaled.length).toBe(plain.length);
    const centre = (boxes: typeof plain) => {
      let minX = Infinity,
        maxX = -Infinity;
      for (const b of boxes) {
        minX = Math.min(minX, b.x - b.w / 2);
        maxX = Math.max(maxX, b.x + b.w / 2);
      }
      return { minX, maxX, cx: (minX + maxX) / 2, span: maxX - minX };
    };
    const a = centre(plain);
    const b = centre(scaled);
    // group centre preserved, extent doubled, box sizes doubled
    expect(b.cx).toBeCloseTo(a.cx, 6);
    expect(b.span).toBeCloseTo(a.span * 2, 6);
    for (let i = 0; i < plain.length; i++) {
      expect(scaled[i].w).toBeCloseTo(plain[i].w * 2, 6);
      expect(scaled[i].h).toBeCloseTo(plain[i].h * 2, 6);
      expect(scaled[i].d).toBeCloseTo(plain[i].d * 2, 6);
    }
  });

  it("adjust hide removes the hair boxes and its painted pixels", () => {
    const base: AvatarConfig = { ...defaultConfig("barbarian"), hair: "long" };
    const shown = composeHead(base);
    const hidden = composeHead({
      ...base,
      adjust: { hair: { ...DEFAULT_ADJUST, hide: true } },
    });
    expect(shown.protrusions.some((p) => p.slot === "hair")).toBe(true);
    expect(hidden.protrusions.some((p) => p.slot === "hair")).toBe(false);
    // painted hair pixels vanish too (top face is dominated by hair)
    expect(hidden.faces.top).not.toEqual(shown.faces.top);
    // unrelated slots untouched
    expect(hidden.protrusions.filter((p) => p.slot === "nose")).toEqual(
      shown.protrusions.filter((p) => p.slot === "nose"),
    );
  });

  it("sanitizeConfig clamps adjust values and drops identity entries", () => {
    const cfg = sanitizeConfig({
      ...defaultConfig("human"),
      adjust: {
        nose: { x: 99, y: -99, z: 0.1, scale: 999, hide: false },
        hair: { x: 0, y: 0, z: 0, scale: 1, hide: false }, // identity → dropped
        bogus: { x: 1, y: 1, z: 1, scale: 1, hide: false }, // unknown slot → ignored
      },
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.adjust?.nose).toEqual({
      x: ADJUST_OFFSET_LIMIT,
      y: -ADJUST_OFFSET_LIMIT,
      z: 0.1,
      scale: ADJUST_SCALE_MAX,
      hide: false,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
    });
    expect(cfg!.adjust?.hair).toBeUndefined();
    expect("bogus" in (cfg!.adjust ?? {})).toBe(false);
    // all-identity adjust collapses to no adjust field at all
    const clean = sanitizeConfig({
      ...defaultConfig("human"),
      adjust: { nose: { x: 0, y: 0, z: 0, scale: 1, hide: false } },
    });
    expect(clean!.adjust).toBeUndefined();
  });

  it("adjust survives the encode/decode build-code roundtrip", () => {
    const cfg: AvatarConfig = {
      ...defaultConfig("elf"),
      adjust: {
        ears: { ...DEFAULT_ADJUST, y: 0.125, scale: 1.5 },
        hair: { ...DEFAULT_ADJUST, hide: true },
      },
    };
    expect(decodeConfig(encodeConfig(cfg))).toEqual(cfg);
  });

  it("sanitizeConfig rejects garbage and repairs partial configs", () => {
    expect(sanitizeConfig(null)).toBeNull();
    expect(sanitizeConfig({ race: "gnome" })).toBeNull();
    const fixed = sanitizeConfig({ race: "orc", hair: "afro", skin: 99 });
    expect(fixed).not.toBeNull();
    expect(fixed!.race).toBe("orc");
    expect(fixed!.hair).toBe(defaultConfig("orc").hair);
    expect(fixed!.skin).toBeLessThan(RACES.find((r) => r.id === "orc")!.skins.length);
  });

  it("tusks are race-gated to orc and undead", () => {
    for (const race of ["human", "barbarian", "elf", "dwarf"] as const) {
      expect(tuskStylesFor(race).map((s) => s.id)).toEqual(["none"]);
      const coerced = sanitizeConfig({ ...defaultConfig(race), tusks: "big" });
      expect(coerced!.tusks).toBe("none");
    }
    for (const race of ["orc", "undead"] as const) {
      expect(tuskStylesFor(race).map((s) => s.id)).toEqual([
        "none",
        "small",
        "big",
        "curved",
        "long",
        "flared",
        "twin",
        "broken",
      ]);
      const kept = sanitizeConfig({ ...defaultConfig(race), tusks: "small" });
      expect(kept!.tusks).toBe("small");
    }
  });

  it("elf ear styles are race-gated (long elf-only, pointed elf+orc)", () => {
    expect(earStylesFor("elf").map((s) => s.id)).toEqual(["none", "round", "pointed", "long"]);
    expect(earStylesFor("orc").map((s) => s.id)).toEqual(["none", "round", "pointed"]);
    for (const race of ["human", "barbarian", "undead", "dwarf"] as const) {
      expect(earStylesFor(race).map((s) => s.id)).toEqual(["none", "round"]);
      const coerced = sanitizeConfig({ ...defaultConfig(race), ears: "long" });
      expect(coerced!.ears).toBe(defaultConfig(race).ears);
    }
    // every race default stays legal
    for (const { id } of RACES) {
      const def = defaultConfig(id);
      expect(earStylesFor(id).some((s) => s.id === def.ears)).toBe(true);
      expect(tuskStylesFor(id).some((s) => s.id === def.tusks)).toBe(true);
    }
  });

  it("adjust rotation clamps to the limit and survives the roundtrip", () => {
    const cfg = sanitizeConfig({
      ...defaultConfig("human"),
      adjust: { hat: { ...DEFAULT_ADJUST, rotX: 999, rotY: -999, rotZ: 45 } },
    });
    expect(cfg!.adjust?.hat).toMatchObject({
      rotX: ADJUST_ROT_LIMIT,
      rotY: -ADJUST_ROT_LIMIT,
      rotZ: 45,
    });
    const full: AvatarConfig = {
      ...defaultConfig("human"),
      adjust: { hat: { ...DEFAULT_ADJUST, rotX: 30, rotY: -60, rotZ: 90 } },
    };
    expect(decodeConfig(encodeConfig(full))).toEqual(full);
  });

  it("every tusk style grows distinct front-face protrusions", () => {
    const styles = tuskStylesFor("orc")
      .map((s) => s.id)
      .filter((id) => id !== "none");
    expect(styles).toHaveLength(7);
    const signatures = new Set<string>();
    for (const style of styles) {
      const cfg: AvatarConfig = { ...defaultConfig("orc"), tusks: style };
      const tusks = composeHead(cfg).protrusions.filter((p) => p.slot === "tusks");
      expect(tusks.length).toBeGreaterThanOrEqual(2);
      // every tusk box sits proud of the front face
      for (const p of tusks) expect(p.z).toBeGreaterThan(0.5);
      signatures.add(
        tusks
          .map((p) => [p.x, p.y, p.z, p.w, p.h, p.d].map((v) => v.toFixed(4)).join(":"))
          .sort()
          .join("|"),
      );
    }
    // all seven styles produce different geometry
    expect(signatures.size).toBe(styles.length);
    // style intents hold: "long" reaches furthest forward, "flared" widest,
    // "curved" climbs higher than "big", "broken" is asymmetric
    const boxes = (style: (typeof styles)[number]) =>
      composeHead({ ...defaultConfig("orc"), tusks: style }).protrusions.filter(
        (p) => p.slot === "tusks",
      );
    const maxZ = (style: (typeof styles)[number]) =>
      Math.max(...boxes(style).map((p) => p.z + p.d / 2));
    const maxX = (style: (typeof styles)[number]) =>
      Math.max(...boxes(style).map((p) => Math.abs(p.x) + p.w / 2));
    const maxY = (style: (typeof styles)[number]) =>
      Math.max(...boxes(style).map((p) => p.y + p.h / 2));
    for (const other of ["small", "big", "curved", "flared"] as const)
      expect(maxZ("long")).toBeGreaterThan(maxZ(other));
    for (const other of ["small", "big", "long", "curved"] as const)
      expect(maxX("flared")).toBeGreaterThan(maxX(other));
    expect(maxY("curved")).toBeGreaterThan(maxY("big"));
    const broken = boxes("broken");
    const leftMax = Math.max(...broken.filter((p) => p.x < 0).map((p) => p.y + p.h / 2));
    const rightMax = Math.max(...broken.filter((p) => p.x > 0).map((p) => p.y + p.h / 2));
    expect(leftMax).toBeGreaterThan(rightMax);
  });

  it("clenched-teeth mouths paint a complete tooth row (no missing-teeth gaps)", () => {
    // grim style + the clenched expressions must never leave dark gaps
    // between teeth — every pixel in the bite row must be a light tooth.
    const isToothLike = (c: number) => {
      const r = (c >> 16) & 0xff;
      const g = (c >> 8) & 0xff;
      const b = c & 0xff;
      return r > 150 && g > 140 && b > 120; // ivory-ish, clearly not mouthDark
    };
    const cases: Partial<AvatarConfig>[] = [
      { mouth: "grim" },
      { expression: "happy" },
      { expression: "angry" },
      { expression: "hurt" },
    ];
    for (const patch of cases) {
      const cfg: AvatarConfig = { ...defaultConfig("human"), ...patch };
      const f = composeHead(cfg).faces.front;
      const row = 12; // bite row for every clenched mouth
      // find the painted teeth span: contiguous tooth-like run around centre
      const centre = 7;
      expect(isToothLike(f[row * FACE + centre])).toBe(true);
      // walk outward from centre: the run must be contiguous (no dark holes)
      let left = centre;
      while (left - 1 >= 0 && isToothLike(f[row * FACE + left - 1])) left--;
      let right = centre;
      while (right + 1 < FACE && isToothLike(f[row * FACE + right + 1])) right++;
      const span = right - left + 1;
      expect(span).toBeGreaterThanOrEqual(4); // a real row of teeth
      for (let x = left; x <= right; x++) expect(isToothLike(f[row * FACE + x])).toBe(true);
    }
  });

  it("talk loop composes distinct looping frames and only touches the mouth", () => {
    const cfg = defaultConfig("human");
    const frames = composeTalkFrames(cfg);
    expect(frames).toHaveLength(TALK_FRAME_COUNT);
    // every frame differs from at least one other (the mouth visibly moves)
    const keys = frames.map((f) => f.join(","));
    expect(new Set(keys).size).toBeGreaterThanOrEqual(3);
    // frames are deterministic
    expect(composeTalkFrames(cfg).map((f) => f.join(","))).toEqual(keys);
    // only the mouth region changes: rows above the mouth match the base face
    const base = composeHead(cfg).faces.front;
    for (const f of frames)
      for (let y = 0; y < 10; y++)
        for (let x = 0; x < FACE; x++)
          expect(f[y * FACE + x]).toBe(base[y * FACE + x]);
  });

  it("talking expression paints an open mouth on the static compose", () => {
    const base = composeHead(defaultConfig("human")).faces.front;
    const talking = composeHead({ ...defaultConfig("human"), expression: "talking" }).faces.front;
    expect(talking.join(",")).not.toBe(base.join(","));
  });

  it("open hats keep face/ear/hair protrusions (no full-cover hoods/helmets)", () => {
    const base: AvatarConfig = {
      ...defaultConfig("orc"),
      hair: "dreads",
      facialHair: "braided",
      ears: "round",
    };
    const bare = composeHead(base).protrusions;
    expect(bare.some((p) => p.slot === "tusks")).toBe(true);
    expect(bare.some((p) => p.slot === "nose")).toBe(true);
    expect(bare.some((p) => p.slot === "hair")).toBe(true);
    // non-enclosing hats keep protrusions (only crown hair volume is gated)
    const capped = composeHead({ ...base, hat: "cowboy" }).protrusions;
    expect(capped.some((p) => p.slot === "tusks")).toBe(true);
    expect(capped.some((p) => p.slot === "ears")).toBe(true);
    // hiding a hat via adjust is still a no-op for coverage
    const hidden = composeHead({
      ...base,
      hat: "cowboy",
      adjust: { hat: { ...DEFAULT_ADJUST, hide: true } },
    }).protrusions;
    expect(hidden.some((p) => p.slot === "tusks")).toBe(true);
    expect(hidden.some((p) => p.slot === "nose")).toBe(true);
  });

  it("extra decal adjust moves, rotates and scales the painted pixels", () => {
    const base: AvatarConfig = { ...defaultConfig("human"), extra: "warpaint" };
    const plain = composeHead(base).faces.front;
    const moved = composeHead({
      ...base,
      adjust: { extra: { ...DEFAULT_ADJUST, x: 0.25 } },
    }).faces.front;
    const rotated = composeHead({
      ...base,
      adjust: { extra: { ...DEFAULT_ADJUST, rotZ: 90 } },
    }).faces.front;
    const scaled = composeHead({
      ...base,
      adjust: { extra: { ...DEFAULT_ADJUST, scale: 2 } },
    }).faces.front;
    expect(moved).not.toEqual(plain);
    expect(rotated).not.toEqual(plain);
    expect(scaled).not.toEqual(plain);
    // decal transform never disturbs the head when there is no extra
    const bare = { ...defaultConfig("human"), extra: "none" as const };
    const bareMoved = composeHead({
      ...bare,
      adjust: { extra: { ...DEFAULT_ADJUST, x: 0.25, rotZ: 45 } },
    }).faces.front;
    expect(bareMoved).toEqual(composeHead(bare).faces.front);
  });
});
