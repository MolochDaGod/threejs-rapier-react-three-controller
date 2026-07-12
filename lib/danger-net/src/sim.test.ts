import { describe, expect, it } from "vitest";
import {
  clampDamage,
  clampMove,
  guardFactor,
  resolvePvpDamage,
  sanitizeGuard,
  sanitizeSnapshot,
} from "./sim";
import { MAX_MOVE_SPEED, PVP_HIT_MAX_DAMAGE } from "./types";

describe("sanitizeGuard", () => {
  it("passes through known guard states", () => {
    expect(sanitizeGuard("block")).toBe("block");
    expect(sanitizeGuard("parry")).toBe("parry");
    expect(sanitizeGuard("dodge")).toBe("dodge");
    expect(sanitizeGuard("open")).toBe("open");
  });

  it("defaults unknown / malformed input to open", () => {
    expect(sanitizeGuard(undefined)).toBe("open");
    expect(sanitizeGuard(null)).toBe("open");
    expect(sanitizeGuard("godmode")).toBe("open");
    expect(sanitizeGuard(42)).toBe("open");
  });
});

describe("sanitizeSnapshot guard", () => {
  it("includes a sanitized guard field", () => {
    const snap = sanitizeSnapshot({ px: 1, py: 2, pz: 3, guard: "block" });
    expect(snap?.guard).toBe("block");
  });

  it("defaults guard to open when omitted or bogus", () => {
    expect(sanitizeSnapshot({ px: 0, py: 0, pz: 0 })?.guard).toBe("open");
    expect(sanitizeSnapshot({ px: 0, py: 0, pz: 0, guard: "x" })?.guard).toBe("open");
  });
});

describe("clampDamage", () => {
  it("floors negatives / NaN to zero", () => {
    expect(clampDamage(-5)).toBe(0);
    expect(clampDamage(Number.NaN)).toBe(0);
  });

  it("caps absurd damage claims", () => {
    expect(clampDamage(PVP_HIT_MAX_DAMAGE + 1000)).toBe(PVP_HIT_MAX_DAMAGE);
    expect(clampDamage(50)).toBe(50);
  });
});

describe("guardFactor", () => {
  it("open takes full, block leaks chip, parry/dodge negate", () => {
    expect(guardFactor("open")).toBe(1);
    expect(guardFactor("block")).toBeCloseTo(0.35);
    expect(guardFactor("parry")).toBe(0);
    expect(guardFactor("dodge")).toBe(0);
  });
});

describe("resolvePvpDamage", () => {
  it("applies full damage when open", () => {
    const r = resolvePvpDamage(50, "open", true);
    expect(r.outcome).toBe("hit");
    expect(r.applied).toBe(50);
  });

  it("mitigates a block to chip damage", () => {
    const r = resolvePvpDamage(100, "block", true);
    expect(r.outcome).toBe("block");
    expect(r.applied).toBe(35);
  });

  it("fully negates a parry/dodge when the avoid window is available", () => {
    expect(resolvePvpDamage(80, "parry", true)).toEqual({ applied: 0, outcome: "avoid" });
    expect(resolvePvpDamage(80, "dodge", true)).toEqual({ applied: 0, outcome: "avoid" });
  });

  it("lands full damage on a parry/dodge once avoid is on cooldown (no godmode)", () => {
    const r = resolvePvpDamage(80, "parry", false);
    expect(r.outcome).toBe("hit");
    expect(r.applied).toBe(80);
  });

  it("caps the applied damage even with an open guard", () => {
    const r = resolvePvpDamage(99999, "open", true);
    expect(r.applied).toBe(PVP_HIT_MAX_DAMAGE);
  });
});

describe("clampMove (anti-teleport)", () => {
  const origin = { x: 0, y: 0, z: 0 };

  it("allows legitimate movement within the speed budget", () => {
    const dt = 0.1; // 100ms
    const within = { x: MAX_MOVE_SPEED * dt, y: 0, z: 0 };
    const out = clampMove(origin, within, dt);
    expect(out).toEqual(within);
  });

  it("pulls a teleport back to the allowed radius", () => {
    const dt = 0.1;
    const teleport = { x: 10000, y: 0, z: 0 };
    const out = clampMove(origin, teleport, dt);
    const allowed = MAX_MOVE_SPEED * dt + 4;
    expect(out.x).toBeCloseTo(allowed, 5);
    expect(out.x).toBeLessThan(teleport.x);
  });

  it("preserves direction while clamping magnitude", () => {
    const dt = 0;
    const out = clampMove(origin, { x: 3, y: 4, z: 0 }, dt); // dist 5 > slack 4
    // direction (0.6, 0.8) preserved, magnitude pulled to the 4-unit slack
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(4, 5);
    expect(out.x / out.y).toBeCloseTo(3 / 4, 5);
  });

  it("treats a missing dt as zero elapsed (slack only)", () => {
    const out = clampMove(origin, { x: 100, y: 0, z: 0 }, Number.NaN);
    expect(out.x).toBeCloseTo(4, 5);
  });
});
