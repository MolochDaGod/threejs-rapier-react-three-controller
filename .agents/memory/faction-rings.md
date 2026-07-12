---
name: Faction ring shared-template lifecycle
description: How the magic-ring faction/selection rings are loaded, cloned, and disposed across the voxel-engine and arcade Explorer apps without double-freeing shared GPU resources.
---

# Faction ring shared-template lifecycle

Both apps (voxel-engine Game Studio play mode, arcade Explorer) show a flat
ground ring under entities: faction-colored identifier rings (ally=blue,
enemy=red, neutral=yellow, object=blue-variant — the color is baked into the GLB
art, so pick the model by faction, never tint) plus ONE shared "selection"
highlight under the currently targeted entity.

## The non-obvious lifecycle rule

- Load the 4 ring GLBs ONCE into prepared template Object3Ds. Per-entity rings
  are `template.clone(true)` — a plain clone **shares** the template's geometry
  and materials.
- Because clones share GPU resources, you must NOT let a per-entity / per-actor
  disposal sweep free them. Two guards:
  - Detach every ring clone from its parent BEFORE any host
    `disposeObject3D(root)` / scene sweep runs, then dispose the templates
    exactly once on teardown.
  - Tag clone meshes (`userData.factionRing` in voxel, `userData.shared` in
    arcade) and make the app's recursive disposer skip tagged meshes
    (`CreatureActor.disposeObject` does this).
- The single selection highlight is the exception: it deep-clones its OWN
  materials so its opacity/scale pulse is isolated — those materials are disposed
  separately, alongside detaching the ring.

**Why:** double-disposing shared geometry/materials throws GL errors and makes
every other ring go black/blank; freeing a template while live clones still
reference it does the same. The bug only shows on entity death or engine
teardown, not at spawn, so it's easy to miss.

## Other constraints
- GLB load is async and must never block gameplay — `acquire` returns null until
  ready and rings just pop in.
- Lay templates flat in the XZ plane (measure bbox; rotate x=-PI/2 if authored
  upright), auto-fit to ~1.6x the entity footprint radius, lift y≈0.03 to avoid
  terrain z-fighting, and set `depthWrite=false`+`transparent` on the materials.
- Per-frame target picking (crosshair ray-march in voxel, nearest-in-forward-cone
  in arcade) reuses a scratch Vector3 — don't reallocate in the loop.
- Visuals are manual-verify only (WebGL can't init headless + Puter guest gate
  blocks screenshots).
