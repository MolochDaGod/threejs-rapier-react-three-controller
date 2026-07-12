import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { asset, getWeapon } from "./assets";
import { WEAPON_GRIPS } from "./arsenal";
import { ELEMENT_THEME } from "./arsenal/elements";
import { resolveHitShape } from "./arsenal/holdStyle";
import { PORTRAIT_OMIT_FLAG } from "./targetPortraits";
import type { ModelForward, WeaponDef, WeaponId, WeaponModelPiece } from "./types";

export interface MountedWeapon {
  objects: THREE.Object3D[];
  geos: THREE.BufferGeometry[];
  mats: THREE.Material[];
  /** Local-space tip of the main weapon (for trails). */
  tip: THREE.Object3D | null;
  /**
   * Cutting-edge anchors of the MAIN weapon's blade capsule (guard end `edgeA`,
   * tip end `edgeB`), children of the main mount group so they ride its world
   * transform. Read their world positions each frame to sweep the blade. `null`
   * for weapons that swing no blade (ranged/magic/unarmed).
   */
  edgeA: THREE.Object3D | null;
  edgeB: THREE.Object3D | null;
  /** Blade capsule radius (metres) around the edge segment. */
  edgeRadius: number;
  /**
   * Mesh-fitted collider profile of the MAIN weapon in its mount-local frame:
   * slices along the blade axis, each with its own XZ centre + radius, so the
   * collider hugs the real geometry (thin blade, wide guard, offset axe head)
   * instead of one arbitrary cylinder. `null` when no blade or fit failed.
   */
  profile: ColliderSlice[] | null;
}

/** One slice of a mesh-fitted weapon collider (mount-local frame, y = blade axis). */
export interface ColliderSlice {
  y: number;
  cx: number;
  cz: number;
  r: number;
}

function emptyMount(): MountedWeapon {
  return { objects: [], geos: [], mats: [], tip: null, edgeA: null, edgeB: null, edgeRadius: 0, profile: null };
}

/**
 * Sample the mounted weapon's actual geometry (in the mount group's local frame)
 * and fit a sliced radial profile along the blade axis (+Y). Points are taken
 * along triangle EDGES (long edges subdivided per slice) — not just vertices —
 * so low-poly primitives (a 1m blade box has corners only at its ends) still
 * profile correctly. Each slice keeps its own XZ centre and max radius, so the
 * result wraps the true silhouette.
 */
