import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { CharacterLook } from "./types";
import { SHELLS, DEFAULT_SHELL, PANEL_Z, OPENING_CENTER_Y, type ShellId } from "../LedMaskShells";
import { applyAvatarHead, loadPlayerHeadConfig, type AvatarHeadHandle } from "../avatar/playerHead";
import { skinToneOf } from "../avatar/catalog";

/** Recolourable / patternable body parts of the procedural box rig. */
export type VoxelPart = "skin" | "shirt" | "pants" | "boot" | "hat" | "eye";

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Mount points the Animator/engine can attach weapons to. */
export interface WeaponMounts {
  rightHand: THREE.Object3D;
  leftHand: THREE.Object3D;
}

/**
 * A blocky, recolourable voxel character whose box meshes are rigidly parented
 * to a cloned 25-bone Mixamo skeleton. No skinning is used: each body box is a
 * child of the bone that drives it, so when the AnimationMixer rotates the bones
 * the boxes follow. Box dimensions are derived from the bind-pose joint spacing,
 * so the proportions match the Mixamo rig the clips were authored for.
 */
export class VoxelCharacter {
  /** Engine-facing root; feet rest at local y = 0, centred on x/z. */
  readonly root: THREE.Group;
  /** Cloned bone hierarchy root (the mixer binds clips against this). */
  readonly skeletonRoot: THREE.Object3D;
  readonly mounts: WeaponMounts;

  private readonly bones = new Map<string, THREE.Bone>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly mats: Record<VoxelPart, THREE.MeshStandardMaterial>;
  // Extra materials/textures owned by baked accessories (LED mask, cape) that
  // live outside the shared `mats` record and must be freed in dispose().
  private readonly extraMats: THREE.Material[] = [];
  private readonly extraTextures: THREE.Texture[] = [];
  // Pattern textures applied to a part via setPartPattern; owned here so we can
  // dispose the previous one on replace/clear and free them all in dispose().
  private readonly patternTextures = new Map<VoxelPart, THREE.Texture>();
  private capeMat: THREE.MeshStandardMaterial | null = null;

  // The box head + its skin eyes, kept so the LED mask can be swapped on/off live
  // (the mask hides the eyes; removing it shows them again).
  private headMesh: THREE.Mesh | null = null;
  private readonly eyeMeshes: THREE.Mesh[] = [];
  // Baked LED-mask head accessory, owned separately so {@link setLedMask} can
  // dispose + rebuild just this group (with a different shell) in place. Its
  // geometries/materials/textures live here, NOT in the rig-wide arrays, so a
  // live shell swap frees only the old mask.
  private ledMaskGroup: THREE.Group | null = null;
  private readonly ledGeometries: THREE.BufferGeometry[] = [];
  private readonly ledMaterials: THREE.Material[] = [];
  private readonly ledTextures: THREE.Texture[] = [];
  // Saved Avatar Edit head applied over the box head (owns its own mats/tex).
  private avatarHeadFx: AvatarHeadHandle | null = null;
  // When an Avatar Edit head is worn, the body skin is tinted to the head's
  // race skin tone so hands/arms match the face; recolor() must preserve it.
  private avatarSkinHex: number | null = null;

