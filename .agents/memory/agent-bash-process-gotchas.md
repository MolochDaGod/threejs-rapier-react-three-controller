---
name: Agent bash process + workflow gotchas
description: Non-obvious behaviors when starting/killing long-running processes from the agent bash tool in the Replit env.
---

# Long-running processes from the agent bash tool

- **Detached servers do NOT survive across bash tool calls.** Even
  `nohup setsid env ... pnpm dev > log 2>&1 < /dev/null & disown` gets torn down
  when the bash invocation returns (the tool kills the process group). Within the
  *same* command a follow-up `sleep`+`curl` can see it serving 200, but by the
  next tool call it is gone (proxy → 502). The ONLY durable way to keep a dev
  server alive is the workflow harness (`restart_workflow`).
  **How to apply:** don't try to background a server in one call and screenshot it
  in the next — it will be dead. Visual verification must go through a healthy
  workflow.

- **`pkill -f <pat>` / `pgrep -f <pat>` match the agent's OWN command line.** The
  bash command string you run contains the pattern, so `pkill -f 'vite.config.ts'`
  kills your own shell → command exits with code **143** and "no output". This is
  NOT the target process crashing.
  **How to apply:** use a regex that matches the target but NOT your literal
  command, e.g. `pkill -f "vite[.]config"` (the `[.]` in your command line won't
  match the regex's literal-dot requirement against the real process cmdline), or
  kill by numeric PID.

- **Screenshot/preview is gated on workflow status, not just port 200.** The
  path-based proxy at `localhost:80` will route to whatever holds the port
  (returns 200 via curl), but the `app_preview` screenshot uses a separate river
  preview proxy that requires the workflow to be **running**; if the workflow is
  "failed" it returns `PAGE_UNREACHABLE` / `ERR_HTTP_RESPONSE_CODE_FAILURE` even
  while curl gets 200.
