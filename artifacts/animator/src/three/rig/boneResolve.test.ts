import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { boneKey, findWeaponSocket, resolveRigBind } from "./boneResolve";

describe("boneKey", () => {
  it("normalizes Mixamo, Bip001 spaces, and containers", () => {
    expect(boneKey("mixamorigHips")).toBe("hips");
    expect(boneKey("mixamorig:RightHand")).toBe("righthand");
    expect(boneKey("Bip001 R Hand")).toBe("bip001_r_hand");
    expect(boneKey("Bip001_R_Hand")).toBe("bip001_r_hand");
    expect(boneKey("R_hand_container")).toBe("r_hand_container");
  });
});

describe("resolveRigBind", () => {
  it("finds Bip001 hips and hands with space dialect", () => {
    const root = new THREE.Group();
    root.name = "Character";
    const hips = new THREE.Bone();
    hips.name = "Bip001 Pelvis";
    const rHand = new THREE.Bone();
    rHand.name = "Bip001 R Hand";
    const lHand = new THREE.Bone();
    lHand.name = "Bip001 L Hand";
    root.add(hips);
    hips.add(rHand);
    hips.add(lHand);

    const bind = resolveRigBind(root);
    expect(bind.kind).toBe("bip001");
    expect(bind.hips?.name).toBe("Bip001 Pelvis");
    expect(bind.rightHand?.name).toBe("Bip001 R Hand");
    expect(bind.leftHand?.name).toBe("Bip001 L Hand");
    expect(bind.locoReady).toBe(true);
    expect(bind.weaponReady).toBe(true);
  });

  it("prefers hand containers for weapon sockets", () => {
    const root = new THREE.Group();
    const cont = new THREE.Object3D();
    cont.name = "R_hand_container";
    const bone = new THREE.Bone();
    bone.name = "Bip001_R_Hand";
    root.add(bone);
    bone.add(cont);
    expect(findWeaponSocket(root, "R")?.name).toBe("R_hand_container");
  });

  it("warns when hips/hands are missing", () => {
    const root = new THREE.Group();
    const bind = resolveRigBind(root);
    expect(bind.locoReady).toBe(false);
    expect(bind.weaponReady).toBe(false);
    expect(bind.warnings.length).toBeGreaterThan(0);
  });
});
