import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { DangerRoom } from "../DangerRoom";
import { getCharacter, getWeapon } from "../assets";
import { ExplorerCharacter } from "../ExplorerCharacter";
import type { CharacterDef } from "../types";
import type { CharacterLook } from "../explorer/types";
import { loadMouseFeel, subscribeMouseFeel } from "../controlsSettings";
import {
  DIFFICULTY_COLOR,
  DIFFICULTY_SCALE,
  PROPS,
  VOXEL_MAP_VERSION,
  WEAPON_COLOR,
  type BlockData,
  type BrushState,
  type DeployableData,
  type DeployableKind,
  type DeployableNode,
  type Difficulty,
  type EditorStats,
  type GizmoMode,
  type PieceShape,
  type PropId,
  type VoxelMap,
} from "./types";
import { loadPropTemplate } from "./props";

/**
 * Distinct Explorer colourways so placed NPCs read apart at a glance. The editor
 * preview uses the same procedural Explorer rig the in-game fighters do (so what
 * you place matches what you fight); each NPC is tinted from this palette.
 */
const NPC_LOOKS: CharacterLook[] = [
  { skin: "#c98c5a", shirt: "#c0392b", pants: "#2c3e50", hat: "none", hatColor: "#222831" },
  { skin: "#c98c5a", shirt: "#2980b9", pants: "#1b2838", hat: "none", hatColor: "#222831" },
  { skin: "#c98c5a", shirt: "#27ae60", pants: "#1e3326", hat: "none", hatColor: "#222831" },
  { skin: "#c98c5a", shirt: "#8e44ad", pants: "#2c1f3a", hat: "none", hatColor: "#222831" },
  { skin: "#c98c5a", shirt: "#e67e22", pants: "#3a2a14", hat: "none", hatColor: "#222831" },
  { skin: "#c98c5a", shirt: "#16a085", pants: "#15302b", hat: "none", hatColor: "#222831" },
  { skin: "#c98c5a", shirt: "#d4ac0d", pants: "#3a3210", hat: "none", hatColor: "#222831" },
  { skin: "#c98c5a", shirt: "#c0457b", pants: "#3a1f2c", hat: "none", hatColor: "#222831" },
];

/**
 * Stable per-NPC Explorer colourway derived from its id, so a placed NPC keeps
 * the same colour across edits/reloads instead of flickering between palettes.
 */
function npcLook(id: string): CharacterLook {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return NPC_LOOKS[h % NPC_LOOKS.length];
}

/** localStorage key the editor saves/loads a map under. */
const STORE_KEY = "dangerroom:voxelmap";

/** Half-extent of the editable grid (cells span -GRID .. GRID on X/Z). */
const GRID = 24;
/** Max stack height in cells. */
const MAX_Y = 32;

const DRAG_THRESHOLD = 5; // px of movement before a press becomes an orbit drag
const ORBIT_SPEED = 0.006;
const PAN_SPEED = 0.02;
const ZOOM_STEP = 0.0015;
const MIN_DIST = 6;
const MAX_DIST = 70;
const POLAR_MIN = 0.12;
const POLAR_MAX = Math.PI / 2 - 0.05;

const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

/**
 * Height (relative to a block cell's base) of a shape's top surface, so a
 * deployable's feet rest on the actual terrain top. Only slabs are half-height;
 * walls/pillars/ramps fill the full cell height (a ramp rests at its high edge).
 */
const shapeTopHeight = (shape: PieceShape): number => (shape === "slab" ? 0.5 : 1);

// Ghost preview colours: neutral cyan for the build brush, green/red for
// valid/invalid deployable placement.
const GHOST_NEUTRAL = 0x8fe8ff;
const GHOST_VALID = 0x6fffa0;
const GHOST_INVALID = 0xff5a5a;

/**
 * Half-extent (in cells/metres) of a single-cell deployable's footprint. Kept
 * just under 0.5 so an NPC/bag/start marker always claims exactly the one cell
 * it stands in.
 */
const SINGLE_CELL_RADIUS = 0.49;

/**
 * Minimum fraction (per axis) of a cell a footprint must cover before that cell
 * is claimed. Stops a prop that pokes marginally past a boundary from
 * over-claiming its neighbours while still capturing genuinely multi-cell props.
 */
const FOOTPRINT_COVER = 0.5;

/**
 * Placement occupancy convention (the editor's single source of truth — keep all
 * future placement code going through it instead of ad-hoc per-kind logic):
 *
 *   - Terrain blocks occupy exactly their own cell (one block per cell; the build
 *     brush replaces on overlap — unchanged by occupancy rules).
 *   - A deployable occupies the set of grid cells under its *footprint*, across
 *     the vertical span of cells it stands in (from its standing level `y` up
 *     through the ceiling of its height). The footprint is derived from the
 *     deployable's normalized horizontal size: single-cell for NPCs / bags / the
 *     start marker, and the authored `PropDef.footprintRadius` for GLB props (so
 *     a wide "fortress" piece claims every cell it actually covers, known
 *     deterministically at click time); the height comes from `deployHeightCells`.
 *   - A deployable may NEVER be buried: every footprint cell across its vertical
 *     span must be free of any terrain block AND free of any other deployable
 *     whose footprint and vertical span both overlap it (even one standing on a
 *     different level). Invalid spots are refused (the click is a no-op) and the
 *     ghost turns red.
 *
 * In short: don't bury assets in maps/terrain/other assets — one footprint+span,
 * one owner.
 */

/**
 * The Danger Room Voxel Editor: a self-contained, disposable three.js map
 * authoring tool. It reuses the Danger Room environment for atmosphere and lets
 * the user build with voxel pieces (block/slab/wall/pillar/ramp) and drop
 * deployables (armed NPCs, static heavy bags, physics bags, a player start) on a
 * grid. Controls: LMB builds the active brush — hold and drag to paint a run of
 * blocks (stack / wall / ramp) without moving the camera. RMB drag orbits the
 * camera, RMB click erases; wheel zooms; middle button or Shift+drag pans. A
 * "custom dungeon" mode tags
 * placed NPCs with a difficulty tier. The whole map serializes to localStorage.
 *
 * No `@workspace/*` imports — this artifact is meant to be liftable on its own.
 */
export class VoxelEditor {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private timer = new THREE.Timer();
  private room: DangerRoom;
  private raf = 0;
  private disposed = false;

  // Orbit camera state (spherical around `target`).
  private target = new THREE.Vector3(0, 1, 0);
  private azimuth = Math.PI * 0.25;
  private polar = Math.PI * 0.32;
  private distance = 28;
  /**
   * Shared mouse feel (Mouse Sens / Invert Y) read from the same persisted
   * controls the Danger Room camera uses, so orbiting here matches the rest of
   * the studio instead of a hardcoded, mode-local sensitivity.
   */
  private mouseFeel = loadMouseFeel();
  /** Unsubscribe from live Mouse Sens / Invert Y changes; called on dispose. */
  private unsubscribeMouseFeel = subscribeMouseFeel((feel) => {
    this.mouseFeel = feel;
  });

