/**
 * Wildlife population: Quirky animals pack + navmesh pathing + AI + corpses + butcher.
 *
 * Additive — does not replace Targets / DungeonEnemies combat NPCs.
 * Optional NavGrid (dungeon/island); without it, wanders on the XZ plane at y=0.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { asset } from "../assets";
import { filterBindableTracks } from "../clipTracks";
import {
  cellCenter,
  findPath,
  heightAt,
  isWalkable,
  nearestWalkable,
  worldToCell,
  type NavGrid,
} from "../dungeon/navmesh";
import { stepAnimalBrain, type AnimalAiState } from "./animalBrain";
import {
  ANIMAL_SPECIES,
  CORPSE_LIFETIME_S,
  WILDLIFE_MAX,
  WILDLIFE_PACK_FILE,
  getSpecies,
  landSpawnSpecies,
  rollButcherYield,
  type AnimalSpeciesDef,
  type AnimalSpeciesId,
} from "./catalog";

export interface HarvestDrop {
  itemId: string;
  label: string;
  qty: number;
  speciesId: AnimalSpeciesId;
  animalId: number;
  position: THREE.Vector3;
}

export interface WildlifeAnimalPublic {
  id: number;
  speciesId: AnimalSpeciesId;
  label: string;
  alive: boolean;
  harvestable: boolean;
  harvested: boolean;
  health: number;
  maxHealth: number;
  position: THREE.Vector3;
  corpseRemaining: number;
}

interface LiveAnimal {
  id: number;
  def: AnimalSpeciesDef;
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
  health: number;
  ai: AnimalAiState;
  stateT: number;
  goal: THREE.Vector3 | null;
  path: { x: number; z: number }[];
  pathI: number;
  hurtPulse: boolean;
  deathBlend: number;
  corpseT: number;
  harvested: boolean;
  /** Facing yaw (rad). */
  yaw: number;
  fallAxis: THREE.Vector3;
}

export class WildlifeSystem {
  readonly group = new THREE.Group();
  /** Fired when the player successfully butchers a corpse. */
  onHarvest: ((drops: HarvestDrop[]) => void) | null = null;
  /** Optional toast/UI hook. */
  onMessage: ((msg: string) => void) | null = null;

