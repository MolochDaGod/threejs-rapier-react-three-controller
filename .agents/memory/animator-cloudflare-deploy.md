---
name: Cloudflare Pages + R2 deploy pattern
description: How the Animator static mirror deploys to Cloudflare and the sandbox/tooling gotchas hit doing it
---

**Rule:** Cloudflare builds set `VITE_ASSET_BASE_URL` to the R2 public bucket URL and strip media folders from the Pages upload; the default (unset) build stays same-origin for Replit. Never point API/auth base paths at the asset host — only media goes through `assetHost.ts`.

**Why:** `public/` media is ~383MB with files >25MB (Cloudflare Pages per-file limit); R2 offload is mandatory, and the split keeps one codebase serving both hosts.

**How to apply:**
- R2 via Cloudflare REST API (token from the Replit Cloudflare connection, `settings.api_key`): create bucket, `PUT .../domains/managed {enabled:true}` for a free `pub-*.r2.dev` public domain, `PUT .../cors` to allow GET/HEAD from `*` (three.js loaders + fonts need CORS).
- Upload objects with plain `PUT /accounts/:id/r2/buckets/:bucket/objects/:key` + correct Content-Type (glb=model/gltf-binary); ~8-way concurrency uploads 470 files/383MB in a few minutes.
- The token verify endpoint (`/user/tokens/verify`) can report "Invalid API Token" for account-scoped tokens that still work on `/accounts/*` — trust a real account call, not verify.
- Wrangler from the code_execution sandbox: `process.env` is undefined; nix `npx` shim needs `XDG_CONFIG_HOME`/`XDG_CACHE_HOME` set and node's nix bin dir prepended to a hand-built PATH. Pass the token via child-process env only.
- Fresh `*.pages.dev` subdomains can 522 for the first minutes (DNS settle) and the external screenshot tool may serve a cached error capture — verify with direct fetches of index.html/JS/SPA-fallback instead.
