import { describe, expect, it } from "vitest";
import {
  clearMagOnReloadStart,
  fireActionKey,
  fireLockFromAnim,
  GUN_BLEND,
  gunMagazineSpec,
  isGunWeapon,
  pickReloadKind,
  pumpActionKey,
  reloadActionKey,
  reloadDuration,
  shotgunPumpDelayMs,
} from "./gunCombat";

describe("gunCombat", () => {
  it("recognizes production guns", () => {
    expect(isGunWeapon("pistol")).toBe(true);
    expect(isGunWeapon("rifle")).toBe(true);
    expect(isGunWeapon("hunter-rifle")).toBe(true);
    expect(isGunWeapon("shotgun")).toBe(true);
    expect(isGunWeapon("sword")).toBe(false);
  });

  it("picks tactical when mag not empty", () => {
    expect(pickReloadKind({ ammoInClip: 3 })).toBe("tactical");
    expect(pickReloadKind({ ammoInClip: 0 })).toBe("empty");
    expect(pickReloadKind({ ammoInClip: 2, crouching: true })).toBe("crouch");
  });

  it("maps reload kinds to ActionKeys", () => {
    expect(reloadActionKey("standing")).toBe("reload");
    expect(reloadActionKey("empty")).toBe("reloadEmpty");
    expect(reloadActionKey("tactical")).toBe("reloadTactical");
    expect(reloadActionKey("crouch")).toBe("reloadCrouch");
  });

  it("tactical reload is faster than empty for pistol", () => {
    const s = gunMagazineSpec("pistol")!;
    expect(reloadDuration(s, "tactical")).toBeLessThan(reloadDuration(s, "empty"));
    expect(reloadDuration(s, "crouch")).toBeGreaterThan(reloadDuration(s, "tactical"));
  });

  it("fire verbs prefer hipFire for shotgun", () => {
    expect(fireActionKey("shotgun", true)).toBe("hipFire");
    expect(fireActionKey("shotgun", false)).toBe("shoot");
    expect(fireActionKey("rifle")).toBe("shoot");
    expect(pumpActionKey()).toBe("pump");
  });

  it("tactical does not clear mag at reload start; empty does", () => {
    expect(clearMagOnReloadStart("tactical")).toBe(false);
    expect(clearMagOnReloadStart("empty")).toBe(true);
    expect(clearMagOnReloadStart("crouch")).toBe(true);
  });

  it("fire lock rides anim duration with a sensible floor", () => {
    const lock = fireLockFromAnim("rifle", 0.8, 0.55);
    expect(lock).toBeGreaterThanOrEqual(0.2);
    expect(lock).toBeLessThanOrEqual(0.8);
    expect(fireLockFromAnim("pistol", 0)).toBeGreaterThan(0);
  });

  it("shotgun pump delay stays in a readable window", () => {
    expect(shotgunPumpDelayMs(0.5)).toBeGreaterThanOrEqual(90);
    expect(shotgunPumpDelayMs(0.5)).toBeLessThanOrEqual(220);
    expect(shotgunPumpDelayMs(0)).toBe(130);
  });

  it("production blend times stay snappy for fire and softer for reload", () => {
    expect(GUN_BLEND.fire).toBeLessThan(GUN_BLEND.reload);
    expect(GUN_BLEND.fire).toBeLessThanOrEqual(0.08);
    expect(GUN_BLEND.reload).toBeGreaterThanOrEqual(0.1);
  });
});
