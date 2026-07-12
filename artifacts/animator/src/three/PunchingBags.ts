import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { asset } from "./assets";
import { RAPIER } from "./PhysicsSystem";
import { HealthBar } from "./HealthBar";

/**
 * Free-standing punching bags for the Danger Room — hittable training targets.
 *
 * The bag GLB is a COMPLETE cantilever stand: a weighted base plate, an angled
 * upright, a top bar, a bracket, and the bag itself hanging from the bar's tip.
 * We do NOT build any procedural post — the model already carries its own
 * pole + bar. We simply plant the stand and split the hanging bag mesh
 * (`Cylinder.002`) out as a dynamic Rapier body so it swings as a pendulum off
 * the bracket while the frame stays perfectly static.
 *
 * Every size/offset below is MEASURED from the loaded geometry at runtime (not
 * hard-coded), so the wiring stays correct regardless of the model's authored
 * scale or where the bag hangs on the frame.
 *
 * Bags also track health like a training dummy: each shows an in-world health
 * bar, takes damage from the same melee/skill hits that knock it swinging, and
 * "dies" (then respawns) when depleted.
 *
 * Renderer-agnostic at the sim layer (body/joint setup); only the visual sync
 * touches three, so it carries cleanly into a future r3f rewrite.
 */

const BAG_FILE = "models/props/punching-bag.glb";
/** Total stand height in metres — the whole GLB is uniformly scaled to this. */
const TARGET_TOTAL_H = 2.4;
/** Rotate each stand so its cantilever arm + bag face the player (+Z side). */
const FACE_YAW = -Math.PI / 2;
/** Slack between the bag top and the pivot point (top of the bracket). */
const SLACK = 0.12;
/** Heavy-bag density: dense enough to read as weight, light enough to swing. */
const DENSITY = 2.5;
/** Hit points per bag before it "dies" (then respawns). */
const MAX_HEALTH = 120;
/** Seconds a depleted bag stays down before respawning. */
const RESPAWN_TIME = 3.2;

/** Stand base spots — a shallow arc in front of the player spawn (forward is −Z). */
const LAYOUT: ReadonlyArray<readonly [number, number]> = [
  [-4.6, -5.2],
  [-2.3, -6.2],
  [0, -6.6],
  [2.3, -6.2],
  [4.6, -5.2],
];

interface Bag {
  body: RAPIER.RigidBody;
  /** Fixed pivot world point (bracket tip) the bag hangs from. */
  pivot: THREE.Vector3;
  /** Rest centre of the bag body (for respawn). */
  rest: THREE.Vector3;
  /** Group whose origin is the bag's centre of mass; slaved to the body. */
  visual: THREE.Group;
  bar: HealthBar;
  health: number;
  dead: boolean;
  respawnT: number;
}

export class PunchingBags {
  group = new THREE.Group();
  private scene: THREE.Scene;
  private world: RAPIER.World;
  private bags: Bag[] = [];
  /** The loaded, scaled, ground-aligned source model (clone source, never added). */
  private template: THREE.Object3D | null = null;
  /** Unique geos/mats owned by the template — clones share these by reference. */
  private tplGeos: THREE.BufferGeometry[] = [];
  private tplMats: THREE.Material[] = [];
  /**
   * Traversal index of the hanging-bag sub-mesh within the stand (stable across
   * clones of the one template); -1 when the model exposes no meshes.
   */
  private bagMeshIndex = -1;

  constructor(scene: THREE.Scene, world: RAPIER.World) {
    this.scene = scene;
    this.world = world;
    scene.add(this.group);
  }

