/**
 * Ethereal Falls campfire — accounts character page (charactersgrudox UX).
 *
 * SSOT imagery/menus: Fantasy-Scene-Creator artifacts/charactersgrudox
 * public/ui/menu/*.png wooden-sign rail.
 *
 * Right menu routes into Open collection surfaces:
 *   PvE  → native Open PvE titles (danger, brawl, survival, mimic, …)
 *   PvP  → multiplayer lobby + PvP / spar modes
 *   Arena / GRUDOX → arcade cabinets (same-origin /arcade when on open.*)
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  activateCampfireHero,
  buildGenesisHeroOptions,
  saveGrudoxSlot,
  type GenesisHeroOption,
} from "../auth/grudoxRoster";
import {
  listFleetCharacters,
  buildCharacterCreateUrl,
  type FleetCharacter,
} from "../auth/fleetCharacter";
import {
  HUB_DESTINATIONS,
  HUB_GROUPS,
  launchHubDestination,
  type HubDestination,
  type HubLaunchContext,
  type LocalHubMode,
} from "../auth/characterHubLaunch";
import { CampfireLobbyScene } from "../three/intro/CampfireLobbyScene";
import "./campfireLobby.css";

interface Props {
  onExit: () => void;
  onNavigate: (mode: string) => void;
  /** Open Avatar Edit (Explorer modular head). */
  onAvatarEdit?: () => void;
  /** Enter Danger Room with selected hero. */
  onPlayDanger?: (hero: GenesisHeroOption) => void;
}

type Panel =
  | null
  | "pve"
  | "pvp"
  | "arena"
  | "grudox"
  | "leaderboard"
  | "shop"
  | "settings";

type DestKind = "local" | "arcade" | "external";

interface MenuDest {
  id: string;
  label: string;
  blurb: string;
  kind: DestKind;
  /** Local App mode when kind is local */
  mode?: string;
  /** Same-origin path when kind is arcade (prefer open host /arcade routes) */
  path?: string;
  /** Absolute URL when kind is external */
  url?: string;
  /** Require a selected campfire hero before launch */
  needsHero?: boolean;
}

const MENU = (file: string) => `/ui/menu/${file}`;

/** PvE titles hosted on open.grudge-studio.com (T0 native + Realms). */
const PVE_DESTS: MenuDest[] = [
  {
    id: "danger",
    label: "Danger Room",
    blurb: "Combat sandbox · weapons · skills · AI spar",
    kind: "local",
    mode: "danger",
    needsHero: true,
  },
  {
    id: "brawl",
    label: "Ruins Brawler",
    blurb: "Twin-stick co-op survival on the ruins map",
    kind: "local",
    mode: "brawl",
    needsHero: true,
  },
  {
    id: "survival",
    label: "Agama Survival",
    blurb: "Wave survival on the Agama map",
    kind: "local",
    mode: "survival",
    needsHero: true,
  },
  {
    id: "mimic",
    label: "Mimic Dungeon",
    blurb: "Test dungeon encounter",
    kind: "local",
    mode: "mimic",
    needsHero: true,
  },
  {
    id: "genesis",
    label: "Warlord Genesis",
    blurb: "3-lane MOBA / RTS — pick from your 4 campfire heroes",
    kind: "local",
    mode: "genesis",
    needsHero: true,
  },
  {
    id: "realms",
    label: "Mine-Loader Realms",
    blurb: "Authoritative voxel worlds · build · parties",
    kind: "local",
    mode: "realms",
    needsHero: false,
  },
  {
    id: "zones",
    label: "GRUDOX Zones",
    blurb: "Zone catalog · deep-links into fleet worlds",
    kind: "local",
    mode: "zones",
    needsHero: false,
  },
  {
    id: "vox-lab",
    label: "VoxGrudge Lab",
    blurb: "In-Open voxel lab + presence",
    kind: "local",
    mode: "voxgrudge-native",
    needsHero: false,
  },
  {
    id: "undead",
    label: "Voxel Undead",
    blurb: "Arcade sword survival cabinet",
    kind: "arcade",
    path: "/arcade/play/zombie",
    needsHero: true,
  },
];

