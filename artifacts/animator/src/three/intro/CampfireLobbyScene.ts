/**
 * 4-seat character campfire — floating islands + fireplace only.
 *
 * Fixes the live regression (Ethereal Falls sky + tiny furniture diorama +
 * miniature heroes). This page is one product surface:
 *  - Heroes ~1.8 m SI, framed large for seat selection
 *  - Stage = floating islands + real campfire (no dungeon.glb, no furniture set)
 *  - Night sky with stars only — not Ethereal Falls curtains / overlook
 */
import * as THREE from "three";
import { createAnimatedCharacter } from "../explorer/loader";
import type { Animator } from "../explorer/Animator";
import type { CharacterLook } from "../explorer/types";
import type { VoxelPart } from "../explorer/rig";
import { CHARACTER_HEIGHT_M } from "../types";
import { baseIdToRaceKey, type GenesisHeroOption } from "../../auth/grudoxRoster";
import {
  loadVoxelAvatarForCharacter,
  partOverridesFromSave,
  voxelAvatarToLook,
  VOXEL_AVATAR_EVENT,
} from "../explorer/voxelAvatarSave";

export interface CampfireSlotView {
  index: number;
  hero: GenesisHeroOption | null;
  worldPos: THREE.Vector3;
}

/** Arc radius so four human-scale heroes read clearly around the fire. */
const SEAT_RADIUS = 3.85;
const HERO_H = CHARACTER_HEIGHT_M;
/** Closer, lower camera — heroes fill the frame (not a distant overlook). */
const CAM_POS = new THREE.Vector3(0.2, 2.35, 6.6);
const CAM_LOOK = new THREE.Vector3(0, 1.05, -0.35);

