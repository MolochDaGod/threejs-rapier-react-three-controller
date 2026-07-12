import { AlertTriangleIcon, CheckIcon, ClockIcon, Loader2Icon } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import type { ReadinessSnapshot } from "@/three/loading/readiness";

/**
 * Full-screen play-test loader. Renders the engine's live readiness snapshot as
 * a checklist with real (weight-based) progress, a "loading X…" line, and a
 * clear error state when any item fails. Mounted by App while a gated play /
 * danger session boots; the engine keeps gameplay frozen until `snapshot.ready`.
 *
 * When a load fails the player would otherwise be trapped on this overlay, so the
 * error state offers an escape hatch: `onRetry` re-mounts the gated session and
 * `onBack` returns to the door/menu. Both are optional so the loader still works
 * in contexts that don't wire recovery actions.
 *
 * Before that hard-failure state, a softer escape kicks in: when the snapshot
 * goes `slow` (no progress for a "taking longer than expected" window, well
 * under the stall timeout) the loader shows a calm notice plus an immediate
 * "Back to menu" — a healthy load still finishes on its own, and the notice
 * clears the moment progress resumes.
 */
export function LoadingScreen({
  snapshot,
  onRetry,
  onBack,
}: {
  snapshot: ReadinessSnapshot;
  onRetry?: () => void;
  onBack?: () => void;
}) {
  const pct = Math.round(snapshot.progress * 100);
  const failed = snapshot.failed;
  // Soft "taking longer than expected" state — only while still loading (failure
  // takes over with its own, stronger recovery UI).
  const slow = snapshot.slow && !failed;
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-screen__card">
        <div className="loading-screen__title">
          {failed ? (
            <>
              <AlertTriangleIcon className="loading-screen__title-icon loading-screen__title-icon--error" />
              <span>Couldn't start the match</span>
            </>
          ) : (
            <>
              <Loader2Icon className="loading-screen__title-icon loading-screen__spin" />
              <span>Entering the Danger Room</span>
            </>
          )}
        </div>

        {!failed && (
          <p className="loading-screen__current">{snapshot.current ?? "Finishing up…"}</p>
        )}
        {failed && <p className="loading-screen__error">{snapshot.error}</p>}

        {slow && (
          <p className="loading-screen__slow">
            <ClockIcon className="loading-screen__slow-icon" />
            <span>This is taking longer than usual — still working on it.</span>
          </p>
        )}

        <Progress
          value={pct}
          className={`loading-screen__bar${failed ? " loading-screen__bar--error" : ""}`}
        />
        <div className="loading-screen__pct">{pct}%</div>

        <ul className="loading-screen__list">
          {snapshot.items.map((item) => (
            <li key={item.key} className={`loading-screen__item loading-screen__item--${item.state}`}>
              <span className="loading-screen__item-icon">
                {item.state === "ready" && <CheckIcon className="loading-screen__check" />}
                {item.state === "failed" && <AlertTriangleIcon className="loading-screen__warn" />}
                {item.state === "pending" && <Loader2Icon className="loading-screen__spin" />}
              </span>
              <span className="loading-screen__item-label">{item.label}</span>
            </li>
          ))}
        </ul>

        {failed && (onRetry || onBack) && (
          <div className="loading-screen__actions">
            {onRetry && (
              <button
                type="button"
                className="loading-screen__btn loading-screen__btn--primary"
                onClick={onRetry}
              >
                Retry
              </button>
            )}
            {onBack && (
              <button
                type="button"
                className="loading-screen__btn"
                onClick={onBack}
              >
                Back to menu
              </button>
            )}
          </div>
        )}

        {/* Early, non-alarming escape: offered while the load is just slow (not
            failed) so a player isn't stuck waiting out the full stall timeout. */}
        {slow && onBack && (
          <div className="loading-screen__actions">
            <button type="button" className="loading-screen__btn" onClick={onBack}>
              Back to menu
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
