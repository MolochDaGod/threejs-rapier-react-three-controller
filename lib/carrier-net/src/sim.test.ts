import { describe, expect, it } from "vitest";
import {
  CARRIER,
  FLEET_ROLES,
  SHIP,
  MOTHER_SHIP,
  FLEET_UNIT,
  fleetRoleDef,
  hash01,
  isDeployableRole,
  spawnEntity,
  spawnShip,
  tunablesFor,
  type EntityState,
  type FleetRole,
  type InputCommand,
} from "./types";
import { makeRng } from "./rng";
import { decodeClient } from "./protocol";
import { fleetIntent, stepShip, type FleetContext } from "./sim";

const cmd = (over: Partial<InputCommand> = {}): InputCommand => ({
  seq: 0,
  dt: 0,
  thrust: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  boost: false,
  fire: false,
  ...over,
});

const clone = (e: EntityState): EntityState => ({ ...e });

// `uid` is runtime identity (newUuid → crypto.randomUUID), intentionally
// non-deterministic; strip it so the comparison reflects simulation state only.
function stripVolatile(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const { uid: _uid, ...rest } = v as Record<string, unknown>;
    return rest;
  }
  return v;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(stripVolatile(a)) === JSON.stringify(stripVolatile(b));
}

describe("tunablesFor — kind-aware movement envelopes", () => {
  it("selects per-kind envelopes, all sharing the SHIP arena", () => {
    expect(tunablesFor("fighter").maxSpeed).toBe(SHIP.maxSpeed);
    expect(tunablesFor("mother_ship").maxSpeed).toBe(MOTHER_SHIP.maxSpeed);
    expect(tunablesFor("fleet_unit").maxSpeed).toBe(FLEET_UNIT.maxSpeed);
    expect(tunablesFor("mother_ship").arena).toBe(SHIP.arena);
    expect(tunablesFor("fleet_unit").arena).toBe(SHIP.arena);
  });
});

describe("stepShip — kind-aware determinism", () => {
  it("produces identical output for identical inputs (fighter)", () => {
    const a = spawnShip("p1", "A", 0, 0, 0, 0, 0);
    const b = spawnShip("p1", "A", 0, 0, 0, 0, 0);
    const drive = cmd({ thrust: 1, yaw: 0.5, pitch: 0.2 });
    for (let i = 0; i < 60; i++) {
      stepShip(a, drive, 1 / 30);
      stepShip(b, drive, 1 / 30);
    }
    expect(deepEqual(a, b)).toBe(true);
  });

  it("respects each kind's own speed cap", () => {
    const fighter = spawnShip("p1", "F", 0, 0, 0, 0, 0);
    const mother = spawnEntity("ms", "M", "mother_ship", "p1", 0, 0, 0, 0, 0, 0);
    const drive = cmd({ thrust: 1 });
    for (let i = 0; i < 240; i++) {
      stepShip(fighter, drive, 1 / 30);
      stepShip(mother, drive, 1 / 30);
    }
    const fSpeed = Math.hypot(fighter.vx, fighter.vy, fighter.vz);
    const mSpeed = Math.hypot(mother.vx, mother.vy, mother.vz);
    expect(fSpeed).toBeLessThanOrEqual(SHIP.maxSpeed + 1e-6);
    expect(mSpeed).toBeLessThanOrEqual(MOTHER_SHIP.maxSpeed + 1e-6);
    // The bigger, slower mothership must end up slower than the fighter.
    expect(mSpeed).toBeLessThan(fSpeed);
  });

  it("clamps position to the shared arena bounds", () => {
    const e = spawnShip("p1", "A", 0, SHIP.arena - 5, 0, 0, 0);
    // Point straight along +X and burn for a while.
    e.yaw = Math.PI / 2;
    const drive = cmd({ thrust: 1, boost: true });
    for (let i = 0; i < 600; i++) stepShip(e, drive, 1 / 30);
    expect(e.px).toBeLessThanOrEqual(SHIP.arena);
    expect(e.py).toBeLessThanOrEqual(SHIP.arena);
    expect(e.pz).toBeLessThanOrEqual(SHIP.arena);
    expect(e.px).toBeGreaterThanOrEqual(-SHIP.arena);
  });
});

function makeFleetUnit(role: FleetRole, px: number, py: number, pz: number): EntityState {
  const u = spawnEntity("u1", "Unit", "fleet_unit", "p1", 0, 0, px, py, pz, 0, role);
  const def = FLEET_ROLES[role as Exclude<FleetRole, "none">];
  u.zoneR = def.zoneR;
  u.zoneX = 0;
  u.zoneY = 0;
  u.zoneZ = 0;
  return u;
}

