---
name: Animator vitest OOM workaround
description: How to actually run the animator vitest suite without it being OOM-killed in the agent bash/notebook.
---

The animator app's vitest suite (heavy Vite + three config) is killed (exit -1, no
output) when run plainly in the agent bash, and the code_execution validation runner
for it kept returning CANCEL. The cause is default file-parallelism spinning up
multiple heavy workers under memory pressure (3 dev workflows also running).

**How to run it reliably from bash:**
`cd artifacts/animator && NODE_OPTIONS="--max-old-space-size=1536" pnpm exec vitest run --pool=forks --no-file-parallelism --reporter=dot`

**Why:** single-fork + no-file-parallelism keeps peak memory low enough to finish
(~17s, baseline 93 tests / 8 files). `--poolOptions` is NOT supported in vitest
4.1.8 — use `--pool=forks` only.

**How to apply:** when you need to verify animator tests and bash/notebook keep
dying, reach for this command instead of the default `run test`. The repo `test`
workflow does NOT cover animator (it filters voxel-engine/carrier which are deleted).
