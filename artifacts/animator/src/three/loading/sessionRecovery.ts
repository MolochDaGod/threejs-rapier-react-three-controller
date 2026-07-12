/**
 * App-level recovery glue for the gated play/danger boot.
 *
 * When a boot fails (or crawls), {@link LoadingScreen} offers "Retry" and "Back
 * to menu". The React wiring that makes those actually recover the player lives
 * in `App` — but as inline closures it can't be exercised headlessly. This
 * module extracts that glue into tiny, DOM-free functions so the recovery path
 * is unit-testable the same way {@link BootGate} is:
 *
 *   - {@link createRecoveryHandlers} builds the loading-screen `onRetry` /
 *     `onBack` callbacks. Retry clears the stale loading snapshot and bumps the
 *     session key (which re-runs App's mount effect → a fresh gated session);
 *     Back returns to the door menu.
 *   - {@link teardownSession} is the mount effect's cleanup: dispose the old
 *     studio, drop the ref, and clear `loading` so a late async resolve from the
 *     torn-down session can't push a stale snapshot into the next one.
 */

import type { ReadinessSnapshot } from "./readiness";

/** Minimal disposable view of the engine session the loading screen gates. */
export interface DisposableSession {
  dispose(): void;
}

/** The React state setters the recovery glue drives (kept tiny + DOM-free). */
export interface SessionRecoveryDeps {
  /** App's `setLoading`. */
  setLoading: (snapshot: ReadinessSnapshot | null) => void;
  /** App's `setSessionKey` — a functional update bumps it to force a re-mount. */
  setSessionKey: (update: (key: number) => number) => void;
  /** App's `setMode` — recovery only ever sends the player back home (LED Mask). */
  setMode: (mode: "ledmask") => void;
}

export interface RecoveryHandlers {
  /** Tear down the stuck session and mount a fresh gated one. */
  onRetry: () => void;
  /** Abandon the stuck session and return to the home page. */
  onBack: () => void;
}

/**
 * Build the loading-screen recovery handlers. Retry clears the failed snapshot
 * before bumping the session key so the freshly mounted session never briefly
 * shows the old error overlay; Back hands control to the LED Mask home page.
 */
export function createRecoveryHandlers(deps: SessionRecoveryDeps): RecoveryHandlers {
  return {
    onRetry: () => {
      deps.setLoading(null);
      deps.setSessionKey((k) => k + 1);
    },
    onBack: () => deps.setMode("ledmask"),
  };
}

/**
 * Mount-effect cleanup. Dispose the studio (which also suppresses any further
 * readiness marks from its boot gate), drop the ref, and clear `loading` so a
 * late async resolve from this torn-down session can't leak a stale snapshot
 * into the next gated session.
 */
export function teardownSession(
  studio: DisposableSession | null,
  clearStudioRef: () => void,
  setLoading: (snapshot: ReadinessSnapshot | null) => void,
): void {
  studio?.dispose();
  clearStudioRef();
  setLoading(null);
}
