/**
 * Grudge ID auth — a thin typed wrapper over the puter.js v2 SDK.
 *
 * "Grudge ID" is the user-facing name for a Puter account: the SDK's own popup
 * handles Grudge ID (username), email, sign-up, and password recovery, so we
 * never touch credentials ourselves. Guests are real accounts too
 * (`attempt_temp_user_creation`) — they get a persistent per-account id, and a
 * later plain `signIn()` upgrades the same account in place, keeping its data.
 */

export interface GrudgeUser {
  username: string;
  uuid?: string;
  email?: string;
  /** True for temporary guest accounts (the only reliable guest signal). */
  is_temp?: boolean;
}

interface PuterAuth {
  isSignedIn: () => boolean;
  getUser: () => Promise<GrudgeUser>;
  signIn: (opts?: { attempt_temp_user_creation?: boolean }) => Promise<unknown>;
  signOut: () => void | Promise<void>;
}

interface PuterSdk {
  auth: PuterAuth;
}

declare global {
  interface Window {
    puter?: PuterSdk;
  }
}

/** The SDK ships via a <script> tag in index.html; null until it has loaded. */
function sdk(): PuterSdk | null {
  return typeof window !== "undefined" && window.puter ? window.puter : null;
}

/** Wait (briefly) for the puter.js script tag to finish loading. */
export async function waitForSdk(timeoutMs = 6000): Promise<PuterSdk | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const p = sdk();
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  return sdk();
}

/** Restore an existing session without any UI. Null when signed out. */
export async function restoreSession(): Promise<GrudgeUser | null> {
  const p = await waitForSdk();
  if (!p) return null;
  try {
    if (!p.auth.isSignedIn()) return null;
    return await p.auth.getUser();
  } catch {
    return null;
  }
}

/** True when the user closed/cancelled the SDK's sign-in popup (soft no-op). */
function isCancel(err: unknown): boolean {
  const msg = String((err as { message?: string } | null)?.message ?? err ?? "").toLowerCase();
  return msg.includes("cancel") || msg.includes("close") || msg.includes("abort");
}

/**
 * Sign in with a Grudge ID. `asGuest` provisions a temporary guest account
 * silently (no popup); the plain call opens the SDK popup and also serves as
 * the in-place guest→full upgrade. Returns null on user-cancel.
 */
export async function signIn(opts?: { asGuest?: boolean }): Promise<GrudgeUser | null> {
  const p = await waitForSdk();
  if (!p) throw new Error("Grudge ID service failed to load — check your connection.");
  try {
    const res = (await p.auth.signIn(
      opts?.asGuest ? { attempt_temp_user_creation: true } : undefined,
    )) as { success?: boolean; error?: { message?: string } } | undefined;
    // The SDK can resolve with { success: false } instead of throwing.
    if (res && res.success === false) {
      throw new Error(res.error?.message || "Sign-in failed.");
    }
    return await p.auth.getUser();
  } catch (err) {
    if (isCancel(err)) return null;
    throw err;
  }
}

export async function signOut(): Promise<void> {
  const p = sdk();
  if (!p) return;
  try {
    await p.auth.signOut();
  } catch {
    /* already signed out */
  }
}
