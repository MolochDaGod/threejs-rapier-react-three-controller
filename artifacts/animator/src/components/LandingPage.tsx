/**
 * Landing page — app front door before airship crew / facility.
 *
 * Puter.js under the hood for Grudge ID (username / email / guest).
 * After Puter sign-in we bridge to a Railway fleet JWT so characters
 * and account bag APIs work. Alternate path: full Grudge ID web SSO.
 */
import { useEffect, useState } from "react";
const emblemArt = `${import.meta.env.BASE_URL}emblem.png`;
import {
  restoreSession,
  signIn,
  signOut,
  linkPuterToGrudgeId,
  getAccountConnectionStatus,
  type GrudgeUser,
} from "../auth/grudgeAuth";
import {
  buildFleetLoginUrl,
  captureSsoFromUrl,
  readFleetToken,
  FLEET,
} from "../auth/fleetCore";
import { LandingHeroStage } from "./LandingHeroStage";
import "./landing.css";

interface Props {
  /** Proceed into airship character select. */
  onEnter: () => void;
}

type Phase = "checking" | "signedOut" | "busy" | "signedIn";

export function LandingPage({ onEnter }: Props) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [user, setUser] = useState<GrudgeUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasFleetJwt, setHasFleetJwt] = useState(false);
  const [grudgeIdHint, setGrudgeIdHint] = useState<string | null>(null);

  // Restore Puter session + any SSO handoff JWT; bridge when possible.
  useEffect(() => {
    let cancelled = false;
    captureSsoFromUrl();
    void (async () => {
      try {
        const status = await getAccountConnectionStatus();
        if (cancelled) return;
        if (status.puterUser) {
          await linkPuterToGrudgeId({ user: status.puterUser });
        }
        if (cancelled) return;
        const next = await getAccountConnectionStatus();
        setUser(next.puterUser);
        setHasFleetJwt(next.hasFleetJwt || !!readFleetToken());
        setGrudgeIdHint(next.grudgeId);
        setPhase(next.puterUser || next.hasFleetJwt ? "signedIn" : "signedOut");
      } catch {
        if (cancelled) return;
        const u = await restoreSession();
        if (cancelled) return;
        setUser(u);
        setHasFleetJwt(!!readFleetToken());
        setPhase(u || readFleetToken() ? "signedIn" : "signedOut");
      }
    })();
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
        setPhase(user || readFleetToken() ? "signedIn" : "signedOut");
        return;
      }
      setUser(u);
      setHasFleetJwt(!!readFleetToken());
      try {
        setGrudgeIdHint(
          localStorage.getItem("grudge_id") ||
            localStorage.getItem("grudge_account_id") ||
            u.uuid ||
            null,
        );
      } catch {
        setGrudgeIdHint(u.uuid || null);
      }
      setPhase("signedIn");
      if (asGuest) onEnter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed — try again.");
      setPhase(user || readFleetToken() ? "signedIn" : "signedOut");
    }
  };

  const doGrudgeIdWeb = () => {
    const returnTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/?door=landing`
        : FLEET.gameopen;
    window.location.assign(buildFleetLoginUrl(returnTo, { app: "grudge-animator", force: true }));
  };

  const doSwitch = async () => {
    setError(null);
    setPhase("busy");
    await signOut();
    setUser(null);
    setHasFleetJwt(!!readFleetToken());
    setGrudgeIdHint(null);
    setPhase("signedOut");
  };

  const guestName = user?.is_temp;
  const displayName = user?.username || grudgeIdHint || "Captain";

  return (
    <div className="landing">
      {/* Full-bleed 3D stage: hero orbit behind glass panel */}
      <LandingHeroStage />
      <div className="landing-vignette" aria-hidden />

      <div className="landing-inner">
        <img className="landing-emblem" src={emblemArt} alt="" draggable={false} />
        <h1 className="landing-brand">
          GRUDGE<span className="landing-brand-accent">STUDIO</span>
        </h1>
        <p className="landing-tag">Animator · Airship Crew · Danger Room</p>
        <p className="landing-about">
          Sign in with Puter / Grudge ID, board <strong>The Grudge</strong> airship for your 4
          crew seats, then enter combat. Production at{" "}
          <span className="landing-mono">threejs-rapier-react-three-controll.vercel.app</span>.
        </p>

        <details className="landing-connections" open>
          <summary>Account connections</summary>
          <ul>
            <li>
              <strong>Puter auth</strong> —{" "}
              {user ? (
                <span className="landing-ok">{user.username}{guestName ? " (guest)" : ""}</span>
              ) : (
                <span className="landing-warn">Not connected</span>
              )}
            </li>
            <li>
              <strong>Grudge ID / fleet JWT</strong> —{" "}
              {hasFleetJwt ? (
                <span className="landing-ok">Connected{grudgeIdHint ? ` · ${grudgeIdHint.slice(0, 12)}…` : ""}</span>
              ) : (
                <span className="landing-warn">Needed for Railway characters</span>
              )}
            </li>
            <li>
              <strong>Characters / bag</strong> — Railway grudge-api-production
            </li>
            <li>
              <strong>Foundry</strong> — character.grudge-studio.com (create heroes)
            </li>
            <li>
              <strong>Assets</strong> — assets.grudge-studio.com (R2)
            </li>
            <li>
              <strong>Identity hub</strong> — id.grudge-studio.com
            </li>
          </ul>
        </details>

        {phase === "checking" && <div className="landing-note">Checking your Grudge ID…</div>}

        {phase === "busy" && <div className="landing-note">Connecting to Grudge ID…</div>}

        {phase === "signedOut" && (
          <div className="landing-actions">
            <button className="landing-btn landing-btn-primary" onClick={() => doSignIn(false)}>
              Sign in with Puter / Grudge ID
            </button>
            <button className="landing-btn" onClick={doGrudgeIdWeb}>
              Grudge ID web SSO
            </button>
            <button className="landing-btn" onClick={() => doSignIn(true)}>
              Continue as guest
            </button>
            <p className="landing-hint">
              Puter handles Grudge ID username, email, and new accounts. Web SSO mints a fleet JWT
              for characters and the shared account bag.
            </p>
          </div>
        )}

        {phase === "signedIn" && (
          <div className="landing-actions">
            <div className="landing-user">
              {guestName ? (
                <>
                  Playing as guest <strong>{displayName}</strong>
                </>
              ) : (
                <>
                  Welcome aboard, <strong>{displayName}</strong>
                </>
              )}
            </div>
            {!hasFleetJwt && (
              <p className="landing-hint landing-hint-warn">
                Fleet JWT missing — characters may not load. Use Grudge ID web SSO or relink from
                the airship account panel.
              </p>
            )}
            <button className="landing-btn landing-btn-primary" onClick={onEnter}>
              Board the airship
            </button>
            {!hasFleetJwt && (
              <button className="landing-btn" onClick={doGrudgeIdWeb}>
                Connect Grudge ID (web)
              </button>
            )}
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
