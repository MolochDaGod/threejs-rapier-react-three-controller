import { describe, it, expect } from "vitest";
import {
  NO_WATER_BAND,
  DANGER_ROOM_ZONE,
  isInWaterBand,
  sinkClampVertical,
  traversalModeFor,
  type WaterBand,
} from "./water";

/** A representative dungeon water layer: feet sink from y=10 down to y=4. */
const BAND: WaterBand = { top: 10, bottom: 4 };
const SINK = 4;

describe("isInWaterBand", () => {
  it("is true inside the band and at both edges", () => {
    expect(isInWaterBand(7, BAND)).toBe(true);
    expect(isInWaterBand(10, BAND)).toBe(true);
    expect(isInWaterBand(4, BAND)).toBe(true);
  });

  it("is false above and below the band", () => {
    expect(isInWaterBand(10.01, BAND)).toBe(false);
    expect(isInWaterBand(3.99, BAND)).toBe(false);
  });

  it("is false for every finite Y when there is no band", () => {
    for (const y of [-1000, -1, 0, 5, 1000]) {
      expect(isInWaterBand(y, NO_WATER_BAND)).toBe(false);
    }
  });
});

describe("sinkClampVertical", () => {
  it("does not clamp above the band (free fall continues)", () => {
    expect(sinkClampVertical(12, -20, BAND, SINK)).toBe(-20);
  });

  it("clamps a fast descent to the sink speed inside the band", () => {
    expect(sinkClampVertical(7, -20, BAND, SINK)).toBe(-SINK);
  });

  it("leaves a slow descent untouched inside the band", () => {
    expect(sinkClampVertical(7, -2, BAND, SINK)).toBe(-2);
    // Exactly at the sink speed is not "faster than", so it is left as-is.
    expect(sinkClampVertical(7, -SINK, BAND, SINK)).toBe(-SINK);
  });

  it("never clamps upward / jump velocity inside the band", () => {
    expect(sinkClampVertical(7, 15, BAND, SINK)).toBe(15);
    expect(sinkClampVertical(7, 0, BAND, SINK)).toBe(0);
  });

  it("does not clamp below the band (sealed pit free fall)", () => {
    expect(sinkClampVertical(3, -20, BAND, SINK)).toBe(-20);
  });

  it("clamps at the band edges while falling fast", () => {
    expect(sinkClampVertical(10, -20, BAND, SINK)).toBe(-SINK);
    expect(sinkClampVertical(4, -20, BAND, SINK)).toBe(-SINK);
  });

  it("passes everything through when there is no band", () => {
    expect(sinkClampVertical(7, -20, NO_WATER_BAND, SINK)).toBe(-20);
  });
});

describe("traversalModeFor", () => {
  it("swims inside the band", () => {
    expect(traversalModeFor(7, BAND)).toBe("swim");
    expect(traversalModeFor(10, BAND)).toBe("swim");
    expect(traversalModeFor(4, BAND)).toBe("swim");
  });

  it("walks above and below the band", () => {
    expect(traversalModeFor(12, BAND)).toBe("ground");
    expect(traversalModeFor(3, BAND)).toBe("ground");
  });

  it("always walks when there is no band", () => {
    expect(traversalModeFor(7, NO_WATER_BAND)).toBe("ground");
  });
});

describe("Danger Room exit/death reset", () => {
  it("clears the water band so no finite Y reads as in-water", () => {
    expect(DANGER_ROOM_ZONE.waterBand).toBe(NO_WATER_BAND);
    for (const y of [-100, 0, 7, 100]) {
      expect(isInWaterBand(y, DANGER_ROOM_ZONE.waterBand)).toBe(false);
    }
  });

  it("restores ground traversal", () => {
    expect(DANGER_ROOM_ZONE.traversalMode).toBe("ground");
    expect(traversalModeFor(7, DANGER_ROOM_ZONE.waterBand)).toBe("ground");
  });

  it("drops dungeon collision and camera occluders", () => {
    expect(DANGER_ROOM_ZONE.hasCollision).toBe(false);
    expect(DANGER_ROOM_ZONE.occluderCount).toBe(0);
  });

  it("re-shows the Danger Room population", () => {
    expect(DANGER_ROOM_ZONE.populationVisible).toBe(true);
  });
});
