import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { LoadingScreen } from "./components/LoadingScreen";
import type { ReadinessSnapshot } from "./three/loading/readiness";
import {
  createRecoveryHandlers,
  teardownSession,
} from "./three/loading/sessionRecovery";

/**
 * App-level recovery path for a stalled match.
 *
 * `App` mounts a gated play/danger session behind {@link LoadingScreen}; when the
 * boot fails (or crawls) the overlay offers "Retry" and "Back to menu". The React
 * glue that makes those actually recover the player — the loading-screen
 * `onRetry`/`onBack` handlers and the mount-effect teardown — lives in the
 * DOM-free `sessionRecovery` helpers so it can be exercised headlessly (the real
 * `Studio` needs WebGL and `App` can't be effect-rendered in the node env).
 *
 * These tests model App's `[mode, sessionKey]` mount effect the way React runs it
 * (cleanup-then-remount on dep change) using a fake studio, wire the *exact*
 * handlers App wires, and drive the overlay buttons by walking the rendered tree
 * (the same approach as LoadingScreen.test). They assert the player escapes:
 * Retry tears down the failed session and mounts a fresh one (new key); Back
 * returns to the door menu; and on teardown the old studio is disposed and
 * `loading` is cleared so a late async resolve can't push a stale snapshot into
 * the next session.
 */

function snapshot(partial: Partial<ReadinessSnapshot>): ReadinessSnapshot {
  return {
    items: [],
    progress: 0,
    ready: false,
    failed: false,
    error: null,
    current: "Loading character…",
    slow: false,
    ...partial,
  };
}

const PENDING = snapshot({ current: "Loading character…", progress: 0.1 });
const FAILED = snapshot({ failed: true, error: "Loading fighter timed out.", progress: 0.3 });
const SLOW = snapshot({ slow: true, current: "Building arena…", progress: 0.3 });
const STALE_LATE = snapshot({ ready: true, progress: 1, current: null });

/** Fake engine session: tracks disposal and, like the real BootGate, suppresses
 *  readiness updates once disposed (so a late resolve can't reach React). */
class FakeStudio {
  disposed = false;
  onReadiness: (s: ReadinessSnapshot) => void = () => {};
  readinessSnapshot(): ReadinessSnapshot {
    return PENDING;
  }
  dispose(): void {
    this.disposed = true;
  }
  /** Mirror Studio: a snapshot only reaches React while the session is alive. */
  fireReadiness(s: ReadinessSnapshot): void {
    if (this.disposed) return;
    this.onReadiness(s);
  }
}

/**
 * Minimal model of App's play/danger session lifecycle: the `[mode, sessionKey]`
 * effect (mount → wire onReadiness → setLoading), its `teardownSession` cleanup,
 * and the `createRecoveryHandlers` wiring — the same code App uses.
 */
function createSessionHarness() {
  const state = {
    mode: "danger" as "danger" | "ledmask",
    sessionKey: 0,
    loading: null as ReadinessSnapshot | null,
    studio: null as FakeStudio | null,
  };
  const created: FakeStudio[] = [];
  let cleanup: (() => void) | null = null;
  let lastDeps: string | null = null;

  const setLoading = (s: ReadinessSnapshot | null) => {
    state.loading = s;
  };

  // Re-run the mount effect the way React does: when [mode, sessionKey] changes,
  // run the previous cleanup, then (if still in a gated mode) mount fresh.
  const runEffect = () => {
    const deps = `${state.mode}:${state.sessionKey}`;
    if (deps === lastDeps) return;
    cleanup?.();
    cleanup = null;
    lastDeps = deps;
    if (state.mode !== "danger") return; // App's effect early-returns out of gated modes
    const studio = new FakeStudio();
    created.push(studio);
    studio.onReadiness = (s) => setLoading(s);
    setLoading(studio.readinessSnapshot());
    state.studio = studio;
    cleanup = () =>
      teardownSession(studio, () => {
        state.studio = null;
      }, setLoading);
  };

  const recovery = createRecoveryHandlers({
    setLoading,
    setSessionKey: (update) => {
      state.sessionKey = update(state.sessionKey);
      runEffect();
    },
    setMode: (mode) => {
      state.mode = mode;
      runEffect();
    },
  });

  runEffect(); // initial mount
  return { state, recovery, created };
}

