/**
 * Fine hair-strand rendering for the cube-head avatar.
 *
 * The composed head describes hair as chunky {@link ProtrusionBox}es (crown
 * slabs, curtains, ropes, tufts). To make hair read as *hair* instead of
 * plastic blocks, renderers draw each hair box with a pixel strand texture
 * (see {@link createHairBoxMaterial}) and overlay
 * it with thousands of fine strands — thin columns whose cross-section is 1/8
 * of one head pixel — packed into a single {@link THREE.InstancedMesh} (one
 * draw call). Strands get a sheen material so they catch light like hair, and
 * hanging strands sway on a small procedural pendulum (wind), which is the
 * whole "physics" model: cheap, deterministic, and stable.
 *
 * The descriptor generator is pure and THREE-free so it can be unit-tested;
 * only {@link createHairFx} touches the GPU.
 */
import * as THREE from "three";
import { FACE, cssHex, hash01, shade } from "./pixels";
import type { ProtrusionBox } from "./composeHead";
import { buildHairTexturePixels, hairTexSize, isFineHairBox } from "./hairTexture";

const P = 1 / FACE; // one head pixel in head units

/** Strand cross-section: 1/12 of one head pixel (finer filament overlay). */
export const STRAND_THICKNESS = P / 12;

/** Default hard cap on strand instances (one InstancedMesh draw call). */
export const MAX_STRANDS = 9000;

/** One textured hair-box material + the textures it owns. */
export interface HairBoxMaterial {
  mat: THREE.MeshPhysicalMaterial;
  dispose(): void;
}