/** PvP — lobby first, then spar / live modes. */
const PVP_DESTS: MenuDest[] = [
  {
    id: "lobby",
    label: "Multiplayer Lobby",
    blurb: "Rooms · community maps · join / host",
    kind: "local",
    mode: "lobby",
    needsHero: true,
  },
  {
    id: "spar",
    label: "Spar · Danger Room",
    blurb: "Live spar / PvP path with your hero",
    kind: "local",
    mode: "danger",
    needsHero: true,
  },
  {
    id: "z-brawl",
    label: "Z-Brawl",
    blurb: "Arena combat cabinet (GRUDOX arcade)",
    kind: "arcade",
    path: "/arcade/play/z-brawl",
    needsHero: true,
  },
  {
    id: "brawl-live",
    label: "Ruins Brawler Live",
    blurb: "Co-op / live ruins arena",
    kind: "local",
    mode: "brawl",
    needsHero: true,
  },
  {
    id: "arcade-lobby",
    label: "Arcade Lobby",
    blurb: "All GRUDOX Voxel Arcade cabinets",
    kind: "arcade",
    path: "/arcade/",
    needsHero: false,
  },
  {
    id: "realms-pvp",
    label: "Realms (world PvP)",
    blurb: "Mine-Loader worlds — combat & parties",
    kind: "local",
    mode: "realms",
    needsHero: false,
  },
];

/** Arena rail — ship deck / arcade focus. */
const ARENA_DESTS: MenuDest[] = [
  {
    id: "arcade",
    label: "Grudge Arena · Arcade",
    blurb: "GRUDOX Voxel Arcade hub",
    kind: "arcade",
    path: "/arcade/",
    needsHero: false,
  },
  {
    id: "z-brawl",
    label: "Z-Brawl Arena",
    blurb: "Arena combat cabinet",
    kind: "arcade",
    path: "/arcade/play/z-brawl",
    needsHero: true,
  },
  {
    id: "racer",
    label: "Voxel Velocity",
    blurb: "Street racer cabinet",
    kind: "arcade",
    path: "/arcade/play/racer",
    needsHero: false,
  },
  {
    id: "brawler-cab",
    label: "Ruins Brawler Cabinet",
    blurb: "Twin-stick co-op (arcade path)",
    kind: "arcade",
    path: "/arcade/play/brawler",
    needsHero: true,
  },
  {
    id: "danger-arena",
    label: "Danger Room Arena",
    blurb: "Local combat sandbox as arena",
    kind: "local",
    mode: "danger",
    needsHero: true,
  },
];

function heroCtx(hero: GenesisHeroOption | null): HubLaunchContext {
  return {
    characterId: hero?.id ?? null,
    baseId: hero?.baseId ?? null,
    name: hero?.name ?? null,
  };
}

function arcadeUrl(path: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://open.grudge-studio.com";
  // Prefer same-origin /arcade on open.* and gameopen (CF edge proxies to GRUDOX).
  const onOpen =
    typeof window !== "undefined" &&
    /open\.grudge-studio\.com|gameopen\.vercel\.app|localhost|127\.0\.0\.1/i.test(
      window.location.hostname,
    );
  if (onOpen) return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  return `https://open.grudge-studio.com${path.startsWith("/") ? path : `/${path}`}`;
}

