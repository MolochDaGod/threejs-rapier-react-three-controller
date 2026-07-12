// Merge a body GLB + a folder of single-clip "withSkin" animation GLBs (that all
// share the SAME skeleton) into ONE self-contained character GLB, keeping the
// body mesh/skin once and copying only the animation tracks (renamed to clean
// role names). Used to convert Meshy-style per-clip exports into a single rig
// like the other Animator characters (e.g. sanji.glb).
//
// Usage:
//   node scripts/src/merge-glb-anims.mjs <bodyGlb> <animDir> <outGlb>
//
// Clip names are derived from the file token between "Animation_" and
// "_withSkin", lower-cased, with a few overrides for the canonical locomotion
// roles so CharacterDef.clips can map idle/walk/run directly.

import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";

const [, , bodyPath, animDir, outPath] = process.argv;
if (!bodyPath || !animDir || !outPath) {
  console.error("usage: merge-glb-anims.mjs <bodyGlb> <animDir> <outGlb>");
  process.exit(1);
}

const NAME_OVERRIDES = {
  idle_10: "idle",
  walking: "walk",
  running: "run",
  rifle_charge_inplace: "rifle_charge",
  roll_dodge_1: "roll_dodge",
};

function cleanName(file) {
  const m = file.match(/Animation_(.+)_withSkin\.glb$/i);
  let token = (m ? m[1] : path.basename(file, ".glb")).toLowerCase();
  token = token.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return NAME_OVERRIDES[token] ?? token;
}

const io = new NodeIO();

const body = await io.read(bodyPath);
const root = body.getRoot();
const buffer = root.listBuffers()[0];

const bodyNodesByName = new Map();
for (const n of root.listNodes()) bodyNodesByName.set(n.getName(), n);

// Drop the body's own placeholder clip(s) — we re-add named ones below.
for (const a of root.listAnimations()) a.dispose();

const animFiles = fs
  .readdirSync(animDir)
  .filter((f) => f.toLowerCase().endsWith(".glb") && !/character_output/i.test(f))
  .sort();

const added = [];
for (const file of animFiles) {
  const src = await io.read(path.join(animDir, file));
  const srcAnim = src.getRoot().listAnimations()[0];
  if (!srcAnim) {
    console.warn("  (no animation in)", file);
    continue;
  }
  const name = cleanName(file);
  const anim = body.createAnimation(name);
  let copied = 0;
  let skipped = 0;
  for (const ch of srcAnim.listChannels()) {
    const targetNode = ch.getTargetNode();
    const bodyNode = targetNode && bodyNodesByName.get(targetNode.getName());
    if (!bodyNode) {
      skipped++;
      continue;
    }
    const sSamp = ch.getSampler();
    const sIn = sSamp.getInput();
    const sOut = sSamp.getOutput();
    const input = body
      .createAccessor()
      .setBuffer(buffer)
      .setType(sIn.getType())
      .setArray(Float32Array.from(sIn.getArray()));
    const output = body
      .createAccessor()
      .setBuffer(buffer)
      .setType(sOut.getType())
      .setArray(Float32Array.from(sOut.getArray()));
    const sampler = body
      .createAnimationSampler()
      .setInput(input)
      .setOutput(output)
      .setInterpolation(sSamp.getInterpolation());
    const channel = body
      .createAnimationChannel()
      .setTargetNode(bodyNode)
      .setTargetPath(ch.getTargetPath())
      .setSampler(sampler);
    anim.addSampler(sampler).addChannel(channel);
    copied++;
  }
  added.push(`${name} (${copied} ch${skipped ? `, ${skipped} skipped` : ""})`);
}

await io.write(outPath, body);
const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
console.log(`wrote ${outPath} (${kb} KB) with ${added.length} clips:`);
for (const a of added) console.log("  -", a);