/** Blit packed 0xRRGGBB pixels into a canvas via ImageData (fast at 512²). */
function pixelsToCanvas(pixels: number[], cols: number, rows: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(cols, rows);
    const data = img.data;
    for (let i = 0; i < pixels.length; i++) {
      const c = pixels[i];
      const o = i * 4;
      data[o] = (c >> 16) & 0xff;
      data[o + 1] = (c >> 8) & 0xff;
      data[o + 2] = c & 0xff;
      data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  return canvas;
}

/** Grayscale bump canvas from the same pixels: luminance = strand height. */
function pixelsToBumpCanvas(pixels: number[], cols: number, rows: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(cols, rows);
    const data = img.data;
    for (let i = 0; i < pixels.length; i++) {
      const c = pixels[i];
      const lum = Math.round(
        ((c >> 16) & 0xff) * 0.299 + ((c >> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114,
      );
      const o = i * 4;
      data[o] = data[o + 1] = data[o + 2] = lum;
      data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  return canvas;
}

/**
 * High-detail material for one hair/beard {@link ProtrusionBox}: a dense
 * deterministic strand texture (smooth-filtered + anisotropic, so grazing
 * angles stay crisp) with a luminance-derived bump map for strand relief,
 * clearcoat + sheen for fibre-scatter highlights, and a roughness map so
 * sheen lanes actually read as silkier strands. `seed` varies per box so
 * neighbouring boxes don't tile identically. The caller owns the handle:
 * `dispose()` frees the material and all textures.
 */
export function createHairBoxMaterial(box: ProtrusionBox, seed: number): HairBoxMaterial {
  // Non-braided hair/beard uses the FINE variant: denser filaments packed
  // into thick clumps. Fine boxes double their texel density (still clamped)
  // so even small boxes resolve individual filaments.
  const fine = isFineHairBox(box);
  const density = fine ? 2 : 1;
  const cols = hairTexSize(Math.max(box.w, box.d) * density);
  const rows = hairTexSize(Math.max(box.h, box.d) * density);
  const pixels = buildHairTexturePixels(
    box.color,
    cols,
    rows,
    seed,
    box.braided === true,
    fine,
  );

  const aniso = fine ? 16 : 8;
  const tex = new THREE.CanvasTexture(pixelsToCanvas(pixels, cols, rows));
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = aniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

  const bump = new THREE.CanvasTexture(pixelsToBumpCanvas(pixels, cols, rows));
  bump.magFilter = THREE.LinearFilter;
  bump.minFilter = THREE.LinearMipmapLinearFilter;
  bump.generateMipmaps = true;
  bump.anisotropy = aniso;
  bump.wrapS = bump.wrapT = THREE.ClampToEdgeWrapping;

  // Roughness map: lit/sheen texels stay glossier, grooves stay matte — keeps
  // the strand texture from reading as flat plastic under the key light.
  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = cols;
  roughCanvas.height = rows;
  const rctx = roughCanvas.getContext("2d");
  if (rctx) {
    const img = rctx.createImageData(cols, rows);
    const data = img.data;
    for (let i = 0; i < pixels.length; i++) {
      const c = pixels[i];
      const lum =
        ((c >> 16) & 0xff) * 0.299 + ((c >> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114;
      // brighter strand = lower roughness (silkier highlight)
      const rough = Math.min(255, Math.max(40, Math.round(255 - lum * 0.55)));
      const o = i * 4;
      data[o] = data[o + 1] = data[o + 2] = rough;
      data[o + 3] = 255;
    }
    rctx.putImageData(img, 0, 0);
  }
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.magFilter = THREE.LinearFilter;
  roughnessMap.minFilter = THREE.LinearMipmapLinearFilter;
  roughnessMap.generateMipmaps = true;
  roughnessMap.anisotropy = aniso;

  // Light face-framing hair (fringe/bangs) renders slightly translucent and
  // silkier so it reads as wisps over the brow, not a solid plank.
  const light = box.motion?.light === true;
  const sheenTint = new THREE.Color(shade(box.color, 1.5));
  // Warm secondary scatter so dark hair still picks up a soft rim, not pure
  // grey plastic sheen.
  sheenTint.lerp(new THREE.Color(0xfff0e0), 0.22);
  const mat = new THREE.MeshPhysicalMaterial({
    map: tex,
    bumpMap: bump,
    // Fine hair gets deeper relief so the thick clump grooves catch light.
    bumpScale: light ? 0.01 : fine ? 0.028 : 0.016,
    roughnessMap,
    roughness: light ? 0.36 : fine ? 0.4 : 0.48,
    metalness: 0,
    // Clearcoat = thin fibre coating / oil sheen on locks (not car-paint).
    clearcoat: light ? 0.14 : fine ? 0.28 : 0.18,
    clearcoatRoughness: light ? 0.45 : 0.52,
    // Hair's signature specular: soft sheen lobe + mild dielectric specular.
    sheen: 1,
    sheenRoughness: light ? 0.26 : fine ? 0.3 : 0.36,
    sheenColor: sheenTint,
    specularIntensity: light ? 0.55 : 0.72,
    ior: 1.55,
    transparent: light,
    opacity: light ? 0.88 : 1,
    // Translucent wisps must not write depth or they punch holes in the
    // hair/skin behind them at glancing camera angles.
    depthWrite: !light,
  });
  return {
    mat,
    dispose() {
      mat.dispose();
      tex.dispose();
      bump.dispose();
      roughnessMap.dispose();
    },
  };
}

/** One hair strand in head-unit space, anchored at its root (top). */
export interface StrandDescriptor {
  /** Root (top) of the strand; it hangs downward from here. */
  x: number;
  y: number;
  z: number;
  /** Length along -y. */
  len: number;
  /** Square cross-section edge. */
  thick: number;
  /** Static rest tilt (radians) around x/z. */
  tiltX: number;
  tiltZ: number;
  color: number;
  /** Wind phase offset so strands don't sway in lockstep. */
  phase: number;
  /** Sway amplitude in radians; 0 = static strand. */
  sway: number;
}

/**
 * Deterministically scatter strands across the top area of each hair box.
 * Strands hang from the box top with jittered position/length/tilt/shade so
 * the overlay reads organic while identical configs produce identical hair.
 * When the raw count would exceed `maxStrands`, strands are dropped by a
 * deterministic hash (organic thinning — no moiré stripes).
 */
export function buildStrandDescriptors(
  allBoxes: ProtrusionBox[],
  maxStrands = MAX_STRANDS,
): StrandDescriptor[] {
  // Braided volume (dread locks, beard braids) is tightly bound hair — loose
  // flyaway strands would blur the weave, so braids get none.
  const boxes = allBoxes.filter((b) => !b.braided);
  // Denser root grid = fuller filament shell without thicker plastic bars.
  const spacing = P / 5.5;
  // First pass: raw grid count so we can derive a deterministic keep-ratio.
  let raw = 0;
  const grids = boxes.map((b) => {
    const cols = Math.max(1, Math.round(b.w / spacing));
    const rows = Math.max(1, Math.round(b.d / spacing));
    raw += cols * rows;
    return { cols, rows };
  });
  const keep = raw > maxStrands ? maxStrands / raw : 1;

  const out: StrandDescriptor[] = [];
  boxes.forEach((b, bi) => {
    const { cols, rows } = grids[bi];
    const seed = bi * 131 + 17;
    const topY = b.y + b.h / 2;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (keep < 1 && hash01(i, j, seed + 8) > keep) continue;
        const jx = (hash01(i, j, seed) - 0.5) * spacing * 0.85;
        const jz = (hash01(i, j, seed + 1) - 0.5) * spacing * 0.85;
        const len = Math.max(P, b.h * (0.78 + hash01(i, j, seed + 2) * 0.52));
        const hang = len > 0.25;
        out.push({
          x: b.x - b.w / 2 + ((i + 0.5) * b.w) / cols + jx,
          y: topY,
          z: b.z - b.d / 2 + ((j + 0.5) * b.d) / rows + jz,
          len,
          thick: STRAND_THICKNESS * (0.85 + hash01(i, j, seed + 3) * 1.1),
          tiltX: (hash01(i, j, seed + 4) - 0.5) * 0.28,
          tiltZ: (hash01(i, j, seed + 5) - 0.5) * 0.28,
          color: shade(b.color, 0.8 + hash01(i, j, seed + 6) * 0.42),
          phase: hash01(i, j, seed + 7) * Math.PI * 2,
          // Long hanging strands sway in the wind; short scalp fuzz holds still.
          sway: hang ? Math.min(0.12, 0.028 + len * 0.1) : 0,
        });
      }
    }
  });
  return out;
}

/** Live hair overlay: one instanced mesh + a per-frame wind update. */
export interface HairFx {
  readonly object: THREE.Object3D;
  /** Advance the wind sway; `timeSec` is absolute time in seconds. */
  update(timeSec: number): void;
  dispose(): void;
}

/**
 * Build the strand overlay for the given hair boxes. Returns `null` when
 * there is nothing to grow (e.g. bald). The caller owns the returned handle:
 * add `object` to the head group and call `dispose()` on teardown.
 */
export function createHairFx(
  boxes: ProtrusionBox[],
  opts: { maxStrands?: number; castShadow?: boolean } = {},
): HairFx | null {
  const strands = buildStrandDescriptors(boxes, opts.maxStrands ?? MAX_STRANDS);
  if (strands.length === 0) return null;

  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, -0.5, 0); // origin at the strand root so rotation = pendulum
  const mat = new THREE.MeshPhysicalMaterial({
    roughness: 0.38,
    metalness: 0,
    clearcoat: 0.2,
    clearcoatRoughness: 0.48,
    sheen: 1,
    sheenRoughness: 0.28,
    sheenColor: new THREE.Color(0xe8d8c8),
    specularIntensity: 0.65,
    ior: 1.55,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, strands.length);
  mesh.name = "HairStrands";
  mesh.castShadow = opts.castShadow ?? false;
  // Strands poke past their conservative auto bounds when swaying; the head
  // is tiny on screen so skip per-frame bounds churn.
  mesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const swayIdx: number[] = [];
  const pose = (s: StrandDescriptor, rx: number, rz: number) => {
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(rx, 0, rz);
    dummy.scale.set(s.thick, s.len, s.thick);
    dummy.updateMatrix();
  };
  strands.forEach((s, i) => {
    pose(s, s.tiltX, s.tiltZ);
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.setHex(s.color));
    if (s.sway > 0) swayIdx.push(i);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  let disposed = false;
  return {
    object: mesh,
    update(timeSec: number) {
      if (disposed || swayIdx.length === 0) return;
      for (const i of swayIdx) {
        const s = strands[i];
        pose(
          s,
          s.tiltX + Math.sin(timeSec * 1.7 + s.phase) * s.sway,
          s.tiltZ + Math.cos(timeSec * 1.3 + s.phase) * s.sway * 0.7,
        );
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.parent?.remove(mesh);
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}
