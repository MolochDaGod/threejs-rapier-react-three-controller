import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { DuelDirector, type DuelEvent } from "./director";
import type { HighlightKind } from "../types";

/**
 * The DuelDirector drives the spectator camera's excitement curve, slow-mo
 * beats, and rolling highlight buffer. This suite locks in those thresholds:
 * the per-kind excitement bumps, decay vs proximity floor, slow-mo trigger
 * kinds + duration, the highlight cap, and the time-scale it reports.
 */

const at = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function event(kind: HighlightKind, overrides: Partial<DuelEvent> = {}): DuelEvent {
  return { fighter: "A", kind, at: at(), magnitude: 0, ...overrides };
}

describe("DuelDirector — excitement curve", () => {
  it("starts at zero excitement and normal time-scale", () => {
    const d = new DuelDirector();
    expect(d.getExcitement()).toBe(0);
    expect(d.isSlowmo()).toBe(false);
    expect(d.timeScale()).toBe(1);
  });

  it("bumps excitement more for a KO than a flurry", () => {
    const ko = new DuelDirector();
    ko.update(0.016, 0, [event("ko")], 1, at());
    const flurry = new DuelDirector();
    flurry.update(0.016, 0, [event("flurry")], 1, at());
    expect(ko.getExcitement()).toBeGreaterThan(flurry.getExcitement());
  });

  it("clamps excitement at 1 even for a huge magnitude", () => {
    const d = new DuelDirector();
    d.update(0.016, 0, [event("ko", { magnitude: 100 })], 1, at());
    expect(d.getExcitement()).toBeLessThanOrEqual(1);
    expect(d.getExcitement()).toBeCloseTo(1);
  });

  it("weights excitement by event magnitude", () => {
    const low = new DuelDirector();
    low.update(0.016, 0, [event("flurry", { magnitude: 0 })], 1, at());
    const high = new DuelDirector();
    high.update(0.016, 0, [event("flurry", { magnitude: 2 })], 1, at());
    expect(high.getExcitement()).toBeGreaterThan(low.getExcitement());
  });

  it("decays excitement over time with no new events", () => {
    const d = new DuelDirector();
    d.update(0.016, 0, [event("bigHit")], 1, at());
    const peak = d.getExcitement();
    d.update(1, 0, [], 1, at());
    expect(d.getExcitement()).toBeLessThan(peak);
  });

  it("floors excitement on sustained proximity so a tense standoff stays hot", () => {
    const d = new DuelDirector();
    // No events, but fighters are right on top of each other.
    d.update(1, 1, [], 1, at());
    expect(d.getExcitement()).toBeCloseTo(0.4);
  });
});

describe("DuelDirector — slow-mo thresholds", () => {
  it.each<HighlightKind>(["ko", "crit", "parry"])(
    "drops into slow-mo on a %s",
    (kind) => {
      const d = new DuelDirector();
      d.update(0.016, 0, [event(kind)], 1, at());
      expect(d.isSlowmo()).toBe(true);
      expect(d.timeScale()).toBeLessThan(1);
    },
  );

  it.each<HighlightKind>(["bigHit", "flurry"])(
    "does NOT trigger slow-mo on a %s",
    (kind) => {
      const d = new DuelDirector();
      d.update(0.016, 0, [event(kind)], 1, at());
      expect(d.isSlowmo()).toBe(false);
      expect(d.timeScale()).toBe(1);
    },
  );

  it("holds slow-mo for its full duration then returns to normal", () => {
    const d = new DuelDirector();
    d.update(0.016, 0, [event("ko")], 1, at());
    expect(d.isSlowmo()).toBe(true);
    // Just under the slow-mo window (1.1s) — still active.
    d.update(1.0, 0, [], 1, at());
    expect(d.isSlowmo()).toBe(true);
    // Past the window — back to normal speed.
    d.update(0.2, 0, [], 1, at());
    expect(d.isSlowmo()).toBe(false);
    expect(d.timeScale()).toBe(1);
  });
});

describe("DuelDirector — highlight buffer", () => {
  it("captures flagged moments newest-first with round + label", () => {
    const d = new DuelDirector();
    d.update(0.5, 0, [event("bigHit", { fighter: "A" })], 2, at());
    d.update(0.5, 0, [event("ko", { fighter: "B" })], 2, at());
    const hl = d.getHighlights();
    expect(hl).toHaveLength(2);
    expect(hl[0].kind).toBe("ko");
    expect(hl[0].fighter).toBe("B");
    expect(hl[0].round).toBe(2);
    expect(hl[0].label).toBe("Knockout");
    expect(hl[1].kind).toBe("bigHit");
    // t accumulates elapsed time across updates.
    expect(hl[0].t).toBeGreaterThan(hl[1].t);
  });

  it("returns a defensive copy of the highlight buffer", () => {
    const d = new DuelDirector();
    d.update(0.016, 0, [event("crit")], 1, at());
    const a = d.getHighlights();
    a.push({ t: 0, round: 0, kind: "ko", fighter: "A", score: 0, label: "x" });
    expect(d.getHighlights()).toHaveLength(1);
  });

  it("caps the highlight buffer at 20 entries", () => {
    const d = new DuelDirector();
    for (let i = 0; i < 30; i++) d.update(0.016, 0, [event("flurry")], 1, at());
    expect(d.getHighlights()).toHaveLength(20);
  });
});

describe("DuelDirector — reset", () => {
  it("clears excitement, slow-mo, elapsed time, and highlights", () => {
    const d = new DuelDirector();
    d.update(0.016, 0, [event("ko")], 1, at());
    d.reset();
    expect(d.getExcitement()).toBe(0);
    expect(d.isSlowmo()).toBe(false);
    expect(d.getHighlights()).toHaveLength(0);
    // elapsed reset: a freshly captured highlight starts near t=0 again.
    d.update(0.5, 0, [event("crit")], 1, at());
    expect(d.getHighlights()[0].t).toBeCloseTo(0.5);
  });
});

describe("DuelDirector — hotspot framing", () => {
  it("drifts the hotspot toward an event impact point", () => {
    const d = new DuelDirector();
    const impact = at(10, 0, 0);
    for (let i = 0; i < 30; i++) d.update(0.1, 0, [event("bigHit", { at: impact })], 1, at(-10, 0, 0));
    expect(d.getHotspot().x).toBeGreaterThan(0);
  });

  it("rests toward the fighters' midpoint when no events occur", () => {
    const d = new DuelDirector();
    const mid = at(5, 1, 5);
    for (let i = 0; i < 60; i++) d.update(0.1, 0.3, [], 1, mid);
    const h = d.getHotspot();
    expect(h.x).toBeCloseTo(5, 0);
    expect(h.z).toBeCloseTo(5, 0);
  });
});
