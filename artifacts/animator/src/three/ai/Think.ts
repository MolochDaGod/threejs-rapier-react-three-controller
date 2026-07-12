/**
 * The arbitration layer of the goal-driven brain. {@link Think} is the top
 * {@link CompositeGoal}: each tick it re-scores its {@link GoalEvaluator}s,
 * lets the most desirable one install its goal (preempting the current one when
 * a different goal wins), then forwards processing to that goal.
 */

import { CompositeGoal, Goal, type GoalStatus } from "./Goal";

/** Scores how desirable its goal is right now and installs it when chosen. */
export interface GoalEvaluator<O> {
  /** Stable identifier so the brain can tell "same goal" from "new goal". */
  readonly tag: string;
  /** 0..n desirability for `owner` this tick (higher wins). */
  calculateDesirability(owner: O): number;
  /** Install this evaluator's goal onto the brain (via {@link Think.switchGoal}). */
  setGoal(brain: Think<O>, owner: O): void;
}

/**
 * The brain. Holds at most one top-level goal at a time (itself a goal, which
 * may decompose into subgoals). {@link arbitrate} picks the winning evaluator;
 * the active goal gets a small commitment bonus so near-ties don't thrash.
 */
export class Think<O> extends CompositeGoal<O> {
  private readonly evaluators: GoalEvaluator<O>[] = [];
  private currentTag: string | null = null;
  /** Desirability head-start the in-progress goal keeps, to resist flip-flop. */
  private readonly commitBonus: number;

  constructor(owner: O, commitBonus = 0.05) {
    super(owner);
    this.commitBonus = commitBonus;
  }

  addEvaluator(e: GoalEvaluator<O>): void {
    this.evaluators.push(e);
  }

  /** The tag of the goal currently being pursued (null when idle/uninstalled). */
  get activeTag(): string | null {
    return this.currentTag;
  }

  /** Score every evaluator and let the most desirable one install its goal. */
  arbitrate(): void {
    let best = -Infinity;
    let chosen: GoalEvaluator<O> | null = null;
    for (const e of this.evaluators) {
      let d = e.calculateDesirability(this.owner);
      if (e.tag === this.currentTag) d += this.commitBonus;
      if (d > best) {
        best = d;
        chosen = e;
      }
    }
    chosen?.setGoal(this, this.owner);
  }

  /**
   * Replace the current top goal with `factory()` UNLESS the brain is already
   * pursuing `tag` (then it's a no-op so an in-progress goal isn't restarted).
   */
  switchGoal(tag: string, factory: () => Goal<O>): void {
    if (this.currentTag === tag && this.subgoals.length > 0) return;
    this.removeAllSubgoals();
    this.addSubgoal(factory());
    this.currentTag = tag;
  }

  /** Drop the active goal so the next arbitration starts fresh. */
  reset(): void {
    this.removeAllSubgoals();
    this.currentTag = null;
  }

  process(dt: number): GoalStatus {
    this.arbitrate();
    const status = this.processSubgoals(dt);
    // The brain never finishes: a completed/failed goal just clears so the next
    // tick's arbitration re-picks.
    if (status === "completed" || status === "failed") this.currentTag = null;
    return this.setActive();
  }
}
