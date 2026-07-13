import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@clerk/clerk-react";
import type { CreatePostPayload } from "@workspace/api-client-react";
import {
  Move,
  RotateCw,
  Maximize,
  Magnet,
  Grid3x3,
  Fish,
  Sparkles,
  Copy,
  Crosshair,
  Trash2,
  Upload,
  Download,
  FileJson,
  Repeat,
  LogOut,
  Film,
  RotateCcw,
  Gamepad2,
  Shirt,
  Sword,
  MousePointer2,
  Undo2,
  Redo2,
  BoxSelect,
  CopyPlus,
  ListTree,
  Play,
  Pencil,
} from "lucide-react";
import { EditorScene } from "../../three/editor/EditorScene";
import { Crosshair as CrosshairHud } from "../Crosshair";
import { PlayHud } from "./PlayHud";
import { useRegisterAssistant } from "../../ai/AssistantSurface";
import { buildEditorTools, editorSystemPrompt } from "../../ai/editorTools";
import { requestPattern } from "../../ai/imageClient";
import { PostToGallery } from "../PostToGallery";
import type { EditorSnapshot, GizmoMode, SceneDescriptor } from "../../three/editor/types";
import { EditorContextMenu } from "./EditorContextMenu";
import { VfxPanel } from "./VfxPanel";
import { AnimLibraryPanel } from "./AnimLibraryPanel";
import { PlaygroundPanel } from "./PlaygroundPanel";
import { WardrobePanel } from "./WardrobePanel";
import { WeaponLibraryPanel } from "./WeaponLibraryPanel";
import { HierarchyPanel } from "./HierarchyPanel";
import { onDressingPanelRequest } from "../toolbox/tools";
import { DockSurface, ToolMenubar, Tip, TipProvider, useDockLayout } from "../dock";
import type { DockPanelDef, DockPanelMeta, ToolMenu } from "../dock";
import "./editor.css";
import "../dock/dock.css";

interface Props {
  onExit: () => void;
  /** A scene queued from the gallery to reopen as soon as the engine mounts. */
  initialScene?: SceneDescriptor | null;
}

const GIZMOS: { mode: GizmoMode; label: string; key: string; icon: ReactNode }[] = [
  { mode: "translate", label: "Move", key: "W", icon: <Move size={14} /> },
  { mode: "rotate", label: "Rotate", key: "E", icon: <RotateCw size={14} /> },
  { mode: "scale", label: "Scale", key: "R", icon: <Maximize size={14} /> },
];

// Stable dock metadata (homes + default visibility). Keep separate from the
// render closures so the layout hook can reconcile a persisted layout. The
// Dressing Room keeps only the character-centric panels; Wardrobe + Animations
// open by default so a freshly-loaded rig is immediately dressable.
const PANEL_METAS: DockPanelMeta[] = [
  { id: "hierarchy", home: "left" },
  { id: "wardrobe", home: "right" },
  { id: "anim", home: "right" },
  { id: "arsenal", home: "right" },
  { id: "vfx", home: "right", defaultVisible: false },
  { id: "playground", home: "right", defaultVisible: false },
];

const PANEL_TITLES: Record<string, string> = {
  hierarchy: "Hierarchy",
  wardrobe: "Wardrobe",
  vfx: "VFX",
  anim: "Animations",
  arsenal: "Arsenal",
  playground: "Playground",
};

