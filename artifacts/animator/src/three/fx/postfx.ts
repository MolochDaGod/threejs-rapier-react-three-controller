import * as THREE from "three";
import {
  BloomEffect,
  BlendFunction,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  KernelSize,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";

/**
 * Production post-processing stack (pmndrs `postprocessing`) for Danger Room /
 * Open combat / cinematic shells:
 *
 *   HDR mipmap Bloom (spell/weapon glow) → Hue/Saturation grade →
 *   Chromatic aberration → Vignette → film Noise → ACES tone-map.
 *
 * Why pmndrs over three's `examples/jsm` passes: effects merge into one
 * fullscreen pass, bloom uses mipmap blur, HDR HalfFloat buffer. pmndrs owns
 * tone mapping — renderer is forced to `NoToneMapping` to avoid double ACES.
 *
 * Presets:
 *  - `combat`  — readable gameplay (default production)
 *  - `spell`   — temporary bloom kick on cast / impact
 *  - `cinematic` — heavier mystical grade (lobby / trailers)
 */
export interface MysticalFxOptions {
  /** Bloom strength (ethereal glow). */
  bloomIntensity?: number;
  /** Luminance above which pixels bloom (lower = more glow). */
  bloomThreshold?: number;
  /** Mipmap-bloom spread radius, 0..1. */
  bloomRadius?: number;
  /** Additive saturation lift, -1..1. */
  saturation?: number;
  /** Hue rotation in radians (nudge toward the purple/green grade). */
  hue?: number;
  /** Vignette darkness, 0..1. */
  vignetteDarkness?: number;
  /** Chromatic-aberration offset (per axis). */
  chromatic?: number;
  /** Film-grain opacity, 0..1. */
  grain?: number;
}

export type PostFxPreset = "combat" | "spell" | "cinematic";

export const POSTFX_PRESETS: Record<PostFxPreset, MysticalFxOptions> = {
  combat: {
    bloomIntensity: 0.55,
    bloomThreshold: 0.52,
    bloomRadius: 0.58,
    saturation: 0.06,
    vignetteDarkness: 0.26,
    chromatic: 0.00018,
    grain: 0.02,
  },
  spell: {
    bloomIntensity: 1.15,
    bloomThreshold: 0.28,
    bloomRadius: 0.72,
    saturation: 0.12,
    vignetteDarkness: 0.3,
    chromatic: 0.00045,
    grain: 0.025,
  },
  cinematic: {
    bloomIntensity: 1.1,
    bloomThreshold: 0.18,
    bloomRadius: 0.72,
    saturation: 0.16,
    vignetteDarkness: 0.62,
    chromatic: 0.0009,
    grain: 0.06,
  },
};

export interface MysticalComposer {
  composer: EffectComposer;
  /** Render one frame (optional `dt` drives time-based effects like noise). */
  render: (dt?: number) => void;
  setSize: (w: number, h: number) => void;
  dispose: () => void;
  /** Live-tune bloom for spell casts (lerps back if you call setPreset). */
  setBloomIntensity: (v: number) => void;
  /** Apply a named production preset. */
  setPreset: (preset: PostFxPreset) => void;
  /** Pulse bloom toward spell intensity for `durationSec`, then restore combat. */
  pulseSpell: (durationSec?: number) => void;
}

/** Build the mystical composer for `scene`/`camera` on `renderer`. */
export function createMysticalComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts: MysticalFxOptions = {},
): MysticalComposer {
  // pmndrs applies tone mapping in-composer; disable the renderer's own so the
  // frame isn't tone-mapped twice.
  renderer.toneMapping = THREE.NoToneMapping;

  const base = { ...POSTFX_PRESETS.combat, ...opts };

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({
    intensity: base.bloomIntensity ?? 0.55,
    luminanceThreshold: base.bloomThreshold ?? 0.52,
    luminanceSmoothing: 0.5,
    mipmapBlur: true,
    radius: base.bloomRadius ?? 0.58,
    kernelSize: KernelSize.LARGE,
  });
  const grade = new HueSaturationEffect({
    hue: base.hue ?? 0,
    saturation: base.saturation ?? 0.06,
  });
  const chroma = new ChromaticAberrationEffect({
    offset: new THREE.Vector2(base.chromatic ?? 0.00018, base.chromatic ?? 0.00018),
    radialModulation: true,
    modulationOffset: 0.4,
  });
  const vignette = new VignetteEffect({
    offset: 0.28,
    darkness: base.vignetteDarkness ?? 0.26,
  });
  const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY });
  noise.blendMode.opacity.value = base.grain ?? 0.02;
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });

  // One merged fullscreen pass for the whole stack.
  composer.addPass(new EffectPass(camera, bloom, grade, chroma, vignette, noise, tone));

  let restoreBloom = base.bloomIntensity ?? 0.55;
  let pulseT = 0;
  let pulseFrom = restoreBloom;
  let pulseTo = restoreBloom;
  let pulseDur = 0;

  const applyOpts = (o: MysticalFxOptions) => {
    // Live-safe knobs only (pmndrs private internals vary by version).
    if (o.bloomIntensity != null) {
      bloom.intensity = o.bloomIntensity;
      restoreBloom = o.bloomIntensity;
    }
    if (o.saturation != null) grade.saturation = o.saturation;
    if (o.hue != null) grade.hue = o.hue;
    if (o.vignetteDarkness != null) vignette.darkness = o.vignetteDarkness;
    if (o.chromatic != null) chroma.offset.set(o.chromatic, o.chromatic);
    if (o.grain != null) noise.blendMode.opacity.value = o.grain;
  };

  return {
    composer,
    render: (dt?: number) => {
      if (dt != null && pulseDur > 0) {
        pulseT += dt;
        const u = Math.min(1, pulseT / pulseDur);
        // ease out: kick then settle
        const k = u < 0.25 ? u / 0.25 : 1 - (u - 0.25) / 0.75;
        bloom.intensity = pulseFrom + (pulseTo - pulseFrom) * Math.max(0, k);
        if (u >= 1) {
          pulseDur = 0;
          bloom.intensity = restoreBloom;
        }
      }
      composer.render(dt);
    },
    setSize: (w: number, h: number) => composer.setSize(w, h),
    dispose: () => composer.dispose(),
    setBloomIntensity: (v: number) => {
      bloom.intensity = v;
      restoreBloom = v;
    },
    setPreset: (preset: PostFxPreset) => {
      applyOpts(POSTFX_PRESETS[preset]);
      pulseDur = 0;
    },
    pulseSpell: (durationSec = 0.55) => {
      pulseFrom = bloom.intensity;
      pulseTo = POSTFX_PRESETS.spell.bloomIntensity ?? 1.15;
      pulseT = 0;
      pulseDur = Math.max(0.15, durationSec);
    },
  };
}
