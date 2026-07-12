import { describe, expect, it } from "vitest";
import { CompositeGoal, Goal, type GoalStatus } from "./Goal";

/** A leaf goal that records lifecycle calls and finishes after N ticks. */
class CountGoal extends Goal<string[]> {
  constructor(
    owner: string[],
    private readonly name: string,
    private ticks: number,
    private readonly outcome: "completed" | "failed" = "completed",
  ) {
    super(owner);
  }
  activate() {
    this.owner.push(`${this.name}:activate`);
  }
  process(_dt: number): GoalStatus {
    this.owner.push(`${this.name}:process`);
    this.ticks -= 1;
    if (this.ticks <= 0) return this.outcome === "completed" ? this.setCompleted() : this.setFailed();
    return this.setActive();
  }
  terminate() {
    this.owner.push(`${this.name}:terminate`);
  }
}

class Sequence extends CompositeGoal<string[]> {
  process(dt: number) {
    return this.processSubgoals(dt);
  }
}

describe("Goal lifecycle", () => {
  it("activates only once on first tick and reports status", () => {
    const log: string[] = [];
    const g = new CountGoal(log, "a", 2);
    expect(g.status).toBe("inactive");
    g.activateIfInactive();
    expect(g.status).toBe("active");
    g.activateIfInactive(); // no-op the second time
    expect(log).toEqual(["a:activate"]);
    expect(g.process(0.1)).toBe("active");
    expect(g.finished).toBe(false);
    expect(g.process(0.1)).toBe("completed");
    expect(g.finished).toBe(true);
  });

  it("marks failed outcomes finished too", () => {
    const log: string[] = [];
    const g = new CountGoal(log, "x", 1, "failed");
    g.activateIfInactive();
    expect(g.process(0.1)).toBe("failed");
    expect(g.finished).toBe(true);
  });
});

describe("CompositeGoal subgoal stack", () => {
  it("runs subgoals LIFO and pops finished ones, completing when empty", () => {
    const log: string[] = [];
    const seq = new Sequence(log);
    // addSubgoal unshifts, so push second-to-run first, top-to-run last.
    seq.addSubgoal(new CountGoal(log, "second", 1));
    seq.addSubgoal(new CountGoal(log, "first", 1));
    expect(seq.currentSubgoal).not.toBeNull();

    // Tick 1: first runs + completes, but second still queued → composite active.
    expect(seq.process(0.1)).toBe("active");
    // Tick 2: first is popped (terminate), second activates + runs + completes.
    //         it's the last one, so composite reports completed.
    expect(seq.process(0.1)).toBe("completed");

    expect(log).toEqual([
      "first:activate",
      "first:process",
      "first:terminate",
      "second:activate",
      "second:process",
    ]);
  });

  it("terminate() drops all remaining subgoals", () => {
    const log: string[] = [];
    const seq = new Sequence(log);
    seq.addSubgoal(new CountGoal(log, "keep", 5));
    seq.process(0.1); // activate it
    log.length = 0;
    seq.terminate();
    expect(log).toEqual(["keep:terminate"]);
    expect(seq.currentSubgoal).toBeNull();
  });
});