function fitMeshProfile(group: THREE.Object3D, slices = 24): ColliderSlice[] | null {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  type Src = { pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; index: THREE.BufferAttribute | null; mtx: THREE.Matrix4 };
  const srcs: Src[] = [];
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const pos = mesh.geometry.getAttribute("position");
    if (!pos) return;
    rel.multiplyMatrices(inv, mesh.matrixWorld);
    srcs.push({ pos, index: mesh.geometry.getIndex(), mtx: rel.clone() });
  });
  if (srcs.length === 0) return null;

  // Pass 1: bounds from (strided) raw vertices.
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const s of srcs) {
    const stride = Math.max(1, Math.floor(s.pos.count / 3000));
    for (let i = 0; i < s.pos.count; i += stride) {
      va.fromBufferAttribute(s.pos, i).applyMatrix4(s.mtx);
      if (va.y < yMin) yMin = va.y;
      if (va.y > yMax) yMax = va.y;
    }
  }
  const span = yMax - yMin;
  if (!(span > 1e-3)) return null;

  const n = Math.max(4, slices);
  const binH = span / n;
  const bins = Array.from({ length: n }, () => ({ sx: 0, sz: 0, c: 0, r: 0, pts: [] as number[] }));
  const binOf = (y: number) => Math.min(n - 1, Math.max(0, Math.floor((y - yMin) / binH)));
  let budget = 24000;
  const addPt = (x: number, y: number, z: number) => {
    const b = bins[binOf(y)];
    b.sx += x;
    b.sz += z;
    b.c++;
    b.pts.push(x, z);
    budget--;
  };

  // Pass 2: walk triangle edges, subdividing edges that span multiple slices.
  for (const s of srcs) {
    const triCount = Math.floor((s.index ? s.index.count : s.pos.count) / 3);
    const stride = Math.max(1, Math.ceil(triCount / 2500));
    const idx = (k: number) => (s.index ? s.index.getX(k) : k);
    for (let t = 0; t < triCount && budget > 0; t += stride) {
      for (let e = 0; e < 3 && budget > 0; e++) {
        const i0 = idx(t * 3 + e);
        const i1 = idx(t * 3 + ((e + 1) % 3));
        va.fromBufferAttribute(s.pos, i0).applyMatrix4(s.mtx);
        vb.fromBufferAttribute(s.pos, i1).applyMatrix4(s.mtx);
        addPt(va.x, va.y, va.z);
        const steps = Math.min(48, Math.floor(Math.abs(vb.y - va.y) / binH));
        for (let k = 1; k <= steps && budget > 0; k++) {
          const f = k / (steps + 1);
          addPt(va.x + (vb.x - va.x) * f, va.y + (vb.y - va.y) * f, va.z + (vb.z - va.z) * f);
        }
      }
    }
  }

  for (const b of bins) {
    if (b.c === 0) continue;
    b.sx /= b.c;
    b.sz /= b.c;
    for (let i = 0; i < b.pts.length; i += 2) {
      const dx = b.pts[i] - b.sx;
      const dz = b.pts[i + 1] - b.sz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > b.r) b.r = d;
    }
    b.pts.length = 0;
  }

  // Fill interior gaps by lerping between populated neighbours (bounds bins are
  // always populated since they contain the extreme vertices).
  const out: ColliderSlice[] = [];
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (bins[i].c === 0) continue;
    if (prev >= 0 && i - prev > 1) {
      const a = bins[prev];
      const b = bins[i];
      for (let k = prev + 1; k < i; k++) {
        const f = (k - prev) / (i - prev);
        out.push({
          y: yMin + (k + 0.5) * binH,
          cx: a.sx + (b.sx - a.sx) * f,
          cz: a.sz + (b.sz - a.sz) * f,
          r: Math.max(0.008, a.r + (b.r - a.r) * f),
        });
      }
    }
    out.push({ y: yMin + (i + 0.5) * binH, cx: bins[i].sx, cz: bins[i].sz, r: Math.max(0.008, bins[i].r) });
    prev = i;
  }
  return out.length >= 2 ? out : null;
}

/**
 * Attach the resolved blade-edge anchors to the main mount group. A hand-authored
 * `hit` shape wins verbatim; otherwise the capsule is FITTED TO THE ACTUAL MESH —
 * the mounted geometry is sliced along the blade axis and the swept segment's
 * centreline + radius come from the real silhouette (an axe's capsule leans into
 * its head; a rapier's stays needle-thin) instead of one stock group radius.
 */
function addEdgeAnchors(m: MountedWeapon, parent: THREE.Object3D, def: WeaponDef): void {
  if (!m.tip) return;
  const shape = resolveHitShape(def, m.tip.position.length());
  if (!shape) return;
  const fit = fitMeshProfile(parent);
  m.profile = fit;
  let ax = shape.a;
  let bx = shape.b;
  let radius = shape.radius;
  if (!def.hit && fit) {
    const startY = shape.a[1];
    const blade = fit.filter((s) => s.y >= startY - 1e-3);
    if (blade.length >= 2) {
      const topY = Math.max(shape.b[1], blade[blade.length - 1].y);
      let cx = 0;
      let cz = 0;
      let maxR = 0;
      for (const s of blade) {
        cx += s.cx;
        cz += s.cz;
        if (s.r > maxR) maxR = s.r;
      }
      cx /= blade.length;
      cz /= blade.length;
      ax = [cx, startY, cz];
      bx = [cx, topY, cz];
      // Small gameplay pad so razor-thin blades still register clean hits.
      radius = Math.min(0.45, Math.max(0.05, maxR + 0.02));
    }
  }
  const a = new THREE.Object3D();
  a.position.set(ax[0], ax[1], ax[2]);
  parent.add(a);
  const b = new THREE.Object3D();
  b.position.set(bx[0], bx[1], bx[2]);
  parent.add(b);
  m.edgeA = a;
  m.edgeB = b;
  m.edgeRadius = radius;
}

