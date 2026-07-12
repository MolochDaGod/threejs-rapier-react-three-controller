---
name: Animator deploy asset size
description: Why Animator publishes can fail at the image-push step and how to keep deploy assets small
---

# Animator deploy asset size

The Animator publishes as a `static` artifact on a GCE (Reserved VM) target, but the
whole repl tree (incl. `artifacts/animator/public/`) is pushed as image layers. The
build phase (vite) is rarely the problem — failures at publish time often surface as
a transient layer-push error, e.g.:

`fatal: failed to push layers: failed to push nix layer: io.Copy(...): io: read/write on closed pipe`

This is infra-transient (a retry can succeed), but it gets dramatically more likely
when `public/` is bloated. Raw Sketchfab/Synty GLB props ship 2K–4K uncompressed
textures (~30 MB each); a few of them push `public/` past 140 MB and the layer push
crawls for ~an hour before dropping the pipe.

**Rule:** texture-compress every large GLB before it lands in `public/`. Geometry on
these props is tiny (~10k tris) — the size is entirely textures.

**How to apply:** `npx @gltf-transform/cli optimize in.glb out.glb --compress false
--texture-compress webp --texture-size 1024`. Skip Draco (`--compress false`) so no
DRACOLoader is needed; three's GLTFLoader supports `EXT_texture_webp` natively, so
WebP needs no runtime loader change. This took the 3 alchemy/fortress props from
~92 MB to ~6 MB total with no meaningful visual loss at prop scale.
