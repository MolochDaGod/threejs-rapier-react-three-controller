---
name: Voxel worker generation + meshing pipeline
description: How voxel-engine streams terrain generation and mesh building through a Web Worker so the main thread only uploads geometry.
---

# Voxel terrain + mesh Web Worker

The voxel-engine `Engine` does NOT generate or mesh terrain on the main thread.
A dedicated Web Worker owns its own `World` + `BlockRegistry` + `Generator`,
generates every chunk, greedy-meshes each one, and streams finished chunks back.
The main thread only inserts voxels into its world and uploads prebuilt geometry,
so the framerate stays smooth no matter how many chunks stream in.

## Non-obvious rules (break these and it regresses)

- **Generator crosses the boundary as a SPEC, not an instance.** Class instances
  cannot be structured-cloned to a worker. `EngineOptions.generatorSpec`
  (`GeneratorSpec`) is a plain object; the worker rebuilds the generator via
  `createGenerator(spec)`. Adding a new generator means adding a `kind` + case to
  `generatorFactory.ts`, not just dropping a file. The studio maps template→spec
  via `makeGeneratorSpec`.

- **The worker must reconstruct the SAME registry + generator from the seed.** It
  calls `createDefaultRegistry()` and `createGenerator({kind, seed})` exactly like
  the main thread once did. If these drift out of lockstep, worlds stop being
  deterministic across the boundary. (See voxel-terrain-generation.md for the
  determinism/seamlessness rules the generator itself must obey.)

- **Two phases: generate ALL, then mesh ALL.** Border faces are only culled
  correctly when every neighbour already exists, so meshing happens after the
  full generation pass. This gives one mesh per chunk with no temporary seams and
  no re-meshing.

- **Send a COPY of voxels, never transfer the worker's chunk buffers.** The
  worker keeps each chunk's voxels for neighbour sampling during the mesh pass.
  Transferring `chunk.voxels.buffer` would detach it and corrupt sampling of
  later chunks. Post `chunk.voxels.slice()` and transfer the copy's buffer; mesh
  arrays are freshly built per chunk so they ARE safe to transfer.

- **`isGenerating` stays true until worker `done` AND the upload queue is empty.**
  Voxels arrive progressively (per chunk message), so edit-restore must wait for
  the LAST chunk — otherwise a late worker chunk overwrites a replayed edit, or
  restore runs against an incomplete world.

- **Worker-inserted chunks go in via `World.addChunkSilent` with `chunk.dirty =
  false`.** The worker already meshed them with full neighbour awareness, so
  marking neighbours dirty / re-meshing on the main thread is wasted work. The
  main thread still keeps `ChunkRenderer.update` + `buildChunkMeshData` for
  edit-driven LOCAL re-meshes (block break/place) only.

- **The worker bundle must stay Three.js-free.** Only `mesh/ChunkMesher.ts` and
  `render/` import THREE. The pure meshing logic lives in
  `mesh/buildChunkMeshData.ts` (re-exported by ChunkMesher for compatibility) so
  the worker imports it without pulling THREE. A correct build emits a ~17KB
  worker chunk; if it balloons, something THREE-importing leaked in.

- **The worker and the main-thread fallback share ONE core: `generation/worldGeneration.ts` (`WorldGeneration`).** Both the worker and the
  Engine's no-worker fallback drive this same class, so a device without Web
  Worker support builds an identical, deterministic world — never fork the gen/
  mesh logic into two copies. Its phases are time-sliceable: `generateUntil(deadlineMs)` (pass `Infinity` in the worker; pass a frame deadline on the main
  thread) then `meshNext()`. The fallback fires when `new Worker` throws, when
  `typeof Worker === "undefined"`, OR on `worker.onerror`/`onmessageerror` before
  `done`; switching mid-stream clears the upload queue and regenerates from
  scratch (safe because generation is deterministic). If even the fallback can't
  run, `Engine.onGenerationError` surfaces a message so the loading splash never
  hangs.