function track(m: MountedWeapon, parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  m.geos.push(geo);
  m.mats.push(mat);
  parent.add(mesh);
  return mesh;
}

const STEEL = () => new THREE.MeshStandardMaterial({ color: 0xcfd6e0, metalness: 0.7, roughness: 0.3 });
const DARK_STEEL = () => new THREE.MeshStandardMaterial({ color: 0x6a7280, metalness: 0.8, roughness: 0.35 });
const GRIP = () => new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 0.85 });
const WOOD = () => new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.8 });
const GOLD = () => new THREE.MeshStandardMaterial({ color: 0xe2b13c, metalness: 0.9, roughness: 0.3 });

function addTip(m: MountedWeapon, g: THREE.Group, y: number): void {
  const tip = new THREE.Object3D();
  tip.position.set(0, y, 0);
  g.add(tip);
  m.tip = tip;
}

function buildSword(m: MountedWeapon): THREE.Group {
  const g = new THREE.Group();
  const blade = track(m, g, new THREE.BoxGeometry(0.08, 1.0, 0.02), STEEL());
  blade.position.y = 0.62;
  const guard = track(m, g, new THREE.BoxGeometry(0.3, 0.06, 0.06), GOLD());
  guard.position.y = 0.12;
  track(m, g, new THREE.BoxGeometry(0.05, 0.22, 0.05), GRIP()).position.y = 0;
  addTip(m, g, 1.12);
  return g;
}

function buildGreatsword(m: MountedWeapon): THREE.Group {
  const g = new THREE.Group();
  const blade = track(m, g, new THREE.BoxGeometry(0.14, 1.5, 0.03), STEEL());
  blade.position.y = 0.95;
  const guard = track(m, g, new THREE.BoxGeometry(0.42, 0.08, 0.08), DARK_STEEL());
  guard.position.y = 0.18;
  track(m, g, new THREE.BoxGeometry(0.06, 0.34, 0.06), GRIP()).position.y = 0;
  addTip(m, g, 1.7);
  return g;
}

function buildAxe(m: MountedWeapon): THREE.Group {
  const g = new THREE.Group();
  track(m, g, new THREE.CylinderGeometry(0.04, 0.04, 1.0, 8), WOOD()).position.y = 0.5;
  const head = track(m, g, new THREE.BoxGeometry(0.04, 0.32, 0.4), STEEL());
  head.position.set(0, 0.9, 0.12);
  addTip(m, g, 1.0);
  return g;
}

function buildDagger(m: MountedWeapon): THREE.Group {
  const g = new THREE.Group();
  const blade = track(m, g, new THREE.BoxGeometry(0.05, 0.34, 0.015), STEEL());
  blade.position.y = 0.27;
  track(m, g, new THREE.BoxGeometry(0.14, 0.04, 0.05), GOLD()).position.y = 0.1;
  track(m, g, new THREE.BoxGeometry(0.045, 0.18, 0.045), GRIP()).position.y = 0;
  addTip(m, g, 0.45);
  return g;
}

function buildSpear(m: MountedWeapon): THREE.Group {
  const g = new THREE.Group();
  track(m, g, new THREE.CylinderGeometry(0.035, 0.035, 1.9, 8), WOOD()).position.y = 0.8;
  const headGeo = new THREE.ConeGeometry(0.07, 0.34, 8);
  const head = track(m, g, headGeo, STEEL());
  head.position.y = 1.9;
  addTip(m, g, 2.05);
  return g;
}

function buildHammer(m: MountedWeapon): THREE.Group {
  const g = new THREE.Group();
  track(m, g, new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8), GRIP()).position.y = 0.55;
  const head = track(m, g, new THREE.BoxGeometry(0.42, 0.34, 0.34), DARK_STEEL());
  head.position.y = 1.05;
  addTip(m, g, 1.1);
  return g;
}

