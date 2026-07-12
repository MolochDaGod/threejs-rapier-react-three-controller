import * as THREE from "three";

/**
 * Shared, canvas-generated alpha textures for the Danger Room's flat ground FX
 * (AoE telegraphs, status footprints, shockwaves, door decals). They replace the
 * old hard-edged `RingGeometry` / `CircleGeometry` discs — those read as flat,
 * untextured plates. Every texture here is drawn WHITE-on-transparent so it can
 * be tinted per use via `material.color` under additive blending (white × tint =
 * tint; the texture supplies SHAPE + soft falloff only, exactly like the target
 * GLB indicator). Textures are module-cached and intentionally never disposed —
 * they are shared singletons, not per-instance resources.
 */

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** Soft radial glow disc (bright centre → transparent edge). */
export function softDiscTexture(): THREE.CanvasTexture {
  return make("softDisc", 128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/**
 * A single glowing annulus with soft gaussian-ish falloff on both edges — the
 * clean expanding ring for shockwaves and status footprints.
 */
export function ringTexture(): THREE.CanvasTexture {
  return make("ring", 256, (ctx, s) => {
    const cx = s / 2;
    const peak = s * 0.40; // ring radius
    const width = s * 0.085; // ring half-thickness (soft)
    const img = ctx.createImageData(s, s);
    const data = img.data;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cx;
        const r = Math.sqrt(dx * dx + dy * dy);
        const d = (r - peak) / width;
        const a = Math.exp(-d * d) * 255;
        const i = (y * s + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 255;
        data[i + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/**
 * AoE telegraph reticle: a faint filled danger zone, a crisp outer rim, a thin
 * inner ring, segmented dashes around the rim and four cardinal crosshair ticks.
 * Reads as an intentional "incoming AoE" marker rather than a flat plate.
 */
export function telegraphTexture(): THREE.CanvasTexture {
  return make("telegraph", 256, (ctx, s) => {
    const cx = s / 2;
    const R = s * 0.46;
    ctx.clearRect(0, 0, s, s);

    // Faint filled danger zone (radial, fading to the rim).
    const fill = ctx.createRadialGradient(cx, cx, 0, cx, cx, R);
    fill.addColorStop(0, "rgba(255,255,255,0.10)");
    fill.addColorStop(0.7, "rgba(255,255,255,0.16)");
    fill.addColorStop(1, "rgba(255,255,255,0.28)");
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(cx, cx, R, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineCap = "round";

    // Crisp outer rim.
    ctx.lineWidth = s * 0.022;
    ctx.beginPath();
    ctx.arc(cx, cx, R * 0.97, 0, Math.PI * 2);
    ctx.stroke();

    // Thin inner ring.
    ctx.lineWidth = s * 0.012;
    ctx.beginPath();
    ctx.arc(cx, cx, R * 0.62, 0, Math.PI * 2);
    ctx.stroke();

    // Segmented dashes hugging the rim.
    ctx.lineWidth = s * 0.05;
    const seg = 24;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / seg * 0.45;
      ctx.beginPath();
      ctx.arc(cx, cx, R * 0.85, a0, a1);
      ctx.stroke();
    }

    // Cardinal crosshair ticks reaching past the rim.
    ctx.lineWidth = s * 0.016;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(cx + dx * R * 0.9, cx + dy * R * 0.9);
      ctx.lineTo(cx + dx * R * 1.04, cx + dy * R * 1.04);
      ctx.stroke();
    }
  });
}

/**
 * Magic-circle rune ring for status auras: a thin solid inner ring, a dashed
 * outer ring and short radial spokes between them.
 */
export function runeRingTexture(): THREE.CanvasTexture {
  return make("runeRing", 256, (ctx, s) => {
    const cx = s / 2;
    const R = s * 0.46;
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineCap = "butt";

    // Solid inner ring.
    ctx.lineWidth = s * 0.014;
    ctx.beginPath();
    ctx.arc(cx, cx, R * 0.66, 0, Math.PI * 2);
    ctx.stroke();

    // Dashed outer ring.
    ctx.lineWidth = s * 0.055;
    const seg = 32;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / seg * 0.5;
      ctx.beginPath();
      ctx.arc(cx, cx, R * 0.9, a0, a1);
      ctx.stroke();
    }

    // Radial spokes bridging the two rings.
    ctx.lineWidth = s * 0.01;
    const spokes = 12;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(cx + dx * R * 0.68, cx + dy * R * 0.68);
      ctx.lineTo(cx + dx * R * 0.86, cx + dy * R * 0.86);
      ctx.stroke();
    }
  });
}

/** A unit XZ-plane (1×1, lying flat, centred) shared by flat ground decals. */
let UNIT_PLANE: THREE.PlaneGeometry | null = null;
export function unitGroundPlane(): THREE.PlaneGeometry {
  if (!UNIT_PLANE) {
    UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
    UNIT_PLANE.rotateX(-Math.PI / 2);
  }
  return UNIT_PLANE;
}
