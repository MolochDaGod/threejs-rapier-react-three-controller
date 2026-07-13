/**
 * Remote player stand-in for Lobby World PvP.
 * Prefers Grudge modular race avatar (same as Warlords/GRUDOX); falls back to capsule.
 */

import * as THREE from "three";
import { GrudgeAvatar } from "../grudge/GrudgeAvatar";
import type { RaceId, PresetId } from "../grudge";
import type { AnimRole } from "../types";
import { decodeWirePlayerName } from "../../auth/fleetCharacter";

function parseGrudgeId(id: string | null | undefined): { raceId: RaceId; presetId: PresetId } | null {
  if (!id) return null;
  const dash = id.match(
    /^grudge-(barbarians|dwarves|high-elves|orcs|undead|western-kingdoms)-(knight|warrior|ranger|mage|unarmed)$/i,
  );
  if (!dash) return null;
  const preset = (dash[2].toLowerCase() === "unarmed" ? "unarmed" : dash[2].toLowerCase()) as PresetId;
  return { raceId: dash[1].toLowerCase() as RaceId, presetId: preset };
}

export class LobbyRemoteHero {
  readonly root = new THREE.Group();
  readonly netId: string;
  displayName: string;
  characterId: string | null = null;
  private avatar: GrudgeAvatar | null = null;
  private fallback: THREE.Group | null = null;
  private target = new THREE.Vector3();
  private targetYaw = 0;
  private placed = false;
  private moving = false;
  private ready = false;
  private disposed = false;
  private nameTag: THREE.Sprite | null = null;
  private hp = 100;
  private maxHp = 100;

  constructor(netId: string, wireName: string) {
    this.netId = netId;
    const decoded = decodeWirePlayerName(wireName);
    this.displayName = decoded.displayName;
    this.characterId = decoded.characterId;
  }

  async load(): Promise<void> {
    const parsed = parseGrudgeId(this.characterId);
    if (parsed) {
      try {
        const av = new GrudgeAvatar(parsed.raceId, parsed.presetId);
        await av.load();
        if (this.disposed) {
          av.dispose();
          return;
        }
        this.avatar = av;
        this.root.add(av.root);
        this.ready = true;
        this.attachNameTag();
        return;
      } catch (e) {
        console.warn("[LobbyRemote] grudge load failed", e);
      }
    }
    // Capsule fallback
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.32, 0.8, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x6a4a9a, roughness: 0.55 }),
    );
    body.position.y = 0.95;
    body.castShadow = true;
    g.add(body);
    this.fallback = g;
    this.root.add(g);
    this.ready = true;
    this.attachNameTag();
  }

  private attachNameTag() {
    if (this.nameTag) return;
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, 320, 64);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(this.displayName.slice(0, 22), 160, 40);
    const tex = new THREE.CanvasTexture(canvas);
    this.nameTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    this.nameTag.scale.set(2.4, 0.5, 1);
    this.nameTag.position.y = 2.35;
    this.root.add(this.nameTag);
  }

  apply(
    px: number,
    py: number,
    pz: number,
    ry: number,
    moving: boolean,
    hp: number,
  ): void {
    this.target.set(px, py, pz);
    this.targetYaw = ry;
    this.moving = moving;
    this.hp = hp;
    if (!this.placed) {
      this.root.position.copy(this.target);
      this.root.rotation.y = ry;
      this.placed = true;
    }
  }

  playAttack(): void {
    this.avatar?.playRoleOnce("attack");
  }

  update(dt: number): void {
    if (!this.ready || this.disposed) return;
    const k = 1 - Math.pow(0.001, dt);
    this.root.position.lerp(this.target, Math.min(1, k * 14));
    // angle lerp
    let dy = this.targetYaw - this.root.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.root.rotation.y += dy * Math.min(1, k * 12);

    if (this.avatar) {
      const role: AnimRole = this.moving ? "run" : "idle";
      if (!this.avatar.isOneShotActive) this.avatar.playRole(role, 0.15);
      this.avatar.update(dt);
      this.avatar.root.position.set(0, 0, 0);
      this.avatar.root.rotation.y = 0;
    }
  }

  getHitPoint(): THREE.Vector3 {
    return this.root.position.clone().add(new THREE.Vector3(0, 1, 0));
  }

  getHp(): number {
    return this.hp;
  }

  dispose(): void {
    this.disposed = true;
    this.avatar?.dispose();
    this.avatar = null;
    this.fallback = null;
  }
}
