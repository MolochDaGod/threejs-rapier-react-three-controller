// Batch-prepare the 24 "Heroes of Grudge" GLBs for the Animator Danger Room.
//
// The source rigs (Bip001_* skeletons with rich embedded class clips) are already
// upright and ~1.9m tall, so no orientation/scale fix is needed — the runtime
// Character loader re-normalizes height + grounds feet. What we DO need:
//   - metalRough(): convert any spec/gloss materials so they don't render black.
//   - textureCompress(): the body atlases ship as ~8-9MB PNGs (~190MB total); resize
//     + webp shrinks that to a shippable size.
//   - prune()/dedup(): drop orphaned data + share duplicate accessors/textures.
//
// Bones are intentionally NOT renamed: the embedded clips target the Bip001_* names,
// so the heroes self-animate. Output: artifacts/animator/public/models/grudge/.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  metalRough,
  textureCompress,
  prune,
  dedup,
} from "@gltf-transform/functions";
import sharp from "sharp";

const SRC_ROOT = "/tmp/grudge";
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(
  here,
  "../../artifacts/animator/public/models/grudge",
);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** Collect every {race}_{class}.glb under the faction subfolders. */
function listSources() {
  const out = [];
  for (const faction of fs.readdirSync(SRC_ROOT)) {
    const dir = path.join(SRC_ROOT, faction);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.toLowerCase().endsWith(".glb")) out.push(path.join(dir, f));
    }
  }
  return out.sort();
}

async function processOne(src) {
  const base = path.basename(src); // e.g. high-elves_knight.glb
  const out = path.join(OUT_DIR, base);
  const doc = await io.read(src);
  await doc.transform(
    metalRough(),
    textureCompress({
      encoder: sharp,
      targetFormat: "webp",
      resize: [1024, 1024],
      resizeFilter: "lanczos3",
    }),
    prune(),
    dedup(),
  );
  await io.write(out, doc);
  const before = fs.statSync(src).size;
  const after = fs.statSync(out).size;
  const kb = (n) => (n / 1024).toFixed(0);
  console.log(
    `  ✓ ${base}  ${kb(before)}KB -> ${kb(after)}KB` +
      `  (${((1 - after / before) * 100).toFixed(0)}% smaller)`,
  );
  return after;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sources = listSources();
  console.log(`\n▶ prep-grudge — ${sources.length} rigs -> ${OUT_DIR}\n`);
  let total = 0;
  for (const src of sources) total += await processOne(src);
  console.log(
    `\n── done: ${sources.length} rigs, ${(total / 1024 / 1024).toFixed(1)} MB total ──\n`,
  );
}

main().catch((err) => {
  console.error("\n✗ prep-grudge failed:", err?.stack || err);
  process.exit(1);
});