  /** Load the stand GLB and build the static frames + swinging bag bodies. */
  async load(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(asset(BAG_FILE));
    const template = gltf.scene;

    // Uniformly scale the whole stand to the target total height, then lift so
    // its base rests exactly on the ground (y = 0).
    const pre = new THREE.Box3().setFromObject(template);
    const preSize = pre.getSize(new THREE.Vector3());
    template.scale.setScalar(TARGET_TOTAL_H / Math.max(preSize.y, 1e-3));
    template.updateMatrixWorld(true);
    const lifted = new THREE.Box3().setFromObject(template);
    template.position.y -= lifted.min.y;
    template.updateMatrixWorld(true);

    template.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        const g = m.geometry as THREE.BufferGeometry;
        if (g && !this.tplGeos.includes(g)) this.tplGeos.push(g);
        const mat = m.material;
        for (const x of Array.isArray(mat) ? mat : [mat]) {
          if (x && !this.tplMats.includes(x)) this.tplMats.push(x);
        }
      }
    });
    this.template = template;
    this.bagMeshIndex = PunchingBags.findBagMeshIndex(template);

    for (const [x, z] of LAYOUT) {
      const bag = this.makeBag(x, z);
      if (bag) this.bags.push(bag);
    }
  }

  /** Meshes under `root` in deterministic DFS order (stable across clones). */
  private static meshesOf(root: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
    });
    return out;
  }

  /**
   * Pick the hanging-bag sub-mesh by measured geometry rather than a brittle
   * authored name (the GLB's mesh names are pack-specific and were drifting). The
   * bag hangs from the bracket, so it sits in the upper region of the stand; and
   * unlike the thin post/arm/bracket it is a fat cylinder, so its smaller
   * horizontal extent (min of width/depth) is by far the largest. We score every
   * mesh whose centre is in the upper 60% by that "chunkiness" and take the max,
   * falling back to the chunkiest mesh overall for unusual layouts. Returns the
   * mesh's traversal index, or -1 when the model has no meshes at all.
   */
  private static findBagMeshIndex(template: THREE.Object3D): number {
    template.updateMatrixWorld(true);
    const meshes = PunchingBags.meshesOf(template);
    if (meshes.length === 0) return -1;
    const whole = new THREE.Box3().setFromObject(template);
    const midY = whole.min.y + (whole.max.y - whole.min.y) * 0.4;
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    const chunkOf = (m: THREE.Mesh): number => {
      box.setFromObject(m).getSize(size);
      return Math.min(size.x, size.z);
    };
    let bestIdx = -1;
    let bestScore = -Infinity;
    meshes.forEach((m, i) => {
      box.setFromObject(m);
      box.getCenter(center);
      if (center.y < midY) return;
      box.getSize(size);
      const chunk = Math.min(size.x, size.z);
      if (chunk > bestScore) {
        bestScore = chunk;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0) return bestIdx;
    meshes.forEach((m, i) => {
      const chunk = chunkOf(m);
      if (chunk > bestScore) {
        bestScore = chunk;
        bestIdx = i;
      }
    });
    return bestIdx;
  }

  /**
   * Plant one static stand at (x, z) and split its hanging bag into a swinging
   * dynamic body. Returns null if the GLB lacks any bag sub-mesh (the frame
   * still stands; we just skip the dynamic bag rather than crash).
   */
  private makeBag(x: number, z: number): Bag | null {
    if (!this.template || this.bagMeshIndex < 0) return null;

    // --- static frame (the model's own base + upright + bar + bracket) -------
    const stand = this.template.clone(true);
    stand.rotation.y = FACE_YAW;
    stand.position.set(x, 0, z);
    this.group.add(stand);
    stand.updateMatrixWorld(true);

    const standBag = PunchingBags.meshesOf(stand)[this.bagMeshIndex];
    if (!standBag) return null;
    // Measure the bag's world placement on THIS planted frame, then hide it from
    // the static stand (the dynamic clone below draws the moving bag instead).
    const wbox = new THREE.Box3().setFromObject(standBag);
    const center = wbox.getCenter(new THREE.Vector3());
    const top = wbox.max.y;
    const halfH = (wbox.max.y - wbox.min.y) / 2;
    const radius = Math.max(wbox.max.x - wbox.min.x, wbox.max.z - wbox.min.z) / 2;
    standBag.visible = false;

    // --- dynamic bag visual (bag mesh only, re-centred on its own centroid) ---
    const bagSrc = this.template.clone(true);
    bagSrc.rotation.y = FACE_YAW;
    bagSrc.updateMatrixWorld(true);
    PunchingBags.meshesOf(bagSrc).forEach((m, i) => {
      m.visible = i === this.bagMeshIndex;
    });
    const localBox = new THREE.Box3().setFromObject(bagSrc);
    bagSrc.position.sub(localBox.getCenter(new THREE.Vector3()));
    const visual = new THREE.Group();
    visual.add(bagSrc);
    this.group.add(visual);

    // --- physics: a damped pendulum pinned to a fixed anchor at the bracket ---
    const pivotY = top + SLACK;
    const anchorBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, pivotY, center.z),
    );
    const bagBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(center.x, center.y, center.z)
        .setLinearDamping(0.9)
        .setAngularDamping(1.4)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(halfH, radius).setDensity(DENSITY).setFriction(0.6),
      bagBody,
    );
    // Spherical joint: anchor coincides with the bag's pinned top point so it
    // hangs as a stable pendulum pivoting at the bracket.
    const joint = RAPIER.JointData.spherical(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: pivotY - center.y, z: 0 },
    );
    this.world.createImpulseJoint(joint, anchorBody, bagBody, true);

    const bar = new HealthBar();
    this.group.add(bar.group);

    return {
      body: bagBody,
      pivot: new THREE.Vector3(center.x, pivotY, center.z),
      rest: center.clone(),
      visual,
      bar,
      health: MAX_HEALTH,
      dead: false,
      respawnT: 0,
    };
  }

  /**
   * Slave each bag visual to its physics body and update its health bar. Call
   * after physics.step. `dt` drives the respawn timer; `camera` billboards bars.
   */
  sync(dt: number, camera: THREE.Camera): void {
    const barTop = new THREE.Vector3();
    for (const bag of this.bags) {
      if (bag.dead) {
        bag.respawnT -= dt;
        if (bag.respawnT <= 0) this.respawn(bag);
        continue;
      }
      const t = bag.body.translation();
      const r = bag.body.rotation();
      bag.visual.position.set(t.x, t.y, t.z);
      bag.visual.quaternion.set(r.x, r.y, r.z, r.w);
      bag.bar.setRatio(bag.health / MAX_HEALTH);
      barTop.set(bag.pivot.x, bag.pivot.y + 0.4, bag.pivot.z);
      bag.bar.place(barTop, camera);
    }
  }

  /** Restore a depleted bag: heal, reset its body to rest, show it again. */
  private respawn(bag: Bag): void {
    bag.health = MAX_HEALTH;
    bag.dead = false;
    bag.body.setTranslation({ x: bag.rest.x, y: bag.rest.y, z: bag.rest.z }, true);
    bag.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    bag.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    bag.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    bag.visual.visible = true;
    bag.bar.setVisible(true);
  }

  private kill(bag: Bag): void {
    bag.dead = true;
    bag.respawnT = RESPAWN_TIME;
    bag.visual.visible = false;
    bag.bar.setVisible(false);
  }

  /**
   * Knock every live bag within `radius` of `center` swinging AND deal `damage`,
   * both scaled by distance falloff. A single hit reconciles the impulse-based
   * swing reaction with the health/damage tracking, so one strike both wobbles
   * the bag on its frame and drains its health bar (depleting it "kills" it).
   * Applied below the bag's centre so it swings rather than spins flat.
   */
  blast(center: THREE.Vector3, radius: number, force: number, damage = 0): void {
    const dir = new THREE.Vector3();
    for (const bag of this.bags) {
      if (bag.dead) continue;
      const t = bag.body.translation();
      const reach = radius + 0.5;
      dir.set(t.x - center.x, 0, t.z - center.z);
      const dist = dir.length();
      if (dist > reach) continue;
      const falloff = 1 - dist / reach;
      if (dir.lengthSq() < 1e-5) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      dir.normalize();
      const mag = THREE.MathUtils.clamp(force, 4, 60) * 0.35 * (0.5 + 0.5 * falloff);
      bag.body.applyImpulseAtPoint(
        { x: dir.x * mag, y: 0, z: dir.z * mag },
        { x: t.x, y: t.y - 0.35, z: t.z },
        true,
      );
      if (damage > 0) {
        bag.health -= damage * (0.5 + 0.5 * falloff);
        if (bag.health <= 0) this.kill(bag);
      }
    }
  }

  dispose(): void {
    // Remove the bag bodies (and their joints/colliders) from the world.
    for (const bag of this.bags) {
      this.world.removeRigidBody(bag.body);
      bag.bar.dispose();
    }
    this.bags.length = 0;
    // Every stand/bag clone shares the template's geos+mats by reference, so we
    // dispose that owned set exactly once here (never per-clone).
    for (const g of this.tplGeos) g.dispose();
    for (const m of this.tplMats) m.dispose();
    this.tplGeos.length = 0;
    this.tplMats.length = 0;
    this.template = null;
    this.group.clear();
    this.group.parent?.remove(this.group);
  }
}
