/**
 * Ethereal Falls campfire — GRUDOX 4-slot hero backdrop.
 *
 * Cinematic overlook: heightmap terrain, stylized pines, torch, mist, and the
 * EtherealSky cosmic falls. Post stack: pmndrs mystical composer (bloom /
 * vignette / grain / ACES). Voxel seats load Dressing Room–saved avatars.
 */
import * as THREE from "three";
import { createTorch, type TorchHandle } from "../fx/torchFlame";
import { createMysticalComposer, type MysticalComposer } from "../fx/postfx";
import { createAnimatedCharacter } from "../explorer/loader";
import type { Animator } from "../explorer/Animator";
import type { CharacterLook } from "../explorer/types";
import type { VoxelPart } from "../explorer/rig";
import { CHARACTER_HEIGHT_M } from "../types";
import { baseIdToRaceKey, type GenesisHeroOption } from "../../auth/grudoxRoster";
import { EtherealSky } from "../lobby/etherealSky";
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

const SEAT_RADIUS = 2.45;
const LOOK_RACES: Record<string, Partial<CharacterLook>> = {
  human: { skin: "#c98c5a", shirt: "#3d5a80", pants: "#2e3440", cape: true, capeColor: "#1a2740" },
  orc: { skin: "#5a8f3a", shirt: "#4a3020", pants: "#2a2018", cape: false },
  undead: { skin: "#9aa8b0", shirt: "#2a2038", pants: "#1a1520", cape: true, capeColor: "#2a1840" },
  barbarian: { skin: "#c07040", shirt: "#8b3a1a", pants: "#3a2818", cape: false },
  dwarf: { skin: "#c09060", shirt: "#5a4a30", pants: "#3a3028", cape: false },
  elf: { skin: "#e8d0b0", shirt: "#2a6050", pants: "#1a3028", cape: true, capeColor: "#143028" },
};

/** Cheap value-noise for heightmap / tree placement. */
function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function smoothNoise(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0);
  const b = hash2(x0 + 1, z0);
  const c = hash2(x0, z0 + 1);
  const d = hash2(x0 + 1, z0 + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm2(x: number, z: number): number {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < 4; i++) {
    v += a * smoothNoise(x * f, z * f);
    a *= 0.5;
    f *= 2.03;
  }
  return v;
}

