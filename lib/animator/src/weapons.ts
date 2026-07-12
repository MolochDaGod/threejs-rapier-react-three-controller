import * as THREE from "three";
import type { WeaponClass } from "./types.js";
import type { VoxelCharacter } from "./rig.js";

/**
 * Procedural, low-poly weapon props mounted on the character's hand bones. They
 * are intentionally simple box/cylinder builds (no external assets) so the
 * library stays self-contained. Each builder returns a group whose origin sits
 * at the grip, oriented so +Y runs along the weapon toward the blade/limb tip.
 */

export interface MountedWeapons {
  /** Everything added to the hands, for disposal/removal. */
  objects: THREE.Object3D[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  /**
   * The equipped melee weapon's blade segment: empty marker nodes parented into
   * the weapon group (in its local +Y frame, grip→tip) so they ride the hand
   * bone through every clip. A host samples their world transform each frame to
   * drive a real swept-blade hitbox + trail. Absent for non-melee / unarmed.
   */
  blade?: { tip: THREE.Object3D; base: THREE.Object3D };
  /** The off-hand (left-hand) prop, if any — toggled when a throwable is thrown. */
  offhand?: THREE.Object3D | null;
}

const EMPTY: MountedWeapons = { objects: [], geometries: [], materials: [] };

/**
 * Attach empty tip/base marker nodes to a built weapon group, in its local +Y
 * frame (grip→tip). They carry no geometry/material (nothing to dispose) and,
 * because they are children of the group, ride the hand bone through every clip
 * — letting a host read the blade's true world transform each frame.
 */
function addBlade(w: MountedWeapons, g: THREE.Group, baseY: number, tipY: number): void {
  const base = new THREE.Object3D();
  base.position.set(0, baseY, 0);
  const tip = new THREE.Object3D();
  tip.position.set(0, tipY, 0);
  g.add(base, tip);
  w.blade = { tip, base };
}

function track(w: MountedWeapons, obj: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  w.geometries.push(geo);
  w.materials.push(mat);
  obj.add(mesh);
  return mesh;
}

function buildSword(w: MountedWeapons): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: "#cfd6e0", metalness: 0.6, roughness: 0.35 });
  const grip = new THREE.MeshStandardMaterial({ color: "#5a3a22", roughness: 0.8 });
  const blade = track(w, g, new THREE.BoxGeometry(0.07, 0.95, 0.02), steel);
  blade.position.y = 0.6;
  const guard = track(w, g, new THREE.BoxGeometry(0.28, 0.06, 0.06), steel);
  guard.position.y = 0.12;
  const handle = track(w, g, new THREE.BoxGeometry(0.05, 0.22, 0.05), grip);
  handle.position.y = 0;
  return g;
}

function buildKnife(w: MountedWeapons): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: "#d7dde6", metalness: 0.7, roughness: 0.3 });
  const grip = new THREE.MeshStandardMaterial({ color: "#3a2a1c", roughness: 0.85 });
  // Short blade running up +Y from the grip, with a stubby guard and handle.
  const blade = track(w, g, new THREE.BoxGeometry(0.05, 0.34, 0.015), steel);
  blade.position.y = 0.27;
  const guard = track(w, g, new THREE.BoxGeometry(0.14, 0.04, 0.05), steel);
  guard.position.y = 0.1;
  const handle = track(w, g, new THREE.BoxGeometry(0.045, 0.18, 0.045), grip);
  handle.position.y = 0;
  return g;
}

function buildBow(w: MountedWeapons): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: "#6b4a2a", roughness: 0.8 });
  const string = new THREE.MeshStandardMaterial({ color: "#e8e2d0", roughness: 0.6 });
  const limb = track(w, g, new THREE.BoxGeometry(0.05, 1.2, 0.05), wood);
  limb.position.y = 0.2;
  // Slight recurve by rotating the riser ends.
  const top = track(w, g, new THREE.BoxGeometry(0.04, 0.3, 0.04), wood);
  top.position.set(0.05, 0.78, 0);
  top.rotation.z = 0.5;
  const bot = track(w, g, new THREE.BoxGeometry(0.04, 0.3, 0.04), wood);
  bot.position.set(0.05, -0.38, 0);
  bot.rotation.z = -0.5;
  const bowString = track(w, g, new THREE.BoxGeometry(0.01, 1.25, 0.01), string);
  bowString.position.set(0.09, 0.2, 0);
  return g;
}

