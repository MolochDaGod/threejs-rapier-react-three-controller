---
name: FBX/GLB -> GLB conversion under Node (convert-character)
description: Headless model-conversion gotchas for the scripts/convert-character pipeline (three + gltf-transform in Node).
---

# Converting humanoid assets to Mixamo-ready GLB in Node

`scripts/src/convert-character.mjs` turns FBX / GLB / glTF / zip into a
normalized, mixamorig-renamed, self-contained GLB in
`artifacts/animator/public/models/`. Hard-won facts:

- **GLB/glTF: use `@gltf-transform/core` NodeIO, NOT three's GLTFLoader.**
  GLTFLoader HANGS in Node (no `createImageBitmap` to decode textures).
  gltf-transform copies texture buffers verbatim → textures survive.
- **FBX: only three FBXLoader→GLTFExporter works** (no FBX2glTF binary here, and
  gltf-transform can't read FBX). It runs headless ONLY with DOM shims:
  `self`, `window`(=globalThis), `URL.createObjectURL/revokeObjectURL`, a real
  data-carrying `Blob` (Node has native Blob, so `??=` won't override), a
  `FileReader` shim whose `readAsArrayBuffer` delegates to `blob.arrayBuffer()`
  (GLTFExporter binary write needs it; Node has Blob but NOT FileReader),
  `document.createElement/NS` returning a fake canvas, `HTMLCanvasElement`,
  `ImageData`. FBXLoader needs the buffer sliced:
  `arr.buffer.slice(byteOffset, byteOffset+byteLength)`.
- **FBX embedded textures can't be exported in Node.** Node can't decode the
  image bytes (no WebGL/createImageBitmap), so `texture.image` is empty and
  GLTFExporter throws "No valid image data found". Fix: null out every material
  map slot whose texture has no `image.width` BEFORE export (keep colour
  factors), warn the user. GLB/glTF inputs don't have this problem.
- **Spec-gloss GLB inputs render black until converted to metal-rough.** Some
  source GLBs (e.g. FusionFall packs) ship `KHR_materials_pbrSpecularGlossiness`.
  three's renderer ignores it → black/untextured. Fix: register `ALL_EXTENSIONS`
  on the `NodeIO` (so it can READ the spec-gloss extension instead of failing)
  AND run gltf-transform's `metalRough()` transform to bake spec-gloss into the
  core metal-rough model. Needs the `@gltf-transform/extensions` dep.

## Normalization + bones (mirrors runtime, can't import app code)
- Height target = `CHARACTER_HEIGHT_M = 2.0` (mirror of animator types.ts).
- Measure with gltf-transform `getBounds(scene)`; compute `s = 2/height`,
  `T` to put feet at Y=0 + centre XZ. Apply onto EACH scene-root node's TRS
  (`t' = s*t + T`, `scale' = s*scale`, rotation unchanged — uniform scale
  commutes with rotation) instead of adding a wrapper node, so re-runs stay flat
  and idempotent (2m input → s≈1, skip).
- Bone rename mirrors `retargetMap.ts` `canonicalSuffix` (22 suffixes),
  first-claim-per-suffix, output `mixamorig<Suffix>`. Index-based glTF channels +
  skin.joints mean renaming `node.name` does NOT break baked clips.
- Strip non-Hips `translation` channels (keep rotations + Hips position) per the
  runtime retarget rule — but GUARD it: only run when a real `mixamorigHips`
  exists, else node-animated non-humanoid rigs (e.g. orc.glb) lose their native
  motion (their movement IS node translation).
