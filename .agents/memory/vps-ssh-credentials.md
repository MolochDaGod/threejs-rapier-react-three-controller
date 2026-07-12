---
name: VPS SSH connection gotchas (Ubuntu game-server host)
description: Durable, non-sensitive lessons for SSHing from the Replit sandbox to the user's Ubuntu VPS to host the Animator game backend. No secret names or values — look those up in the secrets store at use time.
---

# VPS SSH connection gotchas

The user has an Ubuntu VPS (access details live in Replit secrets — read names
and values from the secrets store when needed, never record them here) intended
to host the Animator game backend (standalone `@workspace/api-server` game
server). The lessons below are the non-obvious parts that cost time.

## Gotcha: an OpenSSH private key pasted into a secret can be single-line
If a private-key secret has had its newlines stripped, `ssh-keygen`/`ssh` reject
it ("does not parse as a private key"). Reconstruct before use: keep the exact
`-----BEGIN OPENSSH PRIVATE KEY-----` / `-----END ...-----` header+footer, strip
stray spaces from the base64 body, then emit header + `fold -w 70` of the body +
footer. `ssh-keygen -y -f` then validates it.

## Reachability diagnosis
**Why it matters:** at one point the VPS IP responded on NO port (22, 80, 443,
~10 alt SSH ports) while outbound egress from the sandbox worked fine
(1.1.1.1:443 and github.com:22 both reachable). So an unreachable VPS is a
host-side problem (powered off / wrong-or-stale IP / provider firewall blocking
inbound), NOT a sandbox egress block — confirm with the user before re-attempting
provisioning.

## TLS constraint for wss
The Animator is served over HTTPS, so the browser only opens `wss://`. A bare IP
can't easily get a Let's Encrypt cert — a real browser-facing endpoint needs a
domain pointed at the host (then Caddy/nginx + Let's Encrypt) or another valid
cert. Ask the user for a domain.
