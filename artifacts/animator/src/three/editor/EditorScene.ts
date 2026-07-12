import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { unzip } from "./loaders/unzip";
import { parseBBModel } from "./loaders/bbmodel";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Vfx } from "../Vfx";
import { ExplorerCharacter } from "../ExplorerCharacter";
import { Character } from "../Character";
import type { VoxelPart } from "../explorer/rig";
import type { ShellId } from "../LedMaskShells";
import { retargetMixamoClip, loadSkeletonSource, loadClips } from "../explorer/loader";
import { allReferencedClipIds } from "../explorer/clipCatalog";
import {
  findSkinnedMesh,
  makeRetargetSource,
  retargetLibrary,
  skeletonBoneNames,
} from "../retargetLibrary";
import { buildRetargetNameMap } from "../retargetMap";
import { asset, getCharacter, getWeapon } from "../assets";
import { WEAPONS, WEAPON_GRIPS } from "../arsenal";
import { mountWeaponModel, unmountWeapon, type MountedWeapon } from "../Weapons";
import { applyWeaponTuning, patchWeaponTuning, patchWeaponTierTuning } from "../weaponTuning";
import { resolveHitShape } from "../arsenal/holdStyle";
import { Controller } from "../Controller";
import { InputState } from "../input";
import { CHARACTER_HEIGHT_M, type CharacterDef, type Avatar, type WeaponGroup } from "../types";
import { loadControls, loadMouseFeel, subscribeMouseFeel } from "../controlsSettings";
import { GrudgeAvatar } from "../grudge/GrudgeAvatar";
import { getPreset } from "../grudge";
import { skillsForGroup, type PlaySkill } from "./playSkills";
import {
  deriveColliderVfxFrame,
  deriveSlashArcOrigin,
  deriveLaunchOrigin,
  deriveLandingZone,
  deriveTurretBase,
  METEOR_LANDING_DIST,
  SWORD_VOLLEY_LANDING_DIST,
} from "./colliderVfxFrame";
import type { PresetId, RaceId } from "../grudge";
import type { FireFxParams } from "../fxSettings";
import type { SlashFxParams } from "../slashSettings";
import type {
  BuildKind,
  ColliderShape,
  ColliderSpec,
  EditorContextMenu,
  EditorLayer,
  EditorNotice,
  EditorObjectSnapshot,
  EditorSnapshot,
  GizmoMode,
  NodeKind,
  PrimitiveKind,
  SceneDescriptor,
  SkillLabState,
} from "./types";

/** Internal Skill Lab authoring values (the editable subset of {@link SkillLabState}). */
type SkillLabConfig = {
  clipName: string | null;
  overdrive: number;
  mirror: boolean;
  armWidth: number;
  clipFrom: number;
  clipTo: number;
  vfxId: string;
  slashFromCollider: boolean;
  colliderX: number;
  colliderY: number;
  colliderZ: number;
  colliderRadius: number;
  showCollider: boolean;
};

/**
 * One editable entry in the unified hierarchy: the backing Object3D, its
 * metadata, its parent node id (null at the scene root), and an optional collider
 * wireframe. `object` is any Object3D — a primitive mesh, an imported group /
 * mesh / skinned mesh / bone, or the procedural rig root — so the same registry
 * drives the outliner, gizmo, and inspector for every node type.
 */
interface EditorObject {
  id: string;
  name: string;
  layerId: string;
  kind: NodeKind;
  object: THREE.Object3D;
  /** Parent node id, or null when the node sits directly under the scene. */
  parentId: string | null;
  /** True when the node came from an import or the rig (not editor-spawned). */
  imported: boolean;
  /**
   * Intrinsic visibility of the node, independent of its layer. Captured at
   * registration so the layer system can hide/show whole layers without
   * clobbering meshes that were deliberately hidden by their source (e.g. a
   * Grudge gear preset hides every non-equipped weapon/body mesh). Effective
   * visibility = baseVisible && layer.visible.
   */
  baseVisible: boolean;
  collider: ColliderSpec | null;
  helper: THREE.LineSegments | null;
}

const COLLIDER_COLOR = 0x46f08a;
const SELECT_COLOR = 0xffaa33;

/** Editor-spawned primitive/build kinds — the only nodes undo/redo re-creates. */
const PRIMITIVE_KINDS = new Set<PrimitiveKind>(["box", "sphere", "cylinder", "cone", "plane", "torus"]);

let uid = 0;
const nextId = (p: string) => `${p}_${++uid}`;

/** A captured per-object state in an undo/redo snapshot. */
interface HistObject {
  id: string;
  name: string;
  layerId: string;
  parentId: string | null;
  kind: NodeKind;
  imported: boolean;
  baseVisible: boolean;
  /** True for editor-spawned primitives/build meshes (structurally re-creatable). */
  managed: boolean;
  /** Live Object3D ref (kept alive across undo/redo so it can be re-added). */
  object: THREE.Object3D;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: THREE.Vector3;
  /** Flattened material colour (managed nodes only), or null. */
  color: number | null;
  collider: ColliderSpec | null;
}

/** One reversible editor state: object graph + layers + selection. */
interface HistoryState {
  objects: HistObject[];
  layers: EditorLayer[];
  selectedId: string | null;
  selectedIds: string[];
}

/** A per-object transform captured at the start of a gizmo drag (for group moves). */
interface DragXform {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: THREE.Vector3;
}

/**
 * Self-contained 3D scene editor engine. Mirrors the disposable-engine pattern
 * of `Studio` / `VoxelEditor`: React mounts it onto a container; it owns the
 * renderer, camera, orbit + transform gizmos, object registry, collider
 * visualisation, a VFX player, and an animation-library rig, and pushes
 * immutable `EditorSnapshot`s out via a callback. All public methods are safe to
 * call from React handlers.
 */
