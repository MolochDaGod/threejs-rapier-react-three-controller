---
name: Studio settings schema migrations
description: How to add a field to StudioSettings without a destructive side effect
---

# Studio settings schema (`artifacts/voxel-engine/src/studio/settings.ts`)

Adding a new optional numeric/enum field to `StudioSettings` does NOT require a
schema bump on its own — `loadSettings` fills missing fields from
`DEFAULT_SETTINGS` via `num()`/guards. Bump `SETTINGS_SCHEMA` only when a stored
value needs a one-time fixup.

**Gotcha:** the load-time migration block runs whenever `storedSchema <
SETTINGS_SCHEMA`. It historically force-reset `invertY=false` on *every* bump,
so a later unrelated bump would silently wipe a user's inverted-look choice. The
reset is now guarded to `storedSchema < 2` (its original v2 intent).

**Why:** the invertY reset was a one-time v2 fix, but the condition was tied to
the moving `SETTINGS_SCHEMA` constant, so any future bump re-applied it.

**How to apply:** when you bump the schema for a new migration, scope each fixup
to the specific old schema range it targets (`if (storedSchema < N)`), never to
the bare `storedSchema < SETTINGS_SCHEMA` envelope.
