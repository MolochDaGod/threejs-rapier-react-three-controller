// Mixamo-ready character GLB pipeline.
//
// Turns any raw humanoid model (FBX, GLB/glTF, or a .zip containing one) into a
// normalized, self-contained .glb that drops straight into the Animator as a
// playable character — replacing the procedural "green" placeholder rigs with
// real models.
//
// Usage:
//   pnpm --filter @workspace/scripts run convert-character <input> [outName]
//   node scripts/src/convert-character.mjs <input.fbx|.glb|.gltf|.zip> [outName]
//
// Every output GLB comes out:
//   - Converted to glTF/GLB        (FBX + zipped sources handled automatically)
//   - Scaled to the explorer's 2m height (canonical CHARACTER_HEIGHT_M)
//   - Rooted at the feet           (soles at Y=0, centred on X/Z)
//   - Skeleton renamed to mixamorig* so the shared FBX animation library
//     retargets onto it (same bone-name logic the runtime loader uses).
//
// FBX path: three.js FBXLoader -> GLTFExporter run under Node with DOM shims is
// used (there is no FBX2glTF binary in this environment and @gltf-transform
// cannot read FBX). Node cannot DECODE embedded FBX image bytes (no WebGL /
// createImageBitmap), so FBX texture maps that have no pixel data are dropped
// (base colour factors are kept) — convert from a GLB/glTF source if you need
// full texture fidelity. GLB/glTF inputs are read directly by @gltf-transform,
// which copies texture buffers verbatim, so their textures survive intact.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup, metalRough } from "@gltf-transform/functions";
import { unzipSync } from "fflate";

// ---------------------------------------------------------------------------
// Canonical fighter height. MIRRORS artifacts/animator/src/three/types.ts
// (`CHARACTER_HEIGHT_M = 2.0`). Scripts can't import app code; keep in sync.
// ---------------------------------------------------------------------------
const CHARACTER_HEIGHT_M = 2.0;

const MODELS_DIR = path.resolve(
  import.meta.dirname,
  "../../artifacts/animator/public/models",
);

// ---------------------------------------------------------------------------
// Bone-name mapping. MIRRORS artifacts/animator/src/three/retargetMap.ts
// (`canonicalSuffix`) so the converter renames a rig's bones to exactly the
// `mixamorig*` names the runtime retarget expects. Keep the two in lockstep.
// ---------------------------------------------------------------------------
const CANONICAL_SUFFIXES = [
  "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
  "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
  "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
];
const SUFFIX_BY_LOWER = new Map(CANONICAL_SUFFIXES.map((s) => [s.toLowerCase(), s]));

/** Reduce a raw bone name to its canonical Mixamo suffix, or null. */
function canonicalSuffix(raw) {
  let n = raw.replace(/^mixamorig:?/i, "");
  if (/^Spine0*1$|^Spine11$/i.test(n)) n = "Spine1";
  else if (/^Spine0*2$|^Spine21$/i.test(n)) n = "Spine2";
  else if (/^Spine$/i.test(n)) n = "Spine";
  else if (/^Neck\d*$/i.test(n)) n = "Neck";
  else if (/^Head\d*$/i.test(n)) n = "Head";
  else if (/^Hips\d*$/i.test(n)) n = "Hips";
  else n = n.replace(/\d+$/, "");
  return SUFFIX_BY_LOWER.get(n.toLowerCase()) ?? null;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const [, , inputArg, outNameArg] = process.argv;
if (!inputArg) {
  console.error(
    "usage: convert-character <input.fbx|.glb|.gltf|.zip> [outName]",
  );
  process.exit(1);
}
const inputPath = path.resolve(inputArg);
if (!fs.existsSync(inputPath)) {
  console.error("input not found:", inputPath);
  process.exit(1);
}

/** Sanitise a base file name into a safe lower-kebab id. */
function toId(name) {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-\d{6,}$/, "") || "character"; // drop trailing upload timestamps
}

const outId = toId(outNameArg ?? path.basename(inputPath));
const outPath = path.join(MODELS_DIR, `${outId}.glb`);