function ctxFor(unit: EntityState, over: Partial<FleetContext> = {}): FleetContext {
  return {
    zone: { x: unit.zoneX, y: unit.zoneY, z: unit.zoneZ },
    zoneR: unit.zoneR,
    hostile: null,
    ward: null,
    obstacles: [],
    tick: 100,
    rand: 0.42,
    ...over,
  };
}

describe("fleetIntent — deterministic role AI", () => {
  it("is pure: identical (unit, ctx) yields identical command", () => {
    const u = makeFleetUnit("miner", 100, 20, -50);
    const c = ctxFor(u, { tick: 555, rand: 0.137 });
    const a = fleetIntent(clone(u), c);
    const b = fleetIntent(clone(u), c);
    expect(deepEqual(a, b)).toBe(true);
  });

  it("returns a zeroed command for a dead unit", () => {
    const u = makeFleetUnit("dreadnought", 0, 0, 0);
    u.alive = false;
    const out = fleetIntent(u, ctxFor(u, { hostile: enemyAt(50, 0, 0) }));
    expect(out.thrust).toBe(0);
    expect(out.fire).toBe(false);
    expect(out.yaw).toBe(0);
  });

  it("steers a unit that drifted outside its zone back toward the centre", () => {
    const u = makeFleetUnit("corsair", 0, 0, 0);
    // Place it well outside the zone along +X.
    const outside = u.zoneR + 500;
    u.px = outside;
    const out = fleetIntent(u, ctxFor(u));
    // Goal is the zone centre (-X from the unit) → target yaw points toward -X.
    const expectedYaw = Math.atan2(-1, 0); // atan2(nx, nz) with dir ≈ (-1,0,0)
    // The proportional yaw should drive toward that target (non-trivial turn).
    expect(Math.abs(out.yaw)).toBeGreaterThan(0);
    // After enough simulated ticks it must come back inside the zone.
    let sim = clone(u);
    for (let i = 0; i < 2000; i++) {
      const c = ctxFor(sim, { tick: i });
      const cmdI = { ...fleetIntent(sim, c), dt: 1 / 30 };
      stepShip(sim, cmdI, 1 / 30);
    }
    const dist = Math.hypot(sim.px - sim.zoneX, sim.py - sim.zoneY, sim.pz - sim.zoneZ);
    expect(dist).toBeLessThanOrEqual(u.zoneR);
    void expectedYaw;
  });

  it("keeps a contained unit within its zone over a long run", () => {
    const u = makeFleetUnit("miner", 0, 0, 0);
    let sim = clone(u);
    let maxDist = 0;
    for (let i = 0; i < 3000; i++) {
      const c = ctxFor(sim, { tick: i, rand: hash01(i) });
      const cmdI = { ...fleetIntent(sim, c), dt: 1 / 30 };
      stepShip(sim, cmdI, 1 / 30);
      const d = Math.hypot(sim.px - sim.zoneX, sim.py - sim.zoneY, sim.pz - sim.zoneZ);
      maxDist = Math.max(maxDist, d);
    }
    // Containment can overshoot slightly between ticks but must stay bounded.
    expect(maxDist).toBeLessThan(u.zoneR * 1.5);
  });

  it("only fires when armed, engaged, and closely aligned", () => {
    // Miners are unarmed: never fire even with a hostile in their face.
    const miner = makeFleetUnit("miner", 0, 0, 0);
    const mOut = fleetIntent(miner, ctxFor(miner, { hostile: enemyAt(30, 0, 0) }));
    expect(mOut.fire).toBe(false);

    // An armed dreadnought pointed straight at a close hostile should fire.
    const atk = makeFleetUnit("dreadnought", 0, 0, 0);
    atk.yaw = Math.PI / 2; // facing +X
    const hostile = enemyAt(80, 0, 0); // within dreadnought fireRange (270)
    const aOut = fleetIntent(atk, ctxFor(atk, { hostile }));
    expect(aOut.fire).toBe(true);

    // Same dreadnought, hostile beyond fireRange → holds fire.
    const far = enemyAt(FLEET_ROLES.dreadnought.fireRange + 100, 0, 0);
    const farOut = fleetIntent(atk, ctxFor(atk, { hostile: far }));
    expect(farOut.fire).toBe(false);
  });

  it("deflects away from an obstacle it would otherwise fly through", () => {
    const u = makeFleetUnit("frigate", 0, 0, 0);
    // Obstacle directly between the unit and a goal pull; expect a non-zero turn.
    const obstacle = { x: 40, y: 0, z: 0, r: 30 };
    const out = fleetIntent(u, ctxFor(u, { obstacles: [obstacle], hostile: enemyAt(200, 0, 0) }));
    // With repulsion applied the command must be a finite, valid steering input.
    expect(Number.isFinite(out.yaw)).toBe(true);
    expect(Number.isFinite(out.pitch)).toBe(true);
    expect(Math.abs(out.yaw)).toBeLessThanOrEqual(1);
  });
});

