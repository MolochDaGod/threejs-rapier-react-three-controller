import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Studio } from "./three/Studio";
import { LoadingScreen } from "./components/LoadingScreen";
import type { ReadinessSnapshot } from "./three/loading/readiness";
import { createRecoveryHandlers, teardownSession } from "./three/loading/sessionRecovery";
import { AppShell } from "./components/AppShell";
import { requestDressingPanel, type ToolDef } from "./components/toolbox/tools";
import type { AssistantConfig } from "./ai/AssistantSurface";
import { appGuideSystemPrompt } from "./ai/companionPrompt";
import { buildDangerTools, dangerSystemPrompt } from "./ai/dangerTools";
import { VoxelEditor } from "./three/voxel/VoxelEditor";
import {
  type ActionSlot,
  type Difficulty,
  type AleCameraMode,
  type ReplayFrequency,
  type EditorParams,
  type Faction,
  type HudSnapshot,
  type SlotBinding,
  type StatusId,
  type WeaponId,
} from "./three/types";
import { loadFireFx, saveFireFx, type FireFxParams } from "./three/fxSettings";
import { loadControls } from "./three/controlsSettings";
import { ROOM_PRESETS, ROOM_PRESET_LIST, asRoomPresetId, loadRoomPreset, saveRoomPreset, loadBackdrop, type RoomPresetId } from "./three/RoomPresets";
import { loadDjShow, saveDjShow } from "./three/djShowSettings";
import { loadSound, type SoundSettings } from "./three/soundSettings";
import { musicStation } from "./three/audio/musicStation";
import { djStationUrls, djStationTitles, djProducerTagUrl } from "./three/audio/djPlaylist";
import { loadDjStation, saveDjStation, type DjStationSettings } from "./three/djStationSettings";
import {
  RADIO_STATIONS,
  loadStationId,
  saveStationId,
  stationPlaylist,
  assertStation,
} from "./three/audio/radioStations";
import { LandingPage } from "./components/LandingPage";
import {
  readRememberedAnimatorCharacter,
  rememberAnimatorCharacter,
  resolveFleetPlayerLoadout,
} from "./auth/fleetCharacter";
import { SoundMixer, SoundLevels, type SoundChannel } from "./components/SoundMixer";
import { DjStationPanel, DjStationBody, type DjNowPlaying } from "./components/DjStationPanel";
import type {
  BrushState,
  DeployableNode,
  EditorStats,
  GizmoMode,
  VoxelMap,
} from "./three/voxel/types";
import { Crosshair } from "./components/Crosshair";
import { Hud } from "./components/Hud";
import { MechHud } from "./components/MechHud";
import { EquipmentScreen } from "./components/EquipmentScreen";
import {
  loadArmorLoadoutFromStorage,
  saveArmorLoadoutToStorage,
  type ArmorLoadout,
} from "./three/equipment";
import { AdminPanel } from "./components/AdminPanel";
import { EnvThumb } from "./components/EnvThumb";
import { EditorPanel } from "./components/EditorPanel";
import { AnimationsPanel } from "./components/AnimationsPanel";
import { AnimationDebugger } from "./components/AnimationDebugger";
import { TouchControls } from "./components/TouchControls";
import { StatusBar } from "./components/StatusBar";
import { StatusDock } from "./components/StatusDock";
import { DoorSelect } from "./components/DoorSelect";
import { EditorMode } from "./components/editor/EditorMode";
import { Lobby } from "./components/Lobby";
import { LobbyWorldMode } from "./components/LobbyWorldMode";
import { CharactersGrudoxMode } from "./components/CharactersGrudoxMode";
import { MineGrudgeEditorMode } from "./components/MineGrudgeEditorMode";
import { LedMaskMode } from "./components/LedMaskMode";
import { RoomGallery } from "./components/RoomGallery";
import { AvatarEditMode } from "./components/AvatarEditMode";
import { VoxelEditorUI } from "./components/VoxelEditorUI";
import { VoxelMapsPanel } from "./components/VoxelMapsPanel";
import { VoxelTemplatePicker } from "./components/VoxelTemplatePicker";
import type { MapTemplate } from "./three/voxel/templates";
import {
  deleteMap,
  exportMap,
  importMap,
  listMaps,
  loadMap,
  saveMap,
  type StoredMapMeta,
} from "./three/voxel/mapStore";
import type { CreatePostPayload } from "@workspace/api-client-react";
import type { SceneDescriptor } from "./three/editor/types";
import { DangerClient } from "./net/DangerClient";
import { useDevice } from "./hooks/useDevice";
import { DockSurface, ToolMenubar, Tip, TipProvider, useDockLayout } from "./components/dock";
import type { DockPanelDef, DockPanelMeta, ToolMenu } from "./components/dock";
import { DoorOpen, ShieldHalf, SlidersHorizontal, Film, RotateCcw, LayoutDashboard, Swords, Activity } from "lucide-react";
import { HudEditor } from "./components/hud/HudEditor";
import { useHudEditor } from "./hud/useHudEditor";
import { resolveHudVars } from "./hud/hudConfig";
import "./index.css";
import "./components/dock/dock.css";

type Mode =
  | "landing"
  | "doors"
  | "danger"
  | "voxel"
  | "play"
  | "editor"
  | "lobby"
  | "lobbyWorld"
  | "characters"
  | "minegrudge"
  | "ledmask"
  | "avatar";

// Optional deep-link: `?door=editor|danger|voxel|lobby|lobbyWorld|characters|minegrudge|…`
// surface on load. Default entry is landing (Grudge ID); doors hall is home.
function initialMode(): Mode {
  try {
    const d = new URLSearchParams(window.location.search).get("door");
    if (
      d === "editor" ||
      d === "danger" ||
      d === "voxel" ||
      d === "lobby" ||
      d === "lobbyWorld" ||
      d === "characters" ||
      d === "charactersgrudox" ||
      d === "minegrudge" ||
      d === "grudoxEditor" ||
      d === "ledmask" ||
      d === "avatar" ||
      d === "doors"
    ) {
      if (d === "charactersgrudox") return "characters";
      if (d === "grudoxEditor") return "minegrudge";
      return d;
    }
  } catch {
    /* no-op */
  }
  return "landing";
}

const DEFAULT_BRUSH: BrushState = {
  tool: "block",
  shape: "block",
  color: 0x6ea8ff,
  deployKind: "npc",
  weapon: "sword",
  difficulty: "normal",
  prop: "brewingStand",
  rotation: 0,
};

// Danger Room dockable panels — all hidden until summoned (hotkey / menu).
const DANGER_PANEL_METAS: DockPanelMeta[] = [
  { id: "admin", home: "left", defaultVisible: false },
  { id: "editor", home: "right", defaultVisible: false },
  { id: "anim", home: "right", defaultVisible: false },
  { id: "animdbg", home: "left", defaultVisible: false },
];
type DangerPanelId = "admin" | "editor" | "anim" | "animdbg";

