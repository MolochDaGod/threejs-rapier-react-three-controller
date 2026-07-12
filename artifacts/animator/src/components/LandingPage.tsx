/**
 * Landing page — the app's actual front door, shown before the doors hall.
 *
 * Presents the GRUDGE brand and a Grudge ID sign-in (puter.js under the hood:
 * the SDK popup handles Grudge ID / email / account creation). A guest entry
 * silently provisions a temporary Grudge account so progress still persists,
 * and a later full sign-in upgrades it in place. Once a session exists the
 * page flips to a "welcome back" state with a single ENTER action.
 */
import { useEffect, useState } from "react";
const emblemArt = `${import.meta.env.BASE_URL}emblem.png`;
import {
  restoreSession,
  signIn,
  signOut,
  type GrudgeUser,
} from "../auth/grudgeAuth";
import "./landing.css";

interface Props {
  /** Proceed into the facility (the doors hall). */
  onEnter: () => void;
}

type Phase = "checking" | "signedOut" | "busy" | "signedIn";

export function LandingPage({ onEnter }: Props) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [user, setUser] = useState<GrudgeUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Restore a previous Grudge session so returning players get one-click entry.
  useEffect(() => {
    let cancelled = false;
    restoreSession().then((u) => {
      if (cancelled) return;
      setUser(u);
      setPhase(u ? "signedIn" : "signedOut");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const doSignIn = async (asGuest: boolean) => {
    setError(null);
    setPhase("busy");
    try {
      const u = await signIn(asGuest ? { asGuest: true } : undefined);
      if (!u) {
        // Popup cancelled — back to the sign-in choices.
        setPhase(user ? "signedIn" : "signedOut");
        return;
      }
      setUser(u);
      setPhase("signedIn");
      if (asGuest) onEnter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed — try again.");
      setPhase(user ? "signedIn" : "signedOut");
    }
  };

  const doSwitch = async () => {
    setError(null);
    setPhase("busy");
    await signOut();
    setUser(null);
    setPhase("signedOut");
  };

  const guestName = user?.is_temp;

  return (
    <div className="landing">
      <div className="landing-inner">
        <img className="landing-emblem" src={emblemArt} alt="" draggable={false} />
        <h1 className="landing-brand">
          GRUDGE<span className="landing-brand-accent">STUDIO</span>
        </h1>
        <p className="landing-tag">Animator · Danger Room · Voxel Worlds</p>

        {phase === "checking" && <div className="landing-note">Checking your Grudge ID…</div>}

        {phase === "busy" && <div className="landing-note">Connecting to Grudge ID…</div>}

        {phase === "signedOut" && (
          <div className="landing-actions">
            <button className="landing-btn landing-btn-primary" onClick={() => doSignIn(false)}>
              Sign in with Grudge ID
            </button>
            <button className="landing-btn" onClick={() => doSignIn(true)}>
              Continue as guest
            </button>
            <p className="landing-hint">
              Grudge ID sign-in supports your Grudge ID, email, and new Grudge accounts.
            </p>
          </div>
        )}

        {phase === "signedIn" && user && (
          <div className="landing-actions">
            <div className="landing-user">
              {guestName ? (
                <>
                  Playing as guest <strong>{user.username}</strong>
                </>
              ) : (
                <>
                  Welcome back, <strong>{user.username}</strong>
                </>
              )}
            </div>
            <button className="landing-btn landing-btn-primary" onClick={onEnter}>
              Enter
            </button>
            {guestName ? (
              <button className="landing-btn" onClick={() => doSignIn(false)}>
                Upgrade to a full Grudge ID
              </button>
            ) : (
              <button className="landing-btn landing-btn-quiet" onClick={doSwitch}>
                Switch account
              </button>
            )}
          </div>
        )}

        {error && <div className="landing-error">{error}</div>}
      </div>
    </div>
  );
}
