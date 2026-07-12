---
name: Tailwind v4 content-scan OOM
description: Tailwind v4 auto content detection crawls large non-gitignored workspace dirs and OOM-kills the vite dev server on first CSS build.
---

# Tailwind v4 content-scan OOM

A vite dev server that boots fine ("ready"), serves `/` (HTML) 200, then gets a
silent `Killed` (SIGKILL) the moment the first **CSS** request is served — and is
NOT caught by `--max-old-space-size` — is almost always Tailwind v4's automatic
content detection exploding memory off-heap.

**Why:** Tailwind v4 (`@import "tailwindcss"` with no source scoping) auto-detects
content by walking from the **git repo root**, respecting `.gitignore`. Its scanner
runs in the native Rust (oxide) engine, so the allocation is off the JS heap — a
node heap cap won't trap it, the kernel cgroup OOM-killer reaps the process with no
JS stack trace. If a huge directory at the workspace root is **not gitignored**
(here `attached_assets/` was committed/tracked at ~3.9GB), Tailwind crawls all of it
on the first CSS build and dies. Binary files are skipped by extension, but enough
text/volume still blows it up. Symptom escalates as the dir grows, so it can look
"intermittent / suddenly broken."

**How to apply:** Scope Tailwind's scan to the app's own source. In the app CSS:
```css
@import "tailwindcss" source(none);
@source "../src";
@source "../index.html";
```
(paths relative to the CSS file). Or `@import "tailwindcss" source("../")` to confine
auto-detection to the app dir. Either keeps it off the workspace-root assets.

**Debugging gotchas that wasted time here:**
- The workflow harness logs only the boot snapshot ("ready"); the OOM death leaves
  NO trace in the workflow log. Reproduce manually with the EXACT workflow command
  (`PORT=… BASE_PATH=… pnpm --filter <app> run dev`) and curl the **CSS** route
  (`/src/index.css`) — `curl /` alone returns 200 and hides the bug.
- `memory.peak` near the cgroup `memory.max` (`/sys/fs/cgroup/memory.*`) is the tell.
- Don't blame post-merge typecheck/test memory storms; this OOMs in a calm env too.
- `attached_assets` being tracked in git (not gitignored) is the underlying enabler;
  any workspace-root tool that respects .gitignore will choke on it.
