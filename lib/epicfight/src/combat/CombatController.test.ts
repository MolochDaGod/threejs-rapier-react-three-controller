import { describe, it, expect } from "vitest";
import { CombatController } from "./CombatController.js";
import { attackMove, defaultCombatConfig, makeMoveset } from "./movesets.js";
import { resolveDefense, PARRY_DEFLECT_WINDOW, PARRY_PERFECT_WINDOW, DODGE_PUNISH_WINDOW } from "./defense.js";
import type { AttackMove, AttackPayload, CombatConfig, CombatEvents, DefensePayload, Moveset } from "./types.js";

function move(id: string, over: Partial<AttackMove> = {}): AttackMove {
  return attackMove(id, id, {
    duration: 1.0,
    windup: 0.2,
    active: 0.1,
    damage: 10,
    staminaCost: 14,
    poiseDamage: 20,
    force: 1,
    comboWindowStart: 0.25,
    ...over,
  });
}

function setup(
  cfgOver: Partial<CombatConfig> = {},
  msOver?: Moveset,
  events: CombatEvents = {},
) {
  const cfg = defaultCombatConfig(cfgOver);
  const ms = msOver ?? makeMoveset("test", [move("light1"), move("light2")]);
  return new CombatController(cfg, ms, events);
}

/** Advance the controller in small steps so phase transitions fire in order. */
function advance(c: CombatController, seconds: number, step = 1 / 60): void {
  let t = 0;
  while (t < seconds - 1e-9) {
    const dt = Math.min(step, seconds - t);
    c.update(dt);
    t += dt;
  }
}