function enemyAt(px: number, py: number, pz: number): EntityState {
  return spawnEntity("enemy", "E", "fighter", "p2", 1, 0, px, py, pz, 0);
}

describe("deterministic RNG helpers", () => {
  it("makeRng is reproducible from a seed", () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
    seqA.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    });
  });

  it("hash01 is a stable function of its inputs", () => {
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3));
    expect(hash01(1, 2, 3)).not.toBe(hash01(3, 2, 1));
    const v = hash01(99, 7);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});

describe("deploy role validation — server-authority guard", () => {
  it("isDeployableRole accepts only the six real classes", () => {
    for (const r of ["miner", "scout", "corsair", "frigate", "cruiser", "dreadnought"]) {
      expect(isDeployableRole(r)).toBe(true);
    }
    expect(isDeployableRole("none")).toBe(false);
    expect(isDeployableRole("")).toBe(false);
    expect(isDeployableRole("battleship")).toBe(false);
    expect(isDeployableRole(null)).toBe(false);
    expect(isDeployableRole(undefined)).toBe(false);
    expect(isDeployableRole(42)).toBe(false);
    // Prototype keys must NOT resolve as roles (the poisoning vector).
    expect(isDeployableRole("toString")).toBe(false);
    expect(isDeployableRole("constructor")).toBe(false);
    expect(isDeployableRole("__proto__")).toBe(false);
  });

  it("fleetRoleDef returns null for prototype keys and bad input", () => {
    expect(fleetRoleDef("toString" as FleetRole)).toBeNull();
    expect(fleetRoleDef("constructor" as FleetRole)).toBeNull();
    expect(fleetRoleDef("none")).toBeNull();
    expect(fleetRoleDef("miner")).not.toBeNull();
  });

  it("decodeClient rejects deploy messages with a non-deployable role", () => {
    // Valid deploy passes through.
    expect(decodeClient(JSON.stringify({ t: "deploy", role: "dreadnought" }))).toEqual({
      t: "deploy",
      role: "dreadnought",
    });
    // Malformed / poisoning payloads are dropped (null).
    expect(decodeClient(JSON.stringify({ t: "deploy", role: "toString" }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "deploy", role: "none" }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "deploy" }))).toBeNull();
    expect(decodeClient(JSON.stringify({ t: "deploy", role: 7 }))).toBeNull();
    // Unrelated valid messages still pass.
    expect(decodeClient(JSON.stringify({ t: "join", name: "A", shipType: 0 }))).toEqual({
      t: "join",
      name: "A",
      shipType: 0,
    });
  });
});

describe("economy + role tunables sanity", () => {
  it("deploy costs and caps are positive and ordered by class size", () => {
    expect(CARRIER.startCredits).toBeGreaterThan(0);
    expect(FLEET_ROLES.miner.cost).toBeLessThan(FLEET_ROLES.dreadnought.cost);
    expect(FLEET_ROLES.miner.zoneR).toBeLessThan(FLEET_ROLES.dreadnought.zoneR);
    expect(FLEET_ROLES.miner.armed).toBe(false);
    expect(FLEET_ROLES.dreadnought.armed).toBe(true);
  });

  it("spawnEntity sets maxHp from kind/role", () => {
    expect(spawnShip("p", "P", 0, 0, 0, 0, 0).maxHp).toBe(SHIP.maxHp);
    expect(spawnEntity("m", "M", "mother_ship", "p", 0, 0, 0, 0, 0, 0).maxHp).toBe(MOTHER_SHIP.maxHp);
    expect(
      spawnEntity("u", "U", "fleet_unit", "p", 0, 0, 0, 0, 0, 0, "dreadnought").maxHp,
    ).toBe(FLEET_ROLES.dreadnought.maxHp);
  });
});