  private scene: THREE.Scene;
  private pack: THREE.Group | null = null;
  private packClips: THREE.AnimationClip[] = [];
  private templates = new Map<AnimalSpeciesId, THREE.Object3D>();
  private animals: LiveAnimal[] = [];
  private nextId = 1;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private nav: NavGrid | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group.name = "wildlife";
    scene.add(this.group);
  }

  /** Bind a navmesh for A* wander/flee (dungeon / island). Null = flat plane. */
  setNav(nav: NavGrid | null): void {
    this.nav = nav;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.loadPack();
    await this.loadPromise;
  }

  private async loadPack(): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(asset(WILDLIFE_PACK_FILE));
    this.pack = gltf.scene;
    this.packClips = gltf.animations ?? [];
    this.pack.updateWorldMatrix(true, true);

    for (const def of ANIMAL_SPECIES) {
      const node = this.pack.getObjectByName(def.rootNode);
      if (!node) {
        console.warn(`[wildlife] missing root ${def.rootNode} for ${def.id}`);
        continue;
      }
      // Template stays in pack; we clone per spawn.
      this.templates.set(def.id, node);
    }
    this.loaded = true;
  }

  /**
   * Spawn a balanced land pack (Danger Room / island default).
   * Aquatic species are skipped unless includeAquatic.
   */
  spawnDefault(count = 10, opts?: { includeAquatic?: boolean; center?: THREE.Vector3; radius?: number }): void {
    if (!this.loaded) {
      console.warn("[wildlife] spawnDefault before load()");
      return;
    }
    const pool = opts?.includeAquatic
      ? [...ANIMAL_SPECIES]
      : landSpawnSpecies();
    const weighted: AnimalSpeciesDef[] = [];
    for (const s of pool) {
      for (let i = 0; i < Math.max(1, s.spawnWeight); i++) weighted.push(s);
    }
    if (!weighted.length) return;

    const n = Math.min(count, WILDLIFE_MAX - this.animals.length);
    const center = opts?.center?.clone() ?? new THREE.Vector3(0, 0, 0);
    const radius = opts?.radius ?? 14;

    for (let i = 0; i < n; i++) {
      const def = weighted[Math.floor(Math.random() * weighted.length)];
      const pos = this.pickSpawnPos(center, radius);
      if (pos) this.spawnOne(def.id, pos);
    }
  }

  spawnOne(speciesId: AnimalSpeciesId, position: THREE.Vector3): number | null {
    if (!this.loaded || this.animals.length >= WILDLIFE_MAX) return null;
    const def = getSpecies(speciesId);
    const template = this.templates.get(speciesId);
    if (!template) return null;

    const model = template.clone(true);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
      }
    });

    // Normalize height; feet on local y=0.
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const s = size.y > 1e-4 ? def.heightM / size.y : 1;
    model.scale.setScalar(s);
    const box2 = new THREE.Box3().setFromObject(model);
    model.position.y -= box2.min.y;

    const root = new THREE.Group();
    root.name = `animal-${speciesId}`;
    root.add(model);
    root.position.copy(position);
    if (this.nav) {
      root.position.y = heightAt(this.nav, position.x, position.z, position.y);
    }
    this.group.add(root);

    let mixer: THREE.AnimationMixer | null = null;
    let action: THREE.AnimationAction | null = null;
    if (this.packClips.length) {
      mixer = new THREE.AnimationMixer(model);
      // Prefer a clip with the most bindable tracks for this animal.
      let best: THREE.AnimationClip | null = null;
      let bestN = -1;
      for (const raw of this.packClips) {
        const clip = filterBindableTracks(model, raw);
        if (clip.tracks.length > bestN) {
          best = clip;
          bestN = clip.tracks.length;
        }
      }
      if (best && best.tracks.length) {
        action = mixer.clipAction(best);
        action.play();
        action.setEffectiveWeight(1);
      }
    }

    const id = this.nextId++;
    const animal: LiveAnimal = {
      id,
      def,
      root,
      model,
      mixer,
      action,
      health: def.health,
      ai: "idle",
      stateT: Math.random() * 1.5,
      goal: null,
      path: [],
      pathI: 0,
      hurtPulse: false,
      deathBlend: 0,
      corpseT: 0,
      harvested: false,
      yaw: Math.random() * Math.PI * 2,
      fallAxis: new THREE.Vector3(1, 0, 0),
    };
    this.animals.push(animal);
    return id;
  }

  /** Deal damage; returns true if the hit registered. */
  damage(animalId: number, amount: number, from?: THREE.Vector3): boolean {
    const a = this.animals.find((x) => x.id === animalId);
    if (!a || a.ai === "dead" || a.health <= 0) return false;
    a.health = Math.max(0, a.health - amount);
    a.hurtPulse = true;
    if (from) {
      // Fall away from attacker.
      this.tmp.copy(a.root.position).sub(from).setY(0);
      if (this.tmp.lengthSq() > 1e-6) {
        this.tmp.normalize();
        a.fallAxis.set(-this.tmp.z, 0, this.tmp.x); // perpendicular → tip sideways
      }
    }
    if (a.health <= 0) this.kill(a);
    return true;
  }

  /** Damage nearest animal within radius of point (melee swing helper). */
  damageNear(point: THREE.Vector3, radius: number, amount: number): number {
    let hits = 0;
    for (const a of this.animals) {
      if (a.ai === "dead") continue;
      if (a.root.position.distanceTo(point) <= radius) {
        if (this.damage(a.id, amount, point)) hits++;
      }
    }
    return hits;
  }

  /**
   * Skin & butcher a harvestable corpse within `reach` of `playerPos`.
   * Returns drops or null if nothing available.
   */
  tryHarvest(playerPos: THREE.Vector3, reach = 2.2): HarvestDrop[] | null {
    let best: LiveAnimal | null = null;
    let bestD = reach;
    for (const a of this.animals) {
      if (a.ai !== "dead" || a.harvested || a.corpseT <= 0) continue;
      const d = a.root.position.distanceTo(playerPos);
      if (d <= bestD) {
        best = a;
        bestD = d;
      }
    }
    if (!best) {
      this.onMessage?.("Nothing to skin nearby.");
      return null;
    }
    const rolls = rollButcherYield(best.def);
    best.harvested = true;
    // Visual: sink/flatten slightly after butcher.
    best.root.scale.multiplyScalar(0.92);
    const drops: HarvestDrop[] = rolls.map((r) => ({
      ...r,
      speciesId: best!.def.id,
      animalId: best!.id,
      position: best!.root.position.clone(),
    }));
    this.onHarvest?.(drops);
    const summary = drops.map((d) => `${d.qty}× ${d.label}`).join(", ");
    this.onMessage?.(summary ? `Butchered ${best.def.label}: ${summary}` : `Butchered ${best.def.label}.`);
    return drops;
  }

  list(): WildlifeAnimalPublic[] {
    return this.animals.map((a) => ({
      id: a.id,
      speciesId: a.def.id,
      label: a.def.label,
      alive: a.ai !== "dead",
      harvestable: a.ai === "dead" && !a.harvested && a.corpseT > 0,
      harvested: a.harvested,
      health: a.health,
      maxHealth: a.def.health,
      position: a.root.position.clone(),
      corpseRemaining: a.ai === "dead" ? a.corpseT : 0,
    }));
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    if (!this.animals.length) return;
    const remove: number[] = [];

    for (const a of this.animals) {
      a.mixer?.update(dt);

      if (a.ai === "dead") {
        // Fall to side over ~0.55s, then linger.
        if (a.deathBlend < 1) {
          a.deathBlend = Math.min(1, a.deathBlend + dt / 0.55);
          const t = a.deathBlend * a.deathBlend * (3 - 2 * a.deathBlend);
          a.model.rotation.z = 0;
          a.model.rotation.x = 0;
          // Tip onto side around local forward-perpendicular.
          a.model.quaternion.setFromAxisAngle(a.fallAxis, (Math.PI / 2) * t);
        }
        a.corpseT -= dt;
        if (a.corpseT <= 0) remove.push(a.id);
        continue;
      }

      const distPlayer = a.root.position.distanceTo(playerPos);
      const atGoal =
        !a.goal ||
        a.root.position.distanceToSquared(this.tmp.set(a.goal.x, a.root.position.y, a.goal.z)) < 0.35 * 0.35;

      const brain = stepAnimalBrain(
        {
          state: a.ai,
          stateT: a.stateT,
          distPlayer,
          detectRange: a.def.detectRange,
          temperament: a.def.temperament,
          hurt: a.hurtPulse,
          health: a.health,
          atGoal,
        },
        dt,
      );
      a.hurtPulse = false;
      a.ai = brain.state;
      a.stateT = brain.stateT;

      if (brain.state === "dead") {
        this.kill(a);
        continue;
      }

      if (brain.pickNewGoal) {
        if (brain.fleeFromPlayer) {
          this.tmp.copy(a.root.position).sub(playerPos).setY(0);
          if (this.tmp.lengthSq() < 1e-6) this.tmp.set(Math.cos(a.yaw), 0, Math.sin(a.yaw));
          this.tmp.normalize().multiplyScalar(6 + Math.random() * 5);
          this.tmp2.copy(a.root.position).add(this.tmp);
          a.goal = this.clampGoal(this.tmp2);
          this.rebuildPath(a);
        } else {
          a.goal = this.randomGoalNear(a.root.position, 4 + Math.random() * 6);
          this.rebuildPath(a);
        }
      }

      const speed =
        (brain.speedFrac >= 0.99 ? a.def.fleeSpeed : a.def.walkSpeed) * brain.speedFrac;
      if (speed > 1e-4) this.advanceAlongPath(a, speed * dt);

      // Anim rate: idle slow, flee faster.
      if (a.action) {
        a.action.timeScale = brain.speedFrac > 0.8 ? 1.35 : brain.speedFrac > 0.1 ? 1.0 : 0.35;
      }

      // Snap to nav height.
      if (this.nav) {
        a.root.position.y = heightAt(this.nav, a.root.position.x, a.root.position.z, a.root.position.y);
      }
    }

    if (remove.length) {
      this.animals = this.animals.filter((a) => {
        if (!remove.includes(a.id)) return true;
        a.mixer?.stopAllAction();
        a.root.removeFromParent();
        return false;
      });
    }
  }

  dispose(): void {
    for (const a of this.animals) {
      a.mixer?.stopAllAction();
      a.root.removeFromParent();
    }
    this.animals = [];
    this.group.removeFromParent();
    this.pack = null;
    this.templates.clear();
    this.loaded = false;
    this.loadPromise = null;
  }

  // ---- internals ----------------------------------------------------------

  private kill(a: LiveAnimal): void {
    a.ai = "dead";
    a.health = 0;
    a.stateT = 0;
    a.corpseT = CORPSE_LIFETIME_S;
    a.deathBlend = 0;
    a.goal = null;
    a.path = [];
    a.action?.fadeOut(0.2);
    // Randomize fall side if not set from damage.
    if (a.fallAxis.lengthSq() < 1e-6) {
      const side = Math.random() > 0.5 ? 1 : -1;
      a.fallAxis.set(side, 0, 0);
    }
    a.fallAxis.normalize();
  }

  private pickSpawnPos(center: THREE.Vector3, radius: number): THREE.Vector3 | null {
    for (let i = 0; i < 40; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * radius;
      const x = center.x + Math.cos(ang) * r;
      const z = center.z + Math.sin(ang) * r;
      if (this.nav) {
        const cell = worldToCell(this.nav, x, z);
        if (!isWalkable(this.nav, cell.c, cell.r)) {
          const nw = nearestWalkable(this.nav, cell.c, cell.r);
          if (!nw) continue;
          const ctr = cellCenter(this.nav, nw.c, nw.r);
          const y = heightAt(this.nav, ctr.x, ctr.z, center.y);
          return new THREE.Vector3(ctr.x, y, ctr.z);
        }
        const y = heightAt(this.nav, x, z, center.y);
        return new THREE.Vector3(x, y, z);
      }
      return new THREE.Vector3(x, center.y, z);
    }
    return center.clone();
  }

  private randomGoalNear(from: THREE.Vector3, radius: number): THREE.Vector3 {
    const ang = Math.random() * Math.PI * 2;
    const r = 1.5 + Math.random() * radius;
    return this.clampGoal(new THREE.Vector3(from.x + Math.cos(ang) * r, from.y, from.z + Math.sin(ang) * r));
  }

  private clampGoal(p: THREE.Vector3): THREE.Vector3 {
    if (!this.nav) return p;
    const cell = worldToCell(this.nav, p.x, p.z);
    if (isWalkable(this.nav, cell.c, cell.r)) {
      const y = heightAt(this.nav, p.x, p.z, p.y);
      return new THREE.Vector3(p.x, y, p.z);
    }
    const nw = nearestWalkable(this.nav, cell.c, cell.r);
    if (!nw) return p;
    const ctr = cellCenter(this.nav, nw.c, nw.r);
    return new THREE.Vector3(ctr.x, heightAt(this.nav, ctr.x, ctr.z, p.y), ctr.z);
  }

  private rebuildPath(a: LiveAnimal): void {
    a.path = [];
    a.pathI = 0;
    if (!a.goal) return;
    if (!this.nav) {
      a.path = [{ x: a.goal.x, z: a.goal.z }];
      return;
    }
    const path = findPath(
      this.nav,
      a.root.position.x,
      a.root.position.z,
      a.goal.x,
      a.goal.z,
    );
    if (path?.length) {
      a.path = path.map((w) => ({ x: w.x, z: w.z }));
    } else {
      a.path = [{ x: a.goal.x, z: a.goal.z }];
    }
  }

  private advanceAlongPath(a: LiveAnimal, step: number): void {
    if (!a.path.length) return;
    let remaining = step;
    while (remaining > 1e-5 && a.pathI < a.path.length) {
      const wp = a.path[a.pathI];
      this.tmp.set(wp.x, a.root.position.y, wp.z);
      const to = this.tmp.sub(a.root.position);
      to.y = 0;
      const dist = to.length();
      if (dist < 0.12) {
        a.pathI++;
        continue;
      }
      const move = Math.min(remaining, dist);
      to.multiplyScalar(move / dist);
      a.root.position.add(to);
      a.yaw = Math.atan2(to.x, to.z);
      a.root.rotation.y = a.yaw;
      remaining -= move;
      if (move >= dist - 1e-4) a.pathI++;
    }
  }
}
