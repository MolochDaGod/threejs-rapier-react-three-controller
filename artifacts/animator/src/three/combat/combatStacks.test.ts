import { describe, expect, it } from "vitest";
import {
  CombatStatusBoard,
  PLAYER_STATUS_KEY,
  blockStaminaFromDamage,
  damageProfileForWeapon,
  hostileProcForProfile,
  selfProcForProfile,
} from "./combatStacks";

describe("blockStaminaFromDamage", () => {
  it("maps 5 damage → 1 stamina", () => {
    expect(blockStaminaFromDamage(5)).toBe(1);
    expect(blockStaminaFromDamage(1)).toBe(1);
    expect(blockStaminaFromDamage(11)).toBe(3);
    expect(blockStaminaFromDamage(0)).toBe(0);
  });
});

describe("damage profiles", () => {
  it("classifies blade / blunt / point / elements", () => {
    expect(damageProfileForWeapon("sword")).toBe("blade");
    expect(damageProfileForWeapon("hammer")).toBe("blunt");
    expect(damageProfileForWeapon("spear")).toBe("point");
    expect(damageProfileForWeapon("bow")).toBe("point");
    expect(damageProfileForWeapon("staffIce")).toBe("ice");
    expect(damageProfileForWeapon("staffStorm")).toBe("storm");
    expect(damageProfileForWeapon("staffArcane")).toBe("arcane");
  });

  it("routes procs by profile", () => {
    expect(hostileProcForProfile("blade")).toBe("bleeding");
    expect(hostileProcForProfile("blunt")).toBe("bluntTrauma");
    expect(hostileProcForProfile("ice")).toBe("frosted");
    expect(hostileProcForProfile("fire")).toBe("smoldering");
    expect(selfProcForProfile("point")).toBe("shred");
    expect(selfProcForProfile("storm")).toBe("chargedStorm");
    expect(selfProcForProfile("arcane")).toBe("arcaneCharge");
  });
});

describe("EntityStacks / CombatStatusBoard", () => {
  it("frosted: 1 stack/s, promote frozen on apply at max", () => {
    const board = new CombatStatusBoard();
    const id = 7;
    for (let i = 0; i < 5; i++) {
      const r = board.apply(id, "frosted");
      expect(r.stacked).toBe(true);
      expect(r.stacks).toBe(i + 1);
      // Advance past 1s interval
      board.update(1.01);
    }
    expect(board.getStacks(id, "frosted")).toBe(5);
    const promo = board.apply(id, "frosted");
    expect(promo.promoted).toBe("frozen");
    expect(board.has(id, "frosted")).toBe(false);
    expect(board.has(id, "frozen")).toBe(true);
  });

  it("rate-limits frosted within 1s", () => {
    const board = new CombatStatusBoard();
    expect(board.apply(1, "frosted").stacks).toBe(1);
    expect(board.apply(1, "frosted").stacked).toBe(false);
    expect(board.getStacks(1, "frosted")).toBe(1);
    board.update(1.01);
    expect(board.apply(1, "frosted").stacks).toBe(2);
  });

  it("blunt trauma promotes to stun at max", () => {
    const board = new CombatStatusBoard();
    for (let i = 0; i < 5; i++) {
      board.apply(2, "bluntTrauma");
      board.update(0.6);
    }
    const r = board.apply(2, "bluntTrauma");
    expect(r.promoted).toBe("stunned");
    expect(board.has(2, "bluntTrauma")).toBe(false);
  });

  it("shred on player reduces stamina cost mul; freeSkill zeros it", () => {
    const board = new CombatStatusBoard();
    // Build to max stacks (6), then one more apply promotes freeSkill.
    for (let i = 0; i < 6; i++) {
      board.apply(PLAYER_STATUS_KEY, "shred");
      board.update(0.4);
    }
    expect(board.getStacks(PLAYER_STATUS_KEY, "shred")).toBe(6);
    expect(board.staminaCostMul()).toBeLessThan(1);
    board.apply(PLAYER_STATUS_KEY, "shred");
    expect(board.has(PLAYER_STATUS_KEY, "freeSkill")).toBe(true);
    expect(board.staminaCostMul()).toBe(0);
  });

  it("arcane charge promotes blink at 3", () => {
    const board = new CombatStatusBoard();
    board.apply(PLAYER_STATUS_KEY, "arcaneCharge");
    board.update(0.5);
    board.apply(PLAYER_STATUS_KEY, "arcaneCharge");
    board.update(0.5);
    board.apply(PLAYER_STATUS_KEY, "arcaneCharge");
    // 3 stacks — next apply promotes
    const r = board.apply(PLAYER_STATUS_KEY, "arcaneCharge");
    expect(r.promoted).toBe("arcaneBlink");
  });

  it("speed mul from frosted stacks", () => {
    const board = new CombatStatusBoard();
    board.apply(3, "frosted");
    board.update(1.01);
    board.apply(3, "frosted");
    expect(board.speedMul(3)).toBeCloseTo(0.98, 3);
  });
});
