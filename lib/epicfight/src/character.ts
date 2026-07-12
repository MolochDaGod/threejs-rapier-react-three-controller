import * as THREE from "three";
import type { EpicFightModel } from "./model.js";

export interface PlayOptions {
  /** Loop the clip (default true). One-shots should pass false. */
  loop?: boolean;
  /** Crossfade duration in seconds from the current clip (default 0.2). */
  fade?: number;
  /** Playback rate multiplier (default 1). */
  timeScale?: number;
}

/**
 * Runtime wrapper around an {@link EpicFightModel}: a single `AnimationMixer`
 * plus a name→clip registry and a `play()`/`update()` surface. Higher-level
 * combat logic (Phase B) drives this; it stays free of game-specific concerns.
 */
export class EpicFightCharacter {
  /** Container group to add to a scene (apply world transform here). */
  readonly object: THREE.Group;
  readonly model: EpicFightModel;
  readonly mixer: THREE.AnimationMixer;

  private readonly clips = new Map<string, THREE.AnimationClip>();
  private currentName: string | null = null;
  private currentAction: THREE.AnimationAction | null = null;

  constructor(model: EpicFightModel) {
    this.model = model;
    this.object = model.root;
    this.mixer = new THREE.AnimationMixer(model.skinnedMesh);
  }

  /** Register a clip under a logical name (e.g. "idle", "axe_auto1"). */
  addClip(name: string, clip: THREE.AnimationClip): void {
    clip.name = name;
    this.clips.set(name, clip);
  }

  hasClip(name: string): boolean {
    return this.clips.has(name);
  }

  getClip(name: string): THREE.AnimationClip | undefined {
    return this.clips.get(name);
  }

  /** The name of the clip currently driving the mixer, or null. */
  get playing(): string | null {
    return this.currentName;
  }

  /** Crossfade to (or restart) a registered clip. */
  play(name: string, options: PlayOptions = {}): THREE.AnimationAction {
    const clip = this.clips.get(name);
    if (!clip) throw new Error(`Epic Fight clip '${name}' is not registered`);

    const { loop = true, fade = 0.2, timeScale = 1 } = options;
    const action = this.mixer.clipAction(clip);
    action.enabled = true;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.timeScale = timeScale;

    if (this.currentAction && this.currentAction !== action) {
      action.reset();
      action.play();
      if (fade > 0) this.currentAction.crossFadeTo(action, fade, false);
      else {
        this.currentAction.stop();
        action.setEffectiveWeight(1);
      }
    } else if (this.currentAction === action) {
      if (!loop) action.reset();
      action.play();
    } else {
      action.reset();
      if (fade > 0) action.fadeIn(fade);
      else action.setEffectiveWeight(1);
      action.play();
    }

    this.currentAction = action;
    this.currentName = name;
    return action;
  }

  /** Advance the mixer by `dt` seconds. */
  update(dt: number): void {
    this.mixer.update(dt);
  }

  /** Release GPU + mixer resources. */
  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model.skinnedMesh);
    this.model.skinnedMesh.geometry.dispose();
    const mat = this.model.skinnedMesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat.dispose();
  }
}