  // Pointer / drag tracking.
  private pointer = new THREE.Vector2();
  private pointerInside = false;
  private dragging = false;
  private dragButton = -1;
  private dragMoved = false;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  // Cell painted most recently during an LMB build-drag, to avoid re-placing on
  // the same cell across consecutive pointer-move events.
  private lastPlaceKey: string | null = null;

  private raycaster = new THREE.Raycaster();
  private groundPlane: THREE.Mesh;

  // Placed content.
  private blocks = new Map<string, { data: BlockData; mesh: THREE.Mesh }>();
  private deployables = new Map<string, { data: DeployableData; group: THREE.Group }>();
  private blockGroup = new THREE.Group();
  private deployGroup = new THREE.Group();
  private startId: string | null = null;
  private uid = 0;

  // Shared, cached resources (disposed once at teardown).
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private matCache = new Map<string, THREE.MeshStandardMaterial>();
  // Floating-label textures keyed by their text, shared so many NPCs stay cheap.
  private labelTexCache = new Map<string, THREE.Texture>();

  // Placement preview ("ghost") highlight.
  private ghost: THREE.LineSegments;
  private ghostFloor: THREE.Mesh;

  private brush: BrushState = {
    tool: "block",
    shape: "block",
    color: 0x6ea8ff,
    deployKind: "npc",
    weapon: "sword",
    difficulty: "normal",
    prop: "brewingStand",
    rotation: 0,
  };
  private dungeon = false;

  private keys = new Set<string>();

  // ── Select tool / transform gizmo ──────────────────────────────────────────
  private gizmo!: TransformControls;
  /** True while the user is dragging a gizmo handle (suppresses orbit/paint). */
  private gizmoDragging = false;
  /** Currently-selected deployable id (Select tool), or null. */
  private selectedId: string | null = null;
  /** Snap transforms to a grid (0.5m / 15° / 0.25×) when on. */
  private snap = true;

  onStats: ((s: EditorStats) => void) | null = null;
  /** Pushes the deployable hierarchy to React (rebuilt on every content change). */
  onTree: ((nodes: DeployableNode[]) => void) | null = null;
  /** Reports the active selection id (or null) to React. */
  onSelect: ((id: string | null) => void) | null = null;
  /** Reports the active gizmo mode (keyboard shortcuts also drive this). */
  onGizmoMode: ((mode: GizmoMode) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = "none";

    const { clientWidth: w, clientHeight: h } = container;
    this.camera = new THREE.PerspectiveCamera(55, (w || 1) / (h || 1), 0.1, 500);

    // Open, lit studio backdrop — deliberately NOT the dark enclosed room mood,
    // so authoring happens on an airy pad instead of staring into a black box.
    this.scene.background = new THREE.Color(0x2a3a52);
    this.scene.fog = new THREE.Fog(0x2a3a52, 110, 240);

    // Lighting (mirrors the Danger Room mood).
    const ambient = new THREE.AmbientLight(0x7088b0, 0.7);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xbfd4ff, 1.1);
    key.position.set(14, 26, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 90;
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -40;
    cam.right = 40;
    cam.top = 40;
    cam.bottom = -40;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x4060a0, 0.4);
    fill.position.set(-12, 10, -14);
    this.scene.add(fill);

    // Open floor + grid only (no enclosing walls/ceiling) so the camera is never
    // boxed in while building.
    this.room = new DangerRoom({ open: true });
    this.room.setGridVisible(true);
    this.scene.add(this.room.group);

    this.scene.add(this.blockGroup);
    this.scene.add(this.deployGroup);

    // Invisible ground plane used only for placement raycasts.
    const planeGeo = new THREE.PlaneGeometry(GRID * 2, GRID * 2);
    const planeMat = new THREE.MeshBasicMaterial({ visible: false });
    this.groundPlane = new THREE.Mesh(planeGeo, planeMat);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.position.y = 0;
    this.scene.add(this.groundPlane);

    // A faint build-grid overlay so the cell layout is readable while editing.
    const buildGrid = new THREE.GridHelper(GRID * 2, GRID * 2, 0x2f6fb0, 0x15314f);
    (buildGrid.material as THREE.Material).transparent = true;
    (buildGrid.material as THREE.Material).opacity = 0.25;
    buildGrid.position.y = 0.04;
    this.scene.add(buildGrid);

