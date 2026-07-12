import type { CombatStateName } from "@workspace/epicfight";

/**
 * Pure weak-point model for the Danger Room's "yellow bot" boss. The boss has a
 * two-phase weak-point flow that rides ENTIRELY on its single
 * {@link CombatController} (no parallel HP/poise maths):
 *
 *  - **Armoured**: only the **knees** are exposed. Hits there barely chip health
 *    but pour poise damage in, so enough knee focus breaks the CC's poise.
 *  - **Downed**: while the CC sits in its `fallen` knock-down (the host drops it
 *    there the instant poise breaks), the **head + chest** open up and take
 *    large bonus damage — stacked on top of the CC's own crit window.
 *
 * The phase is DERIVED from the live CC state, so this module owns no timers; it
 * just maps state → phase and exposes the per-phase multipliers + geometry the
 * host applies to each `applyAttack` payload. All of it is pure + unit-tested.
 */
export type WeakPoint = "knees" | "head" | "chest";
export type BossPhase = "armored" | "downed";

/** Which weak points are exposed (tab-targetable, bonus-damage) per phase. */
export const EXPOSED_WEAK_POINTS: Record<BossPhase, readonly WeakPoint[]> = {
  armored: ["knees"],
  downed: ["head", "chest"],
};

/**
 * The boss is "downed" (head/chest exposed) only while its CC is in the `fallen`
 * knock-down; every other state is the armoured stance (knees exposed).
 */
export function bossPhaseFromState(state: CombatStateName): BossPhase {
  return state === "fallen" ? "downed" : "armored";
}

/** The weak points exposed in a phase, in tab-cycle order. */
export function exposedWeakPoints(phase: BossPhase): readonly WeakPoint[] {
  return EXPOSED_WEAK_POINTS[phase];
}

/**
 * Resolve the active weak point from a (possibly stale) cycle index + the
 * current phase. The index is wrapped into the phase's exposed set, so a stale
 * index carried across a phase change still maps to a valid weak point.
 */
export function activeWeakPoint(phase: BossPhase, index: number): WeakPoint {
  const exposed = EXPOSED_WEAK_POINTS[phase];
  const i = ((index % exposed.length) + exposed.length) % exposed.length;
  return exposed[i];
}

/**
 * Advance the weak-point tab cycle within the current phase. Returns the next
 * index and whether it wrapped past the last exposed point — the host uses
 * `wrapped` to decide when Tab should move OFF the boss onto the next enemy.
 */
export function advanceWeakPoint(
  phase: BossPhase,
  index: number,
): { index: number; wrapped: boolean } {
  const n = EXPOSED_WEAK_POINTS[phase].length;
  const cur = ((index % n) + n) % n;
  const next = cur + 1;
  if (next >= n) return { index: 0, wrapped: true };
  return { index: next, wrapped: false };
}

/** Damage + poise multipliers applied to a hit on a weak point in a phase. */
export interface WeakPointMod {
  damageMul: number;
  poiseMul: number;
}

/**
 * Per-phase weak-point multipliers applied to an incoming attack payload BEFORE
 * the CC resolves it (so all damage still flows through `applyAttack`):
 *
 *  - Armoured knees: little damage, heavy poise (the intended break path).
 *  - Armoured head/chest: heavily resisted (the armour holds) — discourages
 *    spraying the body before the knees give.
 *  - Downed head/chest: large bonus damage (the CC crit window stacks on top);
 *    no further poise (the boss is already broken).
 */
export function weakPointMod(phase: BossPhase, wp: WeakPoint): WeakPointMod {
  if (phase === "armored") {
    return wp === "knees"
      ? { damageMul: 0.5, poiseMul: 2.6 }
      : { damageMul: 0.15, poiseMul: 0.3 };
  }
  if (wp === "head") return { damageMul: 3.2, poiseMul: 0 };
  if (wp === "chest") return { damageMul: 2.2, poiseMul: 0 };
  return { damageMul: 0.5, poiseMul: 0 };
}

/**
 * Short on-screen coaching line for the boss bar, derived purely from the phase.
 * Teaches the skill loop: pour poise into the knees to stagger the armoured boss,
 * then burst the exposed head/chest during the downed window.
 */
export function weakPointHint(phase: BossPhase): string {
  return phase === "downed"
    ? "Downed! Strike the head & chest!"
    : "Break the knees to stagger";
}

/**
 * Local (model-space, normalized 2 m tall with feet at Y=0) height of a weak
 * point — used to place the floating marker. Scaled by the boss group's scale
 * at the call site so it tracks an enlarged boss.
 */
export function weakPointLocalHeight(wp: WeakPoint): number {
  switch (wp) {
    case "knees":
      return 0.55;
    case "chest":
      return 1.15;
    case "head":
      return 1.85;
  }
}