// --- tiny React-tree walkers (node env, no DOM) ------------------------------
function findButtons(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = [];
  const visit = (n: ReactNode) => {
    if (Array.isArray(n)) return void n.forEach(visit);
    if (!isValidElement(n)) return;
    if (n.type === "button") out.push(n);
    const children = (n.props as { children?: ReactNode }).children;
    if (children !== undefined) visit(children);
  };
  visit(node);
  return out;
}
function clickButton(tree: ReactNode, text: string) {
  const btn = findButtons(tree).find(
    (b) => (b.props as { children?: ReactNode }).children === text,
  );
  expect(btn, `expected a "${text}" button`).toBeDefined();
  (btn!.props as { onClick: () => void }).onClick();
}

describe("App stalled-match recovery", () => {
  it("renders the recovery buttons App wires when the load fails", () => {
    const { recovery } = createSessionHarness();
    const tree = LoadingScreen({ snapshot: FAILED, onRetry: recovery.onRetry, onBack: recovery.onBack });
    const labels = findButtons(tree).map((b) => (b.props as { children?: ReactNode }).children);
    expect(labels).toContain("Retry");
    expect(labels).toContain("Back to menu");
  });

  it("offers an early Back-to-menu (no Retry) while the load is merely slow", () => {
    const { recovery } = createSessionHarness();
    const tree = LoadingScreen({ snapshot: SLOW, onRetry: recovery.onRetry, onBack: recovery.onBack });
    const labels = findButtons(tree).map((b) => (b.props as { children?: ReactNode }).children);
    expect(labels).toContain("Back to menu");
    expect(labels).not.toContain("Retry");
  });

  it("Retry tears down the failed session and mounts a fresh one (new sessionKey)", () => {
    const h = createSessionHarness();
    const first = h.state.studio!;
    expect(first).toBeInstanceOf(FakeStudio);

    // Boot fails → the overlay shows the failure with its recovery buttons.
    first.fireReadiness(FAILED);
    expect(h.state.loading?.failed).toBe(true);

    // Player clicks Retry on the live overlay.
    clickButton(
      LoadingScreen({ snapshot: h.state.loading!, onRetry: h.recovery.onRetry, onBack: h.recovery.onBack }),
      "Retry",
    );

    // Old session disposed; a brand-new, distinct session is mounted under a bumped key.
    expect(first.disposed).toBe(true);
    expect(h.state.sessionKey).toBe(1);
    expect(h.created).toHaveLength(2);
    const second = h.state.studio!;
    expect(second).toBeInstanceOf(FakeStudio);
    expect(second).not.toBe(first);
    expect(second.disposed).toBe(false);
    // The fresh session is showing its own (pending) snapshot, not the old failure.
    expect(h.state.loading?.failed).toBe(false);
  });

  it("a late resolve from the torn-down session can't push a stale snapshot into the next one", () => {
    const h = createSessionHarness();
    const first = h.state.studio!;
    first.fireReadiness(FAILED);

    h.recovery.onRetry();
    const second = h.state.studio!;
    const freshLoading = h.state.loading;

    // The dead session's loader resolves late — it must NOT clobber the fresh session.
    first.fireReadiness(STALE_LATE);
    expect(first.disposed).toBe(true);
    expect(h.state.loading).toBe(freshLoading);
    expect(h.state.loading?.ready).not.toBe(true);
    expect(h.state.studio).toBe(second);
  });

  it("Back to menu disposes the session, clears loading, and returns to the door select", () => {
    const h = createSessionHarness();
    const first = h.state.studio!;
    first.fireReadiness(FAILED);

    clickButton(
      LoadingScreen({ snapshot: h.state.loading!, onRetry: h.recovery.onRetry, onBack: h.recovery.onBack }),
      "Back to menu",
    );

    expect(h.state.mode).toBe("ledmask");
    expect(first.disposed).toBe(true);
    // loading cleared and no new session mounted (we left the gated mode entirely).
    expect(h.state.loading).toBeNull();
    expect(h.state.studio).toBeNull();
    expect(h.created).toHaveLength(1);
  });

  it("teardownSession disposes the studio, drops the ref, and clears loading", () => {
    const studio = new FakeStudio();
    const clearRef = vi.fn();
    const setLoading = vi.fn();
    teardownSession(studio, clearRef, setLoading);
    expect(studio.disposed).toBe(true);
    expect(clearRef).toHaveBeenCalledTimes(1);
    expect(setLoading).toHaveBeenCalledWith(null);
  });
});
