---
name: Puter guest auth
description: How Puter temporary (guest) accounts and in-place upgrade work via the puter.js SDK
---

# Puter guest accounts (puter.js v2)

Non-obvious SDK behavior (not derivable from our code — it's external API contract):

- `puter.auth.signIn({ attempt_temp_user_creation: true })` provisions a
  **temporary guest account** with no signup. It still counts as signed in:
  `puter.auth.isSignedIn()` is true and `puter.kv` works, so guests get a real
  per-account id and persistent storage.
- The returned `User` object exposes `is_temp: boolean` — the only reliable way
  to tell a guest from a full account. Drive guest UX off `user.is_temp`.
- **Upgrade is just a normal `signIn()`** (no temp flag). Calling it while a
  guest is active converts the temporary account into a permanent one **in place**,
  keeping its KV data. So a single shared sign-in path serves both first-time
  full sign-in and guest->full upgrade.

**Why:** lets you offer instant "play as guest" entry while still persisting
progress and allowing a later upgrade without data loss.

**How to apply:** one shared sign-in helper takes an `asGuest` flag; pass the
temp option only for guest entry, reuse the plain call everywhere else. The SDK
can resolve with `{ success: false, error }` instead of throwing — check that
before treating sign-in as done. Popup cancel rejects the promise; treat
`cancel|close|abort` messages as a soft no-op.

## Silent auto-guest on mount

The apps no longer show a "Play as guest" button. The auth provider bootstraps a
guest **automatically** on mount (restore session, else `signIn({attempt_temp_user_creation:true})`)
and keeps the gate's `loading` splash up until the session resolves; the player
lands straight in. The manual Login screen is now an **error-only fallback**.

**Why:** `attempt_temp_user_creation` needs no popup/user gesture, so it can run
unattended behind a loading screen — friction-free entry.

**How to apply:** put the bootstrap in a **module-scoped one-shot promise**
(memoised, run once), NOT directly in the effect. Otherwise React StrictMode's
dev double-invoke of effects fires duplicate/racing `signIn` calls. The effect
just awaits the shared promise and writes state guarded by a `cancelled` flag.
Full `signIn()` (upgrade) and `signOut()` stay as explicit user actions.
