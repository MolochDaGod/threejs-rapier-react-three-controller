/**
 * Toolbox registry: the 25 gold tool icons (sliced from the framed RPG sheet
 * into public/icons/, sheet order) mapped to LIVE launch actions across the
 * app. Every button does something real — a mode switch, a Danger Room dock
 * panel, the HUD editor, the loadout overlay, or a Dressing Room panel.
 */
import type { IconName } from "../../three/icons";

/** Mirrors App's `Mode` union (kept local to avoid a component import cycle). */
export type ToolMode =
  | "doors"
  | "danger"
  | "voxel"
  | "play"
  | "editor"
  | "lobby"
  | "ledmask"
  | "avatar";

/** Danger Room dock panel ids (App's DANGER_PANEL_METAS). */
export type DangerPanelId = "admin" | "editor" | "anim" | "animdbg";

/** Dressing Room dock panel ids (EditorMode's PANEL_METAS). */
export type DressingPanelId =
  | "hierarchy"
  | "wardrobe"
  | "anim"
  | "arsenal"
  | "vfx"
  | "playground";

export type ToolAction =
  | { kind: "mode"; mode: ToolMode }
  | { kind: "danger-panel"; id: DangerPanelId }
  | { kind: "danger-equip" }
  | { kind: "hud-edit" }
  | { kind: "dressing-panel"; id: DressingPanelId };

export interface ToolDef {
  icon: IconName;
  label: string;
  hint: string;
  action: ToolAction;
}

/** All 25 tools in sprite-sheet (row-major) order. */
export const TOOLBOX_TOOLS: ToolDef[] = [
  { icon: "animator", label: "Animator", hint: "Clip overrides & animation tuning", action: { kind: "danger-panel", id: "anim" } },
  { icon: "skill-vfx-lab", label: "Skill VFX Lab", hint: "Preview & tune skill effects", action: { kind: "dressing-panel", id: "vfx" } },
  { icon: "parkour", label: "Parkour", hint: "Movement sandbox — run, dash, vault", action: { kind: "mode", mode: "danger" } },
  { icon: "physics", label: "Physics", hint: "Physics & fire FX tuning", action: { kind: "danger-panel", id: "editor" } },
  { icon: "foot-planting", label: "Foot Planting", hint: "Grounding & studio feel settings", action: { kind: "danger-panel", id: "admin" } },
  { icon: "anim-test", label: "Anim Test", hint: "Live animation debugger", action: { kind: "danger-panel", id: "animdbg" } },
  { icon: "gear-trial", label: "Gear Trial", hint: "Wardrobe — swap skins & gear", action: { kind: "dressing-panel", id: "wardrobe" } },
  { icon: "camera", label: "Camera", hint: "Camera & controller feel", action: { kind: "danger-panel", id: "admin" } },
  { icon: "ai-worker", label: "AI Worker", hint: "LED Mask AI companion", action: { kind: "mode", mode: "ledmask" } },
  { icon: "movement-pad", label: "Movement Pad", hint: "Touch-friendly combat sandbox", action: { kind: "mode", mode: "danger" } },
  { icon: "action-bar", label: "Action Bar", hint: "Arrange your HUD action bar", action: { kind: "hud-edit" } },
  { icon: "hud-settings", label: "HUD Settings", hint: "Edit HUD layout & theme", action: { kind: "hud-edit" } },
  { icon: "building-kit", label: "Building Kit", hint: "Voxel building tools", action: { kind: "mode", mode: "voxel" } },
  { icon: "weapon-mesh", label: "Weapon Mesh", hint: "Arsenal — weapon fit & colliders", action: { kind: "dressing-panel", id: "arsenal" } },
  { icon: "animation-editor", label: "Animation Editor", hint: "Animation panel — clips & retiming", action: { kind: "dressing-panel", id: "anim" } },
  { icon: "vfx-editor", label: "VFX Editor", hint: "Author & test VFX presets", action: { kind: "dressing-panel", id: "vfx" } },
  { icon: "draggable-dock", label: "Draggable Dock", hint: "Dockable panel workspace", action: { kind: "dressing-panel", id: "hierarchy" } },
  { icon: "resizable-panel", label: "Resizable Panel", hint: "Dressing Room workspace", action: { kind: "mode", mode: "editor" } },
  { icon: "skill-slot", label: "Skill Slot", hint: "Place skill slots on the HUD", action: { kind: "hud-edit" } },
  { icon: "combat-pad", label: "Combat Pad", hint: "Danger Room combat sandbox", action: { kind: "mode", mode: "danger" } },
  { icon: "loadout-card", label: "Loadout Card", hint: "Equipment & loadout", action: { kind: "danger-equip" } },
  { icon: "world-editor", label: "World Editor", hint: "Build & test voxel maps", action: { kind: "mode", mode: "voxel" } },
  { icon: "clip-library", label: "Clip Library", hint: "Browse the animation clip library", action: { kind: "dressing-panel", id: "anim" } },
  { icon: "asset-manager", label: "Asset Manager", hint: "Import models & assets", action: { kind: "mode", mode: "editor" } },
  { icon: "scriptable-skills", label: "Scriptable Skills", hint: "Skill Lab — author abilities live", action: { kind: "dressing-panel", id: "playground" } },
];

/* ------------------------------------------------------------------------ *
 * Dressing Room panel request bus.
 *
 * The Toolbox lives in the app shell while the Dressing Room dock lives
 * inside EditorMode. A request made BEFORE the mode switch is buffered until
 * EditorMode mounts and subscribes; a request made while it's already mounted
 * is delivered immediately.
 * ------------------------------------------------------------------------ */
let pendingDressing: DressingPanelId | null = null;
const dressingListeners = new Set<(id: DressingPanelId) => void>();

/** Ask the Dressing Room (mounted or not) to surface a dock panel. */
export function requestDressingPanel(id: DressingPanelId): void {
  if (dressingListeners.size > 0) {
    dressingListeners.forEach((l) => l(id));
  } else {
    pendingDressing = id;
  }
}

/** Subscribe (EditorMode). Any buffered request is delivered immediately. */
export function onDressingPanelRequest(cb: (id: DressingPanelId) => void): () => void {
  dressingListeners.add(cb);
  const pending = pendingDressing;
  pendingDressing = null;
  if (pending) cb(pending);
  return () => {
    dressingListeners.delete(cb);
  };
}