/** Minimal attack payload. */
function atk(over: Partial<AttackPayload> = {}): AttackPayload {
  return { force: 1, damage: 10, poiseDamage: 20, shieldBreak: false, ...over };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Legacy attack / combo / stagger / death tests (unchanged)
// ═══════════════════════════════════════════════════════════════════════════════

describe("CombatController attacks", () => {
  it("starts a move, spends stamina, and enters the attack state", () => {
    const starts: number[] = [];
    const c = setup({}, undefined, { onMoveStart: (_m, i) => starts.push(i) });
    const before = c.getStamina();
    c.lightAttack();
    expect(c.getState()).toBe("attack");
    expect(starts).toEqual([0]);
    expect(c.getStamina()).toBeLessThan(before);
  });

  it("opens and closes the hit window at windup/active boundaries", () => {
    const active: string[] = [];
    const ended: string[] = [];
    const c = setup({}, undefined, {
      onHitActive: (m) => active.push(m.id),
      onHitEnd: (m) => ended.push(m.id),
    });
    c.lightAttack();
    advance(c, 0.15);
    expect(c.isHitActive()).toBe(false); // still in windup (0.2)
    advance(c, 0.1); // ~0.25 → inside active (0.2..0.3)
    expect(c.isHitActive()).toBe(true);
    expect(active).toEqual(["light1"]);
    advance(c, 0.1); // ~0.35 → past active end
    expect(c.isHitActive()).toBe(false);
    expect(ended).toEqual(["light1"]);
  });

  it("chains to the next move when an input is buffered within the combo window", () => {
    const starts: { id: string; i: number }[] = [];
    const c = setup({}, undefined, { onMoveStart: (m, i) => starts.push({ id: m.id, i }) });
    c.lightAttack();
    advance(c, 0.3); // past comboWindowStart (0.25)
    c.lightAttack(); // buffered
    advance(c, 1 / 30); // next update consumes the buffer
    expect(c.getComboIndex()).toBe(1);
    expect(starts.map((s) => s.id)).toEqual(["light1", "light2"]);
  });

  it("wraps the combo chain when you keep attacking", () => {
    const c = setup();
    c.lightAttack();
    advance(c, 0.3);
    c.lightAttack();
    advance(c, 0.3);
    c.lightAttack();
    advance(c, 1 / 30);
    expect(c.getComboIndex()).toBe(2);
    expect(c.getCurrentMove()?.id).toBe("light1"); // index 2 % 2 == 0
  });

  it("ignores a buffered input that can't chain (missing heavy chain) and finishes normally", () => {
    const ended: string[] = [];
    const starts: string[] = [];
    const c = setup({}, makeMoveset("light-only", [move("light1")]), {
      onHitEnd: (m) => ended.push(m.id),
      onMoveStart: (m) => starts.push(m.id),
    });
    c.lightAttack();
    advance(c, 0.3);
    c.heavyAttack(); // buffered, but no heavy chain
    advance(c, 0.8); // finish the move
    expect(c.getState()).toBe("idle");
    expect(starts).toEqual(["light1"]);
    expect(ended).toEqual(["light1"]);
  });

  it("ignores a buffered chain step it can't afford and finishes normally", () => {
    const starts: string[] = [];
    const c = setup({ maxStamina: 20, staminaRegenPerSec: 0 }, undefined, {
      onMoveStart: (m, i) => starts.push(`${m.id}:${i}`),
    });
    c.lightAttack();
    advance(c, 0.3);
    c.lightAttack(); // buffered, but can't afford light2
    advance(c, 0.8);
    expect(c.getState()).toBe("idle");
    expect(starts).toEqual(["light1:0"]);
  });

  it("returns to idle when the move finishes with no buffered input", () => {
    const c = setup();
    c.lightAttack();
    advance(c, 1.05);
    expect(c.getState()).toBe("idle");
    expect(c.getComboIndex()).toBe(-1);
  });

  it("refuses to attack without enough stamina", () => {
    const blocked: number[] = [];
    const c = setup({ maxStamina: 10, staminaRegenPerSec: 0 }, undefined, {
      onStaminaBlocked: () => blocked.push(1),
    });
    c.lightAttack(); // costs 14 > 10
    expect(c.getState()).toBe("idle");
    expect(blocked.length).toBe(1);
  });
});

describe("CombatController dodge + i-frames", () => {
  it("evades hits during the i-frame window and takes them outside it", () => {
    const c = setup();
    c.dodge({ x: 0, z: 1 });
    expect(c.getState()).toBe("dodge");
    advance(c, 0.1); // inside iframe (0.06..0.34)
    expect(c.isInvincible()).toBe(true);
    const evaded = c.applyHit(30, 99);
    expect(evaded.evaded).toBe(true);
    expect(c.getHealth()).toBe(100);

    advance(c, 0.3); // ~0.4 → past iframe, still alive
    expect(c.isInvincible()).toBe(false);
  });

  it("can dodge-cancel during attack recovery but not during windup/active", () => {
    const c = setup();
    c.lightAttack();
    advance(c, 0.15); // windup
    c.dodge();
    expect(c.getState()).toBe("attack"); // refused
    advance(c, 0.25); // ~0.4 → recovery (active ends at 0.3)
    c.dodge();
    expect(c.getState()).toBe("dodge"); // allowed
  });
});

describe("CombatController poise, stagger, super armor, death", () => {
  it("staggers when poise is depleted and resets the combo", () => {
    const staggers: number[] = [];
    const c = setup({ maxPoise: 20 }, undefined, { onStagger: () => staggers.push(1) });
    c.lightAttack();
    advance(c, 0.1);
    const r = c.applyHit(5, 25); // poiseDamage 25 > 20
    expect(r.staggered).toBe(true);
    expect(c.getState()).toBe("stagger");
    expect(staggers.length).toBe(1);
    advance(c, 0.7);
    expect(c.getState()).toBe("idle");
  });

  it("does not stagger while a super-armor move is active", () => {
    const ms = makeMoveset("sa", [move("heavy1", { superArmor: true })]);
    const c = setup({ maxPoise: 20 }, ms);
    c.lightAttack();
    advance(c, 0.1);
    const r = c.applyHit(5, 99);
    expect(r.staggered).toBe(false);
    expect(c.getState()).toBe("attack");
  });

  it("dies at zero health and ignores further input", () => {
    const deaths: number[] = [];
    const c = setup({}, undefined, { onDeath: () => deaths.push(1) });
    const r = c.applyHit(200, 0);
    expect(r.killed).toBe(true);
    expect(c.getState()).toBe("dead");
    expect(deaths.length).toBe(1);
    c.lightAttack();
    expect(c.getState()).toBe("dead");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Pure resolveDefense outcome tests (no controller, no state side-effects)
// ═══════════════════════════════════════════════════════════════════════════════

describe("resolveDefense — parry outcomes", () => {
  const baseAtk: AttackPayload = { force: 1, damage: 10, poiseDamage: 20 };

  it("returns perfectParry and sets attackerReaction=parried for a precise timing", () => {
    const def: DefensePayload = { action: "parry", force: 2, age: PARRY_PERFECT_WINDOW * 0.5 };
    const r = resolveDefense(baseAtk, def, false);
    expect(r.outcome).toBe("perfectParry");
    expect(r.damageDealt).toBe(0);
    expect(r.attackerReaction).toBe("parried");
    expect(r.defenderReaction).toBe("none");
  });

  it("returns deflect for age inside the deflect window but not perfect window", () => {
    const def: DefensePayload = {
      action: "parry",
      force: 2,
      age: (PARRY_PERFECT_WINDOW + PARRY_DEFLECT_WINDOW) / 2,
    };
    const r = resolveDefense(baseAtk, def, false);
    expect(r.outcome).toBe("deflect");
    expect(r.damageDealt).toBe(0);
  });

  it("returns hit when parry timing is outside the deflect window", () => {
    const def: DefensePayload = { action: "parry", force: 2, age: PARRY_DEFLECT_WINDOW + 0.1 };
    const r = resolveDefense(baseAtk, def, false);
    expect(r.outcome).toBe("hit");
    expect(r.damageDealt).toBe(baseAtk.damage);
  });

  it("returns hit (partial damage) when inside deflect window but attacker force > defender force", () => {
    const strongAtk: AttackPayload = { force: 5, damage: 20, poiseDamage: 30 };
    const def: DefensePayload = {
      action: "parry",
      force: 1,
      age: (PARRY_PERFECT_WINDOW + PARRY_DEFLECT_WINDOW) / 2,
    };
    const r = resolveDefense(strongAtk, def, false);
    expect(r.outcome).toBe("hit");
    expect(r.damageDealt).toBe(Math.round(strongAtk.damage * 0.5));
  });
});

describe("resolveDefense — block outcomes", () => {
  const baseAtk: AttackPayload = { force: 1, damage: 10, poiseDamage: 20 };

  it("returns blockStop when defender force >= attack force", () => {
    const def: DefensePayload = { action: "block", force: 2, age: 0 };
    const r = resolveDefense(baseAtk, def, false);
    expect(r.outcome).toBe("blockStop");
    expect(r.damageDealt).toBe(0);
    expect(r.defenderReaction).toBe("none");
    expect(r.critWindow).toBe(false);
  });

  it("returns blockStop + stunned defender on shieldBreak attack", () => {
    const sbAtk: AttackPayload = { force: 1, damage: 10, poiseDamage: 20, shieldBreak: true };
    const def: DefensePayload = { action: "block", force: 99, age: 0 };
    const r = resolveDefense(sbAtk, def, false);
    expect(r.outcome).toBe("blockStop");
    expect(r.defenderReaction).toBe("stunned");
    expect(r.critWindow).toBe(true);
    expect(r.damageDealt).toBe(0);
  });

  it("returns hit when attack force exceeds block force", () => {
    const strongAtk: AttackPayload = { force: 10, damage: 30, poiseDamage: 50 };
    const def: DefensePayload = { action: "block", force: 2, age: 0 };
    const r = resolveDefense(strongAtk, def, false);
    expect(r.outcome).toBe("hit");
    expect(r.damageDealt).toBe(strongAtk.damage);
  });
});

describe("resolveDefense — dodge outcomes", () => {
  const baseAtk: AttackPayload = { force: 1, damage: 10, poiseDamage: 20 };

  it("returns dodgePunish within the punish window", () => {
    const def: DefensePayload = { action: "dodge", force: 0, age: DODGE_PUNISH_WINDOW * 0.5 };
    const r = resolveDefense(baseAtk, def, false);
    expect(r.outcome).toBe("dodgePunish");
    expect(r.attackerReaction).toBe("dodgePunished");
    expect(r.damageDealt).toBe(0);
  });

  it("returns dodgeEvade when invincible and outside punish window", () => {
    const def: DefensePayload = { action: "dodge", force: 0, age: DODGE_PUNISH_WINDOW + 0.1 };
    const r = resolveDefense(baseAtk, def, /*invincible*/ true);
    expect(r.outcome).toBe("dodgeEvade");
    expect(r.damageDealt).toBe(0);
  });

  it("returns hit when outside punish window and not invincible", () => {
    const def: DefensePayload = { action: "dodge", force: 0, age: DODGE_PUNISH_WINDOW + 0.1 };
    const r = resolveDefense(baseAtk, def, false);
    expect(r.outcome).toBe("hit");
    expect(r.damageDealt).toBe(baseAtk.damage);
  });
});

describe("resolveDefense — elastic-collision (equal forces)", () => {
  it("resolves as deflect when attack and defense force are equal", () => {
    const eqAtk: AttackPayload = { force: 3, damage: 20, poiseDamage: 30 };
    const def: DefensePayload = { action: "parry", force: 3, age: 1.0 }; // outside deflect window normally
    const r = resolveDefense(eqAtk, def, false);
    expect(r.outcome).toBe("deflect");
    expect(r.damageDealt).toBe(0);
    expect(r.attackerReaction).toBe("none");
  });

  it("does NOT deflect when action is none (elastic rule only applies during an active defense)", () => {
    const eqAtk: AttackPayload = { force: 3, damage: 20, poiseDamage: 30 };
    const def: DefensePayload = { action: "none", force: 3, age: 0 };
    const r = resolveDefense(eqAtk, def, false);
    expect(r.outcome).toBe("hit");
  });
});

describe("resolveDefense — no defense", () => {
  it("returns a plain hit with full damage when action is none", () => {
    const a: AttackPayload = { force: 1, damage: 15, poiseDamage: 10 };
    const d: DefensePayload = { action: "none", force: 0, age: 0 };
    const r = resolveDefense(a, d, false);
    expect(r.outcome).toBe("hit");
    expect(r.damageDealt).toBe(15);
    expect(r.poiseDamageDealt).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CombatController defensive integration tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("CombatController.parry()", () => {
  it("enters parry state and fires onParry", () => {
    const parried: number[] = [];
    const c = setup({}, undefined, { onParry: () => parried.push(1) });
    c.parry();
    expect(c.getState()).toBe("parry");
    expect(parried.length).toBe(1);
  });

  it("resolves perfectParry when applyAttack is called within the perfect window", () => {
    const outcomes: string[] = [];
    const c = setup({}, undefined, { onDefensiveOutcome: (r) => outcomes.push(r.outcome) });
    c.parry();
    advance(c, PARRY_PERFECT_WINDOW * 0.5); // well inside window
    const result = c.applyAttack(atk({ force: 1 }));
    expect(result.outcome).toBe("perfectParry");
    expect(result.damageDealt).toBe(0);
    expect(result.attackerReaction).toBe("parried");
    expect(outcomes).toEqual(["perfectParry"]);
  });

  it("resolves deflect inside the deflect window", () => {
    const c = setup();
    c.parry();
    advance(c, (PARRY_PERFECT_WINDOW + PARRY_DEFLECT_WINDOW) / 2);
    const result = c.applyAttack(atk({ force: 1 }));
    expect(result.outcome).toBe("deflect");
  });

  it("resolves hit when parry window has expired", () => {
    const c = setup({ staminaRegenPerSec: 0 });
    c.parry();
    advance(c, PARRY_DEFLECT_WINDOW + 0.3);
    const result = c.applyAttack(atk({ force: 1, damage: 10 }));
    expect(result.outcome).toBe("hit");
    expect(c.getHealth()).toBeLessThan(100);
  });

  it("refuses parry during attack windup/active frames", () => {
    const c = setup();
    c.lightAttack();
    advance(c, 0.05); // during windup
    c.parry();
    expect(c.getState()).toBe("attack");
  });

  it("parry expires and returns to idle after the deflect window elapses", () => {
    const c = setup();
    c.parry();
    advance(c, PARRY_DEFLECT_WINDOW + 0.5);
    expect(c.getState()).toBe("idle");
  });
});

describe("CombatController.startBlock() / endBlock()", () => {
  it("enters block state and fires onBlock(true)", () => {
    const blockEvents: boolean[] = [];
    const c = setup({}, undefined, { onBlock: (a) => blockEvents.push(a) });
    c.startBlock();
    expect(c.getState()).toBe("block");
    expect(blockEvents).toEqual([true]);
  });

  it("resolves blockStop against a weaker attack", () => {
    const c = setup();
    c.startBlock();
    const result = c.applyAttack(atk({ force: 1 })); // block.force defaults to 2
    expect(result.outcome).toBe("blockStop");
    expect(result.damageDealt).toBe(0);
  });

  it("resolves hit when attack force exceeds block force", () => {
    const c = setup();
    c.startBlock();
    const result = c.applyAttack(atk({ force: 10, damage: 25 }));
    expect(result.outcome).toBe("hit");
    expect(c.getHealth()).toBeLessThan(100);
  });

  it("enters stunned state and opens crit window on a shieldBreak hit while blocking", () => {
    const stuns: number[] = [];
    const c = setup({}, undefined, { onStunned: () => stuns.push(1) });
    c.startBlock();
    const result = c.applyAttack(atk({ force: 1, shieldBreak: true }));
    expect(result.outcome).toBe("blockStop");
    expect(result.defenderReaction).toBe("stunned");
    expect(c.getState()).toBe("stunned");
    expect(c.hasCritWindow()).toBe(true);
    expect(stuns.length).toBe(1);
  });

  it("endBlock releases the block state and fires onBlock(false)", () => {
    const blockEvents: boolean[] = [];
    const c = setup({}, undefined, { onBlock: (a) => blockEvents.push(a) });
    c.startBlock();
    c.endBlock();
    expect(c.getState()).toBe("idle");
    expect(blockEvents).toEqual([true, false]);
  });

  it("block drops automatically when stamina is exhausted", () => {
    const c = setup({ maxStamina: 10, staminaRegenPerSec: 0, block: { staminaCostOnRaise: 0, staminaDrainPerSec: 20, force: 2 } });
    c.startBlock();
    expect(c.getState()).toBe("block");
    advance(c, 1.0); // drains all 10 stamina at 20/s → 0.5s
    expect(c.getState()).toBe("idle");
  });
});

describe("CombatController crit window", () => {
  it("next hit is upgraded to crit when fighter is in a vulnerable state", () => {
    const outcomes: string[] = [];
    const c = setup({}, undefined, { onDefensiveOutcome: (r) => outcomes.push(r.outcome) });
    // Put defender into a vulnerable state via applyVulnerableState.
    c.applyVulnerableState("stunned");
    expect(c.hasCritWindow()).toBe(true);
    // Now land a plain hit — should be upgraded.
    const result = c.applyAttack(atk({ force: 1, damage: 10 }));
    expect(result.outcome).toBe("crit");
    expect(result.damageDealt).toBeGreaterThan(10);
  });

  it("crit window expires after critWindowDuration", () => {
    const c = setup({ critWindowDuration: 0.5 });
    c.applyVulnerableState("fallen");
    expect(c.hasCritWindow()).toBe(true);
    advance(c, 0.6);
    expect(c.hasCritWindow()).toBe(false);
  });

  it("applyHit legacy path also applies the crit multiplier", () => {
    const c = setup();
    c.applyVulnerableState("parried");
    const r = c.applyHit(10, 0);
    expect(r.damage).toBeGreaterThan(10);
  });
});

describe("CombatController fallen / getUp", () => {
  it("enters fallen state when applyVulnerableState('fallen') is called", () => {
    const fallen: number[] = [];
    const c = setup({}, undefined, { onFallen: () => fallen.push(1) });
    c.applyVulnerableState("fallen");
    expect(c.getState()).toBe("fallen");
    expect(fallen.length).toBe(1);
  });

  it("getUp() is refused before fallenDuration elapses", () => {
    const c = setup({ fallenDuration: 1.0, getUpDuration: 0.8 });
    c.applyVulnerableState("fallen");
    advance(c, 0.5); // not enough time
    expect(c.getUp()).toBe(false);
    expect(c.getState()).toBe("fallen");
  });

  it("getUp() succeeds after fallenDuration and fires onGetUp", () => {
    const getUps: number[] = [];
    const c = setup({ fallenDuration: 0.5, getUpDuration: 0.4 }, undefined, {
      onGetUp: () => getUps.push(1),
    });
    c.applyVulnerableState("fallen");
    advance(c, 0.6); // past fallenDuration
    expect(c.getUp()).toBe(true);
    expect(c.getState()).toBe("getUp");
    expect(getUps.length).toBe(1);
    // After getUp finishes it returns to idle.
    advance(c, 0.5);
    expect(c.getState()).toBe("idle");
  });

  it("auto get-up triggers after fallenDuration + getUpDuration without manual input", () => {
    const c = setup({ fallenDuration: 0.3, getUpDuration: 0.4 });
    c.applyVulnerableState("fallen");
    advance(c, 0.3 + 0.4 + 0.2); // wait for auto get-up
    expect(c.getState()).toBe("idle");
  });
});

describe("CombatController stunned state", () => {
  it("enters stunned state and recovers to idle after stunnedDuration", () => {
    const stuns: number[] = [];
    const c = setup({ stunnedDuration: 0.5 }, undefined, { onStunned: () => stuns.push(1) });
    c.applyVulnerableState("stunned");
    expect(c.getState()).toBe("stunned");
    expect(stuns.length).toBe(1);
    advance(c, 0.6);
    expect(c.getState()).toBe("idle");
  });

  it("cannot attack or dodge while stunned", () => {
    const c = setup();
    c.applyVulnerableState("stunned");
    c.lightAttack();
    expect(c.getState()).toBe("stunned");
    c.dodge();
    expect(c.getState()).toBe("stunned");
  });
});

describe("CombatController.buildAttackPayload()", () => {
  it("returns null when not attacking", () => {
    const c = setup();
    expect(c.buildAttackPayload()).toBeNull();
  });

  it("returns the payload from the current move", () => {
    const c = setup(
      {},
      makeMoveset("test", [move("m", { damage: 25, poiseDamage: 15, force: 2 })]),
    );
    c.lightAttack();
    const p = c.buildAttackPayload();
    expect(p).not.toBeNull();
    expect(p!.force).toBe(2);
    expect(p!.damage).toBe(25);
    expect(p!.poiseDamage).toBe(15);
  });
});