async function main() {
  console.log(`\n▶ convert-character`);
  console.log(`  input : ${inputPath}`);

  // 1) Resolve the model source (extract zips), then load into a gltf-transform
  //    Document (FBX is converted via three first).
  const { ext, source } = resolveSource(inputPath);
  console.log(`  source: ${path.basename(source)} (${ext})`);

  // Register all standard Khronos + vendor extensions so spec-gloss / other
  // extended GLB inputs can be READ (otherwise NodeIO throws on a required,
  // unregistered extension like KHR_materials_pbrSpecularGlossiness).
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  let doc;
  if (ext === ".fbx") {
    doc = await io.readBinary(await fbxToGlb(source));
  } else {
    doc = await io.read(source); // .glb / .gltf (external resources resolved)
  }

  // Convert legacy spec/gloss materials to metal/rough so they render correctly
  // (and drop the required extension) — a no-op for models that don't use it.
  await doc.transform(metalRough());

  const report = {
    inputType: ext,
    heightBefore: 0,
    heightAfter: 0,
    footOffset: 0,
    scaleFactor: 1,
    renamed: [],
    unmappedBones: [],
    missingBones: [],
    droppedPositionTracks: 0,
    clips: [],
  };

  // 2) Normalize: scale to 2m, feet at Y=0, centred on X/Z.
  normalize(doc, report);

  // 3) Skeleton -> mixamorig* convention.
  renameBones(doc, report);

  // 3b) Strip dislocating (non-Hips) root-position tracks, mirroring the
  //     runtime retarget rules — keep all rotations + only the Hips position.
  stripDislocatingPositionTracks(doc, report);

  // 4) Self-contained GLB output.
  await prune(doc); // drop the now-orphaned undecodable FBX textures, etc.
  await dedup(doc);
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  await io.write(outPath, doc);

  report.clips = doc
    .getRoot()
    .listAnimations()
    .map((a) => a.getName())
    .filter(Boolean);

  printReport(report);
  printRegistrySnippet(report);
}

// ---------------------------------------------------------------------------
// Source resolution (+ zip extraction)
// ---------------------------------------------------------------------------
const MODEL_EXTS = [".glb", ".gltf", ".fbx"];

function resolveSource(p) {
  const ext = path.extname(p).toLowerCase();
  if (MODEL_EXTS.includes(ext)) return { ext, source: p };
  if (ext === ".zip") return extractZip(p);
  throw new Error(
    `unsupported input "${ext}" — expected .fbx, .glb, .gltf, or .zip`,
  );
}

function extractZip(zipPath) {
  const files = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
  const names = Object.keys(files).filter((n) => !n.endsWith("/"));
  // Prefer a self-contained model: glb first, then gltf, then fbx.
  const pick =
    names.find((n) => n.toLowerCase().endsWith(".glb")) ??
    names.find((n) => n.toLowerCase().endsWith(".gltf")) ??
    names.find((n) => n.toLowerCase().endsWith(".fbx"));
  if (!pick) {
    throw new Error(
      `no .glb/.gltf/.fbx model found in zip (entries: ${names.join(", ")})`,
    );
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "convert-char-"));
  // Extract every entry so glTF + its .bin/textures resolve relatively.
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith("/")) continue;
    const dest = path.join(dir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
  return { ext: path.extname(pick).toLowerCase(), source: path.join(dir, pick) };
}

// ---------------------------------------------------------------------------
// FBX -> GLB (three.js under Node)
// ---------------------------------------------------------------------------
async function fbxToGlb(fbxPath) {
  installDomShims();
  const THREE = await import("three");
  const { FBXLoader } = await import(
    "three/examples/jsm/loaders/FBXLoader.js"
  );
  const { GLTFExporter } = await import(
    "three/examples/jsm/exporters/GLTFExporter.js"
  );

  const buf = fs.readFileSync(fbxPath);
  const arr = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const group = new FBXLoader().parse(arr, path.dirname(fbxPath) + path.sep);

  // Node can't decode embedded FBX image bytes, so any texture map ends up with
  // no pixel data and GLTFExporter throws on it. Drop those map slots (keep the
  // material's colour factors) so export succeeds.
  const MAPS = [
    "map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap",
    "aoMap", "specularMap", "bumpMap", "alphaMap", "displacementMap",
  ];
  let dropped = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      for (const k of MAPS) {
        const t = m[k];
        if (t && (!t.image || !t.image.width)) {
          m[k] = null;
          dropped++;
        }
      }
      m.needsUpdate = true;
    }
  });
  if (dropped) {
    console.log(
      `  note  : dropped ${dropped} undecodable FBX texture map(s) ` +
        `(convert from a GLB/glTF source for full texture fidelity)`,
    );
  }

  const out = await new Promise((res, rej) =>
    new GLTFExporter().parse(group, res, rej, {
      binary: true,
      animations: group.animations ?? [],
    }),
  );
  return new Uint8Array(out);
}

