---
name: Space-shooter netcode (Skyforge Squadron)
description: Authoritative-server + shared-sim + prediction/reconciliation/interpolation rules for the online arcade cabinet; covers the gotchas that broke or would break it.
---

# Online multiplayer netcode (arcade `skies` cabinet, `@workspace/space-net`)

Architecture (nickyvanurk/3d-multiplayer-browser-shooter): authoritative server,
ONE fixed-step sim shared verbatim by server + client, client prediction +
reconciliation for the local entity, entity interpolation for remotes.

## Entity model (multi-entity foundation)

The simulation now operates on a flat `entities: Map<string, EntityState>` world
(not just a `ships` list). Each `EntityState` carries:
- `kind: EntityKind` — `"fighter" | "mother_ship" | "fleet_unit" | "mine"`
- `owner: string` — player id that owns this entity
- `team: number` — team index (0 = unaffiliated)

Fighter entities keep `id === owner === player.id` so existing prediction/
reconciliation is unaffected.  Snapshots carry `entities[]` + `economy[]`
(one `PlayerEconomy` per player: `{playerId, controlledEntityId, credits}`).

The client finds its controlled entity via `economy.find(e => e.playerId === selfId)
.controlledEntityId` — this allows control to shift to a mother ship etc. without
changing `selfId`. Currently always equals `selfId` for fighters.

AI entity stub: `room.addAIEntity(kind, owner, team, shipType)` registers an entity
that gets `HOLD_CMD` (all-zero input) each tick. Real AI producers are wired in
later tasks.

## Non-negotiable rules

- **Shared sim is the contract.** The step integrator lives in the shared lib and
  is run byte-identically by server (per tick) and client (prediction + replay).
  Keep it pure (mutate-and-return, no globals, no randomness, no wall-clock) and
  clamp `dt` to the SAME range on BOTH sides, or prediction fights the server.
- **The shared lib must stay dependency-free** (no three / no ws / no node) so the
  browser client and node server can both import it. Geometry is plain numbers;
  the client maps yaw/pitch/roll onto a Three object, the server never renders.

- **Reconciliation:** on each snapshot, snap the local entity to the authoritative
  state, drop pending inputs with `seq <= ack`, then replay the remaining pending
  inputs through the shared step. Server snapshot must carry a PER-RECIPIENT `ack`
  (highest input seq it has processed for that client).

- **Interpolation clock must advance every frame, NOT per snapshot.**
  **Why:** computing render time as `lastSnapshot.time - delay` only changes when a
  snapshot arrives, so remotes visibly step/freeze at the snapshot rate (e.g.
  20 Hz) instead of interpolating smoothly. **How to apply:** keep a smoothed
  local→server time offset (update it on each snapshot:
  `offset += (snap.time - performance.now() - offset) * ~0.05`) and compute render
  time as `performance.now() + offset - interpDelay`. Pick `interpDelay` >= one
  snapshot interval (we use 120ms vs 50ms interval) so two snapshots always
  bracket the target.

- **Untrusted input guard.** The WS endpoint is public; a malformed frame with a
  NaN field, once fed to the shared sim, poisons the shared room state for EVERY
  player. Reject non-finite numeric input fields at enqueue, and reject
  stale/duplicate seqs with `cmd.seq <= lastSeq || queueAlreadyHasSeq`.

## Routing + hosting

- WS path is `/api/space`; the shared proxy forwards `/api/*` unrewritten, so the
  client connects to `${ws|wss}://${location.host}/api/space` (NOT the arcade base
  path). Server attaches a `noServer` WebSocketServer on the HTTP `upgrade` event
  and claims ONLY that path, leaving other upgrades alone. Capture the
  `http.Server` from `app.listen(...)` to attach.
- **Hosting = Reserved VM, not Autoscale.** State lives in server memory + long
  WS connections. Autoscale's multiple stateless instances would each hold a
  different room (players split) and cold-stops would drop matches. A single
  persistent instance is required.
- **The agent cannot set the deployment target.** Root `.replit` carries
  `[deployment] deploymentTarget` (this app: application router, all artifacts
  served by path in one deployment), but direct `.replit` edits are blocked and
  there is no `deployConfig()` callback. So the user MUST pick **Reserved VM** in
  the Publishing UI at publish time — guide them explicitly, since the `.replit`
  default may still read `autoscale`.
- The whole monorepo publishes as ONE deployment: `/` → Game Studio, `/arcade/`
  → arcade (Skyforge lives here), `/api` → WS server; mockup-sandbox has no
  `[services.production]` so it's dev-only. All three production builds must
  succeed or the publish fails. api-server prod bundle (`dist/index.mjs`) boots
  with only `PORT` (no DATABASE_URL) and serves `/api/healthz` 200.

## Verifying without a browser

The arcade's Puter guest gate is a cross-origin popup that blocks headless
screenshots, so the cabinet can't be auto-screenshotted. Validate the netcode
with a node WS integration test instead (two fake clients connect, join, stream
input, assert both ships appear in snapshots, `ack` advances, positions move).
See `artifacts/api-server/scripts/space-net-itest.mjs`.
