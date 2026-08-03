/**
 * Export production 6-race voxel defaults from Avatar Edit catalog into
 * artifacts/animator/public/avatar/races/defaults.json
 *
 * Usage (from repo root or animator):
 *   npx tsx scripts/export-voxel-race-defaults.mjs
 *   node --import tsx scripts/export-voxel-race-defaults.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ANIMATOR = path.join(ROOT, "artifacts", "animator");
const OUT_DIR = path.join(ANIMATOR, "public", "avatar", "races");
const MODULE = path.join(ANIMATOR, "src", "three", "avatar", "raceDefaults.ts");

async function main() {
  const mod = await import(pathToFileURL(MODULE).href);
  const manifest = mod.buildRaceDefaultsManifest();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outJson = path.join(OUT_DIR, "defaults.json");
  fs.writeFileSync(outJson, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`[export-voxel-race-defaults] wrote ${outJson}`);
  console.log(
    `[export-voxel-race-defaults] races: ${manifest.races.map((r) => r.id).join(", ")}`,
  );
  // Portrait PNGs need a browser canvas — generate from Avatar Edit
  // "Publish 6 races" or HeadStage. Face pixel grids ship inside config via compose.
  const readme = path.join(OUT_DIR, "README.md");
  fs.writeFileSync(
    readme,
    [
      "# Voxel race defaults (Avatar Edit)",
      "",
      "Production default playable characters for **voxel games** — not grudge6, not free-rpg TPose.",
      "",
      "| Field | Use |",
      "|-------|-----|",
      "| `defaults.json` | Fleet SSOT: 6 races with `config` (head) + `look` (body) |",
      "| `*-portrait.png` | Optional UI cards (export from Avatar Edit **Publish 6 races**) |",
      "",
      "## Spawn",
      "",
      "```js",
      "const race = manifest.races.find(r => r.id === 'orc');",
      "// Explorer / VoxelCharacter:",
      "// look: { ...race.look, avatarConfig: race.config }",
      "// height: race.heightM",
      "```",
      "",
      "## CDN",
      "",
      "Upload this folder to R2 as `avatar/races/` (or `voxgrudge/avatar/races/`).",
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(`[export-voxel-race-defaults] wrote ${readme}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