export function CampfireLobby({ onExit, onNavigate, onAvatarEdit, onPlayDanger }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<CampfireLobbyScene | null>(null);
  const [fleet, setFleet] = useState<FleetCharacter[]>([]);
  const [heroes, setHeroes] = useState<GenesisHeroOption[]>([]);
  const [selected, setSelected] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loadingRoster, setLoadingRoster] = useState(true);

  const active = heroes[selected] ?? null;

  // Load fleet account characters (Railway SSOT) — never lab cast demos
  useEffect(() => {
    let cancelled = false;
    setLoadingRoster(true);
    void (async () => {
      try {
        const list = await listFleetCharacters();
        if (cancelled) return;
        setFleet(list);
        const opts = buildGenesisHeroOptions(list);
        setHeroes(opts);
        if (opts.length) setSelected(0);
      } catch (err) {
        console.warn("[CampfireLobby] fleet roster failed", err);
        if (!cancelled) {
          setHeroes(buildGenesisHeroOptions([]));
        }
      } finally {
        if (!cancelled) setLoadingRoster(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let scene: CampfireLobbyScene | null = null;
    try {
      scene = new CampfireLobbyScene(canvas, {
        onSelect: (i) => setSelected(i),
      });
      sceneRef.current = scene;
      void scene.setHeroes(heroes);
    } catch (err) {
      console.warn("[CampfireLobby] init failed", err);
    }
    return () => {
      scene?.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once; heroes via effect below
  }, []);

  useEffect(() => {
    void sceneRef.current?.setHeroes(heroes);
  }, [heroes]);

  useEffect(() => {
    sceneRef.current?.setSelected(selected);
    const h = heroes[selected];
    if (h) {
      activateCampfireHero(h);
    }
  }, [selected, heroes]);

  const slots = useMemo(() => {
    const out: (GenesisHeroOption | null)[] = [null, null, null, null];
    for (let i = 0; i < 4; i++) out[i] = heroes[i] ?? null;
    return out;
  }, [heroes]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const bindHero = useCallback((hero: GenesisHeroOption) => {
    activateCampfireHero(hero);
  }, []);

  const createInEmptySlot = useCallback(
    (slotIndex: number) => {
      // Open Character Studio (Foundry) for account create, or local draft + avatar edit
      const createUrl = buildCharacterCreateUrl();
      if (createUrl) {
        try {
          const u = new URL(createUrl);
          u.searchParams.set("slot", String(slotIndex));
          u.searchParams.set("returnTo", window.location.origin + "/?door=characters");
          window.location.assign(u.toString());
          return;
        } catch {
          /* fall through */
        }
      }
      // Local draft seat so empty accounts can still place a voxel explorer
      const draftId = `local-slot-${slotIndex}-${Date.now().toString(36)}`;
      saveGrudoxSlot({
        uuid: draftId,
        slot: slotIndex,
        name: "New Adventurer",
        baseId: "explorer",
        createdAt: Date.now(),
      });
      setHeroes(buildGenesisHeroOptions(fleet));
      setSelected(slotIndex);
      flash("Draft hero created — customize in Avatar editor");
      onAvatarEdit?.();
    },
    [fleet, flash, onAvatarEdit],
  );

  const launchLocal = useCallback(
    (mode: string, hero: GenesisHeroOption | null) => {
      if (hero) {
        bindHero(hero);
        if (mode === "danger" && onPlayDanger) {
          onPlayDanger(hero);
          return;
        }
      }
      onNavigate(mode);
    },
    [bindHero, onNavigate, onPlayDanger],
  );

  const launchDest = useCallback(
    (dest: MenuDest) => {
      if (dest.needsHero && !active) {
        flash("Create or select a campfire hero first");
        return;
      }
      if (active) bindHero(active);

      if (dest.kind === "local" && dest.mode) {
        setPanel(null);
        launchLocal(dest.mode, active);
        return;
      }
      if (dest.kind === "arcade" && dest.path) {
        setPanel(null);
        const url = arcadeUrl(dest.path);
        // Stay in collection shell when possible.
        window.location.assign(url);
        return;
      }
      if (dest.kind === "external" && dest.url) {
        setPanel(null);
        window.open(dest.url, "_blank", "noopener,noreferrer");
      }
    },
    [active, bindHero, flash, launchLocal],
  );

  const launchHub = useCallback(
    (dest: HubDestination) => {
      if (!active && dest.localMode && dest.localMode !== "doors" && dest.localMode !== "account") {
        // Most play destinations prefer a hero; still allow editors without.
        if (dest.group === "play") {
          flash("Select a campfire hero first");
          return;
        }
      }
      const ctx = heroCtx(active);
      setPanel(null);
      launchHubDestination(dest, ctx, {
        newTab: !dest.localMode,
        onLocal: (mode: LocalHubMode) => {
          if (mode === "lobbyWorld") {
            onNavigate("realms");
            return;
          }
          if (mode === "danger" && active && onPlayDanger) {
            onPlayDanger(active);
            return;
          }
          onNavigate(mode);
        },
      });
    },
    [active, flash, onNavigate, onPlayDanger],
  );

  const openPanel = (p: Panel) => {
    if ((p === "pve" || p === "pvp" || p === "arena") && !active) {
      flash("Create or select a campfire hero first");
      // Still open panel so they can see options / Realms without hero for some rows.
    }
    setPanel(p);
  };

  return (
    <div className="cfl-root">
      <canvas ref={canvasRef} className="cfl-canvas" />
      <div className="cfl-vignette" aria-hidden />

      {/* Top brand — charactersgrudox helmet + wordmark */}
      <div className="cfl-head">
        <img className="cfl-helmet" src={MENU("grudge-helmet.png")} alt="" />
        <img className="cfl-logo" src={MENU("grudge-logo.png")} alt="GRUDGE" />
        <p className="cfl-sub">
          {active
            ? "Your heroes — pick a seat, then launch from the wooden signs"
            : "Gather your band — first hero free · Account to create more"}
        </p>
      </div>

      {/* Compact top actions (secondary chrome) */}
      <header className="cfl-bar">
        <div className="cfl-brand">
          CHARACTERS<span>GRUDOX</span>
          <em>Ethereal Falls · account character page</em>
        </div>
        <div className="cfl-actions">
          <button type="button" className="cfl-btn primary" onClick={() => onAvatarEdit?.()}>
            Avatar editor
          </button>
          <button
            type="button"
            className="cfl-btn"
            onClick={() => {
              try {
                window.location.assign(buildCharacterCreateUrl() || "https://character.grudge-studio.com/?era=warlords");
              } catch {
                onNavigate("avatar");
              }
            }}
          >
            Create hero
          </button>
          <button type="button" className="cfl-btn" onClick={() => onNavigate("doors")}>
            Library
          </button>
          <button type="button" className="cfl-btn" onClick={onExit}>
            ↩ Home
          </button>
        </div>
      </header>

      {/* Wooden-sign main menu (right rail) — charactersgrudox parity */}
      <nav className="cfl-sign-menu" aria-label="Main menu">
        <button
          type="button"
          className="cfl-sign-btn"
          title={active ? "PvE — Open games (Danger, Brawl, Realms…)" : "Create a hero first"}
          onClick={() => openPanel("pve")}
        >
          <img src={MENU("pve.png")} alt="PvE" />
        </button>
        <button
          type="button"
          className="cfl-sign-btn"
          title={active ? "PvP — lobby + spar / live modes" : "Create a hero first"}
          onClick={() => openPanel("pvp")}
        >
          <img src={MENU("pvp.png")} alt="PvP" />
        </button>
        <button
          type="button"
          className="cfl-sign-btn"
          title="Arena — GRUDOX arcade cabinets"
          onClick={() => openPanel("arena")}
          onContextMenu={(e) => {
            e.preventDefault();
            launchDest(ARENA_DESTS[0]!);
          }}
        >
          <img src={MENU("grudge-arena.png")} alt="Grudge Arena" />
        </button>
        <button
          type="button"
          className="cfl-sign-btn"
          title="Leaderboard"
          onClick={() => setPanel("leaderboard")}
        >
          <img src={MENU("leaderboard.png")} alt="Leaderboard" />
        </button>
        <button type="button" className="cfl-sign-btn" title="Shop / perks" onClick={() => setPanel("shop")}>
          <img src={MENU("shop.png")} alt="Shop" />
        </button>
        <button
          type="button"
          className="cfl-sign-btn"
          title="Settings · avatar · account"
          onClick={() => setPanel("settings")}
        >
          <img src={MENU("settings.png")} alt="Settings" />
        </button>
        <button
          type="button"
          className="cfl-sign-btn cfl-sign-platform"
          title="GRUDOX systems — Velocity, worlds, editors"
          onClick={() => setPanel("grudox")}
        >
          <span className="cfl-sign-label">GRUDOX</span>
        </button>
      </nav>

      <div className="cfl-slots">
        {slots.map((h, i) => (
          <button
            key={i}
            type="button"
            className={`cfl-slot ${i === selected ? "on" : ""} ${h ? "" : "empty"}`}
            onClick={() => {
              if (h) setSelected(i);
              else createInEmptySlot(i);
            }}
          >
            <span className="cfl-slot-idx">Seat {i + 1}</span>
            <strong>{h?.name ?? (loadingRoster ? "…" : "Empty")}</strong>
            <span className="cfl-slot-meta">
              {h
                ? `${h.raceLabel} · ${h.source}`
                : loadingRoster
                  ? "Loading account…"
                  : "Create account character"}
            </span>
          </button>
        ))}
      </div>

      <div className="cfl-foot">
        <div className="cfl-pick">
          {active ? (
            <>
              <b>{active.name}</b>
              <span>
                {active.raceLabel} · base {active.baseId}
              </span>
            </>
          ) : (
            <span className="cfl-dim">No hero selected — click a campfire seat</span>
          )}
        </div>
        <div className="cfl-foot-actions">
          {active && (
            <button
              type="button"
              className="cfl-btn primary"
              onClick={() => active && onPlayDanger?.(active)}
            >
              Quick Danger
            </button>
          )}
          <button type="button" className="cfl-btn" onClick={() => onAvatarEdit?.()}>
            ✎ Avatar
          </button>
          <button
            type="button"
            className="cfl-btn"
            onClick={() => {
              try {
                window.location.assign(
                  buildCharacterCreateUrl(window.location.origin + "/?door=characters") ||
                    "https://character.grudge-studio.com/?era=warlords",
                );
              } catch {
                createInEmptySlot(Math.min(selected, 3));
              }
            }}
          >
            Manage heroes
          </button>
        </div>
      </div>

      {toast && (
        <div className="cfl-toast" role="status">
          {toast}
        </div>
      )}

      {/* ── Destination panels ─────────────────────────────────────────── */}
      {panel === "pve" && (
        <DestPanel
          title={active ? `PvE as ${active.name}` : "PvE games"}
          sub="Open PvE titles on open.grudge-studio.com — same hero handoff"
          onClose={() => setPanel(null)}
        >
          <div className="cfl-dest-grid">
            {PVE_DESTS.map((d) => (
              <button
                key={d.id}
                type="button"
                className="cfl-dest-btn"
                title={d.blurb}
                disabled={!!d.needsHero && !active}
                onClick={() => launchDest(d)}
              >
                <strong>{d.label}</strong>
                <span>{d.blurb}</span>
              </button>
            ))}
          </div>
        </DestPanel>
      )}

      {panel === "pvp" && (
        <DestPanel
          title={active ? `PvP as ${active.name}` : "PvP lobby & modes"}
          sub="Lobby first, then spar / live cabinets — stay on Open when possible"
          onClose={() => setPanel(null)}
        >
          <div className="cfl-dest-grid">
            {PVP_DESTS.map((d) => (
              <button
                key={d.id}
                type="button"
                className="cfl-dest-btn pvp"
                title={d.blurb}
                disabled={!!d.needsHero && !active}
                onClick={() => launchDest(d)}
              >
                <strong>{d.label}</strong>
                <span>{d.blurb}</span>
              </button>
            ))}
          </div>
        </DestPanel>
      )}

      {panel === "arena" && (
        <DestPanel
          title="Grudge Arena"
          sub="GRUDOX arcade cabinets · same-origin /arcade on open.grudge-studio.com"
          onClose={() => setPanel(null)}
        >
          <div className="cfl-dest-grid">
            {ARENA_DESTS.map((d) => (
              <button
                key={d.id}
                type="button"
                className="cfl-dest-btn arena"
                title={d.blurb}
                disabled={!!d.needsHero && !active}
                onClick={() => launchDest(d)}
              >
                <strong>{d.label}</strong>
                <span>{d.blurb}</span>
              </button>
            ))}
          </div>
        </DestPanel>
      )}

      {panel === "grudox" && (
        <DestPanel
          title={active ? `Play as ${active.name}` : "GRUDOX destinations"}
          sub="GRUDOX game systems · Open editors · same hero handoff"
          onClose={() => setPanel(null)}
        >
          {HUB_GROUPS.map((g) => {
            const items = HUB_DESTINATIONS.filter((d) => d.group === g.id);
            if (!items.length) return null;
            return (
              <div key={g.id} className="cfl-hub-group">
                <h3>{g.title}</h3>
                <div className="cfl-dest-grid">
                  {items.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`cfl-dest-btn${d.id === "character-studio" ? " gcs" : ""}`}
                      title={d.blurb}
                      onClick={() => launchHub(d)}
                    >
                      <strong>{d.label}</strong>
                      <span>{d.blurb}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </DestPanel>
      )}

      {panel === "leaderboard" && (
        <DestPanel title="Leaderboard" sub="Hall of fame — fleet stats coming online" onClose={() => setPanel(null)}>
          <p className="cfl-panel-body">
            Local hall of fame lives with your Danger Room runs. Multiplayer ranks will surface here from
            fleet rooms and Realms.
          </p>
          <div className="cfl-dest-grid">
            <button type="button" className="cfl-dest-btn" onClick={() => launchLocal("danger", active)}>
              <strong>Danger Room</strong>
              <span>Train and post runs</span>
            </button>
            <button type="button" className="cfl-dest-btn" onClick={() => launchLocal("lobby", active)}>
              <strong>Multiplayer Lobby</strong>
              <span>Rooms & community maps</span>
            </button>
            <button type="button" className="cfl-dest-btn" onClick={() => launchLocal("zones", null)}>
              <strong>Zones catalog</strong>
              <span>Fleet world standings links</span>
            </button>
          </div>
        </DestPanel>
      )}

      {panel === "shop" && (
        <DestPanel title="Shop" sub="Perks · frames · fleet store" onClose={() => setPanel(null)}>
          <p className="cfl-panel-body">
            Spend credits and manage loadouts from Account. Library Store lists live fleet titles.
          </p>
          <div className="cfl-dest-grid">
            <button
              type="button"
              className="cfl-dest-btn"
              onClick={() => {
                setPanel(null);
                try {
                  window.location.assign(
                    buildCharacterCreateUrl(window.location.origin + "/?door=characters"),
                  );
                } catch {
                  onNavigate("avatar");
                }
              }}
            >
              <strong>Account bag</strong>
              <span>Credits · wallet · characters</span>
            </button>
            <button type="button" className="cfl-dest-btn" onClick={() => { setPanel(null); onNavigate("doors"); }}>
              <strong>Library Store</strong>
              <span>Browse titles & featured shelves</span>
            </button>
            <button type="button" className="cfl-dest-btn" onClick={() => onAvatarEdit?.()}>
              <strong>Avatar cosmetics</strong>
              <span>Explorer head · modular face</span>
            </button>
          </div>
        </DestPanel>
      )}

      {panel === "settings" && (
        <DestPanel title="Settings" sub="Controls · avatar · account" onClose={() => setPanel(null)}>
          <div className="cfl-dest-grid">
            <button type="button" className="cfl-dest-btn" onClick={() => onAvatarEdit?.()}>
              <strong>Avatar editor</strong>
              <span>Explorer modular head system</span>
            </button>
            <button
              type="button"
              className="cfl-dest-btn"
              onClick={() => {
                setPanel(null);
                onNavigate("editor");
              }}
            >
              <strong>Dressing Room</strong>
              <span>Gear · anim · VFX lab</span>
            </button>
            <button
              type="button"
              className="cfl-dest-btn"
              onClick={() => {
                setPanel(null);
                try {
                  window.location.assign(
                    buildCharacterCreateUrl(window.location.origin + "/?door=characters"),
                  );
                } catch {
                  onNavigate("avatar");
                }
              }}
            >
              <strong>Account & SSO</strong>
              <span>Grudge ID · characters · treaty</span>
            </button>
            <button
              type="button"
              className="cfl-dest-btn"
              onClick={() => {
                setPanel(null);
                onNavigate("ledmask");
              }}
            >
              <strong>LED Mask / rooms</strong>
              <span>Frame skins & room gallery tools</span>
            </button>
          </div>
          <p className="cfl-panel-hint">
            Movement: WASD · Jump Space · Camera RMB drag · Combat LMB / skills 1–4 (mode dependent).
          </p>
        </DestPanel>
      )}
    </div>
  );
}

function DestPanel({
  title,
  sub,
  onClose,
  children,
}: {
  title: string;
  sub: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="cfl-panel" role="dialog" aria-label={title}>
      <div className="cfl-panel-inner">
        <h2>{title}</h2>
        <p className="cfl-panel-sub">{sub}</p>
        {children}
        <button type="button" className="cfl-panel-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
