import type { StatusScope } from "./abilityTypes";

/**
 * Pure scope→targets routing for buff/debuff statuses.
 *
 * This module is deliberately PURE: it imports only an `import type` symbol
 * (erased at build time) and pulls in nothing from `three` or any
 * `@workspace/*` package, so the self→ally→aoe→hostile fallthrough that decides
 * WHO receives a status can be unit-tested in plain vitest without a WebGL
 * context. {@link Studio.applyStatusScoped} gathers the live target groups and
 * delegates the decision to {@link routeStatusScope}.
 */

/** The candidate target groups a routing decision can choose between. */
export interface StatusScopeTargets<T> {
  /** Every ally inside the friendly-AOE radius (used only by `aoeAlly`). */
  aoeAllies?: readonly T[];
  /** The currently selected ally (Shift+Tab), if any. */
  selectedAlly?: T | null;
  /** The currently selected hostile (Tab lock), if any. */
  selectedHostile?: T | null;
}

/** Which entities a status lands on once a scope has been resolved. */
export type StatusRouting<T> =
  /** No valid target: the status lands on the caster. */
  | { kind: "self" }
  /** A single resolved target group. */
  | { kind: "single"; target: T }
  /** Every ally in range. */
  | { kind: "aoe"; targets: readonly T[] };

/**
 * Resolve a {@link StatusScope} against the available target groups, mirroring
 * the historical routing exactly:
 * - `aoeAlly`  — every ally in range; falls back to the selected ally, then self.
 * - `ally`     — the selected ally; falls back to self.
 * - `hostile`  — the selected hostile; falls back to self.
 * - `self` / unknown / undefined — the caster.
 */
export function routeStatusScope<T>(
  scope: StatusScope | undefined,
  targets: StatusScopeTargets<T>,
): StatusRouting<T> {
  if (scope === "aoeAlly") {
    const allies = targets.aoeAllies ?? [];
    if (allies.length > 0) {
      return { kind: "aoe", targets: allies };
    }
  }
  if (scope === "aoeAlly" || scope === "ally") {
    if (targets.selectedAlly) {
      return { kind: "single", target: targets.selectedAlly };
    }
  } else if (scope === "hostile") {
    if (targets.selectedHostile) {
      return { kind: "single", target: targets.selectedHostile };
    }
  }
  return { kind: "self" };
}

/**
 * The StatusManager surface a routed cast applies through. Position anchors are
 * live closures (read each frame so an aura follows its moving target); the
 * generic `P` keeps this module THREE-free — {@link Studio} binds `P` to
 * `THREE.Vector3`.
 */
export interface StatusApplySink<P> {
  /** Single-target (or self when `anchor` is omitted) application. */
  apply(anchor?: () => P): void;
  /** Area application: one aura per anchor, sharing a timer + notifier chip. */
  applyAll(anchors: Array<() => P>): void;
}

/**
 * Bridge a {@link StatusRouting} decision onto a {@link StatusApplySink}, mapping
 * each resolved target to a live position-provider closure. This is the
 * apply-vs-applyAll layer that {@link Studio.applyStatusScoped} drives, extracted
 * pure (closures only, no THREE) so it can be unit-tested:
 * - `aoe`    → {@link StatusApplySink.applyAll} with one closure per target.
 * - `single` → {@link StatusApplySink.apply} with the resolved target's closure.
 * - `self`   → {@link StatusApplySink.apply} with no anchor (the caster).
 *
 * Each anchor reads `position(target)` lazily, so a moving target keeps its aura
 * attached frame to frame rather than freezing at the cast-time position.
 */
export function dispatchStatusRouting<T, P>(
  routing: StatusRouting<T>,
  position: (target: T) => P,
  sink: StatusApplySink<P>,
): void {
  if (routing.kind === "aoe") {
    sink.applyAll(routing.targets.map((target) => () => position(target)));
  } else if (routing.kind === "single") {
    const { target } = routing;
    sink.apply(() => position(target));
  } else {
    sink.apply();
  }
}
