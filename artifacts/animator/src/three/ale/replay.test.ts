import { describe, it, expect } from "vitest";
import { ReplayBuffer, sampleFrames, type ExplorerPose, type ReplayFrame } from "./replay";

/** Minimal pose recorder: stamps an id into the root x so frames are distinct. */
function recorder(id: number) {
  return {
    capturePose(out?: ExplorerPose): ExplorerPose {
      const bones = out && out.bones.length === 7 ? out.bones : new Float32Array(7);
      bones[6] = 1; // quaternion w
      const pose: ExplorerPose = out ?? {
        px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, bones,
      };
      pose.bones = bones;
      pose.px = id;
      pose.py = 0;
      pose.pz = 0;
      return pose;
    },
  };
}

describe("ReplayBuffer ring", () => {
  it("buffers frames in chronological order", () => {
    const buf = new ReplayBuffer(4);
    const a = recorder(1);
    const b = recorder(2);
    buf.record(0.1, a, b);
    buf.record(0.2, a, b);
    expect(buf.length).toBe(2);
    const frames = buf.ordered();
    expect(frames.map((f) => f.t)).toEqual([0.1, 0.2]);
    expect(frames[0].a?.px).toBe(1);
    expect(frames[0].b?.px).toBe(2);
  });

  it("drops the oldest frames once capacity is exceeded", () => {
    const buf = new ReplayBuffer(3);
    const a = recorder(1);
    for (let i = 0; i < 5; i++) buf.record(i, a, null);
    expect(buf.length).toBe(3);
    // Only the three newest timestamps survive, still ascending.
    expect(buf.ordered().map((f) => f.t)).toEqual([2, 3, 4]);
    expect(buf.latestT()).toBe(4);
  });

  it("records a null side as null (absent fighter)", () => {
    const buf = new ReplayBuffer(2);
    buf.record(0, recorder(1), null);
    const f = buf.ordered()[0];
    expect(f.a).not.toBeNull();
    expect(f.b).toBeNull();
  });

  it("reuses the same Float32Array slot as the ring wraps", () => {
    const buf = new ReplayBuffer(2);
    const a = recorder(1);
    buf.record(0, a, null);
    const firstArr = buf.ordered()[0].a!.bones;
    buf.record(1, a, null);
    buf.record(2, a, null); // wraps onto slot 0
    const reused = buf.ordered().find((f) => f.t === 2)!.a!.bones;
    expect(reused).toBe(firstArr);
  });

  it("clears all frames", () => {
    const buf = new ReplayBuffer(4);
    buf.record(0, recorder(1), null);
    buf.clear();
    expect(buf.length).toBe(0);
    expect(buf.ordered()).toEqual([]);
    expect(buf.latestT()).toBe(0);
  });
});

describe("sampleFrames", () => {
  const frames: ReplayFrame[] = [
    { t: 0, a: null, b: null },
    { t: 1, a: null, b: null },
    { t: 2, a: null, b: null },
  ];

  it("returns null for an empty buffer", () => {
    expect(sampleFrames([], 0)).toBeNull();
  });

  it("clamps to the first frame below the range", () => {
    const s = sampleFrames(frames, -5)!;
    expect(s.f0).toBe(frames[0]);
    expect(s.f1).toBe(frames[0]);
    expect(s.alpha).toBe(0);
  });

  it("clamps to the last frame above the range", () => {
    const s = sampleFrames(frames, 99)!;
    expect(s.f0).toBe(frames[2]);
    expect(s.alpha).toBe(0);
  });

  it("brackets an in-range playhead with the right blend", () => {
    const s = sampleFrames(frames, 1.25)!;
    expect(s.f0).toBe(frames[1]);
    expect(s.f1).toBe(frames[2]);
    expect(s.alpha).toBeCloseTo(0.25, 5);
  });

  it("returns the single frame for a one-frame buffer", () => {
    const one: ReplayFrame[] = [{ t: 3, a: null, b: null }];
    const s = sampleFrames(one, 10)!;
    expect(s.f0).toBe(one[0]);
    expect(s.f1).toBe(one[0]);
    expect(s.alpha).toBe(0);
  });
});