function buildBow(m: MountedWeapon): THREE.Group {
  const g = new THREE.Group();
  track(m, g, new THREE.BoxGeometry(0.05, 1.2, 0.05), WOOD()).position.y = 0.2;
  const top = track(m, g, new THREE.BoxGeometry(0.04, 0.32, 0.04), WOOD());
  top.position.set(0.06, 0.78, 0);
  top.rotation.z = 0.5;
  const bot = track(m, g, new THREE.BoxGeometry(0.04, 0.32, 0.04), WOOD());
  bot.position.set(0.06, -0.38, 0);
  bot.rotation.z = -0.5;
  const stringMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.6 });
  const str = track(m, g, new THREE.BoxGeometry(0.01, 1.25, 0.01), stringMat);
  str.position.set(0.1, 0.2, 0);
  addTip(m, g, 0.8);
  return g;
}

function buildStaff(m: MountedWeapon): THREE.Group {
  const g = new THREE.Group();
  track(m, g, new THREE.CylinderGeometry(0.035, 0.045, 1.5, 8), WOOD()).position.y = 0.6;
  const gem = new THREE.MeshStandardMaterial({ color: 0x9b6fff, emissive: 0x6a2aff, emissiveIntensity: 1.4, roughness: 0.2 });
  const orb = track(m, g, new THREE.IcosahedronGeometry(0.13, 0), gem);
  orb.position.y = 1.45;
  addTip(m, g, 1.45);
  return g;
}

function buildPistol(m: MountedWeapon): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2e35, metalness: 0.7, roughness: 0.35 });
  const body = track(m, g, new THREE.BoxGeometry(0.06, 0.12, 0.26), metal);
  body.position.set(0, 0.04, 0.1);
  track(m, g, new THREE.BoxGeometry(0.05, 0.16, 0.08), GRIP()).position.set(0, -0.06, -0.02);
  const barrel = track(m, g, new THREE.CylinderGeometry(0.015, 0.015, 0.16, 8), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.06, 0.26);
  addTip(m, g, 0); // muzzle handled via skill origin
  m.tip!.position.set(0, 0.06, 0.34);
  return g;
}

function buildRifle(m: MountedWeapon): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x33363d, metalness: 0.6, roughness: 0.4 });
  const body = track(m, g, new THREE.BoxGeometry(0.07, 0.1, 0.6), metal);
  body.position.set(0, 0.02, 0.2);
  const barrel = track(m, g, new THREE.CylinderGeometry(0.02, 0.02, 0.4, 10), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.04, 0.5);
  track(m, g, new THREE.BoxGeometry(0.06, 0.14, 0.18), GRIP()).position.set(0, -0.02, -0.12);
  addTip(m, g, 0);
  m.tip!.position.set(0, 0.04, 0.72);
  return g;
}

function buildShield(m: MountedWeapon): THREE.Group {
  const g = new THREE.Group();
  const body = track(m, g, new THREE.BoxGeometry(0.5, 0.7, 0.06), DARK_STEEL());
  body.position.set(0, 0.1, 0);
  const boss = track(m, g, new THREE.CylinderGeometry(0.1, 0.1, 0.08, 12), GOLD());
  boss.rotation.x = Math.PI / 2;
  boss.position.set(0, 0.1, 0.06);
  addTip(m, g, 0.4);
  return g;
}

const BUILDERS: Partial<Record<WeaponId, (m: MountedWeapon) => THREE.Group>> = {
  sword: buildSword,
  greatsword: buildGreatsword,
  axe: buildAxe,
  dagger: buildDagger,
  spear: buildSpear,
  hammer: buildHammer,
  // Recombined melee roster reuses the closest primitive for the GLB fallback.
  mace: buildHammer,
  greataxe: buildAxe,
  hammer2h: buildHammer,
  bow: buildBow,
  staff: buildStaff,
  pistol: buildPistol,
  rifle: buildRifle,
  shield: buildShield,
};

// --------------------------------------------------------------- grip transforms

type Grip = { rot: [number, number, number]; pos: [number, number, number] };

// Per-weapon grip orientation is co-located with each prefab in `arsenal/`; the
// derived `WEAPON_GRIPS` table fits both the GLB-model mount path and the
// procedural-primitive fallback (one hold for both rigs).
const GRIPS = WEAPON_GRIPS;

function applyGrip(group: THREE.Object3D, grip: Grip) {
  group.rotation.set(grip.rot[0], grip.rot[1], grip.rot[2]);
  group.position.set(grip.pos[0], grip.pos[1], grip.pos[2]);
}

