/**
 * Racalvin the Pirate King's shoulder parrot — stylized animated GLB.
 *
 * Canonical companion for `gunslinger` (Racalvin):
 *   - Idle / preen on the right shoulder
 *   - Attack clip + emoji burst on LMB / skills
 *   - Hover / circle-fly flair on signature casts
 *
 * Source asset: `public/models/parrot-stylized.glb`
 * (from `parrot__stylized_animated_3d_model.glb`).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { asset } from "../assets";

export interface ParrotPetDef {
  /** Path under BASE_URL. */
  file: string;
  /** Target visual height in meters (shoulder pet ~0.32–0.42 m). */
  heightM?: number;
  /** Local offset from attach bone / shoulder anchor (m). */
  offset?: { x: number; y: number; z: number };
  /** Prefer these bone name substrings for shoulder seat. */
  shoulderBones?: string[];
  clips?: {
    idle?: string;
    idle2?: string;
    attack?: string;
    hover?: string;
    fly?: string;
    rise?: string;
    preen?: string;
    land?: string;
    die?: string;
  };
}

/** Built-in clip names from the Sketchfab stylized parrot pack. */
export const PARROT_CLIPS = {
  idle: "ParrotALL_Idle",
  idle2: "ParrotALL_Idle2",
  attack: "ParrotALL_Attack",
  hover: "ParrotALL_Hover",
  fly: "ParrotALL_Fly",
  rise: "ParrotALL_Rise",
  preen: "ParrotALL_Preen",
  land: "ParrotALL_Land",
  circle: "ParrotALL_CircleFly",
  die: "ParrotALL_Die",
} as const;

/** Canonical Racalvin companion def. */
export const RACALVIN_PARROT: ParrotPetDef = {
  file: "models/parrot-stylized.glb",
  heightM: 0.36,
  offset: { x: 0.11, y: 0.06, z: 0.04 },
  shoulderBones: [
    "RightShoulder",
    "R_Shoulder",
    "Shoulder_R",
    "clavicle_r",
    "Clavicle_R",
    "RightArm",
    "UpperArm_R",
    "R_UpperArm",
    "mixamorigRightShoulder",
    "Head",
  ],
  clips: { ...PARROT_CLIPS },
};

type PetMood = "idle" | "attack" | "skill" | "preen" | "hover";

const EMOJI: Record<PetMood, string> = {
  idle: "🦜",
  attack: "🦜⚔️",
  skill: "🦜💥",
  preen: "🦜✨",
  hover: "🦜💨",
};

function fixMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
        if (mat.map) {
          mat.map.colorSpace = THREE.SRGBColorSpace;
          mat.map.needsUpdate = true;
        }
        // Spec/gloss assets often load dark without IBL — keep them readable.
        if (mat.metalness > 0.15) {
          mat.metalness = 0.05;
          if (mat.roughness < 0.4) mat.roughness = 0.55;
        }
        mat.needsUpdate = true;
      } else if (
        mat instanceof THREE.MeshBasicMaterial ||
        mat instanceof THREE.MeshPhongMaterial ||
        mat instanceof THREE.MeshLambertMaterial
      ) {
        if (mat.map) {
          mat.map.colorSpace = THREE.SRGBColorSpace;
          mat.map.needsUpdate = true;
        }
      }
    }
  });
}

function fitHeight(model: THREE.Object3D, heightM: number): void {
  model.scale.setScalar(1);
  model.updateMatrixWorld(true);
  let h = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y || 1;
  if (h > 50 || h < 0.02) {
    const unit = Math.pow(10, Math.round(Math.log10(heightM / h)));
    model.scale.setScalar(unit);
    model.updateMatrixWorld(true);
    h = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y || heightM;
  }
  const s = heightM / Math.max(h, 1e-4);
  model.scale.multiplyScalar(s);
  const box = new THREE.Box3().setFromObject(model);
  // Feet of the parrot mesh sit at local y=0 so claw lands on shoulder.
  model.position.y -= box.min.y;
}

