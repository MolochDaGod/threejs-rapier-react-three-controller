import { describe, expect, it } from "vitest";
import { Goal } from "./Goal";
import { type GoalEvaluator, Think } from "./Think";

class TagGoal extends Goal<{ activations: number }> {
  constructor(
    owner: { activations: number },
    private readonly stayActive = true,
  ) {
    super(owner);
  }
  activate() {
    this.owner.activations += 1;
  }
  process() {
    return this.stayActive ? this.setActive() : this.setCompleted();
  }
}

function evaluator(
  tag: string,
  desirability: number,
  stayActive = true,
): GoalEvaluator<{ activations: number }> {
  return {
    tag,
    calculateDesirability: () => desirability,
    setGoal: (brain, owner) => brain.switchGoal(tag, () => new TagGoal(owner, stayActive)),
  };
}

describe("Think arbitration", () => {
  it("installs the most desirable evaluator's goal", () => {
    const owner = { activations: 0 };
    const brain = new Think(owner);
    brain.addEvaluator(evaluator("low", 0.2));
    brain.addEvaluator(evaluator("high", 0.9));
    brain.process(0.1);
    expect(brain.activeTag).toBe("high");
  });

  it("does not restart the active goal when it keeps winning (switchGoal no-op)", () => {
    const owner = { activations: 0 };
    const brain = new Think(owner);
    brain.addEvaluator(evaluator("only", 0.8));
    brain.process(0.1);
    brain.process(0.1);
    brain.process(0.1);
    expect(brain.activeTag).toBe("only");
    expect(owner.activations).toBe(1); // activated once, not every tick
  });

  it("preempts the active goal when another becomes more desirable", () => {
    const owner = { activations: 0 };
    const brain = new Think(owner);
    let aDesire = 0.9;
    brain.addEvaluator({
      tag: "a",
      calculateDesirability: () => aDesire,
      setGoal: (b, o) => b.switchGoal("a", () => new TagGoal(o)),
    });
    brain.addEvaluator(evaluator("b", 0.5));
    brain.process(0.1);
    expect(brain.activeTag).toBe("a");
    aDesire = 0.1; // a collapses, b should now win
    brain.process(0.1);
    expect(brain.activeTag).toBe("b");
  });

  it("gives the active goal a commit bonus so near-ties don't thrash", () => {
    const owner = { activations: 0 };
    const brain = new Think(owner, 0.05);
    brain.addEvaluator(evaluator("incumbent", 0.5));
    brain.addEvaluator(evaluator("challenger", 0.52));
    brain.process(0.1);
    expect(brain.activeTag).toBe("challenger"); // 0.52 > 0.5 initially
    // Now make them swap so the bonus matters: incumbent=0.55, challenger=0.5.
    // The challenger holds with +0.05 bonus → 0.55 ties; incumbent 0.55 does NOT
    // exceed it, so the challenger keeps the goal (no thrash).
    brain.reset();
    const owner2 = { activations: 0 };
    const brain2 = new Think(owner2, 0.05);
    let incumbentDesire = 0.6;
    brain2.addEvaluator({
      tag: "incumbent",
      calculateDesirability: () => incumbentDesire,
      setGoal: (b, o) => b.switchGoal("incumbent", () => new TagGoal(o)),
    });
    brain2.addEvaluator(evaluator("rival", 0.5));
    brain2.process(0.1);
    expect(brain2.activeTag).toBe("incumbent");
    incumbentDesire = 0.47; // dips just below rival, but within commit bonus
    brain2.process(0.1);
    expect(brain2.activeTag).toBe("incumbent"); // 0.47+0.05=0.52 > 0.5 → holds
    incumbentDesire = 0.4; // now clearly worse than rival even with the bonus
    brain2.process(0.1);
    expect(brain2.activeTag).toBe("rival");
  });

  it("reset() clears the active goal", () => {
    const owner = { activations: 0 };
    const brain = new Think(owner);
    brain.addEvaluator(evaluator("g", 0.8));
    brain.process(0.1);
    expect(brain.activeTag).toBe("g");
    brain.reset();
    expect(brain.activeTag).toBeNull();
  });
});
