import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
  for (const m of doc.getRoot().listMeshes()){
    for(const prim of m.listPrimitives()){
      const pos=prim.getAttribute("POSITION"); if(!pos) continue;
      for(let i=0;i<pos.getCount();i++){const v=[0,0,0];pos.getElement(i,v);for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],v[k]);mx[k]=Math.max(mx[k],v[k]);}}
    }
  }
  const s=[mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]];
  const axes=["x","y","z"]; const longest=axes[s.indexOf(Math.max(...s))];
  console.log(f.split("/").pop().padEnd(22), "size", s.map(x=>x.toFixed(1)).join(" x "), "→ longest:", longest);
}
