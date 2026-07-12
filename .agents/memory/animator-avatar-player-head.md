---
name: Avatar Edit player head bridge
description: How the saved Avatar Edit build dresses the Explorer rig's box head in-game, and the traps around it.
---

# Avatar Edit → Explorer player head

The Avatar Edit studio saves ONE config to localStorage; the Explorer rig
(`VoxelCharacter`) dresses its box head with it at build time via a bridge
helper that swaps the head material for 6 CanvasTextures + adds a protrusion
group.

Rules / traps:

- **Only the player's Explorer** gets `look.avatarHead: true` (gated on
  `def.id === "explorer"` in ExplorerCharacter). All procedural chars share
  `DEFAULT_LOOK`, so the flag can NOT live in the shared look defaults or every
  NPC would wear the player's face.
- **The head cap uses shared `mats.skin`.** The bridge replaces
  `head.material` with its OWN material array — never dispose the shared skin
  mat, and after the swap `recolour()`/`setPartPattern("skin")` no longer
  affect the head (intentional). The bridge handle owns all its tex/mats/geo
  and is disposed FIRST in rig.dispose().
- **BoxGeometry material index order is +x,-x,+y,-y,+z,-z** →
  face names `right,left,top,bottom,front,back`. Same FACE_ORDER as HeadStage.
- **Protrusions are in head-unit space** (head = unit cube); scale the group
  by the rig head size (0.44) rather than rescaling each box.
- Skip the avatar head while `hat === "ledMask"` (mask fully encloses the
  head) and when no config is saved — silent no-op keeps the stock head.
- **Body must match the head:** after a successful head apply the rig tints
  the shared `mats.skin` (hands/forearms) with `skinToneOf(cfg)` and stores
  the hex so `recolor()` re-applies it AFTER `look.skin` — otherwise any
  later recolor silently desyncs body tone from the worn face.
- Hair-style hat gating convention: crown-volume protrusions gate on
  `!hatted`; below-rim hair (dread ropes, smooth/shaggy back sheets, side
  locks, long curtains) always spawns so hats never delete the hairdo.
- **Hair strands overlay, not replace:** hair renders as darkened protrusion
  cores + one InstancedMesh of 1/8-pixel strands (`hairStrands.ts`), built from
  `ProtrusionBox.hair` tags. The tag sweep in composeHead covers ONLY the hair
  section (beard/ears/nose must stay untagged — tested). Strand generation is
  pure/deterministic (hash01) so it's unit-testable sans WebGL; the FX handle
  must be disposed BEFORE any scene-wide dispose traverse (like hats), and
  every consumer of the head handle must forward a per-frame `update(timeSec)`
  or hanging strands freeze mid-sway.
- Avatar codes: `encodeConfig`/`decodeConfig` use an "AV1." prefix +
  url-safe base64 JSON via plain btoa/atob (Node 16+ has globals; no Buffer
  fallback needed). `sanitizeConfig` is the single validation gate for
  anything read from storage or pasted codes.
