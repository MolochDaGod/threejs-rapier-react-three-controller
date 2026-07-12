---
name: Phantom wallet linking
description: Gotchas for the Phantom BrowserSDK + server-side ed25519 ownership proof (nonce sign/verify) in the Animator.
---

# Phantom wallet linking (Animator)

- **SDK needs a Node Buffer polyfill in Vite.** `@phantom/browser-sdk` imports Node's `buffer` module; Vite externalizes it for the browser and signing breaks at runtime (only a console *warning* at import time — easy to miss). Fix: add the `buffer` npm package and alias `buffer: "buffer/"` in `resolve.alias`.
- **`"embedded"` is NOT a valid `AuthProviderType`** in the BrowserSDK — use `providers: ["injected", "phantom"]`.
- `sdk.solana.signMessage(message: string)` returns `{ signature: Uint8Array, publicKey }` — encode with bs58 for transport; `getAddresses()` filter `addressType === "Solana"`.
- **Ownership proof pattern:** server issues a per-user single-use nonce (5-min TTL, upsert per ownerId); message is built deterministically from (address, nonce) on BOTH sides; verify with `nacl.sign.detached.verify(msgBytes, sig, bs58.decode(address))` — a Solana address IS the 32-byte ed25519 pubkey. Keep the verify helpers pure (no Express/DB) so forged/replay/wrong-address cases are unit-testable.
- Install fallback: `waitForPhantomExtension(timeout)` then branch — mobile → deeplink (`getDeeplinkToPhantom`), desktop → install page.

**Why:** the Buffer failure and the invalid-provider enum both fail silently or late; the nonce/verify shape is a security boundary that must stay byte-identical client/server.

**How to apply:** any wallet-signature feature (login-with-wallet, tx signing) should reuse `artifacts/api-server/src/lib/walletVerify.ts` and the client layer in `artifacts/animator/src/wallet/`.
