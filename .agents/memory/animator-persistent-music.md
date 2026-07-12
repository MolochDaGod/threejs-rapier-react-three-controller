---
name: Animator persistent background music
description: Why the DJ music lives in an app-level singleton, not the per-mode Studio/CombatSfx.
---

# Persistent background music (musicStation singleton)

Background DJ music (real MP3s) must survive page/mode switches. The per-mode
`Studio` engine (and its `CombatSfx`) is torn down + rebuilt on every navigation,
so anything music-related owned there resets the track.

**Rule:** music playback is owned by `src/three/audio/musicStation.ts` — a module
singleton wired into THREE's global `AudioContext`. `CombatSfx` keeps only a local
`stationEnabled` bool + synth-duck and delegates every station method to the
singleton. Critically, `CombatSfx.dispose()` must NOT stop the music — it only
detaches the track callback (`musicStation.setOnTrack(null)`). `App.tsx` starts the
playlist once on mount and syncs level/mute via effects.

**Why:** persistent music can't be spatialized to the DJ booth (the booth is absent
on other pages), so routing is flat-global; the booth still "dances" by reading the
global analyser via `musicStation.getPulse()`.

**How to apply:**
- `setPlaylist()` is idempotent but the guard also checks that the live audio graph
  exists (decks built) — this lets a prior failed graph build retry on a re-assert
  instead of being short-circuited forever. Never drop the graph-exists half.
- Any new per-Studio audio teardown must never touch `musicStation`.

## Dual-deck DJ ("CPT RAC Station") — auto-mix + crossfade

The station is a **two-deck** WebAudio mixer (each deck = HTMLAudioElement →
MediaElementSource → lowpass filter → gain → mixBus, plus a shared delay/feedback
echo send). Auto-mix triggers a crossfade from the active deck's `timeupdate` near
track end; transition styles (crossfade / filter sweep / echo / cut) are AudioParam
ramps. Settings persist in `djStationSettings.ts` (localStorage `dangerroom:djstation`);
a `started` flag makes a *genuine* first start random (survives StrictMode
double-mount because the idempotent `setPlaylist` short-circuits the second call);
`reset()` re-rolls.

**Why (durable gotchas):**
- The foreground/`active` deck flips *immediately* at crossfade start, but the
  outgoing deck is still audible on the mix bus. So `getPulse()` "playing" must be
  `decks.some(playing)`, NOT `decks[active]` only — otherwise the diegetic DJ
  dance/light show stutters across every transition.
- Headroom: two decks summing to ~1.4 mid-fade is safe only because `MUSIC_BASE`
  (~0.12) sits after the ×5 station gain. Don't raise station gain without a limiter.
- Cancel the crossfade finalize timer (`fadeTimer`) on a new transition and on
  stop (`setPlaylist([])`) or a stale callback can pause the wrong deck later —
  ALSO cancel it when `setPlaylist` swaps to a *different* track list (station
  switch), for the same stale-finalize reason.

## Radio stations (local + Audius streaming)

The station picker is a registry (`radioStations.ts`): the local playlist plus
Audius genre stations (free API, CORS `*` on both the discovery host and the
302'd content node — required, because non-CORS media through WebAudio is
silence; deck elements set `crossOrigin="anonymous"`).

**Why (durable gotchas):**
- Audius trending genre names are case-exact ("Lo-Fi", not "lofi"); stream URL is
  `/v1/tracks/{id}/stream?app_name=...` and follows a 302.
- Playlists are cached per-session so every re-assert passes the SAME url array →
  idempotent `setPlaylist` no-op. Studio's mode-switch re-assert must go through
  `assertStation()` (persisted station), never a hardcoded local playlist, or a
  streaming station gets clobbered on every mode change.
- Station switching is async (fetch): the App handler carries a monotonic request
  token so a slow earlier fetch can't overwrite a newer pick or trigger a stale
  local fallback.
- Two INDEPENDENT mute flags (global mixer + station button) combine via the pure
  `combinedMuteGain()`; every muteGain write must use it — a one-flag write once
  let a global-mute round-trip silently clear station mute.
- `userPaused`: `resume()` must respect it, but explicit track changes
  (`transitionTo`/select) clear it — an explicit pick means "I want sound".
