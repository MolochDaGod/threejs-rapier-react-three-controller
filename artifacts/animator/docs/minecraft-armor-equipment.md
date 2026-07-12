# Minecraft-style armor equipment

## Chance of using `realistic_minecraft_armor (1).glb`

| Use case | Chance | Why |
|----------|--------|-----|
| **Armor stand / loadout mannequin** | **High** | Asset is a wood rack + full material suits (Gold, Iron, Leather×2, Magic×2). Same role as Minecraft armor stands. |
| **Catalog + 4-slot loadout data** | **High** | Slot model is independent of mesh topology. Implemented. |
| **Worn modular pieces on a living rig** (helmet/chest/legs/boots) | **Medium (future)** | GLB has **no skins**, **no bones**, **no per-slot meshes** — only full-set groups. Needs split meshes or texture layers + bone attach. |
| **Drop-in player skin overlay** | **Low as-is** | Not UV-mapped to Steve/Alex; not a layered player texture. |

**Verdict:** Use now as **equipment UI + stand preview** (Minecraft inventory + armor stand practice). Grow into **worn gear** with the same slot IDs when per-piece worn GLBs exist.

## Minecraft practices we mirror

1. **Four body slots** — `head`, `chest`, `legs`, `feet` (helmet, chestplate, leggings, boots).
2. **Independent equip** — each slot can be empty or a piece id.
3. **Full set equip** — one action fills all four slots (shift-click set feel).
4. **Armor stand display** — visualize the set on a mannequin without dressing the combat avatar yet.
5. **Modular visibility** — show/hide stand nodes by loadout (same idea as Grudge `applyGearPreset` mesh toggles).
6. **Separate item data from render** — `ArmorPiece` / `ArmorSet` ids are stable; `standNode` / future `wornFile` are presentation.

## Asset layout

```
artifacts/animator/public/models/armor/
  mc-armor-stand.glb     # optimized showcase (Stand + Font + 6 sets)
```

Source: `D:\Games\Models\realistic_minecraft_armor (1).glb` (~118MB raw Sketchfab Fin Armor).

Optimized mesh nodes used for equip (after gltf-transform flatten):

| Node | Set id |
|------|--------|
| `Leather_1_Leather_1_0` | `leather` |
| `Leather_2_Leather_2_0` | `leather-dark` |
| `Iron_Iron_0` | `iron` |
| `Gold_Gold_0` | `gold` |
| `Magic_1_Magic_1_0` | `magic-arcane` |
| `Magic_2_Magic_2_0` | `magic-void` |
| `Stand_Woden_Stand_0` / `Font_Font_0` | props (optional) |

## Code

| Module | Role |
|--------|------|
| `src/three/equipment/types.ts` | Slots, piece/set types, stand path |
| `src/three/equipment/armorCatalog.ts` | Catalog, loadout helpers, localStorage |
| `src/three/equipment/armorStand.ts` | Load + visibility (mannequin) |
| `src/components/EquipmentScreen.tsx` | UI slots + set picker |

## Future worn path (no catalog rewrite)

1. Split each set into 4 worn meshes (or one layered texture) named `{set}-{slot}`.
2. Set `ArmorPiece.wornFile` / attach to `mixamorigHead`, spine, legs, feet (or Bip001 equivalents via existing retarget bone map).
3. Keep `standNode` for the rack; combat avatar uses worn attach only.
4. Optional: defense numbers feed damage reduction when combat wants it.

## Optimize / reimport

```bash
# From repo root (requires @gltf-transform/cli)
npx @gltf-transform/cli optimize ^
  "D:\Games\Models\realistic_minecraft_armor (1).glb" ^
  artifacts/animator/public/models/armor/mc-armor-stand.glb ^
  --texture-compress webp
```

Prefer WebP + meshopt so the file stays under GitHub’s 100MB limit.
