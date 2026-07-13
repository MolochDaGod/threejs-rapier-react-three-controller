import { useMemo, useState, useCallback } from "react";
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
  /** Starting surface inside Mine-Loader. */
  surface?: MineLoaderSurface;
  /**
   * Prefer live https://mine-loader.replit.app for full networking (default true).
   * Set false / env VITE_MINEGRUDGE_LOCAL=1 for staged SPA only.
   */
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

/**
 * GRUDOX networked voxel game — Minecraft-like survival, combat, adventure,
 * build, and friends/parties, referenced against https://mine-loader.replit.app/
 *
 * Default: live Mine-Loader (full multiplayer + API + world WS).
 * Fallback: staged SPA at /minegrudge/ (offline / custom self-host).
 */
export function MineGrudgeEditorMode({
  onExit,
  surface: initialSurface = "lobby",
  preferLive: preferLiveProp,
}: Props) {
  const forceLocal =
    import.meta.env.VITE_MINEGRUDGE_LOCAL === "1" ||
    import.meta.env.VITE_MINEGRUDGE_LOCAL === "true";
  const [preferLive, setPreferLive] = useState(
    forceLocal ? false : preferLiveProp !== false,
  );
  const [surface, setSurface] = useState<MineLoaderSurface>(initialSurface);
  const [panel, setPanel] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const hero = useMemo(() => readActiveHeroContext(), []);

  const src = useMemo(() => {
    const token = readFleetToken();
    return buildMineLoaderUrl({
      surface: joinCode.trim() ? "join" : surface,
      preferLive,
      forceLocal: !preferLive,
      token,
      characterId: hero.characterId,
      characterName: hero.name,
      baseId: hero.baseId,
      joinCode: joinCode.trim() || null,
    });
  }, [hero.baseId, hero.characterId, hero.name, joinCode, preferLive, surface]);

  const openExternal = useCallback(() => {
    window.open(src, "_blank", "noopener,noreferrer");
  }, [src]);

  return (
    <div className="mg-root">
      <iframe
        key={src}
        className="mg-frame"
        title="GRUDOX Realms — Mine-Loader survival multiplayer"
        src={src}
        allow="fullscreen; autoplay; clipboard-read; clipboard-write; gamepad; microphone"
        referrerPolicy="no-referrer-when-downgrade"
      />

      <div className="mg-float">
        <div className="mg-brand">
          GRUDOX <span>REALMS</span>
          <em>{preferLive ? "Live · mine-loader.replit.app" : "Local SPA · /minegrudge"}</em>
          {hero.name && <b>{hero.name}</b>}
        </div>
        <div className="mg-actions">
          <button
            type="button"
            className={`mg-btn ${preferLive ? "on" : ""}`}
            title="Use live networked reference server"
            onClick={() => setPreferLive(true)}
          >
            Live net
          </button>
          <button
            type="button"
            className={`mg-btn ${!preferLive ? "on" : ""}`}
            title="Use staged SPA (offline / self-host client)"
            onClick={() => setPreferLive(false)}
          >
            Local
          </button>
          <button type="button" className="mg-btn" onClick={openExternal}>
            Open ↗
          </button>
          <button type="button" className="mg-btn" onClick={() => setPanel((v) => !v)}>
            {panel ? "Hide" : "Menu"}
          </button>
          <button type="button" className="mg-btn" onClick={onExit}>
            ↩ Characters
          </button>
        </div>
      </div>

      {panel && (
        <aside className="mg-panel" aria-label="Realms menu">
          <header className="mg-panel-head">
            <h2>Minecraft-like GRUDOX</h2>
            <p>
              Survival · combat · adventure · build · make friends. Networked worlds
              on{" "}
              <a href={MINE_LOADER_LIVE} target="_blank" rel="noreferrer">
                mine-loader.replit.app
              </a>
              .
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
            <h3>Enter</h3>
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
                onClick={() => setSurface("join")}
              >
                Join
              </button>
            </div>
            <p className="mg-note">
              Co-op: share a 6-char room code. Persistent worlds: sign in → Worlds lobby →
              invite link. Party tag = no friendly fire; empty party = open PvP.
            </p>
          </section>

          <footer className="mg-panel-foot">
            <p>
              Reference: <code>{MINE_LOADER_LIVE}</code>
              <br />
              Staged pack: <code>/minegrudge/</code> (icons, models,{" "}
              <code>codex/</code> wiki, <code>data/*.csv</code>) — run{" "}
              <code>pnpm stage:minegrudge</code> before build.
              <br />
              Camera: Mine-Loader third-person / FP · Danger/Island use threejs-rapier
              animator Controller.
              <br />
              Self-host: <code>D:\GitHub\minegrudge\Mine-Loader</code>
            </p>
          </footer>
        </aside>
      )}
    </div>
  );
}
