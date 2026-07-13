import { describe, it, expect } from "vitest";
import { stepAnimalBrain, type AnimalBrainInput } from "./animalBrain";

function base(over: Partial<AnimalBrainInput> = {}): AnimalBrainInput {
  return {
    state: "idle",
    stateT: 0,
    distPlayer: 20,
    detectRange: 8,
    temperament: "skittish",
    hurt: false,
    health: 20,
    atGoal: false,
    ...over,
  };
}

describe("stepAnimalBrain", () => {
  it("dies when health is zero", () => {
    const o = stepAnimalBrain(base({ health: 0 }), 0.1);
    expect(o.state).toBe("dead");
    expect(o.speedFrac).toBe(0);
  });

  it("flees when hurt", () => {
    const o = stepAnimalBrain(base({ hurt: true, health: 10 }), 0.1);
    expect(o.state).toBe("flee");
    expect(o.speedFrac).toBe(1);
    expect(o.fleeFromPlayer).toBe(true);
  });

  it("skittish animals flee when player is close", () => {
    const o = stepAnimalBrain(base({ distPlayer: 4, temperament: "skittish" }), 0.1);
    expect(o.state).toBe("flee");
  });

  it("docile animals only spook at closer range", () => {
    const mid = stepAnimalBrain(base({ distPlayer: 5, detectRange: 8, temperament: "docile" }), 0.1);
    expect(mid.state).not.toBe("flee");
    const close = stepAnimalBrain(base({ distPlayer: 2, detectRange: 8, temperament: "docile" }), 0.1);
    expect(close.state).toBe("flee");
  });

  it("idles then wanders after dwell time", () => {
    const o = stepAnimalBrain(base({ state: "idle", stateT: 2 }), 0.1);
    expect(o.state).toBe("wander");
    expect(o.pickNewGoal).toBe(true);
  });
});
