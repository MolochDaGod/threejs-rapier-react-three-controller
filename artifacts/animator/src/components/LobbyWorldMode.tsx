import { useEffect, useRef, useState, useCallback } from "react";
import { LobbyWorld } from "../three/lobbyWorld/LobbyWorld";
import type { LobbyHudSnapshot } from "../three/lobbyWorld/types";
import { ITEM_LABELS, RECIPES, VENDOR_STOCK } from "../three/lobbyWorld/recipes";
import {
  resolveFleetPlayerLoadout,
  listFleetCharacters,
  fleetCharacterToLoadout,
  guestLoadout,
  buildFleetLoginUrl,
  buildCharacterCreateUrl,
  rememberAnimatorCharacter,
  buildGrudoxGameUrl,
  GRUDOX_GAMES,
  type FleetCharacter,
  type FleetPlayerLoadout,
} from "../auth/fleetCharacter";
import type { DangerClient } from "../net/DangerClient";
import "./lobbyWorld.css";

interface Props {
  onExit: () => void;
  /** Shared multiplayer relay (same as Lobby / Danger Room). */
  net?: DangerClient | null;
  /** Start with PvP island sync (real characters fight). */
  enablePvp?: boolean;
}

/**
 * Fullscreen third-person Lobby World — GRUDOX / Warlords characters, harvest,
 * craft, build, day/night, and optional PvP via the Danger relay.
 */
