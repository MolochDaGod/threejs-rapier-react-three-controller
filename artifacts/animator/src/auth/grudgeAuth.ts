/**
 * Grudge ID auth — Puter.js v2 SDK + fleet JWT bridge.
 *
 * "Grudge ID" is the user-facing name for identity:
 *   1. Puter popup (username / email / guest) via puter.auth
 *   2. POST /api/auth/puter-sso (or /puter) → Railway JWT for characters/account
 *   3. Optional full web SSO via id.grudge-studio.com (buildFleetLoginUrl)
 *
 * Guests are real Puter temp accounts; a later full sign-in upgrades in place.
 */

import { apiUrl, readFleetToken, writeFleetToken } from "./fleetCore";

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

const PUTER_LINK_FLAG = "grudge.puter.linked_uuid";

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

function storeAccountHints(user: GrudgeUser): void {
  try {
    if (user.uuid) {
      localStorage.setItem("grudge_id", user.uuid);
      localStorage.setItem("grudge_account_id", user.uuid);
      localStorage.setItem("puter_uuid", user.uuid);
    }
    if (user.username) {
      localStorage.setItem("grudge_username", user.username);
      localStorage.setItem("puter_username", user.username);
    }
  } catch {
    /* private mode */
  }
}

/**
 * Exchange Puter identity for a Grudge fleet JWT (Railway characters/account).
 * Same-origin `/api/auth/*` → id.grudge-studio.com / Railway.
 * Returns true when a JWT is present after the attempt.
 */
export async function linkPuterToGrudgeId(opts?: {
  force?: boolean;
  user?: GrudgeUser | null;
}): Promise<boolean> {
  if (typeof window === "undefined") return false;

  if (!opts?.force && readFleetToken()) {
    return true;
  }

  let user = opts?.user ?? null;
  if (!user) {
    user = await restoreSession();
  }
  if (!user?.uuid && !user?.username) {
    return !!readFleetToken();
  }

  if (!opts?.force && user.uuid) {
    try {
      if (localStorage.getItem(PUTER_LINK_FLAG) === user.uuid && readFleetToken()) {
        return true;
      }
    } catch {
      /* */
    }
  }

  const puterId = user.uuid || user.username;
  const bodies: Record<string, unknown>[] = [
    {
      puterId,
      puter_id: puterId,
      uuid: user.uuid,
      username: user.username,
      email: user.email,
      is_temp: user.is_temp,
      provider: "puter",
    },
    {
      puterId,
      username: user.username,
    },
  ];

  const endpoints = [
    apiUrl("/api/auth/puter-sso"),
    apiUrl("/api/auth/puter"),
    apiUrl("/api/auth/grudge-bridge"),
  ];

  for (const url of endpoints) {
    for (const body of bodies) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "include",
          body: JSON.stringify(body),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          token?: string;
          access_token?: string;
          sso_token?: string;
          grudge_token?: string;
          grudge_id?: string;
          grudgeId?: string;
          username?: string;
        };
        const token =
          data.sso_token || data.token || data.access_token || data.grudge_token;
        if (token) {
          writeFleetToken(token);
          try {
            if (user.uuid) localStorage.setItem(PUTER_LINK_FLAG, user.uuid);
            const gid = data.grudge_id || data.grudgeId;
            if (gid) {
              localStorage.setItem("grudge_id", gid);
              localStorage.setItem("grudge_account_id", gid);
            }
            if (data.username) localStorage.setItem("grudge_username", data.username);
          } catch {
            /* */
          }
          storeAccountHints(user);
          return true;
        }
      } catch {
        /* try next */
      }
    }
  }

  // Soft success if JWT already present from SSO handoff
  return !!readFleetToken();
}

/**
 * Sign in with a Grudge ID. `asGuest` provisions a temporary guest account
 * silently (no popup); the plain call opens the SDK popup and also serves as
 * the in-place guest→full upgrade. Returns null on user-cancel.
 * After success, attempts Puter → fleet JWT bridge for account connections.
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
    const user = await p.auth.getUser();
    storeAccountHints(user);
    // Bridge Puter → Railway JWT so /api/characters works for this account.
    await linkPuterToGrudgeId({ user, force: true });
    return user;
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
  try {
    localStorage.removeItem(PUTER_LINK_FLAG);
  } catch {
    /* */
  }
}

/** Snapshot of Puter + fleet connection state for landing / account UI. */
export async function getAccountConnectionStatus(): Promise<{
  puterUser: GrudgeUser | null;
  hasFleetJwt: boolean;
  grudgeId: string | null;
  username: string | null;
}> {
  const puterUser = await restoreSession();
  let grudgeId: string | null = null;
  let username: string | null = puterUser?.username ?? null;
  try {
    grudgeId =
      localStorage.getItem("grudge_id") ||
      localStorage.getItem("grudge_account_id") ||
      puterUser?.uuid ||
      null;
    username =
      username ||
      localStorage.getItem("grudge_username") ||
      localStorage.getItem("puter_username");
  } catch {
    /* */
  }
  return {
    puterUser,
    hasFleetJwt: !!readFleetToken(),
    grudgeId,
    username,
  };
}
