/**
 * Blockbench (`.bbmodel` / `.bb`) → THREE.Group importer.
 *
 * Blockbench boxy models are a JSON document of cube `elements` (axis-aligned
 * `from`/`to` corners in 1/16 units, optional pivot rotation) whose six faces
 * carry pixel-space UVs into one of the base64 PNG `textures`. We rebuild each
 * cube as a `BoxGeometry`, remap its per-face UVs onto the referenced texture,
 * apply element rotation about its origin, then recentre the whole model on the
 * ground so it drops into the editor at a sane place/scale.
 *
 * Self-contained — no `@workspace/*` imports (artifact rule). Mesh-type elements
 * and per-face UV rotation are not reconstructed (rare for boxy art).
 */
import * as THREE from "three";

interface BBFace {
  uv?: [number, number, number, number];
  texture?: number | null;
}
interface BBElement {
  name?: string;
  type?: string;
  from?: [number, number, number];
  to?: [number, number, number];
  inflate?: number;
  rotation?: [number, number, number];
  origin?: [number, number, number];
  faces?: Partial<Record<"north" | "south" | "east" | "west" | "up" | "down", BBFace>>;
}
interface BBTexture {
  name?: string;
  source?: string;
}
interface BBModel {
  resolution?: { width?: number; height?: number };
  elements?: BBElement[];
  textures?: BBTexture[];
}

// three's BoxGeometry orders its six material groups +X,-X,+Y,-Y,+Z,-Z.
// Blockbench names them by world direction → map each to a group index.
const FACE_TO_GROUP: Record<string, number> = {
  east: 0, // +X
  west: 1, // -X
  up: 2, // +Y
  down: 3, // -Y
  south: 4, // +Z
  north: 5, // -Z
};

function loadTexture(dataUrl: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      dataUrl,
      (tex) => {
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

/** Overwrite the 4 UVs of one BoxGeometry face from a Blockbench pixel-space rect. */
function setFaceUv(
  geo: THREE.BoxGeometry,
  group: number,
  uv: [number, number, number, number],
  texW: number,
  texH: number,
) {
  const attr = geo.getAttribute("uv") as THREE.BufferAttribute;
  const u1 = uv[0] / texW;
  const u2 = uv[2] / texW;
  const v1 = 1 - uv[1] / texH;
  const v2 = 1 - uv[3] / texH;
  const base = group * 4;
  // BoxGeometry face vertex order: TL, TR, BL, BR (v=1 is the top of the image).
  attr.setXY(base + 0, u1, v1);
  attr.setXY(base + 1, u2, v1);
  attr.setXY(base + 2, u1, v2);
  attr.setXY(base + 3, u2, v2);
  attr.needsUpdate = true;
}

/** Parse a Blockbench model document into a ready-to-add THREE.Group. */
export async function parseBBModel(text: string): Promise<THREE.Group> {
  const doc = JSON.parse(text) as BBModel;
  const texW = doc.resolution?.width ?? 16;
  const texH = doc.resolution?.height ?? 16;

  // Build a material per texture (pixel-art lit), plus a neutral fallback.
  const textures = doc.textures ?? [];
  const materials: THREE.MeshStandardMaterial[] = [];
  for (const t of textures) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, transparent: true, alphaTest: 0.5 });
    if (t.source && t.source.startsWith("data:")) {
      try {
        mat.map = await loadTexture(t.source);
      } catch {
        /* keep the untextured material */
      }
    }
    materials.push(mat);
  }
  const fallback = new THREE.MeshStandardMaterial({ color: 0x9aa6b8, roughness: 0.8, metalness: 0 });
  const materialFor = (idx: number | null | undefined): THREE.MeshStandardMaterial =>
    idx != null && materials[idx] ? materials[idx] : fallback;

  const root = new THREE.Group();
  root.name = "Blockbench Model";
  const S = 1 / 16; // Blockbench works in sixteenths of a block

  for (const el of doc.elements ?? []) {
    if ((el.type ?? "cube") !== "cube" || !el.from || !el.to) continue;
    const inf = el.inflate ?? 0;
    const fx = Math.min(el.from[0], el.to[0]) - inf;
    const fy = Math.min(el.from[1], el.to[1]) - inf;
    const fz = Math.min(el.from[2], el.to[2]) - inf;
    const tx = Math.max(el.from[0], el.to[0]) + inf;
    const ty = Math.max(el.from[1], el.to[1]) + inf;
    const tz = Math.max(el.from[2], el.to[2]) + inf;

    const w = Math.max(tx - fx, 0.001) * S;
    const h = Math.max(ty - fy, 0.001) * S;
    const d = Math.max(tz - fz, 0.001) * S;
    const geo = new THREE.BoxGeometry(w, h, d);

    // Assemble the 6-slot material array and remap each present face's UVs.
    const faces = el.faces ?? {};
    const matList: THREE.MeshStandardMaterial[] = new Array(6).fill(fallback);
    for (const [dir, face] of Object.entries(faces)) {
      const group = FACE_TO_GROUP[dir];
      if (group === undefined || !face) continue;
      matList[group] = materialFor(face.texture);
      if (face.uv) setFaceUv(geo, group, face.uv, texW, texH);
    }

    const mesh = new THREE.Mesh(geo, matList);
    mesh.name = el.name ?? "cube";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const cx = ((fx + tx) / 2) * S;
    const cy = ((fy + ty) / 2) * S;
    const cz = ((fz + tz) / 2) * S;

    if (el.rotation && el.origin && (el.rotation[0] || el.rotation[1] || el.rotation[2])) {
      // Rotate about the element's pivot: pivot group at origin, mesh offset into it.
      const pivot = new THREE.Group();
      pivot.position.set(el.origin[0] * S, el.origin[1] * S, el.origin[2] * S);
      pivot.rotation.set(
        THREE.MathUtils.degToRad(el.rotation[0]),
        THREE.MathUtils.degToRad(el.rotation[1]),
        THREE.MathUtils.degToRad(el.rotation[2]),
      );
      mesh.position.set(cx - el.origin[0] * S, cy - el.origin[1] * S, cz - el.origin[2] * S);
      pivot.add(mesh);
      root.add(pivot);
    } else {
      mesh.position.set(cx, cy, cz);
      root.add(mesh);
    }
  }

  // Recentre on X/Z and sit the model on the ground (min.y = 0).
  const box = new THREE.Box3().setFromObject(root);
  if (Number.isFinite(box.min.x)) {
    const center = box.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -box.min.y, -center.z);
  }
  return root;
}
