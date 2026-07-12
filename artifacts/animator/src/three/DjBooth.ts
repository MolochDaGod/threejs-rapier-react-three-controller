import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { asset } from "./assets";
import { CHARACTER_HEIGHT_M } from "./types";
import { loadSkeletonSource } from "./explorer/loader";
import {
  findSkinnedMesh,
  makeRetargetSource,
  skeletonBoneNames,
  retargetLibraryClip,
} from "./retargetLibrary";
import { buildRetargetNameMap } from "./retargetMap";
import type { MusicPulse } from "./audio/CombatSfx";

/** Beats per musical phrase (a chord's worth) — the cadence on which the DJ
 *  re-decides idle vs dance, so switches land on phrase boundaries. */
const DANCE_PHRASE_BEATS = 8;

/**
 * How large the booth *area* reads versus the original scenery prop — the booth
 * model, the light-show backdrop and all the spacing between them ride this
 * group scale. Racalvin himself is counter-scaled (see {@link DjBooth.load}) so
 * he keeps his size while only the surrounding station grows. Previously 2; now
 * 4 so the booth area is 2x larger without enlarging the DJ.
 */
const BOOTH_AREA_SCALE = 4;

/**
 * The resident DJ in the alcove above the Danger Room door: Racalvin the Pirate
 * King stands behind a booth, idling to his own native clip and bursting into a
 * retargeted hip-hop dance (fist pumps included) every now and then.
 *
 * Self-contained scenery actor — it owns its models, mixer and dance timer, and
 * is fully disposable. The hip-hop FBX is authored on the shared `mixamorig*`
 * skeleton, so it is driven onto Racalvin's own rig through the unified runtime
 * retarget pipeline ({@link retargetLibraryClip}), the same path the Danger Room
 * fighter uses to play the FBX library on a real GLB rig.
 */
export class DjBooth {
  readonly group = new THREE.Group();

  private mixer: THREE.AnimationMixer | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private danceAction: THREE.AnimationAction | null = null;
  private current: THREE.AnimationAction | null = null;

  /** Loaded model roots, tracked for disposal. */
  private roots: THREE.Object3D[] = [];

  /** Whether the DJ is currently in his dance burst (vs idling). */
  private dancing = false;
  /** Last musical phrase index acted on, so we re-decide once per phrase. */
  private lastPhrase = -1;

  /** Cancels late async work if disposed mid-load. */
  private disposed = false;

  /** Booth-prop materials given animated emissive glow (colour-cycling + pulse). */
  private boothMats: THREE.MeshStandardMaterial[] = [];
  /** Accumulated glow time (seconds) feeding the booth emissive animation. */
  private boothGlowT = 0;
  /** Scratch colour reused for the booth glow so update() allocates nothing. */
  private readonly scratchColor = new THREE.Color();

  constructor(
    private readonly anchor: THREE.Vector3,
    /** Facing yaw (radians); Racalvin's def uses modelYaw = PI to face -Z. */
    private readonly facing = Math.PI,
  ) {
    this.group.position.copy(anchor);
    // The booth scene (booth prop, backdrop, spacing) rides this scale. The DJ is
    // counter-scaled in load() so ONLY the surrounding station grows, not Racalvin.
    this.group.scale.setScalar(BOOTH_AREA_SCALE);
  }