const LOOK_RACES: Record<string, Partial<CharacterLook>> = {
  human: { skin: "#c98c5a", shirt: "#3d5a80", pants: "#2e3440", cape: true, capeColor: "#1a2740" },
  orc: { skin: "#5a8f3a", shirt: "#4a3020", pants: "#2a2018", cape: false },
  undead: { skin: "#9aa8b0", shirt: "#2a2038", pants: "#1a1520", cape: true, capeColor: "#2a1840" },
  barbarian: { skin: "#c07040", shirt: "#8b3a1a", pants: "#3a2818", cape: false },
  dwarf: { skin: "#c09060", shirt: "#5a4a30", pants: "#3a3028", cape: false },
  elf: { skin: "#e8d0b0", shirt: "#2a6050", pants: "#1a3028", cape: true, capeColor: "#143028" },
};

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class CampfireLobbyScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private fireSprites: THREE.Sprite[] = [];
  private mist?: THREE.Points;
  private stars?: THREE.Points;
  private aurora?: THREE.Mesh[];
  private ro?: ResizeObserver;
  private heroes: (Animator | null)[] = [null, null, null, null];
  private seats: THREE.Group[] = [];
  private labels: { mesh: THREE.Sprite; name: string }[] = [];
  private selected = 0;
  private orbit = 0;
  private onSelect: ((index: number) => void) | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private envRoot = new THREE.Group();
  private lastHeroes: GenesisHeroOption[] = [];
  private fireLight: THREE.PointLight | null = null;
  private fireLight2: THREE.PointLight | null = null;
  private islandBob: { root: THREE.Object3D; baseY: number; phase: number }[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    opts?: { onSelect?: (index: number) => void },
  ) {
    this.onSelect = opts?.onSelect ?? null;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(w, h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;

    // Warm night void — campfire is the hero light, not purple falls.
    this.scene.background = new THREE.Color(0x050810);
    this.scene.fog = new THREE.FogExp2(0x080c16, 0.022);

    this.camera = new THREE.PerspectiveCamera(44, w / h, 0.08, 200);
    this.camera.position.copy(CAM_POS);
    this.camera.lookAt(CAM_LOOK);

    this.scene.add(this.envRoot);
    this.buildFloatingStage();
    this.buildSeats();
    this.buildCampfire();
    this.buildStars();
    this.buildSoftAurora();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener(VOXEL_AVATAR_EVENT, this.onAvatarSaved);

    this.animate = this.animate.bind(this);
    this.raf = requestAnimationFrame(this.animate);
  }

  /** Load up to 4 roster heroes as Explorer rigs around the fire. */
  async setHeroes(heroes: GenesisHeroOption[]): Promise<void> {
    if (this.disposed) return;
    this.lastHeroes = heroes.slice(0, 4);
    for (let i = 0; i < 4; i++) {
      const prev = this.heroes[i];
      if (prev) {
        this.seats[i]?.remove(prev.root);
        prev.dispose();
        this.heroes[i] = null;
      }
    }
    for (let i = 0; i < 4; i++) {
      const hero = heroes[i] ?? null;
      this.updateLabel(i, hero?.name ?? (i === 0 ? "Empty seat" : "—"));
      if (!hero) continue;
      try {
        const raceKey = baseIdToRaceKey(hero.baseId) || hero.raceKey;
        const saved = loadVoxelAvatarForCharacter(hero.id || null);
        let look: CharacterLook = {
          skin: "#c98c5a",
          shirt: "#c0392b",
          pants: "#2e3440",
          hat: "none",
          hatColor: "#b03030",
          avatarHead: true,
          ...LOOK_RACES[raceKey],
        };
        let parts: Partial<Record<VoxelPart, string>> | null = null;
        if (saved) {
          look = { ...look, ...voxelAvatarToLook(saved) };
          parts = partOverridesFromSave(saved);
        }
        const anim = await createAnimatedCharacter({
          height: HERO_H,
          weapon: "sword",
          look,
          classes: ["unarmed", "sword"],
        });
        if (this.disposed) {
          anim.dispose();
          return;
        }
        if (parts) {
          for (const [part, hex] of Object.entries(parts)) {
            if (hex) anim.character.setPartColor(part as VoxelPart, hex);
          }
        }
        anim.setWeapon("sword", true);
        anim.root.position.set(0, 0, 0);
        anim.root.rotation.y = 0;
        anim.root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(anim.root);
        const size = box.getSize(new THREE.Vector3());
        if (size.y > 0.05) {
          const s = (HERO_H / size.y) * (anim.root.scale.x || 1);
          // Keep human-scale — never tabletop minis or giants.
          anim.root.scale.setScalar(THREE.MathUtils.clamp(s, 0.9, 1.2));
          anim.root.updateMatrixWorld(true);
          const b2 = new THREE.Box3().setFromObject(anim.root);
          anim.root.position.y -= b2.min.y;
        }
        const seat = this.seats[i]!;
        seat.add(anim.root);
        this.heroes[i] = anim;
      } catch (err) {
        console.warn("[CampfireLobby] hero load failed", hero.name, err);
      }
    }
    this.setSelected(this.selected);
  }

  setSelected(index: number): void {
    this.selected = Math.max(0, Math.min(3, index | 0));
    for (let i = 0; i < 4; i++) {
      const ring = this.seats[i]?.userData.ring as THREE.Mesh | undefined;
      if (!ring) continue;
      const mat = ring.material as THREE.MeshBasicMaterial;
      mat.color.setHex(i === this.selected ? 0x5fe0ff : 0x1a3048);
      mat.opacity = i === this.selected ? 0.95 : 0.32;
      this.updateLabel(i, this.labels[i]?.name ?? "—");
    }
  }

  getSelected(): number {
    return this.selected;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener(VOXEL_AVATAR_EVENT, this.onAvatarSaved);
    this.ro?.disconnect();
    for (const h of this.heroes) h?.dispose();
    this.heroes = [null, null, null, null];
    this.renderer.dispose();
  }

  // ── private ────────────────────────────────────────────────────────────

  private onAvatarSaved = (): void => {
    if (this.lastHeroes.length) void this.setHeroes(this.lastHeroes);
  };

  /**
   * Stage = central floating island (fireplace) + distant sky islands.
   * No furniture, no dungeon GLB, no heightmap overlook.
   */
  private buildFloatingStage(): void {
    this.scene.add(new THREE.AmbientLight(0x1a2438, 0.38));
    this.scene.add(new THREE.HemisphereLight(0x6a8ab8, 0x0a0810, 0.48));
    const moon = new THREE.DirectionalLight(0xc4d8ff, 0.55);
    moon.position.set(-7, 14, 5);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.near = 1;
    moon.shadow.camera.far = 40;
    const d = 14;
    moon.shadow.camera.left = -d;
    moon.shadow.camera.right = d;
    moon.shadow.camera.top = d;
    moon.shadow.camera.bottom = -d;
    this.scene.add(moon);

    const rim = new THREE.DirectionalLight(0xff9a55, 0.28);
    rim.position.set(2, 3, 6);
    this.scene.add(rim);

    // Main camp platform — large enough for 4 human-scale seats
    const center = this.makeIsland({
      topR: 5.2,
      bottomR: 3.1,
      height: 1.65,
      grass: 0x1a3224,
      rock: 0x2a3140,
    });
    center.position.set(0, -0.2, 0.1);
    this.envRoot.add(center);
    this.islandBob.push({ root: center, baseY: -0.2, phase: 0 });

    // Dirt fire ring on the grass
    const dirt = new THREE.Mesh(
      new THREE.CircleGeometry(2.15, 48),
      new THREE.MeshStandardMaterial({
        color: 0x2a1c12,
        roughness: 0.95,
        metalness: 0.02,
        emissive: 0x1a0c06,
        emissiveIntensity: 0.25,
      }),
    );
    dirt.rotation.x = -Math.PI / 2;
    dirt.position.y = 0.03;
    this.envRoot.add(dirt);

    // Distant sky islands (silhouette only — not seats)
    const far: Array<[number, number, number, number]> = [
      [-16, 2.8, -20, 2.6],
      [14, 4.0, -24, 2.2],
      [-10, 6.2, -30, 1.8],
      [10, 5.5, -28, 2.0],
      [0, 7.8, -34, 3.0],
      [-20, 3.5, -14, 1.5],
      [18, 4.2, -16, 1.6],
    ];
    for (const [x, y, z, s] of far) {
      const isle = this.makeIsland({
        topR: 1.15 * s,
        bottomR: 0.65 * s,
        height: 0.95 * s,
        grass: 0x122418,
        rock: 0x18141f,
      });
      isle.position.set(x, y, z);
      isle.rotation.y = x * 0.15;
      this.envRoot.add(isle);
      this.islandBob.push({ root: isle, baseY: y, phase: hash2(x, z) * Math.PI * 2 });
    }

    this.envRoot.add(this.buildFarPines());
    this.mist = this.buildMist();
    this.scene.add(this.mist);
  }

  private makeIsland(opts: {
    topR: number;
    bottomR: number;
    height: number;
    grass: number;
    rock: number;
  }): THREE.Group {
    const g = new THREE.Group();
    const { topR, bottomR, height, grass, rock } = opts;

    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(topR, topR * 0.97, 0.22, 18),
      new THREE.MeshStandardMaterial({ color: grass, roughness: 0.94, metalness: 0.02 }),
    );
    top.position.y = 0.11;
    top.receiveShadow = true;
    top.castShadow = true;
    g.add(top);

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(topR * 0.94, bottomR, height, 14),
      new THREE.MeshStandardMaterial({
        color: rock,
        roughness: 0.92,
        metalness: 0.06,
        emissive: 0x0a0812,
        emissiveIntensity: 0.12,
      }),
    );
    body.position.y = -height * 0.5;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(bottomR * 0.92, height * 0.6, 12),
      new THREE.MeshStandardMaterial({ color: 0x101218, roughness: 0.95 }),
    );
    tip.position.y = -height - height * 0.22;
    tip.rotation.x = Math.PI;
    tip.castShadow = true;
    g.add(tip);

    // Soft underglow so islands read as floating
    const glow = new THREE.PointLight(0x6655cc, 0.4, topR * 5, 2);
    glow.position.set(0, -0.5, 0);
    g.add(glow);

    return g;
  }

  private buildFarPines(): THREE.Group {
    const g = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x241810, roughness: 0.95 });
    const needleMat = new THREE.MeshStandardMaterial({
      color: 0x0c2216,
      roughness: 0.9,
      emissive: 0x041208,
      emissiveIntensity: 0.1,
    });
    const placements: Array<[number, number, number, number]> = [
      [-15, 2.8, -19, 1.8],
      [13, 4.0, -23, 1.5],
      [-9, 6.2, -29, 1.35],
      [9, 5.5, -27, 1.4],
      [-18, 3.2, -12, 1.2],
      [16, 3.8, -14, 1.25],
      [-6, 7.5, -33, 1.6],
      [5, 7.2, -32, 1.45],
    ];
    for (const [x, y, z, s] of placements) {
      const tree = new THREE.Group();
      const trunkH = 1.15 * s;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08 * s, 0.12 * s, trunkH, 6),
        trunkMat,
      );
      trunk.position.y = trunkH * 0.5;
      tree.add(trunk);
      for (let L = 0; L < 3; L++) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry((0.55 - L * 0.11) * s, 0.72 * s, 7),
          needleMat,
        );
        cone.position.y = trunkH * 0.5 + L * 0.42 * s;
        tree.add(cone);
      }
      tree.position.set(x, y + 0.12, z);
      g.add(tree);
    }
    return g;
  }

  /** Real campfire — logs, rock ring, flame sprites, warm lights. No furniture. */
  private buildCampfire(): void {
    const fire = new THREE.Group();
    fire.name = "campfire";

    const logMat = new THREE.MeshStandardMaterial({ color: 0x2e1c10, roughness: 1 });
    // Teepee stack
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.25, 7), logMat);
      log.position.set(Math.cos(a) * 0.32, 0.45, Math.sin(a) * 0.32);
      log.rotation.z = Math.cos(a) * 0.72;
      log.rotation.x = -Math.sin(a) * 0.72;
      log.castShadow = true;
      fire.add(log);
    }
    // Base cross-logs
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 1.1, 6), logMat);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = (i / 3) * Math.PI;
      log.position.y = 0.1;
      log.castShadow = true;
      fire.add(log);
    }

    // Rock ring
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3a3e48, roughness: 0.92 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + hash2(i, 3) * 0.2;
      const s = 0.2 + hash2(i, 7) * 0.12;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
      rock.position.set(Math.cos(a) * 0.95, s * 0.45, Math.sin(a) * 0.95);
      rock.rotation.set(hash2(i, 1) * 2, hash2(i, 2) * 2, 0);
      rock.castShadow = true;
      fire.add(rock);
    }

    const flameTex = makeFlameTexture();
    for (let i = 0; i < 7; i++) {
      const mat = new THREE.SpriteMaterial({
        map: flameTex,
        color: i % 2 === 0 ? 0xff8a30 : 0xffc868,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sp = new THREE.Sprite(mat);
      const w = 0.72 - i * 0.055;
      sp.scale.set(w, w * 1.7, 1);
      sp.position.set((hash2(i, 4) - 0.5) * 0.2, 0.42 + i * 0.1, (hash2(i, 5) - 0.5) * 0.2);
      sp.userData.baseW = w;
      sp.userData.phase = i * 1.15;
      this.fireSprites.push(sp);
      fire.add(sp);
    }

    // Bright warm fire — heroes should read lit from the center
    const light = new THREE.PointLight(0xff7a2e, 28, 18, 1.8);
    light.position.set(0, 1.0, 0);
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    fire.add(light);
    this.fireLight = light;

    const fill = new THREE.PointLight(0xffaa55, 10, 12, 2);
    fill.position.set(0, 0.45, 0.8);
    fire.add(fill);
    this.fireLight2 = fill;

    // Soft ground glow disc
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 32),
      new THREE.MeshBasicMaterial({
        color: 0xff6a20,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;
    fire.add(glow);

    fire.position.set(0, 0.02, 0.15);
    this.scene.add(fire);
  }

  private buildSeats(): void {
    for (let i = 0; i < 4; i++) {
      // Fan seats across the camera-facing arc
      const ang = -Math.PI * 0.52 + (i / 3) * Math.PI * 1.04;
      const x = Math.sin(ang) * SEAT_RADIUS;
      const z = -Math.cos(ang) * SEAT_RADIUS * 0.58 - 0.55;

      // Per-seat floating pad (clear standing platform, not furniture)
      const pad = this.makeIsland({
        topR: 1.25,
        bottomR: 0.72,
        height: 0.9,
        grass: 0x1c3428,
        rock: 0x262c38,
      });
      pad.position.set(x, 0.08 + (i % 2) * 0.05, z);
      this.envRoot.add(pad);
      this.islandBob.push({ root: pad, baseY: pad.position.y, phase: i * 1.35 });

      const g = new THREE.Group();
      g.position.set(x, pad.position.y + 0.2, z);
      // Face the fire
      g.rotation.y = Math.atan2(-x, -z + 0.15);
      g.userData.slotIndex = i;

      // Selection ring under feet
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.68, 0.9, 48),
        new THREE.MeshBasicMaterial({
          color: 0x1a3048,
          transparent: true,
          opacity: 0.32,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      g.userData.ring = ring;
      g.add(ring);

      // Simple log bench behind hero (human scale prop only — not dungeon furniture)
      const log = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.18, 1.25, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.95 }),
      );
      log.rotation.z = Math.PI / 2;
      log.position.set(0, 0.16, 0.48);
      log.castShadow = true;
      g.add(log);

      // Click proxy at chest height
      const proxy = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6, 0.6, 2.0, 12),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      proxy.position.y = 1.0;
      proxy.userData.slotIndex = i;
      g.add(proxy);

      this.scene.add(g);
      this.seats.push(g);

      const label = this.makeLabel("…");
      label.position.set(0, 2.55, 0);
      g.add(label);
      this.labels.push({ mesh: label, name: "…" });
    }
  }

  private makeLabel(text: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = "rgba(6,12,20,0.78)";
    ctx.fillRect(8, 8, 240, 48);
    ctx.strokeStyle = "rgba(95,224,255,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, 240, 48);
    ctx.fillStyle = "#cfe8ff";
    ctx.font = "bold 22px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text.slice(0, 18), 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(1.65, 0.4, 1);
    spr.userData.canvas = canvas;
    spr.userData.tex = tex;
    return spr;
  }

  private updateLabel(i: number, name: string): void {
    const entry = this.labels[i];
    if (!entry) return;
    entry.name = name;
    const canvas = entry.mesh.userData.canvas as HTMLCanvasElement;
    const tex = entry.mesh.userData.tex as THREE.CanvasTexture;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 256, 64);
    const on = i === this.selected;
    ctx.fillStyle = on ? "rgba(8,28,40,0.88)" : "rgba(6,12,20,0.78)";
    ctx.fillRect(8, 8, 240, 48);
    ctx.strokeStyle = on ? "rgba(95,224,255,0.75)" : "rgba(95,224,255,0.25)";
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, 240, 48);
    ctx.fillStyle = on ? "#5fe0ff" : "#cfe8ff";
    ctx.font = "bold 22px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name.slice(0, 18), 128, 32);
    tex.needsUpdate = true;
  }

  private buildMist(): THREE.Points {
    const n = 160;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 32;
      pos[i * 3 + 1] = Math.random() * 5 - 0.5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 32 - 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xb8a888,
      size: 0.14,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    return new THREE.Points(geo, mat);
  }

  /** Night sky stars — not Ethereal Falls curtains. */
  private buildStars(): void {
    const n = 360;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.48;
      const r = 75;
      pos[i * 3] = Math.cos(theta) * Math.sin(phi) * r;
      pos[i * 3 + 1] = Math.cos(phi) * r * 0.7 + 8;
      pos[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * r - 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xd0e0ff,
      size: 0.32,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
  }

  /** Soft distant color wash — cheap, no falls / no GLB. */
  private buildSoftAurora(): void {
    this.aurora = [];
    const specs: Array<{ x: number; z: number; w: number; h: number; hue: number; op: number }> = [
      { x: -12, z: -40, w: 18, h: 28, hue: 0x3a6a9a, op: 0.12 },
      { x: 8, z: -44, w: 22, h: 32, hue: 0x4a5080, op: 0.1 },
      { x: 0, z: -48, w: 14, h: 24, hue: 0x2a5a70, op: 0.09 },
    ];
    for (const s of specs) {
      const mat = new THREE.MeshBasicMaterial({
        color: s.hue,
        transparent: true,
        opacity: s.op,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
      mesh.position.set(s.x, s.h * 0.28, s.z);
      this.aurora.push(mesh);
      this.scene.add(mesh);
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.seats, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (typeof o.userData.slotIndex === "number") {
          this.setSelected(o.userData.slotIndex);
          this.onSelect?.(o.userData.slotIndex);
          return;
        }
        o = o.parent;
      }
    }
  };

  private resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private animate(): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    for (const b of this.islandBob) {
      b.root.position.y = b.baseY + Math.sin(t * 0.5 + b.phase) * 0.04;
    }

    for (let i = 0; i < this.fireSprites.length; i++) {
      const sp = this.fireSprites[i];
      const f = Math.sin(t * (9 + i) + (sp.userData.phase as number)) * 0.5 + 0.5;
      const w = sp.userData.baseW as number;
      sp.scale.set(w * (0.88 + f * 0.3), w * 1.7 * (0.85 + f * 0.38), 1);
      (sp.material as THREE.SpriteMaterial).opacity = 0.7 + f * 0.3;
    }
    if (this.fireLight) {
      this.fireLight.intensity = 26 + Math.sin(t * 11) * 3.5 + Math.random() * 2;
    }
    if (this.fireLight2) {
      this.fireLight2.intensity = 9 + Math.sin(t * 13.5) * 1.5;
    }

    this.orbit += dt * 0.032;
    this.camera.position.x = CAM_POS.x + Math.sin(this.orbit) * 0.28;
    this.camera.position.y = CAM_POS.y + Math.sin(this.orbit * 0.7) * 0.1;
    this.camera.position.z = CAM_POS.z + Math.cos(this.orbit) * 0.16;
    this.camera.lookAt(CAM_LOOK.x, CAM_LOOK.y, CAM_LOOK.z);

    if (this.mist) this.mist.rotation.y = t * 0.01;
    if (this.aurora) {
      for (let i = 0; i < this.aurora.length; i++) {
        const m = this.aurora[i].material as THREE.MeshBasicMaterial;
        m.opacity = 0.07 + 0.05 * Math.sin(t * 0.3 + i * 1.5);
      }
    }

    // Selected ring pulse
    const sel = this.seats[this.selected];
    if (sel?.userData.ring) {
      const ring = sel.userData.ring as THREE.Mesh;
      const s = 1 + 0.05 * Math.sin(t * 2.6);
      ring.scale.setScalar(s);
    }

    for (const h of this.heroes) {
      if (!h) continue;
      h.setLocomotion({ x: 0, z: 0, speed: 0, running: false });
      h.update(dt);
    }

    this.renderer.render(this.scene, this.camera);
  }
}

function makeFlameTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 78, 2, 64, 60, 62);
  g.addColorStop(0, "rgba(255,252,235,1)");
  g.addColorStop(0.2, "rgba(255,200,90,0.95)");
  g.addColorStop(0.45, "rgba(255,110,30,0.55)");
  g.addColorStop(0.75, "rgba(255,50,10,0.18)");
  g.addColorStop(1, "rgba(255,20,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
