import { describe, expect, it } from "vitest";
import { ABILITIES, deployAbility, getAbility, statusAbility, vfxSkill } from "./abilityRegistry";

describe("ability registry", () => {
  it("looks up seeded abilities by id", () => {
    expect(getAbility("fireDragonSig")?.kind).toBe("fireDragon");
    expect(getAbility("bowSlash")?.kind).toBe("slash");
    expect(getAbility("nope")).toBeUndefined();
  });

  it("the fire-dragon def is an instant-launch projectile (travel, no aura/impact)", () => {
    const def = getAbility("fireDragonSig")!;
    expect(def.target).toBe("aimed");
    expect(def.cast?.duration).toBe(0); // instant launch, no cast wind-up
    expect(def.cast?.auraColor).toBeUndefined(); // no cast aura today (behavior-preserving)
    expect(def.travel?.motion).toBe("dragon");
    expect(def.travel?.maxFlight).toBeGreaterThan(0);
    expect(def.impact).toBeUndefined(); // blast is owned by the dragon travel effect
  });

  it("the bow-slash def is a timed melee (wind-up, no travel)", () => {
    const def = getAbility("bowSlash")!;
    expect(def.cast?.duration).toBeGreaterThan(0);
    expect(def.travel).toBeUndefined();
    expect(def.anim?.clip).toContain("great-sword-slide-attack");
  });

  it("the dash-skill def is a timed lunge (wind-up, no travel)", () => {
    const def = getAbility("dashSkill")!;
    expect(def.target).toBe("aimed");
    expect(def.cast?.duration).toBeGreaterThan(0); // overridden at cast with the runtime slide delay
    expect(def.travel).toBeUndefined(); // the AoE blast lands via the impact hook
    expect(def.impact).toBeUndefined();
  });

  it("builds an instant VFX skill whose visuals the host owns (no travel by default)", () => {
    const def = vfxSkill("meteor", 0xff8a3d, { target: "aimed" });
    expect(def.id).toBe("vfx:meteor");
    expect(def.kind).toBe("meteor");
    expect(def.color).toBe(0xff8a3d);
    expect(def.target).toBe("aimed");
    expect(def.cast?.duration).toBe(0); // synchronous launch
    expect(def.travel).toBeUndefined();
    expect(def.impact).toBeUndefined();
    expect(def.status).toBeUndefined();
  });

  it("defaults a VFX skill to self target and carries an optional descriptive travel motion", () => {
    expect(vfxSkill("bolt", 0x6fd6ff).target).toBe("self");
    const dark = vfxSkill("darkBlades", 0xb070ff, { target: "aimed", travel: "darkBlades", maxFlight: 3 });
    expect(dark.travel).toEqual({ motion: "darkBlades", maxFlight: 3 });
  });

  it("every seeded def carries a unique id and a base color", () => {
    const ids = Object.values(ABILITIES).map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of Object.values(ABILITIES)) {
      expect(def.id).toBeTruthy();
      expect(typeof def.color).toBe("number");
    }
  });

  it("builds buff status abilities scoped to allies", () => {
    expect(statusAbility("haste", "buff").status).toEqual({ id: "haste", scope: "ally" });
    expect(statusAbility("haste", "buff", true).status).toEqual({ id: "haste", scope: "aoeAlly" });
    expect(statusAbility("regen", "buff", true).target).toBe("aoe");
  });

  it("builds debuff status abilities scoped to hostiles", () => {
    expect(statusAbility("burning", "debuff").status).toEqual({ id: "burning", scope: "hostile" });
    // aoe flag never widens a debuff onto allies.
    expect(statusAbility("burning", "debuff", true).status?.scope).toBe("hostile");
  });

  it("falls back to self scope for an unknown/undefined kind", () => {
    // Mirrors the pre-refactor applyStatus default (no buff/debuff match -> self).
    expect(statusAbility("haste", undefined).status?.scope).toBe("self");
    expect(statusAbility("haste", undefined, true).status?.scope).toBe("self");
  });

  it("status abilities have no cast/travel/impact phases (status-only)", () => {
    const def = statusAbility("shielded", "buff");
    expect(def.cast).toBeUndefined();
    expect(def.travel).toBeUndefined();
    expect(def.impact).toBeUndefined();
    expect(def.status).toBeDefined();
  });

  it("builds a deployable-entity ability with a deploy phase (no cast/travel/impact)", () => {
    const def = deployAbility("turret", "turret", 0x8fd0ff, {
      life: 6.0,
      firstTick: 0.5,
      interval: 1.4,
      tail: 0.4,
    });
    expect(def.id).toBe("deploy:turret");
    expect(def.kind).toBe("turret");
    expect(def.color).toBe(0x8fd0ff);
    expect(def.target).toBe("aoe");
    expect(def.cast).toBeUndefined();
    expect(def.travel).toBeUndefined();
    expect(def.impact).toBeUndefined();
    expect(def.status).toBeUndefined();
    expect(def.deploy).toEqual({ life: 6.0, firstTick: 0.5, interval: 1.4, ticks: 4 });
  });

  it("derives the deploy tick count from the lifetime exactly as the legacy turret did", () => {
    // floor((life - tail) / interval), min 1 — matches the old inline volley math.
    expect(deployAbility("t", "turret", 0, { life: 6.0, firstTick: 0.5, interval: 1.4, tail: 0.4 }).deploy?.ticks).toBe(4);
    // tail defaults to 0 when omitted.
    expect(deployAbility("t", "turret", 0, { life: 6.0, firstTick: 0.5, interval: 1.4 }).deploy?.ticks).toBe(4);
    // A short lifetime still fires at least one tick.
    expect(deployAbility("t", "turret", 0, { life: 0.3, firstTick: 0.1, interval: 1.4 }).deploy?.ticks).toBe(1);
  });
});