// ----------------------------------------------------------------- GLB templates

const AXIS: Record<ModelForward, THREE.Vector3> = {
  "x+": new THREE.Vector3(1, 0, 0),
  "x-": new THREE.Vector3(-1, 0, 0),
  "y+": new THREE.Vector3(0, 1, 0),
  "y-": new THREE.Vector3(0, -1, 0),
  "z+": new THREE.Vector3(0, 0, 1),
  "z-": new THREE.Vector3(0, 0, -1),
};

const templateCache = new Map<string, Promise<THREE.Object3D>>();

/** Load a weapon GLB once (cached); voxel textures get crisp NearestFilter. */
function loadTemplate(file: string): Promise<THREE.Object3D> {
  let p = templateCache.get(file);
  if (!p) {
    p = new GLTFLoader().loadAsync(asset(file)).then((gltf) => {
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          const map = (mat as THREE.MeshStandardMaterial)?.map;
          if (map) {
            map.magFilter = THREE.NearestFilter;
            map.minFilter = THREE.NearestFilter;
            map.generateMipmaps = false;
            map.needsUpdate = true;
          }
        }
      });
      return gltf.scene;
    });
    templateCache.set(file, p);
  }
  return p;
}

/**
 * Clone a template, reorient `forward` onto the align axis, uniform-fit the
 * longest axis to `length`, and anchor it. Geometry + textures stay shared with
 * the template; only the per-mount cloned materials are returned for disposal.
 */
function normalizeModel(template: THREE.Object3D, piece: WeaponModelPiece): { group: THREE.Group; mats: THREE.Material[] } {
  const inner = template.clone(true);
  const mats: THREE.Material[] = [];
  inner.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const src = mesh.material;
    if (Array.isArray(src)) {
      const cloned = src.map((x) => x.clone());
      mesh.material = cloned;
      mats.push(...cloned);
    } else if (src) {
      const cloned = src.clone();
      mesh.material = cloned;
      mats.push(cloned);
    }
  });

  // Reorient the model's forward axis onto the mount's align axis.
  const to = piece.align === "z" ? AXIS["z+"] : AXIS["y+"];
  inner.quaternion.setFromUnitVectors(AXIS[piece.forward], to);
  inner.updateMatrixWorld(true);

  // Uniform-fit longest axis to the target length.
  let box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z) || 1;
  inner.scale.multiplyScalar(piece.length / longest);
  inner.updateMatrixWorld(true);

  // Anchor: `base` rests the bottom of the align axis at the grip; `center` centres.
  box = new THREE.Box3().setFromObject(inner);
  const center = box.getCenter(new THREE.Vector3());
  if (piece.anchor === "base") {
    if (piece.align === "z") inner.position.set(-center.x, -center.y, -box.min.z);
    else inner.position.set(-center.x, -box.min.y, -center.z);
  } else {
    inner.position.set(-center.x, -center.y, -center.z);
  }

  const group = new THREE.Group();
  group.add(inner);
  return { group, mats };
}

/** Tint a mount's cloned materials toward an element colour (emissive glow). */
function tintMats(mats: THREE.Material[], color: number): void {
  for (const mat of mats) {
    const std = mat as THREE.MeshStandardMaterial;
    if (!std.emissive) continue;
    std.emissive = new THREE.Color(color);
    std.emissiveIntensity = 0.85;
    std.needsUpdate = true;
  }
}

function modelTip(piece: WeaponModelPiece): THREE.Object3D {
  const tip = new THREE.Object3D();
  if (piece.align === "z") tip.position.set(0, 0, piece.anchor === "base" ? piece.length : piece.length / 2);
  else tip.position.set(0, piece.anchor === "base" ? piece.length : piece.length / 2, 0);
  return tip;
}

// ------------------------------------------------------------------- procedural

