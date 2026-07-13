/**
 * Avatar Edit 3D stage — renders one composed cube head in a small studio
 * scene: unit-cube head with six pixel-art canvas textures (nearest-filtered),
 * plus protrusion boxes (ears / tusks / nose / hair / braids / horns).
 * Pointer-drag orbits the head, wheel/pinch zooms; the head holds still
 * unless the user moves it.
 *
 * Owns its renderer/loop; call {@link dispose} on unmount. `setConfig` is
 * cheap: face canvases redraw in place and only protrusion meshes rebuild.
 */
import * as THREE from "three";
import { FACE, type Grid, cssHex } from "./pixels";
import type { AvatarConfig } from "./catalog";
import { composeHead, composeTalkFrames, type FaceName } from "./composeHead";
import { createHairBoxMaterial, createHairFx, type HairBoxMaterial, type HairFx } from "./hairStrands";
import { createHairMotionRig, type HairMotionRig } from "./hairMotion";
import { mountHat, resolveMountedHatId, type HatMount } from "./hats";

/** BoxGeometry material index order: +x, -x, +y, -y, +z, -z. */
const FACE_ORDER: FaceName[] = ["right", "left", "top", "bottom", "front", "back"];

/** Talking-preview playback rate (frames per second). */
const TALK_PREVIEW_FPS = 8;