export function LobbyWorldMode({ onExit, net = null, enablePvp = true }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<LobbyWorld | null>(null);
  const [hud, setHud] = useState<LobbyHudSnapshot | null>(null);
  const [tab, setTab] = useState<"basic" | "tools" | "build" | "combat">("basic");
  const [hero, setHero] = useState<FleetPlayerLoadout | null>(null);
  const [roster, setRoster] = useState<FleetCharacter[]>([]);
  const [booting, setBooting] = useState(true);
  const [pvpOn, setPvpOn] = useState(enablePvp);
  const [charMenu, setCharMenu] = useState(false);
  const [gamesMenu, setGameMenu] = useState(false);

  // Resolve GRUDOX / Railway Warlords character before mounting the world.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBooting(true);
      try {
        const [loadout, chars] = await Promise.all([
          resolveFleetPlayerLoadout(),
          listFleetCharacters(),
        ]);
        if (cancelled) return;
        setRoster(chars);
        const h = loadout || guestLoadout();
        setHero(h);
        if (loadout) {
          rememberAnimatorCharacter(loadout.characterId, loadout.fleetId);
        }
      } catch (e) {
        console.warn("[LobbyWorldMode] fleet resolve failed", e);
        if (!cancelled) setHero(guestLoadout());
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Mount world once hero resolved
  useEffect(() => {
    if (booting || !hero || !mountRef.current) return;
    const el = mountRef.current;
    const world = new LobbyWorld(el, {
      onHud: setHud,
      hero,
      net: pvpOn ? net : null,
      enablePvp: pvpOn && !!net,
    });
    worldRef.current = world;
    return () => {
      world.dispose();
      worldRef.current = null;
    };
    // Remount only when hero identity or pvp flag changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booting, hero?.fleetId, hero?.characterId, pvpOn, net]);

  const onCraft = useCallback((id: string) => {
    worldRef.current?.craft(id);
  }, []);

  const onBuy = useCallback((id: (typeof VENDOR_STOCK)[number]["id"]) => {
    worldRef.current?.buy(id);
  }, []);

  const switchCharacter = useCallback(async (c: FleetCharacter) => {
    const loadout = fleetCharacterToLoadout(c);
    setHero(loadout);
    rememberAnimatorCharacter(loadout.characterId, loadout.fleetId);
    setCharMenu(false);
    // setHero will remount world via effect; also try hot-swap if same instance
    await worldRef.current?.setHero(loadout);
  }, []);

  const dayPct = hud ? Math.round(hud.dayTime * 100) : 0;
  const inv = hud?.inventory ?? [];
  const auth = hud?.authenticated ?? hero?.authenticated ?? false;

  return (
    <div className="lw-root">
      <div className="lw-canvas" ref={mountRef} />

      {booting && (
        <div className="lw-boot">
          <div className="lw-boot-card">
            <h2>GRUDOX World</h2>
            <p>Loading your Warlords character…</p>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="lw-top">
        <div className="lw-brand">
          GRUDOX <span>WORLD</span>
          <em>{hud?.mapLabel ?? "…"}</em>
        </div>

        <div className="lw-hero-pill" title={hud?.heroFleetId || ""}>
          {auth ? (
            <>
              <strong>{hud?.heroName || hero?.displayName}</strong>
              <span>
                {hud?.heroRace || hero?.race} · {hud?.heroClass || hero?.classSlug}
              </span>
              {hud?.weaponId && <span className="lw-weapon">{hud.weaponId}</span>}
              {hud?.bagCloud && <span className="lw-bag-cloud" title="Harvest saves to Railway account bag">☁ bag</span>}
              {roster.length > 1 && (
                <button type="button" className="lw-linkish" onClick={() => setCharMenu((v) => !v)}>
                  Switch
                </button>
              )}
            </>
          ) : (
            <>
              <strong>Guest</strong>
              <a className="lw-linkish" href={buildFleetLoginUrl()}>
                Sign in with Grudge ID
              </a>
              <a className="lw-linkish" href={buildCharacterCreateUrl()}>
                Create character
              </a>
            </>
          )}
        </div>

        <div className="lw-day">
          <span className={`lw-day-dot ${hud?.isNight ? "night" : "day"}`} />
          {hud?.isNight ? "Night" : "Day"} · {dayPct}%
          {hud && hud.mobCount > 0 && <span className="lw-mobs"> · {hud.mobCount} hostiles</span>}
          {pvpOn && (
            <span className={`lw-pvp ${hud?.pvpConnected ? "on" : ""}`}>
              · PvP {hud?.pvpRoom ? hud.pvpRoom : "…"}
              {hud && hud.pvpPeers > 0 ? ` (${hud.pvpPeers})` : ""}
            </span>
          )}
        </div>
        <button
          type="button"
          className="lw-exit"
          onClick={() => setGameMenu((v) => !v)}
          title="Launch other GRUDOX games with this character"
        >
          Games
        </button>
        <button
          type="button"
          className={`lw-exit ${pvpOn ? "pvp-on" : ""}`}
          onClick={() => setPvpOn((v) => !v)}
          title="Toggle island PvP (real character multiplayer)"
        >
          {pvpOn ? "PvP On" : "PvP Off"}
        </button>
        <button type="button" className="lw-exit" onClick={onExit}>
          ↩ Leave World
        </button>
      </div>

      {gameMenu && (
        <div className="lw-char-menu lw-games-menu">
          <h3>Play with this character</h3>
          <p className="lw-game-note">
            Same Grudge ID + Railway character in every title. Launcher: gameopen.vercel.app
          </p>
          {GRUDOX_GAMES.filter((g) => g.id !== "lobbyWorld").map((g) => (
            <a
              key={g.id}
              className="lw-game-link"
              href={buildGrudoxGameUrl(g.id, { characterId: hero?.fleetId })}
              target={g.url.startsWith("http") ? "_blank" : undefined}
              rel={g.url.startsWith("http") ? "noreferrer" : undefined}
              onClick={() => setGameMenu(false)}
            >
              <strong>{g.name}</strong>
              <span>{g.blurb}</span>
            </a>
          ))}
        </div>
      )}

      {charMenu && roster.length > 0 && (
        <div className="lw-char-menu">
          <h3>Your characters</h3>
          {roster.map((c) => (
            <button
              key={c.id}
              type="button"
              className={c.id === hero?.fleetId ? "on" : ""}
              onClick={() => void switchCharacter(c)}
            >
              <strong>{c.name || c.id}</strong>
              <span>
                {String(c.race || c.raceId || "")} · {String(c.class || c.classId || c.heroClass || "")}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* HP + stance */}
      <div className="lw-vitals">
        <div className="lw-hp">
          <div className="lw-hp-bar" style={{ width: `${hud ? (hud.hp / hud.maxHp) * 100 : 100}%` }} />
          <span>
            HP {hud ? Math.ceil(hud.hp) : "—"}/{hud?.maxHp ?? "—"}
          </span>
        </div>
        <div className={`lw-stance ${hud?.stance ?? "harvest"}`}>
          {hud?.stance === "combat" ? "⚔ COMBAT" : "⛏ HARVEST"}
          <kbd>Q</kbd>
        </div>
      </div>

      <div className="lw-cross" aria-hidden>
        +
      </div>

      <div className="lw-inv">
        {inv.slice(0, 12).map((s) => (
          <div className="lw-inv-slot" key={s.id} title={ITEM_LABELS[s.id]}>
            <span className="lw-inv-name">{ITEM_LABELS[s.id]}</span>
            <span className="lw-inv-qty">{s.qty}</span>
          </div>
        ))}
        {inv.length === 0 && <div className="lw-inv-empty">Empty bag</div>}
      </div>

      <div className="lw-hints">
        <span>
          <kbd>WASD</kbd> move
        </span>
        <span>
          <kbd>Q</kbd> harvest/combat
        </span>
        <span>
          <kbd>LMB</kbd> harvest/attack/build
        </span>
        <span>
          <kbd>E</kbd> NPC
        </span>
        <span>
          <kbd>C</kbd> craft
        </span>
        <span>
          <kbd>B</kbd> build
        </span>
        <span>
          <kbd>H</kbd> potion
        </span>
        <span>PvP uses your real GRUDOX character</span>
      </div>

      {(hud?.message || hud?.loading) && (
        <div className="lw-toast">{hud.loading ?? hud.message}</div>
      )}

      {hud?.nearbyNpc && (
        <div className="lw-npc-prompt">
          Near <strong>{hud.nearbyNpc}</strong> — press <kbd>E</kbd>
        </div>
      )}

      {hud?.targetLabel && hud.stance === "combat" && (
        <div className="lw-target">{hud.targetLabel}</div>
      )}

      {!auth && !booting && (
        <div className="lw-auth-banner">
          <div>
            <strong>Play as your Warlords character</strong>
            <p>
              Sign in with Grudge ID to load equipment, race kit, and PvP as your real GRUDOX hero.
            </p>
          </div>
          <div className="lw-auth-actions">
            <a className="ve-btn ve-play" href={buildFleetLoginUrl()}>
              Sign in
            </a>
            <a className="ve-btn" href={buildCharacterCreateUrl()}>
              Create character
            </a>
          </div>
        </div>
      )}

      {hud?.craftOpen && (
        <div className="lw-panel lw-craft">
          <div className="lw-panel-head">
            <h2>Crafting</h2>
            <button type="button" onClick={() => worldRef.current?.setCraftOpen(false)}>
              ✕
            </button>
          </div>
          <div className="lw-tabs">
            {(["basic", "tools", "build", "combat"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={tab === t ? "on" : ""}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="lw-recipe-list">
            {RECIPES.filter((r) => r.tab === tab).map((r) => {
              const ok = worldRef.current?.canCraftRecipe(r.id) ?? false;
              return (
                <button
                  key={r.id}
                  type="button"
                  className={`lw-recipe ${ok ? "ok" : "no"}`}
                  disabled={!ok}
                  onClick={() => onCraft(r.id)}
                >
                  <strong>
                    {r.name} ×{r.qty}
                  </strong>
                  <span>
                    {r.cost.map((c) => `${c.qty} ${ITEM_LABELS[c.id]}`).join(" · ")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {hud?.vendorOpen && (
        <div className="lw-panel lw-vendor">
          <div className="lw-panel-head">
            <h2>Vendor</h2>
            <button type="button" onClick={() => worldRef.current?.setVendorOpen(false)}>
              ✕
            </button>
          </div>
          <p className="lw-vendor-coins">
            Coins: {inv.find((s) => s.id === "coin")?.qty ?? 0}
          </p>
          <div className="lw-recipe-list">
            {VENDOR_STOCK.map((s) => (
              <button
                key={s.id}
                type="button"
                className="lw-recipe ok"
                onClick={() => onBuy(s.id)}
              >
                <strong>{s.name}</strong>
                <span>{s.price} coins</span>
              </button>
            ))}
          </div>
          <div className="lw-sell-row">
            <span>Sell 1× of:</span>
            {inv
              .filter((s) => s.id !== "coin")
              .slice(0, 6)
              .map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="lw-sell"
                  onClick={() => worldRef.current?.sell(s.id)}
                >
                  {ITEM_LABELS[s.id]}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