/** Minimal DOM shims so three's FBXLoader/GLTFExporter run headless in Node. */
function installDomShims() {
  globalThis.self ??= globalThis;
  globalThis.window ??= globalThis;
  globalThis.URL.createObjectURL ??= () => "blob:fbx";
  globalThis.URL.revokeObjectURL ??= () => {};
  // Real Blob/FileReader so GLTFExporter's binary write (merge buffers -> read
  // back as ArrayBuffer) works headless.
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
      // Works for Node's native Blob and the shim above.
      Promise.resolve(blob.arrayBuffer()).then((buf) => {
        this.result = buf;
        this.onloadend?.();
        this.onload?.();
      });
    }
  };
  const fakeCtx = {
    drawImage() {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    fillRect() {},
    putImageData() {},
  };
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
  globalThis.document ??= {
    createElement: () => fakeCanvas(),
    createElementNS: () => fakeCanvas(),
  };
  globalThis.HTMLCanvasElement ??= class {};
  globalThis.ImageData ??= class {
    constructor() {
      this.data = [];
    }
  };
}

// ---------------------------------------------------------------------------
// Step 2 — height + feet + centre normalization
// ---------------------------------------------------------------------------
function normalize(doc, report) {
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) throw new Error("document has no scene");

  const { min, max } = getBounds(scene);
  const height = max[1] - min[1];
  report.heightBefore = height;
  if (!(height > 1e-4)) {
    throw new Error(`degenerate model height (${height}); cannot normalize`);
  }

  const s = CHARACTER_HEIGHT_M / height;
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  // World point maps as p' = s*p + T. Feet at 0 -> Ty = -s*min.y; centre XZ.
  const T = [-s * cx, -s * min[1], -s * cz];
  report.scaleFactor = s;
  report.footOffset = T[1];

  // Idempotent: skip when already 2m, feet-at-0, centred (re-run = clean no-op).
  const near = (v, t) => Math.abs(v - t) < 1e-3;
  if (near(s, 1) && near(T[0], 0) && near(T[1], 0) && near(T[2], 0)) {
    report.heightAfter = height;
    return;
  }

  // Compose (s, T) onto each scene-root node's TRS without adding a wrapper
  // node (so re-running stays flat / idempotent). Uniform scale commutes with
  // rotation, so: t' = s*t + T, r' = r, scale' = s*scale.
  for (const node of scene.listChildren()) {
    const t = node.getTranslation();
    node.setTranslation([s * t[0] + T[0], s * t[1] + T[1], s * t[2] + T[2]]);
    const sc = node.getScale();
    node.setScale([s * sc[0], s * sc[1], s * sc[2]]);
  }

  const after = getBounds(scene);
  report.heightAfter = after.max[1] - after.min[1];
}

// ---------------------------------------------------------------------------
// Step 3 — skeleton -> mixamorig* convention
// ---------------------------------------------------------------------------
function renameBones(doc, report) {
  const root = doc.getRoot();
  const skins = root.listSkins();
  // Prefer skin joints (the actual skeleton); fall back to every node for
  // node-animated rigs that ship no skin (e.g. Sketchfab exports).
  const jointSet = new Set();
  for (const skin of skins) for (const j of skin.listJoints()) jointSet.add(j);
  const candidates = jointSet.size ? [...jointSet] : root.listNodes();

  const claimed = new Set();
  for (const node of candidates) {
    const name = node.getName();
    const suffix = canonicalSuffix(name);
    if (!suffix || claimed.has(suffix)) {
      // Only count true skeleton bones as "unmapped" (skip mesh/empty nodes).
      if (jointSet.size && jointSet.has(node) && !suffix) {
        report.unmappedBones.push(name);
      }
      continue;
    }
    const target = `mixamorig${suffix}`;
    if (name !== target) report.renamed.push(`${name} -> ${target}`);
    node.setName(target);
    claimed.add(suffix);
  }
  report.missingBones = CANONICAL_SUFFIXES.filter((s) => !claimed.has(s));
}