function buildStaff(w: MountedWeapons): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: "#6a4a32", roughness: 0.8 });
  const gem = new THREE.MeshStandardMaterial({
    color: "#6fd6ff",
    emissive: "#2aa8ff",
    emissiveIntensity: 1.2,
    metalness: 0.2,
    roughness: 0.25,
  });
  // Shaft runs up +Y from the grip; a glowing orb caps the top.
  const shaft = track(w, g, new THREE.CylinderGeometry(0.035, 0.045, 1.3, 8), wood);
  shaft.position.y = 0.5;
  const orb = track(w, g, new THREE.IcosahedronGeometry(0.12, 0), gem);
  orb.position.y = 1.2;
  return g;
}

function buildRifle(w: MountedWeapons): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: "#33363d", metalness: 0.6, roughness: 0.4 });
  const stock = new THREE.MeshStandardMaterial({ color: "#3a2a1c", roughness: 0.85 });
  // Rifle lies along +Z (forward) from the grip.
  const body = track(w, g, new THREE.BoxGeometry(0.07, 0.1, 0.6), metal);
  body.position.set(0, 0.02, 0.2);
  const barrel = track(w, g, new THREE.CylinderGeometry(0.02, 0.02, 0.4, 10), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.04, 0.5);
  const butt = track(w, g, new THREE.BoxGeometry(0.06, 0.14, 0.18), stock);
  butt.position.set(0, -0.02, -0.12);
  return g;
}

/**
 * Build and mount the weapon set for a class onto the character's hands. Returns
 * the created objects/resources so the Animator can dispose them on a swap.
 * Local transforms tuned so the grips sit in the closed fist of each hand.
 */
export function mountWeapons(character: VoxelCharacter, weapon: WeaponClass): MountedWeapons {
  const w: MountedWeapons = { objects: [], geometries: [], materials: [] };

  if (weapon === "sword") {
    const sword = buildSword(w);
    addBlade(w, sword, 0.18, 1.05);
    sword.position.set(0, 0.05, 0);
    sword.rotation.set(Math.PI / 2, 0, 0);
    character.mounts.rightHand.add(sword);
    // Off-hand: a small throwing knife (replaces the old shield) so the Sword &
    // Knife loadout can hurl its left-hand blade. Scaled down to read as light.
    const offKnife = buildKnife(w);
    offKnife.scale.setScalar(0.8);
    offKnife.position.set(0, 0.05, 0);
    offKnife.rotation.set(Math.PI / 2, 0, 0);
    character.mounts.leftHand.add(offKnife);
    w.objects.push(sword, offKnife);
    w.offhand = offKnife;
  } else if (weapon === "knife") {
    const knife = buildKnife(w);
    addBlade(w, knife, 0.12, 0.44);
    knife.position.set(0, 0.05, 0);
    knife.rotation.set(Math.PI / 2, 0, 0);
    character.mounts.rightHand.add(knife);
    w.objects.push(knife);
  } else if (weapon === "bow") {
    const bow = buildBow(w);
    bow.position.set(0, 0.05, 0);
    bow.rotation.set(0, 0, Math.PI / 2);
    character.mounts.leftHand.add(bow);
    w.objects.push(bow);
  } else if (weapon === "ranged") {
    const rifle = buildRifle(w);
    rifle.position.set(0, 0, 0.05);
    character.mounts.rightHand.add(rifle);
    w.objects.push(rifle);
  } else if (weapon === "magic") {
    const staff = buildStaff(w);
    addBlade(w, staff, 0.7, 1.25);
    staff.position.set(0, 0.05, 0);
    staff.rotation.set(Math.PI / 2, 0, 0);
    character.mounts.rightHand.add(staff);
    w.objects.push(staff);
  } else {
    return EMPTY;
  }

  return w;
}

/** Remove and free a previously mounted weapon set. */
export function unmountWeapons(w: MountedWeapons): void {
  for (const o of w.objects) o.removeFromParent();
  for (const g of w.geometries) g.dispose();
  for (const m of w.materials) m.dispose();
  w.objects.length = 0;
  w.geometries.length = 0;
  w.materials.length = 0;
}
