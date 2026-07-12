import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { asset } from "./assets";
import { BEAR_ATTACK_DURATION, bearAttackPose, type BearAttackName } from "./bear/bearAttacks";

/**
 * The passive training-dummy models that stand in for the Danger Room's old
 * primitive "black target" capsules. Each one is a real GLB (already normalized
 * to {@link TARGET_HEIGHT}m tall with its feet at Y=0 by the offline
 * `convert-character` pipeline); we only clone, scale per-kind, and drive their
 * own embedded clips here. They never attack — animated ones merely idle/react.
 */
export type DummyKind =
  | "training"
  | "animatedTraining"
  | "dummyFight"
  | "ogre"
  | "bear"
  | "yellowBot";

/** All dummy GLBs are converted to this height (feet at Y=0) up front. */
const TARGET_HEIGHT = 2;

interface KindDef {
  /** Public path (under the artifact base) to the converted GLB. */
  file: string;
  /** Extra scale on top of the {@link TARGET_HEIGHT}m normalization. */
  scale: number;
  /** Clip whose loop reads as a calm idle (looped while standing). */
  idle?: RegExp;
  /** Clip played once when struck (hit-react), if the rig ships one. */
  react?: RegExp;
  /**
   * Fit this GLB to {@link TARGET_HEIGHT}m (feet at Y=0) at load time. Set for
   * rigs that did NOT go through the offline `convert-character` normalization
   * (e.g. the shared exo-armour mech asset reused as the boss body).
   */
  normalize?: boolean;
}

const DEFS: Record<DummyKind, KindDef> = {
  // Ships a gentle "Idle.001" loop — the classic standing training dummy.
  training: { file: "models/training-dummy.glb", scale: 1, idle: /idle/i },
  // Only ships "Damaged_*" hit clips: stand still, flinch when struck.
  animatedTraining: { file: "models/animated-training-dummy.glb", scale: 1, react: /damaged/i },
  // A humanoid+sandbag combo whose sole clip is a punch — keep it static so a
  // passive dummy never looks like it's swinging back.
  dummyFight: { file: "models/dummy-fight.glb", scale: 1 },
  // Low-poly creatures with a single ambient idle action — loop it, scaled up so
  // they read as the heavier variants.
  ogre: { file: "models/ogre.glb", scale: 1.35, idle: /action/i },
  bear: { file: "models/bear.glb", scale: 1.2, idle: /action/i },
  // The tall humanoid "yellow bot" boss body — reuses the exo-armour mech GLB.
  // It is NOT pre-normalized, so fit it to TARGET_HEIGHT (feet at Y=0) on load;
  // the boss group scales it up further (~1.7x) at spawn.
  yellowBot: { file: "models/exo-armor.glb", scale: 1, normalize: true },
};

/** A mounted dummy model: a scene-graph root plus its self-contained animation. */
export interface DummyInstance {
  /** Add this to the dummy's group; sits with feet at the group origin. */
  root: THREE.Group;
  /** Advance the embedded idle/react animation. */
  update(dt: number): void;
  /** Play a one-shot hit-react clip (no-op when the rig has none). */
  react(): void;
  /**
   * Play a distinct, readable procedural body motion for a named bear attack
   * (the bear rig ships no per-attack clips). Returns the motion's duration (s)
   * so the host can time its recover/cooldown off it, mirroring the avatar
   * fighters' `playClipOnce`. The pose is layered on top of the looping idle.
   */
  attack(name: BearAttackName): number;
  /** Detach + free this instance (shared template assets are freed once, later). */
  dispose(): void;
}

interface Template {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Geometries + materials shared by the template and every clone (freed once). */
  geos: Set<THREE.BufferGeometry>;
  mats: Set<THREE.Material>;
}

const loader = new GLTFLoader();

/**
 * Shared loader/cache for the passive dummy GLBs. One {@link Template} per kind
 * is fetched once; every dummy gets a {@link cloneSkeleton} clone that shares the
 * template's geometry + materials (so disposal frees them exactly once).
 */
export class DummyModels {
  private templates = new Map<DummyKind, Template>();
  private pending = new Map<DummyKind, Promise<Template | null>>();
  private disposed = false;

  /** Load (once) the template for `kind`; resolves null if disposed mid-load. */
  async ensure(kind: DummyKind): Promise<Template | null> {
    const cached = this.templates.get(kind);
    if (cached) return cached;
    const inFlight = this.pending.get(kind);
    if (inFlight) return inFlight;
    const job = this.load(kind);
    this.pending.set(kind, job);
    return job;
  }

