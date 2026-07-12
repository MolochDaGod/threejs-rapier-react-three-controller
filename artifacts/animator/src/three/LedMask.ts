import * as THREE from "three";
import { SHELLS, type ShellId, DEFAULT_SHELL, loadShellId, saveShellId, PANEL_Z } from "./LedMaskShells";

export type { ShellId };

export type FaceType =
  | "smile"
  | "happy"
  | "angry"
  | "surprise"
  | "sad"
  | "love"
  | "wink"
  | "neutral"
  | "sleepy"
  | "skeptical"
  | "mischief"
  | "dead"
  | "cool"
  | "matrix"
  | "scan";
export type MaskState = "idle" | "talk" | "shout" | "whisper" | "attack" | "cast";

/** LED matrix resolution (columns × rows) painted across the visor. */
const GW = 36;
const GH = 24;
const CELL = 0.034; // world size of one LED cell
// PANEL_Z (head-local z of the LED panel front) is owned by LedMaskShells — the
// single source of truth shared with the shell builders' depth invariant.
/** Default LED-head size. Pulse animations multiply off this base scale. */
const HEAD_BASE_SCALE = 0.8;

/** Per-expression accent colour — the "mood" of the machine god. */
const FACE_COLOR: Record<FaceType, number> = {
  smile: 0x36e3ff,
  happy: 0xffd23f,
  angry: 0xff2f1c,
  surprise: 0xffb020,
  sad: 0x4aa8ff,
  love: 0xff4d8d,
  wink: 0x3fffd2,
  neutral: 0x9fb4c8,
  sleepy: 0x7c8cff,
  skeptical: 0xffa033,
  mischief: 0xff5a1e,
  dead: 0x8892a0,
  cool: 0xb45cff,
  matrix: 0x32ff6e,
  scan: 0x49d6ff,
};

/**
 * Voxel LED Mask — a cube "voxel" head wearing a hooded visor whose face is a
 * real volumetric LED dot-matrix: {@link GW}×{@link GH} individually-lit emissive
 * voxels (one InstancedMesh) driven by a procedural intensity field.
 *
 * Expressions are drawn into a grid buffer (eyes blink, mouth talks). Switching
 * faces doesn't cut — the LEDs DISSOLVE and re-form: a radial+noise reveal sweep
 * ignites the new pattern voxel-by-voxel, each one popping forward in z with a
 * white-hot spark before settling. A soft bloom plane and white-core mixing give
 * the panel a genuine emissive-LED glow. The banner lives on its own ticker strip
 * BELOW the chin — never over the face.
 *
 * Self-contained: owns its render loop + resize handling, cleans up on dispose().
 */
export class LedMask {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;

  private head!: THREE.Mesh;
  private mask!: THREE.Mesh;
  private shellGroup!: THREE.Group;
  private shellId: ShellId = DEFAULT_SHELL;
  private leds!: THREE.InstancedMesh;
  private glow!: THREE.Mesh;
  private glowMat!: THREE.MeshBasicMaterial;

  // Banner ticker (separate strip, NOT on the face).
  private bannerCanvas!: HTMLCanvasElement;
  private bannerCtx!: CanvasRenderingContext2D;
  private bannerTexture!: THREE.CanvasTexture;
  private bannerStrip!: THREE.Mesh;
  private bannerText = "HIGHPEAK DIGITAL";
  private bannerOffset = 0;
  private bannerOn = false; // off by default: no ticker strip, no scroll updates

  // LED intensity fields (row-major, length GW*GH).
  private dispBuf = new Float32Array(GW * GH); // currently shown
  private prevBuf = new Float32Array(GW * GH); // pattern at swap time
  private targetBuf = new Float32Array(GW * GH); // freshly drawn target
  private readonly cellPhase = new Float32Array(GW * GH); // forming reveal order
  private formT = 1; // 0→1 dissolve/re-form progress (1 = settled)

  private currentFace: FaceType = "smile";
  private currentState: MaskState = "idle";
  private animationTime = 0;
  private glow01 = 1; // global brightness (surges on shout)
  private glowTarget = 1;
  private glitchT = 0; // attack glitch decay
  private prevColor = new THREE.Color(FACE_COLOR.smile);
  private newColor = new THREE.Color(FACE_COLOR.smile);

  // --- Active Mode: external live drive. When non-null these override the
  // internal blink/talk derivation so the webcam (eyes/expression) and mic
  // (mouth lip-sync) can puppet the face in real time. Null = autonomous. ----
  private liveMouth: number | null = null;
  private liveEyes: number | null = null;

  // --- Damage system: the face is a body. Hits knock out LEDs, low health
  // degrades the whole panel (colour bleed, flicker, dead columns), and a sharp
  // impact flash + recoil sells every blow. ----------------------------------
  private health = 1; // 1 = pristine, 0 = barely lit wreck
  private readonly deadBase = new Float32Array(GW * GH); // persistent burn-out from low health
  private readonly deadSplat = new Float32Array(GW * GH); // localized scars from each hit (slowly fade)
  private readonly cellRand = new Float32Array(GW * GH); // stable per-cell noise (deterministic burn order)
  private hitFlashT = 0; // white→red impact flash decay
  private hitShake = 0; // head-recoil decay
  private painT = 0; // brief grimace bias after a hit
  private hitX = (GW - 1) / 2; // last impact origin (grid coords)
  private hitY = 9.5;

