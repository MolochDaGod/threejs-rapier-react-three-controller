/**
 * Characters GRUDOX hub — native launch panel (no broken iframe).
 *
 * Production does not ship /charactersgrudox/index.html on Vercel (404).
 * This mode is a fleet destination menu + active hero readout; create/edit
 * characters on Account (gameopen) or Character Studio.
 */
import { useState, useCallback, useEffect } from "react";
import { readFleetToken } from "../auth/fleetCore";
import {
  HUB_DESTINATIONS,
  HUB_GROUPS,
  launchHubDestination,
  readActiveHeroContext,
  type HubDestination,
  type LocalHubMode,
} from "../auth/characterHubLaunch";
import "./charactersGrudox.css";

interface Props {
  onExit: () => void;
  onNavigate: (mode: LocalHubMode) => void;
}

const ACCOUNT_HUB =
  "https://gameopen.vercel.app/account?open=1&from=charactersgrudox";
const CHAR_STUDIO = "https://character.grudge-studio.com/?era=warlords";

export function CharactersGrudoxMode({ onExit, onNavigate }: Props) {
  const [menuOpen, setMenuOpen] = useState(true);
  const [heroHint, setHeroHint] = useState(() => {
    const c = readActiveHeroContext();
    return c.name || c.characterId || null;
  });

  useEffect(() => {
    const c = readActiveHeroContext();
    setHeroHint(c.name || c.characterId || null);
  }, []);

  const go = useCallback(
    (dest: HubDestination, newTab?: boolean) => {
      const ctx = readActiveHeroContext();
      setHeroHint(ctx.name || ctx.characterId || "Hero");
      launchHubDestination(dest, ctx, {
        newTab: newTab ?? !dest.localMode,
        onLocal: (mode) => onNavigate(mode),
      });
    },
    [onNavigate],
  );

  const openAccount = () => {
    const token = readFleetToken();
    const ctx = readActiveHeroContext();
    try {
      const u = new URL(ACCOUNT_HUB);
      if (token) {
        u.searchParams.set("sso_token", token);
        u.searchParams.set("grudge_token", token);
      }
      if (ctx.characterId) u.searchParams.set("characterId", ctx.characterId);
      window.open(u.toString(), "_blank", "noopener,noreferrer");
    } catch {
      window.open(ACCOUNT_HUB, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="cg-root cg-root-native">
      <div className="cg-hero-bg" aria-hidden />

      <div className="cg-float-bar">
        <div className="cg-brand">
          CHARACTERS<span>GRUDOX</span>
          {heroHint && <em>{heroHint}</em>}
        </div>
        <div className="cg-actions">
          <button type="button" className="cg-btn primary" onClick={openAccount}>
            Account hub ↗
          </button>
          <button
            type="button"
            className="cg-btn"
            onClick={() => window.open(CHAR_STUDIO, "_blank", "noopener,noreferrer")}
          >
            Character Studio ↗
          </button>
          <button type="button" className="cg-btn" onClick={() => setMenuOpen((v) => !v)}>
            {menuOpen ? "Hide routes" : "Show routes"}
          </button>
          <button type="button" className="cg-btn" onClick={onExit}>
            ↩ Home
          </button>
        </div>
      </div>

      <div className="cg-native-center">
        <div className="cg-native-card">
          <h1>Characters GRUDOX</h1>
          <p>
            Campfire SPA is not embedded here (avoids 404 on{" "}
            <code>/charactersgrudox/index.html</code>). Use the fleet account hub to create/select
            heroes, then launch a game from the routes menu.
          </p>
          <div className="cg-native-actions">
            <button type="button" className="cg-btn primary" onClick={openAccount}>
              Open Account Hub (create / equip)
            </button>
            <button
              type="button"
              className="cg-btn"
              onClick={() => onNavigate("danger")}
            >
              Danger Room
            </button>
            <button
              type="button"
              className="cg-btn"
              onClick={() => onNavigate("minegrudge")}
            >
              GRUDOX Realms
            </button>
          </div>
          {heroHint && (
            <p className="cg-active-hero">
              Active: <strong>{heroHint}</strong>
            </p>
          )}
        </div>
      </div>

      {menuOpen && (
        <aside className="cg-side" aria-label="Play destinations">
          <header className="cg-side-head">
            <h2>Launch</h2>
            <p>
              Routes into voxel games, editors, and fleet titles. Character id travels with the
              handoff.
            </p>
          </header>

          {HUB_GROUPS.map((g) => {
            const items = HUB_DESTINATIONS.filter((d) => d.group === g.id);
            if (!items.length) return null;
            return (
              <section key={g.id} className="cg-side-group">
                <h3>{g.title}</h3>
                <div className="cg-side-list">
                  {items.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`cg-dest ${d.localMode ? "local" : "ext"}`}
                      title={d.blurb}
                      onClick={() => go(d)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        go(d, true);
                      }}
                    >
                      <strong>{d.label}</strong>
                      <span>{d.blurb}</span>
                      <i>{d.localMode ? "this app" : "opens ↗"}</i>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}

          <footer className="cg-side-foot">
            <p>Right-click a route to force a new tab. Auth = Grudge ID JWT (fleet).</p>
          </footer>
        </aside>
      )}
    </div>
  );
}