  private async load(kind: DummyKind): Promise<Template | null> {
    const def = DEFS[kind];
    try {
      const gltf = await loader.loadAsync(asset(def.file));
      if (this.disposed) {
        disposeTree(gltf.scene);
        return null;
      }
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          if (m.geometry) geos.add(m.geometry);
          for (const mat of materialsOf(m)) mats.add(mat);
        }
      });
      const tpl: Template = { scene: gltf.scene, clips: gltf.animations ?? [], geos, mats };
      this.templates.set(kind, tpl);
      return tpl;
    } finally {
      // Always clear the in-flight slot so a rejected load can be retried later
      // (and never wedges the kind on a permanently-rejected promise).
      this.pending.delete(kind);
    }
  }

  /**
   * Clone a ready template into a mountable instance. Returns null if `kind`
   * hasn't been {@link ensure}d yet. The clone shares the template's geo/mats.
   */
  create(kind: DummyKind): DummyInstance | null {
    const tpl = this.templates.get(kind);
    if (!tpl) return null;
    const def = DEFS[kind];
    const root = new THREE.Group();
    const model = cloneSkeleton(tpl.scene);
    model.scale.setScalar(def.scale);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    root.add(model);

    // Un-normalized rigs (e.g. the boss exo-armour mech): fit to TARGET_HEIGHT and
    // drop the feet to Y=0, re-centred on the ground plane. The fit overrides the
    // per-kind `scale` height-wise, so normalized kinds keep `scale: 1`.
    if (def.normalize) {
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const h = size.y || 1;
      model.scale.multiplyScalar(TARGET_HEIGHT / h);
      const fitted = new THREE.Box3().setFromObject(model);
      model.position.y -= fitted.min.y;
      model.position.x -= (fitted.min.x + fitted.max.x) / 2;
      model.position.z -= (fitted.min.z + fitted.max.z) / 2;
    }

    const mixer = new THREE.AnimationMixer(model);
    let reactAction: THREE.AnimationAction | null = null;

    const idleClip = def.idle ? tpl.clips.find((c) => def.idle!.test(c.name)) : undefined;
    const reactClip = def.react ? tpl.clips.find((c) => def.react!.test(c.name)) : undefined;

    if (idleClip) {
      const a = mixer.clipAction(idleClip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
    } else if (tpl.clips.length > 0) {
      // No idle clip: freeze on the first frame of the first clip so the rig
      // adopts a natural authored stance instead of a splayed bind pose — but
      // never advances (a passive dummy must not animate an attack).
      const a = mixer.clipAction(tpl.clips[0]);
      a.play();
      mixer.update(0);
      a.paused = true;
    }
    if (reactClip) {
      reactAction = mixer.clipAction(reactClip);
      reactAction.setLoop(THREE.LoopOnce, 1);
      reactAction.clampWhenFinished = true;
    }

    // Base transform the procedural attack pose is layered on top of (identity
    // for normalized rigs; carries the fit offset for un-normalized ones).
    const basePos = model.position.clone();
    const baseRotX = model.rotation.x;
    // Active procedural attack motion (the bear's per-attack body tell), if any.
    let atk: { name: BearAttackName; t: number; dur: number } | null = null;
    const resetAttackPose = () => {
      model.position.copy(basePos);
      model.rotation.x = baseRotX;
    };

    return {
      root,
      update: (dt: number) => {
        mixer.update(dt);
        if (!atk) return;
        atk.t += dt;
        const phase = atk.t / atk.dur;
        if (phase >= 1) {
          atk = null;
          resetAttackPose();
          return;
        }
        const pose = bearAttackPose(atk.name, phase);
        model.rotation.x = baseRotX + pose.pitch;
        model.position.set(basePos.x, basePos.y + pose.lift, basePos.z + pose.lunge);
      },
      react: () => {
        if (!reactAction) return;
        reactAction.reset();
        reactAction.play();
      },
      attack: (name: BearAttackName): number => {
        const dur = BEAR_ATTACK_DURATION[name];
        atk = { name, t: 0, dur };
        return dur;
      },
      dispose: () => {
        mixer.stopAllAction();
        mixer.uncacheRoot(model);
        root.parent?.remove(root);
        root.clear();
      },
    };
  }

  /** Free every loaded template's shared geometry + materials. */
  dispose(): void {
    this.disposed = true;
    for (const tpl of this.templates.values()) {
      for (const g of tpl.geos) g.dispose();
      for (const m of tpl.mats) m.dispose();
    }
    this.templates.clear();
    this.pending.clear();
  }
}

function materialsOf(m: THREE.Mesh): THREE.Material[] {
  return Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    for (const mat of materialsOf(m)) mat.dispose();
  });
}

export { TARGET_HEIGHT as DUMMY_MODEL_HEIGHT };