/** Trigger a browser download for an exported blob/string. */
function download(data: ArrayBuffer | string, filename: string, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Top-level Scene Editor overlay. Owns the `EditorScene` engine (mounted onto a
 * full-bleed container) and renders the menubar + dockable panels. The engine
 * pushes snapshots into React state; the panels call imperative setters back.
 */
export function EditorMode({ onExit, initialScene }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<EditorScene | null>(null);
  const [snap, setSnap] = useState<EditorSnapshot | null>(null);
  // Mirror the engine's transient notice into local state so it auto-dismisses
  // (the snapshot keeps carrying the last notice; we surface each new id once).
  const [toast, setToast] = useState<EditorSnapshot["notice"]>(null);

  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  // Authed image generation: ask the backend for a pattern image (data URL) the
  // engine can load as a texture. Stable identity so memoised tools don't churn.
  const generatePattern = useCallback(
    (prompt: string) => requestPattern(prompt, () => getTokenRef.current()),
    [],
  );

  const { layout, controls } = useDockLayout("animator.dressing-room.dock.v1", PANEL_METAS);

  // Toolbox launches targeting a Dressing Room panel: surface it. A request
  // fired before this mode mounted is buffered by the bus and delivered on
  // subscribe; live requests (already in this mode) arrive immediately.
  useEffect(
    () => onDressingPanelRequest((id) => controls.showPanel(id)),
    [controls],
  );

  useEffect(() => {
    if (!mountRef.current) return;
    const engine = new EditorScene(mountRef.current, setSnap);
    engineRef.current = engine;
    // Reopening a saved scene takes precedence; otherwise drop a default rig in
    // so the Dressing Room opens with a character already on the stand.
    if (initialScene) engine.importJSON(initialScene);
    else void engine.loadRig();
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // initialScene is consumed once on mount; the gallery hands a fresh editor each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Surface each new engine notice once (keyed by its monotonic id), then let it
  // auto-dismiss after a few seconds.
  useEffect(() => {
    const notice = snap?.notice;
    if (!notice) return;
    setToast(notice);
    const t = window.setTimeout(() => {
      setToast((cur) => (cur && cur.id === notice.id ? null : cur));
    }, 4200);
    return () => window.clearTimeout(t);
  }, [snap?.notice?.id]);

  // Gizmo-mode + editing hotkeys, ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const eng = engineRef.current;
      if (!eng) return;
      // Ctrl/Cmd shortcuts: undo / redo / select-all / duplicate.
      if (e.ctrlKey || e.metaKey) {
        if (e.code === "KeyZ" && e.shiftKey) {
          e.preventDefault();
          eng.redo();
        } else if (e.code === "KeyZ") {
          e.preventDefault();
          eng.undo();
        } else if (e.code === "KeyY") {
          e.preventDefault();
          eng.redo();
        } else if (e.code === "KeyA") {
          e.preventDefault();
          eng.selectAll();
        } else if (e.code === "KeyD") {
          e.preventDefault();
          eng.duplicateSelected();
        }
        return;
      }
      if (e.code === "KeyW") eng.setGizmoMode("translate");
      else if (e.code === "KeyE") eng.setGizmoMode("rotate");
      else if (e.code === "KeyR") eng.setGizmoMode("scale");
      else if (e.code === "Delete" || e.code === "Backspace") eng.deleteSelected();
      else if (e.code === "KeyF") eng.focusSelected();
      else if (e.code === "KeyH") eng.toggleSelectedVisibility();
      else if (e.code === "Escape") {
        eng.setBuildKind(null);
        eng.closeContextMenu();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const importRef = useRef<HTMLInputElement>(null);
  const convertRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-importing the same file
    const eng = engineRef.current;
    if (!eng) return;
    for (const file of files) await eng.importFile(file);
  };

  const hasFiles = (e: React.DragEvent) => e.dataTransfer?.types?.includes("Files");

  const onDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (hasFiles(e)) e.preventDefault();
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };
  const onDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const eng = engineRef.current;
    if (!eng) return;
    for (const file of Array.from(e.dataTransfer.files)) await eng.importFile(file);
  };

  const onConvert = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const eng = engineRef.current;
    if (!eng) return;
    const buf = await file.arrayBuffer();
    const glb = await eng.convertFbxToGlb(buf);
    download(glb, `${file.name.replace(/\.[^.]+$/, "")}.glb`, "model/gltf-binary");
  };

  const exportGLB = async (selectionOnly: boolean) => {
    const eng = engineRef.current;
    if (!eng) return;
    const glb = await eng.exportGLB(selectionOnly);
    download(glb, selectionOnly ? "selection.glb" : "scene.glb", "model/gltf-binary");
  };

  const exportJSON = () => {
    const eng = engineRef.current;
    if (!eng) return;
    download(eng.exportJSON(), "scene.json", "application/json");
  };

  const getScenePayload = (): CreatePostPayload | null => {
    const eng = engineRef.current;
    if (!eng) return null;
    try {
      return JSON.parse(eng.exportJSON()) as CreatePostPayload;
    } catch {
      return null;
    }
  };

  const eng = engineRef.current;
  const hasSel = !!snap?.selectedId;
  const busy = !!snap?.busy;

  // Whitelisted AI tool surface — bound once to the live engine accessor.
  const aiTools = useMemo(
    () => buildEditorTools(() => engineRef.current, generatePattern),
    [generatePattern],
  );

  // Register this surface's assistant with the global app-shell dock. The shell
  // owns the single AI dock; the Dressing Room contributes its engine-bound
  // tools + prompt while mounted (and clears them on exit).
  useRegisterAssistant(
    {
      surface: "editor",
      title: "AI Animation Creator",
      tools: aiTools,
      getSystemPrompt: () => editorSystemPrompt(snap),
      placeholder: "Describe a clip: “sword parry into counter”, “bow dodge-shot”, “staff frost cast”…",
    },
    [aiTools, snap],
  );

  // Dock panel render closures — recreated each render so they capture fresh
  // engine + snapshot; metadata stays stable (PANEL_METAS) for the layout hook.
  const panels = useMemo<DockPanelDef[]>(() => {
    if (!eng || !snap) return [];
    return [
      { id: "hierarchy", title: "Hierarchy", home: "left", icon: <ListTree size={13} />, render: () => <HierarchyPanel engine={eng} snap={snap} /> },
      { id: "wardrobe", title: "Wardrobe", home: "right", icon: <Shirt size={13} />, render: () => <WardrobePanel engine={eng} snap={snap} generatePattern={generatePattern} /> },
      { id: "anim", title: "Animations", home: "right", icon: <Film size={13} />, render: () => <AnimLibraryPanel engine={eng} snap={snap} /> },
      { id: "arsenal", title: "Arsenal", home: "right", icon: <Sword size={13} />, render: () => <WeaponLibraryPanel engine={eng} snap={snap} /> },
      { id: "vfx", title: "VFX", home: "right", icon: <Sparkles size={13} />, render: () => <VfxPanel engine={eng} snap={snap} /> },
      { id: "playground", title: "Playground", home: "right", icon: <Gamepad2 size={13} />, render: () => <PlaygroundPanel engine={eng} snap={snap} /> },
    ];
  }, [eng, snap]);

  // Top-toolbar panel tabs. Clicking opens the panel in its home dock zone (and
  // activates it); clicking the already-active tab hides it again; clicking a
  // visible-but-inactive tab just brings it forward. Panels still live on the
  // right (their dock home) — the top bar just controls them.
  const onPanelTab = (id: string) => {
    if (!controls.isVisible(id)) {
      controls.showPanel(id);
      return;
    }
    // Visible + already the front tab of its stack → hide; otherwise bring forward.
    if (controls.isActive(id)) controls.hidePanel(id);
    else controls.setActive(id);
  };
  const panelIcon = (id: string) => panels.find((p) => p.id === id)?.icon ?? null;

  const menus = useMemo<ToolMenu[]>(() => {
    if (!eng) return [];
    return [
      {
        label: "Edit",
        entries: [
          { kind: "item" as const, label: "Undo", icon: <Undo2 size={14} />, shortcut: "Ctrl Z", disabled: !snap?.canUndo, onSelect: () => eng.undo() },
          { kind: "item" as const, label: "Redo", icon: <Redo2 size={14} />, shortcut: "Ctrl Y", disabled: !snap?.canRedo, onSelect: () => eng.redo() },
          { kind: "sep" as const },
          { kind: "item" as const, label: "Select all", icon: <BoxSelect size={14} />, shortcut: "Ctrl A", onSelect: () => eng.selectAll() },
          { kind: "item" as const, label: "Deselect", disabled: !hasSel, onSelect: () => eng.deselectAll() },
          { kind: "sep" as const },
          { kind: "item" as const, label: "Duplicate", icon: <CopyPlus size={14} />, shortcut: "Ctrl D", disabled: !hasSel, onSelect: () => eng.duplicateSelected() },
          { kind: "item" as const, label: "Delete", icon: <Trash2 size={14} />, shortcut: "Del", danger: true, disabled: !hasSel, onSelect: () => eng.deleteSelected() },
        ],
      },
      {
        label: "Pose",
        entries: [
          ...GIZMOS.map((g) => ({
            kind: "item" as const,
            label: g.label,
            icon: g.icon,
            shortcut: g.key,
            onSelect: () => eng.setGizmoMode(g.mode),
          })),
          { kind: "sep" as const },
          {
            kind: "check" as const,
            label: "Grid snapping",
            icon: <Magnet size={14} />,
            checked: !!snap?.snap,
            onSelect: (v: boolean) => eng.setSnap(v),
          },
          { kind: "sep" as const },
          { kind: "item" as const, label: "Focus", icon: <Crosshair size={14} />, shortcut: "F", disabled: !hasSel, onSelect: () => eng.focusSelected() },
          { kind: "item" as const, label: "Duplicate", icon: <Copy size={14} />, disabled: !hasSel, onSelect: () => eng.duplicateSelected() },
          { kind: "item" as const, label: "Delete", icon: <Trash2 size={14} />, shortcut: "Del", danger: true, disabled: !hasSel, onSelect: () => eng.deleteSelected() },
        ],
      },
      {
        label: "View",
        entries: [
          { kind: "check" as const, label: "Grid", icon: <Grid3x3 size={14} />, checked: !!snap?.showGrid, onSelect: (v: boolean) => eng.toggleGrid(v) },
          { kind: "check" as const, label: "Fish-eye", icon: <Fish size={14} />, checked: !!snap?.fishEye, onSelect: (v: boolean) => eng.setFishEye(v) },
          { kind: "check" as const, label: "Bloom", icon: <Sparkles size={14} />, checked: !!snap?.bloom, onSelect: (v: boolean) => eng.setBloom(v) },
        ],
      },
      {
        label: "File",
        entries: [
          { kind: "label" as const, label: "GLB · GLTF · FBX · OBJ · ZIP · BBMODEL" },
          { kind: "item" as const, label: "Import asset…", icon: <Upload size={14} />, disabled: busy, onSelect: () => importRef.current?.click() },
          { kind: "sep" as const },
          { kind: "item" as const, label: "Export scene (GLB)", icon: <Download size={14} />, disabled: busy, onSelect: () => exportGLB(false) },
          { kind: "item" as const, label: "Export selection (GLB)", icon: <Download size={14} />, disabled: busy || !hasSel, onSelect: () => exportGLB(true) },
          { kind: "item" as const, label: "Export scene (JSON)", icon: <FileJson size={14} />, disabled: busy, onSelect: exportJSON },
          { kind: "sep" as const },
          { kind: "item" as const, label: "Convert FBX → GLB…", icon: <Repeat size={14} />, disabled: busy, onSelect: () => convertRef.current?.click() },
        ],
      },
      {
        label: "Panels",
        entries: [
          ...PANEL_METAS.map((m) => ({
            kind: "check" as const,
            label: PANEL_TITLES[m.id] ?? m.id,
            checked: controls.isVisible(m.id),
            onSelect: () => controls.togglePanel(m.id),
          })),
          { kind: "sep" as const },
          { kind: "item" as const, label: "Reset layout", icon: <RotateCcw size={14} />, onSelect: () => controls.resetLayout() },
        ],
      },
    ];
  }, [eng, snap, hasSel, busy, controls, layout]);

  return (
    <div
      className="dock-root"
      style={{ position: "absolute", inset: 0 }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />

      {/* Play-mode reticle: shown while a character is being driven; B toggles FP. */}
      <CrosshairHud visible={!!snap?.playing} firstPerson={!!snap?.firstPerson} />

      {/* Play-mode game HUD: vitals + the driven character's weapon-skill bar. */}
      <PlayHud hud={snap?.playing ? snap.playHud : null} />


      <TipProvider>
        <div className="ed-root">
          <div className="ed-menubar-wrap">
            <ToolMenubar
              brand={
                <>
                  DRESSING<b>ROOM</b>
                </>
              }
              menus={menus}
              right={
                <>
                  {eng && (
                    <Tip label={snap?.playing ? "Back to Edit mode" : "Play mode — drive the character (WASD, mouse-look)"}>
                      <button
                        className={`ed-btn mode-toggle ${snap?.playing ? "playing" : ""}`}
                        onClick={() => (snap?.playing ? eng.stopPlay() : eng.startPlay())}
                      >
                        {snap?.playing ? <Pencil size={14} /> : <Play size={14} />}
                        {snap?.playing ? "Edit" : "Play"}
                      </button>
                    </Tip>
                  )}
                  <PostToGallery kind="scene" getPayload={getScenePayload} defaultName="My Character" label="⭱ Post" className="ed-btn" />
                  <Tip label="Exit the Dressing Room">
                    <button className="ed-btn icon" onClick={onExit}>
                      <LogOut size={15} />
                    </button>
                  </Tip>
                </>
              }
            />
          </div>

          {eng && snap && (
            <div className="ed-toolrail">
              <span className="ed-rail-label">Tool</span>
              <button
                className="ed-tool"
                title="Select / orbit — click an object to select it"
                onClick={() => eng.setBuildKind(null)}
              >
                <MousePointer2 size={14} />
              </button>
              {GIZMOS.map((g) => (
                <button
                  key={g.mode}
                  className={`ed-tool ${snap.gizmo === g.mode && !snap.buildKind ? "on" : ""}`}
                  title={`${g.label} (${g.key})`}
                  onClick={() => {
                    eng.setBuildKind(null);
                    eng.setGizmoMode(g.mode);
                  }}
                >
                  {g.icon}
                  <span className="k">{g.key}</span>
                </button>
              ))}
              <button
                className={`ed-tool accent ${snap.snap ? "on" : ""}`}
                title="Toggle grid snapping"
                onClick={() => eng.setSnap(!snap.snap)}
              >
                <Magnet size={14} />
              </button>

              <div className="ed-sep" />
              <button
                className="ed-tool"
                title="Import a character, weapon or prop (GLB/GLTF/FBX/OBJ/ZIP/BBMODEL)"
                disabled={busy}
                onClick={() => importRef.current?.click()}
              >
                <Upload size={14} />
                Import
              </button>

              <div className="ed-sep" />
              <span className="ed-rail-label">Panels</span>
              {PANEL_METAS.map((m) => (
                <button
                  key={m.id}
                  className={`ed-tool ${controls.isVisible(m.id) ? "on" : ""}`}
                  title={`${PANEL_TITLES[m.id] ?? m.id} panel`}
                  onClick={() => onPanelTab(m.id)}
                >
                  {panelIcon(m.id)}
                  {PANEL_TITLES[m.id] ?? m.id}
                </button>
              ))}
            </div>
          )}

          {eng && snap && <DockSurface layout={layout} controls={controls} panels={panels} menuHeight={96} />}

          <div className="ed-hint">
            Browse every mesh in Hierarchy · load a rig in Animations · dress it in Wardrobe · drag-import weapons &amp;
            props · click select · W/E/R move-rotate-scale · F focus · H hide · Del remove
          </div>

          {eng && snap?.contextMenu && <EditorContextMenu engine={eng} snap={snap} />}

          {toast && (
            <div className={`ed-toast ${toast.kind}`} role="status" onClick={() => setToast(null)}>
              {toast.text}
            </div>
          )}

          {dragging && (
            <div className="ed-drop">
              <div className="ed-drop-inner">
                <Upload size={34} />
                <div className="big">Drop to import</div>
                <div className="sub">GLB · GLTF · FBX · OBJ · ZIP · BBMODEL</div>
              </div>
            </div>
          )}

          <input
            ref={importRef}
            type="file"
            accept=".glb,.gltf,.fbx,.obj,.zip,.bbmodel,.bb"
            multiple
            style={{ display: "none" }}
            onChange={onImport}
          />
          <input ref={convertRef} type="file" accept=".fbx" style={{ display: "none" }} onChange={onConvert} />
        </div>
      </TipProvider>
    </div>
  );
}
