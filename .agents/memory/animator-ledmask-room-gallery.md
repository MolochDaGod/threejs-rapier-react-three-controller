---
name: Animator room poster strip (+ current home routing)
description: RoomGallery poster strip is the PHONE home surface (doors mode, touch-gated); LED Mask no longer hosts it. Desktop home stays DoorSelect; Grudge ID landing gates both.
---

# Room poster strip + home routing

**LED Mask is NOT home (July 2026).** The app boots into mode `"landing"`
(Grudge ID / puter.js sign-in page, no shell chrome) and `"doors"` is the home
surface: every surface exit (Danger, Dressing Room, Avatar, Lobby, Voxel
Editor) returns to `"doors"`, and `LedMaskMode`'s own exit goes to `"doors"`
too. LED Mask survives as a regular nav entry / `?door=ledmask` deep link.
An earlier iteration had ledmask as home — don't reintroduce that.

**RoomGallery lives on the doors home, PHONE ONLY (July 2026).** The poster
strip was removed from LED Mask entirely; the `"doors"` branch renders it
inside a full-screen `.roomgal-home` wrapper when `useDevice().touchUI`
(capability-gated, never viewport width), while desktop keeps the DoorSelect
grid. Its `onNavigate` gets App's `navigate` directly — `RoomTarget` is a
subset of `Mode`. LED Mask stays reachable on phone only via the shell
launcher (no gallery card targets it).

**Room selector = left-to-right poster strip** (`RoomGallery`, registry in
`ledMaskRooms.ts`, 6 rooms incl. Avatar Edit). All tall posters sit side by
side in a horizontally scrollable, scroll-snap strip; clicking a poster enters
that room directly. This replaced an earlier phone-style centered carousel
(index/localStorage selection, dots, custom drag) — none of that survives.

**Touch affordances are capability-gated, not width-gated.** Touch devices pan
the strip natively (momentum scroll + snap — never write custom drag code for
a scroll container); desktop gets nudge arrows + window-level ←/→ keys (skip
when focus is in an INPUT/TEXTAREA; listener not bound at all when
`useDevice().touchUI`). Poster taglines reveal on hover on desktop but are
always visible under the `html.is-touch` root class (applied by `useDevice`,
since touch has no hover).

**Loader = the room's square scene shown full-screen.** Clicking a card sets
`entering`, renders a fixed full-viewport overlay from the room's `scene` art,
then `onNavigate(target)` after ~900ms. Dismiss is **implicit**: navigation
swaps App mode which unmounts the hosting surface (now the doors branch); the
timeout is cleared on unmount. Lift the overlay to App level if it ever must
persist across the next surface's mount.

**Rolling poster backdrop.** The whole ledmask page has a decorative
`position: fixed` background layer: the 6 posters repeated **3×** in a flex
track animated `translateX(0 → -33.3333%)` (exactly one set width → seamless
loop; keep copy count and percentage in lockstep). It is `aria-hidden` +
`pointer-events: none`, heavily veiled for readability, and the animation is
disabled under `prefers-reduced-motion`. Content (`.ledmask-head`,
`.ledmask-grid`) sits at z-index 1 above it; the sticky stage stays at z 5.

**Sticky stage:** `.ledmask-stage` is `position: sticky; top: 0; align-self:
start` so the face stays in frame while the controls column scrolls; ≤900px
the canvas drops `aspect-ratio` for a fixed ~38vh height.

**VOXGRUDGE has no screen.** No PvP-arena mode exists; both the VOXGRUDGE and
Lobby cards target `lobby` until a real arena is built (repoint in
`ledMaskRooms.ts`).

Art is served from `public/rooms/` (BASE_URL-aware); do NOT import from
`attached_assets/` and do NOT add `@workspace` imports here.
