import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  try {
    const doc = await io.read(f);
    const root = doc.getRoot();
    const meshes = root.listMeshes();
    const nodes = root.listNodes();
    console.log("\n=== " + f.split("/").pop());
    console.log("nodes:", nodes.length, "meshes:", meshes.length, "mats:", root.listMaterials().length, "tex:", root.listTextures().length);
    console.log("mesh names:", meshes.map(m=>m.getName()).slice(0,40).join(", "));
    const scene = root.listScenes()[0];
    console.log("scene children:", scene.listChildren().map(c=>c.getName()).slice(0,60).join(", "));
  } catch(e){ console.log(f, "ERR", e.message); }
}