  // --- Cast system: energy spirals INTO the eyes during charge, then discharges
  // as a shockwave that ripples out across the matrix. ------------------------
  private castMode: "none" | "charge" | "release" = "none";
  private castT = 0; // progress within the active cast phase
  private castColor = new THREE.Color(0x8be9ff);

  // --- Personality: idle gaze drift + micro-darts so the face feels awake. ---
  private gazeX = 0;
  private gazeY = 0;
  private gazeTgtX = 0;
  private gazeTgtY = 0;
  private gazeTimer = 1.2;
  // Pointer-driven gaze: the eyes follow the cursor while it is active, then
  // resume their living idle drift once the pointer goes quiet.
  private pointerGazeX = 0;
  private pointerGazeY = 0;
  private pointerHold = 0;

  // Scratch (avoid per-frame allocation across ~860 instances).
  private readonly _m = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();
  private readonly _p = new THREE.Vector3();
  private readonly _s = new THREE.Vector3();
  private readonly _c = new THREE.Color();
  private readonly _base = new THREE.Color();
  private readonly _white = new THREE.Color(0xffffff);
  private readonly _glitchRed = new THREE.Color(0xff2a1a);
  private readonly _amber = new THREE.Color(0xff5a22); // low-health colour bleed
  private readonly _hitWhite = new THREE.Color(0xffe9d6); // impact flash tint

  private raf = 0;
  private disposed = false;
  private readonly timers = new Set<number>();
  private resizeObs: ResizeObserver | null = null;

  /** True when WebGL could not be created (e.g. headless sandbox). */
  readonly webglFailed: boolean;

  /** Fires when the mask auto-returns to idle (e.g. a cast finishes) so hosts
   * can re-sync their own UI state. */
  onAutoIdle: (() => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 100);
    this.camera.position.set(0, 1.15, 3.6);
    this.camera.lookAt(0, 1.0, 0);

