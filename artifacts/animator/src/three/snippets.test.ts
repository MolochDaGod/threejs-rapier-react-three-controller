import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { sliceClipFraction, SNIPPET_FPS } from "./snippets";

/**
 * Build a 2-second test clip at SNIPPET_FPS so fraction math maps to whole
 * frames cleanly: a single VectorKeyframeTrack is enough to exercise the slicer.
 */
function makeParent(seconds = 2): THREE.AnimationClip {
  const frames = Math.round(seconds * SNIPPET_FPS);
  const times: number[] = [];
  const values: number[] = [];
  for (let i = 0; i <= frames; i++) {
    times.push(i / SNIPPET_FPS);
    values.push(i, 0, 0); // x ramps with the frame index
  }
  const track = new THREE.VectorKeyframeTrack(".position", times, values);
  return new THREE.AnimationClip("parent", seconds, [track]);
}

// THREE.AnimationUtils.subclip keeps frames where `frame < endFrame` (end-
// exclusive), so a slice is up to one frame (~1/30s) shorter than the exact
// fractional span. Assert with a one-frame tolerance (precision 1 ⇒ ±0.05).
describe("sliceClipFraction", () => {
  it("slices a sub-range by fraction of the parent duration", () => {
    const parent = makeParent(2);
    const sub = sliceClipFraction(parent, 0.25, 0.75, "mid");
    expect(sub.name).toBe("mid");
    // 0.25..0.75 of a 2s clip ≈ 1.0s of content.
    expect(sub.duration).toBeCloseTo(1.0, 1);
    expect(sub.tracks.length).toBe(parent.tracks.length);
  });

  it("does NOT mutate the parent clip (subclip clones)", () => {
    const parent = makeParent(2);
    const beforeDur = parent.duration;
    const beforeFrames = parent.tracks[0].times.length;
    sliceClipFraction(parent, 0.1, 0.5, "a");
    sliceClipFraction(parent, 0.5, 0.9, "b");
    expect(parent.duration).toBe(beforeDur);
    expect(parent.tracks[0].times.length).toBe(beforeFrames);
  });

  it("clamps out-of-range fractions to [0,1]", () => {
    const parent = makeParent(2);
    const sub = sliceClipFraction(parent, -0.5, 2, "full");
    expect(sub.duration).toBeCloseTo(2, 1);
  });

  it("orders reversed fractions (from > to)", () => {
    const parent = makeParent(2);
    const sub = sliceClipFraction(parent, 0.8, 0.2, "rev");
    expect(sub.duration).toBeCloseTo(1.2, 1);
  });

  it("guarantees at least one frame for a degenerate range", () => {
    const parent = makeParent(2);
    const sub = sliceClipFraction(parent, 0.5, 0.5, "tiny");
    expect(sub.tracks[0].times.length).toBeGreaterThanOrEqual(1);
    expect(sub.duration).toBeGreaterThanOrEqual(0);
  });
});
