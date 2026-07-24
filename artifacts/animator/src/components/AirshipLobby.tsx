/**
 * The Grudge — airship 4-slot crew select.
 *
 * Puter GrudgeWar plate (`scene_airship.png`) + deck % stations
 * (helm / main battery / fore guns / crow rope). Roster from Railway
 * fleet characters after Puter → Grudge ID session.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  activateCampfireHero,
  buildGenesisHeroOptions,
  saveGrudoxSlot,
  type GenesisHeroOption,
} from "../auth/grudoxRoster";
import {
  listFleetCharacters,
  buildCharacterCreateUrl,
  buildFleetLoginUrl,
  type FleetCharacter,
} from "../auth/fleetCharacter";
import {
  FLEET,
  readFleetToken,
} from "../auth/fleetCore";
import {
  restoreSession,
  linkPuterToGrudgeId,
  type GrudgeUser,
} from "../auth/grudgeAuth";
import "./airshipLobby.css";

interface Props {
  onExit: () => void;
  onNavigate: (mode: string) => void;
  onAvatarEdit?: () => void;
  onPlayDanger?: (hero: GenesisHeroOption) => void;
}

/** Deck stations — % against airship plate (grudgewar-puter-scenes SSOT). */
const CREW_STATIONS = [
  {
    id: "wheel",
    label: "Helm",
    role: "At the wheel",
    left: 22,
    top: 74,
  },
  {
    id: "large_cannon",
    label: "Main battery",
    role: "Large cannons",
    left: 38,
    top: 71,
  },
  {
    id: "small_cannon",
    label: "Fore guns",
    role: "Smaller cannons",
    left: 58,
    top: 72,
  },
  {
    id: "crow_rope",
    label: "Crow's line",
    role: "Rope to crow's nest",
    left: 76,
    top: 68,
  },
] as const;

function returnCharactersUrl(): string {
  if (typeof window === "undefined") return "https://threejs-rapier-react-three-controll.vercel.app/?door=characters";
  return `${window.location.origin}/?door=characters`;
}

