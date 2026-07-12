/**
 * Scene Editor types — the data contract between the imperative `EditorScene`
 * engine and the React editor overlay. Mirrors the snapshot/callback pattern the
 * rest of the animator uses (engine pushes immutable snapshots; React calls
 * imperative setters back). Self-contained: no `@workspace/*` imports allowed.
 */

export type GizmoMode = "translate" | "rotate" | "scale";

/**
 * Structural "build" brushes drawn by holding RMB and pulling on the ground
 * plane (lock the first cell, drag to the release cell):
 *  - wall   — thin vertical panel along the drag line
 *  - ramp   — wedge rising along the drag line
 *  - stairs — a stepped staircase climbing along the drag line
 *  - pillar — column over the dragged footprint
 *  - slab   — flat floor over the dragged footprint
 */
export type BuildKind = "wall" | "ramp" | "stairs" | "pillar" | "slab";

/** Primitive meshes the editor can spawn. */
export type PrimitiveKind =
  | "box"
  | "sphere"
  | "cylinder"
  | "cone"
  | "plane"
  | "torus";

/**
 * Every kind of node the editor's unified hierarchy can hold. Primitives plus
 * the structural node types that appear once arbitrary Object3D graphs (imported
 * models, the procedural rig, their groups / meshes / skinned meshes / bones)
 * are registered into the same flat-with-parentId registry.
 */
export type NodeKind =
  | PrimitiveKind
  | "group"
  | "mesh"
  | "skinnedMesh"
  | "bone"
  | "model"
  | "rig";

/** Collider shapes that can be attached to an object and visualised. */
export type ColliderShape = "box" | "sphere" | "capsule" | "cylinder";

/**
 * A collider attached to an object, expressed in the object's LOCAL space (so it
 * tracks the object's transform). `dims` meaning is shape-dependent:
 *  - box:      full width/height/depth  (x, y, z)
 *  - sphere:   radius                    (x)
 *  - capsule:  radius (x), total height (y)
 *  - cylinder: radius (x), height (y)
 */
export interface ColliderSpec {
  shape: ColliderShape;
  dims: { x: number; y: number; z: number };
  offset: { x: number; y: number; z: number };
}

/** A named, toggle-able grouping for scene objects. */
export interface EditorLayer {
  id: string;
  name: string;
  /** 0xrrggbb accent used for the layer chip. */
  color: number;
  visible: boolean;
  /**
   * Default collider shape auto-attached to objects spawned into this layer (and
   * applied in bulk via "apply to layer"). Null/undefined = no default collider.
   */
  defaultCollider?: ColliderShape | null;
}

/** Immutable per-object view handed to React each change. */
export interface EditorObjectSnapshot {
  id: string;
  name: string;
  layerId: string;
  kind: NodeKind;
  visible: boolean;
  selected: boolean;
  /** Parent node id, or null when the node sits at the scene root. */
  parentId: string | null;
  /** Depth in the hierarchy (0 = scene root) for tree indentation. */
  depth: number;
  /** True when this node has at least one child node. */
  hasChildren: boolean;
  /** True when the node came from an import / the rig (not editor-spawned). */
  imported: boolean;
  position: [number, number, number];
  /** Euler XYZ in degrees (UI-friendly). */
  rotation: [number, number, number];
  scale: [number, number, number];
  /** 0xrrggbb base material colour, or null for nodes without a coloured material. */
  color: number | null;
  collider: ColliderSpec | null;
}

/** A named tier variant of a weapon, surfaced to the arsenal library (data only). */
export interface WeaponTierView {
  name: string;
  /** Combat-intensity multiplier (balancing is out of scope), or null when unset. */
  power: number | null;
}

/**
 * One weapon the arsenal library can equip — a catalog prefab or an imported
 * ("custom") model promoted to equippable. Grouped in the UI by `group`.
 */
export interface WeaponLibEntry {
  /** Catalog `WeaponId`, or `custom:<nodeId>` for an imported weapon. */
  id: string;
  label: string;
  /** Roster family: melee-1h / melee-2h / off-hand / ranged / magic / custom. */
  group: string;
  /** Animation set this weapon switches the rig to (or "—" for imports). */
  animSet: string;
  /** Signature skill name bundled with the prefab. */
  skillName: string;
  tiers: WeaponTierView[];
  /** True for imported models (no prefab data; placement-only overrides). */
  custom: boolean;
}

/**
 * Live, editable transform of the currently-equipped weapon — drives the
 * size + grip placement gizmo. For catalog weapons these values are written
 * back onto the prefab data; for imports they are kept as local overrides.
 */