    // Per-cell reveal phase: ignite from the centre outward + a noise jitter so
    // the face "forms" as an organic sweep rather than a flat fade.
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const nx = (x - (GW - 1) / 2) / (GW / 2);
        const ny = (y - (GH - 1) / 2) / (GH / 2);
        const radial = Math.min(1, Math.hypot(nx, ny));
        this.cellPhase[y * GW + x] = radial * 0.62 + Math.random() * 0.38;
        // Stable per-cell burn-out order: edges + a noise jitter die first as
        // health drops, so the face decays organically from the outside in.
        this.cellRand[y * GW + x] = radial * 0.5 + Math.random() * 0.5;
      }
    }

    let failed = false;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      this.renderer.setClearColor(0x000000, 0);
    } catch {
      failed = true;
    }
    this.webglFailed = failed;

    this.buildLights();
    this.buildHead();
    this.shellId = loadShellId();
    this.shellGroup = new THREE.Group();
    this.head.add(this.shellGroup);
    this.buildShell(this.shellId);
    this.buildMask();
    this.buildLeds();
    this.buildGlow();
    this.buildBanner();

    // Seed both buffers with the starting face so the first paint is settled.
    this.drawFace(this.targetBuf, this.currentFace, 0, 1, 0);
    this.dispBuf.set(this.targetBuf);
    this.prevBuf.set(this.targetBuf);

    if (this.renderer) {
      this.resize();
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(canvas);
      this.loop();
    }
  }

  private buildLights() {
    this.scene.add(new THREE.AmbientLight(0x223044, 0.7));
    const key = new THREE.DirectionalLight(0x88aaff, 1.1);
    key.position.set(5, 10, 6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x4466ff, 0.9);
    rim.position.set(-6, 3, -4);
    this.scene.add(rim);
  }

  private buildHead() {
    const geo = new THREE.BoxGeometry(1.4, 1.6, 1.4);
    const mat = new THREE.MeshPhongMaterial({ color: 0x1c1f2b, shininess: 12, flatShading: true });
    this.head = new THREE.Mesh(geo, mat);
    this.head.position.y = 1.1;
    this.head.scale.setScalar(HEAD_BASE_SCALE);
    this.scene.add(this.head);
  }

  /**
   * Build the active shell (the housing AROUND the LED face) into the shell
   * group. The group is parented to the head, so every shell rides the head's
   * idle bob / recoil / cast lean for free. Shells frame the face opening but
   * never cover it — see {@link PANEL_Z} and the depth invariant in
   * LedMaskShells.
   */
  private buildShell(id: ShellId) {
    const def = SHELLS.find((s) => s.id === id) ?? SHELLS[0];
    def.build(this.shellGroup);
  }

  /** Dispose the current shell's geometry + materials and empty the group. */
  private disposeShellMeshes() {
    this.shellGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.shellGroup.clear();
  }

  /**
   * Swap the active housing shell at runtime. The previous shell's meshes and
   * materials are disposed (leak-free) before the new one is built; the LED face,
   * visor, glow plane, and banner are untouched. The choice persists across
   * sessions and is restored on next load.
   */
  setShell(id: ShellId) {
    if (id === this.shellId || !SHELLS.some((s) => s.id === id)) return;
    this.shellId = id;
    this.disposeShellMeshes();
    this.buildShell(id);
    saveShellId(id);
  }

  /** The currently active shell id. */
  getShell(): ShellId {
    return this.shellId;
  }

  private buildMask() {
    // Dark recessed visor: off-LEDs read as black against it. Its front face MUST
    // sit BEHIND the LED panel (PANEL_Z) — the LEDs are additive/depth-tested, so a
    // visor poking in front of them would occlude the whole face (it'd render
    // "behind the screen"). Front face = z + depth/2 = 0.7 + 0.75 = 1.45 < PANEL_Z.
    this.mask = new THREE.Mesh(
      new THREE.BoxGeometry(1.36, 1.12, 1.5),
      new THREE.MeshPhongMaterial({ color: 0x05060c, shininess: 60, flatShading: true }),
    );
    this.mask.position.set(0, -0.05, 0.7);
    this.head.add(this.mask);
  }

  private buildLeds() {
    // One emissive voxel per LED. Additive blending so lit cells glow and dark
    // cells vanish into the visor; depthWrite off keeps the bloom layering clean.
    const geo = new THREE.BoxGeometry(CELL * 0.82, CELL * 0.82, CELL * 1.3);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.leds = new THREE.InstancedMesh(geo, mat, GW * GH);
    this.leds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.leds.position.set(0, -0.05, 0);
    this.head.add(this.leds);
    // Initialise colour buffer so instanceColor exists before first render.
    for (let i = 0; i < GW * GH; i++) this.leds.setColorAt(i, this._white);
  }

  private buildGlow() {
    // Soft radial bloom behind the matrix — fakes emissive glow without a post FX
    // pass. Colour + opacity track the active face and overall brightness.
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.32)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    this.glowMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.5,
    });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.5), this.glowMat);
    this.glow.position.set(0, -0.05, PANEL_Z - 0.06);
    this.head.add(this.glow);
  }

  private buildBanner() {
    this.bannerCanvas = document.createElement("canvas");
    this.bannerCanvas.width = 1024;
    this.bannerCanvas.height = 96;
    this.bannerCtx = this.bannerCanvas.getContext("2d", { alpha: true })!;
    this.bannerTexture = new THREE.CanvasTexture(this.bannerCanvas);
    this.bannerTexture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: this.bannerTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.85,
    });
    // Its OWN strip, well below the chin — the banner never sits over the face.
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.235), mat);
    strip.position.set(0, 0.18, 1.05);
    strip.visible = this.bannerOn; // hidden by default — no glow when off
    this.scene.add(strip);
    this.bannerStrip = strip;
  }

  private resize() {
    if (!this.renderer) return;
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // --- public controls ---------------------------------------------------

  setFace(face: FaceType) {
    if (face === this.currentFace && this.formT >= 1) {
      // re-trigger a re-form even on the same face for a satisfying re-ignite.
    }
    this.currentFace = face;
    // Snapshot what's on screen, then start the dissolve/re-form sweep.
    this.prevBuf.set(this.dispBuf);
    this.prevColor.copy(this.newColor);
    this.newColor.setHex(FACE_COLOR[face]);
    this.formT = 0;
    this.glowTarget = 1.35; // brief surge as the new face ignites
    this.after(420, () => (this.glowTarget = this.brightnessFor(this.currentState)));
  }

  /**
   * Aim the eyes at a normalized pointer position over the canvas: `nx`/`ny`
   * each in [-1, 1], with x left→right and y top→bottom. The gaze tracks the
   * point for a short hold, then eases back to its living idle drift once the
   * pointer stops moving or leaves.
   */
  setGazeTarget(nx: number, ny: number) {
    this.pointerGazeX = THREE.MathUtils.clamp(nx, -1, 1) * 4.5;
    this.pointerGazeY = THREE.MathUtils.clamp(ny, -1, 1) * 2.6;
    this.pointerHold = 2.4;
  }

  /** Release pointer tracking; the eyes resume idle drift. */
  clearGazeTarget() {
    this.pointerHold = 0;
  }

  /**
   * Active Mode: drive the mouth open amount (0..1) from an external source
   * (the user's live mic), overriding the built-in talk/idle mouth animation.
   * Pass `null` to release control back to the autonomous animation.
   */
  setLiveMouth(open: number | null) {
    this.liveMouth = open === null ? null : THREE.MathUtils.clamp(open, 0, 1);
  }

  /**
   * Active Mode: drive eye openness (0..1) from an external source (the user's
   * webcam blink), overriding the built-in blink. `null` releases control.
   */
  setLiveEyes(open: number | null) {
    this.liveEyes = open === null ? null : THREE.MathUtils.clamp(open, 0, 1);
  }

  setBanner(text: string) {
    const next = text.trim();
    if (!next) return;
    this.bannerText = next;
    this.bannerOffset = this.bannerCanvas.width;
  }

  /**
   * Turn the scrolling ticker strip on or off. When off, the strip mesh is
   * hidden (no glow) and per-frame scroll updates are skipped entirely. When
   * turned back on, the marquee restarts from the right edge with its current
   * text. Off is the default.
   */
  setBannerEnabled(on: boolean) {
    this.bannerOn = on;
    if (this.bannerStrip) this.bannerStrip.visible = on;
    if (on) this.bannerOffset = this.bannerCanvas.width;
  }

  /** Whether the scrolling banner is currently visible/running. */
  isBannerEnabled() {
    return this.bannerOn;
  }

  // --- Damage ------------------------------------------------------------

  /**
   * Take a hit. `amount` (0..1) drops health; `at` (optional, NDC-ish -1..1)
   * aims the impact splatter so a blow from the left scars the left of the face.
   * Knocks out a burst of LEDs, flashes the panel white→red, and recoils the head.
   */
  takeDamage(amount: number, at?: { x: number; y: number }) {
    const amt = THREE.MathUtils.clamp(amount, 0, 1);
    this.health = THREE.MathUtils.clamp(this.health - amt, 0, 1);
    this.rebuildDeadFromHealth();

    // Impact origin in grid space (default: jitter around the eyes/centre).
    const cx = at ? (GW - 1) / 2 + at.x * (GW * 0.32) : (GW - 1) / 2 + (Math.random() - 0.5) * 10;
    const cy = at ? GH / 2 - at.y * (GH * 0.3) : 9.5 + (Math.random() - 0.5) * 6;
    this.hitX = cx;
    this.hitY = cy;

    // Splatter: punch out a cluster of cells around the impact, scaled by force.
    const r = 3 + amt * 7;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(GW - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(GH - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) continue;
        const fall = 1 - d / r;
        if (Math.random() < fall * (0.5 + amt * 0.5)) {
          const i = y * GW + x;
          this.deadSplat[i] = Math.min(1, this.deadSplat[i] + fall * (0.6 + amt));
        }
      }
    }

    this.hitFlashT = Math.min(1.4, 0.9 + amt);
    this.hitShake = Math.min(1.5, 0.8 + amt);
    this.painT = 1;
    this.glitchT = Math.max(this.glitchT, 0.5 + amt * 0.5);
    this.glow01 = Math.max(this.glow01, 1.6 + amt);
  }

  /** Set absolute health (0..1) — repairs or degrades the panel to match. */
  setHealth(h: number) {
    this.health = THREE.MathUtils.clamp(h, 0, 1);
    this.rebuildDeadFromHealth();
  }

  getHealth() {
    return this.health;
  }

  /** Full repair: re-ignite the whole matrix and clear every scar. */
  repair() {
    this.health = 1;
    this.deadBase.fill(0);
    this.deadSplat.fill(0);
    this.hitFlashT = 0;
    this.painT = 0;
    // A satisfying re-form sweep as the face boots back to life.
    this.prevBuf.set(this.dispBuf);
    this.formT = 0;
    this.glowTarget = 1.4;
    this.after(420, () => (this.glowTarget = this.brightnessFor(this.currentState)));
  }

  /** Recompute persistent burn-out from current health (edges die first). */
  private rebuildDeadFromHealth() {
    const dmg = 1 - this.health;
    // At 0 health up to ~55% of cells burn out, edges + noisy cells first.
    const thresh = dmg * 0.55;
    for (let i = 0; i < GW * GH; i++) {
      const margin = thresh - this.cellRand[i];
      this.deadBase[i] = margin <= 0 ? 0 : Math.min(1, margin * 6);
    }
  }

  // --- Cast --------------------------------------------------------------

  /**
   * Fire a cast: energy spirals INTO the eyes (charge), then discharges as a
   * shockwave rippling out across the matrix (release). `color` tints the energy.
   */
  beginCast(color?: number) {
    if (color !== undefined) this.castColor.setHex(color);
    this.currentState = "cast";
    this.castMode = "charge";
    this.castT = 0;
    this.head.rotation.set(0.06, 0, 0);
    this.glowTarget = 1.5;
  }

  triggerState(state: MaskState) {
    this.currentState = state;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();

    this.head.rotation.set(0, 0, 0);
    this.mask.rotation.set(0, 0, 0);
    this.head.scale.setScalar(HEAD_BASE_SCALE);
    if (state !== "cast") this.castMode = "none";
    this.glowTarget = this.brightnessFor(state);

    switch (state) {
      case "idle":
        break;
      case "cast":
        this.beginCast();
        break;
      case "talk":
        this.head.rotation.x = 0.1;
        break;
      case "shout":
        this.head.rotation.x = -0.16;
        this.head.scale.setScalar(HEAD_BASE_SCALE * 1.06);
        this.glow01 = 1.9; // instant pop, decays back to target
        this.after(280, () => this.head.scale.setScalar(HEAD_BASE_SCALE));
        break;
      case "whisper":
        this.head.rotation.set(0.05, 0.16, 0);
        break;
      case "attack":
        this.glitchT = 1;
        this.head.rotation.y = -0.34;
        this.mask.rotation.y = -0.2;
        this.glow01 = 2.1;
        this.after(170, () => {
          this.head.rotation.y = 0.34;
          this.mask.rotation.y = 0.2;
        });
        this.after(520, () => {
          this.head.rotation.set(0, 0, 0);
          this.mask.rotation.set(0, 0, 0);
        });
        break;
    }
  }

  // --- internals ---------------------------------------------------------

  private brightnessFor(state: MaskState): number {
    if (state === "shout") return 1.5;
    if (state === "whisper") return 0.55;
    if (state === "attack") return 1.3;
    if (state === "cast") return 1.4;
    return 1;
  }

  private after(ms: number, fn: () => void) {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(id);
  }

  // ---- LED pattern painting ---------------------------------------------

  /** Soft-edged disc into the grid buffer (max-combined). */
  private stamp(buf: Float32Array, cx: number, cy: number, r: number, val: number) {
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(GW - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(GH - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        const a = Math.max(0, Math.min(1, r + 0.5 - d));
        const i = y * GW + x;
        if (a * val > buf[i]) buf[i] = a * val;
      }
    }
  }

  /** Soft-edged ellipse (for eyes / open mouths). */
  private ellipse(buf: Float32Array, cx: number, cy: number, rx: number, ry: number, val: number) {
    const x0 = Math.max(0, Math.floor(cx - rx - 1));
    const x1 = Math.min(GW - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1));
    const y1 = Math.min(GH - 1, Math.ceil(cy + ry + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const nd = ((x - cx) / rx) ** 2 + ((y - cy) / Math.max(0.4, ry)) ** 2;
        const a = nd <= 1 ? 1 : Math.max(0, 1 - (nd - 1) * 2.2);
        const i = y * GW + x;
        if (a * val > buf[i]) buf[i] = a * val;
      }
    }
  }

  /** Stamp a curved mouth (sign>0 smile, sign<0 frown) or an open ellipse. */
  private mouth(buf: Float32Array, sign: number, open: number, width: number, val: number) {
    const mx = (GW - 1) / 2;
    const my = 17.5;
    if (open > 0.18) {
      this.ellipse(buf, mx, my, width * 0.5, 0.8 + open * 3.2, val);
      return;
    }
    const steps = 22;
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const px = mx + (u - 0.5) * width;
      const bow = 1 - 4 * (u - 0.5) ** 2; // 1 at centre, 0 at ends
      // Grid-y grows downward (see render map: ((GH-1)/2 - y)), so a smile
      // (sign>0) must push the centre DOWN (larger py) with corners up.
      const py = my + sign * bow * 2.4;
      this.stamp(buf, px, py, 1.1, val);
    }
  }

  /** Stamp a curved stroke (sign<0 = ⌣ trough, sign>0 = ⌢ crest) — eyes/brows. */
  private arc(buf: Float32Array, cx: number, cy: number, width: number, depth: number, sign: number, val: number) {
    const steps = 16;
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const px = cx + (u - 0.5) * width;
      const bow = 1 - 4 * (u - 0.5) ** 2; // 1 at centre, 0 at ends
      const py = cy + sign * bow * depth;
      this.stamp(buf, px, py, 0.95, val);
    }
  }

  /** A small heart (two lobes + a tapering point) — love eyes. */
  private heart(buf: Float32Array, cx: number, cy: number, s: number, val: number) {
    this.stamp(buf, cx - s * 0.5, cy - s * 0.45, s * 0.62, val);
    this.stamp(buf, cx + s * 0.5, cy - s * 0.45, s * 0.62, val);
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      const w = (1 - u) * s * 1.5;
      const yy = cy - s * 0.05 + u * s * 1.35;
      this.stamp(buf, cx - w / 2, yy, 0.62, val);
      this.stamp(buf, cx + w / 2, yy, 0.62, val);
    }
  }

  /** An X (dead / KO eyes). */
  private cross(buf: Float32Array, cx: number, cy: number, s: number, val: number) {
    for (let k = -s; k <= s; k += 0.5) {
      this.stamp(buf, cx + k, cy + k, 0.7, val);
      this.stamp(buf, cx + k, cy - k, 0.7, val);
    }
  }

  /** Paint expression `face` into `buf`. eyeOpen/mouthOpen drive blink & talk. */
  private drawFace(buf: Float32Array, face: FaceType, t: number, eyeOpen: number, mouthOpen: number) {
    buf.fill(0.05); // dormant panel baseline (faint powered grid)
    const lx = 11;
    const rx = GW - 1 - 11;
    const ey = 9.5;
    // Personality: the pupils drift/dart so the gaze feels alive, not painted-on.
    const gx = this.gazeX;
    const gy = this.gazeY;

    const eyes = (rxr: number, ryr: number, val = 1) => {
      this.ellipse(buf, lx + gx, ey + gy, rxr, ryr * eyeOpen, val);
      this.ellipse(buf, rx + gx, ey + gy, rxr, ryr * eyeOpen, val);
    };

    switch (face) {
      case "smile":
        eyes(2.2, 2.6);
        this.mouth(buf, 1, mouthOpen, 18, 1);
        break;
      case "angry":
        eyes(2.4, 2.0);
        // angled brows
        for (let k = 0; k <= 8; k++) {
          this.stamp(buf, lx - 2.5 + k * 0.7, ey - 4.2 + k * 0.4, 0.9, 1);
          this.stamp(buf, rx + 2.5 - k * 0.7, ey - 4.2 + k * 0.4, 0.9, 1);
        }
        this.mouth(buf, -1, mouthOpen, 16, 1);
        break;
      case "happy": {
        // beaming joy — upturned ⌣ "smiling eyes" + a wide open grin
        this.arc(buf, lx + gx, ey + gy + 1, 5.2, 2.2, -1, 1);
        this.arc(buf, rx + gx, ey + gy + 1, 5.2, 2.2, -1, 1);
        this.mouth(buf, 1, Math.max(mouthOpen, 0.3), 22, 1);
        // cheek sparkles to sell the delight
        this.stamp(buf, lx - 4 + gx, ey + 4, 0.8, 0.6 + 0.4 * Math.sin(t * 6));
        this.stamp(buf, rx + 4 + gx, ey + 4, 0.8, 0.6 + 0.4 * Math.sin(t * 6 + 1.5));
        break;
      }
      case "surprise":
        eyes(2.9, 3.1);
        this.ellipse(buf, (GW - 1) / 2, 18, 3, 3 + mouthOpen * 2, 1);
        break;
      case "sad": {
        // droopy eyes + worried inner-up brows + frown + a falling tear
        eyes(2.0, 2.2);
        for (let k = 0; k <= 6; k++) {
          this.stamp(buf, lx + 2.5 - k * 0.7 + gx, ey - 3.6 - k * 0.35 + gy, 0.85, 0.95);
          this.stamp(buf, rx - 2.5 + k * 0.7 + gx, ey - 3.6 - k * 0.35 + gy, 0.85, 0.95);
        }
        this.mouth(buf, -1, mouthOpen, 15, 1);
        const tear = ey + gy + 3 + ((t * 4) % 6);
        this.stamp(buf, lx + gx, tear, 0.9, 0.85);
        break;
      }
      case "love": {
        this.heart(buf, lx + gx, ey + gy, 2.4, 1);
        this.heart(buf, rx + gx, ey + gy, 2.4, 1);
        this.mouth(buf, 1, mouthOpen, 18, 1);
        break;
      }
      case "wink": {
        // one bright open eye, one playful closed ⌣ wink, with a smirk
        this.ellipse(buf, lx + gx, ey + gy, 2.3, 2.7 * eyeOpen, 1);
        this.arc(buf, rx + gx, ey + gy + 0.4, 5.2, 2.0, -1, 1);
        this.mouth(buf, 1, mouthOpen, 17, 1);
        break;
      }
      case "neutral":
        eyes(2.0, 2.2);
        this.mouth(buf, 0, mouthOpen, 14, 0.85);
        break;
      case "sleepy": {
        // heavy half-lidded eyes + a small, slow breathing mouth
        this.arc(buf, lx + gx, ey + gy, 5.2, 0.7, -1, 0.9);
        this.arc(buf, rx + gx, ey + gy, 5.2, 0.7, -1, 0.9);
        this.mouth(buf, 0, 0.22 + 0.14 * (0.5 + 0.5 * Math.sin(t * 1.4)), 6, 0.8);
        break;
      }
      case "skeptical": {
        // one wide eye, one squint, one cocked brow, a flat unimpressed mouth
        this.ellipse(buf, lx + gx, ey + gy, 2.3, 2.5 * eyeOpen, 1);
        this.ellipse(buf, rx + gx, ey + gy + 0.5, 2.1, 1.3 * eyeOpen, 1);
        this.arc(buf, lx + gx, ey - 3.7 + gy, 6, 1.3, 1, 1);
        this.mouth(buf, -0.35, mouthOpen, 12, 0.9);
        break;
      }
      case "mischief": {
        // the HIGHPEAK "evil grin": slanted devious eyes + a wide toothy smile
        for (let k = 0; k <= 7; k++) {
          this.stamp(buf, lx - 3 + k * 0.85 + gx, ey + 1.4 - k * 0.5 + gy, 1.05, 1);
          this.stamp(buf, rx + 3 - k * 0.85 + gx, ey + 1.4 - k * 0.5 + gy, 1.05, 1);
        }
        const mx = (GW - 1) / 2;
        for (let k = 0; k <= 26; k++) {
          const u = k / 26;
          const bow = 1 - 4 * (u - 0.5) ** 2;
          this.stamp(buf, mx + (u - 0.5) * 24, 16.4 + bow * 3.4 + mouthOpen * 1.5, 1.0, 1);
        }
        for (let x = -9; x <= 9; x += 3) this.stamp(buf, mx + x, 15.8, 0.7, 0.85); // teeth
        break;
      }
      case "dead": {
        // KO'd — X eyes + a flat little line, with a faint flicker
        const f = 0.85 + 0.15 * Math.sin(t * 13);
        this.cross(buf, lx + gx, ey + gy, 2.4, f);
        this.cross(buf, rx + gx, ey + gy, 2.4, f);
        this.mouth(buf, 0, 0.25, 7, 0.8);
        break;
      }
      case "cool": {
        // visor sunglasses bar + smirk
        for (let x = lx - 3; x <= rx + 3; x++) this.stamp(buf, x, ey, 1.3, 1);
        this.stamp(buf, rx + 3.5, ey + 0.6, 1.2, 1);
        const mx = (GW - 1) / 2;
        for (let k = 0; k <= 16; k++) {
          const u = k / 16;
          this.stamp(buf, mx + (u - 0.4) * 13, 17.5 - u * 1.6, 1.0, 0.9);
        }
        break;
      }
      case "matrix": {
        // glyphless digital rain (no literal text on the face)
        for (let x = 0; x < GW; x += 2) {
          const seed = (x * 73856093) % 997;
          const speed = 5 + (seed % 9);
          const headY = (t * speed + seed) % (GH + 8);
          for (let trail = 0; trail < 10; trail++) {
            const y = Math.floor(headY - trail);
            if (y < 0 || y >= GH) continue;
            const v = trail === 0 ? 1 : Math.max(0, 0.85 - trail * 0.1);
            const i = y * GW + x;
            if (v > buf[i]) buf[i] = v;
          }
        }
        break;
      }
      case "scan": {
        eyes(1.8, 2.0, 0.9);
        const sy = ey + 3 + Math.sin(t * 2.2) * 6;
        for (let x = 2; x < GW - 2; x++) this.stamp(buf, x, sy, 0.9, 1);
        this.mouth(buf, 0, mouthOpen, 12, 0.7);
        break;
      }
    }
  }

  // ---- per-frame --------------------------------------------------------

  private updateBanner() {
    const ctx = this.bannerCtx;
    const w = this.bannerCanvas.width;
    const h = this.bannerCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.font = "bold 58px 'Courier New', monospace";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#6cf3ff";
    ctx.shadowColor = "#27d6ff";
    ctx.shadowBlur = 18;
    const text = this.bannerText.toUpperCase() + "   ◆   ";
    const tw = ctx.measureText(text).width;
    let x = this.bannerOffset;
    // tile the text so it reads as a continuous marquee
    while (x < w) {
      ctx.fillText(text, x, h / 2);
      x += tw;
    }
    this.bannerOffset -= 2.4;
    if (this.bannerOffset <= -tw) this.bannerOffset += tw;
    this.bannerTexture.needsUpdate = true;
  }

  private loop = () => {
    if (this.disposed || !this.renderer) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = (this.animationTime += 0.016);

    // Advance the cast charge→release state machine.
    if (this.castMode === "charge") {
      this.castT += 0.016 / 0.7;
      if (this.castT >= 1) {
        this.castMode = "release";
        this.castT = 0;
        this.glow01 = 2.6; // discharge pop
      }
    } else if (this.castMode === "release") {
      this.castT += 0.016 / 0.5;
      if (this.castT >= 1) {
        this.castMode = "none";
        this.castT = 0;
        this.head.rotation.x = 0;
        this.currentState = "idle";
        this.glowTarget = this.brightnessFor("idle");
        this.onAutoIdle?.();
      }
    }
    const castChargeP = this.castMode === "charge" ? this.castT : 0;
    const castReleaseP = this.castMode === "release" ? this.castT : 0;

    // Personality: idle gaze drift + occasional darts (locked centre when busy).
    this.gazeTimer -= 0.016;
    if (this.gazeTimer <= 0) {
      this.gazeTimer = 0.8 + Math.random() * 2.4;
      if (Math.random() < 0.6) {
        this.gazeTgtX = (Math.random() - 0.5) * 4;
        this.gazeTgtY = (Math.random() - 0.5) * 2;
      } else {
        this.gazeTgtX = 0;
        this.gazeTgtY = 0;
      }
    }
    const busy = this.castMode !== "none" || this.currentState === "attack";
    if (busy) {
      this.gazeTgtX = 0;
      this.gazeTgtY = 0;
    }
    // Pointer tracking overrides the idle drift while the cursor is active.
    this.pointerHold = Math.max(0, this.pointerHold - 0.016);
    const followPointer = this.pointerHold > 0 && !busy;
    const tgtX = followPointer ? this.pointerGazeX : this.gazeTgtX;
    const tgtY = followPointer ? this.pointerGazeY : this.gazeTgtY;
    const ease = followPointer ? 0.3 : 0.18;
    this.gazeX += (tgtX - this.gazeX) * ease;
    this.gazeY += (tgtY - this.gazeY) * ease;

    // Damage timers: impact flash, recoil shake, grimace.
    this.hitFlashT = Math.max(0, this.hitFlashT - 0.04);
    this.hitShake = Math.max(0, this.hitShake - 0.05);
    this.painT = Math.max(0, this.painT - 0.02);
    const dmg = 1 - this.health;

    // Gentle cinematic parallax + idle bob, plus hit recoil + cast lean.
    this.camera.position.x = Math.sin(t * 0.25) * 0.28;
    this.camera.position.y = 1.15 + Math.sin(t * 0.4) * 0.02;
    this.camera.lookAt(0, 1.0, 0);
    this.head.position.y = 1.1 + (this.currentState === "idle" ? Math.sin(t * 1.4) * 0.03 : 0);
    this.head.position.x = (Math.random() - 0.5) * this.hitShake * 0.14;
    this.head.rotation.z = (Math.random() - 0.5) * this.hitShake * 0.14;
    if (castChargeP > 0) this.head.rotation.x = 0.06 + 0.1 * castChargeP;
    else if (castReleaseP > 0) this.head.rotation.x = -0.12 * (1 - castReleaseP);

    // Blink + mouth drive (pain squints the eyes and grits the mouth).
    const blink = t % 3.6;
    let eyeOpen = blink < 0.14 ? Math.abs(blink - 0.07) / 0.07 : 1;
    eyeOpen *= 1 - this.painT * 0.55;
    // Active Mode override: live webcam blink drives the eyes directly.
    if (this.liveEyes !== null) eyeOpen = this.liveEyes * (1 - this.painT * 0.4);
    let mouthOpen = 0;
    if (this.currentState === "talk") mouthOpen = 0.3 + 0.3 * Math.max(0, Math.sin(t * 13));
    else if (this.currentState === "shout") mouthOpen = 0.85;
    else if (this.currentState === "whisper") mouthOpen = 0.12;
    else if (this.currentState === "attack") mouthOpen = 0.9;
    else if (this.currentState === "cast") mouthOpen = 0.2 + castChargeP * 0.4;
    // Active Mode override: live mic level lip-syncs the mouth to real speech.
    if (this.liveMouth !== null) mouthOpen = this.liveMouth;
    mouthOpen = Math.max(mouthOpen, this.painT * 0.55);

    // Draw the live target pattern, then advance the dissolve/re-form sweep.
    this.drawFace(this.targetBuf, this.currentFace, t, eyeOpen, mouthOpen);
    if (this.formT < 1) this.formT = Math.min(1, this.formT + 0.026);
    this.glitchT = Math.max(0, this.glitchT - 0.022);
    this.glow01 += (this.glowTarget - this.glow01) * 0.12;

    const breathe = 0.9 + 0.1 * Math.sin(t * 2);
    const bright = this.glow01 * breathe;

    // Blend the panel colour across the transition; flash red on glitch, then
    // bleed toward amber/red as health drops (a wounded, overheating panel).
    this._base.copy(this.prevColor).lerp(this.newColor, this.formT);
    if (this.glitchT > 0) this._base.lerp(this._glitchRed, this.glitchT * 0.6);
    if (dmg > 0.01) this._base.lerp(this._amber, Math.min(0.72, dmg * 0.85));

    // Cast energy origins (grid space): both eyes + face centre.
    const lEyeX = 11;
    const rEyeX = GW - 1 - 11;
    const eyeY = 9.5;
    const cFaceX = (GW - 1) / 2;

    let sumGlow = 0;
    for (let i = 0; i < GW * GH; i++) {
      const x = i % GW;
      const y = (i / GW) | 0;

      // forming reveal: each cell ignites when formT passes its phase.
      const ph = this.cellPhase[i];
      const reveal = THREE.MathUtils.clamp((this.formT - ph + 0.18) / 0.3, 0, 1);
      let v = this.prevBuf[i] * (1 - reveal) + this.targetBuf[i] * reveal;
      // ignition spark: a bright pop right as a cell crosses its reveal edge.
      const spark = reveal > 0 && reveal < 1 ? Math.sin(reveal * Math.PI) : 0;
      v = v + spark * 0.9;
      if (this.glitchT > 0 && Math.random() < this.glitchT * 0.06) v = Math.random();

      // Cast: charge spirals rings INTO the eyes; release fires a shockwave out.
      let castAdd = 0;
      if (castChargeP > 0) {
        const ringR = (1 - castChargeP) * 8;
        const dL = Math.hypot(x - lEyeX, y - eyeY);
        const dR = Math.hypot(x - rEyeX, y - eyeY);
        castAdd += (Math.exp(-((dL - ringR) ** 2) * 0.5) + Math.exp(-((dR - ringR) ** 2) * 0.5)) * castChargeP;
        if (dL < 2.6 || dR < 2.6) castAdd += castChargeP * 0.7;
      }
      if (castReleaseP > 0) {
        const ringR = castReleaseP * 26;
        const dC = Math.hypot(x - cFaceX, y - eyeY);
        castAdd += Math.exp(-((dC - ringR) ** 2) * 0.12) * (1 - castReleaseP) * 1.7;
        if (castReleaseP < 0.4) {
          const dL = Math.hypot(x - lEyeX, y - eyeY);
          const dR = Math.hypot(x - rEyeX, y - eyeY);
          if (dL < 2.8 || dR < 2.8) castAdd += (0.4 - castReleaseP) * 3;
        }
      }
      v += castAdd;

      // Damage: knocked-out cells go dark (with electrical sputter); low health
      // adds global flicker. Scars fade slowly so each hit lingers as a wound.
      const dead = Math.min(1, this.deadBase[i] + this.deadSplat[i]);
      if (dead > 0) {
        v *= 1 - dead;
        if (dead > 0.25 && Math.random() < 0.04 * dead) v += 0.5 + Math.random() * 0.5;
      }
      if (dmg > 0.02 && Math.random() < dmg * 0.03) v *= 0.35;
      if (this.deadSplat[i] > 0) this.deadSplat[i] = Math.max(0, this.deadSplat[i] - 0.0016);

      // Impact flash: a bright shock around the last hit point.
      let flash = 0;
      if (this.hitFlashT > 0) {
        const dH = Math.hypot(x - this.hitX, y - this.hitY);
        flash = this.hitFlashT * Math.max(0, 1 - dH / 15);
        v += flash * 1.2;
      }

      v = Math.min(1.9, v);
      this.dispBuf[i] = v;
      sumGlow += v;

      // position (head-local); cells pop forward in z as they ignite/charge/flash.
      const pop = (spark + Math.min(1, castAdd) * 0.6 + flash * 0.5) * 0.07;
      this._p.set((x - (GW - 1) / 2) * CELL, ((GH - 1) / 2 - y) * CELL, PANEL_Z + pop);
      const sc = (0.35 + 0.65 * reveal) * (0.55 + 0.45 * Math.min(1, v));
      this._s.set(sc, sc, 1);
      this._m.compose(this._p, this._q, this._s);
      this.leds.setMatrixAt(i, this._m);

      // colour: white-hot core, cast tint, impact-flash tint; scaled by brightness.
      const vb = Math.min(1.6, v * bright);
      const hot = THREE.MathUtils.clamp((vb - 0.75) / 0.45, 0, 1) * 0.75;
      this._c.copy(this._base).lerp(this._white, hot);
      if (castAdd > 0.05) this._c.lerp(this.castColor, Math.min(0.85, castAdd));
      if (flash > 0.05) this._c.lerp(this._hitWhite, Math.min(0.9, flash));
      this._c.multiplyScalar(Math.min(1.4, vb));
      this.leds.setColorAt(i, this._c);
    }
    this.leds.instanceMatrix.needsUpdate = true;
    if (this.leds.instanceColor) this.leds.instanceColor.needsUpdate = true;

    // Bloom plane tracks face colour + overall lit area.
    this.glowMat.color.copy(this._base);
    this.glowMat.opacity = 0.28 + Math.min(0.5, (sumGlow / (GW * GH)) * 1.6) * bright;

    if (this.bannerOn) this.updateBanner();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.resizeObs?.disconnect();
    this.resizeObs = null;

    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.glowMat?.map?.dispose();
    this.bannerTexture?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
  }
}
