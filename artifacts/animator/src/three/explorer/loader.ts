import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Animator } from "./Animator";
import { VoxelCharacter } from "./rig";
import {
  SKELETON_SOURCE_ID,
  GLB_CLIP_IDS,
  allReferencedClipIds,
  clipIdsForClass,
  reactionClipIds,
} from "./clipCatalog";
import type { CharacterLook, WeaponClass } from "./types";

/**
 * Local asset resolution for the ported animator. The shared library reads its
 * FBX through `@workspace/assets`, which is forbidden in this artifact, so the
 * curated clips are hosted under `public/anim/` instead and resolved relative to
 * the artifact's base path. Clip ids are catalog ids (`animations/<class>/<clip>`).
 */
import { assetUrl } from "../assetHost";

function urlForId(id: string): string {
  return assetUrl(`anim/${id}.fbx`);
}

const fbxLoader = new FBXLoader();
const gltfLoader = new GLTFLoader();

/** Load one FBX by catalog id; resolves to the loaded group (carries `.animations`). */
async function loadFbx(id: string): Promise<THREE.Group> {
  return await fbxLoader.loadAsync(urlForId(id));
}

/**
 * Retarget a Mixamo GLB clip onto the procedural 25-bone rig. The bundled combo
 * GLBs come from arbitrary Mixamo characters whose bone PROPORTIONS differ from
 * our skeleton source, so their per-bone position tracks would dislocate limbs.
 * We therefore keep ROTATION tracks only — joint rotations transfer cleanly
 * across a shared-topology skeleton and the engine drives any root displacement —
 * and normalise the track target names to our `mixamorig*` convention, e.g.
 * `mixamorig:Head_00.quaternion` -> `mixamorigHead.quaternion`. This handles both
 * colon-kept and GLTF-sanitised (colon-stripped) names and drops the trailing
 * `_<n>` suffix Mixamo/Sketchfab exports append per bone.
 */
export function retargetMixamoClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const SUFFIX = ".quaternion";
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    if (!track.name.endsWith(SUFFIX)) continue; // rotation-only retarget
    const node = track.name.slice(0, -SUFFIX.length);
    const bone = node.replace("mixamorig:", "mixamorig").replace(/_\d+$/, "");
    // Clone before renaming: callers (e.g. the editor's auto-wire) pass clips
    // whose track objects are still bound to the imported model's own mixer, so
    // mutating `track.name` in place would corrupt that other playback path.
    const renamed = track.clone();
    renamed.name = `${bone}${SUFFIX}`;
    tracks.push(renamed);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/**
 * Canonical box-rig bone suffixes. The rig builds `mixamorig<Suffix>` bones from
 * the skeleton source (see {@link VoxelCharacter}); a clip track only animates
 * the rig when its name matches one of these. Used to filter + rename the tracks
 * of clips authored on a foreign skeleton.
 */
const RIG_BONE_SUFFIXES = new Set([
  "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
  "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
]);

/**
 * Map a foreign skeleton's bone name onto the box rig's `mixamorig*` bone, or
 * null when it has no rig equivalent (and should be dropped). Handles the two
 * "Retargeted Clip" spine/head naming variants shipped across the melee packs —
 * `Spine11/Spine21/Head1/Neck` and `Spine01/Spine02/Head/neck` — and passes
 * already-`mixamorig`-prefixed names straight through. Container/leaf bones with
 * no rig segment (Armature, headfront, HeadTop_End, *_End) fall through to null.
 */
function canonicalRigBone(raw: string): string | null {
  let n = raw.replace(/^mixamorig:?/, "");
  if (/^Spine0*1$|^Spine11$/.test(n)) n = "Spine1";
  else if (/^Spine0*2$|^Spine21$/.test(n)) n = "Spine2";
  else if (/^Spine$/.test(n)) n = "Spine";
  else if (/^Neck\d*$/i.test(n)) n = "Neck";
  else if (/^Head\d*$/.test(n)) n = "Head";
  else if (/^Hips\d*$/.test(n)) n = "Hips";
  else n = n.replace(/\d+$/, "");
  return RIG_BONE_SUFFIXES.has(n) ? `mixamorig${n}` : null;
}

/**
 * Normalise an FBX clip authored on a non-`mixamorig` skeleton onto the box rig.
 * Several packs (the whole great-sword family + similar "Retargeted Clip"
 * exports) target bones named `Hips/Spine01/Head/...` with NO `mixamorig`
 * prefix, so THREE's name-keyed mixer binds them to nothing and they silently
 * never animate — which is why the two-handed melee classes
 * (greatsword/greataxe/spear/hammer2h, all sharing the great-sword locomotion)
 * had dead idles + locomotion. We rename every bone to the rig's `mixamorig*`
 * convention via {@link canonicalRigBone} and keep ALL rotations plus ONLY the
 * root (Hips) position track — that preserves the vertical bob (which
 * {@link lockHorizontalRoot} re-baselines to the rig's hip height and de-drifts)
 * while dropping limb position tracks that would dislocate the rig given the
 * source skeleton's different bone proportions.
 */
export function normalizeRetargetedFbxClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf(".");
    if (dot < 0) continue;
    const prop = track.name.slice(dot + 1);
    const bone = canonicalRigBone(track.name.slice(0, dot));
    if (!bone) continue;
    if (prop === "quaternion" || (prop === "position" && bone === "mixamorigHips")) {
      const renamed = track.clone();
      renamed.name = `${bone}.${prop}`;
      tracks.push(renamed);
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/**
 * Catalog ids whose first second should be trimmed on load. The first melee
 * combo GLB opens with a ~1s wind-up/idle that made the combo feel sluggish;
 * USER-DIRECTED, we drop the opening second so the swing starts immediately.
 * (Mixamo combos are authored at 30 fps, so 1s == frame 30.)
 */
const CLIP_TRIM_SECONDS: Record<string, number> = {
  "animations/combo/melee-combo-1": 1,
};
const TRIM_FPS = 30;

/**
 * GLB combo SUB-CLIPS: a single retargeted GLB whose one long combo animation is
 * sliced into several short, separately-playable clips by FRACTION of its
 * (post-wind-up-trim) duration. This turns the 3-hit `melee-combo-1` into three
 * click-advanced combo hits for the sword & dagger sets (USER-DIRECTED): each
 * LMB click plays the next third. The ranges are an even split as a sensible,
 * easily-tunable default — nudge them to line up with the authored swing impacts.
 * Sub-clip ids have NO backing file; they resolve through their parent here.
 */
interface SubclipSpec {
  parent: string;
  /** Start fraction (0..1) of the parent's post-trim duration. */
  from: number;
  /** End fraction (0..1) of the parent's post-trim duration. */
  to: number;
}
const GLB_SUBCLIPS: Record<string, SubclipSpec> = {
  "animations/combo/melee-combo-1-hit1": { parent: "animations/combo/melee-combo-1", from: 0, to: 1 / 3 },
  "animations/combo/melee-combo-1-hit2": { parent: "animations/combo/melee-combo-1", from: 1 / 3, to: 2 / 3 },
  "animations/combo/melee-combo-1-hit3": { parent: "animations/combo/melee-combo-1", from: 2 / 3, to: 1 },
};

/**
 * Cache of the retargeted + wind-up-trimmed PARENT clip, keyed by catalog id.
 * Stored as the in-flight promise so concurrent `loadClips` callers (the full
 * combo clip and its three sub-clips all load at once) share ONE GLB fetch.
 */
const glbParentCache = new Map<string, Promise<THREE.AnimationClip | null>>();

/** Load + retarget + wind-up-trim a parent GLB clip (cached by id). */
function loadParentGlbClip(id: string): Promise<THREE.AnimationClip | null> {
  let cached = glbParentCache.get(id);
  if (!cached) {
    cached = (async () => {
      const gltf = await gltfLoader.loadAsync(assetUrl(`anim/${id}.glb`));
      const clip = gltf.animations[0];
      if (!clip) return null;
      const retargeted = retargetMixamoClip(clip);
      const trim = CLIP_TRIM_SECONDS[id];
      if (trim && retargeted.duration > trim) {
        const start = Math.round(trim * TRIM_FPS);
        const end = Math.ceil(retargeted.duration * TRIM_FPS) + 1;
        return THREE.AnimationUtils.subclip(retargeted, retargeted.name, start, end, TRIM_FPS);
      }
      return retargeted;
    })();
    // Evict on failure so a transient fetch/parse error doesn't poison the cache
    // (the next spawn can retry); resolved nulls/clips stay cached intentionally.
    cached.catch(() => glbParentCache.delete(id));
    glbParentCache.set(id, cached);
  }
  return cached;
}

/**
 * Load + retarget one Mixamo GLB clip by catalog id; null when it ships no clip.
 * Sub-clip ids ({@link GLB_SUBCLIPS}) are sliced from their cached parent clip;
 * `AnimationUtils.subclip` clones before trimming, so reusing the parent is safe.
 */
async function loadGlbClip(id: string): Promise<THREE.AnimationClip | null> {
  const sub = GLB_SUBCLIPS[id];
  if (sub) {
    const parent = await loadParentGlbClip(sub.parent);
    if (!parent) return null;
    const totalFrames = Math.max(1, Math.round(parent.duration * TRIM_FPS));
    const start = Math.round(sub.from * totalFrames);
    const end = Math.max(start + 1, Math.round(sub.to * totalFrames));
    return THREE.AnimationUtils.subclip(parent, `${parent.name}#${id}`, start, end, TRIM_FPS);
  }
  return loadParentGlbClip(id);
}

/**
 * Catalog ids hosted as `.glb` instead of `.fbx` but bound to the rig with the
 * SAME native treatment as an FBX clip (all tracks kept, including the hip
 * position bob) — NOT the rotation-only retarget of {@link GLB_CLIP_IDS}.
 *
 * These were re-exported from their original Mixamo `.fbx` (via the headless
 * FBXLoader→GLTFExporter pipeline) purely to cap skin weights to 4: the source
 * `swimming.fbx` carried >4 weights per vertex, which made `FBXLoader` log
 * `Vertex has more than 4 skinning weights assigned to vertex`. The GLB export
 * is authored on our own skeleton-source rig, so its `mixamorig*` tracks bind
 * natively and the swim motion is byte-for-byte equivalent.
 */
const NATIVE_GLB_CLIP_IDS: ReadonlySet<string> = new Set([
  "animations/swim/swimming",
  // Idle-break gesture pack: the source FBX are authored on an IDENTITY-REST
  // skeleton (rest rotations all zero; limb direction lives in the bone
  // translations), so the rename-only `normalizeRetargetedFbxClip` bound their
  // rotations wildly wrong — legs folded up to the head and the hips pitched
  // the body through the floor on every idle-break fidget. These .glb are baked
  // by `scripts/src/retarget-gestures.mjs` (rest-pose-aware SkeletonUtils
  // retarget onto the rig skeleton), ship native `mixamorig*` rotation tracks,
  // and bind as-is.
  "animations/gestures/acknowledging",
  "animations/gestures/being-cocky",
  "animations/gestures/dismissing-gesture",
  "animations/gestures/happy-hand-gesture",
  "animations/gestures/look-away-gesture",
  "animations/gestures/relieved-sigh",
  "animations/gestures/thoughtful-head-shake",
  "animations/gestures/weight-shift",
]);

/** Load one native-treatment GLB clip by catalog id; null when it ships none. */
async function loadNativeGlbClip(id: string): Promise<THREE.AnimationClip | null> {
  const gltf = await gltfLoader.loadAsync(assetUrl(`anim/${id}.glb`));
  return gltf.animations[0] ?? null;
}

/**
 * Load a set of motion clips by asset id into a name->clip map. Missing/empty
 * FBX are skipped silently (the Animator falls back along its clip chains).
 */
export async function loadClips(ids: string[]): Promise<Map<string, THREE.AnimationClip>> {
  const map = new Map<string, THREE.AnimationClip>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        if (GLB_CLIP_IDS.has(id)) {
          const clip = await loadGlbClip(id);
          if (clip) map.set(id, clip);
          return;
        }
        const clip0 = NATIVE_GLB_CLIP_IDS.has(id)
          ? await loadNativeGlbClip(id)
          : null;
        if (clip0) {
          map.set(id, clip0);
          return;
        }
        const group = await loadFbx(id);
        const clip = group.animations[0];
        if (clip) {
          // Native Mixamo clips bind to the box rig as-is; clips authored on a
          // foreign skeleton (no `mixamorig` track) are normalised onto the rig,
          // otherwise they'd silently fail to bind and never animate.
          const native = clip.tracks.some((t) => t.name.startsWith("mixamorig"));
          map.set(id, native ? clip : normalizeRetargetedFbxClip(clip));
        }
      } catch {
        // Unknown id or load failure: leave it out; chains cover the gap.
      }
    }),
  );
  return map;
}