export default function App() {
  const [mode, setMode] = useState<Mode>(initialMode);
  const mountRef = useRef<HTMLDivElement>(null);
  const studioRef = useRef<Studio | null>(null);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [equipOpen, setEquipOpen] = useState(false);
  const equipOpenRef = useRef(false);
  equipOpenRef.current = equipOpen;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // Never carry the loadout overlay across surfaces (doors/editor/play/danger) —
  // EXCEPT when the Toolbox just launched "Loadout Card" from another mode, in
  // which case the pending flag survives exactly one switch into the Danger Room.
  const pendingEquipRef = useRef(false);
  useEffect(() => {
    if (pendingEquipRef.current && mode === "danger") {
      pendingEquipRef.current = false;
      setEquipOpen(true);
      return;
    }
    pendingEquipRef.current = false;
    setEquipOpen(false);
  }, [mode]);
  // Persistent background music (CPT RAC Station), hoisted to the app root so it
  // NEVER resets when switching pages/modes. The per-mode Studio engine is torn
  // down and rebuilt on navigation; owning the station up here (a singleton wired
  // into THREE's global AudioContext) keeps the same track playing across doors,
  // Dressing Room, lobby, play, and danger. Started once on mount; a first user
  // gesture is needed to satisfy browser autoplay, so retry resume on pointer/key.
  const [djStation, setDjStation] = useState<DjStationSettings>(() => loadDjStation());
  const [djNow, setDjNow] = useState<DjNowPlaying | null>(null);
  // Radio station picker state: which station is tuned (persisted), the live
  // track list (differs per station), transport (paused / station mute), and a
  // busy label while a free stream station's playlist is being fetched.
  const [djStationId, setDjStationId] = useState<string>(() => loadStationId());
  const [djTitles, setDjTitles] = useState<string[]>([]);
  const [djPaused, setDjPaused] = useState(false);
  const [djMuted, setDjMuted] = useState(false);
  const [djBusy, setDjBusy] = useState<string | null>(null);
  // Monotonic token so only the latest station-switch request applies (rapid
  // switching: a slow earlier Audius fetch must not overwrite a newer pick).
  const djStationReqRef = useRef(0);
  const djStationName =
    RADIO_STATIONS.find((s) => s.id === djStationId)?.name ?? RADIO_STATIONS[0].name;
  useEffect(() => {
    // Apply persisted DJ settings BEFORE the first start so the random-start
    // choice + auto-mix behaviour are honoured on the opening track.
    musicStation.configure(loadDjStation());
    musicStation.setOnTrack((title, index) => {
      setDjNow({ title, index, count: musicStation.getInfo()?.count ?? 0 });
      setDjTitles(musicStation.getTitles());
      setDjPaused(musicStation.isPaused());
    });
    // Cue the persisted station (local set instantly; Audius streams fetch, then
    // fall back to the local set inside assertStation if the network is down).
    assertStation((urls, titles) => {
      musicStation.setPlaylist(urls, titles);
      setDjTitles(titles);
      const inf = musicStation.getInfo();
      if (inf) setDjNow({ title: inf.title, index: inf.index, count: inf.count });
    });
    const info = musicStation.getInfo();
    if (info) setDjNow({ title: info.title, index: info.index, count: info.count });
    setDjPaused(musicStation.isPaused());
    setDjMuted(musicStation.isStationMuted());
    const resume = () => musicStation.resume();
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
      musicStation.setOnTrack(null);
    };
  }, []);
  // Prefer last fleet/GRUDOX character so reloads keep the Warlords hero.
  const [characterId, setCharacterId] = useState(
    () => readRememberedAnimatorCharacter() || "explorer",
  );
  const [weaponId, setWeaponId] = useState<WeaponId>("sword");
  const [offHand, setOffHandState] = useState<WeaponId | null>(null);
  const [armorLoadout, setArmorLoadoutState] = useState<ArmorLoadout>(() =>
    loadArmorLoadoutFromStorage(),
  );
  const onArmorLoadout = useCallback((loadout: ArmorLoadout) => {
    setArmorLoadoutState(loadout);
    saveArmorLoadoutToStorage(loadout);
  }, []);
  const [fleetHeroName, setFleetHeroName] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  // Hydrate from persisted controls so the saved controller/camera/mouse feel
  // is the source of truth on mount — Studio also loads these, and pushing this
  // matching state via setParams keeps both sides in sync instead of clobbering
  // the saved values back to DEFAULT_EDITOR.
  const [params, setParams] = useState<EditorParams>(() => loadControls());
  const [timeScale, setTimeScale] = useState(1);
  const [fireFx, setFireFx] = useState<FireFxParams>(() => loadFireFx());
  const { layout: dangerLayout, controls: dangerDock } = useDockLayout("animator.danger.dock.v1", DANGER_PANEL_METAS);
  const [clips, setClips] = useState<string[]>([]);
  const [slots, setSlots] = useState<SlotBinding[]>([]);
  const [webglError, setWebglError] = useState(false);
  // Play-test loading screen state, mirrored from the engine's readiness gate
  // (null = no gated session in progress). Reset on every mount/teardown.
  const [loading, setLoading] = useState<ReadinessSnapshot | null>(null);
  // Bumped to force the play/danger engine effect to tear down and re-mount the
  // gated session — used by the loading screen's "Retry" after a failed load so a
  // single failed asset never strands the player on the overlay.
  const [sessionKey, setSessionKey] = useState(0);
  // Loading-screen recovery glue (extracted + unit-tested in sessionRecovery.ts):
  // Retry clears the stale snapshot + bumps sessionKey to re-mount a fresh gated
  // session; Back returns to the door menu.
  const recovery = useMemo(
    () => createRecoveryHandlers({ setLoading, setSessionKey, setMode }),
    [],
  );
  const [dockOpen, setDockOpen] = useState(false);
  const [sound, setSound] = useState<SoundSettings>(() => loadSound());
  // Keep the persistent station's loudness + mute synced to the mixer regardless
  // of which mode is active (the Studio's CombatSfx also drives it while mounted,
  // but this covers the audio-less surfaces: doors / Dressing Room / lobby).
  useEffect(() => {
    musicStation.setLevel(sound.music, sound.master);
    musicStation.setMuted(sound.muted);
  }, [sound.music, sound.master, sound.muted]);
  const [roomPreset, setRoomPreset] = useState<RoomPresetId>(() => loadRoomPreset());
  const [backdropId, setBackdropId] = useState<string | null>(() => loadBackdrop());
  const [djShow, setDjShow] = useState<boolean>(() => loadDjShow());
  const [hudEditing, setHudEditing] = useState(false);
  const hudEditor = useHudEditor();
  // The api passed to the HUD: applies persisted layout always, drag/select only while editing.
  const hudEdit = hudEditor.api(hudEditing);
  const themeVars = resolveHudVars(hudEditor.config) as React.CSSProperties;
  // The full-screen "doors / Dressing Room / Lobby" screens return before the
  // main `.studio` wrapper, so they normally get neither the theme tokens nor
  // the `hud-themed` gating class. When a non-default theme is active, wrap them
  // in a matching `.studio.hud-themed` host (carrying `themeVars`) so the bold
  // theme reaches them too. When no theme is active we render them bare, so the
  // stock look stays byte-identical.
  const themeActive = hudEditor.config.theme !== "default";
  const withScreenTheme = (node: React.ReactNode) =>
    themeActive ? (
      <div className="studio hud-themed" style={themeVars}>
        {node}
      </div>
    ) : (
      node
    );
  // Drive on-screen touch controls off real input capability (so iPads get them
  // and a small mouse-driven window does not), not just viewport width.
  const { touchUI: isMobile } = useDevice();

  // Voxel editor state.
  const voxelRef = useRef<VoxelEditor | null>(null);
  const [brush, setBrush] = useState<BrushState>({ ...DEFAULT_BRUSH });
  const [veStats, setVeStats] = useState<EditorStats | null>(null);
  const [veTree, setVeTree] = useState<DeployableNode[]>([]);
  const [veSel, setVeSel] = useState<string | null>(null);
  const [veGizmo, setVeGizmo] = useState<GizmoMode>("translate");
  const [veSnap, setVeSnap] = useState(true);
  const [dungeon, setDungeon] = useState(false);
  /** The map handed to the play session, restored into the editor on exit. */
  const playMapRef = useRef<VoxelMap | null>(null);
  // A gallery map queued to load when the voxel editor next mounts.
  const pendingMapRef = useRef<VoxelMap | null>(null);
  // A gallery scene queued to load when the Scene Editor next mounts.
  const pendingSceneRef = useRef<SceneDescriptor | null>(null);
  /** Set when returning to the editor from a play session (re-loads the map). */
  const cameFromPlayRef = useRef(false);

  // Multi-map persistence state.
  const [mapsOpen, setMapsOpen] = useState(false);
  // Starting-map template picker (shown on a fresh editor entry + via "New").
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [maps, setMaps] = useState<StoredMapMeta[]>([]);
  const [mapName, setMapName] = useState("");
  const [currentMapId, setCurrentMapId] = useState<string | null>(null);

  const hudRef = useRef<(h: HudSnapshot) => void>(() => {});
  hudRef.current = setHud;

  // Multiplayer relay: a single client lives in the Lobby and is handed to the
  // Studio so the session survives the lobby → Danger Room transition.
  const netRef = useRef<DangerClient | null>(null);
  const getNet = useCallback(() => {
    if (!netRef.current) netRef.current = new DangerClient();
    return netRef.current;
  }, []);
  /** True while the active Danger Room session is a networked multiplayer room. */
  const inRoomRef = useRef(false);
  /** The resolved room content map (null = built-in arena), set on room entry. */
  const roomMapRef = useRef<VoxelMap | null>(null);
  /**
   * The networked room's chosen environment preset, set on room entry. Overrides
   * the joiner's own local default so everyone in the room sees the same arena.
   * Null when the room carried no (or an unknown) preset.
   */
  const roomPresetRef = useRef<RoomPresetId | null>(null);

  const refreshAnim = useCallback(() => {
    const s = studioRef.current;
    if (!s) return;
    setClips(s.clipNames());
    setSlots(s.getSlotBindings());
  }, []);

  // Show/hide a Danger Room dock panel, mirroring the old hotkey side effects
  // (release pointer-lock when surfacing a panel; refresh clips for the anim panel).
  const toggleDangerPanel = useCallback(
    (id: DangerPanelId) => {
      if (!dangerDock.isVisible(id)) {
        document.exitPointerLock?.();
        if (id === "anim") refreshAnim();
      }
      dangerDock.togglePanel(id);
    },
    [dangerDock, refreshAnim],
  );

  // Mount the Danger Room engine while in combat mode.
  useEffect(() => {
    if (mode !== "danger" || !mountRef.current) return;
    const roomMap = inRoomRef.current ? roomMapRef.current : null;
    let studio: Studio | null = null;
    try {
      // Gate the session behind the readiness loading screen. A networked room
      // with a chosen map builds that arena during load; a plain Danger Room
      // play-session gates on character + weapon + physics only (no arena).
      // Spawn the fleet/GRUDOX hero when known; otherwise Explorer procedural.
      studio = new Studio(mountRef.current, characterId, (h) => hudRef.current(h), {
        gate: roomMap ? { arena: roomMap } : {},
      });
      // The engine owns the arena build now (kicked off internally once the rig
      // is ready), so this only refreshes the animation list.
      studio.onCharacterLoaded = () => refreshAnim();
      studio.onReadiness = (s) => setLoading(s);
      setLoading(studio.readinessSnapshot());
      studio.setFireParams(loadFireFx());
      // Re-read persisted controls at every mount so engine-only mutations
      // (e.g. wheel-zoom cameraDistance, saved on the previous teardown) win on
      // re-entry, and sync them back into React state so the settings sliders
      // and the engine never diverge. Stale React state must not clobber them.
      const persistedControls = loadControls();
      setParams(persistedControls);
      studio.setParams(persistedControls);
      studio.setTimeScale(timeScale);
      studio.setWeapon(weaponId);
      if (offHand) studio.setOffHand(offHand);
      // A networked room dictates its environment preset; apply it over the
      // engine's local default so every joiner sees the same arena. This adopts
      // the room's current preset, so don't re-broadcast it back to the relay.
      if (inRoomRef.current && roomPresetRef.current) {
        studio.setRoomPreset(roomPresetRef.current, { propagate: false });
      }
      // Apply the persisted DJ light-show toggle over the engine's default.
      studio.setDjShow(loadDjShow());
      // The host may swap the arena mid-session; mirror that into our React state
      // so the menubar selection tracks the arena every joiner is now in.
      studio.onRoomPresetChanged = (id) => {
        roomPresetRef.current = id;
        setRoomPreset(id);
      };
      studioRef.current = studio;
      studio.setTouchMode(isMobile);
      // Hand the live relay client to the engine for multiplayer rooms.
      if (inRoomRef.current && netRef.current) studio.attachNet(netRef.current);
      refreshAnim();
    } catch (err) {
      console.error("[Animator] failed to start renderer", err);
      setWebglError(true);
    }
    return () =>
      teardownSession(studio, () => {
        studioRef.current = null;
      }, setLoading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sessionKey]);

  // Mount a fresh Danger Room and load the authored map into it (play/test mode).
  useEffect(() => {
    if (mode !== "play" || !mountRef.current) return;
    const map = playMapRef.current;
    if (!map) {
      setMode("voxel");
      return;
    }
    let studio: Studio | null = null;
    try {
      // Gate the play session behind the readiness loading screen; the engine
      // builds the authored arena internally once the rig is ready.
      studio = new Studio(mountRef.current, characterId, (h) => hudRef.current(h), {
        gate: { arena: map },
      });
      studio.onCharacterLoaded = () => refreshAnim();
      studio.onReadiness = (s) => setLoading(s);
      setLoading(studio.readinessSnapshot());
      studio.setFireParams(loadFireFx());
      studio.setWeapon(weaponId);
      if (offHand) studio.setOffHand(offHand);
      // Re-read persisted controls at every mount so engine-only mutations
      // (e.g. wheel-zoom cameraDistance, saved on the previous teardown) win on
      // re-entry, and sync them back into React state so the settings sliders
      // and the engine never diverge. Stale React state must not clobber them.
      const persistedControls = loadControls();
      setParams(persistedControls);
      studio.setParams(persistedControls);
      studio.setTimeScale(timeScale);
      studioRef.current = studio;
      studio.setTouchMode(isMobile);
      refreshAnim();
    } catch (err) {
      console.error("[Animator] failed to start play session", err);
      setWebglError(true);
    }
    return () =>
      teardownSession(studio, () => {
        studioRef.current = null;
      }, setLoading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sessionKey]);

  // Mount the Voxel Editor engine while in editor mode.
  useEffect(() => {
    if (mode !== "voxel" || !mountRef.current) return;
    let editor: VoxelEditor | null = null;
    try {
      editor = new VoxelEditor(mountRef.current);
      editor.onStats = (s) => setVeStats(s);
      editor.onTree = (t) => setVeTree(t);
      editor.onSelect = (id) => setVeSel(id);
      editor.onGizmoMode = (m) => setVeGizmo(m);
      editor.setBrush(DEFAULT_BRUSH);
      editor.setSnap(veSnap);
      voxelRef.current = editor;
      setBrush({ ...DEFAULT_BRUSH });
      setVeSel(null);
      setVeTree([]);
      setMaps(listMaps());
      // A gallery map was queued for loading from the Lobby.
      if (pendingMapRef.current) {
        editor.load(pendingMapRef.current);
        setDungeon(!!pendingMapRef.current.dungeon);
        setCurrentMapId(null);
        setMapName("");
        pendingMapRef.current = null;
        setTemplatesOpen(false);
      } else if (cameFromPlayRef.current && playMapRef.current) {
        // Returning from a play session: restore the map that was being tested.
        editor.load(playMapRef.current);
        setDungeon(playMapRef.current.dungeon);
        setTemplatesOpen(false);
      } else {
        // Fresh entry on an empty pad — offer the starting-map templates.
        setDungeon(false);
        setCurrentMapId(null);
        setMapName("");
        setTemplatesOpen(true);
      }
      cameFromPlayRef.current = false;
    } catch (err) {
      console.error("[Animator] failed to start voxel editor", err);
      setWebglError(true);
    }
    return () => {
      editor?.dispose();
      voxelRef.current = null;
      setVeStats(null);
      setVeTree([]);
      setVeSel(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Engine-side keyboard shortcuts (jump / skills) + panel toggles. Danger only.
  useEffect(() => {
    if (mode !== "danger") return;
    const onKey = (e: KeyboardEvent) => {
      // Esc closes the loadout overlay even while its search box is focused, so
      // handle it BEFORE the input-target guard below.
      if (e.code === "Escape" && equipOpenRef.current) {
        setEquipOpen(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.repeat) return;
      if (e.code === "KeyI") {
        e.preventDefault();
        const next = !equipOpenRef.current;
        setEquipOpen(next);
        if (next) document.exitPointerLock?.();
        return;
      }
      if (e.code === "Tab") {
        // Tab = cycle the soft-lock enemy; Shift+Tab rotates the ally; Alt+Tab
        // leaves soft-lock for a fully free camera.
        e.preventDefault();
        if (e.altKey) studioRef.current?.exitSoftLock();
        else if (e.shiftKey) studioRef.current?.cycleAllyTarget();
        else {
          studioRef.current?.enableSoftLock();
          studioRef.current?.cycleTarget();
        }
        return;
      }
      if (e.code === "ControlLeft" || e.code === "ControlRight") {
        // Ctrl (hold) = block; preventDefault suppresses browser Ctrl shortcuts
        // (e.g. Ctrl+W) while guarding mid-fight.
        e.preventDefault();
        studioRef.current?.handleKey(e.code);
        return;
      }
      if (e.code === "Backquote") {
        // Admin panel hotkey (moved off Tab).
        e.preventDefault();
        toggleDangerPanel("admin");
        return;
      }
      if (e.code === "KeyE") {
        // The door portal claims E first when standing at an interactable.
        if (studioRef.current?.tryEnterDoor()) {
          e.preventDefault();
          return;
        }
        // While the canvas has pointer-lock (in-game), E is the Block action.
        // Only toggle the editor panel when we're NOT in pointer-lock.
        if (!document.pointerLockElement) {
          toggleDangerPanel("editor");
          return;
        }
        // In pointer-lock: fall through so studio.handleKey("KeyE") fires below.
      }
      if (e.code === "KeyC") {
        toggleDangerPanel("anim");
        return;
      }
      studioRef.current?.handleKey(e.code);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, refreshAnim, toggleDangerPanel]);

  // Play/test mode: combat keys + lock-on only (no editor/admin/clips panels).
  useEffect(() => {
    if (mode !== "play") return;
    const onKey = (e: KeyboardEvent) => {
      // Esc closes the loadout overlay even while its search box is focused, so
      // handle it BEFORE the input-target guard below.
      if (e.code === "Escape" && equipOpenRef.current) {
        setEquipOpen(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.repeat) return;
      if (e.code === "KeyI") {
        e.preventDefault();
        const next = !equipOpenRef.current;
        setEquipOpen(next);
        if (next) document.exitPointerLock?.();
        return;
      }
      if (e.code === "Tab") {
        // Tab = cycle the soft-lock enemy; Shift+Tab rotates the ally; Alt+Tab
        // leaves soft-lock for a fully free camera.
        e.preventDefault();
        if (e.altKey) studioRef.current?.exitSoftLock();
        else if (e.shiftKey) studioRef.current?.cycleAllyTarget();
        else {
          studioRef.current?.enableSoftLock();
          studioRef.current?.cycleTarget();
        }
        return;
      }
      if (e.code === "ControlLeft" || e.code === "ControlRight") {
        // Ctrl (hold) = block; preventDefault suppresses browser Ctrl shortcuts.
        e.preventDefault();
        studioRef.current?.handleKey(e.code);
        return;
      }
      studioRef.current?.handleKey(e.code);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  // Touch devices: tell the engine to skip pointer-lock-on-tap so the on-screen
  // joystick/look-pad own input. Re-applies whenever the breakpoint flips.
  useEffect(() => {
    studioRef.current?.setTouchMode(isMobile);
  }, [isMobile]);

  // Pull the player's active Warlords character (created on GRUDOX / fleet) into
  // this game as the playable Grudge modular avatar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loadout = await resolveFleetPlayerLoadout();
        if (cancelled || !loadout) return;
        setCharacterId(loadout.characterId);
        setWeaponId(loadout.weaponId);
        setOffHandState(loadout.offHand);
        setFleetHeroName(loadout.displayName);
        rememberAnimatorCharacter(loadout.characterId, loadout.source.id);
        const studio = studioRef.current;
        if (studio) {
          studio.setCharacter(loadout.characterId);
          studio.setWeapon(loadout.weaponId);
          studio.setOffHand(loadout.offHand);
        }
        console.info(
          "[Animator] fleet hero →",
          loadout.characterId,
          loadout.displayName,
          loadout.source.id,
        );
      } catch (err) {
        console.warn("[Animator] fleet character resolve failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onCharacter = useCallback((id: string) => {
    setCharacterId(id);
    rememberAnimatorCharacter(id);
    studioRef.current?.setCharacter(id);
  }, []);

  const onWeapon = useCallback((id: WeaponId) => {
    setWeaponId(id);
    studioRef.current?.setWeapon(id);
  }, []);

  const onOffHand = useCallback((id: WeaponId | null) => {
    setOffHandState(id);
    studioRef.current?.setOffHand(id);
  }, []);

  // Open the in-play loadout overlay (release pointer-lock so the cursor is free).
  const openEquip = useCallback(() => {
    setEquipOpen(true);
    document.exitPointerLock?.();
  }, []);

  const onDifficulty = useCallback((d: Difficulty) => {
    setDifficulty(d);
    studioRef.current?.setDifficulty(d);
  }, []);

  const onSpawn = useCallback((id: WeaponId, faction: Faction) => {
    studioRef.current?.spawnNpc(id, faction);
  }, []);

  const onSpawnBoss = useCallback((id: WeaponId) => {
    studioRef.current?.spawnBoss(id);
  }, []);

  const onClearNpcs = useCallback(() => {
    studioRef.current?.clearNpcs();
  }, []);

  const onStartDuel = useCallback((teamSize: number) => {
    studioRef.current?.startDuel(teamSize);
  }, []);

  const onStopDuel = useCallback(() => {
    studioRef.current?.stopDuel();
  }, []);

  const onDuelCamera = useCallback((mode: AleCameraMode) => {
    studioRef.current?.setDuelCamera(mode);
  }, []);

  const onToggleDiagnostics = useCallback(() => {
    studioRef.current?.toggleDuelDiagnostics();
  }, []);

  const onStartReplay = useCallback(() => {
    studioRef.current?.startReplay();
  }, []);

  const onReplayPause = useCallback((paused: boolean) => {
    studioRef.current?.setReplayPaused(paused);
  }, []);

  const onReplaySpeed = useCallback((speed: number) => {
    studioRef.current?.setReplaySpeed(speed);
  }, []);

  const onReplaySeek = useCallback((progress: number) => {
    studioRef.current?.seekReplay(progress);
  }, []);

  const onReplayCamera = useCallback((mode: AleCameraMode) => {
    studioRef.current?.setReplayCamera(mode);
  }, []);

  const onStopReplay = useCallback(() => {
    studioRef.current?.stopReplay();
  }, []);

  const onSetReplayFrequency = useCallback((freq: ReplayFrequency) => {
    studioRef.current?.setReplayFrequency(freq);
  }, []);

  const getMapPayload = useCallback(
    (): CreatePostPayload | null =>
      (voxelRef.current?.serialize() ?? null) as CreatePostPayload | null,
    [],
  );

  const onParam = useCallback((patch: Partial<EditorParams>) => {
    setParams((p) => {
      const next = { ...p, ...patch };
      studioRef.current?.setParams(patch);
      return next;
    });
  }, []);

  // Whitelisted AI tool surface for the Danger Room — bound to the same App
  // callbacks the Admin/Settings panels drive (handlers are stable useCallbacks).
  const dangerAiTools = useMemo(
    () => buildDangerTools({ onCharacter, onWeapon, onDifficulty, onSpawn, onSpawnBoss, onClearNpcs, onParam }),
    [onCharacter, onWeapon, onDifficulty, onSpawn, onSpawnBoss, onClearNpcs, onParam],
  );

  const onTimeScale = useCallback((scale: number) => {
    setTimeScale(scale);
    studioRef.current?.setTimeScale(scale);
  }, []);

  const onRoomPreset = useCallback((id: RoomPresetId) => {
    setRoomPreset(id);
    saveRoomPreset(id);
    studioRef.current?.setRoomPreset(id);
  }, []);

  const onBackdrop = useCallback((id: string | null) => {
    setBackdropId(id);
    studioRef.current?.setBackdrop(id);
  }, []);

  const onToggleDjShow = useCallback(() => {
    setDjShow((on) => {
      const next = !on;
      saveDjShow(next);
      studioRef.current?.setDjShow(next);
      return next;
    });
  }, []);

  const onToggleMute = useCallback(() => {
    setSound((s) => {
      const next = !s.muted;
      studioRef.current?.setMuted(next);
      return { ...s, muted: next };
    });
  }, []);

  const onSoundLevel = useCallback((channel: SoundChannel, value: number) => {
    studioRef.current?.setSoundLevel(channel, value);
    setSound((s) => ({ ...s, [channel]: value }));
  }, []);

  const onDjChange = useCallback((patch: Partial<DjStationSettings>) => {
    setDjStation((s) => {
      const next = { ...s, ...patch };
      saveDjStation(next);
      musicStation.configure(next);
      return next;
    });
  }, []);
  const onDjPrev = useCallback(() => {
    musicStation.prev();
    setDjPaused(false);
  }, []);
  const onDjNext = useCallback(() => {
    musicStation.next();
    setDjPaused(false);
  }, []);
  const onDjSelect = useCallback((i: number) => {
    musicStation.playAt(i);
    setDjPaused(false);
  }, []);
  const onDjReset = useCallback(() => {
    musicStation.reset();
    setDjPaused(false);
  }, []);
  const onDjTogglePlay = useCallback(() => {
    if (musicStation.isPaused()) musicStation.play();
    else musicStation.pause();
    setDjPaused(musicStation.isPaused());
  }, []);
  const onDjToggleMute = useCallback(() => {
    const next = !musicStation.isStationMuted();
    musicStation.setStationMuted(next);
    setDjMuted(next);
  }, []);
  const onDjMixNext = useCallback(() => {
    musicStation.mixNext();
    setDjPaused(false);
  }, []);
  const onDjStationSelect = useCallback((id: string) => {
    const def = RADIO_STATIONS.find((s) => s.id === id);
    if (!def) return;
    saveStationId(id);
    setDjStationId(id);
    setDjBusy(def.name);
    // Only the LATEST switch request may apply — a slower earlier fetch must
    // not clobber a newer pick (or force a stale fallback after it).
    const token = ++djStationReqRef.current;
    stationPlaylist(id)
      .then((list) => {
        if (djStationReqRef.current !== token) return;
        musicStation.setStationName(def.name);
        // stationPlaylist already arms/clears the CPT RAC producer tag.
        musicStation.setPlaylist(list.urls, list.titles);
        setDjTitles(list.titles);
        setDjPaused(false);
        const inf = musicStation.getInfo();
        if (inf) setDjNow({ title: inf.title, index: inf.index, count: inf.count });
      })
      .catch(() => {
        if (djStationReqRef.current !== token) return;
        // Stream source unreachable — fall back to the local CPT RAC set.
        saveStationId("cpt-rac");
        setDjStationId("cpt-rac");
        musicStation.setStationName(RADIO_STATIONS[0].name);
        // stationPlaylist sets the tag; hard-fallback must arm it too.
        musicStation.setProducerTag(djProducerTagUrl());
        musicStation.setPlaylist(djStationUrls(), djStationTitles());
        setDjTitles(djStationTitles());
      })
      .finally(() => {
        if (djStationReqRef.current === token) setDjBusy(null);
      });
  }, []);

  const onFireFx = useCallback((patch: Partial<FireFxParams>) => {
    setFireFx((p) => {
      const next = { ...p, ...patch };
      studioRef.current?.setFireParams(next);
      saveFireFx(next);
      return next;
    });
  }, []);

  const onImpactTest = useCallback(() => {
    studioRef.current?.testImpactExplode();
  }, []);

  const onPreview = useCallback((clip: string) => {
    studioRef.current?.previewClip(clip);
  }, []);

  const onAssign = useCallback((slot: ActionSlot, clip: string | null) => {
    studioRef.current?.setSlotAssignment(slot, clip);
    setSlots(studioRef.current?.getSlotBindings() ?? []);
  }, []);

  // ── Voxel editor handlers ──────────────────────────────────────────────────
  const onBrush = useCallback((patch: Partial<BrushState>) => {
    setBrush((b) => {
      const next = { ...b, ...patch };
      voxelRef.current?.setBrush(patch);
      return next;
    });
  }, []);

  const onDungeon = useCallback((on: boolean) => {
    setDungeon(on);
    voxelRef.current?.setDungeon(on);
  }, []);

  // ── Select tool / hierarchy handlers ───────────────────────────────────────
  const onVeSelect = useCallback((id: string | null) => {
    voxelRef.current?.select(id);
  }, []);

  const onVeGizmoMode = useCallback((m: GizmoMode) => {
    voxelRef.current?.setGizmoMode(m);
  }, []);

  const onVeSnap = useCallback((on: boolean) => {
    setVeSnap(on);
    voxelRef.current?.setSnap(on);
  }, []);

  const onVeDeleteSelected = useCallback(() => {
    voxelRef.current?.deleteSelected();
  }, []);

  const onVeDuplicateSelected = useCallback(() => {
    voxelRef.current?.duplicateSelected();
  }, []);

  const onVeFocusSelected = useCallback(() => {
    voxelRef.current?.focusSelected();
  }, []);

  const onClearMap = useCallback(() => {
    voxelRef.current?.clearAll();
  }, []);

  // Load a starting-map template into the editor (from the template picker).
  const onPickTemplate = useCallback((template: MapTemplate) => {
    const ed = voxelRef.current;
    if (!ed) return;
    const map = template.build();
    ed.load(map);
    setDungeon(!!map.dungeon);
    setCurrentMapId(null);
    setMapName(template.label);
    setTemplatesOpen(false);
  }, []);

  // ── Multi-map persistence handlers ─────────────────────────────────────────
  const onSaveMap = useCallback(() => {
    const ed = voxelRef.current;
    if (!ed) return;
    const meta = saveMap(mapName, ed.serialize(), currentMapId ?? undefined);
    if (!meta) return;
    setCurrentMapId(meta.id);
    setMapName(meta.name);
    setMaps(listMaps());
  }, [mapName, currentMapId]);

  const onLoadMap = useCallback((id: string) => {
    const ed = voxelRef.current;
    if (!ed) return;
    const map = loadMap(id);
    if (!map) return;
    ed.load(map);
    setDungeon(!!map.dungeon);
    setCurrentMapId(id);
    setMapName(maps.find((m) => m.id === id)?.name ?? "");
  }, [maps]);

  const onDeleteMap = useCallback((id: string) => {
    deleteMap(id);
    setMaps(listMaps());
    setCurrentMapId((cur) => (cur === id ? null : cur));
  }, []);

  const onExportMap = useCallback(() => {
    const ed = voxelRef.current;
    return ed ? exportMap(ed.serialize()) : "";
  }, []);

  const onImportMap = useCallback((json: string) => {
    const ed = voxelRef.current;
    if (!ed) return false;
    const map = importMap(json);
    if (!map) return false;
    ed.load(map);
    setDungeon(!!map.dungeon);
    setCurrentMapId(null);
    return true;
  }, []);

  // Serialize the current map and launch a play session.
  const onTestMap = useCallback(() => {
    const ed = voxelRef.current;
    if (!ed) return;
    const map = ed.serialize();
    if (!map.deployables.some((d) => d.kind === "start")) return;
    playMapRef.current = map;
    setMode("play");
  }, []);

  // Leave the play session and return to the editor with the map intact.
  const onExitPlay = useCallback(() => {
    cameFromPlayRef.current = true;
    setMode("voxel");
  }, []);

  // Load a map chosen in the Lobby into the Voxel Editor.
  const onLoadPost = useCallback((map: VoxelMap) => {
    pendingMapRef.current = map;
    setMode("voxel");
  }, []);

  // Launch a map chosen in the Lobby straight into a play session.
  const onPlayPost = useCallback((map: VoxelMap) => {
    playMapRef.current = map;
    setMode("play");
  }, []);

  // Reopen a scene chosen in the Lobby in the Scene Editor.
  const onLoadScenePost = useCallback((scene: SceneDescriptor) => {
    pendingSceneRef.current = scene;
    setMode("editor");
  }, []);

  // A multiplayer room was joined/created in the Lobby: keep the relay client
  // live, stash the resolved content map, and switch into the Danger Room.
  const onEnterRoom = useCallback((map: VoxelMap | null, preset?: string) => {
    inRoomRef.current = true;
    roomMapRef.current = map;
    // The room dictates the environment for every joiner; fall back to the
    // player's own default when the room carried no (or an unknown) preset.
    const p = asRoomPresetId(preset);
    roomPresetRef.current = p;
    if (p) setRoomPreset(p);
    setMode("danger");
  }, []);

  // Leave the Danger Room; if it was a multiplayer room, leave the relay too.
  const onLeaveDanger = useCallback(() => {
    if (inRoomRef.current) {
      netRef.current?.leave();
      inRoomRef.current = false;
      roomMapRef.current = null;
      roomPresetRef.current = null;
    }
    setMode("doors");
  }, []);

  // Unified system switch for the persistent shell launcher. Leaving a
  // multiplayer Danger Room drops the relay so we don't linger in the room.
  const navigate = useCallback((next: Mode) => {
    setMode((prev) => {
      if (next === prev) return prev;
      if (prev === "danger" && inRoomRef.current && next !== "danger") {
        netRef.current?.leave();
        inRoomRef.current = false;
        roomMapRef.current = null;
        roomPresetRef.current = null;
      }
      return next;
    });
  }, []);

  // Toolbox launcher: run a tool's action — jump to its mode and surface its
  // panel. Danger dock state + HUD editing live here in App, so those apply
  // immediately (the panels render once the Danger Room mounts); Dressing Room
  // panels go through the request bus consumed by EditorMode on mount.
  const runTool = useCallback(
    (tool: ToolDef) => {
      const a = tool.action;
      switch (a.kind) {
        case "mode":
          navigate(a.mode);
          break;
        case "danger-panel":
          if (!dangerDock.isVisible(a.id)) toggleDangerPanel(a.id);
          navigate("danger");
          break;
        case "danger-equip":
          if (modeRef.current === "danger") {
            setEquipOpen(true);
          } else {
            pendingEquipRef.current = true;
            navigate("danger");
          }
          break;
        case "hud-edit":
          setHudEditing(true);
          navigate("danger");
          break;
        case "dressing-panel":
          requestDressingPanel(a.id);
          navigate("editor");
          break;
      }
    },
    [navigate, dangerDock, toggleDangerPanel],
  );

  // Global "leave" hotkey: U backs out of an active session — the Danger Room
  // (dropping the relay if it was a multiplayer room) or a play-test — mirroring
  // the on-screen Leave/Exit button. Bound after those handlers so it can close
  // over them without a temporal-dead-zone hazard. Ignored while typing.
  useEffect(() => {
    if (mode !== "danger" && mode !== "play") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyU" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
      if (mode === "danger") onLeaveDanger();
      else onExitPlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onLeaveDanger, onExitPlay]);

  // Per-surface config for the ONE global AI dock the shell hosts. Danger/play
  // get the Danger Room master (live tools); the calm "guide" companion covers
  // doors/voxel/lobby; the Dressing Room registers its own config via context
  // (it owns the engine), and LED Mask runs its own embedded face chat.
  const shellAssistant: AssistantConfig | null = useMemo(() => {
    if (mode === "danger" || mode === "play") {
      return {
        surface: "danger",
        title: "Danger Room Master",
        tools: dangerAiTools,
        getSystemPrompt: () => dangerSystemPrompt({ characterId, weaponId, difficulty, params }),
        placeholder: "Spawn 3 sword enemies, set difficulty hard…",
      };
    }
    if (
      mode === "doors" ||
      mode === "voxel" ||
      mode === "lobby" ||
      mode === "lobbyWorld" ||
      mode === "characters" ||
      mode === "minegrudge" ||
      mode === "avatar"
    ) {
      return {
        surface: "guide",
        title: "Companion",
        tools: [],
        getSystemPrompt: appGuideSystemPrompt,
        placeholder: "Ask how to use any system…",
      };
    }
    return null;
  }, [mode, dangerAiTools, characterId, weaponId, difficulty, params]);

  // Wrap any mode's content in the persistent shell (title dropdown + toolbox
  // with tools / music / AI tabs). LED Mask keeps its own face chat.
  const shell = (content: React.ReactNode) => (
    <AppShell
      mode={mode}
      onNavigate={navigate}
      assistant={shellAssistant}
      hideAssistant={mode === "ledmask"}
      onTool={runTool}
      toolboxMusic={
        <>
          <div className="toolbox-music-title">{djStationName}</div>
          <DjStationBody
            settings={djStation}
            onChange={onDjChange}
            nowPlaying={djNow}
            titles={djTitles}
            onPrev={onDjPrev}
            onNext={onDjNext}
            onSelect={onDjSelect}
            onReset={onDjReset}
            paused={djPaused}
            muted={djMuted}
            onTogglePlay={onDjTogglePlay}
            onToggleMute={onDjToggleMute}
            onMixNext={onDjMixNext}
            stationId={djStationId}
            onStation={onDjStationSelect}
            stationBusy={djBusy}
            stationName={djStationName}
          />
          <div className="toolbox-music-title">Volume mixer</div>
          <SoundLevels sound={sound} onLevel={onSoundLevel} />
        </>
      }
    >
      {content}
    </AppShell>
  );

  const panelsOpen =
    dangerDock.isVisible("admin") ||
    dangerDock.isVisible("editor") ||
    dangerDock.isVisible("anim") ||
    dangerDock.isVisible("animdbg");

  // Stable touch API bridging the on-screen controls to the live engine.
  const touchApi = useRef({
    touchMoveInput: (x: number, y: number) => studioRef.current?.touchMoveInput(x, y),
    touchLook: (dx: number, dy: number) => studioRef.current?.touchLook(dx, dy),
    touchLookEnd: () => studioRef.current?.touchLookEnd(),
    setTouchSprint: (on: boolean) => studioRef.current?.setTouchSprint(on),
    touchJump: () => studioRef.current?.touchJump(),
    touchAttack: () => studioRef.current?.touchAttack(),
    touchSkill: (i?: number) => studioRef.current?.touchSkill(i),
    touchSkyfall: () => studioRef.current?.touchSkyfall(),
  }).current;

  const onApplyStatus = useCallback((id: StatusId, aoe?: boolean) => {
    studioRef.current?.applyStatus(id, aoe);
  }, []);

  if (mode === "landing") {
    // The front door: Grudge ID sign-in, no shell chrome. Entering leads to
    // the doors hall (the home surface).
    return <LandingPage onEnter={() => setMode("doors")} />;
  }

  if (mode === "doors") {
    // Phones get the poster-strip room gallery as the home surface (the
    // doors hall is built for wide screens); desktop keeps the doors grid.
    return shell(
      withScreenTheme(
        isMobile ? (
          <div className="roomgal-home">
            <RoomGallery onNavigate={navigate} />
          </div>
        ) : (
          <DoorSelect onEnter={navigate} />
        ),
      ),
    );
  }

  if (mode === "editor") {
    const initialScene = pendingSceneRef.current;
    pendingSceneRef.current = null;
    return shell(
      withScreenTheme(
        <EditorMode initialScene={initialScene} onExit={() => setMode("doors")} />,
      ),
    );
  }

  if (mode === "ledmask") {
    return shell(<LedMaskMode onExit={() => setMode("doors")} />);
  }

  if (mode === "avatar") {
    return shell(<AvatarEditMode onExit={() => setMode("doors")} />);
  }

  if (mode === "lobbyWorld") {
    return shell(
      withScreenTheme(
        <LobbyWorldMode
          onExit={() => setMode("lobby")}
          net={getNet()}
          enablePvp
        />,
      ),
    );
  }

  if (mode === "characters") {
    return shell(
      withScreenTheme(
        <CharactersGrudoxMode
          onExit={() => setMode("doors")}
          onNavigate={(m) => setMode(m)}
        />,
      ),
    );
  }

  if (mode === "minegrudge") {
    return shell(
      withScreenTheme(
        <MineGrudgeEditorMode
          onExit={() => setMode("characters")}
          surface="lobby"
          preferLive
        />,
      ),
    );
  }

  if (mode === "lobby") {
    return shell(
      withScreenTheme(
      <Lobby
        onLoad={onLoadPost}
        onPlay={onPlayPost}
        onLoadScene={onLoadScenePost}
        onExit={() => setMode("doors")}
        onEnterWorld={() => setMode("lobbyWorld")}
        net={getNet()}
        onEnterRoom={onEnterRoom}
      />,
      ),
    );
  }

  const dangerPanels: DockPanelDef[] = [
    {
      id: "admin",
      title: "Admin",
      icon: <ShieldHalf size={13} />,
      home: "left",
      render: () => (
        <div className="dock-pad">
          <AdminPanel
            chrome={false}
            open
            characterId={characterId}
            weaponId={weaponId}
            difficulty={difficulty}
            onCharacter={onCharacter}
            onWeapon={onWeapon}
            onDifficulty={onDifficulty}
            onSpawn={onSpawn}
            onSpawnBoss={onSpawnBoss}
            onClearNpcs={onClearNpcs}
            duel={hud?.duel ?? null}
            onStartDuel={onStartDuel}
            onStopDuel={onStopDuel}
            roomPreset={roomPreset}
            backdropId={backdropId}
            onBackdrop={onBackdrop}
            ale={hud?.ale ?? null}
            onDuelCamera={onDuelCamera}
            onToggleDiagnostics={onToggleDiagnostics}
            onStartReplay={onStartReplay}
            onReplayPause={onReplayPause}
            onReplaySpeed={onReplaySpeed}
            onReplaySeek={onReplaySeek}
            onReplayCamera={onReplayCamera}
            onStopReplay={onStopReplay}
            onSetReplayFrequency={onSetReplayFrequency}
            onClose={() => dangerDock.hidePanel("admin")}
          />
        </div>
      ),
    },
    {
      id: "editor",
      title: "Settings",
      icon: <SlidersHorizontal size={13} />,
      home: "right",
      render: () => (
        <div className="dock-pad">
          <EditorPanel
            chrome={false}
            open
            params={params}
            onChange={onParam}
            timeScale={timeScale}
            onTimeScale={onTimeScale}
            fireFx={fireFx}
            onFireFx={onFireFx}
            onImpactTest={onImpactTest}
            onClose={() => dangerDock.hidePanel("editor")}
          />
        </div>
      ),
    },
    {
      id: "anim",
      title: "Clips",
      icon: <Film size={13} />,
      home: "right",
      render: () => (
        <div className="dock-pad">
          <AnimationsPanel
            chrome={false}
            open
            clips={clips}
            slots={slots}
            currentClip={hud?.clip ?? ""}
            onPreview={onPreview}
            onAssign={onAssign}
            onClose={() => dangerDock.hidePanel("anim")}
          />
        </div>
      ),
    },
    {
      id: "animdbg",
      title: "Anim Debug",
      icon: <Activity size={13} />,
      home: "left",
      render: () => (
        <div className="dock-pad">
          <AnimationDebugger onClose={() => dangerDock.hidePanel("animdbg")} />
        </div>
      ),
    },
  ];

  const dangerMenus: ToolMenu[] = [
    {
      label: "Environment",
      entries: [
        { kind: "label", label: "Training environment" },
        ...ROOM_PRESET_LIST.map((preset) => ({
          kind: "check" as const,
          label: preset.name,
          subtitle: preset.blurb,
          thumbnail: <EnvThumb preset={preset} />,
          checked: roomPreset === preset.id,
          onSelect: () => onRoomPreset(preset.id),
        })),
        { kind: "sep" as const },
        { kind: "label" as const, label: "Extras" },
        {
          kind: "check" as const,
          label: "DJ light show",
          subtitle: "Animated shader backdrop behind Racalvin",
          checked: djShow,
          onSelect: onToggleDjShow,
        },
      ],
    },
    {
      label: "Panels",
      entries: [
        { kind: "label", label: "Toggle panels" },
        {
          kind: "check",
          label: "Admin",
          icon: <ShieldHalf size={13} />,
          checked: dangerDock.isVisible("admin"),
          onSelect: () => toggleDangerPanel("admin"),
        },
        {
          kind: "check",
          label: "Settings",
          icon: <SlidersHorizontal size={13} />,
          checked: dangerDock.isVisible("editor"),
          onSelect: () => toggleDangerPanel("editor"),
        },
        {
          kind: "check",
          label: "Clips",
          icon: <Film size={13} />,
          checked: dangerDock.isVisible("anim"),
          onSelect: () => toggleDangerPanel("anim"),
        },
        {
          kind: "check",
          label: "Anim Debug",
          icon: <Activity size={13} />,
          checked: dangerDock.isVisible("animdbg"),
          onSelect: () => toggleDangerPanel("animdbg"),
        },
        { kind: "sep" },
        {
          kind: "check",
          label: "Edit HUD",
          icon: <LayoutDashboard size={13} />,
          checked: hudEditing,
          onSelect: () => setHudEditing((v) => !v),
        },
        { kind: "item", label: "Reset layout", icon: <RotateCcw size={13} />, onSelect: () => dangerDock.resetLayout() },
      ],
    },
  ];

  return shell(
    <div
      className={`studio ${isMobile ? "touch" : ""}${
        hudEditor.config.theme !== "default" ? " hud-themed" : ""
      }${hudEditor.config.layout === "tight" ? " hud-tight" : ""}`}
      style={themeVars}
    >
      <div
        className={`canvas-mount${
          (mode === "danger" || mode === "play") && !panelsOpen && !equipOpen ? " immersive" : ""
        }`}
        ref={mountRef}
      />

      {webglError && (
        <div className="webgl-error">
          <h2>WebGL unavailable</h2>
          <p>This device or browser couldn't create a 3D context. Try a hardware-accelerated browser.</p>
        </div>
      )}

      {(mode === "play" || mode === "danger") && loading && !loading.ready && (
        <LoadingScreen
          snapshot={loading}
          onRetry={recovery.onRetry}
          onBack={recovery.onBack}
        />
      )}

      {mode === "voxel" && (
        <>
          <VoxelEditorUI
            brush={brush}
            stats={veStats}
            dungeon={dungeon}
            mapsOpen={mapsOpen}
            onBrush={onBrush}
            onDungeon={onDungeon}
            onToggleMaps={() => setMapsOpen((v) => !v)}
            onNew={() => {
              setMapsOpen(false);
              setTemplatesOpen(true);
            }}
            onClear={onClearMap}
            onTest={onTestMap}
            onExit={() => setMode("doors")}
            getMapPayload={getMapPayload}
            tree={veTree}
            selectedId={veSel}
            gizmoMode={veGizmo}
            snap={veSnap}
            onSelect={onVeSelect}
            onGizmoMode={onVeGizmoMode}
            onSnap={onVeSnap}
            onDeleteSelected={onVeDeleteSelected}
            onDuplicateSelected={onVeDuplicateSelected}
            onFocusSelected={onVeFocusSelected}
          />
          {templatesOpen && (
            <VoxelTemplatePicker
              onPick={onPickTemplate}
              onBlank={() => {
                voxelRef.current?.clearAll();
                setDungeon(false);
                voxelRef.current?.setDungeon(false);
                setCurrentMapId(null);
                setMapName("");
                setTemplatesOpen(false);
              }}
              onClose={() => setTemplatesOpen(false)}
            />
          )}
          {mapsOpen && (
            <VoxelMapsPanel
              maps={maps}
              currentId={currentMapId}
              name={mapName}
              onName={setMapName}
              onSave={onSaveMap}
              onLoad={onLoadMap}
              onDelete={onDeleteMap}
              onExport={onExportMap}
              onImport={onImportMap}
              onClose={() => setMapsOpen(false)}
            />
          )}
        </>
      )}

      {mode === "play" && (
        <>
          <Crosshair
            visible={!equipOpen}
            mode={hud?.locked ? "combat" : panelsOpen ? "ui" : "combat"}
            firstPerson={hud?.firstPerson ?? false}
            spread={hud?.aimSpread ?? 0}
            hitMarker={hud?.hitMarker ?? 0}
            rangeState={hud?.owrRange ?? "none"}
            editBind={hudEdit.bind("reticle")}
          />
          <Hud hud={hud} edit={hudEdit} />
          {hud?.mech && <MechHud hud={hud} edit={hudEdit} />}
          <StatusBar statuses={hud?.statuses ?? []} editBind={hudEdit.bind("status")} />

          <div className="topbar">
            <span className="brand">
              TEST<span className="brand-accent">PLAY</span>
            </span>
            <div className="topbar-actions">
              <DjStationPanel
                settings={djStation}
                onChange={onDjChange}
                nowPlaying={djNow}
                titles={djTitles}
                onPrev={onDjPrev}
                onNext={onDjNext}
                onSelect={onDjSelect}
                onReset={onDjReset}
                paused={djPaused}
                muted={djMuted}
                onTogglePlay={onDjTogglePlay}
                onToggleMute={onDjToggleMute}
                onMixNext={onDjMixNext}
                stationId={djStationId}
                onStation={onDjStationSelect}
                stationBusy={djBusy}
                stationName={djStationName}
                variant="topbar"
              />
              <SoundMixer sound={sound} onToggleMute={onToggleMute} onLevel={onSoundLevel} variant="topbar" />
              <button
                className={`tab eq-open-btn ${equipOpen ? "live" : ""}`}
                onClick={openEquip}
                title="Loadout (I)"
              >
                <Swords size={13} /> Loadout
              </button>
              <button className="tab" onClick={onExitPlay} title="Leave to editor (U)">
                ⬑ Editor
              </button>
            </div>
          </div>

          {!isMobile && !hud?.locked && !equipOpen && (
            <div className="click-hint">
              <p>Click to enter — mouse to look</p>
              <p className="dim">
                WASD move · Shift sprint · Space jump (×2) · LMB attack · Ctrl block · Ctrl+Space air block · RMB lock toggle · Tab soft-lock · Alt+Tab free cam · U leave · Esc to release
              </p>
            </div>
          )}

          {isMobile && <TouchControls api={touchApi} />}

          {equipOpen && (
            <EquipmentScreen
              characterName={hud?.character ?? characterId}
              currentWeapon={hud?.weapon ?? weaponId}
              currentOffHand={offHand}
              armorLoadout={armorLoadout}
              onEquip={onWeapon}
              onEquipOff={onOffHand}
              onArmorLoadout={onArmorLoadout}
              onClose={() => setEquipOpen(false)}
            />
          )}
        </>
      )}

      {mode === "danger" && (
        <>
          <Crosshair
            visible={!equipOpen}
            mode={hud?.locked ? "combat" : panelsOpen ? "ui" : "combat"}
            firstPerson={hud?.firstPerson ?? false}
            spread={hud?.aimSpread ?? 0}
            hitMarker={hud?.hitMarker ?? 0}
            rangeState={hud?.owrRange ?? "none"}
            editBind={hudEdit.bind("reticle")}
          />
          <Hud hud={hud} edit={hudEdit} />
          {hud?.mech && <MechHud hud={hud} edit={hudEdit} />}
          <StatusBar statuses={hud?.statuses ?? []} editBind={hudEdit.bind("status")} />

          {hudEditing && <HudEditor controls={hudEditor} onClose={() => setHudEditing(false)} />}

          <TipProvider>
            <div className="ed-menubar-wrap">
              <ToolMenubar
                brand={
                  <span className="brand">
                    DANGER<span className="brand-accent">ROOM</span>
                  </span>
                }
                menus={dangerMenus}
                right={
                  <>
                    <DjStationPanel
                      settings={djStation}
                      onChange={onDjChange}
                      nowPlaying={djNow}
                      titles={djTitles}
                      onPrev={onDjPrev}
                      onNext={onDjNext}
                      onSelect={onDjSelect}
                      onReset={onDjReset}
                      paused={djPaused}
                      muted={djMuted}
                      onTogglePlay={onDjTogglePlay}
                      onToggleMute={onDjToggleMute}
                      onMixNext={onDjMixNext}
                      stationId={djStationId}
                      onStation={onDjStationSelect}
                      stationBusy={djBusy}
                      stationName={djStationName}
                    />
                    <SoundMixer sound={sound} onToggleMute={onToggleMute} onLevel={onSoundLevel} />
                    <Tip label="Loadout (I)">
                      <button
                        className={`tm-btn eq-open-btn ${equipOpen ? "live" : ""}`}
                        onClick={openEquip}
                      >
                        <Swords size={14} />
                        <span>Loadout</span>
                      </button>
                    </Tip>
                    <Tip label="Leave to door select (U)">
                      <button className="tm-btn" onClick={onLeaveDanger}>
                        <DoorOpen size={14} />
                        <span>Doors</span>
                      </button>
                    </Tip>
                  </>
                }
              />
            </div>
            <DockSurface layout={dangerLayout} controls={dangerDock} panels={dangerPanels} />
          </TipProvider>

          {!isMobile && !hud?.locked && !panelsOpen && !equipOpen && (
            <div className="click-hint">
              <p>Click to enter — mouse to look</p>
              <p className="dim">
                WASD move · Shift sprint · Space jump (×2) · LMB attack · Q parry · Ctrl block · Ctrl+Space air block · X dodge · R heavy · Z / T combo · V kick · G evade · F / 1-4 skills · RMB lock toggle · Tab soft-lock · Alt+Tab free cam · ` admin · E editor · C clips
              </p>
            </div>
          )}

          {isMobile && !panelsOpen && <TouchControls api={touchApi} />}

          {!panelsOpen && (
            <>
              <button className={`fx-toggle ${dockOpen ? "on" : ""}`} onClick={() => setDockOpen((v) => !v)}>
                FX
              </button>
              {dockOpen && <StatusDock onApply={onApplyStatus} />}
            </>
          )}

          {equipOpen && (
            <EquipmentScreen
              characterName={hud?.character ?? characterId}
              currentWeapon={hud?.weapon ?? weaponId}
              currentOffHand={offHand}
              armorLoadout={armorLoadout}
              onEquip={onWeapon}
              onEquipOff={onOffHand}
              onArmorLoadout={onArmorLoadout}
              onClose={() => setEquipOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
