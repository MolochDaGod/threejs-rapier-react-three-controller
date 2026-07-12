// Weapon / accessory GLB pipeline.
//
// Turns a raw weapon or accessory model (FBX or GLB/glTF) into a clean,
// self-contained .glb under artifacts/animator/public/models/weapons/ that the
// Animator's weapon mounter (`Weapons.ts` normalizeModel) can load. The mounter
// already auto-reorients/uniform-fits/anchors at load time, so this converter
// does NOT scale or re-root — it only converts format, re-attaches an external
// texture atlas when given (FBX texture bytes can't be decoded in Node), and
// runs metalRough/prune/dedup so the output renders correctly and stays small.
//
// Usage:
//   node scripts/src/convert-weapon.mjs <input.fbx|.glb|.gltf> <outId> [texturePng]
//
// Examples:
//   node scripts/src/convert-weapon.mjs in/_bow_1.fbx bow-recurve in/atlas.png
//   node scripts/src/convert-weapon.mjs in/mace.glb mace-flanged

import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup, metalRough, textureCompress } from "@gltf-transform/functions";

const MODELS_DIR = path.resolve(
  import.meta.dirname,
  "../../artifacts/animator/public/models",
);

const [, , inputArg, outId, texArg] = process.argv;
if (!inputArg || !outId) {
  console.error("usage: convert-weapon <input.fbx|.glb|.gltf> <weapons/id|gear/id> [texturePng]");
  process.exit(1);
}
const inputPath = path.resolve(inputArg);
if (!fs.existsSync(inputPath)) {
  console.error("input not found:", inputPath);
  process.exit(1);
}
const texPath = texArg ? path.resolve(texArg) : null;
if (texPath && !fs.existsSync(texPath)) {
  console.error("texture not found:", texPath);
  process.exit(1);
}

const ext = path.extname(inputPath).toLowerCase();
const outPath = path.join(MODELS_DIR, `${outId}.glb`);

async function main() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  let doc;
  if (ext === ".fbx") {
    doc = await io.readBinary(await fbxToGlb(inputPath));
  } else {
    doc = await io.read(inputPath);
  }

  await doc.transform(metalRough());

  // Re-attach an external texture atlas (FBX) onto every material's base colour.
  if (texPath) {
    const bytes = new Uint8Array(fs.readFileSync(texPath));
    const mime = texPath.toLowerCase().endsWith(".jpg") || texPath.toLowerCase().endsWith(".jpeg")
      ? "image/jpeg"
      : "image/png";
    const tex = doc.createTexture(path.basename(texPath)).setImage(bytes).setMimeType(mime);
    for (const mat of doc.getRoot().listMaterials()) {
      mat.setBaseColorTexture(tex);
      mat.setBaseColorFactor([1, 1, 1, 1]);
      mat.setMetallicFactor(0);
      mat.setRoughnessFactor(0.85);
    }
    console.log(`  texture: re-attached ${path.basename(texPath)} to ${doc.getRoot().listMaterials().length} material(s)`);
  }

  await prune(doc);
  await dedup(doc);

  // Shrink heavy PBR atlases so accessories/weapons stay lightweight.
  if (doc.getRoot().listTextures().length > 0) {
    const sharp = (await import("sharp")).default;
    await doc.transform(
      textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 85 }),
    );
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await io.write(outPath, doc);

  const size = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`✓ ${outPath} (${size} KB, ${doc.getRoot().listMeshes().length} meshes)`);
}

// --------------------------------------------------------------- FBX -> GLB
async function fbxToGlb(fbxPath) {
  installDomShims();
  const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");

  const buf = fs.readFileSync(fbxPath);
  const arr = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const group = new FBXLoader().parse(arr, path.dirname(fbxPath) + path.sep);

  // Node can't decode embedded FBX image bytes; drop empty map slots so the
  // exporter doesn't choke (we re-attach a real atlas via gltf-transform after).
  const MAPS = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "specularMap", "bumpMap", "alphaMap", "displacementMap"];
  group.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      for (const k of MAPS) {
        const t = m[k];
        if (t && (!t.image || !t.image.width)) m[k] = null;
      }
      m.needsUpdate = true;
    }
  });

  const out = await new Promise((res, rej) =>
    new GLTFExporter().parse(group, res, rej, { binary: true, animations: [] }),
  );
  return new Uint8Array(out);
}

function installDomShims() {
  globalThis.self ??= globalThis;
  globalThis.window ??= globalThis;
  globalThis.URL.createObjectURL ??= () => "blob:fbx";
  globalThis.URL.revokeObjectURL ??= () => {};
  globalThis.Blob ??= class Blob {
    constructor(parts = []) {
      const chunks = parts.map((p) =>
        p instanceof ArrayBuffer
          ? new Uint8Array(p)
          : ArrayBuffer.isView(p)
            ? new Uint8Array(p.buffer, p.byteOffset, p.byteLength)
            : new Uint8Array(0),
      );
      this.size = chunks.reduce((n, c) => n + c.length, 0);
      this._bytes = new Uint8Array(this.size);
      let off = 0;
      for (const c of chunks) {
        this._bytes.set(c, off);
        off += c.length;
      }
    }
    arrayBuffer() {
      return Promise.resolve(this._bytes.buffer);
    }
  };
  globalThis.FileReader ??= class FileReader {
    readAsArrayBuffer(blob) {
      Promise.resolve(blob.arrayBuffer()).then((buf) => {
        this.result = buf;
        this.onloadend?.();
        this.onload?.();
      });
    }
  };
  const fakeCtx = { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }), fillRect() {}, putImageData() {} };
  const fakeCanvas = () => ({
    getContext: () => fakeCtx,
    width: 1,
    height: 1,
    toDataURL: () => "data:,",
    toBlob: (cb) => cb(new globalThis.Blob()),
    style: {},
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.document ??= { createElement: () => fakeCanvas(), createElementNS: () => fakeCanvas() };
  globalThis.HTMLCanvasElement ??= class {};
  globalThis.ImageData ??= class { constructor() { this.data = []; } };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