function makeEmojiSprite(text: string): THREE.Sprite {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.font = "72px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Soft plate so emoji reads on dark/light rooms
  ctx.fillStyle = "rgba(8, 12, 20, 0.35)";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillText(text, size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(0.38, 0.38, 0.38);
  spr.position.set(0, 0.42, 0);
  spr.visible = false;
  spr.userData.canvas = canvas;
  spr.userData.ctx = ctx;
  spr.userData.tex = tex;
  return spr;
}

function setSpriteEmoji(spr: THREE.Sprite, text: string): void {
  const canvas = spr.userData.canvas as HTMLCanvasElement | undefined;
  const ctx = spr.userData.ctx as CanvasRenderingContext2D | undefined;
  const tex = spr.userData.tex as THREE.CanvasTexture | undefined;
  if (!canvas || !ctx || !tex) return;
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "rgba(8, 12, 20, 0.4)";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = text.length > 2 ? "54px serif" : "72px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2 + 4);
  tex.needsUpdate = true;
}

export class ParrotPet {
  readonly root = new THREE.Group();
  private def: ParrotPetDef;
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private attachBone: THREE.Object3D | null = null;
  private hostRoot: THREE.Object3D | null = null;
  private hostModel: THREE.Object3D | null = null;
  private emoji: THREE.Sprite | null = null;
  private emojiT = 0;
  private preenCd = 6 + Math.random() * 5;
  private oneShotEnd = 0;
  private elapsed = 0;
  private mood: PetMood = "idle";
  private bobPhase = Math.random() * Math.PI * 2;
  private disposed = false;
  private loaded = false;
  private localOffset = new THREE.Vector3(0.11, 0.06, 0.04);
  private tmpPos = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private fallbackAnchor = new THREE.Object3D();

  constructor(def: ParrotPetDef = RACALVIN_PARROT) {
    this.def = def;
    this.root.name = "ParrotPet";
    if (def.offset) {
      this.localOffset.set(def.offset.x, def.offset.y, def.offset.z);
    }
  }

  get isLoaded(): boolean {
    return this.loaded && !this.disposed;
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    const url = asset(this.def.file);
    const gltf = await loader.loadAsync(url);
    if (this.disposed) return;

    this.model = gltf.scene;
    fixMaterials(this.model);
    fitHeight(this.model, this.def.heightM ?? 0.36);
    // Face outward slightly from Racalvin's right shoulder (model +Z is bird forward).
    this.model.rotation.y = Math.PI * 0.15;
    this.root.add(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      this.actions.set(clip.name, action);
    }

    this.emoji = makeEmojiSprite(EMOJI.idle);
    this.root.add(this.emoji);

    this.playLoop(this.clip("idle") || this.clip("idle2") || this.firstClip());
    this.loaded = true;
  }

  /**
   * Seat the parrot on the host character's right shoulder.
   * Prefers a shoulder bone; falls back to a head-height anchor under host root.
   */
  attach(hostRoot: THREE.Object3D, hostModel?: THREE.Object3D | null): void {
    this.hostRoot = hostRoot;
    this.hostModel = hostModel ?? null;
    this.attachBone = this.findShoulderBone(hostModel ?? hostRoot);

    // Prefer parenting under bone so shoulder motion carries the bird.
    if (this.attachBone) {
      this.attachBone.add(this.root);
      this.root.position.copy(this.localOffset);
      this.root.rotation.set(0, 0, 0);
    } else {
      // Fallback anchor at ~shoulder height on host root.
      this.fallbackAnchor.name = "ParrotShoulderFallback";
      this.fallbackAnchor.position.set(0.22, 1.42, 0.06);
      hostRoot.add(this.fallbackAnchor);
      this.fallbackAnchor.add(this.root);
      this.root.position.copy(this.localOffset);
      this.attachBone = this.fallbackAnchor;
    }
  }

  private findShoulderBone(root: THREE.Object3D): THREE.Object3D | null {
    const prefs = this.def.shoulderBones ?? RACALVIN_PARROT.shoulderBones!;
    let found: THREE.Object3D | null = null;
    // Prefer right-side matches first.
    for (const key of prefs) {
      const re = new RegExp(key, "i");
      root.traverse((o) => {
        if (found || !o.name) return;
        if (re.test(o.name) && !/left|_l\b|l_/i.test(o.name)) found = o;
      });
      if (found) return found;
    }
    // Any shoulder-like bone
    root.traverse((o) => {
      if (found || !o.name) return;
      if (/shoulder|clavicle/i.test(o.name) && !/left|_l\b/i.test(o.name)) found = o;
    });
    return found;
  }

  private clip(role: keyof NonNullable<ParrotPetDef["clips"]>): string | null {
    const name = this.def.clips?.[role];
    if (name && this.actions.has(name)) return name;
    // Fuzzy
    const re =
      role === "idle"
        ? /idle(?!2)/i
        : role === "idle2"
          ? /idle2/i
          : role === "attack"
            ? /attack/i
            : role === "hover"
              ? /hover/i
              : role === "fly"
                ? /fly(?!circle)/i
                : role === "rise"
                  ? /rise/i
                  : role === "preen"
                    ? /preen/i
                    : role === "land"
                      ? /land/i
                      : role === "die"
                        ? /die(?!\d)/i
                        : null;
    if (!re) return null;
    for (const n of this.actions.keys()) {
      if (re.test(n)) return n;
    }
    return null;
  }

  private firstClip(): string | null {
    return this.actions.keys().next().value ?? null;
  }

  private playLoop(name: string | null): void {
    if (!name || !this.mixer) return;
    const next = this.actions.get(name);
    if (!next) return;
    if (this.current === next) return;
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (this.current) this.current.crossFadeTo(next, 0.2, false);
    else next.play();
    next.play();
    this.current = next;
  }

  private playOneShot(name: string | null, mood: PetMood, emojiMs = 1.1): void {
    if (!name || !this.mixer) return;
    const act = this.actions.get(name);
    if (!act) return;
    act.reset();
    act.setLoop(THREE.LoopOnce, 1);
    act.clampWhenFinished = true;
    act.enabled = true;
    act.setEffectiveWeight(1);
    if (this.current && this.current !== act) this.current.crossFadeTo(act, 0.12, false);
    act.play();
    this.current = act;
    const dur = act.getClip().duration || 0.8;
    this.oneShotEnd = this.elapsed + dur * 0.92;
    this.mood = mood;
    this.showEmoji(EMOJI[mood], emojiMs);
  }

  private showEmoji(text: string, life = 1.0): void {
    if (!this.emoji) return;
    setSpriteEmoji(this.emoji, text);
    this.emoji.visible = true;
    this.emojiT = life;
    // Pop scale
    this.emoji.scale.set(0.42, 0.42, 0.42);
  }

  /** LMB / melee — parrot lunges with attack anim. */
  onAttack(): void {
    if (!this.loaded) return;
    this.playOneShot(this.clip("attack"), "attack", 1.15);
  }

  /** Signature / skill — flashy hover or rise. */
  onSkill(slot?: number): void {
    if (!this.loaded) return;
    const fancy =
      slot === 1 || slot === 2
        ? this.clip("hover") || this.clip("fly")
        : this.clip("rise") || this.clip("hover") || this.clip("fly");
    this.playOneShot(fancy, slot != null && slot >= 2 ? "skill" : "hover", 1.35);
  }

  /** Soft celebrate (loot, kill assist, etc.). */
  cheer(emoji = "🦜👑"): void {
    if (!this.loaded) return;
    this.showEmoji(emoji, 1.4);
    this.playOneShot(this.clip("preen") || this.clip("idle2"), "preen", 1.2);
  }

  update(dt: number): void {
    if (!this.loaded || this.disposed) return;
    this.elapsed += dt;
    this.mixer?.update(dt);

    // Soft bob on shoulder so the bird feels alive even on a stiff attach bone.
    this.bobPhase += dt * 2.4;
    if (this.model && this.oneShotEnd <= this.elapsed) {
      const bob = Math.sin(this.bobPhase) * 0.008;
      this.model.position.y = bob;
    }

    // Return to idle after one-shots.
    if (this.oneShotEnd > 0 && this.elapsed >= this.oneShotEnd) {
      this.oneShotEnd = 0;
      this.mood = "idle";
      this.playLoop(this.clip("idle") || this.clip("idle2") || this.firstClip());
    }

    // Occasional preen while idle.
    if (this.mood === "idle" && this.oneShotEnd <= 0) {
      this.preenCd -= dt;
      if (this.preenCd <= 0) {
        this.preenCd = 8 + Math.random() * 10;
        if (Math.random() < 0.55) {
          this.playOneShot(this.clip("preen") || this.clip("idle2"), "preen", 0.9);
        }
      }
    }

    if (this.emoji && this.emojiT > 0) {
      this.emojiT -= dt;
      const k = Math.max(0, this.emojiT);
      const pop = 0.38 + Math.sin(Math.min(1, 1 - k) * Math.PI) * 0.08;
      this.emoji.scale.setScalar(pop);
      this.emoji.position.y = 0.42 + (1 - Math.min(1, k)) * 0.12;
      if (this.emojiT <= 0) this.emoji.visible = false;
    }
  }

  /** World position of the parrot (for VFX). */
  getWorldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return this.root.getWorldPosition(out);
  }

  dispose(): void {
    this.disposed = true;
    this.loaded = false;
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.actions.clear();
    this.current = null;
    if (this.root.parent) this.root.parent.remove(this.root);
    if (this.fallbackAnchor.parent) this.fallbackAnchor.parent.remove(this.fallbackAnchor);
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m?.dispose?.();
      }
      const spr = o as THREE.Sprite;
      if (spr.isSprite) {
        spr.material.map?.dispose();
        spr.material.dispose();
      }
    });
    this.root.clear();
    this.model = null;
    this.emoji = null;
    this.attachBone = null;
    this.hostRoot = null;
  }
}
