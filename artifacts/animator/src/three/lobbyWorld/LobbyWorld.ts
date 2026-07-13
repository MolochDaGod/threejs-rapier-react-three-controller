/**
 * Lobby World — persistent always-on island survival sandbox.
 *
 * Features:
 *  - Third-person character + WASD move, mouse look
 *  - Q swaps harvest ↔ combat stance
 *  - Harvest trees/rocks/bushes/ore; craft (C); build walls/floors (B + LMB)
 *  - Day/night cycle; night spawns mobs; rare boss
 *  - Smart-ish NPCs (vendor / guide / guard / crafter)
 *  - localStorage persistence
 *  - Map: island-life.glb → breeze-island.glb → procedural island
 *  - Blocks pack GLB for build previews when available
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { asset } from "../assets";
import type { FleetPlayerLoadout } from "../../auth/fleetCharacter";
import type { DangerClient } from "../../net/DangerClient";
import type { CombatEvent, PlayerState } from "@workspace/danger-net";
import { GrudgeAvatar } from "../grudge/GrudgeAvatar";
import type { RaceId, PresetId } from "../grudge";
import type { AnimRole, WeaponId } from "../types";
import {
  SAVE_KEY,
  WORLD_HALF,
  type InventorySlot,
  type ItemId,
  type LobbyHudSnapshot,
  type LobbyWorldSave,
  type MobState,
  type NpcState,
  type PlacedBlock,
  type PlayerStance,
  type ResourceNodeState,
} from "./types";
import {
  ITEM_LABELS,
  RECIPES,
  VENDOR_STOCK,
  addItem,
  applyCraft,
  canCraft,
  countItem,
  removeItem,
  type Recipe,
} from "./recipes";
import { LobbyRemoteHero } from "./LobbyRemoteHero";
import { LobbyWorldNet } from "./LobbyWorldNet";
import {
  createHarvestBagSync,
  hydrateInventoryFromAccount,
  isBagItem,
} from "../../auth/accountBag";
import type { AccountBagSync } from "../../auth/accountBag";

const MAP_CANDIDATES = [
  "models/worlds/island-life.glb",
  "models/worlds/breeze-island.glb",
];
const BLOCKS_URL = "models/worlds/blocks.glb";

const PLAYER_SPEED = 7.5;
const PLAYER_SPRINT = 11;
const CAM_DIST = 5.2;
const CAM_HEIGHT = 2.1;
const GRAVITY = 22;
const JUMP_V = 8.5;
const DAY_LEN = 240; // seconds per full day/night
const HARVEST_RANGE = 2.8;
const COMBAT_RANGE = 2.4;
const BUILD_RANGE = 6;
const MOB_SPAWN_CAP_DAY = 2;
const MOB_SPAWN_CAP_NIGHT = 10;
const SAVE_EVERY = 4; // seconds

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function loadSave(): LobbyWorldSave | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as LobbyWorldSave;
    if (data?.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

function defaultInventory(): InventorySlot[] {
  return [
    { id: "wood", qty: 8 },
    { id: "stone", qty: 4 },
    { id: "fiber", qty: 6 },
    { id: "coin", qty: 20 },
    { id: "axe", qty: 1 },
    { id: "pickaxe", qty: 1 },
  ];
}

export class LobbyWorld {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
  private renderer: THREE.WebGLRenderer;
  private mount: HTMLElement;
  private disposed = false;
  private raf = 0;
  private clock = new THREE.Clock();
  private keys = new Set<string>();
  private pointerLocked = false;
  private yaw = 0;
  private pitch = 0.28;
  private velY = 0;
  private grounded = true;
  private stance: PlayerStance = "harvest";
  private hp = 100;
  private maxHp = 100;
  private inv: InventorySlot[] = defaultInventory();
  private dayTime = 0.28; // 0–1, 0.25 = sunrise-ish
  private message: string | null = "Welcome to GRUDOX Island. Press Q for combat/harvest.";
  private messageT = 6;
  private loading: string | null = "Loading world…";
  private mapLabel = "Procedural Island";
  private craftOpen = false;
  private vendorOpen = false;
  private buildMode = false;
  private buildKind: PlacedBlock["kind"] = "wall";
  private saveAcc = 0;
  private attackCd = 0;
  private harvestCd = 0;
  private interactCd = 0;
  private onHud: ((h: LobbyHudSnapshot) => void) | null = null;
  private hudAcc = 0;

  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private ambient!: THREE.AmbientLight;
  private playerRoot = new THREE.Group();
  private playerMesh!: THREE.Group;
  private mapRoot = new THREE.Group();
  private groundY = 0;
  private heightSamples: Float32Array | null = null;
  private heightRes = 64;

  private resources: ResourceNodeState[] = [];
  private resourceMeshes = new Map<string, THREE.Object3D>();
  private blocks: PlacedBlock[] = [];
  private blockMeshes = new Map<string, THREE.Object3D>();
  private npcs: NpcState[] = [];
  private npcMeshes = new Map<string, THREE.Object3D>();
  private mobs: MobState[] = [];
  private mobMeshes = new Map<string, THREE.Object3D>();
  private blockTemplates: THREE.Object3D[] = [];
  private ghostMesh: THREE.Object3D | null = null;
  private raycaster = new THREE.Raycaster();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private spawnBossNextNight = true;
  private bossAlive = false;
  private nearbyNpcName: string | null = null;
  private targetLabel: string | null = null;

  /** GRUDOX / Warlords hero */
  private hero: FleetPlayerLoadout | null = null;
  private grudgeAvatar: GrudgeAvatar | null = null;
  private playerAtk = 10;
  private weaponId: WeaponId = "sword";
  private offHand: WeaponId | null = null;
  private heroReady = false;
  private moving = false;

  /** PvP */
  private worldNet: LobbyWorldNet | null = null;
  private remotes = new Map<string, LobbyRemoteHero>();
  private pvpConnected = false;
  private pvpRoom: string | null = null;
  private stateAccum = 0;
  private pvpEnabled = false;
  private bagSync: AccountBagSync | null = null;
  private bagCloud = false;

  constructor(
    mount: HTMLElement,
    opts?: {
      onHud?: (h: LobbyHudSnapshot) => void;
      hero?: FleetPlayerLoadout | null;
      net?: DangerClient | null;
      enablePvp?: boolean;
    },
  ) {
    this.mount = mount;
    this.onHud = opts?.onHud ?? null;
    this.hero = opts?.hero ?? null;
    this.pvpEnabled = !!opts?.enablePvp && !!opts?.net;
    if (this.hero) {
      this.maxHp = this.hero.maxHp;
      this.hp = this.hero.maxHp;
      this.playerAtk = this.hero.atk;
      this.weaponId = this.hero.weaponId;
      this.offHand = this.hero.offHand;
    }
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(mount.clientWidth, mount.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    mount.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.style.outline = "none";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.cursor = "crosshair";

    this.scene.background = new THREE.Color(0x87b8e8);
    this.scene.fog = new THREE.FogExp2(0x87b8e8, 0.012);

    this.hemi = new THREE.HemisphereLight(0xb1d4ff, 0x3a5a2a, 0.55);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff2d0, 1.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 120;
    this.sun.shadow.camera.left = -60;
    this.sun.shadow.camera.right = 60;
    this.sun.shadow.camera.top = 60;
    this.sun.shadow.camera.bottom = -60;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.add(this.mapRoot);
    this.buildPlayerPlaceholder();
    this.scene.add(this.playerRoot);

    this.bindInput();
    window.addEventListener("resize", this.onResize);
    this.onResize();

    const save = loadSave();
    // Per-character save key when fleet hero is bound
    if (save && (!this.hero?.fleetId || save.player)) {
      // Prefer hero maxHp when authenticated character is loaded
      if (this.hero?.authenticated) {
        this.maxHp = this.hero.maxHp;
        this.hp = Math.min(save.player.hp, this.maxHp);
      } else {
        this.hp = save.player.hp;
        this.maxHp = save.player.maxHp;
      }
      this.stance = save.player.stance;
      this.inv = save.player.inventory?.length ? save.player.inventory : defaultInventory();
      this.dayTime = save.dayTime ?? 0.28;
      this.blocks = save.blocks ?? [];
      this.resources = save.resources ?? [];
      this.playerRoot.position.set(save.player.x, save.player.y, save.player.z);
      this.yaw = save.player.yaw ?? 0;
      this.setMessage(
        this.hero?.authenticated
          ? `Welcome back, ${this.hero.displayName}.`
          : "Welcome back — progress restored.",
      );
    } else {
      this.playerRoot.position.set(0, 2, 8);
    }

    if (opts?.net && this.pvpEnabled && this.hero) {
      this.worldNet = new LobbyWorldNet(opts.net, {
        onRemoteJoin: (id, wireName) => void this.spawnRemote(id, wireName),
        onRemoteLeave: (id) => this.removeRemote(id),
        onSnapshot: (players) => this.onNetSnapshot(players),
        onCombat: (ev) => this.onNetCombat(ev),
        onStatus: (msg) => this.setMessage(msg),
        onConnected: (c) => {
          this.pvpConnected = c;
        },
      });
      this.worldNet.setLoadout(this.hero);
      this.worldNet.start();
    }

    // Account bag → Railway when signed in with a real Warlords character
    if (this.hero?.authenticated) {
      this.bagSync = createHarvestBagSync();
      this.bagSync.onFlush = (ok, items) => {
        if (ok && items.length) {
          this.setMessage(`Saved ${items.map((i) => `${i.amount} ${i.resourceId}`).join(", ")} to account bag`);
        }
      };
    }

    void this.boot();
    this.loop();
  }

  /** Hot-swap hero (character switch) without full restart. */
  async setHero(hero: FleetPlayerLoadout): Promise<void> {
    this.hero = hero;
    this.maxHp = hero.maxHp;
    this.hp = Math.min(this.hp, hero.maxHp);
    this.playerAtk = hero.atk;
    this.weaponId = hero.weaponId;
    this.offHand = hero.offHand;
    this.worldNet?.setLoadout(hero);
    await this.loadHeroAvatar();
    this.setMessage(`Playing as ${hero.displayName} (${hero.race} ${hero.classSlug})`);
  }

  setHudCallback(cb: ((h: LobbyHudSnapshot) => void) | null) {
    this.onHud = cb;
  }

  getRecipes(): Recipe[] {
    return RECIPES;
  }

  getVendorStock() {
    return VENDOR_STOCK;
  }

  craft(recipeId: string): boolean {
    const recipe = RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return false;
    const next = applyCraft(this.inv, recipe);
    if (!next) {
      this.setMessage("Missing materials.");
      return false;
    }
    this.inv = next;
    this.setMessage(`Crafted ${ITEM_LABELS[recipe.result]} x${recipe.qty}`);
    this.persist();
    return true;
  }

  buy(itemId: ItemId): boolean {
    const stock = VENDOR_STOCK.find((s) => s.id === itemId);
    if (!stock) return false;
    const coins = countItem(this.inv, "coin");
    if (coins < stock.price) {
      this.setMessage("Not enough coins.");
      return false;
    }
    const afterPay = removeItem(this.inv, "coin", stock.price);
    if (!afterPay) return false;
    this.inv = addItem(afterPay, stock.id, stock.qty);
    this.setMessage(`Bought ${stock.name}`);
    this.persist();
    return true;
  }

  sell(itemId: ItemId): boolean {
    if (itemId === "coin") return false;
    if (countItem(this.inv, itemId) < 1) {
      this.setMessage("Nothing to sell.");
      return false;
    }
    const price = Math.max(1, Math.floor((VENDOR_STOCK.find((s) => s.id === itemId)?.price ?? 2) * 0.4));
    const after = removeItem(this.inv, itemId, 1);
    if (!after) return false;
    this.inv = addItem(after, "coin", price);
    this.setMessage(`Sold ${ITEM_LABELS[itemId]} for ${price} coins`);
    this.persist();
    return true;
  }

  usePotion(): boolean {
    if (countItem(this.inv, "potion") < 1) return false;
    const after = removeItem(this.inv, "potion", 1);
    if (!after) return false;
    this.inv = after;
    this.hp = Math.min(this.maxHp, this.hp + 40);
    this.setMessage("Used health potion (+40).");
    return true;
  }

  setCraftOpen(open: boolean) {
    this.craftOpen = open;
    if (open) this.vendorOpen = false;
  }

  setVendorOpen(open: boolean) {
    this.vendorOpen = open;
    if (open) this.craftOpen = false;
  }

  canCraftRecipe(id: string): boolean {
    const r = RECIPES.find((x) => x.id === id);
    return r ? canCraft(this.inv, r) : false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.persist();
    this.bagSync?.dispose();
    this.bagSync = null;
    this.worldNet?.dispose();
    this.worldNet = null;
    for (const r of this.remotes.values()) {
      this.scene.remove(r.root);
      r.dispose();
    }
    this.remotes.clear();
    this.grudgeAvatar?.dispose();
    this.grudgeAvatar = null;
    window.removeEventListener("resize", this.onResize);
    this.unbindInput();
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
    this.renderer.dispose();
    this.mount.removeChild(this.renderer.domElement);
  }

  // ── Boot / assets ──────────────────────────────────────────────────────────

  private async boot() {
    try {
      await this.loadMap();
      await this.loadBlocksPack();
      await this.loadHeroAvatar();
      if (this.hero?.authenticated) {
        this.loading = "Syncing account bag…";
        this.pushHud(true);
        const { inv, ok } = await hydrateInventoryFromAccount(this.inv);
        this.inv = inv;
        this.bagCloud = ok;
        if (ok) this.setMessage("Account bag synced from Railway.");
      }
      if (this.resources.length === 0) this.seedResources();
      else this.rebuildResourceMeshes();
      this.rebuildBlockMeshes();
      this.seedNpcs();
      this.loading = null;
      const heroBit = this.hero?.authenticated
        ? `${this.hero.displayName} ready${this.bagCloud ? " · bag cloud" : ""}.`
        : "Guest kit (sign in with GRUDOX for your real character).";
      this.setMessage(
        `${this.mapLabel} · ${heroBit} Q stance · C craft · B build · E interact${this.pvpEnabled ? " · PvP on" : ""}.`,
      );
    } catch (e) {
      console.error("[LobbyWorld] boot failed", e);
      this.buildProceduralIsland();
      if (this.resources.length === 0) this.seedResources();
      this.seedNpcs();
      this.loading = null;
      this.setMessage("Procedural island ready (map load failed).");
    }
  }

  private parseHeroIds(characterId: string): { raceId: RaceId; presetId: PresetId } | null {
    const dash = characterId.match(
      /^grudge-(barbarians|dwarves|high-elves|orcs|undead|western-kingdoms)-(knight|warrior|ranger|mage|unarmed)$/i,
    );
    if (!dash) return null;
    const preset = (dash[2].toLowerCase() === "unarmed" ? "unarmed" : dash[2].toLowerCase()) as PresetId;
    return { raceId: dash[1].toLowerCase() as RaceId, presetId: preset };
  }

  private async loadHeroAvatar() {
    if (!this.hero) return;
    const ids = this.parseHeroIds(this.hero.characterId);
    if (!ids) return;
    this.loading = `Loading hero ${this.hero.displayName}…`;
    this.pushHud(true);
    try {
      const av = new GrudgeAvatar(ids.raceId, ids.presetId);
      await av.load();
      if (this.disposed) {
        av.dispose();
        return;
      }
      // Swap placeholder mesh for real Warlords modular character
      if (this.playerMesh) {
        this.playerRoot.remove(this.playerMesh);
        this.playerMesh = new THREE.Group();
      }
      if (this.grudgeAvatar) {
        this.playerRoot.remove(this.grudgeAvatar.root);
        this.grudgeAvatar.dispose();
      }
      this.grudgeAvatar = av;
      this.playerRoot.add(av.root);
      this.heroReady = true;
      this.updateToolColor();
    } catch (e) {
      console.warn("[LobbyWorld] GrudgeAvatar load failed — keeping capsule", e);
      this.heroReady = false;
    }
  }

  private async loadMap() {
    const loader = new GLTFLoader();
    // Prefer island-life when present; skip huge remote 404s quickly via HEAD probe.
    const candidates = [...MAP_CANDIDATES];
    for (const path of candidates) {
      try {
        const url = asset(path);
        this.loading = `Loading ${path.split("/").pop()}…`;
        this.pushHud(true);
        // Fast existence probe (avoids long wait on missing deploy assets)
        try {
          const head = await fetch(url, { method: "HEAD" });
          if (!head.ok) continue;
        } catch {
          /* some hosts block HEAD — still try GET */
        }
        const gltf = await new Promise<Awaited<ReturnType<GLTFLoader["loadAsync"]>>>((resolve, reject) => {
          loader.load(
            url,
            resolve,
            (ev) => {
              if (ev.total > 0) {
                const pct = Math.round((ev.loaded / ev.total) * 100);
                this.loading = `Loading ${path.split("/").pop()}… ${pct}%`;
                this.pushHud(true);
              }
            },
            reject,
          );
        });
        if (this.disposed) return;
        const root = gltf.scene;
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
            if (m.material) {
              const mats = Array.isArray(m.material) ? m.material : [m.material];
              for (const mat of mats) {
                if ("map" in mat && mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
              }
            }
          }
        });
        // Fit map roughly to playable area and center on origin
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const maxXZ = Math.max(size.x, size.z, 1);
        const target = WORLD_HALF * 1.6;
        const scale = maxXZ > target * 1.4 ? target / maxXZ : 1;
        root.scale.setScalar(scale);
        root.updateMatrixWorld(true);
        const box2 = new THREE.Box3().setFromObject(root);
        const center = box2.getCenter(new THREE.Vector3());
        root.position.x -= center.x;
        root.position.z -= center.z;
        root.position.y -= box2.min.y; // ground to y≈0
        root.updateMatrixWorld(true);
        this.groundY = 0;
        this.mapRoot.clear();
        this.mapRoot.add(root);
        this.bakeHeights(root);
        this.mapLabel = path.includes("island-life")
          ? "Island Life"
          : path.includes("breeze")
            ? "Breeze Island"
            : path;
        // Place player on ground if fresh
        const gy = this.sampleHeight(this.playerRoot.position.x, this.playerRoot.position.z);
        this.playerRoot.position.y = gy + 0.05;
        return;
      } catch {
        /* try next */
      }
    }
    this.buildProceduralIsland();
  }

  private async loadBlocksPack() {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(asset(BLOCKS_URL));
      const templates: THREE.Object3D[] = [];
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) {
          const c = m.clone(true);
          c.position.set(0, 0, 0);
          c.rotation.set(0, 0, 0);
          // Normalize to ~1m cube
          const b = new THREE.Box3().setFromObject(c);
          const s = b.getSize(new THREE.Vector3());
          const max = Math.max(s.x, s.y, s.z, 0.01);
          c.scale.multiplyScalar(1 / max);
          c.position.y = 0.5;
          templates.push(c);
        }
      });
      this.blockTemplates = templates.slice(0, 24);
    } catch {
      this.blockTemplates = [];
    }
  }

  private buildProceduralIsland() {
    this.mapLabel = "Procedural Island";
    this.mapRoot.clear();
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(WORLD_HALF, 64),
      new THREE.MeshStandardMaterial({ color: 0x4a8f3c, roughness: 0.92, metalness: 0.02 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.mapRoot.add(ground);

    // Shore ring
    const sand = new THREE.Mesh(
      new THREE.RingGeometry(WORLD_HALF - 3, WORLD_HALF + 4, 64),
      new THREE.MeshStandardMaterial({ color: 0xd4c48a, roughness: 0.95 }),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = 0.02;
    sand.receiveShadow = true;
    this.mapRoot.add(sand);

    // Water plane
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(WORLD_HALF + 40, 48),
      new THREE.MeshStandardMaterial({
        color: 0x2a6f9e,
        roughness: 0.2,
        metalness: 0.3,
        transparent: true,
        opacity: 0.85,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.4;
    this.mapRoot.add(water);

    // Hills
    for (let i = 0; i < 12; i++) {
      const r = 3 + Math.random() * 5;
      const hill = new THREE.Mesh(
        new THREE.SphereGeometry(r, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.9 }),
      );
      const ang = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * (WORLD_HALF - 12);
      hill.position.set(Math.cos(ang) * dist, 0, Math.sin(ang) * dist);
      hill.castShadow = true;
      hill.receiveShadow = true;
      this.mapRoot.add(hill);
    }
    this.groundY = 0;
    this.heightSamples = null;
  }

  private bakeHeights(root: THREE.Object3D) {
    const res = this.heightRes;
    const samples = new Float32Array(res * res);
    const ray = new THREE.Raycaster();
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3(0, -1, 0);
    const meshes: THREE.Object3D[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o);
    });
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const x = -WORLD_HALF + ((ix + 0.5) / res) * WORLD_HALF * 2;
        const z = -WORLD_HALF + ((iz + 0.5) / res) * WORLD_HALF * 2;
        origin.set(x, 80, z);
        ray.set(origin, dir);
        const hits = ray.intersectObjects(meshes, true);
        samples[iz * res + ix] = hits.length ? hits[0].point.y : this.groundY;
      }
    }
    this.heightSamples = samples;
  }

  private sampleHeight(x: number, z: number): number {
    if (!this.heightSamples) return this.groundY;
    const res = this.heightRes;
    const u = (x + WORLD_HALF) / (WORLD_HALF * 2);
    const v = (z + WORLD_HALF) / (WORLD_HALF * 2);
    if (u < 0 || u > 1 || v < 0 || v > 1) return this.groundY;
    const fx = u * (res - 1);
    const fz = v * (res - 1);
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(res - 1, x0 + 1);
    const z1 = Math.min(res - 1, z0 + 1);
    const tx = fx - x0;
    const tz = fz - z0;
    const h00 = this.heightSamples[z0 * res + x0];
    const h10 = this.heightSamples[z0 * res + x1];
    const h01 = this.heightSamples[z1 * res + x0];
    const h11 = this.heightSamples[z1 * res + x1];
    return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
  }

  private buildPlayerPlaceholder() {
    const g = new THREE.Group();
    // Placeholder until GrudgeAvatar loads (or guest fallback)
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.32, 0.85, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x3d6fd8, roughness: 0.55, metalness: 0.15 }),
    );
    body.position.y = 0.95;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xf0c9a0, roughness: 0.65 }),
    );
    head.position.y = 1.72;
    head.castShadow = true;
    g.add(head);
    const tool = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.7 }),
    );
    tool.position.set(0.45, 1.1, 0.15);
    tool.name = "tool";
    g.add(tool);
    this.playerMesh = g;
    this.playerRoot.add(g);
  }

  private updateToolColor() {
    const tool = this.playerMesh?.getObjectByName("tool") as THREE.Mesh | undefined;
    if (tool) {
      const mat = tool.material as THREE.MeshStandardMaterial;
      mat.color.setHex(this.stance === "combat" ? 0xc04040 : 0x8b6914);
    }
  }

  // ── Resources / NPCs / mobs ────────────────────────────────────────────────

  private seedResources() {
    const kinds: ResourceNodeState["kind"][] = ["tree", "rock", "bush", "ore"];
    const count = 48;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 6 + Math.random() * (WORLD_HALF - 10);
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      const kind = kinds[i % kinds.length];
      const maxHp = kind === "ore" ? 5 : kind === "rock" ? 4 : kind === "tree" ? 3 : 2;
      const y = this.sampleHeight(x, z);
      const node: ResourceNodeState = {
        id: uid("res"),
        kind,
        x,
        y,
        z,
        hp: maxHp,
        maxHp,
        respawnAt: 0,
      };
      this.resources.push(node);
      this.spawnResourceMesh(node);
    }
  }

  private rebuildResourceMeshes() {
    for (const id of [...this.resourceMeshes.keys()]) {
      const m = this.resourceMeshes.get(id);
      if (m) this.scene.remove(m);
      this.resourceMeshes.delete(id);
    }
    for (const n of this.resources) {
      if (n.hp > 0) this.spawnResourceMesh(n);
    }
  }

  private spawnResourceMesh(n: ResourceNodeState) {
    const g = new THREE.Group();
    g.position.set(n.x, n.y, n.z);
    if (n.kind === "tree") {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.28, 1.6, 8),
        new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }),
      );
      trunk.position.y = 0.8;
      trunk.castShadow = true;
      g.add(trunk);
      const leaves = new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x2f8a3a, roughness: 0.85 }),
      );
      leaves.position.y = 2.0;
      leaves.castShadow = true;
      g.add(leaves);
    } else if (n.kind === "rock") {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.55, 0),
        new THREE.MeshStandardMaterial({ color: 0x888890, roughness: 0.95 }),
      );
      rock.position.y = 0.35;
      rock.castShadow = true;
      g.add(rock);
    } else if (n.kind === "ore") {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.5, 0),
        new THREE.MeshStandardMaterial({ color: 0x5a5a68, roughness: 0.8, metalness: 0.4 }),
      );
      rock.position.y = 0.3;
      g.add(rock);
      const gleam = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x66ccff, emissive: 0x2288aa, emissiveIntensity: 0.8 }),
      );
      gleam.position.set(0.15, 0.45, 0.1);
      g.add(gleam);
    } else {
      const bush = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a9a48, roughness: 0.9 }),
      );
      bush.position.y = 0.35;
      bush.scale.set(1.2, 0.8, 1.2);
      g.add(bush);
    }
    this.scene.add(g);
    this.resourceMeshes.set(n.id, g);
  }

  private seedNpcs() {
    for (const m of this.npcMeshes.values()) this.scene.remove(m);
    this.npcMeshes.clear();
    const defs: Omit<NpcState, "id">[] = [
      {
        role: "vendor",
        name: "Mira the Trader",
        x: 4,
        y: 0,
        z: 4,
        yaw: 0,
        line: "Coins for goods — potions, tools, ore. Press E.",
      },
      {
        role: "guide",
        name: "Old Cartographer",
        x: -5,
        y: 0,
        z: 6,
        yaw: Math.PI * 0.2,
        line: "Q harvest/combat · C craft · B build · night brings wolves.",
      },
      {
        role: "crafter",
        name: "Forgehand Brin",
        x: 6,
        y: 0,
        z: -3,
        yaw: -Math.PI * 0.4,
        line: "Workbench nearby? Craft swords from iron. Press C.",
      },
      {
        role: "guard",
        name: "Watchman Kael",
        x: -3,
        y: 0,
        z: -6,
        yaw: Math.PI,
        line: "I hold the plaza. At night, keep your sword ready.",
      },
    ];
    this.npcs = defs.map((d) => {
      const y = this.sampleHeight(d.x, d.z);
      return { ...d, id: uid("npc"), y };
    });
    for (const n of this.npcs) this.spawnNpcMesh(n);
  }

  private spawnNpcMesh(n: NpcState) {
    const g = new THREE.Group();
    g.position.set(n.x, n.y, n.z);
    g.rotation.y = n.yaw;
    const colors: Record<NpcState["role"], number> = {
      vendor: 0xd4a017,
      guide: 0x6ec6ff,
      guard: 0x8899aa,
      crafter: 0xc07040,
    };
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.75, 4, 10),
      new THREE.MeshStandardMaterial({ color: colors[n.role], roughness: 0.55 }),
    );
    body.position.y = 0.9;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xe8c4a0 }),
    );
    head.position.y = 1.55;
    g.add(head);
    // Name plate sprite-ish
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(n.name, 128, 40);
    const tex = new THREE.CanvasTexture(canvas);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    spr.scale.set(2.2, 0.55, 1);
    spr.position.y = 2.2;
    g.add(spr);
    this.scene.add(g);
    this.npcMeshes.set(n.id, g);
  }

  private spawnMob(kind: MobState["kind"], x: number, z: number) {
    if (this.mobs.length >= (this.isNight() ? MOB_SPAWN_CAP_NIGHT : MOB_SPAWN_CAP_DAY) + 2) return;
    const stats =
      kind === "boss"
        ? { hp: 220, atk: 18, speed: 3.2, aggro: 28 }
        : kind === "skeleton"
          ? { hp: 55, atk: 10, speed: 3.8, aggro: 16 }
          : kind === "wolf"
            ? { hp: 40, atk: 8, speed: 5.2, aggro: 18 }
            : { hp: 28, atk: 5, speed: 2.8, aggro: 12 };
    const y = this.sampleHeight(x, z);
    const m: MobState = {
      id: uid("mob"),
      kind,
      x,
      y,
      z,
      yaw: Math.random() * Math.PI * 2,
      hp: stats.hp,
      maxHp: stats.hp,
      atk: stats.atk,
      speed: stats.speed,
      aggro: stats.aggro,
      phaseT: kind === "boss" ? 0 : undefined,
    };
    this.mobs.push(m);
    this.spawnMobMesh(m);
    if (kind === "boss") {
      this.bossAlive = true;
      this.setMessage("A boss has risen on the ridge!");
    }
  }

  private spawnMobMesh(m: MobState) {
    const g = new THREE.Group();
    g.position.set(m.x, m.y, m.z);
    const color =
      m.kind === "boss" ? 0x8b1a1a : m.kind === "skeleton" ? 0xd0d0c8 : m.kind === "wolf" ? 0x555560 : 0x55aa55;
    const scale = m.kind === "boss" ? 2.2 : m.kind === "wolf" ? 0.85 : 1;
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28 * scale, 0.55 * scale, 4, 8),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.6,
        emissive: m.kind === "boss" ? 0x440000 : 0x000000,
        emissiveIntensity: m.kind === "boss" ? 0.4 : 0,
      }),
    );
    body.position.y = 0.55 * scale;
    body.castShadow = true;
    g.add(body);
    if (m.kind === "boss") {
      const horn = new THREE.Mesh(
        new THREE.ConeGeometry(0.15, 0.5, 6),
        new THREE.MeshStandardMaterial({ color: 0x222222 }),
      );
      horn.position.set(0.25, 1.5, 0);
      g.add(horn);
    }
    this.scene.add(g);
    this.mobMeshes.set(m.id, g);
  }

  private removeMob(id: string) {
    const m = this.mobs.find((x) => x.id === id);
    if (m?.kind === "boss") this.bossAlive = false;
    this.mobs = this.mobs.filter((x) => x.id !== id);
    const mesh = this.mobMeshes.get(id);
    if (mesh) {
      this.scene.remove(mesh);
      this.mobMeshes.delete(id);
    }
  }

  // ── Blocks ─────────────────────────────────────────────────────────────────

  private rebuildBlockMeshes() {
    for (const m of this.blockMeshes.values()) this.scene.remove(m);
    this.blockMeshes.clear();
    for (const b of this.blocks) this.spawnBlockMesh(b);
  }

  private spawnBlockMesh(b: PlacedBlock) {
    let mesh: THREE.Object3D;
    if (this.blockTemplates.length > 0 && (b.kind === "wall" || b.kind === "floor")) {
      const t = this.blockTemplates[b.kind === "wall" ? 0 : Math.min(1, this.blockTemplates.length - 1)];
      mesh = t.clone(true);
      mesh.position.set(b.x, b.y + (b.kind === "floor" ? 0.05 : 0.5), b.z);
      mesh.rotation.y = b.rot;
    } else {
      const colors: Record<PlacedBlock["kind"], number> = {
        wall: 0x9a7b4f,
        floor: 0x7a7a80,
        campfire: 0xc45c20,
        workbench: 0x8b6914,
        torch: 0xffcc66,
      };
      const h = b.kind === "floor" ? 0.15 : b.kind === "torch" ? 0.9 : 1;
      const geo =
        b.kind === "torch"
          ? new THREE.CylinderGeometry(0.06, 0.08, h, 6)
          : new THREE.BoxGeometry(1, h, b.kind === "wall" ? 0.25 : 1);
      mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colors[b.kind], roughness: 0.75 }));
      (mesh as THREE.Mesh).castShadow = true;
      (mesh as THREE.Mesh).receiveShadow = true;
      mesh.position.set(b.x, b.y + h / 2, b.z);
      mesh.rotation.y = b.rot;
      if (b.kind === "campfire" || b.kind === "torch") {
        const light = new THREE.PointLight(0xff9944, b.kind === "campfire" ? 1.2 : 0.6, 10);
        light.position.y = h;
        mesh.add(light);
      }
    }
    this.scene.add(mesh);
    this.blockMeshes.set(b.id, mesh);
  }

  private placeBlockAt(x: number, y: number, z: number) {
    const kind = this.buildKind;
    const cost: { id: ItemId; qty: number } =
      kind === "wall"
        ? { id: "wall", qty: 1 }
        : kind === "floor"
          ? { id: "floor", qty: 1 }
          : kind === "campfire"
            ? { id: "campfire", qty: 1 }
            : kind === "workbench"
              ? { id: "workbench", qty: 1 }
              : { id: "torch", qty: 1 };
    if (countItem(this.inv, cost.id) < cost.qty) {
      // Allow placing with raw materials as fallback
      if (kind === "wall" && countItem(this.inv, "planks") >= 2) {
        const after = removeItem(this.inv, "planks", 2);
        if (!after) return;
        this.inv = after;
      } else if (kind === "floor" && countItem(this.inv, "stone") >= 2) {
        const after = removeItem(this.inv, "stone", 2);
        if (!after) return;
        this.inv = after;
      } else {
        this.setMessage(`Need ${ITEM_LABELS[cost.id]} (craft first).`);
        return;
      }
    } else {
      const after = removeItem(this.inv, cost.id, cost.qty);
      if (!after) return;
      this.inv = after;
    }
    const gx = Math.round(x);
    const gz = Math.round(z);
    const gy = this.sampleHeight(gx, gz);
    const b: PlacedBlock = {
      id: uid("blk"),
      kind,
      x: gx,
      y: gy,
      z: gz,
      rot: Math.round(this.yaw / (Math.PI / 2)) * (Math.PI / 2),
    };
    this.blocks.push(b);
    this.spawnBlockMesh(b);
    this.setMessage(`Placed ${kind}`);
    this.persist();
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  private bindInput() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.renderer.domElement.addEventListener("click", this.onClick);
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
    this.renderer.domElement.addEventListener("contextmenu", this.onContext);
  }

  private unbindInput() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.renderer.domElement.removeEventListener("click", this.onClick);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.renderer.domElement.removeEventListener("contextmenu", this.onContext);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if (k === "q") {
      this.stance = this.stance === "harvest" ? "combat" : "harvest";
      this.updateToolColor();
      this.setMessage(this.stance === "combat" ? "Combat stance" : "Harvest stance");
    }
    if (k === "c") {
      this.craftOpen = !this.craftOpen;
      if (this.craftOpen) this.vendorOpen = false;
    }
    if (k === "b") {
      this.buildMode = !this.buildMode;
      this.setMessage(this.buildMode ? `Build mode: ${this.buildKind} (1-5 cycle kind)` : "Build mode off");
    }
    if (k === "e") this.tryInteract();
    if (k === "h") this.usePotion();
    if (this.buildMode && e.key >= "1" && e.key <= "5") {
      const kinds: PlacedBlock["kind"][] = ["wall", "floor", "campfire", "workbench", "torch"];
      this.buildKind = kinds[Number(e.key) - 1];
      this.setMessage(`Build: ${this.buildKind}`);
    }
    if (k === "escape") {
      this.craftOpen = false;
      this.vendorOpen = false;
      if (document.pointerLockElement) document.exitPointerLock();
    }
    if (k === " " || k === "space") {
      if (this.grounded) {
        this.velY = JUMP_V;
        this.grounded = false;
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onClick = () => {
    if (!this.pointerLocked) {
      this.renderer.domElement.requestPointerLock();
      return;
    }
    if (this.craftOpen || this.vendorOpen) return;
    if (this.buildMode) {
      this.tryBuild();
      return;
    }
    if (this.stance === "harvest") this.tryHarvest();
    else this.tryAttack();
  };

  private onContext = (e: Event) => {
    e.preventDefault();
  };

  private onLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked) return;
    this.yaw -= e.movementX * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.002, -0.2, 1.2);
  };

  private onResize = () => {
    const w = this.mount.clientWidth || 1;
    const h = this.mount.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  // ── Actions ────────────────────────────────────────────────────────────────

  private tryHarvest() {
    if (this.harvestCd > 0) return;
    const p = this.playerRoot.position;
    let best: ResourceNodeState | null = null;
    let bestD = HARVEST_RANGE;
    for (const n of this.resources) {
      if (n.hp <= 0) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (!best) {
      this.setMessage("Nothing to harvest nearby.");
      return;
    }
    this.harvestCd = 0.35;
    best.hp -= 1;
    const drops: { id: ItemId; qty: number }[] =
      best.kind === "tree"
        ? [{ id: "wood", qty: 2 }]
        : best.kind === "rock"
          ? [{ id: "stone", qty: 2 }]
          : best.kind === "ore"
            ? [{ id: "ore", qty: 1 }]
            : [{ id: "fiber", qty: 2 }];
    for (const d of drops) {
      this.inv = addItem(this.inv, d.id, d.qty);
      if (this.bagSync && isBagItem(d.id)) this.bagSync.enqueue(d.id, d.qty);
    }
    this.setMessage(`+${drops.map((d) => `${d.qty} ${ITEM_LABELS[d.id]}`).join(", ")}`);
    // Pulse mesh
    const mesh = this.resourceMeshes.get(best.id);
    if (mesh) mesh.scale.setScalar(0.92);
    if (best.hp <= 0) {
      best.respawnAt = performance.now() / 1000 + 45 + Math.random() * 30;
      if (mesh) {
        this.scene.remove(mesh);
        this.resourceMeshes.delete(best.id);
      }
      // Chance for meat/hide from bush critters
      if (best.kind === "bush" && Math.random() < 0.25) {
        this.inv = addItem(this.inv, "meat", 1);
        this.bagSync?.enqueue("meat", 1);
        this.setMessage("Found meat in the brush!");
      }
    }
  }

  private tryAttack() {
    if (this.attackCd > 0) return;
    this.attackCd = 0.45;
    this.grudgeAvatar?.playRoleOnce("attack");
    this.worldNet?.sendCombat({
      k: "attack",
      from: this.worldNet.selfId,
      action: "attack",
    });

    const p = this.playerRoot.position;
    const craftedSword = countItem(this.inv, "sword") > 0;
    // Real character weapon power + crafted bonus
    const dmg = Math.round(this.playerAtk * (craftedSword || this.weaponId !== "none" ? 1.15 : 0.75));
    let hit = false;

    // PvP: hit nearby remotes
    if (this.worldNet?.inRoom) {
      for (const [id, remote] of this.remotes) {
        const d = Math.hypot(remote.root.position.x - p.x, remote.root.position.z - p.z);
        if (d > COMBAT_RANGE + 0.4) continue;
        const toR = Math.atan2(remote.root.position.x - p.x, remote.root.position.z - p.z);
        let ad = Math.abs(toR - this.yaw);
        while (ad > Math.PI) ad -= Math.PI * 2;
        if (Math.abs(ad) > 1.25) continue;
        this.worldNet.sendCombat({
          k: "hit",
          from: this.worldNet.selfId,
          to: id,
          target: "player",
          amount: dmg,
        });
        this.targetLabel = `${remote.displayName}`;
        hit = true;
        break;
      }
    }

    for (const m of [...this.mobs]) {
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d > COMBAT_RANGE) continue;
      // Face check
      const toMob = Math.atan2(m.x - p.x, m.z - p.z);
      let ad = Math.abs(toMob - this.yaw);
      while (ad > Math.PI) ad -= Math.PI * 2;
      if (Math.abs(ad) > 1.2) continue;
      m.hp -= dmg;
      hit = true;
      this.targetLabel = `${m.kind} ${Math.max(0, Math.ceil(m.hp))}/${m.maxHp}`;
      const mesh = this.mobMeshes.get(m.id);
      if (mesh) {
        mesh.scale.setScalar(1.15);
        setTimeout(() => mesh.scale.setScalar(1), 80);
      }
      if (m.hp <= 0) {
        const loot =
          m.kind === "boss"
            ? [
                { id: "coin" as ItemId, qty: 40 },
                { id: "iron_ingot" as ItemId, qty: 3 },
                { id: "meat" as ItemId, qty: 5 },
              ]
            : m.kind === "wolf"
              ? [
                  { id: "meat" as ItemId, qty: 2 },
                  { id: "hide" as ItemId, qty: 1 },
                ]
              : [
                  { id: "coin" as ItemId, qty: 3 + Math.floor(Math.random() * 4) },
                  { id: "stone" as ItemId, qty: 1 },
                ];
        for (const l of loot) {
          this.inv = addItem(this.inv, l.id, l.qty);
          if (this.bagSync && isBagItem(l.id)) this.bagSync.enqueue(l.id, l.qty);
        }
        this.setMessage(`Defeated ${m.kind}!`);
        this.removeMob(m.id);
      }
      break;
    }
    if (!hit) {
      this.setMessage(
        this.hero?.authenticated
          ? `${this.hero.displayName} swings (${this.weaponId})!`
          : "Swing!",
      );
    }
  }

  private async spawnRemote(id: string, wireName: string) {
    if (this.remotes.has(id)) return;
    const remote = new LobbyRemoteHero(id, wireName);
    this.remotes.set(id, remote);
    this.scene.add(remote.root);
    try {
      await remote.load();
    } catch (e) {
      console.warn("[LobbyWorld] remote load", e);
    }
    this.setMessage(`${remote.displayName} entered the island`);
  }

  private removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.scene.remove(r.root);
    r.dispose();
    this.remotes.delete(id);
  }

  private onNetSnapshot(players: PlayerState[]) {
    this.pvpRoom = this.worldNet?.roomCode ?? null;
    for (const p of players) {
      if (p.id === this.worldNet?.selfId) {
        // Optionally soft-sync HP from server authority later
        continue;
      }
      let remote = this.remotes.get(p.id);
      if (!remote) {
        void this.spawnRemote(p.id, p.name);
        remote = this.remotes.get(p.id);
      }
      remote?.apply(p.px, p.py, p.pz, p.ry, p.moving, p.hp);
    }
  }

  private onNetCombat(ev: CombatEvent) {
    if (ev.k === "attack") {
      if (ev.from !== this.worldNet?.selfId) this.remotes.get(ev.from)?.playAttack();
      return;
    }
    if (ev.k === "hit" && ev.target === "player" && ev.to === this.worldNet?.selfId) {
      const shield = this.offHand === "shield" || countItem(this.inv, "shield") > 0;
      const amount = shield && this.stance === "combat" ? ev.amount * 0.5 : ev.amount;
      this.hp = Math.max(0, this.hp - amount);
      this.setMessage(`Hit by rival for ${Math.round(amount)}!`);
      if (this.hp <= 0) {
        this.hp = this.maxHp * 0.45;
        this.playerRoot.position.set(0, this.sampleHeight(0, 8) + 0.05, 8);
        this.setMessage("Downed in PvP — respawned at plaza.");
      }
    }
  }

  private tryBuild() {
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const p = this.playerRoot.position.clone().add(forward.multiplyScalar(2.5));
    this.placeBlockAt(p.x, p.y, p.z);
  }

  private tryInteract() {
    if (this.interactCd > 0) return;
    this.interactCd = 0.3;
    const p = this.playerRoot.position;
    let best: NpcState | null = null;
    let bestD = 3.2;
    for (const n of this.npcs) {
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (!best) {
      this.setMessage("No one nearby. Walk up to an NPC and press E.");
      return;
    }
    this.setMessage(`${best.name}: "${best.line}"`);
    this.nearbyNpcName = best.name;
    if (best.role === "vendor") {
      this.vendorOpen = true;
      this.craftOpen = false;
    } else if (best.role === "crafter") {
      this.craftOpen = true;
      this.vendorOpen = false;
    }
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.updatePlayer(dt);
    this.updateDayNight(dt);
    this.updateMobs(dt);
    this.updateResources(dt);
    this.updateNpcs(dt);
    this.updateCamera(dt);
    this.updateNet(dt);
    this.grudgeAvatar?.update(dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.harvestCd = Math.max(0, this.harvestCd - dt);
    this.interactCd = Math.max(0, this.interactCd - dt);
    if (this.messageT > 0) {
      this.messageT -= dt;
      if (this.messageT <= 0) this.message = null;
    }
    this.saveAcc += dt;
    if (this.saveAcc >= SAVE_EVERY) {
      this.saveAcc = 0;
      this.persist();
    }
    this.hudAcc += dt;
    if (this.hudAcc >= 0.1) {
      this.hudAcc = 0;
      this.pushHud();
    }
    this.renderer.render(this.scene, this.camera);
  };

  private updatePlayer(dt: number) {
    const sprint = this.keys.has("shift");
    const speed = sprint ? PLAYER_SPRINT : PLAYER_SPEED;
    let mx = 0;
    let mz = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) mz += 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) mz -= 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) mx -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) mx += 1;
    this.moving = !!(mx || mz);
    if (mx || mz) {
      const len = Math.hypot(mx, mz) || 1;
      mx /= len;
      mz /= len;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      const dx = (mx * cos + mz * sin) * speed * dt;
      const dz = (-mx * sin + mz * cos) * speed * dt;
      this.playerRoot.position.x += dx;
      this.playerRoot.position.z += dz;
    }
    // Face move dir — capsule or grudge root
    this.playerMesh.rotation.y = this.yaw;
    if (this.grudgeAvatar) {
      this.grudgeAvatar.root.rotation.y = this.yaw;
      if (!this.grudgeAvatar.isOneShotActive) {
        const role: AnimRole = this.moving ? (sprint ? "run" : "walk") : "idle";
        this.grudgeAvatar.playRole(role, 0.12);
      }
    }
    // Bounds soft clamp
    const r = Math.hypot(this.playerRoot.position.x, this.playerRoot.position.z);
    if (r > WORLD_HALF + 2) {
      const s = (WORLD_HALF + 2) / r;
      this.playerRoot.position.x *= s;
      this.playerRoot.position.z *= s;
    }
    // Gravity + ground
    this.velY -= GRAVITY * dt;
    this.playerRoot.position.y += this.velY * dt;
    const gy = this.sampleHeight(this.playerRoot.position.x, this.playerRoot.position.z);
    if (this.playerRoot.position.y <= gy + 0.02) {
      this.playerRoot.position.y = gy + 0.02;
      this.velY = 0;
      this.grounded = true;
    }
    // Nearby npc label
    this.nearbyNpcName = null;
    const p = this.playerRoot.position;
    for (const n of this.npcs) {
      if (Math.hypot(n.x - p.x, n.z - p.z) < 3.2) {
        this.nearbyNpcName = n.name;
        break;
      }
    }
  }

  private isNight(): boolean {
    // dayTime 0–1; night roughly 0.75–0.22 wrapping
    return this.dayTime > 0.72 || this.dayTime < 0.22;
  }

  private updateDayNight(dt: number) {
    this.dayTime = (this.dayTime + dt / DAY_LEN) % 1;
    const t = this.dayTime;
    // Sun orbit
    const ang = t * Math.PI * 2 - Math.PI * 0.5;
    const elev = Math.sin(ang);
    this.sun.position.set(Math.cos(ang) * 50, Math.max(2, elev * 55 + 10), Math.sin(ang) * 30);
    this.sun.target.position.set(0, 0, 0);
    const dayness = THREE.MathUtils.clamp(elev * 0.5 + 0.5, 0.08, 1);
    this.sun.intensity = 0.25 + dayness * 1.1;
    this.hemi.intensity = 0.15 + dayness * 0.45;
    this.ambient.intensity = 0.08 + dayness * 0.22;
    const skyDay = new THREE.Color(0x87b8e8);
    const skyNight = new THREE.Color(0x0a1020);
    const sky = skyDay.clone().lerp(skyNight, 1 - dayness);
    this.scene.background = sky;
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(sky);
      this.scene.fog.density = 0.01 + (1 - dayness) * 0.012;
    }
    this.renderer.toneMappingExposure = 0.7 + dayness * 0.45;

    // Spawns
    if (this.isNight()) {
      if (this.mobs.filter((m) => m.kind !== "boss").length < MOB_SPAWN_CAP_NIGHT && Math.random() < dt * 0.35) {
        const ang2 = Math.random() * Math.PI * 2;
        const dist = 14 + Math.random() * 18;
        const px = this.playerRoot.position.x + Math.cos(ang2) * dist;
        const pz = this.playerRoot.position.z + Math.sin(ang2) * dist;
        const kind: MobState["kind"] = Math.random() < 0.35 ? "skeleton" : Math.random() < 0.5 ? "wolf" : "slime";
        this.spawnMob(kind, px, pz);
      }
      if (this.spawnBossNextNight && !this.bossAlive && Math.random() < dt * 0.05) {
        this.spawnMob("boss", 18, -18);
        this.spawnBossNextNight = false;
      }
    } else {
      // Day: despawn distant trash mobs slowly
      this.spawnBossNextNight = true;
      for (const m of [...this.mobs]) {
        if (m.kind === "boss") continue;
        const d = Math.hypot(m.x - this.playerRoot.position.x, m.z - this.playerRoot.position.z);
        if (d > 30 && Math.random() < dt * 0.4) this.removeMob(m.id);
      }
      // Few day slimes
      if (this.mobs.length < MOB_SPAWN_CAP_DAY && Math.random() < dt * 0.08) {
        const ang2 = Math.random() * Math.PI * 2;
        const dist = 20 + Math.random() * 15;
        this.spawnMob("slime", Math.cos(ang2) * dist, Math.sin(ang2) * dist);
      }
    }
  }

  private updateMobs(dt: number) {
    const p = this.playerRoot.position;
    for (const m of this.mobs) {
      const dx = p.x - m.x;
      const dz = p.z - m.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      if (dist < m.aggro) {
        // Chase
        const sp = m.speed * dt;
        m.x += (dx / dist) * sp;
        m.z += (dz / dist) * sp;
        m.yaw = Math.atan2(dx, dz);
        if (dist < 1.4) {
          // Hit player
          const hasShield = countItem(this.inv, "shield") > 0 && this.stance === "combat";
          const dmg = hasShield ? m.atk * 0.45 : m.atk;
          if (Math.random() < dt * 1.8) {
            this.hp = Math.max(0, this.hp - dmg * dt * 8);
            if (this.hp <= 0) {
              this.hp = this.maxHp * 0.4;
              this.playerRoot.position.set(0, this.sampleHeight(0, 8) + 0.05, 8);
              this.setMessage("You were defeated — respawned at plaza.");
            }
          }
        }
      } else {
        // Wander
        m.yaw += (Math.random() - 0.5) * dt * 2;
        m.x += Math.sin(m.yaw) * m.speed * 0.25 * dt;
        m.z += Math.cos(m.yaw) * m.speed * 0.25 * dt;
      }
      m.y = this.sampleHeight(m.x, m.z);
      // Soft bounds
      const r = Math.hypot(m.x, m.z);
      if (r > WORLD_HALF) {
        m.x *= (WORLD_HALF - 1) / r;
        m.z *= (WORLD_HALF - 1) / r;
      }
      // Boss phase
      if (m.kind === "boss") {
        m.phaseT = (m.phaseT ?? 0) + dt;
        if (m.phaseT > 8) {
          m.phaseT = 0;
          // Summon adds
          this.spawnMob("slime", m.x + 2, m.z + 2);
          this.setMessage("Boss summons minions!");
        }
      }
      const mesh = this.mobMeshes.get(m.id);
      if (mesh) {
        mesh.position.set(m.x, m.y, m.z);
        mesh.rotation.y = m.yaw;
        mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 0.2);
      }
    }
  }

  private updateResources(dt: number) {
    const now = performance.now() / 1000;
    for (const n of this.resources) {
      if (n.hp <= 0 && n.respawnAt > 0 && now >= n.respawnAt) {
        n.hp = n.maxHp;
        n.respawnAt = 0;
        this.spawnResourceMesh(n);
      }
      const mesh = this.resourceMeshes.get(n.id);
      if (mesh && mesh.scale.x < 0.99) {
        mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 1 - Math.pow(0.001, dt));
      }
    }
  }

  private updateNpcs(dt: number) {
    // Simple idle sway + face player when close
    const p = this.playerRoot.position;
    for (const n of this.npcs) {
      const mesh = this.npcMeshes.get(n.id);
      if (!mesh) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < 8) {
        const target = Math.atan2(p.x - n.x, p.z - n.z);
        n.yaw = THREE.MathUtils.lerp(n.yaw, target, 1 - Math.pow(0.05, dt));
      } else {
        n.yaw += Math.sin(performance.now() * 0.001 + n.x) * 0.15 * dt;
      }
      mesh.rotation.y = n.yaw;
      mesh.position.y = n.y + Math.sin(performance.now() * 0.002 + n.z) * 0.02;
    }
  }

  private updateCamera(_dt: number) {
    const p = this.playerRoot.position;
    const ox = Math.sin(this.yaw) * -CAM_DIST * Math.cos(this.pitch);
    const oz = Math.cos(this.yaw) * -CAM_DIST * Math.cos(this.pitch);
    const oy = CAM_HEIGHT + Math.sin(this.pitch) * CAM_DIST;
    this.camera.position.set(p.x + ox, p.y + oy, p.z + oz);
    this.camera.lookAt(p.x, p.y + 1.4, p.z);
  }

  // ── Persist / HUD ──────────────────────────────────────────────────────────

  private setMessage(msg: string) {
    this.message = msg;
    this.messageT = 4.5;
  }

  private persist() {
    try {
      const data: LobbyWorldSave = {
        version: 1,
        player: {
          x: this.playerRoot.position.x,
          y: this.playerRoot.position.y,
          z: this.playerRoot.position.z,
          yaw: this.yaw,
          hp: this.hp,
          maxHp: this.maxHp,
          stance: this.stance,
          inventory: this.inv,
        },
        dayTime: this.dayTime,
        blocks: this.blocks,
        resources: this.resources,
        savedAt: Date.now(),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* quota */
    }
  }

  private updateNet(dt: number) {
    if (!this.worldNet?.inRoom) {
      for (const r of this.remotes.values()) r.update(dt);
      return;
    }
    this.pvpRoom = this.worldNet.roomCode;
    this.stateAccum += dt;
    if (this.stateAccum >= 0.05) {
      this.stateAccum = 0;
      const p = this.playerRoot.position;
      this.worldNet.sendState({
        px: p.x,
        py: p.y,
        pz: p.z,
        ry: this.yaw,
        clip: this.grudgeAvatar?.currentClipName() || (this.moving ? "run" : "idle"),
        weapon: this.weaponId,
        hp: Math.round(this.hp),
        moving: this.moving,
        grounded: this.grounded,
        guard: this.stance === "combat" && (this.offHand === "shield" || countItem(this.inv, "shield") > 0)
          ? "block"
          : "open",
      });
    }
    for (const r of this.remotes.values()) r.update(dt);
  }

  private pushHud(force = false) {
    if (!this.onHud && !force) return;
    const snap: LobbyHudSnapshot = {
      hp: this.hp,
      maxHp: this.maxHp,
      stance: this.stance,
      dayTime: this.dayTime,
      isNight: this.isNight(),
      inventory: this.inv,
      nearbyNpc: this.nearbyNpcName,
      targetLabel: this.targetLabel,
      message: this.message,
      loading: this.loading,
      mapLabel: this.mapLabel,
      mobCount: this.mobs.length,
      craftOpen: this.craftOpen,
      vendorOpen: this.vendorOpen,
      heroName: this.hero?.displayName ?? null,
      heroRace: this.hero?.race ?? null,
      heroClass: this.hero?.classSlug ?? null,
      heroFleetId: this.hero?.fleetId ?? null,
      heroCharacterId: this.hero?.characterId ?? null,
      authenticated: !!this.hero?.authenticated,
      weaponId: this.weaponId,
      pvpConnected: this.pvpConnected,
      pvpRoom: this.pvpRoom,
      pvpPeers: this.remotes.size,
      bagCloud: this.bagCloud,
    };
    this.onHud?.(snap);
  }
}