export class CampfireLobbyScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private fx: MysticalComposer;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private torch: TorchHandle | null = null;
  private mist?: THREE.Points;
  private ethereal: EtherealSky | null = null;
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
  private keyLight: THREE.DirectionalLight | null = null;

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Deep void — EtherealSky paints the dome; fog softens mid-ground trees.
    this.scene.background = new THREE.Color(0x02040a);
    this.scene.fog = new THREE.FogExp2(0x060a14, 0.032);

    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.08, 220);
    this.camera.position.set(0, 3.1, 8.4);
    this.camera.lookAt(0, 1.2, -4);

    this.scene.add(this.envRoot);
    this.buildEnvironment();
    this.buildSeats();

    // Cinematic post: bloom + grade + chroma + vignette + grain + ACES
    this.fx = createMysticalComposer(this.renderer, this.scene, this.camera, {
      bloomIntensity: 1.25,
      bloomThreshold: 0.14,
      bloomRadius: 0.78,
      saturation: 0.2,
      hue: 0.04,
      vignetteDarkness: 0.68,
      chromatic: 0.0011,
      grain: 0.07,
    });
    this.fx.setSize(w, h);

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
          height: CHARACTER_HEIGHT_M * 0.92,
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
        anim.root.rotation.y = Math.PI;
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
      mat.opacity = i === this.selected ? 0.85 : 0.35;
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
    this.torch?.dispose();
    this.ethereal?.dispose();
    this.ethereal = null;
    this.fx.dispose();
    this.renderer.dispose();
  }

  // ── private ────────────────────────────────────────────────────────────

  private onAvatarSaved = (): void => {
    if (this.lastHeroes.length) void this.setHeroes(this.lastHeroes);
  };

  private buildEnvironment(): void {
    this.envRoot.add(this.buildHeightmapTerrain());
    this.envRoot.add(this.buildTrees());
    this.envRoot.add(this.buildFallsOverlookRocks());

    // Soft ethereal pool under fire
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(1.55, 40),
      new THREE.MeshStandardMaterial({
        color: 0x142848,
        emissive: 0x184070,
        emissiveIntensity: 0.55,
        roughness: 0.25,
        metalness: 0.35,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.04;
    this.envRoot.add(pool);

    // Cosmic rim fill from the falls (+ purple key from sky)
    this.scene.add(new THREE.AmbientLight(0x1a2848, 0.38));
    this.scene.add(new THREE.HemisphereLight(0x6a8cff, 0x0a0814, 0.55));
    const moon = new THREE.DirectionalLight(0xb8d4ff, 0.72);
    moon.position.set(-5, 12, 3);
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
    this.keyLight = moon;

    const fallsRim = new THREE.DirectionalLight(0x8866ff, 0.85);
    fallsRim.position.set(2, 6, -18);
    this.scene.add(fallsRim);
    const cosmicFill = new THREE.PointLight(0x55ffcc, 2.2, 28, 2);
    cosmicFill.position.set(0, 4, -10);
    this.scene.add(cosmicFill);

    createTorch({ targetHeight: 1.45, dying: 0.22, lightIntensity: 16, flameScale: 1.4 })
      .then((t) => {
        if (this.disposed) {
          t.dispose();
          return;
        }
        this.torch = t;
        t.group.position.set(0, 0, 0);
        t.light.castShadow = true;
        this.scene.add(t.group);
      })
      .catch(() => {
        /* torch optional */
      });

    this.mist = this.buildMist();
    this.scene.add(this.mist);

    try {
      this.ethereal = new EtherealSky(this.scene);
    } catch (err) {
      console.warn("[CampfireLobby] EtherealSky init failed", err);
    }
  }

  /** Gentle heightmap disc — flat fire ring, rising shoulders, drop toward falls. */
  private buildHeightmapTerrain(): THREE.Group {
    const g = new THREE.Group();
    const segs = 96;
    const size = 36;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const cRock = new THREE.Color(0x121a28);
    const cMoss = new THREE.Color(0x1a2a22);
    const cCliff = new THREE.Color(0x0c101c);
    const cTmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      // Plateau under camp
      let h = 0;
      if (r > 3.2) {
        const edge = Math.min(1, (r - 3.2) / 10);
        h = edge * 0.55 * fbm2(x * 0.18, z * 0.18);
        h += edge * 0.35 * Math.sin(x * 0.55) * Math.cos(z * 0.48);
        // Shoulders / mounds
        h += edge * 0.4 * smoothNoise(x * 0.3 + 2, z * 0.3);
      }
      // Drop toward Ethereal Falls (-Z)
      if (z < -5) {
        const fall = Math.min(1, (-z - 5) / 14);
        h -= fall * fall * 2.8;
        h += fbm2(x * 0.4, z * 0.25) * fall * 0.5;
      }
      // Rim cliff beyond ~14
      if (r > 14) {
        h -= (r - 14) * 0.35;
      }
      pos.setY(i, h);

      const t = THREE.MathUtils.clamp((-h + 0.3) * 0.35 + r * 0.02, 0, 1);
      cTmp.copy(cMoss).lerp(cRock, fbm2(x * 0.2, z * 0.2));
      if (z < -7) cTmp.lerp(cCliff, Math.min(1, (-z - 7) / 10));
      cTmp.lerp(cCliff, t * 0.35);
      colors[i * 3] = cTmp.r;
      colors[i * 3 + 1] = cTmp.g;
      colors[i * 3 + 2] = cTmp.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.04,
      flatShading: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    g.add(mesh);

    // Thin dark slab under so the void doesn't show through cliffs
    const under = new THREE.Mesh(
      new THREE.CircleGeometry(18, 48),
      new THREE.MeshBasicMaterial({ color: 0x05070e }),
    );
    under.rotation.x = -Math.PI / 2;
    under.position.y = -3.5;
    g.add(under);
    return g;
  }

  /** Layered pine stands around the clearing — denser toward the falls. */
  private buildTrees(): THREE.Group {
    const g = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.95 });
    const needleMats = [
      new THREE.MeshStandardMaterial({ color: 0x0e2818, roughness: 0.88, emissive: 0x041208, emissiveIntensity: 0.15 }),
      new THREE.MeshStandardMaterial({ color: 0x143520, roughness: 0.85, emissive: 0x061a10, emissiveIntensity: 0.12 }),
      new THREE.MeshStandardMaterial({ color: 0x0a2014, roughness: 0.9, emissive: 0x03100a, emissiveIntensity: 0.1 }),
    ];

    const makePine = (scale: number, seed: number): THREE.Group => {
      const tree = new THREE.Group();
      const trunkH = 1.1 + scale * 0.55;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06 * scale, 0.1 * scale, trunkH, 6),
        trunkMat,
      );
      trunk.position.y = trunkH * 0.5;
      trunk.castShadow = true;
      tree.add(trunk);
      const layers = 3 + (seed % 2);
      for (let L = 0; L < layers; L++) {
        const t = L / (layers - 1 || 1);
        const r = (0.55 - t * 0.28) * scale;
        const h = (0.7 - t * 0.12) * scale;
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(r, h, 7),
          needleMats[(seed + L) % needleMats.length],
        );
        cone.position.y = trunkH * 0.55 + L * 0.42 * scale;
        cone.rotation.y = seed * 0.7 + L * 0.4;
        cone.castShadow = true;
        tree.add(cone);
      }
      // Subtle violet under-glow on needles nearest the falls
      const glow = new THREE.PointLight(0x6644aa, 0.15 * scale, 3.5, 2);
      glow.position.set(0, trunkH * 0.8, 0);
      tree.add(glow);
      return tree;
    };

    // Ring + clusters toward -Z (falls)
    for (let i = 0; i < 42; i++) {
      const ang = (i / 42) * Math.PI * 2 + hash2(i, 3) * 0.4;
      const rad = 7.5 + hash2(i, 7) * 5.5 + (Math.sin(ang + 1.2) > 0.2 ? 1.5 : 0);
      // Keep fire ring clear
      if (rad < 5.5) continue;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad - 1.5;
      // Extra density on the falls side
      if (z > 4 && hash2(i, 11) > 0.55) continue;
      const scale = 0.85 + hash2(i, 13) * 1.1;
      const pine = makePine(scale, i);
      const groundY = this.sampleTerrainY(x, z);
      pine.position.set(x, groundY, z);
      pine.rotation.y = hash2(i, 17) * Math.PI * 2;
      pine.rotation.z = (hash2(i, 19) - 0.5) * 0.08;
      g.add(pine);
    }

    // Tall sentinel pines framing the falls
    for (const [x, z, s] of [
      [-9, -11, 1.8],
      [8.5, -12, 1.65],
      [-12, -7, 1.4],
      [11, -6.5, 1.35],
      [0, -14, 2.1],
    ] as const) {
      const pine = makePine(s, Math.abs(x * 10 + z));
      pine.position.set(x, this.sampleTerrainY(x, z), z);
      g.add(pine);
    }
    return g;
  }

  /** Approximate height at xz matching the heightmap formula (for tree bases). */
  private sampleTerrainY(x: number, z: number): number {
    const r = Math.hypot(x, z);
    let h = 0;
    if (r > 3.2) {
      const edge = Math.min(1, (r - 3.2) / 10);
      h = edge * 0.55 * fbm2(x * 0.18, z * 0.18);
      h += edge * 0.35 * Math.sin(x * 0.55) * Math.cos(z * 0.48);
      h += edge * 0.4 * smoothNoise(x * 0.3 + 2, z * 0.3);
    }
    if (z < -5) {
      const fall = Math.min(1, (-z - 5) / 14);
      h -= fall * fall * 2.8;
      h += fbm2(x * 0.4, z * 0.25) * fall * 0.5;
    }
    if (r > 14) h -= (r - 14) * 0.35;
    return Math.max(h, -0.5);
  }

  private buildFallsOverlookRocks(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a1528,
      roughness: 0.9,
      metalness: 0.08,
      emissive: 0x120828,
      emissiveIntensity: 0.25,
    });
    for (const [x, z, sx, sy, sz, ry] of [
      [-4.2, -8.5, 1.4, 0.55, 1.1, 0.4],
      [3.8, -9.2, 1.2, 0.7, 1.3, -0.3],
      [0.2, -10.5, 2.2, 0.4, 1.4, 0.1],
      [-6.5, -5.5, 0.9, 0.45, 0.8, 0.8],
      [6.2, -5.8, 1.0, 0.5, 0.9, -0.6],
    ] as const) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), mat);
      rock.position.set(x, this.sampleTerrainY(x, z) + sy * 0.35, z);
      rock.scale.set(sx, sy, sz);
      rock.rotation.y = ry;
      rock.castShadow = true;
      rock.receiveShadow = true;
      g.add(rock);
    }
    return g;
  }

  private buildSeats(): void {
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const g = new THREE.Group();
      const x = Math.cos(ang) * SEAT_RADIUS;
      const z = Math.sin(ang) * SEAT_RADIUS;
      g.position.set(x, this.sampleTerrainY(x, z), z);
      g.rotation.y = ang + Math.PI;
      g.userData.slotIndex = i;

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.7, 40),
        new THREE.MeshBasicMaterial({
          color: 0x1a3048,
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      g.userData.ring = ring;
      g.add(ring);

      const log = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.14, 0.95, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.95 }),
      );
      log.rotation.z = Math.PI / 2;
      log.position.set(0, 0.12, 0.35);
      log.castShadow = true;
      g.add(log);

      this.scene.add(g);
      this.seats.push(g);

      const label = this.makeLabel("…");
      label.position.set(0, 2.35, 0);
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
    ctx.fillStyle = "rgba(6,12,20,0.72)";
    ctx.fillRect(8, 8, 240, 48);
    ctx.fillStyle = "#cfe8ff";
    ctx.font = "bold 22px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text.slice(0, 18), 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(1.4, 0.35, 1);
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
    ctx.fillStyle = "rgba(6,12,20,0.72)";
    ctx.fillRect(8, 8, 240, 48);
    ctx.fillStyle = i === this.selected ? "#5fe0ff" : "#cfe8ff";
    ctx.font = "bold 22px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name.slice(0, 18), 128, 32);
    tex.needsUpdate = true;
  }

  private buildMist(): THREE.Points {
    const n = 720;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 22;
      pos[i * 3 + 1] = Math.random() * 7;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 22 - 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xa090ff,
      size: 0.1,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    return new THREE.Points(geo, mat);
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
    this.fx.setSize(w, h);
  }

  private animate(): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    this.torch?.update(dt);
    this.ethereal?.update(t);

    // Cinematic slow orbit — face the cosmic falls
    this.orbit += dt * 0.045;
    const r = 8.2;
    this.camera.position.x = Math.sin(this.orbit) * r * 0.38;
    this.camera.position.z = 8.0 + Math.cos(this.orbit) * 0.55;
    this.camera.position.y = 3.0 + Math.sin(this.orbit * 0.65) * 0.18;
    this.camera.lookAt(0, 1.35, -6.5);

    if (this.mist) {
      this.mist.rotation.y = t * 0.018;
      const p = this.mist.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i += 3) {
        p.setY(i, (p.getY(i) + dt * 0.08) % 7);
      }
      p.needsUpdate = true;
    }

    if (this.keyLight) {
      this.keyLight.intensity = 0.65 + Math.sin(t * 0.4) * 0.08;
    }

    for (const h of this.heroes) {
      if (!h) continue;
      h.setLocomotion({ x: 0, z: 0, speed: 0, running: false });
      h.update(dt);
    }

    this.fx.render(dt);
  }
}