  /** Load the booth + DJ and wire up animation. Safe to await; no-op if disposed. */
  async load(): Promise<void> {
    const gltfLoader = new GLTFLoader();
    const fbxLoader = new FBXLoader();

    const [djGltf, boothGltf, danceFbx, skelSource] = await Promise.all([
      gltfLoader.loadAsync(asset("models/racalvin.glb")),
      gltfLoader.loadAsync(asset("models/dj-booth.glb")),
      fbxLoader.loadAsync(asset("anim/animations/extra/hip-hop-dancing.fbx")),
      loadSkeletonSource(),
    ]);
    if (this.disposed) {
      this.disposeObject(djGltf.scene);
      this.disposeObject(boothGltf.scene);
      this.disposeObject(danceFbx);
      this.disposeObject(skelSource);
      return;
    }

    // --- Booth: toward the room (-Z), turned 180° so its working/turntable side
    //     faces the DJ standing behind it. (Local units; the group is 2x scaled.)
    const booth = boothGltf.scene;
    this.normalize(booth, 1.25);
    booth.position.set(0, 0, -0.48);
    booth.rotation.y = this.facing + Math.PI;
    booth.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      // Collect the booth's standard materials so update() can give them an
      // animated emissive "gloom" (colour-cycling + beat pulse + motion).
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const s = mat as THREE.MeshStandardMaterial;
        if (s && s.isMeshStandardMaterial) {
          s.emissive = new THREE.Color(0x000000);
          s.emissiveIntensity = 1;
          this.boothMats.push(s);
        }
      }
    });
    this.group.add(booth);
    this.roots.push(booth);

    // --- DJ (Racalvin) standing at the BACK of the booth, facing the room (-Z). ---
    // Counter-scale his fit height by BOOTH_AREA_SCALE so his RENDERED size stays
    // exactly what it was before the booth area grew (originally CHARACTER_HEIGHT_M
    // at a booth scale of 2). Only the station around him gets bigger, not Racalvin.
    const dj = djGltf.scene;
    this.normalize(dj, (CHARACTER_HEIGHT_M * 2) / BOOTH_AREA_SCALE);
    dj.position.set(0, 0, 0.27);
    dj.rotation.y = this.facing;
    this.group.add(dj);
    this.roots.push(dj);

    const target = findSkinnedMesh(dj);
    this.mixer = new THREE.AnimationMixer(dj);

    // Native idle clip from Racalvin's own GLB (binds by node name as-is).
    const idleClip =
      djGltf.animations.find((c) => /idle/i.test(c.name)) ?? djGltf.animations[0] ?? null;
    if (idleClip) {
      this.idleAction = this.mixer.clipAction(idleClip);
      this.idleAction.play();
      this.current = this.idleAction;
    }

    // Hip-hop dance: retarget the mixamorig FBX onto Racalvin's rig.
    const rawDance = danceFbx.animations[0] ?? null;
    if (target && rawDance) {
      const source = makeRetargetSource(skelSource);
      if (source) {
        const map = buildRetargetNameMap(skeletonBoneNames(target.skeleton));
        if (Object.keys(map.names).length > 0) {
          try {
            const danceClip = retargetLibraryClip(target, source, rawDance, map, "dj-dance");
            target.skeleton.pose(); // restore bind pose after baking
            this.danceAction = this.mixer.clipAction(danceClip);
            this.danceAction.setLoop(THREE.LoopRepeat, Infinity);
          } catch (err) {
            console.warn("[DjBooth] dance retarget failed", err);
          }
        }
      }
    }

    // The skeleton-source scene was only needed for retargeting.
    this.disposeObject(skelSource);
  }

  /**
   * Advance the mixer and drive the idle⇄dance switching off the live music
   * bed (`music`) rather than a private timer. The dance speeds up with the
   * music's energy, and once per musical phrase the DJ re-rolls whether to
   * dance with a probability that climbs with intensity — so he bursts into the
   * groove when the room heats up and mostly idles when it's calm. When no music
   * pulse is available yet (audio still gated behind a gesture) he simply idles.
   */
  update(dt: number, music: MusicPulse | null = null): void {
    // Give the booth prop its animated glow first so it lives even before the
    // mixer/music are ready (audio is gated behind a user gesture).
    this.driveBoothGlow(dt, music);
    if (!this.mixer) return;
    this.mixer.update(dt);

    if (!this.danceAction) return; // retarget unavailable → idle only
    if (!music) return; // no live music yet → DJ waits, idling

    // Ride the beat: the dance tempo tracks the music's energy so the fist
    // pumps quicken with the set instead of running at a fixed speed.
    this.danceAction.timeScale = 0.9 + music.intensity * 0.6;

    // Re-decide once per phrase boundary so switches land musically.
    const phrase = Math.floor(music.beat / DANCE_PHRASE_BEATS);
    if (phrase === this.lastPhrase) return;
    this.lastPhrase = phrase;

    // Chance of dancing rises with intensity (small floor so he still grooves
    // to a calm set, near-certain at peak combat).
    const danceChance = 0.25 + music.intensity * 0.7;
    const wantDance = Math.random() < danceChance;
    if (wantDance && !this.dancing) {
      this.fadeTo(this.danceAction);
      this.dancing = true;
    } else if (!wantDance && this.dancing && this.idleAction) {
      this.fadeTo(this.idleAction);
      this.dancing = false;
    }
  }

  /** Crossfade the active action to `to` over a short blend. */
  private fadeTo(to: THREE.AnimationAction): void {
    if (this.current === to) return;
    to.reset().setEffectiveWeight(1).play();
    if (this.current) this.current.crossFadeTo(to, 0.4, false);
    this.current = to;
  }

  /**
   * Give the booth prop its "gloom": drift the emissive hue over time and pulse
   * its intensity with the beat so the whole booth glows and shifts colour with
   * the set — colour-change + motion in one. Runs even before audio unlocks
   * (falls back to a gentle idle pulse when no music pulse is available yet).
   */
  private driveBoothGlow(dt: number, music: MusicPulse | null): void {
    if (this.boothMats.length === 0) return;
    this.boothGlowT += dt;
    const hue = (this.boothGlowT * 0.05) % 1;
    this.scratchColor.setHSL(hue, 0.85, 0.55);
    const energy = music ? music.intensity : 0.2;
    const beat = 0.5 + 0.5 * Math.sin(this.boothGlowT * 6.0);
    const intensity = 0.35 + energy * 1.1 + beat * 0.2;
    for (const m of this.boothMats) {
      m.emissive.copy(this.scratchColor);
      m.emissiveIntensity = intensity;
    }
  }

  /**
   * Fit `obj` to `targetHeight` metres, recentre on X/Z and drop its base to
   * y=0 (so positioning is by feet/base) — mirrors the Character GLB normalise.
   */
  private normalize(obj: THREE.Object3D, targetHeight: number): void {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 1e-4) obj.scale.setScalar(targetHeight / size.y);
    const box2 = new THREE.Box3().setFromObject(obj);
    const center = box2.getCenter(new THREE.Vector3());
    obj.position.x -= center.x;
    obj.position.z -= center.z;
    obj.position.y -= box2.min.y;
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = (m as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.mixer?.stopAllAction();
    this.mixer = null;
    for (const r of this.roots) this.disposeObject(r);
    this.roots = [];
    this.boothMats = [];
    this.group.clear();
  }
}
