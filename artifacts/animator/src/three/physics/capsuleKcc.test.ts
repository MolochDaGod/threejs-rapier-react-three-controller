import { describe, expect, it } from "vitest";
import { CAP_CENTER_OFF, CAP_HALF, CAP_RADIUS, KCC_OFFSET } from "./capsuleKcc";

describe("capsuleKcc constants", () => {
  it("keeps a playable adult-scale capsule (~1.8m tall)", () => {
    const height = 2 * CAP_RADIUS + 2 * CAP_HALF;
    expect(height).toBeGreaterThan(1.7);
    expect(height).toBeLessThan(2.0);
    expect(CAP_CENTER_OFF).toBe(CAP_RADIUS + CAP_HALF);
  });

  it("uses a depenetration-friendly skin offset", () => {
    // Too small → stuck in mesh edges; too large → visible float.
    expect(KCC_OFFSET).toBeGreaterThanOrEqual(0.06);
    expect(KCC_OFFSET).toBeLessThanOrEqual(0.15);
  });
});
