import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const f = process.argv[2];
const doc = await io.read(f);
const root = doc.getRoot();
// compute per-node world bbox approx via mesh accessor positions
function meshBounds(mesh){
  let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
  for(const prim of mesh.listPrimitives()){
    const pos=prim.getAttribute("POSITION"); if(!pos) continue;
    for(let i=0;i<pos.getCount();i++){const v=[0,0,0];pos.getElement(i,v);for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],v[k]);mx[k]=Math.max(mx[k],v[k]);}}
  }
  return {mn,mx,size:[mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]]};
}
root.listMeshes().forEach((m,i)=>{
  const b=meshBounds(m);
  const s=b.size.map(x=>x.toFixed(2));
  console.log(i, m.getName().padEnd(14), "size", s.join(" x "), "tris", m.listPrimitives().reduce((n,p)=>n+(p.getIndices()?.getCount()??0)/3,0));
});