export function AirshipLobby({ onExit, onNavigate, onAvatarEdit, onPlayDanger }: Props) {
  const [fleet, setFleet] = useState<FleetCharacter[]>([]);
  const [heroes, setHeroes] = useState<GenesisHeroOption[]>([]);
  const [selected, setSelected] = useState(0);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [puterUser, setPuterUser] = useState<GrudgeUser | null>(null);
  const [hasFleetJwt, setHasFleetJwt] = useState(false);
  const [linking, setLinking] = useState(false);

  const active = heroes[selected] ?? null;

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const refreshIdentity = useCallback(async () => {
    const u = await restoreSession();
    setPuterUser(u);
    setHasFleetJwt(!!readFleetToken());
    return u;
  }, []);

  const loadRoster = useCallback(async () => {
    setLoadingRoster(true);
    try {
      // Ensure Puter session is bridged to Railway JWT before character fetch.
      await linkPuterToGrudgeId();
      await refreshIdentity();
      const list = await listFleetCharacters();
      setFleet(list);
      const opts = buildGenesisHeroOptions(list);
      setHeroes(opts);
      if (opts.length) setSelected(0);
    } catch (err) {
      console.warn("[AirshipLobby] fleet roster failed", err);
      setHeroes(buildGenesisHeroOptions([]));
    } finally {
      setLoadingRoster(false);
    }
  }, [refreshIdentity]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    const h = heroes[selected];
    if (h) activateCampfireHero(h);
  }, [selected, heroes]);

  const slots = useMemo(() => {
    const out: (GenesisHeroOption | null)[] = [null, null, null, null];
    for (let i = 0; i < 4; i++) out[i] = heroes[i] ?? null;
    return out;
  }, [heroes]);

  const createInEmptySlot = useCallback(
    (slotIndex: number) => {
      const createUrl = buildCharacterCreateUrl(returnCharactersUrl());
      if (createUrl) {
        try {
          const u = new URL(createUrl);
          u.searchParams.set("slot", String(slotIndex));
          u.searchParams.set("returnTo", returnCharactersUrl());
          u.searchParams.set("era", "warlords");
          window.location.assign(u.toString());
          return;
        } catch {
          /* fall through */
        }
      }
      const draftId = `local-slot-${slotIndex}-${Date.now().toString(36)}`;
      saveGrudoxSlot({
        uuid: draftId,
        slot: slotIndex,
        name: "New Crew",
        baseId: "explorer",
        createdAt: Date.now(),
      });
      setHeroes(buildGenesisHeroOptions(fleet));
      setSelected(slotIndex);
      flash("Draft crew seat — customize in Avatar editor");
      onAvatarEdit?.();
    },
    [fleet, flash, onAvatarEdit],
  );

  const connectGrudgeId = useCallback(() => {
    window.location.assign(
      buildFleetLoginUrl(returnCharactersUrl(), { app: "grudge-animator", force: true }),
    );
  }, []);

  const relinkPuter = useCallback(async () => {
    setLinking(true);
    try {
      const ok = await linkPuterToGrudgeId({ force: true });
      await refreshIdentity();
      if (ok) {
        flash("Grudge ID linked via Puter");
        await loadRoster();
      } else {
        flash("Could not link Puter — try Grudge ID sign-in");
      }
    } finally {
      setLinking(false);
    }
  }, [flash, loadRoster, refreshIdentity]);

  const openFoundry = useCallback(() => {
    try {
      window.location.assign(
        buildCharacterCreateUrl(returnCharactersUrl()) ||
          `${FLEET.characterStudio}?era=warlords&returnTo=${encodeURIComponent(returnCharactersUrl())}`,
      );
    } catch {
      onNavigate("avatar");
    }
  }, [onNavigate]);

  return (
    <div className="air-root">
      <div className="air-plate" aria-hidden />
      <div className="air-dim" aria-hidden />

      <div className="air-bar">
        <div className="air-brand-chip">
          <strong>The Grudge</strong>
          Pirate airship · 4 crew
        </div>
        <div className="air-actions">
          <button type="button" className="air-btn" onClick={() => onAvatarEdit?.()}>
            Avatar
          </button>
          <button type="button" className="air-btn" onClick={openFoundry}>
            Forge hero
          </button>
          <button type="button" className="air-btn" onClick={() => onNavigate("doors")}>
            Library
          </button>
          <button type="button" className="air-btn quiet" onClick={onExit}>
            ↩ Leave ship
          </button>
        </div>
      </div>

      <div className="air-head">
        <h1 className="air-title">THE GRUDGE</h1>
        <p className="air-kicker">Black Tide crew · clear skies</p>
        <p className="air-sub">
          {active
            ? "Select a station, then board Danger Room or the facility."
            : "Sign in with Puter / Grudge ID — empty stations open Character Studio."}
        </p>
      </div>

      {loadingRoster && <div className="air-loading">Loading crew roster…</div>}

      <div className="air-deck" aria-label="Airship crew stations">
        {CREW_STATIONS.map((station, i) => {
          const hero = slots[i];
          const on = i === selected && !!hero;
          return (
            <button
              key={station.id}
              type="button"
              className={`air-station${on ? " on" : ""}${hero ? "" : " empty"}`}
              style={{ left: `${station.left}%`, top: `${station.top}%` }}
              onClick={() => {
                if (hero) setSelected(i);
                else createInEmptySlot(i);
              }}
              title={hero ? `${hero.name} · ${station.role}` : `Empty · ${station.role}`}
            >
              <div className="air-station-avatar" aria-hidden>
                {hero ? (hero.name.trim().charAt(0) || "?").toUpperCase() : "+"}
              </div>
              <div className="air-station-ring" aria-hidden />
              <span className="air-station-label">{station.label}</span>
              <span className="air-station-meta">
                {hero
                  ? hero.name
                  : loadingRoster
                    ? "…"
                    : "Empty · Forge"}
              </span>
              <span className="air-station-role">
                {hero ? `${hero.raceLabel} · ${station.role}` : station.role}
              </span>
            </button>
          );
        })}
      </div>

      <aside className="air-account" aria-label="Account connections">
        <h3>Account connections</h3>
        <div className="air-account-row">
          <span>Puter / Grudge ID</span>
          <b className={puterUser ? "ok" : "warn"}>
            {puterUser ? puterUser.username : "Not signed in"}
          </b>
        </div>
        <div className="air-account-row">
          <span>Fleet JWT</span>
          <b className={hasFleetJwt ? "ok" : "warn"}>
            {hasFleetJwt ? "Connected" : "Missing"}
          </b>
        </div>
        <div className="air-account-row">
          <span>Crew seats</span>
          <b>
            {loadingRoster ? "…" : `${heroes.length} / 4`}
          </b>
        </div>
        <div className="air-account-actions">
          {!hasFleetJwt && (
            <button type="button" className="air-btn primary" onClick={connectGrudgeId}>
              Connect Grudge ID
            </button>
          )}
          {puterUser && (
            <button
              type="button"
              className="air-btn"
              disabled={linking}
              onClick={() => void relinkPuter()}
            >
              {linking ? "Linking…" : "Relink Puter"}
            </button>
          )}
          <button type="button" className="air-btn" onClick={() => void loadRoster()}>
            Refresh roster
          </button>
        </div>
      </aside>

      <div className="air-foot">
        <div className="air-pick">
          {active ? (
            <>
              <b>{active.name}</b>
              <span>
                {active.raceLabel} · {CREW_STATIONS[selected]?.role ?? "Crew"} · {active.source}
              </span>
            </>
          ) : (
            <span className="air-dim-text">
              No crew selected — click a deck station or Forge a hero
            </span>
          )}
        </div>
        <div className="air-foot-actions">
          {active && (
            <button
              type="button"
              className="air-btn primary"
              onClick={() => active && onPlayDanger?.(active)}
            >
              Board Danger Room
            </button>
          )}
          <button
            type="button"
            className="air-btn"
            disabled={!active}
            onClick={() => {
              if (!active) {
                flash("Select a crew member first");
                return;
              }
              activateCampfireHero(active);
              onNavigate("doors");
            }}
          >
            Enter facility
          </button>
          <button type="button" className="air-btn" onClick={openFoundry}>
            Manage heroes
          </button>
        </div>
      </div>

      {toast && (
        <div className="air-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
