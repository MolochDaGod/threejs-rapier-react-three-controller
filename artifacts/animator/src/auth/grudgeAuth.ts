/**
 * Grudge ID auth — Puter.js v2 SDK + fleet JWT bridge.
 *
 * Wires into existing production stack (does NOT invent a parallel identity DB):
 *   1. Puter popup (username / email / guest) via puter.auth
 *   2. POST same-origin /api/auth/puter-sso|puter → Railway Postgres users/accounts
 *      (id.grudge-studio.com rewrite → grudge-api-production)
 *   3. Optional full web SSO via id.grudge-studio.com (buildFleetLoginUrl)
 *
 * SSOT for characters/account bag remains Railway JWT on approved token keys.
 * Puter UUID is stored only under puter_* keys — never as grudge_id.
 */

import { apiUrl, clearFleetToken, readFleetToken, writeFleetToken } from "./fleetCore";

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

/** Cache Puter identity only — never overwrite Railway grudge_id with puter uuid. */
function storePuterHints(user: GrudgeUser): void {
  try {
    if (user.uuid) localStorage.setItem("puter_uuid", user.uuid);
    if (user.username) {
      localStorage.setItem("puter_username", user.username);
      // Display hint only when we have no fleet username yet
      if (!localStorage.getItem("grudge_username")) {
        localStorage.setItem("grudge_username", user.username);
      }
    }
  } catch {
    /* private mode */
  }
}

/** Persist Railway account fields from puter-sso / puter response (authoritative). */
function storeGrudgeAccountFromAuth(data: {
  grudgeId?: string;
  grudge_id?: string;
  username?: string;
  userId?: string;
  user?: { grudgeId?: string; username?: string; id?: string };
}): void {
  try {
    const gid = data.grudgeId || data.grudge_id || data.user?.grudgeId;
    if (gid) {
      localStorage.setItem("grudge_id", gid);
      localStorage.setItem("grudge_account_id", gid);
    }
    const name = data.username || data.user?.username;
    if (name) localStorage.setItem("grudge_username", name);
    const uid = data.userId || data.user?.id;
    if (uid) localStorage.setItem("grudge_user_id", uid);
  } catch {
    /* */
  }
}

/**
 * Exchange Puter identity for a Grudge fleet JWT (Railway characters/account).
 * Contract matches grudge-api `POST /api/auth/puter` + `/puter-sso`
 * (puterUuid|puterId, puterUsername|displayName, email).
 * Does not clear existing SSO JWTs on failure.
 */
export async function linkPuterToGrudgeId(opts?: {
  force?: boolean;
  user?: GrudgeUser | null;
}): Promise<boolean> {
  if (typeof window === "undefined") return false;

  // Prefer existing fleet SSO (web login / launcher handoff) — never clobber it.
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

  storePuterHints(user);

  // Railway auth.ts accepts puterUuid || puterId and puterUsername || displayName.
  const puterUuid = user.uuid || user.username || "";
  const body = {
    puterId: puterUuid,
    puterUuid,
    puterUsername: user.username,
    displayName: user.username,
    email: user.email,
  };

  // Prefer puter-sso (scoped SSO payload), then puter (SPA silent re-auth).
  // Same-origin first so Vercel rewrites hit id → Railway without CORS splits.
  const endpoints = [apiUrl("/api/auth/puter-sso"), apiUrl("/api/auth/puter")];

  for (const url of endpoints) {
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
        success?: boolean;
        token?: string;
        sessionToken?: string;
        access_token?: string;
        sso_token?: string;
        grudge_token?: string;
        grudgeId?: string;
        grudge_id?: string;
        username?: string;
        userId?: string;
        user?: { grudgeId?: string; username?: string; id?: string };
      };
      if (data.success === false) continue;
      const token =
        data.token ||
        data.sessionToken ||
        data.sso_token ||
        data.access_token ||
        data.grudge_token;
      if (!token) continue;

      writeFleetToken(token);
      storeGrudgeAccountFromAuth(data);
      try {
        if (user.uuid) localStorage.setItem(PUTER_LINK_FLAG, user.uuid);
      } catch {
        /* */
      }
      return true;
    } catch {
      /* try next endpoint */
    }
  }

  // Soft success if JWT already present from SSO handoff / prior session
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
    storePuterHints(user);
    // Bridge Puter → Railway JWT so /api/characters works for this account.
    await linkPuterToGrudgeId({ user, force: true });
    return user;
  } catch (err) {
    if (isCancel(err)) return null;
    throw err;
  }
}

/**
 * Sign out of Puter only by default.
 * Pass `{ clearFleet: true }` when switching accounts (landing "Switch account").
 */
export async function signOut(opts?: { clearFleet?: boolean }): Promise<void> {
  const p = sdk();
  if (p) {
    try {
      await p.auth.signOut();
    } catch {
      /* already signed out */
    }
  }
  try {
    localStorage.removeItem(PUTER_LINK_FLAG);
    localStorage.removeItem("puter_uuid");
    localStorage.removeItem("puter_username");
  } catch {
    /* */
  }
  if (opts?.clearFleet !== false) {
    // Switching identity must drop JWT so roster does not leak across accounts.
    clearFleetToken();
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
  let username: string | null = null;
  try {
    // Prefer Railway grudge_id — never fall back to puter uuid as account id.
    grudgeId =
      localStorage.getItem("grudge_id") || localStorage.getItem("grudge_account_id") || null;
    username =
      localStorage.getItem("grudge_username") ||
      puterUser?.username ||
      localStorage.getItem("puter_username");
  } catch {
    username = puterUser?.username ?? null;
  }
  return {
    puterUser,
    hasFleetJwt: !!readFleetToken(),
    grudgeId,
    username,
  };
}
