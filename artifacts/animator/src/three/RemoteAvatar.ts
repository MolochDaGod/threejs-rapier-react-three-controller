import * as THREE from "three";
import { lerp, lerpAngle } from "@workspace/danger-net";
import { ExplorerCharacter } from "./ExplorerCharacter";
import { getCharacter } from "./assets";
import type { AnimRole, WeaponId } from "./types";

/** Every weapon id we'll honour from the wire; anything else falls back. */
const KNOWN_WEAPONS = new Set<WeaponId>([
  "none",
  "sword",
  "greatsword",
  "axe",
  "dagger",
  "spear",
  "hammer",
  "bow",
  "staff",
  "pistol",
  "rifle",
  "shield",
]);

/** Position-smoothing responsiveness (higher = snappier toward the target). */
const SMOOTH = 12;
/** Below this planar speed (units/sec) a remote reads as standing still. */
const MOVE_EPS = 0.6;

/**
 * A networked stand-in for another player (or a mirrored host NPC). It wraps the
 * procedural {@link ExplorerCharacter} rig and is driven purely by transforms
 * received over the wire: positions are lerped, yaw is angle-lerped, and the
 * locomotion role (idle/run/jump) plus one-shot attacks come from the latest
 * snapshot / combat events. No physics, no AI — the owning client is authoritative.
 */
export class RemoteAvatar {
  readonly root = new THREE.Group();
  private avatar: ExplorerCharacter;
  private ready = false;
  private disposed = false;

  private target = new THREE.Vector3();
  private targetYaw = 0;
  private placed = false;
  private moving = false;
  private grounded = true;
  private role: AnimRole = "idle";
  private weapon = "none";
  private nameTag: THREE.Sprite | null = null;

  constructor(
    readonly id: string,
    private readonly label: string,
  ) {
    this.avatar = new ExplorerCharacter(getCharacter("explorer"));
  }

  async load(): Promise<void> {
    await this.avatar.load();
    if (this.disposed) {
      this.avatar.dispose();
      return;
    }
    this.root.add(this.avatar.root);
    this.avatar.playRole("idle");
    if (this.label) {
      this.nameTag = makeNameTag(this.label);
      this.root.add(this.nameTag);
    }
    this.ready = true;
  }

  /** Update the interpolation target from a received transform. */
  applyTransform(
    px: number,
    py: number,
    pz: number,
    ry: number,
    moving: boolean,
    grounded: boolean,
    weapon: string,
  ): void {
    this.target.set(px, py, pz);
    this.targetYaw = ry;
    this.moving = moving;
    this.grounded = grounded;
    if (!this.placed) {
      this.root.position.copy(this.target);
      this.root.rotation.y = ry;
      this.placed = true;
    }
    if (weapon !== this.weapon) {
      this.weapon = weapon;
      if (KNOWN_WEAPONS.has(weapon as WeaponId)) {
        this.avatar.setWeaponId(weapon);
      }
    }
  }

  /** Play a one-shot attack animation (driven from combat "attack" events). */
  playAttack(): void {
    if (this.ready && this.avatar.hasRole("attack")) this.avatar.playRoleOnce("attack");
  }

  /** Play a one-shot hurt reaction (driven when this avatar takes a hit). */
  playHurt(): void {
    if (this.ready && this.avatar.hasRole("hurt")) this.avatar.playRoleOnce("hurt");
  }

  /** World position (for crosshair hit tests against mirrored NPCs). */
  position(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.root.position);
  }

  update(dt: number): void {
    if (!this.ready) return;
    const k = 1 - Math.exp(-SMOOTH * dt);
    const before = this.root.position.clone();
    this.root.position.set(
      lerp(this.root.position.x, this.target.x, k),
      lerp(this.root.position.y, this.target.y, k),
      lerp(this.root.position.z, this.target.z, k),
    );
    this.root.rotation.y = lerpAngle(this.root.rotation.y, this.targetYaw, k);

    // For mirrored NPCs `moving` may not be reported; fall back to actual motion.
    const planar = Math.hypot(
      this.root.position.x - before.x,
      this.root.position.z - before.z,
    );
    const isMoving = this.moving || planar / Math.max(dt, 1e-3) > MOVE_EPS;
    const role: AnimRole = !this.grounded ? "jump" : isMoving ? "run" : "idle";
    if (role !== this.role) {
      this.role = role;
      if (role === "jump") {
        if (this.avatar.hasRole("jump")) this.avatar.playRoleOnce("jump");
      } else {
        this.avatar.playRole(role);
      }
    }
    this.avatar.update(dt);
  }

  dispose(): void {
    this.disposed = true;
    this.avatar.dispose();
    if (this.nameTag) {
      const mat = this.nameTag.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
      this.nameTag = null;
    }
    this.root.clear();
  }
}

/** Build a small billboarded name label that floats above the avatar's head. */
function makeNameTag(text: string): THREE.Sprite {
  const pad = 16;
  const font = "600 44px system-ui, sans-serif";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = 64 + pad;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(8, 12, 22, 0.72)";
  roundRect(ctx, 0, 0, w, h, 14);
  ctx.fill();
  ctx.fillStyle = "#dfe9ff";
  ctx.fillText(text, pad, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  const scale = 0.0045;
  sprite.scale.set(w * scale, h * scale, 1);
  sprite.position.set(0, 2.4, 0);
  sprite.renderOrder = 10;
  return sprite;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