/** Procedural-primitive fallback when a weapon has no model (or its GLB fails). */
function mountWeaponProcedural(def: WeaponDef, rightHand: THREE.Object3D, leftHand: THREE.Object3D): MountedWeapon {
  const m = emptyMount();
  if (def.id === "none") return m;
  const builder = BUILDERS[def.id];
  if (!builder) return m;
  const grip = GRIPS[def.id];
  const mainHand = def.hand === "left" ? leftHand : rightHand;
  const offHand = def.hand === "left" ? rightHand : leftHand;

  const main = builder(m);
  if (grip) applyGrip(main, grip.main);
  addEdgeAnchors(m, main, def);
  mainHand.add(main);
  m.objects.push(main);

  // Sword & Knife: a small throwing knife rides the off-hand (mirrors the GLB
  // model path's dagger off-piece so the fallback keeps the same loadout identity).
  if (def.id === "sword") {
    const offKnife = buildDagger(m);
    offKnife.scale.setScalar(0.8);
    if (grip?.off) applyGrip(offKnife, grip.off);
    offHand.add(offKnife);
    m.objects.push(offKnife);
  }
  tagPortraitOmit(m);
  return m;
}

/**
 * Flag every mounted piece so HUD portrait captures prune it — a held blade or
 * staff would otherwise inflate the subject bounds and ruin the face crop.
 */
function tagPortraitOmit(m: MountedWeapon): void {
  for (const o of m.objects) o.userData[PORTRAIT_OMIT_FLAG] = true;
}

/**
 * Load + mount a weapon's real GLB model(s) onto the hand mounts. Models are
 * cached + cloned (geometry/textures shared, materials cloned per mount). Falls
 * back to the procedural primitive when a weapon has no model or its GLB fails.
 */
export async function mountWeaponModel(
  def: WeaponDef,
  rightHand: THREE.Object3D,
  leftHand: THREE.Object3D,
  tier = 0,
): Promise<MountedWeapon> {
  if (def.id === "none" || !def.model) return mountWeaponProcedural(def, rightHand, leftHand);

  const m = emptyMount();
  try {
    const mainHand = def.hand === "left" ? leftHand : rightHand;
    const offHand = def.hand === "left" ? rightHand : leftHand;
    const grip = GRIPS[def.id];

    // A tier may swap the main piece's model (and grip) for a distinct look while
    // keeping the weapon's off-hand piece, clip set, hold-style and skill.
    const tierDef = def.tiers?.[tier];
    const mainPiece = tierDef?.model ?? def.model.main;
    const mainGrip = tierDef?.grip ?? grip?.main;

    const mainTpl = await loadTemplate(mainPiece.file);
    const main = normalizeModel(mainTpl, mainPiece);
    // Elemental staffs share one cane skin pool, so tint each mount in its
    // school's colour (emissive glow) to read as fire/ice/storm/nature/holy.
    if (def.element) tintMats(main.mats, ELEMENT_THEME[def.element].color);
    if (mainGrip) applyGrip(main.group, mainGrip);
    const tip = modelTip(mainPiece);
    main.group.add(tip);
    m.tip = tip;
    addEdgeAnchors(m, main.group, def);
    mainHand.add(main.group);
    m.objects.push(main.group);
    m.mats.push(...main.mats);

    if (def.model.off) {
      const offTpl = await loadTemplate(def.model.off.file);
      const off = normalizeModel(offTpl, def.model.off);
      if (grip?.off) applyGrip(off.group, grip.off);
      offHand.add(off.group);
      m.objects.push(off.group);
      m.mats.push(...off.mats);
    }
    tagPortraitOmit(m);
    return m;
  } catch (err) {
    console.error(`[Weapons] model load failed for ${def.id}; using procedural`, err);
    unmountWeapon(m);
    return mountWeaponProcedural(def, rightHand, leftHand);
  }
}

/** Synchronous procedural mount, kept for callers that don't await a GLB. */
export function mountWeapon(id: WeaponId, rightHand: THREE.Object3D, leftHand: THREE.Object3D): MountedWeapon {
  return mountWeaponProcedural(getWeapon(id), rightHand, leftHand);
}

export function unmountWeapon(m: MountedWeapon) {
  for (const o of m.objects) o.removeFromParent();
  for (const g of m.geos) g.dispose();
  for (const mat of m.mats) mat.dispose();
  m.objects.length = 0;
  m.geos.length = 0;
  m.mats.length = 0;
  m.tip = null;
  m.edgeA = null;
  m.edgeB = null;
  m.edgeRadius = 0;
  m.profile = null;
}