export class HeadStage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private headGroup = new THREE.Group();
  private headMesh: THREE.Mesh | null = null;
  private protrusionGroup = new THREE.Group();
  private canvases = new Map<FaceName, { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }>();
  private faceMats: THREE.MeshStandardMaterial[] = [];
  private protMats = new Map<number, THREE.MeshStandardMaterial>();
  private hairMats: HairBoxMaterial[] = [];
  private protGeo = new THREE.BoxGeometry(1, 1, 1);

  private raf = 0;
  private disposed = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private yaw = 0.55;
  private pitch = 0.12;
  private zoom = 2.6;
  private pedestal: THREE.Mesh | null = null;
  private resizeObs: ResizeObserver | null = null;
  private detachInput: (() => void) | null = null;
  private hatMount: HatMount | null = null;
  private hatKey = "";
  private hairFx: HairFx | null = null;
  private motionRig: HairMotionRig | null = null;
  // Talking-expression preview: the front face cycles through the composed
  // talk frames so the editor shows the actual in-game speech loop.
  private talkFrames: Grid[] | null = null;
  private talkShown = -1;

  constructor(private mount: HTMLElement) {
    // WebGLRenderer creation is the throw-prone step (no WebGL context); it
    // runs before any side effects so a failure here leaks nothing. Everything
    // after it is wrapped so a mid-constructor throw still tears down cleanly.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    try {
      this.init();
    } catch (err) {
      this.dispose();
      throw err;
    }
  }

  private init(): void {
    const { mount } = this;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACES keeps hair clearcoat/sheen from blowing out into chalky white.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    mount.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = "none";

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
    this.camera.position.set(0, 0.12, 2.6);
    this.camera.lookAt(0, 0, 0);

    // Studio lights tuned for hair sheen: warm key, cool rim, soft hemi fill
    // so strand clearcoat/sheen lobes actually catch light without flat ambient.
    const key = new THREE.DirectionalLight(0xfff1dc, 2.15);
    key.position.set(2.2, 2.8, 3.1);
    const rim = new THREE.DirectionalLight(0x9ec4ff, 1.35);
    rim.position.set(-2.8, 1.4, -2.5);
    const kick = new THREE.DirectionalLight(0xffe8d2, 0.55);
    kick.position.set(0.4, -0.8, 2.4);
    const hemi = new THREE.HemisphereLight(0xdde6f5, 0x2a2430, 0.55);
    const fill = new THREE.AmbientLight(0x6a7588, 0.35);
    this.scene.add(key, rim, kick, hemi, fill);

    // pedestal disc so the head doesn't float in a void
    this.pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 0.8, 0.08, 40),
      new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.85, metalness: 0.2 }),
    );
    this.pedestal.position.y = -0.98;
    this.scene.add(this.pedestal);

    // head cube — six per-face canvas textures
    for (const name of FACE_ORDER) {
      const canvas = document.createElement("canvas");
      canvas.width = FACE;
      canvas.height = FACE;
      const tex = new THREE.CanvasTexture(canvas);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.canvases.set(name, { canvas, tex });
      this.faceMats.push(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 }));
    }
    this.headMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.faceMats);
    this.headGroup.add(this.headMesh, this.protrusionGroup);
    this.scene.add(this.headGroup);

    // pointer orbit
    const el = this.renderer.domElement;
    const down = (e: PointerEvent) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.lastX) * 0.012;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - this.lastY) * 0.008, -0.9, 0.9);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    };
    const up = () => {
      this.dragging = false;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.zoom = THREE.MathUtils.clamp(this.zoom + e.deltaY * 0.0022, 1.6, 4.2);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    this.detachInput = () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
    };

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(mount);
    this.resize();

    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      // No auto-spin: the head stays exactly where the user left it.
      this.headGroup.rotation.set(this.pitch, this.yaw, 0);
      this.headGroup.position.y = Math.sin(now * 0.0012) * 0.02;
      this.hairFx?.update(now * 0.001);
      // Hanging hair/beard: wind sway + gravity lean against the orbit tilt.
      this.motionRig?.update(now * 0.001, this.headGroup.quaternion);
      if (this.talkFrames) {
        const frame = Math.floor(now * 0.001 * TALK_PREVIEW_FPS) % this.talkFrames.length;
        if (frame !== this.talkShown) {
          this.talkShown = frame;
          const front = this.canvases.get("front");
          if (front) {
            drawGrid(front.canvas, this.talkFrames[frame]);
            front.tex.needsUpdate = true;
          }
        }
      }
      this.camera.position.set(0, 0.12, this.zoom);
      this.camera.lookAt(0, 0, 0);
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private resize(): void {
    const w = Math.max(1, this.mount.clientWidth);
    const h = Math.max(1, this.mount.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Recompose + redraw the head for a new config. */
  setConfig(cfg: AvatarConfig): void {
    if (this.disposed) return;
    const head = composeHead(cfg);
    for (const [name, { canvas, tex }] of this.canvases) {
      drawGrid(canvas, head.faces[name]);
      tex.needsUpdate = true;
    }

    // Talking expression previews the real speech loop; anything else shows
    // the static face just drawn above.
    this.talkFrames = cfg.expression === "talking" ? composeTalkFrames(cfg) : null;
    this.talkShown = -1;

    // rebuild protrusions (geometry is shared; plain materials pooled by
    // colour). Hair boxes get per-box pixel strand textures (owned here,
    // rebuilt each pass); fine instanced strands overlay them.
    for (const child of [...this.protrusionGroup.children]) this.protrusionGroup.remove(child);
    for (const hm of this.hairMats) hm.dispose();
    this.hairMats = [];
    // Fresh motion rig each rebuild (pivot groups die with the old meshes).
    const rig = createHairMotionRig();
    this.motionRig = rig;
    head.protrusions.forEach((p, i) => {
      let mat: THREE.MeshStandardMaterial;
      // Hair AND beard boxes get the realistic strand material; only ears,
      // noses, tusks etc. stay pooled flat colours.
      if (p.hair || p.slot === "facialHair") {
        const hm = createHairBoxMaterial(p, i);
        this.hairMats.push(hm);
        mat = hm.mat;
      } else {
        let pooled = this.protMats.get(p.color);
        if (!pooled) {
          pooled = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.9, metalness: 0 });
          this.protMats.set(p.color, pooled);
        }
        mat = pooled;
      }
      const mesh = new THREE.Mesh(this.protGeo, mat);
      mesh.scale.set(p.w, p.h, p.d);
      if (p.motion) {
        // Hanging hair/beard swings from a pivot at its roots.
        this.protrusionGroup.add(rig.wrap(p as typeof p & { motion: NonNullable<typeof p.motion> }, mesh));
      } else {
        mesh.position.set(p.x, p.y, p.z);
        this.protrusionGroup.add(mesh);
      }
    });

    // fine hair strands (single InstancedMesh; owns its geometry/material)
    this.hairFx?.dispose();
    this.hairFx = createHairFx(
      head.protrusions.filter((p) => p.hair || p.slot === "facialHair"),
    );
    if (this.hairFx) this.headGroup.add(this.hairFx.object);

    // 3D GLB hat — remount when hat/headgear-horns OR placement adjust changes.
    // resolveMountedHatId: explicit hat wins; headgear "horns" → horns.glb.
    const mountedHat = resolveMountedHatId(cfg);
    const hatAdjust = mountedHat === "horns" && cfg.hat === "none" ? cfg.adjust?.headgear : cfg.adjust?.hat;
    const hatKey = `${mountedHat}|${JSON.stringify(hatAdjust ?? null)}|hg:${cfg.headgear}`;
    if (hatKey !== this.hatKey) {
      this.hatKey = hatKey;
      this.hatMount?.dispose();
      this.hatMount = mountHat(this.headGroup, mountedHat, hatAdjust);
    }
  }

  /** Upscaled PNG data-URL of the current front face (pixel-art export). */
  exportFrontPng(cfg: AvatarConfig, scale = 16): string {
    const head = composeHead(cfg);
    const src = document.createElement("canvas");
    src.width = FACE;
    src.height = FACE;
    drawGrid(src, head.faces.front);
    const out = document.createElement("canvas");
    out.width = FACE * scale;
    out.height = FACE * scale;
    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }

  /**
   * Transparent PNG snapshot of the full 3D head (current orbit angle) at a
   * fixed square size — the "3D portrait" export.
   */
  exportSnapshotPng(size = 512): string {
    // Render once at the export size into the existing renderer, snapshot,
    // then restore the live viewport.
    const prevW = this.mount.clientWidth || 1;
    const prevH = this.mount.clientHeight || 1;
    const bob = this.headGroup.position.y;
    this.headGroup.position.y = 0;
    if (this.pedestal) this.pedestal.visible = false;
    this.renderer.setSize(size, size, false);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL("image/png");
    this.headGroup.position.y = bob;
    if (this.pedestal) this.pedestal.visible = true;
    this.renderer.setSize(prevW, prevH, false);
    this.camera.aspect = prevW / prevH;
    this.camera.updateProjectionMatrix();
    return url;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.detachInput?.();
    // Detach the hat BEFORE the scene traverse below — hat clones share the
    // cached template geometry/materials and must never be disposed with it.
    this.hatMount?.dispose();
    this.hatMount = null;
    // Hair strands own their geometry/material; dispose (which also detaches)
    // before the traverse so they aren't double-freed there.
    this.hairFx?.dispose();
    this.hairFx = null;
    for (const { tex } of this.canvases.values()) tex.dispose();
    for (const m of this.faceMats) m.dispose();
    for (const m of this.protMats.values()) m.dispose();
    for (const hm of this.hairMats) hm.dispose();
    this.hairMats = [];
    this.protGeo.dispose();
    this.headMesh?.geometry.dispose();
    const underProtrusions = (o: THREE.Object3D): boolean => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent)
        if (p === this.protrusionGroup) return true;
      return false;
    };
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh !== this.headMesh && !underProtrusions(mesh)) {
        mesh.geometry?.dispose();
        const mm = mesh.material;
        if (Array.isArray(mm)) mm.forEach((m) => m.dispose());
        else mm?.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** Blit a 16×16 grid to its canvas. */
function drawGrid(canvas: HTMLCanvasElement, grid: Grid): void {
  const ctx = canvas.getContext("2d")!;
  for (let y = 0; y < FACE; y++)
    for (let x = 0; x < FACE; x++) {
      ctx.fillStyle = cssHex(grid[y * FACE + x]);
      ctx.fillRect(x, y, 1, 1);
    }
}
