// @vitest-environment node
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __setCaptureForTests,
  clearTargetPortraits,
  getTargetPortrait,
  invalidateTargetPortrait,
  PORTRAIT_OMIT_FLAG,
  PORTRAIT_OMIT_NAME,
  portraitFraming,
  requestTargetPortrait,
  subscribeTargetPortraits,
  targetPortraitVersion,
} from "./targetPortraits";

/** Flush the deferred (setTimeout 0) capture pass. */
const flush = () => new Promise((r) => setTimeout(r, 5));

/** A minimal humanoid-ish subject: body + head + a named selection shell. */
function makeSubject(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.5));
  body.position.y = 0.9;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25));
  head.position.y = 1.95;
  const outline = new THREE.Group();
  outline.name = PORTRAIT_OMIT_NAME;
  outline.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)));
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  hidden.visible = false;
  g.add(body, head, outline, hidden);
  g.position.set(4, 0, -7);
  g.rotation.y = 1.3;
  return g;
}

afterEach(() => {
  __setCaptureForTests(null);
  clearTargetPortraits();
});

describe("portraitFraming", () => {
  const min = { x: -0.5, y: 0, z: -0.3 };
  const max = { x: 0.5, y: 2, z: 0.3 };

  it("aims at the head band of the box, centered on x/z", () => {
    const f = portraitFraming(min, max);
    expect(f.look.y).toBeCloseTo(1.74); // face crop: 87% of a 2m body
    expect(f.look.x).toBeCloseTo(0);
    expect(f.look.z).toBeCloseTo(0);
  });

  it("bust mode aims lower and stands further back than the face crop", () => {
    const face = portraitFraming(min, max, 30, "face");
    const bust = portraitFraming(min, max, 30, "bust");
    expect(bust.look.y).toBeCloseTo(1.64); // 82% of a 2m body
    expect(bust.look.y).toBeLessThan(face.look.y);
    expect(bust.eye.z).toBeGreaterThan(face.eye.z);
  });

  it("stands the camera off in front of the subject (+Z), past the box", () => {
    const f = portraitFraming(min, max);
    expect(f.eye.z).toBeGreaterThan(max.z);
    expect(f.eye.x).toBeCloseTo(0);
    expect(f.eye.y).toBeGreaterThan(f.look.y); // slight top-down flatter
  });

  it("widens the framing for a subject wider than it is tall", () => {
    const tall = portraitFraming(min, max);
    const wide = portraitFraming({ x: -3, y: 0, z: -0.3 }, { x: 3, y: 2, z: 0.3 });
    expect(wide.eye.z - 0.3).toBeGreaterThan(tall.eye.z - 0.3);
  });

  it("never degenerates on an empty box", () => {
    const f = portraitFraming({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(Number.isFinite(f.eye.z)).toBe(true);
    expect(f.eye.z).toBeGreaterThan(0);
  });
});

describe("requestTargetPortrait store", () => {
  it("captures once per key, hands the capture an origin-posed clone with shells pruned", async () => {
    const seen: THREE.Object3D[] = [];
    __setCaptureForTests((subject) => {
      seen.push(subject);
      return "data:image/png;base64,stub";
    });
    const live = makeSubject();
    requestTargetPortrait("dummy:training", live);
    requestTargetPortrait("dummy:training", live); // dedupe while in flight
    await flush();
    requestTargetPortrait("dummy:training", live); // dedupe once cached
    await flush();

    expect(seen).toHaveLength(1);
    const clone = seen[0];
    expect(clone).not.toBe(live); // never the live rig
    expect(clone.position.length()).toBe(0); // re-posed to the origin
    expect(clone.quaternion.w).toBeCloseTo(1); // yaw reset (faces +Z)
    let outlines = 0;
    let hiddens = 0;
    clone.traverse((o) => {
      if (o.name === PORTRAIT_OMIT_NAME) outlines++;
      if (!o.visible) hiddens++;
    });
    expect(outlines).toBe(0); // selection shell pruned
    expect(hiddens).toBe(0); // invisible placeholder meshes pruned
    // The live subject is untouched.
    expect(live.position.x).toBe(4);
    expect(live.children.some((c) => c.name === PORTRAIT_OMIT_NAME)).toBe(true);
    expect(getTargetPortrait("dummy:training")).toBe("data:image/png;base64,stub");
  });

  it("caches null on a failed capture (letter fallback) and notifies subscribers", async () => {
    __setCaptureForTests(() => {
      throw new Error("no GL");
    });
    const listener = vi.fn();
    const unsub = subscribeTargetPortraits(listener);
    const before = targetPortraitVersion();

    expect(getTargetPortrait("dungeon:boss")).toBeUndefined(); // unknown ≠ failed
    requestTargetPortrait("dungeon:boss", makeSubject());
    await flush();

    expect(getTargetPortrait("dungeon:boss")).toBeNull();
    expect(listener).toHaveBeenCalled();
    expect(targetPortraitVersion()).toBeGreaterThan(before);
    unsub();
  });

  it("prunes nodes flagged with PORTRAIT_OMIT_FLAG (mounted weapons)", async () => {
    const seen: THREE.Object3D[] = [];
    __setCaptureForTests((subject) => {
      seen.push(subject);
      return "url";
    });
    const live = makeSubject();
    const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.1));
    weapon.userData[PORTRAIT_OMIT_FLAG] = true;
    live.add(weapon);
    requestTargetPortrait("player:knight", live);
    await flush();

    expect(seen).toHaveLength(1);
    let flagged = 0;
    seen[0].traverse((o) => {
      if (o.userData?.[PORTRAIT_OMIT_FLAG]) flagged++;
    });
    expect(flagged).toBe(0); // weapon mount pruned from the capture
    expect(live.children).toContain(weapon); // live rig untouched
  });

  it("invalidate during an in-flight capture drops the stale result and re-captures", async () => {
    let n = 0;
    __setCaptureForTests(() => `url-${n++}`);
    const live = makeSubject();

    requestTargetPortrait("player:hero", live); // capture 0 goes in flight
    invalidateTargetPortrait("player:hero"); // look changed before it landed
    requestTargetPortrait("player:hero", live); // capture 1 for the new look
    await flush();

    // The stale (gen-0) completion must NOT have won; the fresh capture did.
    expect(getTargetPortrait("player:hero")).toBe("url-1");

    // And a later invalidate of a cached entry re-captures on next request.
    invalidateTargetPortrait("player:hero");
    expect(getTargetPortrait("player:hero")).toBeUndefined();
    requestTargetPortrait("player:hero", live);
    await flush();
    expect(getTargetPortrait("player:hero")).toBe("url-2");
  });

  it("invalidating an unknown key is a no-op (no notify)", () => {
    const listener = vi.fn();
    const unsub = subscribeTargetPortraits(listener);
    invalidateTargetPortrait("never:requested");
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it("keys are independent — a second enemy type triggers its own capture", async () => {
    const keys: string[] = [];
    let n = 0;
    __setCaptureForTests(() => `url-${n++}`);
    requestTargetPortrait("avatar:sword", makeSubject());
    requestTargetPortrait("fighter:enemy:axe", makeSubject());
    await flush();
    keys.push(getTargetPortrait("avatar:sword")!, getTargetPortrait("fighter:enemy:axe")!);
    expect(new Set(keys).size).toBe(2);
  });
});