// ---------------------------------------------------------------------------
// Step 3b — strip dislocating (non-Hips) root-position tracks
// Mirrors the runtime retarget rules: keep ALL rotations + ONLY the Hips
// position track; drop limb position tracks that would dislocate the rig.
// (Scale tracks are left untouched.)
// ---------------------------------------------------------------------------
function stripDislocatingPositionTracks(doc, report) {
  // Only applies to a real humanoid skeleton (one whose root mapped to
  // mixamorigHips). Node-animated non-humanoid rigs drive motion through node
  // translation, so leave their tracks intact.
  const hasHips = doc
    .getRoot()
    .listNodes()
    .some((n) => n.getName() === "mixamorigHips");
  if (!hasHips) return;

  for (const anim of doc.getRoot().listAnimations()) {
    for (const channel of anim.listChannels()) {
      if (channel.getTargetPath() !== "translation") continue;
      const node = channel.getTargetNode();
      if (node && node.getName() === "mixamorigHips") continue; // keep root
      const sampler = channel.getSampler();
      channel.dispose();
      sampler.dispose();
      report.droppedPositionTracks++;
    }
  }
}

// ---------------------------------------------------------------------------
// Reporting + registry snippet
// ---------------------------------------------------------------------------
function fuzzyRole(clips) {
  const find = (re) => clips.find((c) => re.test(c)) ?? "";
  return {
    idle: find(/idle|idol|breath|stand/i),
    walk: find(/walk|stroll/i),
    run: find(/\brun\b|running|sprint|jog/i),
    attack: find(/attack|slash|strike|punch|kick|swing|combat|melee|\bhit\b|chop|stab/i),
  };
}

function printReport(r) {
  const f = (n) => n.toFixed(3);
  console.log(`\n── report ─────────────────────────────────────────`);
  console.log(`  wrote        : ${path.relative(process.cwd(), outPath)}`);
  console.log(`  size         : ${(fs.statSync(outPath).size / 1024).toFixed(0)} KB`);
  console.log(`  height before: ${f(r.heightBefore)} m`);
  console.log(`  height after : ${f(r.heightAfter)} m  (target ${CHARACTER_HEIGHT_M})`);
  console.log(`  scale factor : ${f(r.scaleFactor)}`);
  console.log(`  foot offset  : ${f(r.footOffset)} m  (translate-up to put soles at Y=0)`);
  console.log(`  bones renamed: ${r.renamed.length}`);
  if (r.droppedPositionTracks) {
    console.log(`  dropped pos. : ${r.droppedPositionTracks} non-Hips position track(s)`);
  }
  if (r.unmappedBones.length) {
    console.log(`  ⚠ unmapped bones (no mixarig equivalent): ${r.unmappedBones.join(", ")}`);
  }
  if (r.missingBones.length) {
    console.log(`  ⚠ missing canonical bones (rig lacks these): ${r.missingBones.join(", ")}`);
  } else {
    console.log(`  ✓ all 22 canonical mixamorig bones present`);
  }
  console.log(`  clips (${r.clips.length}) : ${r.clips.join(", ") || "(none)"}`);
}

function printRegistrySnippet(r) {
  const role = fuzzyRole(r.clips);
  const name = outId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const clipLines = Object.entries(role)
    .filter(([, v]) => v)
    .map(([k, v]) => `      ${k}: ${JSON.stringify(v)},`)
    .join("\n");
  console.log(`\n── paste into artifacts/animator/src/three/assets.ts CHARACTERS ──`);
  console.log(`  {
    id: ${JSON.stringify(outId)},
    name: ${JSON.stringify(name)},
    file: ${JSON.stringify(`models/${outId}.glb`)},
    scale: 1,
    clips: {
${clipLines || "      // no clips detected — this rig borrows the shared FBX library"}
    },
    signatureSkills: [],
    // mixamorigRightHand / mixamorigLeftHand exist after conversion; the
    // "Hand" regex matches both (right + off-hand mounts).
    handBone: "Hand",
    // First guess — most rigs need PI to face their heading. Flip to 0 if the
    // character moonwalks (feet step forward while the body slides back).
    modelYaw: Math.PI,
  },`);
  console.log(``);
}

main().catch((err) => {
  console.error("\n✗ conversion failed:", err?.stack || err);
  process.exit(1);
});