export interface WeaponEditState {
  /** True when editing a catalog prefab (writes to prefab data). */
  catalog: boolean;
  /** Longest-axis size in metres (catalog) or uniform scale factor (import). */
  size: number;
  /** Grip translation in the hand-mount frame (m). */
  pos: [number, number, number];
  /** Grip rotation (radians). */
  rot: [number, number, number];
  /**
   * Swept blade-collider knobs, or `null` for weapons that swing no blade
   * (ranged/magic/unarmed/imports). `startFrac`/`endFrac` are the cutting edge's
   * ends as fractions of the tip length; `radius` is the capsule radius (m).
   */
  hit: { startFrac: number; endFrac: number; radius: number } | null;
  /** Whether the wireframe blade-collider preview capsule is shown. */
  showCollider: boolean;
}

/**
 * Animation clips that rode in on an imported model (GLB/FBX), grouped by the
 * imported root node they belong to. Distinct from the procedural rig's clips.
 */
export interface ImportedClipGroup {
  /** Id of the imported root node these clips animate. */
  rootId: string;
  /** Display name of the imported root (for the section header). */
  name: string;
  clips: string[];
}

/** The full editor view pushed to React. */
/**
 * Live state of the Playground "Skill Lab" — the per-clip authoring knobs applied
 * to the skill-target character (the driven Play-mode avatar, else the selected
 * Playground character). `available`/`clips` describe whether a target exists and
 * which clips it exposes; the rest are the editable values mirrored from the engine.
 */
export interface SkillLabState {
  /** Whether a target character exists to author against. */
  available: boolean;
  /** Clip names available on the target character. */
  clips: string[];
  /** Selected clip to author, or null. */
  clipName: string | null;
  /** Playback speed/intensity multiplier (0.25..3). */
  overdrive: number;
  /** Whether the authored clip plays mirrored. */
  mirror: boolean;
  /** Arm spread, -1 (tucked) .. +1 (wide). */
  armWidth: number;
  /** Sub-clip in-point as a fraction of the clip (0..1). */
  clipFrom: number;
  /** Sub-clip out-point as a fraction of the clip (0..1). */
  clipTo: number;
  /** VFX preset id fired when the authored skill is tested. */
  vfxId: string;
  /** Whether the slash-arc trail emits from the damaging collider. */
  slashFromCollider: boolean;
  /** Damaging collider center offset (character space) + AOE radius. */
  colliderX: number;
  colliderY: number;
  colliderZ: number;
  colliderRadius: number;
  /** Whether the collider wireframe is shown on the character. */
  showCollider: boolean;
}

/** One Play-mode weapon-skill slot as surfaced to the HUD. */
export interface PlayHudSkill {
  /** Slot key ("primary" | "skill1".."skill5"). */
  key: string;
  /** Input hint shown on the slot ("LMB" | "1".."5"). */
  bind: string;
  /** Skill name. */
  label: string;
  /** Glyph/emoji icon. */
  glyph: string;
  /** Cooldown length in seconds (0 = instant). */
  cooldown: number;
  /** `performance.now()` ms timestamp the slot becomes usable again (0 = ready). */
  readyAt: number;
}

/** Game-style combat HUD state for Play mode (null when not playing). */
export interface PlayHudState {
  /** Health as a 0..1 fraction (cosmetic full until a damage model exists). */
  health: number;
  /** The driven character's weapon-skill bar. */
  skills: PlayHudSkill[];
}

