import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { CharacterLook } from "./types.js";

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
  private readonly mats: Record<"skin" | "shirt" | "pants" | "boot" | "hat" | "eye", THREE.MeshStandardMaterial>;

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
    this.mats.shirt.color.set(look.shirt);
    this.mats.pants.color.set(look.pants);
    this.mats.hat.color.set(look.hatColor);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
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
      const eyeGeo = new THREE.BoxGeometry(0.08, 0.08, 0.04);
      this.geometries.push(eyeGeo);
      for (const dx of [-0.1, 0.1]) {
        const eye = new THREE.Mesh(eyeGeo, this.mats.eye);
        eye.position.set(dx, 0.03, 0.22);
        head.add(eye);
      }
      this.addHat(head, look.hat);
    }
  }

  private addHat(head: THREE.Mesh, hat: CharacterLook["hat"]): void {
    if (hat === "none") return;
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
