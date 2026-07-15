/**
 * GRUDOX Realms launcher — always opens fleet Mine-Loader on Vercel.
 *
 * Does NOT iframe /minegrudge/ (404 on production) or any Replit host.
 * UI is a native launch panel; play happens on mine-loader.vercel.app.
 */
import { useMemo, useState, useCallback, useEffect } from "react";
import { readFleetToken } from "../auth/fleetCore";
import { readActiveHeroContext } from "../auth/characterHubLaunch";
import {
  MINE_LOADER_LIVE,
  MINE_LOADER_PILLARS,
  buildMineLoaderUrl,
  type MineLoaderSurface,
} from "../auth/mineLoaderConfig";
import "./mineGrudgeEditor.css";

interface Props {
  onExit: () => void;
  surface?: MineLoaderSurface;
  /** @deprecated Ignored — always fleet live. */
  preferLive?: boolean;
}

const SURFACES: { id: MineLoaderSurface; label: string; blurb: string }[] = [
  { id: "lobby", label: "Worlds & friends", blurb: "Public/private worlds · invites · co-op" },
  { id: "play", label: "Play", blurb: "Survival · combat · adventure" },
  { id: "editor", label: "Build", blurb: "World editor · blocks · tools" },
  { id: "coop", label: "Party / PvP", blurb: "Party tags · no friendly fire · open PvP" },
  { id: "boss", label: "Boss fights", blurb: "Team-vs-boss arenas" },
  { id: "codex", label: "Codex", blurb: "Blocks · defs · systems wiki" },
  { id: "home", label: "Sign-in hub", blurb: "Grudge ID · account" },
];

export function MineGrudgeEditorMode({
  onExit,
  surface: initialSurface = "lobby",
}: Props) {
  const [surface, setSurface] = useState<MineLoaderSurface>(initialSurface);
  const [joinCode, setJoinCode] = useState("");
  const [autoOpened, setAutoOpened] = useState(false);
  const hero = useMemo(() => readActiveHeroContext(), []);

  const src = useMemo(() => {
    const token = readFleetToken();
    return buildMineLoaderUrl({
      surface: joinCode.trim() ? "join" : surface,
      token,
      characterId: hero.characterId,
      characterName: hero.name,
      baseId: hero.baseId,
      joinCode: joinCode.trim() || null,
    });
  }, [hero.baseId, hero.characterId, hero.name, joinCode, surface]);

  const openRealms = useCallback(
    (target: "_blank" | "_self" = "_blank") => {
      if (target === "_self") {
        window.location.assign(src);
      } else {
        window.open(src, "_blank", "noopener,noreferrer");
      }
    },
    [src],
  );

  // Auto-open live Realms once so users are not stuck on an empty shell
  useEffect(() => {
    if (autoOpened) return;
    setAutoOpened(true);
    const t = window.setTimeout(() => openRealms("_blank"), 400);
    return () => window.clearTimeout(t);
  }, [autoOpened, openRealms]);

  return (
    <div className="mg-root mg-root-native">
      <div className="mg-hero-bg" aria-hidden />

      <div className="mg-float">
        <div className="mg-brand">
          GRUDOX <span>REALMS</span>
          <em>Live · mine-loader.vercel.app</em>
          {hero.name && <b>{hero.name}</b>}
        </div>
        <div className="mg-actions">
          <button type="button" className="mg-btn primary" onClick={() => openRealms("_blank")}>
            Open Realms ↗
          </button>
          <button type="button" className="mg-btn" onClick={() => openRealms("_self")}>
            Play here
          </button>
          <button type="button" className="mg-btn" onClick={onExit}>
            ↩ Back
          </button>
        </div>
      </div>

      <aside className="mg-panel mg-panel-center" aria-label="Realms menu">
        <header className="mg-panel-head">
          <h2>Minecraft-like GRUDOX</h2>
          <p>
            Survival · combat · adventure · build · friends. Hosted on our fleet at{" "}
            <a href={MINE_LOADER_LIVE} target="_blank" rel="noreferrer">
              mine-loader.vercel.app
            </a>
            . No Replit · no broken /minegrudge embed.
          </p>
          <p className="mg-note">
            A new tab should open automatically. If it was blocked, use <strong>Open Realms</strong>.
          </p>
        </header>

        <section className="mg-pillars">
          {MINE_LOADER_PILLARS.map((p) => (
            <div key={p.id} className="mg-pillar">
              <strong>{p.label}</strong>
              <span>{p.blurb}</span>
            </div>
          ))}
        </section>

        <section className="mg-surfaces">
          <h3>Destination</h3>
          <div className="mg-surface-list">
            {SURFACES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`mg-dest ${surface === s.id ? "active" : ""}`}
                onClick={() => {
                  setJoinCode("");
                  setSurface(s.id);
                }}
              >
                <strong>{s.label}</strong>
                <span>{s.blurb}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="mg-join">
          <h3>Join a friend</h3>
          <div className="mg-join-row">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Invite / room code"
              maxLength={12}
              aria-label="Join code"
            />
            <button
              type="button"
              className="mg-btn primary"
              disabled={!joinCode.trim()}
              onClick={() => {
                setSurface("join");
                window.setTimeout(() => openRealms("_blank"), 0);
              }}
            >
              Join ↗
            </button>
          </div>
        </section>

        <div className="mg-launch-row">
          <button type="button" className="mg-btn primary large" onClick={() => openRealms("_blank")}>
            Launch {SURFACES.find((s) => s.id === surface)?.label ?? "Realms"} ↗
          </button>
        </div>

        <footer className="mg-panel-foot">
          <p>
            URL: <code className="mg-url">{src}</code>
          </p>
        </footer>
      </aside>
    </div>
  );
}
