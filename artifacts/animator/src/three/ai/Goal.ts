/**
 * A tiny Yuka-style goal-driven AI core (renderer-agnostic, no Three.js / no
 * `@workspace` imports) so it stays unit-testable in the node test environment.
 *
 * A {@link Goal} is one unit of intent with an explicit lifecycle
 * (inactive → active → completed | failed). A {@link CompositeGoal} owns a
 * LIFO stack of subgoals and forwards processing to whichever subgoal is on
 * top, so complex behaviour decomposes into ordered atomic steps.
 */

export type GoalStatus = "inactive" | "active" | "completed" | "failed";

/** One unit of intent for an owner `O`, with an explicit status lifecycle. */
export abstract class Goal<O> {
  status: GoalStatus = "inactive";

  constructor(protected readonly owner: O) {}

  /** Called once when the goal first becomes active. Override to set up state. */
  activate(): void {}

  /** Called each tick while active. Override to drive behaviour + report status. */
  process(_dt: number): GoalStatus {
    return this.status;
  }

  /** Called once when the goal is removed (completed, failed, or replaced). */
  terminate(): void {}

  /** Activate (running {@link activate}) only if currently inactive. */
  activateIfInactive(): void {
    if (this.status === "inactive") {
      this.status = "active";
      this.activate();
    }
  }

  protected setActive(): GoalStatus {
    return (this.status = "active");
  }
  protected setCompleted(): GoalStatus {
    return (this.status = "completed");
  }
  protected setFailed(): GoalStatus {
    return (this.status = "failed");
  }

  get finished(): boolean {
    return this.status === "completed" || this.status === "failed";
  }
}

/** A goal that owns a stack of subgoals and forwards processing to the top one. */
export abstract class CompositeGoal<O> extends Goal<O> {
  readonly subgoals: Goal<O>[] = [];

  /** Push a subgoal onto the top of the stack (it runs before the others). */
  addSubgoal(g: Goal<O>): void {
    this.subgoals.unshift(g);
  }

  /** Terminate + drop every subgoal. */
  removeAllSubgoals(): void {
    for (const g of this.subgoals) g.terminate();
    this.subgoals.length = 0;
  }

  /** The subgoal currently on top of the stack (the one being processed). */
  get currentSubgoal(): Goal<O> | null {
    return this.subgoals[0] ?? null;
  }

  /**
   * Process the top subgoal, popping finished ones off the front first. Returns
   * "completed" only once the whole stack is empty; a finished subgoal that has
   * others queued behind it keeps the composite "active".
   */
  protected processSubgoals(dt: number): GoalStatus {
    let front = this.subgoals[0];
    while (front && front.finished) {
      front.terminate();
      this.subgoals.shift();
      front = this.subgoals[0];
    }

    if (front) {
      front.activateIfInactive();
      const status = front.process(dt);
      if (status === "completed" && this.subgoals.length > 1) return "active";
      return status;
    }
    return "completed";
  }

  terminate(): void {
    this.removeAllSubgoals();
  }
}