  constructor(skeletonSource: THREE.Object3D, look: CharacterLook, targetHeight = 2) {
    this.root = new THREE.Group();
    this.root.name = "VoxelCharacter";

    // Independent bone hierarchy for this instance.
    this.skeletonRoot = cloneSkeleton(skeletonSource);
    this.root.add(this.skeletonRoot);
    this.root.updateMatrixWorld(true);

    this.skeletonRoot.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
    });

    this.mats = {
      skin: this.material(look.skin),
      shirt: this.material(look.shirt),
      pants: this.material(look.pants),
      boot: this.material("#2a2a32"),
      hat: this.material(look.hatColor),
      eye: this.material("#15151b"),
    };

    this.buildBody(look);

    // Weapon mounts ride the hand bones.
    this.mounts = {
      rightHand: this.addMount("mixamorigRightHand"),
      leftHand: this.addMount("mixamorigLeftHand"),
    };

    this.fit(targetHeight);
  }

  /** Look up a bone by its sanitised Mixamo name (e.g. `mixamorigHips`). */
  getBone(name: string): THREE.Bone | undefined {
    return this.bones.get(name);
  }

  /** Recolour the avatar in place (shared materials, so this is cheap). */
  recolor(look: CharacterLook): void {
    this.mats.skin.color.set(look.skin);
    // keep the body matched to the worn Avatar Edit head's skin tone
    if (this.avatarSkinHex != null) this.mats.skin.color.setHex(this.avatarSkinHex);
    this.mats.shirt.color.set(look.shirt);
    this.mats.pants.color.set(look.pants);
    this.mats.hat.color.set(look.hatColor);
    if (this.capeMat && look.capeColor) this.capeMat.color.set(look.capeColor);
  }

  /**
   * Set a single body-part material colour (finer control than {@link recolor},
   * which only takes a whole {@link CharacterLook}). Materials are shared per
   * part, so every box of that part recolours together.
   */
  setPartColor(part: VoxelPart, color: THREE.ColorRepresentation): void {
    const m = this.mats[part];
    if (!m) return;
    m.color.set(color);
    m.needsUpdate = true;
  }

  /**
   * Apply (or clear, with `null`) a tiling pattern texture on a single body-part
   * material. When a map is applied the base colour is reset to white so the
   * pattern's own colours read true; the texture is owned here (the previous one
   * is disposed on replace/clear and all are freed in {@link dispose}). `repeat`
   * tiles the pattern across the part's box faces.
   */
  setPartPattern(part: VoxelPart, texture: THREE.Texture | null, repeat = 1): void {
    const m = this.mats[part];
    if (!m) return;
    const prev = this.patternTextures.get(part);
    if (prev && prev !== texture) {
      prev.dispose();
      this.patternTextures.delete(part);
    }
    if (texture) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeat, repeat);
      texture.colorSpace = THREE.SRGBColorSpace;
      m.map = texture;
      m.color.set("#ffffff");
      this.patternTextures.set(part, texture);
    } else {
      m.map = null;
    }
    m.needsUpdate = true;
  }

  /** Per-frame avatar-head effects (hair-strand wind sway); absolute seconds. */
  updateHeadFx(timeSec: number): void {
    this.avatarHeadFx?.update(timeSec);
  }

  dispose(): void {
    this.avatarHeadFx?.dispose();
    this.avatarHeadFx = null;
    for (const g of this.geometries) g.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    for (const m of this.extraMats) m.dispose();
    for (const t of this.extraTextures) t.dispose();
    for (const g of this.ledGeometries) g.dispose();
    for (const m of this.ledMaterials) m.dispose();
    for (const t of this.ledTextures) t.dispose();
    for (const t of this.patternTextures.values()) t.dispose();
    this.patternTextures.clear();
    this.root.removeFromParent();
  }

  // --------------------------------------------------------------------- build

  private material(color: string): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0 });
  }

  private buildBody(look: CharacterLook): void {
    // Torso: pelvis (pants) + chest (shirt), each spanning a spine segment so the
    // body bends naturally with the spine bones.
    this.segment("mixamorigHips", "mixamorigSpine1", { w: 0.46, d: 0.26 }, this.mats.pants, 1.25);
    this.segment("mixamorigSpine1", "mixamorigNeck", { w: 0.54, d: 0.32 }, this.mats.shirt, 1.1);

    // Arms: upper (sleeve) + fore (skin), per side.
    for (const side of ["Left", "Right"] as const) {
      this.segment(`mixamorig${side}Arm`, `mixamorig${side}ForeArm`, { w: 0.18, d: 0.18 }, this.mats.shirt);
      this.segment(`mixamorig${side}ForeArm`, `mixamorig${side}Hand`, { w: 0.16, d: 0.16 }, this.mats.skin);
      this.cap(`mixamorig${side}Hand`, { w: 0.16, h: 0.16, d: 0.18 }, this.mats.skin, new THREE.Vector3(side === "Left" ? 0.07 : -0.07, 0, 0));

      // Legs: thigh + shin (pants) + foot (boot).
      this.segment(`mixamorig${side}UpLeg`, `mixamorig${side}Leg`, { w: 0.22, d: 0.24 }, this.mats.pants);
      this.segment(`mixamorig${side}Leg`, `mixamorig${side}Foot`, { w: 0.2, d: 0.22 }, this.mats.pants);
      this.cap(`mixamorig${side}Foot`, { w: 0.2, h: 0.12, d: 0.3 }, this.mats.boot, new THREE.Vector3(0, -0.04, 0.08));
    }

    // Head + face + optional hat.
    const head = this.cap("mixamorigHead", { w: 0.44, h: 0.44, d: 0.44 }, this.mats.skin, new THREE.Vector3(0, 0.12, 0));
    if (head) {
      this.headMesh = head;
      // The LED mask fully encloses the head, so the skin eyes are hidden under it
      // (they'd z-fight inside the visor) — the baked dot-matrix face replaces
      // them. They're still built (just hidden) so toggling the mask off live
      // restores them without a full rebuild.
      const eyeGeo = new THREE.BoxGeometry(0.08, 0.08, 0.04);
      this.geometries.push(eyeGeo);
      for (const dx of [-0.1, 0.1]) {
        const eye = new THREE.Mesh(eyeGeo, this.mats.eye);
        eye.position.set(dx, 0.03, 0.22);
        eye.visible = look.hat !== "ledMask";
        head.add(eye);
        this.eyeMeshes.push(eye);
      }
      this.addHat(head, look);

      // Player-authored Avatar Edit head: swap the plain skin cube for the
      // saved composed pixel faces + protrusions. Skipped under the LED mask
      // (it fully encloses the head) and when nothing has been saved yet.
      if (look.avatarHead && look.hat !== "ledMask") {
        const cfg = loadPlayerHeadConfig();
        if (cfg) {
          this.avatarHeadFx = applyAvatarHead(head, cfg, 0.44);
          for (const eye of this.eyeMeshes) eye.visible = false;
          // Match the body to the head: tint the shared skin material (hands,
          // forearms) to the avatar's race skin tone so the character reads as
          // one person, not a pasted-on head.
          this.avatarSkinHex = skinToneOf(cfg);
          this.mats.skin.color.setHex(this.avatarSkinHex);
        }
      }
    }

    // Optional cape, hung from the upper back so it sways with the torso.
    if (look.cape) this.buildCape(look.capeColor ?? "#1a1e2b");
  }

  private addHat(head: THREE.Mesh, look: CharacterLook): void {
    const hat = look.hat;
    if (hat === "none") return;
    if (hat === "ledMask") {
      this.buildLedMaskHead(head, look.ledShell ?? DEFAULT_SHELL);
      return;
    }
    if (hat === "cap") {
      const crownGeo = new THREE.BoxGeometry(0.48, 0.2, 0.48);
      const brimGeo = new THREE.BoxGeometry(0.5, 0.05, 0.28);
      this.geometries.push(crownGeo, brimGeo);
      const crown = new THREE.Mesh(crownGeo, this.mats.hat);
      crown.position.set(0, 0.3, 0);
      const brim = new THREE.Mesh(brimGeo, this.mats.hat);
      brim.position.set(0, 0.22, 0.32);
      head.add(crown, brim);
    } else {
      // horns
      const hornGeo = new THREE.BoxGeometry(0.08, 0.24, 0.08);
      this.geometries.push(hornGeo);
      for (const dx of [-0.16, 0.16]) {
        const horn = new THREE.Mesh(hornGeo, this.mats.hat);
        horn.position.set(dx, 0.32, 0);
        horn.rotation.z = dx < 0 ? 0.3 : -0.3;
        head.add(horn);
      }
    }
  }

  /**
   * Bake the LED Mask "machine god" look over the box head: an opaque dark base
   * box that hides the skin head, one of the swappable {@link SHELLS} housings
   * (hood / arcade / robot / crystal / …), a recessed visor, and a STATIC
   * emissive dot-matrix face (a CanvasTexture baked once — no per-frame
   * animation, unlike the standalone LedMask studio). All meshes parent to `head`
   * via {@link ledMaskGroup} so they ride the head bone; their geometries,
   * materials and textures are tracked in the `led*` arrays so {@link setLedMask}
   * can free and rebuild just this accessory when the shell changes.
   */
  private buildLedMaskHead(head: THREE.Mesh, shellId: ShellId): void {
    const group = new THREE.Group();
    group.name = "LedMaskHead";
    head.add(group);
    this.ledMaskGroup = group;

    const darkMat = new THREE.MeshStandardMaterial({ color: "#0a0b12", roughness: 0.6, metalness: 0.1 });
    const visorMat = new THREE.MeshStandardMaterial({ color: "#05060c", roughness: 0.3, metalness: 0.3 });
    this.ledMaterials.push(darkMat, visorMat);

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      this.ledGeometries.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      group.add(m);
      return m;
    };

    // Opaque base box — slightly larger than the 0.44 head box so the skin head
    // is fully hidden inside it whatever shell (even a sparse/translucent one) is
    // worn.
    add(new THREE.BoxGeometry(0.52, 0.56, 0.52), darkMat, 0, 0.02, 0);

    // The chosen shell is built in the LedMask studio's (much larger) coordinate
    // frame, where the LED face centre is `(0, OPENING_CENTER_Y, PANEL_Z)`. Drop
    // it into a sub-group scaled + offset so that point lands on this baked head's
    // small face plane (FACE at `(0, FACE_Y, FACE_Z)`); a uniform scale keeps the
    // housing's proportions. Frame pieces sit OUTSIDE the opening, so they stay
    // clear of the (smaller) baked face plane and never occlude it.
    const FACE_Y = 0.02;
    const FACE_Z = 0.29;
    const S = 0.32; // studio head (1.4 wide) → baked head (0.44 wide), with margin
    const shellGroup = new THREE.Group();
    shellGroup.scale.setScalar(S);
    shellGroup.position.set(0, FACE_Y - S * OPENING_CENTER_Y, FACE_Z - S * PANEL_Z);
    const def = SHELLS.find((s) => s.id === shellId) ?? SHELLS[0];
    def.build(shellGroup);
    // The shell builders own the geometries/materials they add; collect them so
    // the led-specific dispose path frees them on rebuild.
    shellGroup.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      this.ledGeometries.push(mesh.geometry);
      const mat = mesh.material;
      if (Array.isArray(mat)) this.ledMaterials.push(...mat);
      else if (mat) this.ledMaterials.push(mat);
    });
    group.add(shellGroup);

    // Recessed dark visor box; its front face (0.06 + 0.42/2 = 0.27) must sit
    // BEHIND the emissive face plane (0.29) so the additive LEDs aren't occluded.
    add(new THREE.BoxGeometry(0.46, 0.4, 0.42), visorMat, 0, 0.0, 0.06);

    // Baked emissive dot-matrix face on a thin plane just in front of the visor.
    const faceTex = this.drawLedFaceTexture();
    this.ledTextures.push(faceTex);
    const faceMat = new THREE.MeshBasicMaterial({
      map: faceTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.ledMaterials.push(faceMat);
    const faceGeo = new THREE.PlaneGeometry(0.42, 0.34);
    this.ledGeometries.push(faceGeo);
    const face = new THREE.Mesh(faceGeo, faceMat);
    face.position.set(0, FACE_Y, FACE_Z);
    group.add(face);
  }

  /**
   * Swap the baked LED-mask head live: `null` removes it entirely (restoring the
   * skin eyes), any {@link ShellId} (re)builds the mask wearing that shell. Stays
   * a STATIC bake — this rebuilds the accessory geometry once, there is no render
   * loop. Frees the previous mask's owned geometry/materials/textures first.
   */
  setLedMask(shellId: ShellId | null): void {
    if (this.ledMaskGroup) {
      this.ledMaskGroup.removeFromParent();
      for (const g of this.ledGeometries) g.dispose();
      for (const m of this.ledMaterials) m.dispose();
      for (const t of this.ledTextures) t.dispose();
      this.ledGeometries.length = 0;
      this.ledMaterials.length = 0;
      this.ledTextures.length = 0;
      this.ledMaskGroup = null;
    }
    const masked = shellId !== null;
    for (const eye of this.eyeMeshes) eye.visible = !masked;
    if (masked && this.headMesh) this.buildLedMaskHead(this.headMesh, shellId);
  }

  /**
   * Draw a STATIC LED dot-matrix face (two eyes + a friendly mouth curve) into a
   * canvas once and return it as an additive emissive texture. Baked — there is
   * no scrolling banner or animation here, unlike the LedMask studio.
   */
  private drawLedFaceTexture(): THREE.CanvasTexture {
    const COLS = 18;
    const ROWS = 14;
    const cell = 16;
    const c = document.createElement("canvas");
    c.width = COLS * cell;
    c.height = ROWS * cell;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    const lit = (col: number, row: number) => {
      const cx = col * cell + cell / 2;
      const cy = row * cell + cell / 2;
      g.shadowColor = "#36e3ff";
      g.shadowBlur = 10;
      g.fillStyle = "#7af0ff";
      g.beginPath();
      g.arc(cx, cy, cell * 0.34, 0, Math.PI * 2);
      g.fill();
    };
    // Two square eyes.
    for (const ex of [4, 12]) {
      for (let dx = 0; dx < 3; dx++) {
        for (let dy = 0; dy < 3; dy++) lit(ex + dx - 1, 4 + dy);
      }
    }
    // A friendly upward mouth curve across the lower face.
    const mouth: [number, number][] = [
      [5, 9], [6, 10], [7, 10], [8, 11], [9, 11], [10, 11], [11, 10], [12, 10], [13, 9],
    ];
    for (const [mx, my] of mouth) lit(mx, my);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Hang a flowing cape from the upper back. It is a thin tapered cloth box
   * parented to a spine bone (world-aligned in bind pose, then tilted back) so it
   * sways with the torso as the spine bends.
   */
  private buildCape(color: string): void {
    const boneName = this.bones.has("mixamorigSpine2") ? "mixamorigSpine2" : "mixamorigSpine1";
    const bone = this.bones.get(boneName);
    if (!bone) return;

    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    this.capeMat = mat;
    this.extraMats.push(mat);

    const boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
    const worldPos = bone.getWorldPosition(new THREE.Vector3());
    // Centre the cloth behind and below the shoulders, in world space.
    const center = worldPos.clone().add(new THREE.Vector3(0, -0.45, -0.16));

    const geo = new THREE.BoxGeometry(0.5, 1.1, 0.04);
    this.geometries.push(geo);
    const cape = new THREE.Mesh(geo, mat);
    cape.position.copy(bone.worldToLocal(center.clone()));
    // World-align (counter-rotate the bone) then flare the hem slightly backward.
    cape.quaternion.copy(boneQ.clone().invert());
    cape.rotateX(0.12);
    cape.castShadow = true;
    cape.receiveShadow = true;
    bone.add(cape);
  }

  /**
   * Add a box spanning the bind-pose distance between two bones, parented to the
   * first bone so it inherits that bone's animation. The box's +Y is aligned to
   * the bone direction in the parent's local frame.
   */
  private segment(
    parentName: string,
    childName: string,
    cross: { w: number; d: number },
    mat: THREE.Material,
    lengthScale = 1,
  ): void {
    const parent = this.bones.get(parentName);
    const child = this.bones.get(childName);
    if (!parent || !child) return;

    const head = parent.getWorldPosition(new THREE.Vector3());
    const tail = child.getWorldPosition(new THREE.Vector3());
    const len = head.distanceTo(tail) * lengthScale;
    if (len < 1e-4) return;

    const worldCenter = head.clone().lerp(tail, 0.5);
    const localCenter = parent.worldToLocal(worldCenter.clone());

    const parentQ = parent.getWorldQuaternion(new THREE.Quaternion());
    const localDir = tail.clone().sub(head).normalize().applyQuaternion(parentQ.invert());

    const geo = new THREE.BoxGeometry(cross.w, len, cross.d);
    this.geometries.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(localCenter);
    mesh.quaternion.setFromUnitVectors(Y_AXIS, localDir);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }

  /**
   * Add a fixed-size box at an end bone (head/hand/foot). The box is built
   * WORLD-axis-aligned in bind pose (counter-rotating the bone) so faces like
   * the eyes point straight forward; it still follows the bone once animated.
   * `localOffset` nudges the box along world axes from the bone position.
   */
  private cap(
    boneName: string,
    size: { w: number; h: number; d: number },
    mat: THREE.Material,
    localOffset: THREE.Vector3,
  ): THREE.Mesh | undefined {
    const bone = this.bones.get(boneName);
    if (!bone) return undefined;

    const boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
    const worldPos = bone.getWorldPosition(new THREE.Vector3()).add(localOffset);

    const geo = new THREE.BoxGeometry(size.w, size.h, size.d);
    this.geometries.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(bone.worldToLocal(worldPos.clone()));
    mesh.quaternion.copy(boneQ.clone().invert());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bone.add(mesh);
    return mesh;
  }

  /** Empty mount node, world-aligned in bind pose, parented to a hand bone. */
  private addMount(boneName: string): THREE.Object3D {
    const node = new THREE.Object3D();
    node.name = `${boneName}.mount`;
    const bone = this.bones.get(boneName);
    if (bone) {
      node.quaternion.copy(bone.getWorldQuaternion(new THREE.Quaternion()).invert());
      bone.add(node);
    } else {
      this.root.add(node);
    }
    return node;
  }

  /** Scale the whole rig to a target height and drop the feet to y = 0. */
  private fit(targetHeight: number): void {
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    const height = box.max.y - box.min.y;
    if (height > 1e-3) {
      const s = targetHeight / height;
      this.skeletonRoot.scale.multiplyScalar(s);
      this.root.updateMatrixWorld(true);
    }
    const fitted = new THREE.Box3().setFromObject(this.root);
    const center = fitted.getCenter(new THREE.Vector3());
    this.skeletonRoot.position.x -= center.x;
    this.skeletonRoot.position.z -= center.z;
    this.skeletonRoot.position.y -= fitted.min.y;
    this.root.updateMatrixWorld(true);
  }
}
