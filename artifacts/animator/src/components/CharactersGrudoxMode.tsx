import { useMemo, useState, useCallback } from "react";
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
  /** Navigate into a same-origin play-shell mode (danger, voxel, island, …). */
  onNavigate: (mode: LocalHubMode) => void;
}

/**
 * Characters GRUDOX hub — Fantasy-Scene-Creator campfire scene (4 slots + cool
 * imagery) with a right-side fleet menu that routes into voxel content, editors,
 * GRUDOX arcade cabinets, and fleet games with hero handoff.
 *
 * Scene SPA: `public/charactersgrudox/` (from charactersgrudox artifact).
 */
export function CharactersGrudoxMode({ onExit, onNavigate }: Props) {
  const [menuOpen, setMenuOpen] = useState(true);
  const [heroHint, setHeroHint] = useState(() => {
    const c = readActiveHeroContext();
    return c.name || c.characterId || null;
  });

  const src = useMemo(() => {
    const prefix = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
    const path = `${prefix}charactersgrudox/index.html`.replace(/\/{2,}/g, "/");
    const url = new URL(path, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const token = readFleetToken();
    if (token) {
      url.searchParams.set("sso_token", token);
      url.searchParams.set("grudge_token", token);
    }
    try {
      const charId = localStorage.getItem("grudge.activeCharId");
      if (charId) url.searchParams.set("characterId", charId);
    } catch {
      /* */
    }
    url.searchParams.set("from", "grudox-play");
    url.searchParams.set("hub", "1");
    return url.pathname + url.search;
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

  return (
    <div className="cg-root">
      {/* Full-bleed campfire scene (4 slots, create/edit, wood signs inside SPA) */}
      <iframe
        className="cg-frame cg-frame-full"
        title="Characters GRUDOX — campfire select"
        src={src}
        allow="fullscreen; autoplay; clipboard-read; clipboard-write"
      />

      {/* Floating chrome */}
      <div className="cg-float-bar">
        <div className="cg-brand">
          CHARACTERS<span>GRUDOX</span>
          {heroHint && <em>{heroHint}</em>}
        </div>
        <div className="cg-actions">
          <button type="button" className="cg-btn" onClick={() => setMenuOpen((v) => !v)}>
            {menuOpen ? "Hide routes" : "Show routes"}
          </button>
          <button type="button" className="cg-btn" onClick={onExit}>
            ↩ Home
          </button>
        </div>
      </div>

      {/* Right-side route menu → voxel / editors / GRUDOX deployments */}
      {menuOpen && (
        <aside className="cg-side" aria-label="Play destinations">
          <header className="cg-side-head">
            <h2>Launch</h2>
            <p>
              Pick a campfire hero (4 slots), then route into voxel games, editors, or
              fleet titles. Your character id travels with the handoff.
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
            <p>
              Left: campfire · create free first hero · edit looks.
              <br />
              Right-click a route to force a new tab.
            </p>
          </footer>
        </aside>
      )}
    </div>
  );
}