export class EditorScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private timer = new THREE.Timer();
  private orbit: OrbitControls;
  /** Live Invert-Y flag read by the wrapped OrbitControls vertical-rotate. */
  private orbitInvertY = false;
  /** Unsubscribe from live Mouse Sens / Invert Y changes; called on dispose. */
  private unsubscribeMouseFeel: () => void;
  private gizmo: TransformControls;
  private grid: THREE.GridHelper;
  private axes: THREE.AxesHelper;
  private raycaster = new THREE.Raycaster();
  private vfx: Vfx;
  /** Soft far-background art + animated translucent “ethereal falls” sheets. */
  private etherealBackdrop: THREE.Group | null = null;
  private etherealFalls: THREE.Mesh[] = [];

  // Postprocessing pipeline: RenderPass → OutlinePass (selection) → UnrealBloom
  // (toggle) → OutputPass. The loop renders through the composer, not directly.
  private composer: EffectComposer;
  private outlinePass: OutlinePass;
  private bloomPass: UnrealBloomPass;
  private bloom = false;
  /** True during async import/convert work so the UI can disable the File group. */
  private busy = false;
  /** Clips that rode in on imported models, with a mixer each, keyed by root node id. */
  private importedAnims = new Map<string, { mixer: THREE.AnimationMixer; clips: THREE.AnimationClip[] }>();
  // Mixamo clips auto-retargeted onto the procedural rig on import, keyed by a
  // synthetic source id. These play THROUGH the rig's own Animator (not a second
  // mixer bound to the rig root, which would fight the rig's skeleton), so the
  // wired animation drives the character you're actually dressing.
  private rigImportedAnims = new Map<string, { name: string; clips: THREE.AnimationClip[] }>();
  private rigImportedPlaying: string | null = null;
  private rigImportSeq = 0;
  /** The currently-playing imported action + its `${rootId}::${clip}` key, or null. */
  private importedAction: THREE.AnimationAction | null = null;
  private importedPlaying: string | null = null;

  private objects: EditorObject[] = [];
  private layers: EditorLayer[] = [
    { id: "default", name: "Default", color: 0x6ea8ff, visible: true },
  ];
  private selectedId: string | null = null;
  /** Full selection set (includes the primary `selectedId`). */
  private selectedIds = new Set<string>();

  // Undo/redo history: snapshots of the managed scene graph + layers + selection.
  private undoStack: HistoryState[] = [];
  private redoStack: HistoryState[] = [];
  private readonly historyCap = 80;
  /** While true, mutations skip pushing history (used during restore + batch ops). */
  private suppressHistory = false;
  /** Coalesce key + time so rapid slider/colour edits collapse into one undo step. */
  private lastPushKey = "";
  private lastPushTime = 0;

  // Group-move bookkeeping: per-object transforms captured at gizmo drag start so
  // the primary's delta can be mirrored onto the rest of a multi-selection.
  private gizmoDragStart: Map<string, DragXform> | null = null;
  private gizmoPrimaryStart: DragXform | null = null;

  // A pending right-click context-menu request handed to React via the snapshot.
  private contextMenu: EditorContextMenu | null = null;
  private ctxSeq = 0;

  private gizmoMode: GizmoMode = "translate";
  private snap = false;
  private showColliders = true;
  private showGrid = true;
  private draggingGizmo = false;

  // Fish-eye-on-occlusion camera assist: when a non-terrain mesh blocks the line
  // from the camera to the terrain, it widens the FOV so the terrain stays visible.
  // This is an environment-authoring assist that constantly pops the FOV when a
  // character stands in front of the orbit camera (it reads as the camera
  // "spazzing"), so it defaults OFF in the character-centric Dressing Room.
  private fishEye = false;
  private fishEyeActive = false;
  private readonly baseFov = 55;
  private readonly fishEyeFov = 102;
  private terrainLayerId: string | null = null;
  private fishRay = new THREE.Raycaster();
  private fishSample = new THREE.Vector3();
  private fishDir = new THREE.Vector3();
  private fishBox = new THREE.Box3();
  private fishCenter = new THREE.Vector3();

  // Structural "build" brushes: left-drag on the ground plane pulls out walls,
  // ramps, pillars, and slabs. Null = normal select/gizmo behaviour.
  private buildKind: BuildKind | null = null;
  private buildHeight = 3;
  private buildThickness = 0.3;
  private building = false;
  private buildStart = new THREE.Vector3();
  private previewMesh: THREE.Mesh | null = null;
  private previewMat = new THREE.MeshBasicMaterial({
    color: 0x8fd0ff,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly rampWidth = 2;

  // Animation-library rig (loaded on demand).
  private rig: ExplorerCharacter | null = null;
  private rigWeapon: string | null = null;
  private rigToken = 0;
  /** Registry id of the rig's root node, so it can be purged on unload/swap. */
  private rigRootId: string | null = null;

  // ── weapon arsenal library ────────────────────────────────────────────────
  /** The catalog weapon's live GLB mount on the rig's hands, or null. */
  private mountedWeapon: MountedWeapon | null = null;
  /** A cloned imported model mounted as a custom weapon, or null. */
  private customMount: { nodeId: string; object: THREE.Object3D } | null = null;
  /** Monotonic token guarding async (GLB) weapon mounts against stale loads. */
  private weaponToken = 0;
  /** Equipped weapon id: a catalog `WeaponId` or `custom:<nodeId>`, or null. */
  private equippedWeaponId: string | null = null;
  /** Selected tier index of the equipped weapon (data flavour only). */
  private equippedTier = 0;
  /** Imported model node ids promoted to equippable "custom" weapons. */
  private customWeaponIds = new Set<string>();
  /** Per-import placement overrides (uniform scale + grip pos/rot). */
  private customOverrides = new Map<
    string,
    { size: number; pos: [number, number, number]; rot: [number, number, number] }
  >();
  /** In-viewport bone/tip connection markers (lazily built). */
  private showMarkers = false;
  private markerGroup: THREE.Group | null = null;
  private showCollider = false;
  private colliderGroup: THREE.Group | null = null;
  private colliderMat: THREE.Material | null = null;
  private markerSocket: THREE.Mesh | null = null;
  private markerTip: THREE.Mesh | null = null;
  private markerLine: THREE.Line | null = null;
  private readonly _mkA = new THREE.Vector3();
  private readonly _mkB = new THREE.Vector3();
  private readonly _mkBox = new THREE.Box3();

  // Playground: grudge characters loaded from R2, keyed by their root-node id, and
  // a monotonic load token so an out-of-order async load disposes itself.
  private grudge = new Map<string, GrudgeAvatar>();
  private grudgeToken = 0;
  // Playground: catalog characters spawned to be DRIVEN (LED Monk, Racalvin, the
  // default Explorer, casters, GLB fighters…) — kept separate from `grudge`
  // because they're plain `Avatar`s (Character / ExplorerCharacter) that don't
  // implement the GrudgeAvatar-only Skill-Lab authoring API. Both maps feed the
  // Play-mode pick + the Playground character list.
  private catalogPlay = new Map<string, Avatar>();
  private catalogPlayToken = 0;
  // Play mode: a Controller drives one grudge avatar (3rd-person move + camera);
  // the render loop branches between editor (orbit) and play (controller) framing.
  private playing = false;
  private controller: Controller | null = null;
  private playInput: InputState | null = null;
  private playAvatar: GrudgeAvatar | null = null;
  /** Resolved weapon-skill kit for the current Play session (empty when idle). */
  private playSkills: PlaySkill[] = [];
  /** Per-skill cooldown end timestamps (performance.now() ms); absent = ready. */
  private skillReadyAt = new Map<string, number>();
  // The character the Controller is actually driving in Play mode. Usually the
  // selected Playground (grudge) character, but falls back to the dressed rig so
  // Play mode works on whatever is on the stand. Used for VFX origin/facing.
  private driven: Avatar | null = null;
  private playOrigin = new THREE.Vector3();
  // Playground "Skill Lab" authoring state, applied live to the skill-target
  // avatar (the driven Play-mode character, else the selected Playground one).
  private skillLab: SkillLabConfig = {
    clipName: null,
    overdrive: 1,
    mirror: false,
    armWidth: 0,
    clipFrom: 0,
    clipTo: 1,
    vfxId: "slashArc",
    slashFromCollider: false,
    colliderX: 0,
    colliderY: 0,
    colliderZ: 0,
    colliderRadius: 0.6,
    showCollider: true,
  };
  private skillColliderWorld = new THREE.Vector3();

  private onChange: (s: EditorSnapshot) => void;
  private raf = 0;
  private disposed = false;
  private emitAccum = 0;

  // Transient user-facing notice (e.g. why a blocked action no-opped). Carried on
  // every snapshot; the monotonic id lets React show + auto-dismiss each one once.
  private notice: EditorNotice | null = null;
  private noticeSeq = 0;

  // Click-vs-drag discrimination for selection picking.
  private downX = 0;
  private downY = 0;
  private downBtn = -1;

  constructor(container: HTMLElement, onChange: (s: EditorSnapshot) => void) {
    this.container = container;
    this.onChange = onChange;
    // Apply any persisted weapon placement tuning onto the shared catalog before
    // the first weapon mounts (idempotent; also runs from the combat Studio).
    applyWeaponTuning();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x101827);
    this.scene.fog = new THREE.Fog(0x121b2d, 34, 96);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 500);
    this.camera.position.set(8, 7, 10);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.target.set(0, 1, 0);
    // Honor the studio-wide Mouse Sens / Invert Y so inspecting a rig here feels
    // the same as the Danger Room / Voxel Editor cameras rather than a fixed
    // local speed. OrbitControls has no native vertical-invert, so we wrap its
    // internal `_rotateUp` (the vertical/polar drag) to flip the angle when
    // Invert Y is on — only the vertical axis inverts, the horizontal orbit is
    // untouched. The wrapper reads `this.orbitInvertY` each call so live changes
    // apply without rebuilding the controls.
    const feel = loadMouseFeel();
    this.orbit.rotateSpeed = feel.sensitivity;
    this.orbitInvertY = feel.invertY;
    const orbitInternal = this.orbit as unknown as { _rotateUp(angle: number): void };
    const baseRotateUp = orbitInternal._rotateUp.bind(this.orbit);
    orbitInternal._rotateUp = (angle: number) => baseRotateUp(this.orbitInvertY ? -angle : angle);
    // Apply Mouse Sens / Invert Y changes live so adjusting the slider/toggle
    // updates the orbit feel immediately, without leaving and re-entering the
    // Dressing Room.
    this.unsubscribeMouseFeel = subscribeMouseFeel((f) => {
      this.orbit.rotateSpeed = f.sensitivity;
      this.orbitInvertY = f.invertY;
    });

    this.grid = new THREE.GridHelper(60, 60, 0x33507a, 0x18233a);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.6;
    this.scene.add(this.grid);
    this.axes = new THREE.AxesHelper(2);
    this.scene.add(this.axes);

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setMode("translate");
    this.gizmo.addEventListener("dragging-changed", (e) => {
      const dragging = (e as unknown as { value: boolean }).value;
      this.draggingGizmo = dragging;
      this.orbit.enabled = !dragging;
      if (dragging) this.beginGizmoDrag();
      else this.endGizmoDrag();
    });
    this.gizmo.addEventListener("objectChange", () => this.onGizmoMove());
    // three r0.184: add the gizmo's helper, not the controls object itself.
    this.scene.add(this.gizmo.getHelper());

    this.vfx = new Vfx(this.scene);

    // Postprocessing: render → selection outline → optional bloom → output.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.outlinePass = new OutlinePass(new THREE.Vector2(1, 1), this.scene, this.camera);
    this.outlinePass.edgeStrength = 3.5;
    this.outlinePass.edgeGlow = 0.4;
    this.outlinePass.edgeThickness = 1.2;
    this.outlinePass.visibleEdgeColor.setHex(SELECT_COLOR);
    this.outlinePass.hiddenEdgeColor.setHex(0x20303f);
    this.composer.addPass(this.outlinePass);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.4, 0.85);
    this.bloomPass.enabled = this.bloom;
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.setupLights();
    this.setupEtherealBackdrop();

    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDownCapture, true);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("resize", this.onResize);

    this.resize();
    this.loop();
    this.emit();
  }

  private setupLights() {
    this.scene.add(new THREE.AmbientLight(0x7899d8, 0.78));
    this.scene.add(new THREE.HemisphereLight(0xc8ddff, 0x182033, 1.08));
    const key = new THREE.DirectionalLight(0xf4f8ff, 2.35);
    key.position.set(8, 16, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 60;
    const d = 20;
    key.shadow.camera.left = -d;
    key.shadow.camera.right = d;
    key.shadow.camera.top = d;
    key.shadow.camera.bottom = -d;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb8ff, 0.9);
    rim.position.set(-10, 8, -8);
    this.scene.add(rim);
    const lowFill = new THREE.DirectionalLight(0x74f2ff, 0.38);
    lowFill.position.set(-6, 3, 10);
    this.scene.add(lowFill);
  }

  /**
   * Far-stage Dressing Room visual: restored “ethereal falls” feel without
   * adding heavy geometry. A low-opacity room-scene image sits behind the grid,
   * while translucent vertical sheets drift downward like magical waterfalls.
   */
  private setupEtherealBackdrop() {
    const group = new THREE.Group();
    group.name = "Ethereal Falls Backdrop";
    group.position.set(0, 6.5, -25);
    this.etherealBackdrop = group;

    const tex = new THREE.TextureLoader().load(asset("rooms/dressing-scene.png"));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;

    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(38, 22),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    bg.name = "Dressing Room Scenic Backdrop";
    bg.renderOrder = -20;
    group.add(bg);

    // Subtle blue-violet glows that frame the avatar and imply distant water.
    const colors = [0x7dd3ff, 0xa78bfa, 0x67e8f9, 0xc4b5fd];
    const xs = [-11.5, -5.5, 5.5, 11.5];
    for (let i = 0; i < xs.length; ++i) {
      const mat = new THREE.MeshBasicMaterial({
        color: colors[i],
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 18, 1, 8), mat);
      fall.name = `Ethereal Fall ${i + 1}`;
      fall.position.set(xs[i], 0, 0.05 + i * 0.02);
      fall.userData.phase = i * 1.7;
      fall.userData.baseX = xs[i];
      fall.renderOrder = -10;
      this.etherealFalls.push(fall);
      group.add(fall);
    }

    // A faint ground reflection band so the stage reads lighter and less flat.
    const floorGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 8),
      new THREE.MeshBasicMaterial({
        color: 0x5eead4,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    floorGlow.name = "Ethereal Floor Glow";
    floorGlow.position.set(0, -9.4, 0.12);
    floorGlow.rotation.x = 0;
    floorGlow.renderOrder = -9;
    group.add(floorGlow);

    this.scene.add(group);
  }

  private updateEtherealBackdrop(dt: number) {
    void dt;
    if (!this.etherealBackdrop) return;
    const t = performance.now() * 0.001;
    this.etherealBackdrop.rotation.y = Math.sin(t * 0.08) * 0.035;
    for (let i = 0; i < this.etherealFalls.length; ++i) {
      const fall = this.etherealFalls[i];
      const phase = (fall.userData.phase as number) ?? 0;
      fall.position.y = Math.sin(t * 0.55 + phase) * 0.35;
      fall.position.x = ((fall.userData.baseX as number) ?? fall.position.x) + Math.sin(t * 0.22 + phase) * 0.18;
      const mat = fall.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.12 + Math.max(0, Math.sin(t * 0.85 + phase)) * 0.08;
      fall.scale.y = 1 + Math.sin(t * 0.35 + phase) * 0.06;
    }
  }

  // ── render loop ────────────────────────────────────────────────────────────

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    if (this.playing && this.controller) {
      // Play mode: the Controller owns movement + camera framing; skip orbit and
      // the fish-eye assist (the controller sets its own camera transform).
      this.controller.update(dt);
    } else {
      this.orbit.update();
      this.updateFishEye(dt);
    }
    this.vfx.update(dt);
    this.updateEtherealBackdrop(dt);
    this.rig?.update(dt);
    this.updateMarkers();
    for (const avatar of this.grudge.values()) avatar.update(dt);
    for (const avatar of this.catalogPlay.values()) avatar.update(dt);
    for (const a of this.importedAnims.values()) a.mixer.update(dt);
    this.composer.render();
    // Keep the inspector live while dragging the gizmo (throttled).
    if (this.draggingGizmo) {
      this.emitAccum += dt;
      if (this.emitAccum > 0.05) {
        this.emitAccum = 0;
        this.emit();
      }
    }
  };

  // ── object creation / registry ───────────────────────────────────────────

  private makePrimitiveGeo(kind: PrimitiveKind): THREE.BufferGeometry {
    switch (kind) {
      case "box":
        return new THREE.BoxGeometry(1, 1, 1);
      case "sphere":
        return new THREE.SphereGeometry(0.6, 32, 20);
      case "cylinder":
        return new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32);
      case "cone":
        return new THREE.ConeGeometry(0.6, 1.4, 32);
      case "plane": {
        const g = new THREE.PlaneGeometry(2, 2);
        g.rotateX(-Math.PI / 2);
        return g;
      }
      case "torus":
        return new THREE.TorusGeometry(0.6, 0.22, 20, 40);
    }
  }

  addPrimitive(kind: PrimitiveKind): void {
    this.pushHistory();
    const geo = this.makePrimitiveGeo(kind);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x8fb3ff,
      roughness: 0.55,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(0, kind === "plane" ? 0 : 0.8, 0);
    const count = this.objects.filter((o) => o.kind === kind).length + 1;
    const layer = this.layers[0];
    const obj: EditorObject = {
      id: nextId(kind),
      name: `${kind[0].toUpperCase()}${kind.slice(1)} ${count}`,
      layerId: layer.id,
      kind,
      object: mesh,
      parentId: null,
      imported: false,
      baseVisible: mesh.visible,
      collider: null,
      helper: null,
    };
    mesh.userData.objId = obj.id;
    this.scene.add(mesh);
    this.objects.push(obj);
    if (layer.defaultCollider) this.setColliderShape(obj, layer.defaultCollider);
    this.select(obj.id);
    this.emit();
  }

  private find(id: string | null): EditorObject | undefined {
    return id ? this.objects.find((o) => o.id === id) : undefined;
  }

  /**
   * True when `o` is part of the live rig subtree (root or any descendant bone /
   * skinned mesh). The rig owns its skeleton + GPU resources, so its internals
   * must not be deleted, reparented, or duplicated piecemeal.
   */
  private isRigNode(o: EditorObject): boolean {
    if (this.rigRootId === null) return false;
    let cur: EditorObject | undefined = o;
    while (cur) {
      if (cur.id === this.rigRootId) return true;
      cur = cur.parentId ? this.find(cur.parentId) : undefined;
    }
    return false;
  }

  /** A rig descendant (a bone / skinned mesh), i.e. a rig node that is not the root. */
  private isRigInternal(o: EditorObject): boolean {
    return this.isRigNode(o) && o.id !== this.rigRootId;
  }

  // ── selection + gizmo ──────────────────────────────────────────────────────

  select(id: string | null): void {
    this.selectedId = id;
    this.selectedIds = id ? new Set([id]) : new Set();
    this.refreshSelectionVisual();
    // When not driving a Play-mode avatar, the Skill Lab authors against the
    // selected grudge character — keep its live state in sync with the UI.
    if (!this.playAvatar) this.applySkillLab();
    this.emit();
  }

  /**
   * Toggle a node in/out of the multi-selection (shift / ctrl-click). The most
   * recently added node becomes the primary (gizmo + inspector target).
   */
  toggleSelect(id: string): void {
    if (!this.find(id)) return;
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
      if (this.selectedId === id) {
        const rest = [...this.selectedIds];
        this.selectedId = rest.length ? rest[rest.length - 1] : null;
      }
    } else {
      this.selectedIds.add(id);
      this.selectedId = id;
    }
    this.refreshSelectionVisual();
    this.emit();
  }

  /** Select every selectable root node (skips rig internals like bones). */
  selectAll(): void {
    const ids = this.objects
      .filter((o) => o.parentId === null && !this.isRigInternal(o))
      .map((o) => o.id);
    this.selectedIds = new Set(ids);
    this.selectedId = ids.length ? ids[ids.length - 1] : null;
    this.refreshSelectionVisual();
    this.emit();
  }

  /** Clear the selection (alias used by the menubar / context menu). */
  deselectAll(): void {
    this.select(null);
  }

  /** The active selection as a list (primary included), tolerant of an empty set. */
  private currentSelectionIds(): string[] {
    if (this.selectedIds.size > 0) return [...this.selectedIds];
    return this.selectedId ? [this.selectedId] : [];
  }

  /** Re-attach the gizmo to the primary and outline the whole selection set. */
  private refreshSelectionVisual(): void {
    const primary = this.find(this.selectedId);
    if (primary && !this.buildKind) this.gizmo.attach(primary.object);
    else this.gizmo.detach();
    const objs: THREE.Object3D[] = [];
    for (const id of this.selectedIds) {
      const o = this.find(id);
      if (o) objs.push(o.object);
    }
    this.outlinePass.selectedObjects = objs;
  }

  setGizmoMode(mode: GizmoMode): void {
    if (this.buildKind) this.setBuildKind(null);
    this.gizmoMode = mode;
    this.gizmo.setMode(mode);
    this.emit();
  }

  setSnap(on: boolean): void {
    this.snap = on;
    this.gizmo.setTranslationSnap(on ? 0.5 : null);
    this.gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
    this.gizmo.setScaleSnap(on ? 0.25 : null);
    this.emit();
  }

  /**
   * Capture a history step + per-object start transforms when a gizmo drag
   * begins, so the move is one undo step and a multi-selection moves together.
   */
  private beginGizmoDrag(): void {
    this.pushHistory();
    if (this.selectedIds.size <= 1) {
      this.gizmoDragStart = null;
      this.gizmoPrimaryStart = null;
      return;
    }
    const snap = (o: THREE.Object3D): DragXform => ({
      pos: o.position.clone(),
      quat: o.quaternion.clone(),
      scale: o.scale.clone(),
    });
    this.gizmoDragStart = new Map();
    for (const id of this.selectedIds) {
      const o = this.find(id);
      if (o) this.gizmoDragStart.set(id, snap(o.object));
    }
    const primary = this.find(this.selectedId);
    this.gizmoPrimaryStart = primary ? snap(primary.object) : null;
  }

  private endGizmoDrag(): void {
    this.gizmoDragStart = null;
    this.gizmoPrimaryStart = null;
  }

  /**
   * Mirror the primary's drag delta onto the rest of a multi-selection: translate
   * by the same offset, rotate by the same relative quaternion, scale by the same
   * ratio (each about its own origin). No-op for a single selection.
   */
  private onGizmoMove() {
    if (!this.gizmoDragStart || !this.gizmoPrimaryStart) return;
    const primary = this.find(this.selectedId);
    if (!primary) return;
    const start = this.gizmoPrimaryStart;
    if (this.gizmoMode === "translate") {
      const delta = primary.object.position.clone().sub(start.pos);
      for (const [id, s] of this.gizmoDragStart) {
        if (id === this.selectedId) continue;
        const o = this.find(id);
        if (o) o.object.position.copy(s.pos).add(delta);
      }
    } else if (this.gizmoMode === "scale") {
      const rx = primary.object.scale.x / (start.scale.x || 1e-4);
      const ry = primary.object.scale.y / (start.scale.y || 1e-4);
      const rz = primary.object.scale.z / (start.scale.z || 1e-4);
      for (const [id, s] of this.gizmoDragStart) {
        if (id === this.selectedId) continue;
        const o = this.find(id);
        if (o) o.object.scale.set(s.scale.x * rx, s.scale.y * ry, s.scale.z * rz);
      }
    } else {
      const dq = primary.object.quaternion.clone().multiply(start.quat.clone().invert());
      for (const [id, s] of this.gizmoDragStart) {
        if (id === this.selectedId) continue;
        const o = this.find(id);
        if (o) o.object.quaternion.copy(dq).multiply(s.quat);
      }
    }
  }

  // ── undo / redo history ────────────────────────────────────────────────────

  /**
   * Snapshot the reversible state. Editor-spawned primitives/build meshes are
   * "managed" (structurally re-creatable from their live Object3D ref), so the
   * history can add/remove/reparent them. Imported models / rig nodes are pinned:
   * only their transform/collider/name/layer ever get restored, never add/remove.
   */
  private captureState(): HistoryState {
    const objects: HistObject[] = this.objects.map((o) => {
      const managed = !o.imported && PRIMITIVE_KINDS.has(o.kind as PrimitiveKind);
      return {
        id: o.id,
        name: o.name,
        layerId: o.layerId,
        parentId: o.parentId,
        kind: o.kind,
        imported: o.imported,
        baseVisible: o.baseVisible,
        managed,
        object: o.object,
        pos: o.object.position.clone(),
        quat: o.object.quaternion.clone(),
        scale: o.object.scale.clone(),
        color: managed ? this.nodeColor(o) : null,
        collider: o.collider
          ? { shape: o.collider.shape, dims: { ...o.collider.dims }, offset: { ...o.collider.offset } }
          : null,
      };
    });
    return {
      objects,
      layers: this.layers.map((l) => ({ ...l })),
      selectedId: this.selectedId,
      selectedIds: [...this.selectedIds],
    };
  }

  /**
   * Push the current state onto the undo stack (clearing redo). A non-empty
   * `key` coalesces rapid same-key edits (slider drags, colour picks) within a
   * short window into a single undo step, so a drag isn't 100 tiny steps.
   */
  private pushHistory(key = ""): void {
    if (this.suppressHistory) return;
    const now = performance.now();
    if (key && key === this.lastPushKey && now - this.lastPushTime < 600) {
      this.lastPushTime = now;
      return;
    }
    this.lastPushKey = key;
    this.lastPushTime = now;
    this.undoStack.push(this.captureState());
    if (this.undoStack.length > this.historyCap) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Restore a captured state, reconciling the live scene graph against it. */
  private restoreState(state: HistoryState): void {
    this.suppressHistory = true;
    const target = new Map(state.objects.map((h) => [h.id, h]));
    const current = new Map(this.objects.map((o) => [o.id, o]));

    // 1. Remove managed objects present now but absent in the target (keep their
    //    Object3D alive on the history stack so the inverse op can re-add them).
    for (const o of [...this.objects]) {
      if (target.has(o.id)) continue;
      const managed = !o.imported && PRIMITIVE_KINDS.has(o.kind as PrimitiveKind);
      if (!managed) continue;
      if (o.helper) {
        o.object.remove(o.helper);
        o.helper.geometry.dispose();
        (o.helper.material as THREE.Material).dispose();
        o.helper = null;
      }
      o.object.parent?.remove(o.object);
      this.objects = this.objects.filter((x) => x.id !== o.id);
      current.delete(o.id);
    }

    // 2. Re-add managed objects in the target that are missing now.
    for (const h of state.objects) {
      if (current.has(h.id) || !h.managed) continue;
      const obj: EditorObject = {
        id: h.id,
        name: h.name,
        layerId: h.layerId,
        kind: h.kind,
        object: h.object,
        parentId: h.parentId,
        imported: h.imported,
        baseVisible: h.baseVisible,
        collider: null,
        helper: null,
      };
      h.object.userData.objId = h.id;
      this.objects.push(obj);
      current.set(h.id, obj);
    }

    // 3. Re-parent managed nodes + restore mutable props for every node present.
    for (const h of state.objects) {
      const o = current.get(h.id);
      if (!o) continue;
      if (h.managed) {
        const parentObj = (h.parentId ? current.get(h.parentId)?.object : null) ?? this.scene;
        if (o.object.parent !== parentObj) parentObj.add(o.object);
        o.parentId = h.parentId;
      }
      o.object.position.copy(h.pos);
      o.object.quaternion.copy(h.quat);
      o.object.scale.copy(h.scale);
      o.name = h.name;
      o.layerId = h.layerId;
      o.baseVisible = h.baseVisible;
      if (h.managed && h.color !== null) this.applyColorTo(o.object, h.color);
      if (h.collider) {
        o.collider = { shape: h.collider.shape, dims: { ...h.collider.dims }, offset: { ...h.collider.offset } };
        this.rebuildHelper(o);
      } else if (o.collider) {
        o.collider = null;
        this.rebuildHelper(o);
      }
    }

    this.layers = state.layers.map((l) => ({ ...l }));
    this.selectedId = state.selectedId && current.has(state.selectedId) ? state.selectedId : null;
    this.selectedIds = new Set(state.selectedIds.filter((id) => current.has(id)));
    this.applyLayerVisibility();
    this.refreshSelectionVisual();
    this.suppressHistory = false;
  }

  undo(): void {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this.captureState());
    this.restoreState(this.undoStack.pop()!);
    this.lastPushKey = "";
    this.emit();
  }

  redo(): void {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(this.captureState());
    this.restoreState(this.redoStack.pop()!);
    this.lastPushKey = "";
    this.emit();
  }

  // ── right-click context menu ───────────────────────────────────────────────

  /** Raycast under the cursor and return the hit node id, or null for empty space. */
  private pickAt(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const roots = this.objects
      .filter((o) => o.parentId === null && o.object.visible)
      .map((o) => o.object);
    const hits = this.raycaster.intersectObjects(roots, true);
    return hits.length > 0 ? this.resolveObjId(hits[0].object) : null;
  }

  private openContextMenu(clientX: number, clientY: number, targetId: string | null): void {
    const target = this.find(targetId);
    this.contextMenu = {
      id: ++this.ctxSeq,
      x: clientX,
      y: clientY,
      targetId,
      targetName: target ? target.name : null,
    };
    this.emit();
  }

  closeContextMenu(): void {
    if (!this.contextMenu) return;
    this.contextMenu = null;
    this.emit();
  }

  // ── fish-eye on occlusion ──────────────────────────────────────────────────

  setFishEye(on: boolean): void {
    this.fishEye = on;
    this.emit();
  }

  /** Mark a layer as the protected "terrain"; null falls back to the ground plane. */
  setTerrainLayer(id: string | null): void {
    this.terrainLayerId = id;
    this.emit();
  }

  private isTerrainObject(o: EditorObject): boolean {
    return this.terrainLayerId !== null && o.layerId === this.terrainLayerId;
  }

  /** The point the camera wants to keep in view: nearest terrain object, else ground. */
  private terrainPoint(): THREE.Vector3 {
    if (this.terrainLayerId) {
      let bestD = Infinity;
      let found = false;
      for (const o of this.objects) {
        if (o.layerId !== this.terrainLayerId || !o.object.visible) continue;
        this.fishBox.setFromObject(o.object).getCenter(this.fishCenter);
        const d = this.fishCenter.distanceToSquared(this.camera.position);
        if (d < bestD) {
          bestD = d;
          this.fishSample.copy(this.fishCenter);
          found = true;
        }
      }
      if (found) return this.fishSample;
    }
    // Ground plane (y=0, where the grid lives) under the orbit target.
    return this.fishSample.set(this.orbit.target.x, 0, this.orbit.target.z);
  }

  /** Widen toward a fish-eye FOV while a non-terrain mesh blocks the terrain. */
  private updateFishEye(dt: number): void {
    let occluded = false;
    if (this.fishEye) {
      const target = this.terrainPoint();
      const origin = this.camera.position;
      this.fishDir.copy(target).sub(origin);
      const dist = this.fishDir.length();
      const far = dist - 0.1;
      if (far > 0.01) {
        this.fishDir.normalize();
        this.fishRay.set(origin, this.fishDir);
        this.fishRay.near = 0;
        this.fishRay.far = far;
        const roots = this.objects
          .filter((o) => o.parentId === null && o.object.visible && !this.isTerrainObject(o))
          .map((o) => o.object);
        occluded = this.fishRay.intersectObjects(roots, true).length > 0;
      }
    }

    const targetFov = occluded ? this.fishEyeFov : this.baseFov;
    const next = THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt);
    if (Math.abs(next - this.camera.fov) > 0.02) {
      this.camera.fov = next;
      this.camera.updateProjectionMatrix();
    }

    if (occluded !== this.fishEyeActive) {
      this.fishEyeActive = occluded;
      this.emit();
    }
  }

  // ── picking ────────────────────────────────────────────────────────────────

  /**
   * Capture-phase gate (runs before OrbitControls' own pointerdown) that decides
   * whether the orbit camera may engage for this press. With a build brush active,
   * only the middle button or Alt+LMB orbit; plain LMB stays free to click-select
   * and RMB is reserved for drawing the structure.
   */
  private onPointerDownCapture = (e: PointerEvent) => {
    if (this.playing) return;
    if (this.draggingGizmo) {
      this.orbit.enabled = false;
      return;
    }
    if (!this.buildKind) {
      this.orbit.enabled = true;
      return;
    }
    const orbitAllowed = e.button === 1 || (e.button === 0 && e.altKey);
    this.orbit.enabled = orbitAllowed;
  };

  /**
   * Suppress the browser context menu over the canvas while editing so RMB can
   * drag-build and our own right-click menu can take over (left native in Play).
   */
  private onContextMenu = (e: MouseEvent) => {
    if (!this.playing) e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.playing) return;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.downBtn = e.button;
    // In build mode, holding RMB locks the first cell and pulls out a structure.
    if (this.buildKind && e.button === 2 && !this.draggingGizmo) {
      const p = this.groundPoint(e);
      if (p) {
        this.building = true;
        this.buildStart.copy(p);
        this.updatePreview(p);
        // Capture so the release always lands on us even if it happens off-canvas.
        try {
          this.renderer.domElement.setPointerCapture(e.pointerId);
        } catch {
          /* capture is best-effort */
        }
      }
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.building) return;
    const p = this.groundPoint(e);
    if (p) this.updatePreview(p);
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.playing) return;
    // Restore orbit availability for the next interaction (wheel zoom, MMB, …).
    if (e.button === this.downBtn) this.orbit.enabled = !this.draggingGizmo;
    if (this.building && e.button === 2) {
      this.building = false;
      try {
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
      const end = this.groundPoint(e);
      this.clearPreview();
      this.commitBuild(this.buildStart, end ?? this.buildStart);
      return;
    }
    // RMB click (no drag) outside build mode → open the context menu. If the
    // node under the cursor isn't already selected, select it first so the menu
    // acts on what was clicked.
    if (this.downBtn === 2 && e.button === 2 && !this.buildKind && !this.draggingGizmo) {
      const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
      if (moved <= 5) {
        const hitId = this.pickAt(e.clientX, e.clientY);
        if (hitId && !this.selectedIds.has(hitId)) this.select(hitId);
        this.openContextMenu(e.clientX, e.clientY, hitId);
      }
      return;
    }
    if (this.downBtn !== 0 || e.button !== 0) return;
    if (this.draggingGizmo) return;
    // A plain LMB that orbited (Alt held) shouldn't also select.
    if (e.altKey) return;
    const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
    if (moved > 5) return; // an orbit drag, not a click
    const hitId = this.pickAt(e.clientX, e.clientY);
    // Shift / Ctrl / Cmd-click toggles the node in the multi-selection.
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && hitId) this.toggleSelect(hitId);
    else this.select(hitId);
  };

  /** Walk an Object3D up its parent chain to the nearest registered node id. */
  private resolveObjId(o: THREE.Object3D | null): string | null {
    let n: THREE.Object3D | null = o;
    while (n) {
      const id = n.userData.objId as string | undefined;
      if (id && this.find(id)) return id;
      n = n.parent;
    }
    return null;
  }

  // ── structural build brushes ────────────────────────────────────────────────

  /** Toggle a build brush; null restores the normal orbit/select tools. */
  setBuildKind(kind: BuildKind | null): void {
    this.cancelBuild(); // clear any in-progress drag/preview before switching tools
    this.buildKind = kind;
    if (kind) {
      // RMB now draws the structure (hold + pull), so it must not orbit. Orbiting
      // moves to the middle button; Alt+LMB is gated to orbit in the capture
      // handler. Plain LMB stays free to click-select.
      this.orbit.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.ROTATE,
        RIGHT: null,
      };
      this.gizmo.detach();
    } else {
      this.orbit.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
      this.orbit.enabled = !this.draggingGizmo;
      this.cancelBuild();
      const o = this.find(this.selectedId);
      if (o) this.gizmo.attach(o.object);
    }
    this.emit();
  }

  setBuildHeight(h: number): void {
    this.buildHeight = Math.max(0.1, h);
    this.emit();
  }

  setBuildThickness(t: number): void {
    this.buildThickness = Math.max(0.05, t);
    this.emit();
  }

  private cancelBuild(): void {
    this.building = false;
    this.clearPreview();
  }

  /** Ray-cast the pointer onto the y=0 ground plane (snapped when Snap is on). */
  private groundPoint(e: PointerEvent): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const out = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, out)) return null;
    if (this.snap) {
      out.x = Math.round(out.x / 0.5) * 0.5;
      out.z = Math.round(out.z / 0.5) * 0.5;
    }
    return out;
  }

  /** Resolve the geometry + placement for the current build brush from two ground points. */
  private buildSpec(s: THREE.Vector3, e: THREE.Vector3) {
    const kind = this.buildKind!;
    const H = this.buildHeight;
    const T = this.buildThickness;
    const dx = e.x - s.x;
    const dz = e.z - s.z;
    const dist = Math.hypot(dx, dz);
    const tiny = dist < 0.25;
    const midx = (s.x + e.x) / 2;
    const midz = (s.z + e.z) / 2;
    const yaw = Math.atan2(dx, dz);

    if (kind === "wall") {
      const len = tiny ? 3 : Math.max(0.5, dist);
      return {
        geo: new THREE.BoxGeometry(T, H, len),
        pos: new THREE.Vector3(tiny ? s.x : midx, H / 2, tiny ? s.z : midz),
        rotY: tiny ? 0 : yaw,
        label: "Wall",
      };
    }
    if (kind === "ramp") {
      const len = tiny ? 3 : Math.max(0.5, dist);
      return {
        geo: this.makeWedgeGeo(len, this.rampWidth, H),
        pos: new THREE.Vector3(tiny ? s.x : midx, 0, tiny ? s.z : midz),
        rotY: tiny ? 0 : yaw,
        label: "Ramp",
      };
    }
    if (kind === "stairs") {
      const len = tiny ? 3 : Math.max(0.5, dist);
      return {
        geo: this.makeStairsGeo(len, this.rampWidth, H),
        pos: new THREE.Vector3(tiny ? s.x : midx, 0, tiny ? s.z : midz),
        rotY: tiny ? 0 : yaw,
        label: "Stairs",
      };
    }
    // slab / pillar — rectangular footprint between the two corners.
    const w = tiny ? (kind === "slab" ? 3 : 0.6) : Math.max(0.4, Math.abs(dx));
    const d = tiny ? (kind === "slab" ? 3 : 0.6) : Math.max(0.4, Math.abs(dz));
    if (kind === "slab") {
      return {
        geo: new THREE.BoxGeometry(w, T, d),
        pos: new THREE.Vector3(midx, T / 2, midz),
        rotY: 0,
        label: "Slab",
      };
    }
    return {
      geo: new THREE.BoxGeometry(w, H, d),
      pos: new THREE.Vector3(midx, H / 2, midz),
      rotY: 0,
      label: "Pillar",
    };
  }

  private updatePreview(end: THREE.Vector3): void {
    if (!this.buildKind) return;
    const { geo, pos, rotY } = this.buildSpec(this.buildStart, end);
    if (!this.previewMesh) {
      this.previewMesh = new THREE.Mesh(geo, this.previewMat);
      this.previewMesh.renderOrder = 999;
      this.scene.add(this.previewMesh);
    } else {
      this.previewMesh.geometry.dispose();
      this.previewMesh.geometry = geo;
    }
    this.previewMesh.position.copy(pos);
    this.previewMesh.rotation.set(0, rotY, 0);
    this.previewMesh.visible = true;
  }

  private clearPreview(): void {
    if (!this.previewMesh) return;
    this.previewMesh.visible = false;
    this.previewMesh.geometry.dispose();
    this.previewMesh.geometry = new THREE.BufferGeometry();
  }

  private commitBuild(s: THREE.Vector3, e: THREE.Vector3): void {
    if (!this.buildKind) return;
    this.pushHistory();
    const { geo, pos, rotY, label } = this.buildSpec(s, e);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8fb3ff, roughness: 0.55, metalness: 0.1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(pos);
    mesh.rotation.y = rotY;
    const count = this.objects.filter((o) => o.name.startsWith(label)).length + 1;
    const layer = this.layers[0];
    const obj: EditorObject = {
      id: nextId(label.toLowerCase()),
      name: `${label} ${count}`,
      layerId: layer.id,
      kind: "box",
      object: mesh,
      parentId: null,
      imported: false,
      baseVisible: mesh.visible,
      collider: null,
      helper: null,
    };
    mesh.userData.objId = obj.id;
    this.scene.add(mesh);
    this.objects.push(obj);
    if (layer.defaultCollider) this.setColliderShape(obj, layer.defaultCollider);
    this.select(obj.id);
    this.emit();
  }

  /** A right-triangular prism (base at y=0) rising along +Z; flat-shaded. */
  private makeWedgeGeo(length: number, width: number, height: number): THREE.BufferGeometry {
    const w = width / 2;
    const l = length / 2;
    const h = height;
    // A0 A1 B0 B1 C0 C1
    const v = [
      -w, 0, -l, // 0 A0
      w, 0, -l, // 1 A1
      -w, 0, l, // 2 B0
      w, 0, l, // 3 B1
      -w, h, l, // 4 C0
      w, h, l, // 5 C1
    ];
    const idx = [
      0, 1, 3, 0, 3, 2, // bottom
      2, 3, 5, 2, 5, 4, // back (vertical)
      0, 5, 1, 0, 4, 5, // slope
      0, 2, 4, // left side
      1, 5, 3, // right side
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    geo.setIndex(idx);
    const flat = geo.toNonIndexed();
    geo.dispose();
    flat.computeVertexNormals();
    return flat;
  }

  /**
   * A staircase climbing along local +Z, centred on the run (so it drops in like
   * the ramp). Built from per-step boxes merged into one flat-shaded geometry;
   * step count scales with the run length, total rise = `height`.
   */
  private makeStairsGeo(length: number, width: number, height: number): THREE.BufferGeometry {
    const steps = Math.max(2, Math.min(40, Math.round(length / 0.4)));
    const depth = length / steps;
    const rise = height / steps;
    const w = width;
    const boxes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < steps; i++) {
      const h = rise * (i + 1);
      const box = new THREE.BoxGeometry(w, h, depth);
      // Local origin at run centre: span Z in [-length/2, length/2].
      box.translate(0, h / 2, -length / 2 + depth * (i + 0.5));
      boxes.push(box);
    }
    const merged = mergeGeometries(boxes, false);
    boxes.forEach((b) => b.dispose());
    if (!merged) return new THREE.BoxGeometry(w, height, length);
    const flat = merged.toNonIndexed();
    merged.dispose();
    flat.computeVertexNormals();
    return flat;
  }

  // ── per-object editing (from the inspector) ────────────────────────────────

  rename(id: string, name: string): void {
    const o = this.find(id);
    if (o) o.name = name;
    this.emit();
  }

  setObjectLayer(id: string, layerId: string): void {
    const o = this.find(id);
    if (!o) return;
    this.pushHistory();
    o.layerId = layerId;
    this.applyLayerVisibility();
    this.emit();
  }

  /** Assign every selected node to `layerId` in one undo step. */
  setSelectionLayer(layerId: string): void {
    const ids = this.currentSelectionIds();
    if (ids.length === 0) return;
    this.pushHistory();
    for (const id of ids) {
      const o = this.find(id);
      if (o) o.layerId = layerId;
    }
    this.applyLayerVisibility();
    this.emit();
  }

  /** Flatten a hex colour onto every material in an Object3D subtree. */
  private applyColorTo(root: THREE.Object3D, color: number): void {
    root.traverse((n) => {
      const mat = (n as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const apply = (m: THREE.Material) => {
        const c = (m as THREE.MeshStandardMaterial).color;
        if (c) c.setHex(color);
      };
      if (Array.isArray(mat)) mat.forEach(apply);
      else if (mat) apply(mat);
    });
  }

  setObjectColor(id: string, color: number): void {
    const o = this.find(id);
    if (o) {
      this.pushHistory(`color:${id}`);
      this.applyColorTo(o.object, color);
    }
    this.emit();
  }

  setTransform(
    id: string,
    t: { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] },
  ): void {
    const o = this.find(id);
    if (!o) return;
    this.pushHistory(`xform:${id}`);
    if (t.position) o.object.position.set(...t.position);
    if (t.rotation)
      o.object.rotation.set(
        THREE.MathUtils.degToRad(t.rotation[0]),
        THREE.MathUtils.degToRad(t.rotation[1]),
        THREE.MathUtils.degToRad(t.rotation[2]),
      );
    if (t.scale) o.object.scale.set(Math.max(0.01, t.scale[0]), Math.max(0.01, t.scale[1]), Math.max(0.01, t.scale[2]));
    this.emit();
  }

  duplicateSelected(): void {
    const ids = this.currentSelectionIds();
    if (ids.length === 0) return;
    this.pushHistory();
    this.suppressHistory = true;
    const newIds: string[] = [];
    for (const id of ids) {
      const nid = this.duplicateOne(id);
      if (nid) newIds.push(nid);
    }
    this.suppressHistory = false;
    if (newIds.length) {
      this.selectedIds = new Set(newIds);
      this.selectedId = newIds[newIds.length - 1];
      this.refreshSelectionVisual();
    }
    this.emit();
  }

  /** Deep-clone one node's subtree and register it; returns the new root id or null. */
  private duplicateOne(id: string): string | null {
    const o = this.find(id);
    // The rig (and its bones/skinned meshes) is a singleton owned by the rig;
    // don't duplicate it or any of its internals piecemeal.
    if (!o || this.isRigNode(o)) return null;
    // Detach the collider helper so the deep clone doesn't copy it, then restore.
    const helper = o.helper;
    if (helper) o.object.remove(helper);
    // Skinned subtrees need SkeletonUtils.clone so bones rebind to the cloned
    // skeleton; a plain clone(true) leaves the copy bound to the source skeleton.
    let skinned = false;
    o.object.traverse((n) => {
      if ((n as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
    });
    const clone = skinned ? cloneSkinned(o.object) : o.object.clone(true);
    if (helper) o.object.add(helper);
    // Deep-clone materials so colour edits on the copy don't bleed into the source,
    // and strip stale objIds copied from the original subtree.
    clone.traverse((n) => {
      const m = n as THREE.Mesh;
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) m.material = mat.map((x) => x.clone());
      else if (mat) m.material = mat.clone();
      delete n.userData.objId;
    });
    clone.position.x += 1.2;
    const parent = (o.parentId ? this.find(o.parentId)?.object : null) ?? this.scene;
    parent.add(clone);
    const rootId = this.registerSubtree(clone, {
      kind: o.kind,
      imported: o.imported,
      parentId: o.parentId,
      layerId: o.layerId,
      baseName: `${o.name} copy`,
    });
    const copy = this.find(rootId);
    if (copy && o.collider) {
      copy.collider = { shape: o.collider.shape, dims: { ...o.collider.dims }, offset: { ...o.collider.offset } };
      this.rebuildHelper(copy);
    }
    return rootId;
  }

  deleteSelected(): void {
    const ids = this.currentSelectionIds();
    if (ids.length === 0) return;
    this.pushHistory();
    this.suppressHistory = true;
    for (const id of ids) {
      const o = this.find(id);
      // Deleting a rig bone / skinned mesh would corrupt the live skeleton; only the
      // rig root may be removed (which tears down the whole rig via unloadRig).
      if (!o || this.isRigInternal(o)) continue;
      this.removeObject(o);
    }
    this.suppressHistory = false;
    this.select(null);
    this.emit();
  }

  /** All node ids in the subtree rooted at `id` (inclusive), via the parentId graph. */
  private subtreeIds(id: string): Set<string> {
    const out = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const o of this.objects) {
        if (o.parentId && out.has(o.parentId) && !out.has(o.id)) {
          out.add(o.id);
          changed = true;
        }
      }
    }
    return out;
  }

  /** Dispose the geometry + materials of every mesh/line in an owned Object3D graph. */
  private disposeObject3D(root: THREE.Object3D): void {
    root.traverse((n) => {
      const m = n as THREE.Mesh & THREE.LineSegments;
      if (!m.isMesh && !m.isLineSegments) return;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x?.dispose?.());
      else mat?.dispose?.();
    });
  }

  private removeObject(o: EditorObject) {
    // The rig owns its own GPU resources; deleting its root tears the rig down.
    if (o.kind === "rig") {
      this.unloadRig();
      return;
    }
    // A spawned playground character (grudge race OR driven catalog character)
    // owns its own GPU resources + mixer.
    if (this.grudge.has(o.id) || this.catalogPlay.has(o.id)) {
      this.unloadGrudge(o.id);
      return;
    }
    const ids = this.subtreeIds(o.id);
    // Dispose collider helpers across the whole removed subtree.
    for (const n of this.objects) {
      if (!ids.has(n.id) || !n.helper) continue;
      n.object.remove(n.helper);
      n.helper.geometry.dispose();
      (n.helper.material as THREE.Material).dispose();
      n.helper = null;
    }
    // Tear down any imported-clip mixers anchored in the removed subtree.
    for (const id of ids) {
      const entry = this.importedAnims.get(id);
      if (!entry) continue;
      entry.mixer.stopAllAction();
      if (this.importedPlaying?.startsWith(`${id}::`)) {
        this.importedPlaying = null;
        this.importedAction = null;
      }
      this.importedAnims.delete(id);
    }
    o.object.parent?.remove(o.object);
    this.disposeObject3D(o.object);
    this.objects = this.objects.filter((x) => !ids.has(x.id));
    if (this.selectedId && ids.has(this.selectedId)) this.selectedId = null;
  }

  focusSelected(): void {
    const o = this.find(this.selectedId);
    if (!o) return;
    const c = new THREE.Vector3();
    new THREE.Box3().setFromObject(o.object).getCenter(c);
    this.orbit.target.copy(c);
  }

  // ── colliders ──────────────────────────────────────────────────────────────

  private defaultColliderDims(o: EditorObject): { x: number; y: number; z: number } {
    const box = new THREE.Box3().setFromObject(o.object);
    const size = new THREE.Vector3();
    box.getSize(size);
    const s = o.object.scale;
    // Divide out object scale so dims live in the object's local space.
    return {
      x: Math.max(0.05, size.x / Math.max(0.001, s.x)),
      y: Math.max(0.05, size.y / Math.max(0.001, s.y)),
      z: Math.max(0.05, size.z / Math.max(0.001, s.z)),
    };
  }

  /** Attach a fitted collider of `shape` to `o` (no history/emit — internal). */
  private setColliderShape(o: EditorObject, shape: ColliderShape): void {
    const d = this.defaultColliderDims(o);
    const radius = Math.max(d.x, d.z) / 2;
    o.collider =
      shape === "box"
        ? { shape, dims: d, offset: { x: 0, y: 0, z: 0 } }
        : shape === "sphere"
          ? { shape, dims: { x: Math.max(radius, d.y / 2), y: 0, z: 0 }, offset: { x: 0, y: 0, z: 0 } }
          : { shape, dims: { x: radius, y: d.y, z: 0 }, offset: { x: 0, y: 0, z: 0 } };
    this.rebuildHelper(o);
  }

  addCollider(id: string, shape: ColliderShape): void {
    const o = this.find(id);
    if (!o) return;
    this.pushHistory();
    this.setColliderShape(o, shape);
    this.emit();
  }

  /** Attach `shape` to every object in the current selection (one undo step). */
  addColliderToSelection(shape: ColliderShape): void {
    const ids = this.currentSelectionIds();
    if (ids.length === 0) return;
    this.pushHistory();
    for (const id of ids) {
      const o = this.find(id);
      if (o && !this.isRigInternal(o)) this.setColliderShape(o, shape);
    }
    this.emit();
  }

  removeCollider(id: string): void {
    const o = this.find(id);
    if (!o || !o.helper) {
      if (o) o.collider = null;
      this.emit();
      return;
    }
    this.pushHistory();
    o.object.remove(o.helper);
    o.helper.geometry.dispose();
    (o.helper.material as THREE.Material).dispose();
    o.helper = null;
    o.collider = null;
    this.emit();
  }

  setColliderSpec(id: string, patch: Partial<ColliderSpec>): void {
    const o = this.find(id);
    if (!o || !o.collider) return;
    this.pushHistory(`collider:${id}`);
    if (patch.shape) o.collider.shape = patch.shape;
    if (patch.dims) o.collider.dims = { ...o.collider.dims, ...patch.dims };
    if (patch.offset) o.collider.offset = { ...o.collider.offset, ...patch.offset };
    this.rebuildHelper(o);
    this.emit();
  }

  fitCollider(id: string): void {
    const o = this.find(id);
    if (!o || !o.collider) return;
    this.pushHistory();
    const d = this.defaultColliderDims(o);
    if (o.collider.shape === "box") o.collider.dims = d;
    else if (o.collider.shape === "sphere") o.collider.dims = { x: Math.max(d.x, d.y, d.z) / 2, y: 0, z: 0 };
    else o.collider.dims = { x: Math.max(d.x, d.z) / 2, y: d.y, z: 0 };
    o.collider.offset = { x: 0, y: 0, z: 0 };
    this.rebuildHelper(o);
    this.emit();
  }

  private colliderGeo(spec: ColliderSpec): THREE.BufferGeometry {
    const { shape, dims } = spec;
    switch (shape) {
      case "box":
        return new THREE.BoxGeometry(dims.x, dims.y, dims.z);
      case "sphere":
        return new THREE.SphereGeometry(Math.max(0.02, dims.x), 16, 12);
      case "capsule":
        return new THREE.CapsuleGeometry(Math.max(0.02, dims.x), Math.max(0.02, dims.y - 2 * dims.x), 6, 16);
      case "cylinder":
        return new THREE.CylinderGeometry(Math.max(0.02, dims.x), Math.max(0.02, dims.x), Math.max(0.02, dims.y), 20);
    }
  }

  private rebuildHelper(o: EditorObject) {
    if (o.helper) {
      o.object.remove(o.helper);
      o.helper.geometry.dispose();
      (o.helper.material as THREE.Material).dispose();
      o.helper = null;
    }
    if (!o.collider) return;
    const wire = new THREE.WireframeGeometry(this.colliderGeo(o.collider));
    const mat = new THREE.LineBasicMaterial({
      color: COLLIDER_COLOR,
      transparent: true,
      opacity: 0.85,
      depthTest: true,
    });
    const helper = new THREE.LineSegments(wire, mat);
    helper.position.set(o.collider.offset.x, o.collider.offset.y, o.collider.offset.z);
    helper.visible = this.showColliders;
    helper.userData.isColliderHelper = true;
    o.object.add(helper);
    o.helper = helper;
  }

  toggleColliders(on: boolean): void {
    this.showColliders = on;
    for (const o of this.objects) if (o.helper) o.helper.visible = on;
    this.emit();
  }

  toggleGrid(on: boolean): void {
    this.showGrid = on;
    this.grid.visible = on;
    this.emit();
  }

  // ── layers ─────────────────────────────────────────────────────────────────

  private applyLayerVisibility() {
    for (const o of this.objects) {
      const layer = this.layers.find((l) => l.id === o.layerId);
      const layerVisible = layer ? layer.visible : true;
      o.object.visible = layerVisible && o.baseVisible;
    }
  }

  /**
   * Toggle a single node's intrinsic visibility from the outliner eye. The base
   * flag is what the eye persists (mirroring registration/import time); effective
   * visibility still respects the node's layer, so a hidden layer keeps it hidden.
   */
  setObjectVisible(id: string, visible: boolean): void {
    const o = this.find(id);
    if (!o) return;
    o.baseVisible = visible;
    const layer = this.layers.find((l) => l.id === o.layerId);
    o.object.visible = (layer ? layer.visible : true) && visible;
    this.emit();
  }

  /** Flip the primary selection's visibility (the `H` hotkey). */
  toggleSelectedVisibility(): void {
    const o = this.find(this.selectedId);
    if (o) this.setObjectVisible(o.id, !o.baseVisible);
  }

  addLayer(name: string): void {
    this.pushHistory();
    const palette = [0x6ea8ff, 0xff8a5c, 0x6fe0a0, 0xc89bff, 0xffd166, 0xff6f9c];
    const color = palette[this.layers.length % palette.length];
    this.layers.push({ id: nextId("layer"), name: name || `Layer ${this.layers.length + 1}`, color, visible: true, defaultCollider: null });
    this.emit();
  }

  /** Set (or clear, with null) the collider auto-attached to a layer's new objects. */
  setLayerDefaultCollider(id: string, shape: ColliderShape | null): void {
    const l = this.layers.find((x) => x.id === id);
    if (!l) return;
    l.defaultCollider = shape;
    this.emit();
  }

  /**
   * Apply a layer's default collider to every object already in that layer (one
   * undo step). No-op with a notice when the layer has no default set.
   */
  applyLayerColliderDefault(id: string): void {
    const l = this.layers.find((x) => x.id === id);
    if (!l) return;
    if (!l.defaultCollider) {
      this.notify("Set a default collider on this layer first.", "warn");
      return;
    }
    const targets = this.objects.filter((o) => o.layerId === id && !this.isRigInternal(o));
    if (targets.length === 0) {
      this.notify("No objects in this layer to apply to.", "info");
      return;
    }
    this.pushHistory();
    for (const o of targets) this.setColliderShape(o, l.defaultCollider);
    this.notify(`Applied ${l.defaultCollider} collider to ${targets.length} object${targets.length > 1 ? "s" : ""}.`, "info");
    this.emit();
  }

  renameLayer(id: string, name: string): void {
    const l = this.layers.find((x) => x.id === id);
    if (l) l.name = name;
    this.emit();
  }

  setLayerVisible(id: string, visible: boolean): void {
    const l = this.layers.find((x) => x.id === id);
    if (l) l.visible = visible;
    this.applyLayerVisibility();
    this.emit();
  }

  deleteLayer(id: string): void {
    if (this.layers.length <= 1 || id === this.layers[0].id) return;
    const fallback = this.layers[0].id;
    for (const o of this.objects) if (o.layerId === id) o.layerId = fallback;
    this.layers = this.layers.filter((l) => l.id !== id);
    if (this.terrainLayerId === id) this.terrainLayerId = null;
    this.applyLayerVisibility();
    this.emit();
  }

  // ── VFX library ────────────────────────────────────────────────────────────

  private vfxOrigin(): THREE.Vector3 {
    // In Play mode, effects fire from the driven character (chest height).
    if (this.playing && this.driven) {
      return this.driven.root.getWorldPosition(this.playOrigin.clone()).add(new THREE.Vector3(0, 1, 0));
    }
    const o = this.find(this.selectedId);
    if (o) {
      const c = new THREE.Vector3();
      new THREE.Box3().setFromObject(o.object).getCenter(c);
      return c;
    }
    return new THREE.Vector3(0, 1, 0);
  }

  playVfx(id: string): void {
    const p = this.vfxOrigin();
    // Orient directional effects along the driven character's facing in Play mode
    // so attacks fire where the character is turned (matching the Danger Room);
    // the static editor keeps the world +Z default.
    const fwd = new THREE.Vector3(0, 0, 1);
    const quat = new THREE.Quaternion();
    if (this.playing && this.driven) {
      // Drive orientation from the aim direction (not the body's eased rotation),
      // so an attack fired mid-turn still points where the player aims instead of
      // lagging a frame behind the smoothed facing.
      const aim = this.controller?.forward();
      if (aim) fwd.copy(aim);
      else {
        const yaw = this.driven.root.rotation.y;
        fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
      }
      quat.setFromEuler(new THREE.Euler(0, Math.atan2(fwd.x, fwd.z), 0));
    }
    // When the Skill Lab binds effects to the damaging collider, derive every
    // asset's origin AND angle from the collider's swinging-hand frame: the slash
    // arc takes the collider's world orientation (tilts/rolls with the swing) and
    // projectiles aim along the collider's orientation-forward (pitch + yaw),
    // instead of the body's flat facing. Off (default) → unchanged flat behavior.
    // The pure derivation lives in deriveColliderVfxFrame (unit-tested so the
    // OFF path provably stays identical to the legacy flat frame).
    let colliderPos: THREE.Vector3 | null = null;
    let colliderQuat: THREE.Quaternion | null = null;
    if (this.skillLab.slashFromCollider) {
      const t = this.skillTarget();
      colliderPos = t?.damageColliderWorld(this.skillColliderWorld.clone()) ?? null;
      if (colliderPos) colliderQuat = t!.damageColliderQuat(new THREE.Quaternion());
    }
    const { srcPos, aimDir, slashQuat } = deriveColliderVfxFrame({
      origin: p,
      facing: fwd,
      facingQuat: quat,
      slashFromCollider: this.skillLab.slashFromCollider,
      colliderPos,
      colliderQuat,
    });
    switch (id) {
      case "impact":
        this.vfx.impact(p, 0xaee6ff, 2);
        break;
      case "burst":
        this.vfx.burst(p, 0xffd58a, 30, 4);
        break;
      case "shockwave":
        this.vfx.shockwave(new THREE.Vector3(p.x, 0.05, p.z), 0xffb24d, 3, 0.6);
        break;
      case "aoeBlast":
        this.vfx.aoeBlast(p, 0xffb24d, 4);
        break;
      case "nova":
        this.vfx.nova(p, 0xb98cff);
        break;
      case "lightning":
        this.vfx.lightning(p, 1);
        break;
      case "muzzle":
        this.vfx.muzzle(srcPos, aimDir, 0xfff2a8);
        break;
      case "slashArc": {
        // Collider-bound: emit the cut from the collider's world position with the
        // collider's world orientation, so it tilts/rolls to the actual swing
        // plane; otherwise lead it out in front along the character's flat facing.
        const slashAt = deriveSlashArcOrigin({
          origin: p,
          facing: fwd,
          srcPos,
          slashFromCollider: this.skillLab.slashFromCollider,
          playing: this.playing,
        });
        this.vfx.slashArc(slashAt, slashQuat, 0x9fe8ff);
        break;
      }
      case "impactExplode":
        this.vfx.impactExplode(p);
        break;
      case "flame":
        this.vfx.flame(p, 0xff7a1e, 24, 3);
        break;
      case "legFlame":
        this.vfx.legFlame(p);
        break;
      case "coneFlame":
        this.vfx.coneFlame(srcPos, aimDir);
        break;
      case "stunMark":
        this.vfx.stunMark(p, 0xffe24a, 1.6);
        break;
      case "shieldBreak":
        this.vfx.shieldBreak(p, 0x9fd8ff);
        break;
      case "puff":
        this.vfx.puff(p, 0xdfe6ee, 14, 1.2);
        break;
      case "smokePop":
        this.vfx.smokePop(p, 0xffcaa0, 1.2);
        break;
      case "castSwirl":
        this.vfx.castSwirl(p, 0x9fd0ff, 0.9, 1);
        break;
      case "bulletTrail":
        this.vfx.bulletTrail(
          new THREE.Vector3(p.x, p.y + 1.2, p.z - 6),
          new THREE.Vector3(p.x, p.y + 1.2, p.z),
          0xfff1c0,
        );
        break;
      case "smokeColumn":
        this.vfx.smokeColumn(p, 0x8a8f99, 1.6, 1.6);
        break;
      case "fireBurst":
        this.vfx.fireBurst(srcPos, aimDir, 1.2);
        break;
      case "fireDragon":
        // Collider-bound: launch from the collider along its 3D aim (pitch + yaw);
        // otherwise from chest height along the flat facing.
        this.vfx.castDragon(
          deriveLaunchOrigin({ origin: p, srcPos, slashFromCollider: this.skillLab.slashFromCollider }),
          aimDir,
        );
        break;
      case "meteor":
        // Rains from the sky onto a landing zone; collider-bound aims that zone
        // along the collider direction instead of straight ahead of the body.
        this.vfx.castMeteor(
          p,
          aimDir,
          undefined,
          undefined,
          deriveLandingZone({
            srcPos,
            aimDir,
            slashFromCollider: this.skillLab.slashFromCollider,
            distance: METEOR_LANDING_DIST,
          }) ?? undefined,
        );
        break;
      case "turret": {
        // castTurret shifts its chassis forward along the flattened aim and snaps
        // y=0; the collider-bound path backs that shift out so the turret stands
        // directly under the collider's world XZ instead of ahead of it.
        const { base, aim } = deriveTurretBase({
          origin: p,
          facing: fwd,
          srcPos,
          aimDir,
          slashFromCollider: this.skillLab.slashFromCollider,
        });
        this.vfx.castTurret(base, aim);
        break;
      }
      case "darkBlades":
        this.vfx.castDarkBlades(
          deriveLaunchOrigin({ origin: p, srcPos, slashFromCollider: this.skillLab.slashFromCollider }),
          aimDir,
        );
        break;
      case "swordVolley":
        this.vfx.castSwordVolley(
          p,
          aimDir,
          undefined,
          undefined,
          deriveLandingZone({
            srcPos,
            aimDir,
            slashFromCollider: this.skillLab.slashFromCollider,
            distance: SWORD_VOLLEY_LANDING_DIST,
          }) ?? undefined,
        );
        break;
    }
  }

  setFireParams(p: FireFxParams): void {
    this.vfx.setFireParams(p);
  }

  /** Number of authorable slash crescents (0 until the GLB has loaded). */
  slashCount(): number {
    return this.vfx.slashArcCount;
  }

  /** Fire one specific slash crescent (by index) with explicit params at the target. */
  playSlash(index: number, p: SlashFxParams): void {
    this.vfx.slashArcParam(index, this.vfxOrigin(), new THREE.Quaternion(), p);
  }

  // ── animation library rig ──────────────────────────────────────────────────

  async loadRig(weaponId = "sword", charId = "explorer"): Promise<void> {
    const token = ++this.rigToken;
    const def = getCharacter(charId);
    const rig = new ExplorerCharacter(def);
    try {
      await rig.load();
    } catch (err) {
      console.error("[EditorScene] rig load failed", err);
      return;
    }
    if (this.disposed || token !== this.rigToken) {
      rig.dispose();
      return;
    }
    if (this.rig) {
      // Swapping the dressed rig out from under an active Play session would leave
      // the Controller bound to a disposed avatar — stop Play first.
      if (this.playing && this.driven === this.rig) this.stopPlay();
      if (this.rigRootId) this.unregisterSubtree(this.rigRootId);
      this.scene.remove(this.rig.root);
      this.rig.dispose();
    }
    rig.root.position.set(0, 0, 0);
    rig.setWeaponId(weaponId);
    this.rigWeapon = getWeapon(weaponId).animSet ?? weaponId;
    this.scene.add(rig.root);
    this.rig = rig;
    this.rigRootId = this.registerSubtree(rig.root, {
      kind: "rig",
      imported: true,
      parentId: null,
      baseName: "Character",
    });
    this.emit();
  }

  setRigWeapon(weaponId: string): void {
    if (!this.rig) return;
    this.rig.setWeaponId(weaponId);
    this.rigWeapon = getWeapon(weaponId).animSet ?? weaponId;
    // The weapon swap mutates the rig's bone children, so re-register its subtree
    // to keep the hierarchy in sync with the live Object3D graph.
    if (this.rigRootId) this.unregisterSubtree(this.rigRootId);
    this.rigRootId = this.registerSubtree(this.rig.root, {
      kind: "rig",
      imported: true,
      parentId: null,
      baseName: "Character",
    });
    this.emit();
  }

  /**
   * Load any catalog character into the Dressing Room by id. Procedural rigs
   * (Explorer / Gunslinger) go through the animation-library rig path so they get
   * the full clip library + weapon arsenal; GLB fighters (Sensei / Brute /
   * Striker / Tera-Kasi) are streamed as dressable models with their baked clips
   * exposed in the Animations panel. Normalises height to ~1.8m, feet on floor.
   */
  async loadCatalogCharacter(charId: string): Promise<void> {
    const def = getCharacter(charId);
    if (def.procedural) {
      await this.loadRig(def.defaultWeapon ?? "sword", charId);
      return;
    }
    const token = ++this.rigToken;
    this.busy = true;
    this.emit();
    try {
      const gltf = await new GLTFLoader().loadAsync(asset(def.file));
      if (this.disposed || token !== this.rigToken) {
        this.disposeObject3D(gltf.scene);
        return;
      }
      const root = gltf.scene;
      root.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = true;
        n.frustumCulled = false;
      });
      // Normalise to the canonical fighter height with feet on the floor (mirrors Character.load).
      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      box.getSize(size);
      const s = size.y > 0.001 ? (CHARACTER_HEIGHT_M / size.y) * def.scale : def.scale;
      root.scale.setScalar(s);
      const box2 = new THREE.Box3().setFromObject(root);
      root.position.y -= box2.min.y;
      root.rotation.y = def.modelYaw ?? 0;
      this.scene.add(root);
      const rootId = this.registerSubtree(root, {
        kind: "model",
        imported: true,
        parentId: null,
        baseName: def.name,
      });
      // Drive the full shared mixamorig FBX weapon library onto this real rig's
      // own mesh, surfaced alongside its baked clips in the Animations panel.
      const libClips = await this.retargetSharedLibrary(root, def);
      if (this.disposed || token !== this.rigToken) {
        // The root was already added to the scene and registered before the
        // retarget await, so a cancelled load must fully unwind it (not just
        // dispose GPU resources) or a zombie node lingers in editor state.
        root.parent?.remove(root);
        this.unregisterSubtree(rootId);
        this.disposeObject3D(root);
        return;
      }
      this.registerImportedClips(rootId, root, [...(gltf.animations ?? []), ...libClips]);
      this.select(rootId);
    } catch (err) {
      console.error("[EditorScene] catalog character load failed", err);
      this.notify("Couldn't load that character.", "warn");
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  // ── weapon arsenal library ────────────────────────────────────────────────

  /**
   * The full grouped arsenal handed to the library panel: every catalog prefab
   * (with its tier variants) plus any imported models promoted to equippable
   * "custom" weapons. Prunes custom ids whose nodes have since been deleted.
   */
  private weaponLibrary(): EditorSnapshot["weapons"] {
    const entries: EditorSnapshot["weapons"] = WEAPONS.filter((w) => w.id !== "none").map((w) => ({
      id: w.id,
      label: w.label,
      group: w.group ?? "unarmed",
      animSet: w.animSet,
      skillName: w.skillName,
      tiers: (w.tiers ?? []).map((t) => ({ name: t.name, power: t.power ?? null })),
      custom: false,
    }));
    for (const id of [...this.customWeaponIds]) {
      const node = this.find(id);
      if (!node) {
        this.customWeaponIds.delete(id);
        continue;
      }
      entries.push({
        id: `custom:${id}`,
        label: node.name,
        group: "custom",
        animSet: "—",
        skillName: "Imported",
        tiers: [],
        custom: true,
      });
    }
    return entries;
  }

  /** The size + grip transform of the equipped weapon (drives the gizmo), or null. */
  private weaponEditState(): EditorSnapshot["weaponEdit"] {
    const id = this.equippedWeaponId;
    if (!id) return null;
    if (id.startsWith("custom:")) {
      const ov = this.customOverrides.get(id.slice(7)) ?? { size: 1, pos: [0, 0, 0], rot: [0, 0, 0] };
      return {
        catalog: false,
        size: ov.size,
        pos: [...ov.pos],
        rot: [...ov.rot],
        hit: null,
        showCollider: false,
      };
    }
    const def = getWeapon(id);
    // The active tier may carry its own model/grip; the gizmo edits that piece.
    const tierDef = def.tiers?.[this.equippedTier];
    const piece = tierDef?.model ?? def.model?.main;
    const grip = tierDef?.grip ?? def.grip?.main;
    const size = piece?.length ?? 1;
    const pos = grip?.pos ?? [0, 0, 0];
    const rot = grip?.rot ?? [0, 0, 0];
    return {
      catalog: true,
      size,
      pos: [pos[0], pos[1], pos[2]],
      rot: [rot[0], rot[1], rot[2]],
      hit: this.weaponHitState(def),
      showCollider: this.showCollider,
    };
  }

  /**
   * Blade-collider knobs for the arsenal tuner: the edge start/end as fractions of
   * the tip length + the capsule radius. `null` when this weapon swings no blade
   * (ranged/magic/unarmed), so the panel hides the collider controls.
   */
  private weaponHitState(def: ReturnType<typeof getWeapon>): {
    startFrac: number;
    endFrac: number;
    radius: number;
  } | null {
    const L = Math.max(0.2, this.mountedWeapon?.tip?.position.length() ?? def.model?.main.length ?? 1);
    const shape = resolveHitShape({ group: def.group, hit: def.hit }, L);
    if (!shape) return null;
    return { startFrac: shape.a[1] / L, endFrac: shape.b[1] / L, radius: shape.radius };
  }

  /** Remove the live mounted weapon (catalog GLB or cloned import) from the rig. */
  private clearMountedWeapon(): void {
    if (this.mountedWeapon) {
      unmountWeapon(this.mountedWeapon);
      this.mountedWeapon = null;
    }
    // Tear down the collider preview (its geo/mat are ours, not the mount's).
    this.buildColliderPreview();
    // The custom mount is a clone that SHARES geometry/materials with the scene
    // node, so only detach it — never dispose those shared GPU resources.
    if (this.customMount) {
      this.customMount.object.removeFromParent();
      this.customMount = null;
    }
  }

  /**
   * Equip a catalog weapon onto the rig via the real equip path: swap the rig's
   * clip set (so its bundled animation style applies) AND mount the prefab's GLB
   * model on the hand mounts (so its grip/skill/VFX loadout comes along). Loads a
   * rig first if none is present.
   */
  async equipWeapon(weaponId: string, tier = 0): Promise<void> {
    if (!this.rig) await this.loadRig(weaponId);
    if (!this.rig) return;
    this.rig.setWeaponId(weaponId);
    this.rigWeapon = getWeapon(weaponId).animSet ?? weaponId;
    this.equippedWeaponId = weaponId;
    this.equippedTier = tier;
    await this.mountCatalogModel();
  }

  /** (Re)mount the equipped catalog weapon's GLB, re-reading its (possibly edited) prefab data. */
  private async mountCatalogModel(): Promise<void> {
    const id = this.equippedWeaponId;
    if (!this.rig || !id || id.startsWith("custom:")) return;
    const token = ++this.weaponToken;
    this.clearMountedWeapon();
    const rightHand = this.rig.rightHand;
    const leftHand = this.rig.leftHand;
    if (!rightHand || !leftHand) {
      this.emit();
      return;
    }
    const def = getWeapon(id);
    if (def.id === "none") {
      this.emit();
      return;
    }
    const mounted = await mountWeaponModel(def, rightHand, leftHand, this.equippedTier);
    // Discard if a newer equip/edit superseded this async load.
    if (this.disposed || token !== this.weaponToken || !this.rig) {
      unmountWeapon(mounted);
      return;
    }
    // Tag so a later rig re-register (e.g. the Animations panel) skips these.
    for (const o of mounted.objects) o.userData.__libWeapon = true;
    this.mountedWeapon = mounted;
    if (this.showMarkers) this.ensureMarkers();
    this.buildColliderPreview();
    this.emit();
  }

  /**
   * Equip an imported model (promoted via {@link importWeapon}) as a weapon by
   * cloning it onto the rig's main hand. The clone shares the source's geometry/
   * materials; placement is then tuned with the size/grip gizmo.
   */
  equipCustomWeapon(nodeId: string): void {
    if (!this.rig) return;
    const node = this.find(nodeId);
    const rightHand = this.rig.rightHand;
    if (!node || !rightHand) return;
    this.weaponToken++; // cancel any in-flight catalog mount
    this.clearMountedWeapon();
    const clone = cloneSkinned(node.object);
    clone.userData.__libWeapon = true;
    const ov = this.getCustomOverride(nodeId);
    this.applyCustomTransform(clone, ov);
    rightHand.add(clone);
    this.customMount = { nodeId, object: clone };
    this.equippedWeaponId = `custom:${nodeId}`;
    this.equippedTier = 0;
    if (this.showMarkers) this.ensureMarkers();
    this.emit();
  }

  /** Unequip the current weapon, returning the rig to its unarmed clip set. */
  unequipWeapon(): void {
    this.weaponToken++;
    this.clearMountedWeapon();
    this.equippedWeaponId = null;
    this.equippedTier = 0;
    if (this.rig) {
      this.rig.setWeaponId("none");
      this.rigWeapon = "unarmed";
    }
    this.emit();
  }

  /**
   * Select a tier variant of the equipped weapon. A tier may carry its own model
   * (e.g. one of six distinct bows), so re-mount to swap the GLB; the clip set /
   * hold-style / skill stay the weapon's. `mountCatalogModel` emits.
   */
  setWeaponTier(tier: number): void {
    this.equippedTier = Math.max(0, tier | 0);
    void this.mountCatalogModel();
  }

  /**
   * Resize the equipped weapon. For a catalog weapon this writes the new
   * longest-axis length back onto its prefab data and re-mounts (so the change
   * persists for the session and every future mount); for an import it scales
   * the live clone.
   */
  async setWeaponSize(size: number): Promise<void> {
    const id = this.equippedWeaponId;
    if (!id) return;
    const v = Math.max(0.05, size);
    if (id.startsWith("custom:")) {
      const ov = this.getCustomOverride(id.slice(7));
      ov.size = v;
      if (this.customMount) this.applyCustomTransform(this.customMount.object, ov);
      this.emit();
      return;
    }
    const def = getWeapon(id);
    const tierDef = def.tiers?.[this.equippedTier];
    if (tierDef?.model) {
      tierDef.model.length = v;
      patchWeaponTierTuning(id, this.equippedTier, { size: v });
    } else if (def.model) {
      def.model.main.length = v;
      patchWeaponTuning(id, { size: v });
    }
    await this.mountCatalogModel();
  }

  /**
   * Reposition/reorient the equipped weapon's grip. For a catalog weapon this
   * writes the offset back onto its prefab grip data (kept in sync with the
   * shared `WEAPON_GRIPS` table the mounter reads) and re-mounts; for an import
   * it moves/rotates the live clone.
   */
  async setWeaponGrip(pos: [number, number, number], rot: [number, number, number]): Promise<void> {
    const id = this.equippedWeaponId;
    if (!id) return;
    if (id.startsWith("custom:")) {
      const ov = this.getCustomOverride(id.slice(7));
      ov.pos = [pos[0], pos[1], pos[2]];
      ov.rot = [rot[0], rot[1], rot[2]];
      if (this.customMount) this.applyCustomTransform(this.customMount.object, ov);
      this.emit();
      return;
    }
    const def = getWeapon(id);
    // When the active tier carries its own model, the gizmo tunes THAT tier's
    // grip (the mounter reads tier.grip first); otherwise the weapon's base grip.
    const tierDef = def.tiers?.[this.equippedTier];
    if (tierDef?.model) {
      tierDef.grip = { pos: [pos[0], pos[1], pos[2]], rot: [rot[0], rot[1], rot[2]] };
      patchWeaponTierTuning(id, this.equippedTier, {
        grip: { pos: [pos[0], pos[1], pos[2]], rot: [rot[0], rot[1], rot[2]] },
      });
      await this.mountCatalogModel();
      return;
    }
    if (!def.grip) def.grip = { main: { rot: [0, 0, 0], pos: [0, 0, 0] } };
    def.grip.main.pos = [pos[0], pos[1], pos[2]];
    def.grip.main.rot = [rot[0], rot[1], rot[2]];
    // The mounter reads WEAPON_GRIPS (snapshotted at module load); keep it in
    // sync so a grip added to a previously grip-less weapon still applies.
    WEAPON_GRIPS[def.id] = def.grip;
    patchWeaponTuning(id, { grip: { pos: [pos[0], pos[1], pos[2]], rot: [rot[0], rot[1], rot[2]] } });
    await this.mountCatalogModel();
  }

  /**
   * Retune the equipped weapon's swept blade collider: the cutting edge runs from
   * `startFrac`·L to `endFrac`·L along the local tip axis (L = mounted tip length),
   * inflated by `radius`. Writes the resolved {@link WeaponHitShape} onto the
   * prefab (so the mounter's edge anchors + the live sweep read it), persists it,
   * and re-mounts so the anchors + collider preview move immediately. No-op for
   * imports or weapons whose group swings no blade.
   */
  async setWeaponHit(startFrac: number, endFrac: number, radius: number): Promise<void> {
    const id = this.equippedWeaponId;
    if (!id || id.startsWith("custom:")) return;
    const def = getWeapon(id);
    if (def.id === "none") return;
    // Only blade groups swing a collider — resolve with NO hit so a non-blade
    // group (ranged/magic/unarmed, which have no HIT_DEFAULTS) returns null.
    if (!resolveHitShape({ group: def.group }, 1)) return;
    const L = Math.max(0.2, this.mountedWeapon?.tip?.position.length() ?? def.model?.main.length ?? 1);
    const s = Math.min(Math.max(0, startFrac), 0.95);
    const e = Math.min(Math.max(s + 0.05, endFrac), 1);
    const r = Math.max(0.02, radius);
    def.hit = { a: [0, s * L, 0], b: [0, e * L, 0], radius: r };
    patchWeaponTuning(id, { hit: def.hit });
    await this.mountCatalogModel();
  }

  /** Toggle the wireframe blade-collider preview capsule around the cutting edge. */
  setWeaponCollider(show: boolean): void {
    this.showCollider = show;
    this.buildColliderPreview();
    this.emit();
  }

  /**
   * (Re)build the collider preview, parented to the mount so it rides the weapon.
   * When the mounter fitted a mesh profile, the bright green wrap hugs the actual
   * weapon silhouette (per-slice rings + longitudinal rails); the swept blade
   * capsule (what combat actually tests) is overlaid as a dim cyan wireframe.
   * Without a profile it falls back to the plain capsule in green.
   */
  private buildColliderPreview(): void {
    if (this.colliderGroup) {
      this.colliderGroup.removeFromParent();
      this.colliderGroup.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose();
      });
      this.colliderGroup = null;
      this.colliderMat = null;
    }
    const mw = this.mountedWeapon;
    if (!this.showCollider || !mw?.edgeA || !mw.edgeB) return;
    const parent = mw.edgeA.parent;
    if (!parent) return;
    const g = new THREE.Group();
    g.renderOrder = 1002;

    // --- Mesh-fitted wrap: rings at each profile slice + rails between them.
    const profile = mw.profile;
    const hasWrap = !!profile && profile.length >= 2;
    if (hasWrap && profile) {
      const SEGS = 16;
      const verts: number[] = [];
      const ringPt = (s: { y: number; cx: number; cz: number; r: number }, k: number) => {
        const t = (k / SEGS) * Math.PI * 2;
        return [s.cx + Math.cos(t) * s.r, s.y, s.cz + Math.sin(t) * s.r] as const;
      };
      for (let i = 0; i < profile.length; i++) {
        const s = profile[i];
        for (let k = 0; k < SEGS; k++) {
          verts.push(...ringPt(s, k), ...ringPt(s, k + 1));
          if (i > 0 && k % 2 === 0) verts.push(...ringPt(profile[i - 1], k), ...ringPt(s, k));
        }
      }
      const wrapGeo = new THREE.BufferGeometry();
      wrapGeo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      const wrapMat = new THREE.LineBasicMaterial({
        color: 0x66ff9c,
        transparent: true,
        opacity: 0.75,
        depthTest: false,
      });
      const wrap = new THREE.LineSegments(wrapGeo, wrapMat);
      wrap.renderOrder = 1003;
      g.add(wrap);
    }

    // --- Swept blade capsule (the volume combat actually tests). Dim when the
    // wrap is shown, bright green when it's the only visual.
    const a = mw.edgeA.position;
    const b = mw.edgeB.position;
    const r = mw.edgeRadius || 0.1;
    const len = a.distanceTo(b);
    const mat = new THREE.MeshBasicMaterial({
      color: hasWrap ? 0x4db2ff : 0x66ff9c,
      wireframe: true,
      transparent: true,
      opacity: hasWrap ? 0.18 : 0.6,
      depthTest: false,
    });
    const cap = new THREE.Group();
    cap.renderOrder = 1002;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12, 1, true), mat);
    cyl.renderOrder = 1002;
    const capA = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
    const capB = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
    capA.renderOrder = capB.renderOrder = 1002;
    // Orient the capsule's local +Y along the edge a→b, sit it at the midpoint.
    cap.position.copy(a).add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a).normalize();
    cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    // Caps at each end in the capsule's local (Y-aligned) frame.
    capA.position.set(0, -len / 2, 0);
    capB.position.set(0, len / 2, 0);
    cap.add(cyl, capA, capB);
    g.add(cap);

    parent.add(g);
    this.colliderGroup = g;
    this.colliderMat = mat;
  }

  /**
   * Import a model through the universal pipeline and promote it to an
   * equippable "custom" weapon so it shows up in the arsenal library.
   */
  async importWeapon(file: File): Promise<void> {
    const before = new Set(this.objects.map((o) => o.id));
    await this.importFile(file);
    const added = this.objects.find(
      (o) =>
        o.parentId === null &&
        (o.kind === "model" || o.kind === "mesh" || o.kind === "group") &&
        !before.has(o.id),
    );
    if (added) {
      this.customWeaponIds.add(added.id);
      this.notify(`Imported ${added.name} — equip it from the Arsenal.`, "info");
    }
    this.emit();
  }

  private getCustomOverride(nodeId: string) {
    let ov = this.customOverrides.get(nodeId);
    if (!ov) {
      ov = { size: 1, pos: [0, 0, 0], rot: [0, 0, 0] };
      this.customOverrides.set(nodeId, ov);
    }
    return ov;
  }

  private applyCustomTransform(
    obj: THREE.Object3D,
    ov: { size: number; pos: [number, number, number]; rot: [number, number, number] },
  ): void {
    obj.scale.setScalar(ov.size);
    obj.position.set(ov.pos[0], ov.pos[1], ov.pos[2]);
    obj.rotation.set(ov.rot[0], ov.rot[1], ov.rot[2]);
  }

  /** Toggle the in-viewport bone-connection (hand) + tip/top markers. */
  setWeaponMarkers(show: boolean): void {
    this.showMarkers = show;
    if (show) this.ensureMarkers();
    else if (this.markerGroup) this.markerGroup.visible = false;
    this.emit();
  }

  /** Lazily build the socket (hand) + tip marker spheres and their connector line. */
  private ensureMarkers(): void {
    if (this.markerGroup) return;
    const g = new THREE.Group();
    const sphere = () => new THREE.SphereGeometry(0.035, 12, 12);
    const socketMat = new THREE.MeshBasicMaterial({ color: 0x39d0ff, depthTest: false, transparent: true });
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xff5bd0, depthTest: false, transparent: true });
    const socket = new THREE.Mesh(sphere(), socketMat);
    const tip = new THREE.Mesh(sphere(), tipMat);
    socket.renderOrder = tip.renderOrder = 1001;
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthTest: false });
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      lineMat,
    );
    line.renderOrder = 1000;
    g.add(socket, tip, line);
    this.scene.add(g);
    this.markerGroup = g;
    this.markerSocket = socket;
    this.markerTip = tip;
    this.markerLine = line;
  }

  /** Per-frame: track the markers to the live hand mount + weapon tip/top. */
  private updateMarkers(): void {
    const g = this.markerGroup;
    if (!g) return;
    const equipped = this.mountedWeapon !== null || this.customMount !== null;
    g.visible = this.showMarkers && !!this.rig && equipped;
    if (!g.visible || !this.rig) return;
    const id = this.equippedWeaponId;
    const def = id && !id.startsWith("custom:") ? getWeapon(id) : null;
    const handObj = (def?.hand === "left" ? this.rig.leftHand : this.rig.rightHand) ?? this.rig.rightHand;
    if (!handObj) {
      g.visible = false;
      return;
    }
    const socketPos = handObj.getWorldPosition(this._mkA);
    this.markerSocket!.position.copy(socketPos);
    let tipPos = this._mkB;
    if (this.mountedWeapon?.tip) {
      this.mountedWeapon.tip.getWorldPosition(tipPos);
    } else if (this.customMount) {
      this._mkBox.setFromObject(this.customMount.object);
      this._mkBox.getCenter(tipPos);
      tipPos.y = this._mkBox.max.y;
    } else {
      tipPos.copy(socketPos);
    }
    this.markerTip!.position.copy(tipPos);
    const attr = this.markerLine!.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.setXYZ(0, socketPos.x, socketPos.y, socketPos.z);
    attr.setXYZ(1, tipPos.x, tipPos.y, tipPos.z);
    attr.needsUpdate = true;
  }

  previewClip(name: string): void {
    // A normal rig clip supersedes any auto-wired Mixamo preview, so drop that
    // highlight to keep the panel state honest.
    this.rigImportedPlaying = null;
    this.rig?.previewClip(name);
    this.emit();
  }

  unloadRig(): void {
    // If Play mode is driving the dressed rig itself, tear Play down first so the
    // Controller never holds a reference to a disposed avatar.
    if (this.playing && this.driven === this.rig) this.stopPlay();
    this.rigToken++;
    this.weaponToken++;
    this.clearMountedWeapon();
    this.equippedWeaponId = null;
    this.equippedTier = 0;
    if (this.rig) {
      if (this.rigRootId) this.unregisterSubtree(this.rigRootId);
      this.rigRootId = null;
      this.scene.remove(this.rig.root);
      this.rig.dispose();
      this.rig = null;
      this.rigWeapon = null;
    }
    // The auto-wired Mixamo clips were retargeted onto THIS rig; they're
    // meaningless once it's gone, so drop them with it.
    this.rigImportedAnims.clear();
    this.rigImportedPlaying = null;
    this.emit();
  }

  // ── playground: grudge characters + Play mode ───────────────────────────────

  /**
   * Stream a customizable Grudge race character (FBX + gear preset + body atlas +
   * baked Bip001 clips) from the asset host, drop it into the scene, register its
   * subtree so it's selectable/gizmo-able, and expose its clips for preview. The
   * character idles until Play mode hands it to the Controller. Returns its root
   * node id, or null on failure.
   */
  async loadGrudgeCharacter(raceId: RaceId, presetId: PresetId): Promise<string | null> {
    const token = ++this.grudgeToken;
    this.busy = true;
    this.emit();
    const avatar = new GrudgeAvatar(raceId, presetId);
    try {
      await avatar.load();
    } catch (err) {
      console.error("[EditorScene] grudge character load failed", err);
      avatar.dispose();
      this.busy = false;
      this.notify("Couldn't load that character from the asset host.", "warn");
      return null;
    }
    if (this.disposed || token !== this.grudgeToken) {
      avatar.dispose();
      if (!this.disposed) {
        this.busy = false;
        this.emit();
      }
      return null;
    }
    avatar.root.position.set(0, 0, 0);
    // Present spawned Playground characters in a 3/4 / profile pose: the rig's
    // art-forward is +Z (straight at the camera); a +90° yaw turns that forward
    // to +X (screen-right) so the character faces to the right when standing.
    // Play mode's Controller owns root.rotation.y, so this only sets the resting
    // display orientation and is overridden the moment movement/aim takes over.
    avatar.root.rotation.y = Math.PI / 2;
    this.scene.add(avatar.root);
    const rootId = this.registerSubtree(avatar.root, {
      kind: "model",
      imported: true,
      parentId: null,
      baseName: avatar.def.name,
    });
    this.grudge.set(rootId, avatar);
    this.busy = false;
    this.select(rootId);
    this.emit();
    return rootId;
  }

  /**
   * Spawn a playable catalog character — any entry from the {@link CHARACTERS}
   * catalog — into the Playground so it can be DRIVEN in Play mode: procedural
   * rigs (Explorer, LED Monk, the casters) build an {@link ExplorerCharacter},
   * real GLB fighters (Racalvin, the strikers, etc.) build a {@link Character};
   * both are plain {@link Avatar}s the Controller drives the same way it drives a
   * grudge race. The character idles until Play mode hands it to the Controller.
   * Returns its root node id, or null on failure. Mirrors
   * {@link loadGrudgeCharacter} but keyed into the separate `catalogPlay` map.
   */
  async loadPlayableCharacter(charId: string): Promise<string | null> {
    const def = getCharacter(charId);
    const token = ++this.catalogPlayToken;
    this.busy = true;
    this.emit();
    const avatar: Avatar = def.procedural ? new ExplorerCharacter(def) : new Character(def);
    try {
      await avatar.load();
    } catch (err) {
      console.error("[EditorScene] playable catalog character load failed", err);
      avatar.dispose();
      this.busy = false;
      this.notify("Couldn't load that character.", "warn");
      this.emit();
      return null;
    }
    if (this.disposed || token !== this.catalogPlayToken) {
      avatar.dispose();
      if (!this.disposed) {
        this.busy = false;
        this.emit();
      }
      return null;
    }
    avatar.root.position.set(0, 0, 0);
    // Leave the root unrotated: unlike GrudgeAvatar, Character/ExplorerCharacter
    // self-orient via `def.modelYaw` on their inner model, so they already face the
    // canonical forward (+Z, toward camera). Forcing the grudge-specific +90° here
    // would compound with modelYaw and spin the rig to the wrong/opposite side.
    avatar.root.rotation.y = 0;
    // Procedural rigs need their weapon clip set applied so idle/locomotion drive
    // (a bare ExplorerCharacter has no clips until a weapon class is selected).
    // GLB Characters carry their own baked clips and omit setWeaponId (no-op).
    if (def.procedural) avatar.setWeaponId?.(def.defaultWeapon ?? "sword");
    // Settle into an idle so the character isn't a static bind pose on the stand.
    if (avatar.hasRole("idle")) avatar.playRole("idle", 0);
    avatar.setLocomotion?.(0);
    this.scene.add(avatar.root);
    const rootId = this.registerSubtree(avatar.root, {
      kind: "model",
      imported: true,
      parentId: null,
      baseName: def.name,
    });
    this.catalogPlay.set(rootId, avatar);
    this.busy = false;
    this.select(rootId);
    this.emit();
    return rootId;
  }

  /** Dispose + unregister one spawned playground character (grudge race or driven
   * catalog character), stopping Play mode if it's the one being driven. */
  unloadGrudge(rootId: string): void {
    const avatar = this.grudge.get(rootId) ?? this.catalogPlay.get(rootId);
    if (!avatar) return;
    if (this.driven === avatar) this.stopPlay();
    this.unregisterSubtree(rootId);
    this.scene.remove(avatar.root);
    avatar.dispose();
    this.grudge.delete(rootId);
    this.catalogPlay.delete(rootId);
    if (this.selectedId === rootId) this.selectedId = null;
    this.emit();
  }

  /**
   * Enter Play mode: hand a spawned Playground character (a grudge race or a
   * catalog fighter) to the Animator's `Controller` for 3rd-person WASD movement +
   * mouse-look camera. Prefers the selected/requested spawn, else the first one
   * loaded, else the dressed rig. No-op (with a notice) if nothing is loaded.
   */
  startPlay(rootId?: string): void {
    if (this.playing) return;
    const spawned = (id: string | null | undefined): Avatar | undefined =>
      id ? this.grudge.get(id) ?? this.catalogPlay.get(id) : undefined;
    const hasSpawned = (id: string | null | undefined): id is string => !!spawned(id);
    const pickId = hasSpawned(rootId)
      ? rootId
      : hasSpawned(this.selectedId)
        ? this.selectedId
        : [...this.grudge.keys(), ...this.catalogPlay.keys()][0];
    const picked = pickId ? spawned(pickId) ?? null : null;
    // Prefer a spawned Playground character (grudge race or catalog fighter);
    // otherwise drive the dressed rig so Play mode always works on whatever
    // character is on the stand.
    const driven: Avatar | null = picked ?? this.rig;
    if (!driven) {
      this.notify("Load a character first, then press Play.", "info");
      return;
    }
    this.gizmo.detach();
    this.orbit.enabled = false;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    const input = new InputState(this.renderer.domElement);
    // Play-preview uses the same persisted controller/camera/mouse feel as the
    // rest of the studio so movement here matches the Danger Room.
    const controller = new Controller(driven, this.camera, input, loadControls());
    this.playInput = input;
    this.controller = controller;
    // Only grudge avatars expose the Skill-Lab authoring API + race anim-pack, so
    // playAvatar (the Skill-Lab / weapon-pack target) is set only for them; a
    // driven catalog character resolves its skill kit from its def instead.
    this.playAvatar = picked instanceof GrudgeAvatar ? picked : null;
    this.driven = driven;
    this.playing = true;
    // Resolve the weapon-skill kit (and reset cooldowns) for the HUD skill bar.
    this.playSkills = skillsForGroup(this.resolvePlayGroup());
    this.skillReadyAt.clear();
    window.addEventListener("keydown", this.onPlayKeyDown);
    window.addEventListener("mousedown", this.onPlayMouseDown);
    input.requestLock();
    // The driven avatar is now the skill target — push current lab state onto it
    // so overdrive/mirror/arm-width/collider match the UI without re-touching a slider.
    this.applySkillLab();
    this.emit();
  }

  /** Leave Play mode: tear down the controller/input and restore editor framing. */
  stopPlay(): void {
    if (!this.playing) return;
    window.removeEventListener("keydown", this.onPlayKeyDown);
    window.removeEventListener("mousedown", this.onPlayMouseDown);
    this.playInput?.exitLock();
    this.playInput?.dispose();
    this.playInput = null;
    // Restore the avatar's visibility before dropping the controller: first-person
    // mode hides the driven body, and tearing down play in FP would otherwise leave
    // it invisible back in the editor (and on the next play start).
    this.controller?.setViewMode("third");
    this.controller = null;
    const driven = this.driven;
    this.playAvatar = null;
    this.driven = null;
    this.playing = false;
    this.playSkills = [];
    this.skillReadyAt.clear();
    // Return the character to a clean idle pose.
    driven?.playRole("idle", 0.15);
    this.orbit.enabled = true;
    // The skill target reverts to the selected grudge character (or none) — resync.
    this.applySkillLab();
    this.emit();
  }

  // ── Playground Skill Lab ────────────────────────────────────────────────────

  /**
   * The character the Skill Lab authors against: the driven Play-mode avatar when
   * playing, else the selected Playground (grudge) character.
   */
  private skillTarget(): GrudgeAvatar | null {
    if (this.playAvatar) return this.playAvatar;
    if (this.selectedId && this.grudge.has(this.selectedId)) return this.grudge.get(this.selectedId)!;
    return null;
  }

  /** Push every Skill Lab knob onto the current target avatar. */
  private applySkillLab(): void {
    const t = this.skillTarget();
    // Only the active target ever shows its authoring collider — clear it on every
    // other spawned character so switching targets never leaves a stale wireframe.
    for (const a of this.grudge.values()) {
      if (a !== t) a.showDamageCollider(false);
    }
    if (!t) return;
    t.setOverdrive(this.skillLab.overdrive);
    t.setMirror(this.skillLab.mirror);
    t.setArmWidth(this.skillLab.armWidth);
    t.setDamageCollider({
      x: this.skillLab.colliderX,
      y: this.skillLab.colliderY,
      z: this.skillLab.colliderZ,
      radius: this.skillLab.colliderRadius,
    });
    t.showDamageCollider(this.skillLab.showCollider);
  }

  /** Update one Skill Lab field, apply it live to the target, and re-emit. */
  setSkillLab<K extends keyof SkillLabConfig>(key: K, value: SkillLabConfig[K]): void {
    this.skillLab[key] = value;
    // Clamp the clip range so the in-point always precedes the out-point.
    if (key === "clipFrom") this.skillLab.clipFrom = Math.min(this.skillLab.clipFrom, this.skillLab.clipTo - 0.02);
    if (key === "clipTo") this.skillLab.clipTo = Math.max(this.skillLab.clipTo, this.skillLab.clipFrom + 0.02);
    this.applySkillLab();
    this.emit();
  }

  /**
   * Author + preview the current skill: face the aim (in Play mode), play the
   * selected clip sliced to the in/out range (mirrored + overdriven per the lab),
   * then fire the chosen VFX. Falls back to the attack role when no clip is picked.
   */
  testSkill(): void {
    const t = this.skillTarget();
    if (!t) {
      this.notify("Load or select a Playground character first.", "info");
      return;
    }
    this.applySkillLab();
    if (this.playing) this.faceAim();
    const clip = this.skillLab.clipName;
    if (clip && t.hasClip(clip)) t.playAuthoredClip(clip, this.skillLab.clipFrom, this.skillLab.clipTo, 0.1);
    else if (t.hasRole("attack")) t.playRoleOnce("attack", 0.1);
    this.playVfx(this.skillLab.vfxId);
  }

  /** Build the Skill Lab slice of the snapshot for React. */
  private skillLabSnapshot(): SkillLabState {
    const t = this.skillTarget();
    const clips = t ? t.clipNames() : [];
    return {
      available: !!t,
      clips,
      clipName: this.skillLab.clipName,
      overdrive: this.skillLab.overdrive,
      mirror: this.skillLab.mirror,
      armWidth: this.skillLab.armWidth,
      clipFrom: this.skillLab.clipFrom,
      clipTo: this.skillLab.clipTo,
      vfxId: this.skillLab.vfxId,
      slashFromCollider: this.skillLab.slashFromCollider,
      colliderX: this.skillLab.colliderX,
      colliderY: this.skillLab.colliderY,
      colliderZ: this.skillLab.colliderZ,
      colliderRadius: this.skillLab.colliderRadius,
      showCollider: this.skillLab.showCollider,
    };
  }

  /**
   * Turn the driven character to face the camera aim before a Play-mode action,
   * so every attack/cast commits a body facing first (same as the Danger Room).
   */
  private faceAim(): void {
    const dir = this.controller?.forward();
    if (dir) this.controller?.faceToward(dir, 0.2);
  }

  /**
   * Pick the weapon-skill kit's group for the current Play session: a driven
   * Playground (grudge) character maps from its animation pack; the dressed rig
   * uses its equipped weapon's group; otherwise unarmed.
   */
  private resolvePlayGroup(): WeaponGroup {
    if (this.playAvatar) {
      const pack = getPreset(this.playAvatar.raceId, this.playAvatar.presetId).animPack;
      return pack === "magic"
        ? "magic"
        : pack === "longbow"
          ? "ranged"
          : pack === "sword_shield"
            ? "melee-1h"
            : "unarmed";
    }
    // A driven catalog character (Racalvin, the casters, GLB fighters…) isn't the
    // dressed rig, so resolve its skill kit from its own default weapon's group.
    const d = this.driven;
    if (d && d !== this.rig) {
      const wid = d.def.defaultWeapon;
      return wid ? getWeapon(wid).group ?? "unarmed" : "unarmed";
    }
    const id = this.equippedWeaponId;
    if (id && !id.startsWith("custom:")) return getWeapon(id).group ?? "unarmed";
    return "unarmed";
  }

  /**
   * Fire a Play-mode weapon skill by slot key: gated on its cooldown, turns the
   * body to the aim, plays the weapon-appropriate attack clip, then emits the
   * skill's VFX. Stamps the slot's cooldown and re-emits so the HUD sweep resets.
   */
  private fireSkill(key: string): void {
    if (!this.playing) return;
    const skill = this.playSkills.find((s) => s.key === key);
    if (!skill) return;
    const now = performance.now();
    if (skill.cooldown > 0 && now < (this.skillReadyAt.get(key) ?? 0)) return;
    this.faceAim();
    if (this.driven?.hasRole("attack")) this.driven.playRoleOnce("attack", 0.1);
    this.playVfx(skill.vfx);
    if (skill.cooldown > 0) {
      this.skillReadyAt.set(key, now + skill.cooldown * 1000);
      this.emit();
    }
  }

  /** Play-mode keyboard: Space jumps; Digit1-5 turn-and-cast a VFX skill. */
  private onPlayKeyDown = (e: KeyboardEvent) => {
    if (!this.playing) return;
    if (e.code === "Space") {
      e.preventDefault();
      this.controller?.jump();
      return;
    }
    if (e.code === "KeyB") {
      e.preventDefault();
      this.controller?.toggleView();
      this.emit();
      return;
    }
    const skillByDigit: Record<string, string> = {
      Digit1: "skill1",
      Digit2: "skill2",
      Digit3: "skill3",
      Digit4: "skill4",
      Digit5: "skill5",
    };
    const skillKey = skillByDigit[e.code];
    if (skillKey) {
      e.preventDefault();
      this.fireSkill(skillKey);
    }
  };

  /** Play-mode primary fire: turn to aim, play the attack clip + a slash-arc VFX. */
  private onPlayMouseDown = (e: MouseEvent) => {
    if (!this.playing || e.button !== 0) return;
    // Ignore clicks that aren't on the canvas (e.g. on a UI panel).
    if (e.target !== this.renderer.domElement) return;
    if (!this.driven) return;
    this.fireSkill("primary");
  };

  // ── hierarchy registry / import / export ────────────────────────────────────

  /** Classify a raw Object3D into the editor's node taxonomy. */
  private kindOf(n: THREE.Object3D): NodeKind {
    const a = n as THREE.Object3D & { isBone?: boolean; isSkinnedMesh?: boolean; isMesh?: boolean };
    if (a.isBone) return "bone";
    if (a.isSkinnedMesh) return "skinnedMesh";
    if (a.isMesh) return "mesh";
    return "group";
  }

  private defaultName(kind: NodeKind): string {
    const count = this.objects.filter((o) => o.kind === kind).length + 1;
    return `${kind[0].toUpperCase()}${kind.slice(1)} ${count}`;
  }

  /**
   * Walk an Object3D graph and register every node (skipping collider helpers)
   * into the flat-with-parentId registry, mirroring the real parent/child shape.
   * Returns the registry id of the subtree root.
   */
  private registerSubtree(
    root: THREE.Object3D,
    opts: { kind: NodeKind; imported: boolean; parentId: string | null; layerId?: string; baseName?: string },
  ): string {
    const layerId = opts.layerId ?? this.layers[0].id;
    let rootId = "";
    const visit = (node: THREE.Object3D, parentId: string | null, isRoot: boolean) => {
      const kind: NodeKind = isRoot ? opts.kind : this.kindOf(node);
      const id = nextId(kind);
      node.userData.objId = id;
      const name = isRoot ? (opts.baseName ?? node.name ?? this.defaultName(kind)) : node.name || this.defaultName(kind);
      const obj: EditorObject = {
        id,
        name,
        layerId,
        kind,
        object: node,
        parentId,
        imported: opts.imported,
        baseVisible: node.visible,
        collider: null,
        helper: null,
      };
      this.objects.push(obj);
      if (isRoot) rootId = id;
      for (const child of [...node.children]) {
        if (child.userData?.isColliderHelper || child.userData?.__libWeapon) continue;
        visit(child, id, false);
      }
    };
    visit(root, opts.parentId, true);
    this.applyLayerVisibility();
    return rootId;
  }

  /** Drop a subtree's nodes from the registry without disposing GPU resources. */
  private unregisterSubtree(rootId: string): void {
    const ids = this.subtreeIds(rootId);
    this.objects = this.objects.filter((o) => !ids.has(o.id));
    if (this.selectedId && ids.has(this.selectedId)) this.selectedId = null;
  }

  /** Re-parent a node under another (or to the scene root), preserving world transform. */
  reparent(childId: string, parentId: string | null): void {
    const child = this.find(childId);
    if (!child || childId === parentId) return;
    // A rig bone / skinned mesh is posed every frame by the live skeleton + the
    // animation mixer, which drive LOCAL transforms relative to the bone's parent.
    // Re-parenting one would silently deform the rig the moment a clip plays, so
    // it is constrained. The rig ROOT may still be re-parented (the whole skeleton
    // moves together, intact), and an EXTERNAL object may be attached ONTO a bone
    // (the weapon/prop bone-attach case) — only rig internals are blocked here.
    if (this.isRigInternal(child)) {
      this.notify(
        "Rig bones can't be re-parented — moving one would deform the live skeleton. Re-parent the rig's root node instead.",
        "warn",
      );
      return;
    }
    // Guard against cycles: the new parent must not live inside the moved subtree.
    if (parentId && this.subtreeIds(childId).has(parentId)) {
      this.notify("Can't re-parent a node under one of its own descendants.", "warn");
      return;
    }
    const parent = parentId ? this.find(parentId) : null;
    if (parentId && !parent) return;
    this.pushHistory();
    (parent ? parent.object : this.scene).attach(child.object);
    child.parentId = parentId;
    this.emit();
  }

  /** Import a binary/ascii glTF from raw bytes and register its scene graph. */
  async importGLB(data: ArrayBuffer, name = "Model"): Promise<void> {
    this.busy = true;
    this.emit();
    try {
      const gltf = await new GLTFLoader().parseAsync(data, "");
      const root = gltf.scene;
      root.traverse((n) => {
        n.frustumCulled = false;
      });
      this.scene.add(root);
      const rootId = this.registerSubtree(root, { kind: "model", imported: true, parentId: null, baseName: name });
      this.registerImportedClips(rootId, root, gltf.animations ?? []);
      this.autoWireMixamoClips(name, gltf.animations ?? []);
      this.select(rootId);
    } catch (err) {
      console.error("[EditorScene] GLB import failed", err);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Import an FBX from raw bytes and register its scene graph. */
  importFBX(data: ArrayBuffer, name = "Model"): void {
    this.busy = true;
    this.emit();
    try {
      const root = new FBXLoader().parse(data, "");
      root.traverse((n) => {
        n.frustumCulled = false;
      });
      this.scene.add(root);
      const rootId = this.registerSubtree(root, { kind: "model", imported: true, parentId: null, baseName: name });
      // FBXLoader hangs parsed clips on the returned Group's `animations`.
      this.registerImportedClips(rootId, root, root.animations ?? []);
      this.autoWireMixamoClips(name, root.animations ?? []);
      this.select(rootId);
    } catch (err) {
      console.error("[EditorScene] FBX import failed", err);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Import a Wavefront OBJ (geometry only; .mtl materials are not resolved). */
  importOBJ(text: string, name = "Model"): void {
    try {
      const root = new OBJLoader().parse(text);
      root.traverse((n) => {
        n.frustumCulled = false;
        const mesh = n as THREE.Mesh;
        // OBJLoader leaves a bare phong material; give untextured meshes a lit grey.
        if (mesh.isMesh && !Array.isArray(mesh.material)) {
          const m = mesh.material as THREE.Material & { map?: THREE.Texture | null };
          if (!m || !("color" in m)) {
            mesh.material = new THREE.MeshStandardMaterial({ color: 0x9aa6b8, roughness: 0.8, metalness: 0 });
          }
        }
      });
      this.scene.add(root);
      const rootId = this.registerSubtree(root, { kind: "model", imported: true, parentId: null, baseName: name });
      this.select(rootId);
    } catch (err) {
      console.error("[EditorScene] OBJ import failed", err);
      this.notify("Couldn't parse that OBJ file.", "warn");
    }
    this.emit();
  }

  /** Import a Blockbench (.bbmodel / .bb) boxy model with its texture atlas. */
  async importBBModel(text: string, name = "Model"): Promise<void> {
    this.busy = true;
    this.emit();
    try {
      const group = await parseBBModel(text);
      if (name && name !== "Model") group.name = name;
      group.traverse((n) => {
        n.frustumCulled = false;
      });
      this.scene.add(group);
      const rootId = this.registerSubtree(group, { kind: "model", imported: true, parentId: null, baseName: name });
      this.select(rootId);
    } catch (err) {
      console.error("[EditorScene] bbmodel import failed", err);
      this.notify("Couldn't parse that Blockbench model.", "warn");
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Crack open a ZIP and import the first model it finds (glb→fbx→obj→bbmodel). */
  async importZip(buffer: ArrayBuffer, name = "Archive"): Promise<void> {
    this.busy = true;
    this.emit();
    try {
      const files = await unzip(buffer);
      const keys = [...files.keys()];
      const pick = (re: RegExp) => keys.find((k) => re.test(k));
      const toAB = (u8: Uint8Array): ArrayBuffer =>
        u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
      const base = (p: string) => p.split("/").pop()!.replace(/\.[^.]+$/, "");

      const glb = pick(/\.glb$/i);
      const gltf = pick(/\.gltf$/i);
      const fbx = pick(/\.fbx$/i);
      const obj = pick(/\.obj$/i);
      const bb = pick(/\.bbmodel$|\.bb$/i);
      if (glb) {
        await this.importGLB(toAB(files.get(glb)!), base(glb));
      } else if (gltf) {
        await this.importGLTFBundle(files, gltf, base(gltf));
      } else if (fbx) {
        this.importFBX(toAB(files.get(fbx)!), base(fbx));
      } else if (obj) {
        this.importOBJ(new TextDecoder().decode(files.get(obj)!), base(obj));
      } else if (bb) {
        await this.importBBModel(new TextDecoder().decode(files.get(bb)!), base(bb));
      } else {
        this.notify("No importable model (.glb/.gltf/.fbx/.obj/.bbmodel) found in the archive.", "warn");
      }
    } catch (err) {
      console.error("[EditorScene] zip import failed", err);
      this.notify(`Couldn't open ${name}.zip — it may be corrupt or use an unsupported format.`, "warn");
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /**
   * Import a multi-file glTF bundle (a `.gltf` JSON plus its sidecar `.bin`
   * buffers and texture images) extracted from a ZIP. Every archive entry is
   * exposed to GLTFLoader as a blob: URL via a LoadingManager URL-modifier, so
   * relative references inside the glTF resolve to the in-memory files. All blob
   * URLs are revoked once parsing has loaded its dependencies.
   */
  private async importGLTFBundle(files: Map<string, Uint8Array>, gltfKey: string, name: string): Promise<void> {
    this.busy = true;
    this.emit();
    const urls: string[] = [];
    try {
      const mimeFor = (k: string): string => {
        const e = k.toLowerCase();
        if (e.endsWith(".png")) return "image/png";
        if (e.endsWith(".jpg") || e.endsWith(".jpeg")) return "image/jpeg";
        if (e.endsWith(".webp")) return "image/webp";
        if (e.endsWith(".ktx2")) return "image/ktx2";
        return "application/octet-stream";
      };
      // Map every entry (by full path and by bare filename) to a blob URL.
      const map = new Map<string, string>();
      for (const [k, v] of files) {
        const ab = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
        const url = URL.createObjectURL(new Blob([ab], { type: mimeFor(k) }));
        urls.push(url);
        map.set(k, url);
        const bn = k.split("/").pop()!;
        if (!map.has(bn)) map.set(bn, url);
      }
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => {
        const decoded = decodeURIComponent(url).split("?")[0];
        const bn = decoded.split("/").pop()!;
        return map.get(decoded) ?? map.get(bn) ?? url;
      });
      const text = new TextDecoder().decode(files.get(gltfKey)!);
      const gltf = await new GLTFLoader(manager).parseAsync(text, "");
      const root = gltf.scene;
      root.traverse((n) => {
        n.frustumCulled = false;
      });
      this.scene.add(root);
      const rootId = this.registerSubtree(root, { kind: "model", imported: true, parentId: null, baseName: name });
      this.registerImportedClips(rootId, root, gltf.animations ?? []);
      this.autoWireMixamoClips(name, gltf.animations ?? []);
      this.select(rootId);
    } catch (err) {
      console.error("[EditorScene] glTF bundle import failed", err);
      this.notify("Couldn't load the glTF bundle from the archive.", "warn");
    } finally {
      urls.forEach((u) => URL.revokeObjectURL(u));
      this.busy = false;
      this.emit();
    }
  }

  /**
   * Universal import entry: auto-detect by file extension and route to the right
   * loader. The single hook used by both the File menu and viewport drag-and-drop.
   */
  async importFile(file: File): Promise<void> {
    const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
    const name = file.name.replace(/\.[^.]+$/, "");
    try {
      if (ext === "zip") await this.importZip(await file.arrayBuffer(), name);
      else if (ext === "glb" || ext === "gltf") await this.importGLB(await file.arrayBuffer(), name);
      else if (ext === "fbx") this.importFBX(await file.arrayBuffer(), name);
      else if (ext === "obj") this.importOBJ(await file.text(), name);
      else if (ext === "bbmodel" || ext === "bb") await this.importBBModel(await file.text(), name);
      else this.notify(`Unsupported file type: .${ext}`, "warn");
    } catch (err) {
      console.error("[EditorScene] import failed", err);
      this.notify(`Couldn't import ${file.name}.`, "warn");
    }
  }

  // ── wardrobe: skins + attachable gear ──────────────────────────────────────

  /**
   * Restyle every material in an object's subtree in place (live): recolour,
   * swap the base texture, and/or nudge metalness/roughness. Existing maps are
   * NOT disposed (they may be shared atlases owned by the rig/asset cache).
   */
  async applySkin(
    id: string,
    opts: { color?: number; textureDataUrl?: string; metalness?: number; roughness?: number },
  ): Promise<void> {
    const o = this.find(id);
    if (!o) return;
    let tex: THREE.Texture | null = null;
    if (opts.textureDataUrl) {
      try {
        tex = await new THREE.TextureLoader().loadAsync(opts.textureDataUrl);
        tex.colorSpace = THREE.SRGBColorSpace;
        // glTF/FBX rigs (the wardrobe's main targets) author UVs with a
        // top-left origin, so replacement maps must NOT flip vertically;
        // flipping here inverts the skin on those meshes.
        tex.flipY = false;
      } catch {
        this.notify("Couldn't read that texture image.", "warn");
        return;
      }
    }
    o.object.traverse((n) => {
      const mat = (n as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      const apply = (m: THREE.Material) => {
        const sm = m as THREE.MeshStandardMaterial;
        if (opts.color !== undefined && sm.color) sm.color.setHex(opts.color);
        if (tex) sm.map = tex;
        if (opts.metalness !== undefined && "metalness" in sm) sm.metalness = opts.metalness;
        if (opts.roughness !== undefined && "roughness" in sm) sm.roughness = opts.roughness;
        sm.needsUpdate = true;
      };
      if (Array.isArray(mat)) mat.forEach(apply);
      else apply(mat);
    });
    this.emit();
  }

  /** True when the procedural box ("voxel") character is the loaded rig. */
  get rigIsVoxel(): boolean {
    return this.rig !== null;
  }

  /**
   * Swap the procedural voxel character's baked LED-mask head live: `null`
   * removes the mask (restoring the skin face), any {@link ShellId} (re)builds it
   * wearing that housing shell. Stays a static bake (no render loop).
   */
  setRigLedShell(shellId: ShellId | null): void {
    if (!this.rig) {
      this.notify("Load the voxel character first to fit an LED mask.", "warn");
      return;
    }
    this.rig.setLedMask(shellId);
    this.emit();
  }

  /** Recolour one part of the procedural voxel character (skin/shirt/pants/boot/hat/eye). */
  recolorRigPart(part: VoxelPart, color: number): void {
    if (!this.rig) {
      this.notify("Load the voxel character first to recolour its parts.", "warn");
      return;
    }
    this.rig.setPartColor(part, color);
    this.emit();
  }

  /**
   * Load a data-URL pattern image and apply it as a tiling texture on one part of
   * the procedural voxel character. Unlike {@link applySkin} (which textures the
   * WHOLE subtree uniformly), this targets a single body part. Box-rig faces use
   * the default UVs, so the texture keeps the default flipY; sRGB colour space.
   */
  async applyRigPattern(part: VoxelPart, dataUrl: string): Promise<void> {
    if (!this.rig) {
      this.notify("Load the voxel character first to apply a pattern.", "warn");
      return;
    }
    let tex: THREE.Texture;
    try {
      tex = await new THREE.TextureLoader().loadAsync(dataUrl);
    } catch {
      this.notify("Couldn't load the generated pattern image.", "warn");
      return;
    }
    if (this.disposed || !this.rig) {
      tex.dispose();
      return;
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    this.rig.setPartPattern(part, tex);
    this.emit();
  }

  /** Remove any applied pattern from a voxel body part (back to flat colour). */
  clearRigPattern(part: VoxelPart): void {
    if (!this.rig) return;
    this.rig.setPartPattern(part, null);
    this.emit();
  }

  /** Bone names available as gear attach points on a character/rig subtree. */
  listBones(id: string): string[] {
    const o = this.find(id);
    if (!o) return [];
    const names: string[] = [];
    o.object.traverse((n) => {
      if ((n as THREE.Bone).isBone && n.name) names.push(n.name);
    });
    return names;
  }

  private findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
    const lc = name.toLowerCase();
    let exact: THREE.Bone | null = null;
    let partial: THREE.Bone | null = null;
    root.traverse((n) => {
      if (exact) return;
      const b = n as THREE.Bone;
      if (!b.isBone || !b.name) return;
      const bn = b.name.toLowerCase();
      if (bn === lc) exact = b;
      else if (!partial && bn.includes(lc)) partial = b;
    });
    return exact ?? partial;
  }

  /**
   * Load a catalog accessory GLB (e.g. the golden crown) into the scene as a
   * dressable "model" node, optionally normalized + pre-rotated and auto-attached
   * to a character's bone so it lands roughly in place (then fine-tune with the
   * gizmo). Mirrors {@link loadCatalogCharacter}'s load/register flow.
   */
  async loadAccessory(
    file: string,
    name: string,
    opts?: { targetHeight?: number; preRotX?: number; attachTo?: string | null; bone?: string | null },
  ): Promise<void> {
    this.busy = true;
    this.emit();
    try {
      const gltf = await new GLTFLoader().loadAsync(asset(file));
      const root = gltf.scene;
      root.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = true;
        n.frustumCulled = false;
      });
      // Uniform-fit the longest axis to a small wearable size.
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z) || 1;
      root.scale.multiplyScalar((opts?.targetHeight ?? 0.26) / longest);
      if (opts?.preRotX) root.rotation.x = opts.preRotX;
      this.scene.add(root);
      const rootId = this.registerSubtree(root, { kind: "model", imported: true, parentId: null, baseName: name });
      // Drop it roughly onto the target bone before attaching (attach() preserves
      // world transform, so positioning here makes it land near the joint).
      const target = opts?.attachTo ? this.find(opts.attachTo) : null;
      if (target && opts?.bone) {
        const bone = this.findBone(target.object, opts.bone);
        if (bone) {
          const wp = new THREE.Vector3();
          bone.getWorldPosition(wp);
          root.position.set(wp.x, wp.y + 0.12, wp.z);
          root.updateMatrixWorld(true);
        }
        this.attachGear(opts.attachTo!, rootId, opts.bone);
      }
      this.select(rootId);
    } catch (err) {
      console.error("[EditorScene] accessory load failed", err);
      this.notify("Couldn't load that accessory.", "warn");
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /**
   * Parent a gear node onto a character (optionally onto a named bone so it
   * follows that joint). `attach` preserves the gear's current world transform,
   * so it stays put visually and can then be fine-tuned with the gizmo.
   */
  attachGear(charId: string, gearId: string, boneName?: string | null): void {
    const char = this.find(charId);
    const gear = this.find(gearId);
    if (!char || !gear || char.id === gear.id) return;
    let targetObj: THREE.Object3D = char.object;
    let targetId = charId;
    if (boneName) {
      const bone = this.findBone(char.object, boneName);
      if (bone) {
        targetObj = bone;
        const boneNode = this.objects.find((n) => n.object === bone);
        if (boneNode) targetId = boneNode.id;
      } else {
        this.notify(`No bone "${boneName}" on ${char.name}; attached to its root.`, "warn");
      }
    }
    targetObj.attach(gear.object);
    gear.parentId = targetId;
    this.notify(`Attached ${gear.name} to ${char.name}.`, "info");
    this.emit();
  }

  /** Detach a previously-attached gear node back to the scene root. */
  detachGear(gearId: string): void {
    const gear = this.find(gearId);
    if (!gear) return;
    this.scene.attach(gear.object);
    gear.parentId = null;
    this.emit();
  }

  /** Export the whole scene (or just the selection) to a binary glTF ArrayBuffer. */
  async exportGLB(selectionOnly = false): Promise<ArrayBuffer> {
    const sel = selectionOnly ? this.find(this.selectedId) : null;
    const roots = sel ? [sel.object] : this.objects.filter((o) => o.parentId === null).map((o) => o.object);
    // GLTFExporter skips invisible nodes (onlyVisible defaults true), so hide
    // collider helper lines for the duration of the export.
    const hidden: THREE.Object3D[] = [];
    for (const o of this.objects) {
      if (o.helper && o.helper.visible) {
        o.helper.visible = false;
        hidden.push(o.helper);
      }
    }
    this.busy = true;
    this.emit();
    try {
      const result = await new GLTFExporter().parseAsync(roots, { binary: true });
      return result as ArrayBuffer;
    } finally {
      for (const h of hidden) h.visible = true;
      this.busy = false;
      this.emit();
    }
  }

  /** Serialise the editor scene graph to a plain JSON descriptor (custom format). */
  exportJSON(): string {
    const ordered = this.orderedObjects();
    return JSON.stringify(
      {
        version: 1,
        layers: this.layers.map((l) => ({ ...l })),
        objects: ordered.map(({ o, depth, hasChildren }) => this.toSnapshot(o, depth, hasChildren)),
      },
      null,
      2,
    );
  }

  /**
   * Rebuild the editor scene from a descriptor produced by `exportJSON` (the
   * mirror of that method). Primitives, layers, transforms, materials, and
   * colliders round-trip faithfully; the parentId graph is rebuilt so the
   * hierarchy is preserved.
   *
   * Limitation: imported models (GLB/FBX) and the procedural rig are NOT embedded
   * in the JSON — only metadata is — so those nodes cannot be reconstructed from
   * bytes and are skipped. Any editor-spawned children that were parented under a
   * skipped node fall back to the scene root, and the count of skipped nodes is
   * surfaced as a notice so the user understands what couldn't be reopened.
   *
   * Accepts either the JSON string or the already-parsed descriptor object (the
   * gallery hands posts back as parsed payloads).
   */
  importJSON(input: string | SceneDescriptor): void {
    let data: SceneDescriptor;
    try {
      data = (typeof input === "string" ? JSON.parse(input) : input) as SceneDescriptor;
    } catch {
      this.notify("Couldn't read that scene — its data was malformed.", "warn");
      return;
    }
    if (!data || !Array.isArray(data.objects)) {
      this.notify("Couldn't read that scene — its data was malformed.", "warn");
      return;
    }

    this.clearScene();

    // Restore layers (always keep at least the built-in default at index 0).
    if (Array.isArray(data.layers) && data.layers.length > 0) {
      this.layers = data.layers.map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
        visible: l.visible !== false,
        defaultCollider: l.defaultCollider ?? null,
      }));
    }

    const validLayerIds = new Set(this.layers.map((l) => l.id));
    // Map old snapshot ids → freshly-registered ids so parentId links survive
    // (and so children of a skipped node can fall back to the scene root).
    const idMap = new Map<string, string>();
    let skipped = 0;

    for (const snap of data.objects) {
      // Only editor-spawned primitives carry enough data to rebuild from JSON;
      // imported models / rig / their groups, meshes, and bones need the original
      // bytes, which the descriptor never embeds.
      if (snap.imported || !PRIMITIVE_KINDS.has(snap.kind as PrimitiveKind)) {
        skipped++;
        continue;
      }
      const kind = snap.kind as PrimitiveKind;
      const geo = this.makePrimitiveGeo(kind);
      const mat = new THREE.MeshStandardMaterial({
        color: snap.color ?? 0x8fb3ff,
        roughness: 0.55,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const [px, py, pz] = snap.position;
      mesh.position.set(px, py, pz);
      const [rx, ry, rz] = snap.rotation;
      mesh.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz));
      const [sx, sy, sz] = snap.scale;
      mesh.scale.set(sx, sy, sz);
      mesh.visible = snap.visible !== false;

      // Resolve the parent: a remapped parent if it survived the import, else the
      // scene root (covers parents that were skipped imported nodes).
      const newParentId = snap.parentId ? idMap.get(snap.parentId) ?? null : null;
      const parent = (newParentId ? this.find(newParentId)?.object : null) ?? this.scene;
      parent.add(mesh);

      const id = nextId(kind);
      mesh.userData.objId = id;
      const obj: EditorObject = {
        id,
        name: snap.name,
        layerId: validLayerIds.has(snap.layerId) ? snap.layerId : this.layers[0].id,
        kind,
        object: mesh,
        parentId: newParentId,
        imported: false,
        baseVisible: mesh.visible,
        collider: null,
        helper: null,
      };
      this.objects.push(obj);
      idMap.set(snap.id, id);

      if (snap.collider) {
        obj.collider = {
          shape: snap.collider.shape,
          dims: { ...snap.collider.dims },
          offset: { ...snap.collider.offset },
        };
        this.rebuildHelper(obj);
      }
    }

    this.applyLayerVisibility();
    this.select(null);
    if (skipped > 0) {
      this.notify(
        `Loaded the scene. ${skipped} imported ${skipped === 1 ? "node" : "nodes"} (models / rig) couldn't be reopened — model files aren't stored in a posted scene.`,
        "warn",
      );
    } else {
      this.notify("Scene loaded.", "info");
    }
    this.emit();
  }

  /** Tear down every object + collider helper and reset layers to the default. */
  private clearScene(): void {
    this.haltImported();
    this.unloadRig();
    for (const o of [...this.objects]) this.removeObject(o);
    this.objects = [];
    this.selectedId = null;
    this.terrainLayerId = null;
    this.layers = [{ id: "default", name: "Default", color: 0x6ea8ff, visible: true }];
  }

  /** Convert FBX bytes to a GLB ArrayBuffer without touching the live scene. */
  async convertFbxToGlb(data: ArrayBuffer): Promise<ArrayBuffer> {
    this.busy = true;
    this.emit();
    const root = new FBXLoader().parse(data, "");
    try {
      const result = await new GLTFExporter().parseAsync(root, {
        binary: true,
        animations: root.animations ?? [],
      });
      return result as ArrayBuffer;
    } finally {
      this.disposeObject3D(root);
      this.busy = false;
      this.emit();
    }
  }

  /** Register the clips that arrived with an imported model under its root node. */
  private registerImportedClips(rootId: string, root: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    if (clips.length === 0) return;
    this.importedAnims.set(rootId, { mixer: new THREE.AnimationMixer(root), clips });
  }

  /**
   * Retarget the full shared mixamorig FBX weapon library onto a real GLB
   * fighter's own skeleton so it can play every catalog clip on its own mesh —
   * the unified retargeting pipeline. Auto-derives the bone-name map from the
   * rig's actual bones (a `def.retargetAliases` override is honoured for quirky
   * rigs); returns node-name rotation clips keyed by their catalog id, ready to
   * register on the model's own mixer. Empty when the rig has no skinned mesh
   * (e.g. the skinless Striker) or the source/clips fail to load.
   */
  private async retargetSharedLibrary(
    root: THREE.Object3D,
    def: CharacterDef,
  ): Promise<THREE.AnimationClip[]> {
    const target = findSkinnedMesh(root);
    if (!target) return [];
    try {
      const [sourceScene, clips] = await Promise.all([
        loadSkeletonSource(),
        loadClips(allReferencedClipIds()),
      ]);
      const source = makeRetargetSource(sourceScene);
      if (!source || clips.size === 0) return [];
      const map = buildRetargetNameMap(skeletonBoneNames(target.skeleton), def.retargetAliases);
      if (Object.keys(map.names).length === 0) return [];
      return retargetLibrary(target, source, clips, map);
    } catch (err) {
      console.warn("[EditorScene] shared library retarget failed", err);
      return [];
    }
  }

  /** True when a clip's tracks target Mixamo bones (`mixamorig*`). */
  private isMixamoClip(clip: THREE.AnimationClip): boolean {
    return clip.tracks.some((t) => t.name.includes("mixamorig"));
  }

  /**
   * Auto-wire Mixamo animations onto the loaded procedural rig. When an imported
   * model carries Mixamo-skeletoned clips and a procedural rig is currently
   * loaded (the dressed character), each clip is retargeted (rotation-only +
   * bone-name normalisation) so it can drive the rig's `mixamorig*` skeleton, and
   * surfaced in the Animations panel as a playable clip ON the character. No-op
   * when there's no rig (GLB catalog characters use a different skeleton naming
   * and keep their baked clips on their own mixer instead).
   */
  private autoWireMixamoClips(srcName: string, clips: THREE.AnimationClip[]): void {
    if (!this.rig || clips.length === 0) return;
    const mixamo = clips.filter((c) => this.isMixamoClip(c));
    if (mixamo.length === 0) return;
    const retargeted = mixamo.map((c) => retargetMixamoClip(c));
    const srcId = `rigimp:${++this.rigImportSeq}`;
    this.rigImportedAnims.set(srcId, { name: srcName, clips: retargeted });
    this.notify(
      `Auto-wired ${retargeted.length} Mixamo clip${retargeted.length === 1 ? "" : "s"} onto the character — play from the Animations panel.`,
      "info",
    );
  }

  /** Play one auto-wired Mixamo clip on the rig (looped, like the imported preview). */
  playRigImportedClip(srcId: string, clipName: string): void {
    if (!this.rig) return;
    const entry = this.rigImportedAnims.get(srcId);
    if (!entry) return;
    const clip = entry.clips.find((c) => c.name === clipName);
    if (!clip) return;
    this.haltImported();
    this.rig.playExternalClip(clip, true);
    this.rigImportedPlaying = `${srcId}::${clipName}`;
    this.emit();
  }

  /** Stop the currently-playing auto-wired rig clip and return the rig to idle. */
  stopRigImportedClip(): void {
    this.rig?.stopExternalClip();
    this.rigImportedPlaying = null;
    this.emit();
  }

  /** Play one clip from an imported model (stops any other imported clip first). */
  previewImportedClip(rootId: string, clipName: string): void {
    const entry = this.importedAnims.get(rootId);
    if (!entry) return;
    const clip = entry.clips.find((c) => c.name === clipName);
    if (!clip) return;
    this.haltImported();
    const action = entry.mixer.clipAction(clip);
    action.reset();
    action.play();
    this.importedAction = action;
    this.importedPlaying = `${rootId}::${clipName}`;
    this.emit();
  }

  /** Stop the currently-playing imported clip (no-op if none). */
  stopImportedClip(): void {
    this.haltImported();
    this.emit();
  }

  /** Stop every imported mixer's actions without emitting (internal helper). */
  private haltImported(): void {
    if (this.importedAction) {
      this.importedAction.stop();
      this.importedAction = null;
    }
    for (const a of this.importedAnims.values()) a.mixer.stopAllAction();
    this.importedPlaying = null;
    if (this.rigImportedPlaying) {
      this.rig?.stopExternalClip();
      this.rigImportedPlaying = null;
    }
  }

  /** Toggle the unreal-bloom postprocessing pass. */
  setBloom(on: boolean): void {
    this.bloom = on;
    this.bloomPass.enabled = on;
    this.emit();
  }

  // ── snapshot / lifecycle ───────────────────────────────────────────────────

  /** Surface a transient, auto-dismissing notice to the editor UI, then refresh. */
  private notify(text: string, kind: EditorNotice["kind"] = "info"): void {
    this.notice = { id: ++this.noticeSeq, text, kind };
    this.emit();
  }

  /** Read the first hex colour off a node's material(s), or null if it has none. */
  private nodeColor(o: EditorObject): number | null {
    const mat = (o.object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    const first = Array.isArray(mat) ? mat[0] : mat;
    const c = first && (first as THREE.MeshStandardMaterial).color;
    return c ? c.getHex() : null;
  }

  private toSnapshot(o: EditorObject, depth: number, hasChildren: boolean): EditorObjectSnapshot {
    const e = o.object.rotation;
    return {
      id: o.id,
      name: o.name,
      layerId: o.layerId,
      kind: o.kind,
      parentId: o.parentId,
      depth,
      hasChildren,
      imported: o.imported,
      // Intrinsic visibility (not the layer-masked effective value) so a scene
      // exported while a layer is hidden round-trips correctly instead of baking
      // those nodes permanently hidden on re-import.
      visible: o.baseVisible,
      selected: this.selectedIds.has(o.id),
      position: [o.object.position.x, o.object.position.y, o.object.position.z],
      rotation: [THREE.MathUtils.radToDeg(e.x), THREE.MathUtils.radToDeg(e.y), THREE.MathUtils.radToDeg(e.z)],
      scale: [o.object.scale.x, o.object.scale.y, o.object.scale.z],
      color: this.nodeColor(o),
      collider: o.collider ? { shape: o.collider.shape, dims: { ...o.collider.dims }, offset: { ...o.collider.offset } } : null,
    };
  }

  /** Flatten the parent/child graph into a stable DFS order with depth + hasChildren. */
  private orderedObjects(): { o: EditorObject; depth: number; hasChildren: boolean }[] {
    const byParent = new Map<string | null, EditorObject[]>();
    for (const o of this.objects) {
      const arr = byParent.get(o.parentId) ?? [];
      arr.push(o);
      byParent.set(o.parentId, arr);
    }
    const out: { o: EditorObject; depth: number; hasChildren: boolean }[] = [];
    const seen = new Set<string>();
    const walk = (parentId: string | null, depth: number) => {
      for (const o of byParent.get(parentId) ?? []) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        out.push({ o, depth, hasChildren: (byParent.get(o.id)?.length ?? 0) > 0 });
        walk(o.id, depth + 1);
      }
    };
    walk(null, 0);
    // Safety net: surface any node whose parent went missing as a root-level entry.
    for (const o of this.objects) {
      if (!seen.has(o.id)) {
        seen.add(o.id);
        out.push({ o, depth: 0, hasChildren: (byParent.get(o.id)?.length ?? 0) > 0 });
      }
    }
    return out;
  }

  private emit() {
    if (this.disposed) return;
    this.onChange({
      objects: this.orderedObjects().map(({ o, depth, hasChildren }) => this.toSnapshot(o, depth, hasChildren)),
      layers: this.layers.map((l) => ({ ...l })),
      selectedId: this.selectedId,
      selectedIds: [...this.selectedIds],
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      contextMenu: this.contextMenu,
      gizmo: this.gizmoMode,
      snap: this.snap,
      showColliders: this.showColliders,
      showGrid: this.showGrid,
      rigClips: this.rig ? this.rig.clipNames() : [],
      rigWeapon: this.rigWeapon,
      rigPlaying: this.rig ? this.rig.currentClipName() : "",
      rigIsVoxel: this.rig !== null,
      weapons: this.weaponLibrary(),
      equippedWeapon: this.equippedWeaponId,
      equippedTier: this.equippedTier,
      weaponMarkers: this.showMarkers,
      weaponEdit: this.weaponEditState(),
      importedClips: [...this.importedAnims.entries()].map(([rootId, a]) => ({
        rootId,
        name: this.find(rootId)?.name ?? "Model",
        clips: a.clips.map((c) => c.name),
      })),
      importedPlaying: this.importedPlaying,
      rigImportedClips: [...this.rigImportedAnims.entries()].map(([srcId, a]) => ({
        rootId: srcId,
        name: a.name,
        clips: a.clips.map((c) => c.name),
      })),
      rigImportedPlaying: this.rigImportedPlaying,
      fishEye: this.fishEye,
      fishEyeActive: this.fishEyeActive,
      terrainLayerId: this.terrainLayerId,
      buildKind: this.buildKind,
      buildHeight: this.buildHeight,
      buildThickness: this.buildThickness,
      bloom: this.bloom,
      busy: this.busy || (this.rig?.isOneShotActive ?? false),
      playing: this.playing,
      firstPerson: this.controller?.isFirstPerson ?? false,
      grudgeChars: [...this.grudge.keys(), ...this.catalogPlay.keys()].map((rootId) => ({
        rootId,
        name: this.find(rootId)?.name ?? "Character",
      })),
      hasRig: this.rig !== null,
      skillLab: this.skillLabSnapshot(),
      notice: this.notice,
      playHud: this.playing
        ? {
            health: 1,
            skills: this.playSkills.map((s) => ({
              key: s.key,
              bind: s.bind,
              label: s.label,
              glyph: s.glyph,
              cooldown: s.cooldown,
              readyAt: this.skillReadyAt.get(s.key) ?? 0,
            })),
          }
        : null,
    });
  }

  /** React can poll this to refresh the clip list once async rig clips land. */
  refresh(): void {
    this.emit();
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.outlinePass.setSize(w, h);
    this.bloomPass.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private onResize = () => this.resize();

  dispose(): void {
    this.disposed = true;
    this.unsubscribeMouseFeel();
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDownCapture, true);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.removeEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.removeEventListener("contextmenu", this.onContextMenu);
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      this.previewMesh.geometry.dispose();
    }
    this.previewMat.dispose();
    this.stopPlay();
    this.unloadRig();
    if (this.markerGroup) {
      this.scene.remove(this.markerGroup);
      this.markerSocket?.geometry.dispose();
      (this.markerSocket?.material as THREE.Material | undefined)?.dispose();
      this.markerTip?.geometry.dispose();
      (this.markerTip?.material as THREE.Material | undefined)?.dispose();
      this.markerLine?.geometry.dispose();
      (this.markerLine?.material as THREE.Material | undefined)?.dispose();
      this.markerGroup = null;
    }
    // removeObject routes grudge roots to unloadGrudge (which disposes the avatar
    // + its GPU resources); iterating a snapshot keeps that mutation safe.
    const live = new Set(this.objects.map((o) => o.object));
    for (const o of [...this.objects]) this.removeObject(o);
    // Managed objects that were deleted are kept alive on the history stacks for
    // redo; dispose those orphans now (skip ones still disposed via the live set).
    const seen = new Set<THREE.Object3D>();
    for (const state of [...this.undoStack, ...this.redoStack]) {
      for (const h of state.objects) {
        if (live.has(h.object) || seen.has(h.object)) continue;
        seen.add(h.object);
        if (!h.object.parent) this.disposeObject3D(h.object);
      }
    }
    this.undoStack = [];
    this.redoStack = [];
    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.vfx.dispose();
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.scene.remove(this.axes);
    this.axes.geometry.dispose();
    (this.axes.material as THREE.Material).dispose();
    this.outlinePass.dispose();
    this.bloomPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