export interface EditorSnapshot {
  objects: EditorObjectSnapshot[];
  layers: EditorLayer[];
  /** Primary (active) selection — drives the inspector + gizmo attachment. */
  selectedId: string | null;
  /** Full selection set (includes the primary); drives multi-select highlight. */
  selectedIds: string[];
  /** Whether there is at least one undoable step on the history stack. */
  canUndo: boolean;
  /** Whether there is at least one redoable step on the history stack. */
  canRedo: boolean;
  /** An open right-click context menu request, or null when none is showing. */
  contextMenu: EditorContextMenu | null;
  gizmo: GizmoMode;
  snap: boolean;
  showColliders: boolean;
  showGrid: boolean;
  /** Clips currently loaded on the animation-library rig (empty until loaded). */
  rigClips: string[];
  /** Weapon set the rig is posing with, or null when no rig is loaded. */
  rigWeapon: string | null;
  rigPlaying: string;
  /** True when the loaded rig is the procedural box ("voxel") character. */
  rigIsVoxel: boolean;
  /** The full weapon arsenal (catalog prefabs + imported customs) for the library. */
  weapons: WeaponLibEntry[];
  /** Id of the equipped weapon (catalog id or `custom:<nodeId>`), or null. */
  equippedWeapon: string | null;
  /** Selected tier index for the equipped weapon (0 when it has no tiers). */
  equippedTier: number;
  /** Whether the in-viewport bone/tip connection markers are shown. */
  weaponMarkers: boolean;
  /** Editable size + grip transform of the equipped weapon, or null when none. */
  weaponEdit: WeaponEditState | null;
  /** Clips that came in with imported models, grouped by their root node. */
  importedClips: ImportedClipGroup[];
  /** The currently-playing imported clip, keyed `${rootId}::${clipName}`, or null. */
  importedPlaying: string | null;
  /**
   * Mixamo clips auto-retargeted onto the loaded procedural rig (the dressed
   * character) on import, grouped by source. Empty unless a rig is loaded and a
   * Mixamo-skeletoned model was imported.
   */
  rigImportedClips: ImportedClipGroup[];
  /** The currently-playing auto-wired rig clip, keyed `${srcId}::${clipName}`, or null. */
  rigImportedPlaying: string | null;
  /** Whether the fish-eye-on-occlusion camera assist is enabled. */
  fishEye: boolean;
  /** True while the fish-eye is currently widened (a mesh is blocking terrain). */
  fishEyeActive: boolean;
  /** Layer treated as "terrain" the camera keeps in view, or null for the ground plane. */
  terrainLayerId: string | null;
  /** Active structural build brush, or null when the normal select/gizmo tools are active. */
  buildKind: BuildKind | null;
  /** Height used for walls/pillars and the rise of ramps (world units). */
  buildHeight: number;
  /** Thickness of walls and slabs (world units). */
  buildThickness: number;
  /** Whether the unreal-bloom postprocessing pass is enabled. */
  bloom: boolean;
  /** True while the rig is mid one-shot (import/convert UX disables during this). */
  busy: boolean;
  /** True while Play mode is driving a grudge character with the Controller. */
  playing: boolean;
  /** True while Play mode is in the first-person camera (KeyB toggles it). */
  firstPerson: boolean;
  /**
   * Root-node ids of every spawned playground character drivable in Play mode —
   * grudge races plus catalog fighters (LED Monk, Racalvin, casters, GLB rigs).
   */
  grudgeChars: { rootId: string; name: string }[];
  /** True when a dressed rig is on the stand (also drivable via the top Play button). */
  hasRig: boolean;
  /** Playground Skill Lab authoring state (animation + collider + VFX tuning). */
  skillLab: SkillLabState;
  /**
   * A transient user-facing notice (e.g. why a blocked action no-opped). The
   * monotonic `id` lets React show each new notice once (and re-show a repeated
   * message), then auto-dismiss it. Null when there is nothing to surface.
   */
  notice: EditorNotice | null;
  /** Game-style combat HUD (vitals + weapon-skill bar) while Play mode runs. */
  playHud: PlayHudState | null;
}

/**
 * A right-click context-menu request. The engine raycasts under the cursor on
 * RMB-click (no drag) and hands React the screen position + the node (if any)
 * that was hit, so the overlay can render an actionable menu. The monotonic `id`
 * lets React re-open the menu when a second right-click lands on the same spot.
 */
export interface EditorContextMenu {
  id: number;
  /** Viewport-space cursor position to anchor the menu at. */
  x: number;
  y: number;
  /** Node id under the cursor, or null when empty space was right-clicked. */
  targetId: string | null;
  /** Display name of the targeted node, or null for an empty-space click. */
  targetName: string | null;
}

/** A transient, auto-dismissing message surfaced to the editor UI as a toast. */
export interface EditorNotice {
  /** Monotonic id so React can detect and re-trigger each new notice. */
  id: number;
  text: string;
  kind: "info" | "warn";
}

/**
 * The plain-JSON descriptor `EditorScene.exportJSON` produces and `importJSON`
 * consumes — the round-trip contract for posting a scene to the gallery and
 * reopening it. `objects` is a DFS-ordered flat list whose `parentId` links
 * rebuild the hierarchy.
 */
export interface SceneDescriptor {
  version: number;
  layers: EditorLayer[];
  objects: EditorObjectSnapshot[];
}

/** A VFX preset the editor can fire at a point — pure data; dispatch is in the engine. */
export interface VfxPreset {
  id: string;
  label: string;
  group: "impact" | "energy" | "fire" | "status" | "smoke";
}
