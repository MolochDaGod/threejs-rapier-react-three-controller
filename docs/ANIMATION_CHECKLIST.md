# Animation verification checklist

Generated: 2026-08-03T18:06:58.975Z  
See also: `ANIMATION_WIRING_AUDIT.md`, `ANIMATION_CATALOG.csv`

## Status counts

| Metric | N |
|--------|--:|
| Total rows | 325 |
| With length_sec | 311 |
| Wired + loads | 262 |
| **Orphan (file not wired)** | **26** |
| Wired missing file | 0 |
| Wired load fail/empty | 6 |
| grudge CDN OK | 28 |

## Do not claim “verified for use” unless

```
[ ] source_path appears in WEAPON_SETS / GLOBAL_* / TRAVERSAL / UNIVERSAL (see wired_connections)
[ ] asset_exists=yes OR virtual GLB slice
[ ] load_ok=yes (FBX/GLB parse has tracks) OR CDN 200 with duration
[ ] length_sec is filled (not blank)
[ ] correct_hip / correct_xz are not not_played_unverified
[ ] Played once in Danger Room / Dressing Room on real skeleton (Mixamo or Bip001)
```

## Column reference

| Column | Honest meaning |
|--------|----------------|
| length_sec | Seconds from FBXLoader / GLTF / CDN JSON — blank means not measured this run |
| track_count | Animation tracks in the file (0 = empty clip, useless) |
| correct_hip / correct_xz | pipeline_locked_if_played OR not_played_unverified — **not** measured_pass |
| weapon_attached | Actual wiring scopes, or NONE_ORPHAN |
| wired_connections | e.g. sword:{attack1+comboHit1} \| global:{parryReact} |
| verified_for_use | wired_and_loads · orphan_not_wired · wired_missing_file · wired_but_load_fails · wired_cdn_ok · … |

## Next work (product)

1. Wire orphans that matter (see audit list) into clipCatalog  
2. Delete or quarantine true junk orphans  
3. measured Box3 feet/XZ pass → update correct_hip/xz to measured_pass/fail  