/** Load the shared skeleton source scene (the bone hierarchy clips bind to). */
export async function loadSkeletonSource(): Promise<THREE.Object3D> {
  return await loadFbx(SKELETON_SOURCE_ID);
}

/** Default look used when the caller doesn't supply one. */
export const DEFAULT_LOOK: CharacterLook = {
  skin: "#c98c5a",
  shirt: "#c0392b",
  pants: "#2e3440",
  hat: "none",
  hatColor: "#b03030",
  cape: false,
  capeColor: "#1a1e2b",
};

export interface CreateAnimatedCharacterOptions {
  look?: Partial<CharacterLook>;
  /** Weapon classes whose clips to preload (default: all classes). */
  classes?: WeaponClass[];
  /** Initial equipped class (default: "unarmed"). */
  weapon?: WeaponClass;
  /** Target world-space height of the avatar in metres (default: 2). */
  height?: number;
}

/**
 * One-call factory: loads the skeleton + the needed clips, builds the box rig,
 * wires up an {@link Animator}, and equips the initial weapon. Returns the ready
 * Animator; add `animator.root` to your scene and call `animator.update(dt)`.
 */
export async function createAnimatedCharacter(
  opts: CreateAnimatedCharacterOptions = {},
): Promise<Animator> {
  const classes =
    opts.classes ??
    ([
      "unarmed",
      "sword",
      "knife",
      "greatsword",
      "axe",
      "mace",
      "spear",
      "hammer",
      "greataxe",
      "hammer2h",
      "ranged",
      "bow",
      "magic",
      "pistol",
    ] as WeaponClass[]);
  // Always include the global reaction clips regardless of which weapon classes
  // are requested — reactions (stumble, fall, stun, wall-crash, etc.) are
  // class-independent and must be available for defensive combat to play.
  const ids = opts.classes
    ? [...new Set([...classes.flatMap((c) => clipIdsForClass(c)), ...reactionClipIds()])]
    : allReferencedClipIds();

  const [source, clips] = await Promise.all([loadSkeletonSource(), loadClips(ids)]);
  const look: CharacterLook = { ...DEFAULT_LOOK, ...opts.look };
  const character = new VoxelCharacter(source, look, opts.height ?? 2);
  const animator = new Animator(character, clips);
  animator.setWeapon(opts.weapon ?? "unarmed");
  return animator;
}
