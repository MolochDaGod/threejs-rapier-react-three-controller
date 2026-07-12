import { describe, expect, it } from "vitest";
import { fighterWeaponProfile, weaponRole } from "./weaponRole";

describe("weaponRole", () => {
  it("infers ranged from the weapon group", () => {
    expect(weaponRole("rifle")).toBe("ranged");
    expect(weaponRole("hunter-rifle")).toBe("ranged");
    expect(weaponRole("bow")).toBe("ranged");
  });

  it("reads an explicit thrown override on a melee-group weapon", () => {
    // The javelin lives in the melee-2h group but is played as a thrown projectile.
    expect(weaponRole("javelin")).toBe("thrown");
  });

  it("defaults every other weapon family to melee", () => {
    expect(weaponRole("sword")).toBe("melee"); // melee-1h
    expect(weaponRole("greatsword")).toBe("melee"); // melee-2h
    expect(weaponRole("staff")).toBe("melee"); // magic (no override → melee flavour caster)
    expect(weaponRole("shield")).toBe("melee"); // off-hand
  });
});

describe("fighterWeaponProfile", () => {
  it("gives ranged fighters a long reach, a fast bolt recast, and no melee combo", () => {
    const p = fighterWeaponProfile("hunter-rifle");
    expect(p.role).toBe("ranged");
    expect(p.castKind).toBe("laser");
    expect(p.comboMax).toBe(1);
    expect(p.castCdScale).toBeLessThan(1);
  });

  it("gives thrown fighters a mid reach shorter than ranged and a blade volley", () => {
    const thrown = fighterWeaponProfile("javelin");
    const ranged = fighterWeaponProfile("rifle");
    expect(thrown.role).toBe("thrown");
    expect(thrown.castKind).toBe("swordVolley");
    expect(thrown.comboMax).toBe(1);
    expect(thrown.spellRange).toBeLessThan(ranged.spellRange);
  });

  it("derives the melee combo cap from the weapon family", () => {
    expect(fighterWeaponProfile("sword").comboMax).toBe(4); // light 1H chains longest
    expect(fighterWeaponProfile("greatsword").comboMax).toBe(2); // heavy 2H chains short
    expect(fighterWeaponProfile("shield").comboMax).toBe(3); // off-hand keeps the default
  });

  it("leaves the melee cast kind for the host to pick and keeps the long cadence", () => {
    const p = fighterWeaponProfile("sword");
    expect(p.role).toBe("melee");
    expect(p.castKind).toBeNull();
    expect(p.castCdScale).toBe(1);
  });
});