    // Placement ghost: a wireframe cube + a floor tile, repositioned each frame.
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const ghostMat = new THREE.LineBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.9 });
    this.ghost = new THREE.LineSegments(edges, ghostMat);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    const tileGeo = new THREE.PlaneGeometry(0.96, 0.96);
    const tileMat = new THREE.MeshBasicMaterial({
      color: 0x8fe8ff,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
    });
    this.ghostFloor = new THREE.Mesh(tileGeo, tileMat);
    this.ghostFloor.rotation.x = -Math.PI / 2;
    this.ghostFloor.visible = false;
    this.scene.add(this.ghostFloor);

    this.setupGizmo();

    this.bind();
    this.resize();
    this.emitStats();
    this.loop();
  }

  // ── Resource caches ────────────────────────────────────────────────────────

  private material(color: number, doubleSide = false): THREE.MeshStandardMaterial {
    const k = `${color}:${doubleSide ? "d" : "s"}`;
    let m = this.matCache.get(k);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.6,
        metalness: 0.2,
        side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      });
      this.matCache.set(k, m);
    }
    return m;
  }

  private shapeGeo(shape: PieceShape): THREE.BufferGeometry {
    let g = this.geoCache.get(shape);
    if (g) return g;
    switch (shape) {
      case "block":
        g = new THREE.BoxGeometry(1, 1, 1);
        break;
      case "slab":
        g = new THREE.BoxGeometry(1, 0.5, 1).translate(0, -0.25, 0);
        break;
      case "wall":
        g = new THREE.BoxGeometry(1, 1, 0.22).translate(0, 0, -0.39);
        break;
      case "pillar":
        g = new THREE.CylinderGeometry(0.34, 0.34, 1, 16);
        break;
      case "ramp":
        g = this.rampGeo();
        break;
    }
    this.geoCache.set(shape, g);
    return g;
  }

  /** A triangular-prism ramp filling the cell, sloping up toward +Z. */
  private rampGeo(): THREE.BufferGeometry {
    const v = new Float32Array([
      -0.5, -0.5, -0.5, // 0 front-bottom-left
      0.5, -0.5, -0.5, // 1 front-bottom-right
      0.5, -0.5, 0.5, // 2 back-bottom-right
      -0.5, -0.5, 0.5, // 3 back-bottom-left
      -0.5, 0.5, 0.5, // 4 back-top-left
      0.5, 0.5, 0.5, // 5 back-top-right
    ]);
    const idx = [
      0, 2, 1, 0, 3, 2, // bottom
      3, 4, 5, 3, 5, 2, // back
      0, 1, 5, 0, 5, 4, // slope
      0, 4, 3, // left
      1, 2, 5, // right
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(v, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  // ── Public API (driven by the React toolbar) ────────────────────────────────

  setBrush(patch: Partial<BrushState>): void {
    const prevTool = this.brush.tool;
    this.brush = { ...this.brush, ...patch };
    if (this.brush.tool !== prevTool) {
      // The gizmo only exists in Select mode; show it on entry (if something is
      // selected) and hide it whenever another tool takes over.
      if (this.brush.tool === "select") this.reattachGizmo();
      else this.gizmo.detach();
    }
  }

  rotateBrush(): void {
    this.brush.rotation = (this.brush.rotation + 1) % 4;
  }

  setDungeon(on: boolean): void {
    this.dungeon = on;
    // Reflect difficulty rings on existing NPCs.
    for (const { data, group } of this.deployables.values()) {
      if (data.kind === "npc") this.refreshNpcDifficulty(group, data);
    }
    this.emitStats();
  }

  clearAll(): void {
    for (const { mesh } of this.blocks.values()) this.blockGroup.remove(mesh);
    for (const { group } of this.deployables.values()) {
      this.freeDeployable(group);
      this.deployGroup.remove(group);
    }
    this.blocks.clear();
    this.deployables.clear();
    this.startId = null;
    // Drop any selection so the gizmo can't dangle on a removed group.
    if (this.selectedId !== null) {
      this.selectedId = null;
      this.gizmo.detach();
      this.onSelect?.(null);
    }
    this.emitStats();
  }

  /** Release a deployable's per-instance GPU resources (its Explorer rig, if any). */
  private freeDeployable(group: THREE.Group): void {
    const avatar = group.userData.avatar as ExplorerCharacter | undefined;
    if (avatar) {
      avatar.root.parent?.remove(avatar.root);
      avatar.dispose();
      delete group.userData.avatar;
    }
  }

  serialize(): VoxelMap {
    return {
      version: VOXEL_MAP_VERSION,
      dungeon: this.dungeon,
      blocks: [...this.blocks.values()].map((b) => ({ ...b.data })),
      deployables: [...this.deployables.values()].map((d) => ({ ...d.data })),
    };
  }

  load(map: VoxelMap): void {
    this.clearAll();
    this.dungeon = !!map.dungeon;
    for (const b of map.blocks ?? []) this.addBlock(b);
    for (const d of map.deployables ?? []) this.addDeployable(d);
    this.emitStats();
  }

  // ── Placement ────────────────────────────────────────────────────────────────

  private addBlock(data: BlockData): void {
    const key = cellKey(data.x, data.y, data.z);
    const existing = this.blocks.get(key);
    if (existing) this.blockGroup.remove(existing.mesh);
    const doubleSide = data.shape === "ramp";
    const mesh = new THREE.Mesh(this.shapeGeo(data.shape), this.material(data.color, doubleSide));
    mesh.position.set(data.x + 0.5, data.y + 0.5, data.z + 0.5);
    mesh.rotation.y = (data.rotation * Math.PI) / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.cell = { x: data.x, y: data.y, z: data.z };
    this.blockGroup.add(mesh);
    this.blocks.set(key, { data, mesh });
  }

  private removeBlockAt(x: number, y: number, z: number): boolean {
    const key = cellKey(x, y, z);
    const b = this.blocks.get(key);
    if (!b) return false;
    this.blockGroup.remove(b.mesh);
    this.blocks.delete(key);
    return true;
  }

  private addDeployable(data: DeployableData): void {
    if (data.kind === "start") {
      // Only one start marker — replace any existing.
      if (this.startId) this.removeDeployableById(this.startId);
      this.startId = data.id;
    }
    const group = this.buildDeployable(data);
    this.applyDeployTransform(group, data);
    group.userData.id = data.id;
    this.deployGroup.add(group);
    this.deployables.set(data.id, { data, group });
  }

  /**
   * Position/rotate/scale a deployable group from its data. The Select tool's
   * gizmo writes continuous overrides (`px/py/pz`, `yaw`, `scale`); when those
   * are absent the entity falls back to its grid cell + quarter-turn rotation so
   * freshly-placed and legacy maps behave exactly as before.
   */
  private applyDeployTransform(group: THREE.Group, data: DeployableData): void {
    if (data.px !== undefined && data.py !== undefined && data.pz !== undefined) {
      group.position.set(data.px, data.py, data.pz);
    } else {
      group.position.set(
        data.x + 0.5,
        this.surfaceY(data.x, data.y, data.z, this.deployRadius(data.kind, data.prop)),
        data.z + 0.5,
      );
    }
    group.rotation.y = data.yaw !== undefined ? data.yaw : (data.rotation * Math.PI) / 2;
    // `data.scale` is the user multiplier; NPCs also carry a difficulty base so
    // the editor preview matches what play mode renders (base × user).
    group.scale.setScalar(this.deployBaseScale(data) * (data.scale ?? 1));
  }

  /**
   * Non-user portion of a deployable's scale. NPCs in dungeon mode are sized by
   * difficulty (mirrors VoxelArena); everything else has a base of 1. The gizmo
   * edits the composite, so writeBackTransform divides this out to keep
   * `data.scale` a pure user multiplier that round-trips through play mode.
   */
  private deployBaseScale(data: DeployableData): number {
    if (data.kind === "npc" && this.dungeon) {
      return DIFFICULTY_SCALE[data.difficulty ?? "normal"];
    }
    return 1;
  }

  private removeDeployableById(id: string): boolean {
    const d = this.deployables.get(id);
    if (!d) return false;
    this.freeDeployable(d.group);
    this.deployGroup.remove(d.group);
    this.deployables.delete(id);
    if (this.startId === id) this.startId = null;
    if (this.selectedId === id) {
      this.selectedId = null;
      this.gizmo.detach();
      this.onSelect?.(null);
    }
    return true;
  }

  // ── Select tool / transform gizmo ──────────────────────────────────────────

  /** Snap increments per gizmo mode (grid feel for an inherently grid-based map). */
  private static readonly SNAP = { translate: 0.5, rotate: Math.PI / 12, scale: 0.25 };

  private setupGizmo(): void {
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSpace("local");
    this.gizmo.setMode("translate");
    this.applySnap();
    // Suppress orbit/paint while a handle is being dragged, and write the new
    // transform back to the selection's data on release.
    this.gizmo.addEventListener("dragging-changed", (e) => {
      this.gizmoDragging = e.value as boolean;
      if (!this.gizmoDragging) {
        this.uniformizeScale();
        this.writeBackTransform();
        this.emitSelection();
      }
    });
    this.gizmo.addEventListener("objectChange", () => this.writeBackTransform());
    this.scene.add(this.gizmo.getHelper());
  }

  private applySnap(): void {
    const s = VoxelEditor.SNAP;
    this.gizmo.setTranslationSnap(this.snap ? s.translate : null);
    this.gizmo.setRotationSnap(this.snap ? s.rotate : null);
    this.gizmo.setScaleSnap(this.snap ? s.scale : null);
  }

  /** Force a uniform scale on the selection (deployables only support uniform). */
  private uniformizeScale(): void {
    const d = this.selectedId ? this.deployables.get(this.selectedId) : null;
    if (!d) return;
    const avg = (d.group.scale.x + d.group.scale.y + d.group.scale.z) / 3;
    d.group.scale.setScalar(Math.max(0.1, avg));
  }

  /** Mirror the live group transform back into the selection's serialized data. */
  private writeBackTransform(): void {
    const d = this.selectedId ? this.deployables.get(this.selectedId) : null;
    if (!d) return;
    const g = d.group;
    d.data.px = g.position.x;
    d.data.py = g.position.y;
    d.data.pz = g.position.z;
    d.data.yaw = g.rotation.y;
    // Strip the non-user base so `data.scale` stays a pure user multiplier.
    const base = this.deployBaseScale(d.data);
    d.data.scale = base > 0 ? g.scale.x / base : g.scale.x;
  }

  /** Re-attach the gizmo to the current selection (used when entering Select). */
  private reattachGizmo(): void {
    const d = this.selectedId ? this.deployables.get(this.selectedId) : null;
    if (d) this.gizmo.attach(d.group);
    else this.gizmo.detach();
  }

  /** Select a deployable by id (null clears selection). Drives the gizmo + React. */
  select(id: string | null): void {
    if (id && !this.deployables.has(id)) id = null;
    this.selectedId = id;
    if (id && this.brush.tool === "select") this.gizmo.attach(this.deployables.get(id)!.group);
    else this.gizmo.detach();
    this.onSelect?.(id);
    this.emitTree();
  }

  setGizmoMode(mode: GizmoMode): void {
    this.gizmo.setMode(mode);
    this.onGizmoMode?.(mode);
  }

  setSnap(on: boolean): void {
    this.snap = on;
    this.applySnap();
  }

  deleteSelected(): void {
    if (!this.selectedId) return;
    this.removeDeployableById(this.selectedId);
    this.emitStats();
  }

  /** Clone the selection a short offset away and select the copy. */
  duplicateSelected(): void {
    const d = this.selectedId ? this.deployables.get(this.selectedId) : null;
    if (!d || d.data.kind === "start") return; // only one player start allowed
    // Copy from data (kept in sync by writeBackTransform) so we clone the pure
    // user multiplier, not the difficulty-composited group scale.
    const g = d.group;
    const copy: DeployableData = {
      ...d.data,
      id: `d${this.uid++}`,
      px: (d.data.px ?? g.position.x) + 1,
      py: d.data.py ?? g.position.y,
      pz: (d.data.pz ?? g.position.z) + 1,
    };
    this.addDeployable(copy);
    this.select(copy.id);
    this.emitStats();
  }

  /** Frame the camera target on the current selection. */
  focusSelected(): void {
    const d = this.selectedId ? this.deployables.get(this.selectedId) : null;
    if (!d) return;
    this.target.copy(d.group.position);
    this.target.y += 1;
  }

  /** Pick a deployable under the pointer and (de)select it. */
  private selectAtPointer(): void {
    this.select(this.pickDeployable());
  }

  private labelForDeployable(data: DeployableData): string {
    switch (data.kind) {
      case "npc":
        return `NPC · ${data.weapon ?? "unarmed"}`;
      case "heavyBag":
        return "Heavy Bag";
      case "physicsBag":
        return "Physics Bag";
      case "prop":
        return data.prop ? (PROPS[data.prop]?.label ?? "Prop") : "Prop";
      case "start":
        return "Player Start";
      default:
        return data.kind;
    }
  }

  private emitTree(): void {
    if (!this.onTree) return;
    const nodes: DeployableNode[] = [...this.deployables.values()].map(({ data }) => ({
      id: data.id,
      kind: data.kind,
      label: this.labelForDeployable(data),
      selected: data.id === this.selectedId,
    }));
    this.onTree(nodes);
  }

  private emitSelection(): void {
    this.onSelect?.(this.selectedId);
  }

  /**
   * World Y for a deployable's feet (its group origin) so the root sits exactly
   * on the terrain top. The entity occupies cell `y` (the empty cell picked above
   * a block face, or y=0 on the floor); its feet rest on the TOP surface of the
   * nearest supporting block beneath it — accounting for partial shapes (slabs)
   * so it never floats or sinks. With nothing below, it rests on the ground plane.
   *
   * The support is sampled across the asset's whole footprint (`radius`), resting
   * the feet on the HIGHEST surface any footprint column covers. This keeps a wide
   * prop standing on its feet on the terrain it spans instead of sinking into
   * neighbouring blocks when only its centre cell happens to sit over a gap.
   */
  private surfaceY(x: number, y: number, z: number, radius = SINGLE_CELL_RADIUS): number {
    let best = 0;
    for (const fc of this.footprintCells(x, z, radius)) {
      for (let cy = y - 1; cy >= 0; cy--) {
        const b = this.blocks.get(cellKey(fc.x, cy, fc.z));
        if (b) {
          best = Math.max(best, cy + shapeTopHeight(b.data.shape));
          break;
        }
      }
    }
    return best;
  }

  // ── Occupancy model (see the placement-convention block at the top) ───────────

  /**
   * Horizontal half-extent (cells/metres) of a deployable's footprint. NPCs,
   * bags and the start marker are single-cell; GLB props use the static,
   * authored {@link PropDef.footprintRadius} so the footprint is known
   * deterministically at click time (no async measurement).
   */
  private deployRadius(kind: DeployableKind, prop?: PropId): number {
    if (kind === "prop" && prop) return this.propRadius(prop);
    return SINGLE_CELL_RADIUS;
  }

  /** Half-extent of the brush's current deploy kind, for ghost + placement. */
  private brushDeployRadius(): number {
    return this.deployRadius(this.brush.deployKind, this.brush.prop);
  }

  /**
   * Vertical extent (in whole cells) a deployable occupies, starting at its
   * standing cell. The occupancy check uses this so a tall asset can't be
   * dropped into a cell that terrain or another asset already fills on a
   * *different* level — i.e. it stops assets being buried inside other meshes,
   * not just colliding on their own footprint level. Humanoid NPCs and the
   * heavy bag are ~2 cells tall; the physics bag and start marker take a single
   * cell; GLB props span the ceiling of their authored target height.
   */
  private deployHeightCells(kind: DeployableKind, prop?: PropId): number {
    switch (kind) {
      case "npc":
      case "heavyBag":
        return 2;
      case "physicsBag":
      case "start":
        return 1;
      case "prop":
        return prop ? Math.max(1, Math.ceil(PROPS[prop].targetHeight)) : 1;
    }
  }

  /** Vertical extent (cells) of the brush's current deploy kind. */
  private brushDeployHeight(): number {
    return this.deployHeightCells(this.brush.deployKind, this.brush.prop);
  }

  /**
   * Static half-extent of a GLB prop, read from its authored
   * {@link PropDef.footprintRadius}. Clamped to at least a single cell so every
   * prop occupies its own cell even if mis-authored small.
   */
  private propRadius(prop: PropId): number {
    return Math.max(SINGLE_CELL_RADIUS, PROPS[prop].footprintRadius);
  }

  /**
   * The grid cells (x,z) a footprint of `radius` centred on cell (cx,cz) covers.
   * A neighbouring cell is only claimed when the footprint covers at least
   * {@link FOOTPRINT_COVER} of it on BOTH axes, so a prop that pokes marginally
   * past a cell boundary doesn't over-claim the adjacent cells.
   */
  private footprintCells(cx: number, cz: number, radius: number): { x: number; z: number }[] {
    const centerX = cx + 0.5;
    const centerZ = cz + 0.5;
    const loX = Math.floor(centerX - radius);
    const hiX = Math.floor(centerX + radius);
    const loZ = Math.floor(centerZ - radius);
    const hiZ = Math.floor(centerZ + radius);
    const cells: { x: number; z: number }[] = [];
    for (let x = loX; x <= hiX; x++) {
      const ovX = Math.min(x + 1, centerX + radius) - Math.max(x, centerX - radius);
      if (ovX < FOOTPRINT_COVER) continue;
      for (let z = loZ; z <= hiZ; z++) {
        const ovZ = Math.min(z + 1, centerZ + radius) - Math.max(z, centerZ - radius);
        if (ovZ < FOOTPRINT_COVER) continue;
        cells.push({ x, z });
      }
    }
    return cells;
  }

  /**
   * Whether a deployable of the given footprint + `height` (cells) can stand at
   * cell (x,y,z): every footprint cell across the asset's vertical span must be
   * free of terrain blocks AND free of any other deployable whose footprint and
   * vertical span both overlap it — so an asset can never be buried inside
   * terrain or another asset, even one standing on a different level. `ignoreId`
   * skips a deployable being replaced (e.g. the existing start marker).
   */
  private deployPlacementValid(
    cell: { x: number; y: number; z: number },
    radius: number,
    height: number,
    ignoreId?: string,
  ): boolean {
    const foot = this.footprintCells(cell.x, cell.z, radius);
    const top = cell.y + Math.max(1, height) - 1; // inclusive top cell occupied
    for (const fc of foot) {
      // Never bury a deployable inside terrain — check its whole vertical span,
      // not just the standing cell, so a tall asset can't clip into blocks above.
      for (let cy = cell.y; cy <= top; cy++) {
        if (this.blocks.has(cellKey(fc.x, cy, fc.z))) return false;
      }
      // Never overlap another deployable whose footprint AND vertical span both
      // intersect this one's — stops dropping an asset inside one that stands on
      // a different level (the single-level check used to let this through).
      for (const { data } of this.deployables.values()) {
        if (data.id === ignoreId) continue;
        const otherTop =
          data.y + this.deployHeightCells(data.kind, data.prop) - 1;
        if (top < data.y || cell.y > otherTop) continue; // vertical spans disjoint
        const other = this.footprintCells(data.x, data.z, this.deployRadius(data.kind, data.prop));
        if (other.some((oc) => oc.x === fc.x && oc.z === fc.z)) return false;
      }
    }
    return true;
  }

  // ── Deployable construction ─────────────────────────────────────────────────

  private buildDeployable(data: DeployableData): THREE.Group {
    switch (data.kind) {
      case "npc":
        return this.buildNpc(data);
      case "heavyBag":
        return this.buildHeavyBag();
      case "physicsBag":
        return this.buildPhysicsBag();
      case "prop":
        return this.buildProp(data);
      case "start":
        return this.buildStart();
    }
  }

  /** A GLB prop (bench / build helper): instant box stand-in, real model streams in. */
  private buildProp(data: DeployableData): THREE.Group {
    const g = new THREE.Group();
    g.add(this.buildPropPlaceholder(data));
    void this.upgradeProp(g, data);
    return g;
  }

  /** Category-tinted box matching the prop's target height — instant + fallback. */
  private buildPropPlaceholder(data: DeployableData): THREE.Object3D {
    const def = data.prop ? PROPS[data.prop] : undefined;
    const h = def?.targetHeight ?? 1.2;
    const box = new THREE.Mesh(
      this.cachedGeo("propPlaceholder", () => new THREE.BoxGeometry(0.8, 1, 0.8)),
      this.material(def?.category === "build" ? 0xc79bff : 0x6ea8ff),
    );
    box.name = "propPlaceholder";
    box.scale.y = h;
    box.position.y = h / 2;
    box.castShadow = true;
    return box;
  }

  /**
   * Swap the placeholder for the real GLB once it loads. Bails if the editor was
   * torn down or this deployable was removed/replaced mid-load. Clones share the
   * cached template's geometry + materials, so nothing is disposed per instance.
   */
  private async upgradeProp(group: THREE.Group, data: DeployableData): Promise<void> {
    const id = data.prop;
    if (!id) return;
    const tpl = await loadPropTemplate(id);
    if (this.disposed || !tpl || this.deployables.get(data.id)?.group !== group) return;
    for (const child of [...group.children]) {
      if (child.name === "propPlaceholder") group.remove(child);
    }
    group.add(tpl.clone(true));
  }

  private buildNpc(data: DeployableData): THREE.Group {
    const g = new THREE.Group();

    // A lightweight placeholder body shows instantly (and remains as the
    // fallback if the real character model can't be loaded). It is swapped out
    // for the real, weapon-bearing model once that loads.
    g.add(this.buildNpcPlaceholder(data));

    // Faction ring (enemy red) + a difficulty ring stacked above it.
    const ring = new THREE.Mesh(
      this.cachedGeo("npcRing", () => new THREE.TorusGeometry(0.55, 0.045, 8, 28)),
      this.material(0xff5a5a),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    g.add(ring);

    const diffRing = new THREE.Mesh(
      this.cachedGeo("npcDiffRing", () => new THREE.TorusGeometry(0.42, 0.05, 8, 24)),
      this.material(DIFFICULTY_COLOR[data.difficulty ?? "normal"]),
    );
    diffRing.rotation.x = Math.PI / 2;
    diffRing.position.y = 0.12;
    diffRing.name = "diffRing";
    g.add(diffRing);

    // Floating label: weapon (+ difficulty in dungeon mode) above the head.
    g.add(this.buildNpcLabel(data));

    this.applyNpcDifficultyScale(g, data);
    this.refreshNpcDifficulty(g, data);

    // Asynchronously upgrade to the real character + weapon model.
    void this.upgradeNpcModel(g, data);
    return g;
  }

  /** Capsule + head + colored weapon bar — instant + graceful fallback. */
  private buildNpcPlaceholder(data: DeployableData): THREE.Group {
    const ph = new THREE.Group();
    ph.name = "npcPlaceholder";
    // Capsule(radius 0.34, length 0.9) spans ±0.79 about its centre, so seating
    // its base at the group origin (feet on terrain) puts the centre at 0.79.
    const torso = new THREE.Mesh(
      this.cachedGeo("npcTorso", () => new THREE.CapsuleGeometry(0.34, 0.9, 6, 12)),
      this.material(0x3a4458),
    );
    torso.position.y = 0.79;
    torso.castShadow = true;
    const head = new THREE.Mesh(
      this.cachedGeo("npcHead", () => new THREE.SphereGeometry(0.26, 14, 12)),
      this.material(0xb7c4dc),
    );
    head.position.y = 1.54;
    head.castShadow = true;
    ph.add(torso, head);

    const weapon = data.weapon ?? "sword";
    const wColor = WEAPON_COLOR[weapon] ?? 0xd7e2ff;
    const wMesh = new THREE.Mesh(
      this.cachedGeo("npcWeapon", () => new THREE.BoxGeometry(0.09, 0.95, 0.09)),
      this.material(wColor),
    );
    wMesh.position.set(0.42, 0.89, 0.18);
    wMesh.rotation.z = 0.25;
    wMesh.castShadow = true;
    ph.add(wMesh);
    return ph;
  }

  /**
   * Build a procedural Explorer rig for this NPC (the same rig the in-game
   * fighters use), tinted with the NPC's stable colourway and visibly holding its
   * weapon, then retire the placeholder. Bails (disposing the half-built rig) if
   * the NPC was removed/replaced or the editor was torn down before the rig's
   * async clips finished loading.
   */
  private async upgradeNpcModel(group: THREE.Group, data: DeployableData): Promise<void> {
    const def: CharacterDef = { ...getCharacter("explorer"), look: npcLook(data.id) };
    const avatar = new ExplorerCharacter(def);
    // Track it immediately so a removal/dispose mid-load can tear it down.
    group.userData.avatar = avatar;

    // NPC combat is melee-only (see VoxelArena.npcWeapon), so preview the melee
    // weapon they'll actually wield rather than an authored bow/ranged/none.
    const weaponId = this.npcPreviewWeapon(data.weapon);
    avatar.setWeaponId(weaponId);
    await avatar.load();
    if (this.disposed || this.deployables.get(data.id)?.group !== group || group.userData.avatar !== avatar) {
      avatar.dispose();
      return;
    }

    // Show the rig's own procedural weapon mesh so it visibly holds the weapon.
    avatar.equipProceduralWeapon(weaponId);
    // Static preview: keep the rig's feet planted (no controller drives Y here),
    // so wide two-handed stances don't visibly float above their ring/surface.
    avatar.setGroundFeet(true);
    group.add(avatar.root);

    // Real rig is up — retire the placeholder body.
    group.getObjectByName("npcPlaceholder")?.removeFromParent();
  }

  /** Map an authored weapon onto the melee weapon the NPC fights with in play. */
  private npcPreviewWeapon(weapon: DeployableData["weapon"]): string {
    if (!weapon || weapon === "none" || weapon === "bow" || weapon === "pistol" || weapon === "rifle") {
      return "sword";
    }
    return weapon;
  }

  /** A camera-facing sprite naming the NPC's weapon (+ difficulty in dungeon). */
  private buildNpcLabel(data: DeployableData): THREE.Sprite {
    const tex = this.labelTexture(data);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const spr = new THREE.Sprite(mat);
    spr.name = "npcLabel";
    spr.position.y = 2.35;
    spr.scale.set(1.7, 0.46, 1);
    spr.renderOrder = 999;
    return spr;
  }

  /** Build (and cache) the label texture for an NPC's current weapon/difficulty. */
  private labelTexture(data: DeployableData): THREE.Texture {
    const weaponLabel = getWeapon(data.weapon ?? "none").label;
    const diff = (data.difficulty ?? "normal") as Difficulty;
    const text = this.dungeon ? `${weaponLabel} · ${diff[0].toUpperCase()}${diff.slice(1)}` : weaponLabel;
    const accent = this.dungeon ? DIFFICULTY_COLOR[diff] : 0x9fb6ff;
    const key = `${text}|${accent}`;
    let tex = this.labelTexCache.get(key);
    if (tex) return tex;

    const W = 512;
    const H = 138;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const pad = 14;
    const r = 28;
    // Rounded pill background.
    ctx.fillStyle = "rgba(8,12,20,0.82)";
    this.roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, r);
    ctx.fill();
    // Accent border.
    const css = `#${accent.toString(16).padStart(6, "0")}`;
    ctx.lineWidth = 6;
    ctx.strokeStyle = css;
    this.roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, r);
    ctx.stroke();
    // Text.
    ctx.font = "600 58px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f2f6ff";
    ctx.fillText(text, W / 2, H / 2 + 2);

    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.labelTexCache.set(key, tex);
    return tex;
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Re-color / show the difficulty ring + refresh the label on tier/mode change. */
  private refreshNpcDifficulty(group: THREE.Group, data: DeployableData): void {
    const ring = group.getObjectByName("diffRing") as THREE.Mesh | null;
    if (ring) {
      ring.visible = this.dungeon;
      ring.material = this.material(DIFFICULTY_COLOR[data.difficulty ?? "normal"]);
    }
    const label = group.getObjectByName("npcLabel") as THREE.Sprite | null;
    if (label) (label.material as THREE.SpriteMaterial).map = this.labelTexture(data);
    this.applyNpcDifficultyScale(group, data);
  }

  private applyNpcDifficultyScale(group: THREE.Group, data: DeployableData): void {
    // Compose difficulty base with the user multiplier so a difficulty change
    // (refreshNpcDifficulty) doesn't wipe a gizmo-applied scale.
    group.scale.setScalar(this.deployBaseScale(data) * (data.scale ?? 1));
  }

  private buildHeavyBag(): THREE.Group {
    const g = new THREE.Group();
    const base = new THREE.Mesh(
      this.cachedGeo("bagBase", () => new THREE.CylinderGeometry(0.5, 0.6, 0.2, 18)),
      this.material(0x14181f),
    );
    base.position.y = 0.1;
    base.receiveShadow = true;
    const body = new THREE.Mesh(
      this.cachedGeo("heavyBagBody", () => new THREE.CapsuleGeometry(0.36, 1.3, 8, 14)),
      this.material(0x5a4a3a),
    );
    body.position.y = 1.15;
    body.castShadow = true;
    const hook = new THREE.Mesh(
      this.cachedGeo("bagHook", () => new THREE.TorusGeometry(0.1, 0.03, 8, 16)),
      this.material(0x9a9a9a),
    );
    hook.position.y = 1.95;
    g.add(base, body, hook);
    return g;
  }

  private buildPhysicsBag(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      this.cachedGeo("physBagBody", () => new THREE.CylinderGeometry(0.34, 0.34, 1.5, 18)),
      this.material(0x0a0a0c),
    );
    body.position.y = 0.78;
    body.castShadow = true;
    const cap = new THREE.Mesh(
      this.cachedGeo("physBagCap", () => new THREE.SphereGeometry(0.34, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)),
      this.material(0x16161a),
    );
    cap.position.y = 1.53;
    g.add(body, cap);
    return g;
  }

  private buildStart(): THREE.Group {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      this.cachedGeo("startRing", () => new THREE.TorusGeometry(0.5, 0.06, 10, 32)),
      this.emissive(0x46f08a),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    const pin = new THREE.Mesh(
      this.cachedGeo("startPin", () => new THREE.ConeGeometry(0.18, 0.5, 4)),
      this.emissive(0x46f08a),
    );
    pin.position.y = 0.7;
    pin.rotation.y = Math.PI / 4;
    g.add(ring, pin);
    return g;
  }

  private emissive(color: number): THREE.MeshStandardMaterial {
    const k = `emiss:${color}`;
    let m = this.matCache.get(k);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        emissive: new THREE.Color(color),
        emissiveIntensity: 0.7,
        roughness: 0.4,
        metalness: 0.1,
      });
      this.matCache.set(k, m);
    }
    return m;
  }

  private cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geoCache.get(key);
    if (!g) {
      g = make();
      this.geoCache.set(key, g);
    }
    return g;
  }

  // ── Pointer + camera ─────────────────────────────────────────────────────────

  private bind(): void {
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  private onContextMenu = (e: Event) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    this.keys.add(e.code);
    // In Select mode the shortcuts drive the gizmo; otherwise R rotates the brush.
    if (this.brush.tool === "select") {
      if (e.code === "KeyG") this.setGizmoMode("translate");
      else if (e.code === "KeyR") this.setGizmoMode("rotate");
      else if (e.code === "KeyE") this.setGizmoMode("scale");
      else if (e.code === "Delete" || e.code === "Backspace") this.deleteSelected();
      else if (e.code === "Escape") this.select(null);
      return;
    }
    if (e.code === "KeyR" && !e.repeat) this.rotateBrush();
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  private updatePointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.pointerInside = true;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.updatePointer(e);
    // Clicking a gizmo handle: TransformControls owns the gesture. Don't begin a
    // drag of our own (which would orbit/paint/deselect underneath it).
    if (this.gizmo.axis || this.gizmoDragging) return;
    this.dragging = true;
    this.dragButton = e.button;
    this.dragMoved = false;
    this.downX = this.lastX = e.clientX;
    this.downY = this.lastY = e.clientY;
    this.lastPlaceKey = null;
    // LMB builds (it never moves the camera). For the block tool, paint immediately
    // on press and continue painting through the drag below. Deploy/Select act on
    // release so a drag doesn't spam items or fight the gizmo.
    if (e.button === 0 && this.brush.tool === "block") this.paintBlockAtPointer();
  };

  private onPointerMove = (e: PointerEvent) => {
    this.updatePointer(e);
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (!this.dragMoved && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > DRAG_THRESHOLD) {
      this.dragMoved = true;
    }
    // LMB: continuous build (stack / wall / ramp) — never orbits the camera.
    // Deploy/Select don't paint on drag (they act on a click in onPointerUp).
    if (this.dragButton === 0) {
      if (this.brush.tool === "block") this.paintBlockAtPointer();
      return;
    }
    if (!this.dragMoved) return;
    // Pan with the middle button or Shift; otherwise RMB orbits the camera.
    const pan = this.dragButton === 1 || this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    if (pan) this.panCamera(dx, dy);
    else this.orbitCamera(dx, dy);
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.dragging) return;
    const button = this.dragButton;
    const wasClick = !this.dragMoved;
    this.dragging = false;
    this.dragButton = -1;
    this.lastPlaceKey = null;
    // LMB block painting already happened on down/move. Deploy tools place on a
    // click; RMB erases on a click (an RMB drag orbited the camera instead).
    if (button === 0) {
      if (wasClick && this.brush.tool === "deploy") this.placeAtPointer();
      else if (wasClick && this.brush.tool === "select") this.selectAtPointer();
    } else if (button === 2 && wasClick) {
      this.eraseAtPointer();
    }
    void e;
  };

  private onPointerLeave = () => {
    this.pointerInside = false;
    this.ghost.visible = false;
    this.ghostFloor.visible = false;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.distance = THREE.MathUtils.clamp(
      this.distance * (1 + e.deltaY * ZOOM_STEP),
      MIN_DIST,
      MAX_DIST,
    );
  };

  private orbitCamera(dx: number, dy: number): void {
    const sens = ORBIT_SPEED * this.mouseFeel.sensitivity;
    const inv = this.mouseFeel.invertY ? -1 : 1;
    this.azimuth -= dx * sens;
    this.polar = THREE.MathUtils.clamp(this.polar - dy * sens * inv, POLAR_MIN, POLAR_MAX);
  }

  private panCamera(dx: number, dy: number): void {
    const right = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    this.camera.getWorldDirection(right);
    right.crossVectors(right, up).normalize();
    const forward = new THREE.Vector3().crossVectors(up, right).normalize();
    const k = PAN_SPEED * (this.distance / 28);
    this.target.addScaledVector(right, -dx * k);
    this.target.addScaledVector(forward, -dy * k);
  }

  private onResize = () => this.resize();

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  // ── Raycast → grid cell ──────────────────────────────────────────────────────

  /** Resolve the cell to place INTO (adjacent to a hit face, or on the floor). */
  private pickPlaceCell(): { x: number; y: number; z: number } | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.blockGroup.children, false);
    if (hits.length) {
      const hit = hits[0];
      const cell = (hit.object.userData.cell ?? null) as { x: number; y: number; z: number } | null;
      if (cell && hit.face) {
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        const nx = Math.round(n.x);
        const ny = Math.round(n.y);
        const nz = Math.round(n.z);
        return this.clampCell(cell.x + nx, cell.y + ny, cell.z + nz);
      }
    }
    const floor = this.raycaster.intersectObject(this.groundPlane, false);
    if (floor.length) {
      const p = floor[0].point;
      return this.clampCell(Math.floor(p.x), 0, Math.floor(p.z));
    }
    return null;
  }

  /** Resolve the existing block cell under the cursor (for erasing). */
  private pickBlockCell(): { x: number; y: number; z: number } | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.blockGroup.children, false);
    if (!hits.length) return null;
    return (hits[0].object.userData.cell ?? null) as { x: number; y: number; z: number } | null;
  }

  private pickDeployable(): string | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.deployGroup.children, true);
    if (!hits.length) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && o.userData.id === undefined) o = o.parent;
    return o ? (o.userData.id as string) : null;
  }

  private clampCell(x: number, y: number, z: number): { x: number; y: number; z: number } | null {
    if (x < -GRID || x >= GRID || z < -GRID || z >= GRID) return null;
    if (y < 0 || y >= MAX_Y) return null;
    return { x, y, z };
  }

  /**
   * Place a block at the cursor during an LMB build-drag. Dedupes against the
   * last cell so dragging across the same cell does not re-add repeatedly; this
   * is what makes a single LMB drag stack, wall, or ramp smoothly.
   */
  private paintBlockAtPointer(): void {
    const cell = this.pickPlaceCell();
    if (!cell) return;
    const key = `${cell.x},${cell.y},${cell.z}`;
    if (key === this.lastPlaceKey) return;
    this.lastPlaceKey = key;
    this.addBlock({
      x: cell.x,
      y: cell.y,
      z: cell.z,
      shape: this.brush.shape,
      color: this.brush.color,
      rotation: this.brush.rotation,
    });
    this.emitStats();
  }

  private placeAtPointer(): void {
    if (this.brush.tool === "deploy") {
      // Deployables stand on the floor cell or atop a block face.
      const cell = this.pickPlaceCell();
      if (!cell) return;
      this.placeDeployable(cell);
      return;
    }
    const cell = this.pickPlaceCell();
    if (!cell) return;
    this.addBlock({
      x: cell.x,
      y: cell.y,
      z: cell.z,
      shape: this.brush.shape,
      color: this.brush.color,
      rotation: this.brush.rotation,
    });
    this.emitStats();
  }

  private placeDeployable(cell: { x: number; y: number; z: number }): void {
    const kind = this.brush.deployKind;
    // Refuse buried/overlapping spots (a click on an invalid cell is a no-op).
    // The start marker replaces any existing one, so it ignores itself.
    const ignoreId = kind === "start" ? this.startId ?? undefined : undefined;
    if (
      !this.deployPlacementValid(
        cell,
        this.brushDeployRadius(),
        this.brushDeployHeight(),
        ignoreId,
      )
    )
      return;
    const data: DeployableData = {
      id: `d${this.uid++}_${Date.now().toString(36)}`,
      kind,
      x: cell.x,
      y: cell.y,
      z: cell.z,
      rotation: this.brush.rotation,
      weapon: kind === "npc" ? this.brush.weapon : undefined,
      difficulty: kind === "npc" ? this.brush.difficulty : undefined,
      prop: kind === "prop" ? this.brush.prop : undefined,
    };
    this.addDeployable(data);
    this.emitStats();
  }

  private eraseAtPointer(): void {
    // Prefer erasing a deployable directly under the cursor, else a block.
    const id = this.pickDeployable();
    if (id) {
      this.removeDeployableById(id);
      this.emitStats();
      return;
    }
    const cell = this.pickBlockCell();
    if (cell && this.removeBlockAt(cell.x, cell.y, cell.z)) this.emitStats();
  }

  private updateGhost(): void {
    // The Select tool manipulates existing objects — no placement preview.
    if (this.brush.tool === "select" || !this.pointerInside || this.dragging) {
      this.ghost.visible = false;
      this.ghostFloor.visible = false;
      return;
    }
    const cell = this.pickPlaceCell();
    if (!cell) {
      this.ghost.visible = false;
      this.ghostFloor.visible = false;
      return;
    }
    this.ghost.visible = true;
    this.ghostFloor.visible = true;

    if (this.brush.tool !== "deploy") {
      // Build brush: neutral, single-cell preview (placement is always valid —
      // overlaps simply replace the block).
      this.ghost.scale.set(1, 1, 1);
      this.ghostFloor.scale.set(1, 1, 1);
      this.ghost.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
      this.ghostFloor.position.set(cell.x + 0.5, cell.y + 0.02, cell.z + 0.5);
      this.setGhostColor(GHOST_NEUTRAL);
      return;
    }

    // Deploy tool: span the ghost over the whole footprint and colour it by
    // validity (green = placeable, red = buried/overlapping).
    const radius = this.brushDeployRadius();
    const foot = this.footprintCells(cell.x, cell.z, radius);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const c of foot) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minZ = Math.min(minZ, c.z);
      maxZ = Math.max(maxZ, c.z);
    }
    const w = maxX - minX + 1;
    const d = maxZ - minZ + 1;
    const centerX = (minX + maxX + 1) / 2;
    const centerZ = (minZ + maxZ + 1) / 2;

    const ignoreId =
      this.brush.deployKind === "start" ? this.startId ?? undefined : undefined;
    const valid = this.deployPlacementValid(cell, radius, this.brushDeployHeight(), ignoreId);

    this.ghost.scale.set(w, 1, d);
    this.ghost.position.set(centerX, cell.y + 0.5, centerZ);
    this.ghostFloor.scale.set(w, d, 1);
    this.ghostFloor.position.set(centerX, cell.y + 0.02, centerZ);
    this.setGhostColor(valid ? GHOST_VALID : GHOST_INVALID);
  }

  private setGhostColor(hex: number): void {
    (this.ghost.material as THREE.LineBasicMaterial).color.setHex(hex);
    (this.ghostFloor.material as THREE.MeshBasicMaterial).color.setHex(hex);
  }

  // ── Loop ─────────────────────────────────────────────────────────────────────

  private keyboardPan(dt: number): void {
    const speed = 18 * dt * (this.distance / 28);
    const f = new THREE.Vector3(-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth));
    const r = new THREE.Vector3(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) this.target.addScaledVector(f, speed);
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) this.target.addScaledVector(f, -speed);
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) this.target.addScaledVector(r, speed);
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) this.target.addScaledVector(r, -speed);
  }

  private positionCamera(): void {
    const sinP = Math.sin(this.polar);
    const x = this.target.x + this.distance * sinP * Math.sin(this.azimuth);
    const y = this.target.y + this.distance * Math.cos(this.polar);
    const z = this.target.z + this.distance * sinP * Math.cos(this.azimuth);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    this.keyboardPan(dt);
    this.positionCamera();
    this.room.update(this.timer.getElapsed());
    for (const { group } of this.deployables.values()) {
      (group.userData.avatar as ExplorerCharacter | undefined)?.update(dt);
    }
    this.updateGhost();
    this.renderer.render(this.scene, this.camera);
  };

  private emitStats(): void {
    let npcs = 0;
    let bags = 0;
    let props = 0;
    for (const { data } of this.deployables.values()) {
      if (data.kind === "npc") npcs++;
      else if (data.kind === "heavyBag" || data.kind === "physicsBag") bags++;
      else if (data.kind === "prop") props++;
    }
    this.onStats?.({
      blocks: this.blocks.size,
      npcs,
      bags,
      props,
      hasStart: this.startId !== null,
      dungeon: this.dungeon,
    });
    // The hierarchy mirrors the deployable set, so refresh it whenever stats do.
    this.emitTree();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeMouseFeel();
    cancelAnimationFrame(this.raf);
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);

    this.gizmo.detach();
    this.scene.remove(this.gizmo.getHelper());
    this.gizmo.dispose();

    this.room.dispose();
    // Release each NPC's Explorer rig + per-instance resources, then labels.
    for (const { group } of this.deployables.values()) this.freeDeployable(group);
    for (const t of this.labelTexCache.values()) t.dispose();
    this.labelTexCache.clear();
    for (const g of this.geoCache.values()) g.dispose();
    for (const m of this.matCache.values()) m.dispose();
    this.geoCache.clear();
    this.matCache.clear();
    (this.ghost.geometry as THREE.BufferGeometry).dispose();
    (this.ghost.material as THREE.Material).dispose();
    (this.ghostFloor.geometry as THREE.BufferGeometry).dispose();
    (this.ghostFloor.material as THREE.Material).dispose();
    (this.groundPlane.geometry as THREE.BufferGeometry).dispose();
    (this.groundPlane.material as THREE.Material).dispose();

    this.scene.traverse((o) => {
      if (o instanceof THREE.GridHelper) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });

    this.renderer.dispose();
    if (el.parentElement === this.container) this.container.removeChild(el);
  }
}
