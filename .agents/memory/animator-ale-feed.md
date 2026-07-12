---
name: Animator A.L.E. social/video
description: A.L.E. is GRUDOX's attention-seeking entertainment AI; in-app feed + match recap + narrated highlight reel are all preview-only; ad videos gated on AI skill-meta.
---

# A.L.E. as GRUDOX's entertainment AI

A.L.E. (the "Automated League Evaluator" director/cameras/highlights/diagnostics
layer over the AI duels) is also framed as **GRUDOX's attention-seeking
entertainment AI** — its job is to "earn attention" by turning duels into
shareable content for the grudge-studio website, Discord, and socials (YouTube,
Twitter/X, Instagram) plus gaming-conference/festival forums.

## Current state: drafts only, no publishing

The "A.L.E. Feed" composes **draft** platform posts (captions + stats + standout
highlight) from the finished duel — it does NOT publish anywhere. The generator
is pure/deterministic; the UI previews drafts with a copy-to-clipboard button.

**Why:** when asked, the user explicitly chose "in-app feed that drafts/previews
posts without publishing" over real posting to live accounts. Real cross-platform
posting (Discord/YouTube/Twitter/Instagram/forums) is the eventual direction but
needs external integrations + credentials, deferred until the user asks.

**How to apply:** keep feed generation pure and side-effect-free. Do NOT add
outbound network/publish calls into the feed path without the user opting into
real posting (which would require the integrations skill + per-platform creds).
Feed is built once on duel stop (alongside the report), reset on duel start, and
rides the AleSnapshot to the UI.

## A.L.E. broadcast package: recording log + recap + narrated review

Beyond the feed, A.L.E. also produces a **broadcast package** per duel:
- A live **fight recording log** (`AleLogEntry[]`), attributed per actor (A = Player 1,
  B = Player 2, ale = the director). Recorded by the SAME per-frame polling AleBot
  already does (hits/crits/parry/block/dodge/KO from fighter state transitions;
  round-start/slow-mo from the director) — no combat-internal rewrites. Capped ring
  buffer; the log records live during the fight, recap/review are built on stop.
- A narrative **Match Recap** (`AleRecap`) and a ~10s **narrated highlight review**
  (`AleReview` = timed beats with caption + spoken line + camera), both pure builders
  in `three/ale/recap.ts` over the existing report + director highlights.
- The review plays back in-app via `components/AleReviewPlayer.tsx` using the browser
  `speechSynthesis` voice (NO external TTS service/credentials) + synced captions +
  per-beat camera cuts through the existing `onDuelCamera` setter.

**Why:** user direction — this applies to ALL contests/tests, with the end goal of
**ad-ready promo videos**, but their use is GATED on the AI brains achieving enough
**skill-based meta-play (parry, block, dodge, great timing)**. So the recap foregrounds
the parry/block/dodge/timing skill-meta and exposes a `skill.cleanTiming` gate the UI
surfaces as "ad-ready / not there yet". Actual video file capture/export and any
publishing remain deferred until the AI skill bar is met and the user asks.

**How to apply:** keep recap/review builders pure and deterministic (same duel →
same package). Narration must stay on the browser voice — do not reach for an
external TTS provider. Faithful pose-replay of the actual frames is still out of
scope here (the instant-replay follow-up task owns that); when it lands, the
narrated review's camera beats are the natural hook to drive it.
