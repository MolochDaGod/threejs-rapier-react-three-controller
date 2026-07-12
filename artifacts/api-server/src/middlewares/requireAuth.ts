import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";

/**
 * Express request augmented with the resolved Clerk user id. Routes behind
 * `requireAuth` can read `req.userId`.
 */
export interface AuthedRequest extends Request {
  userId?: string;
}

/** Reject the request unless it carries a valid Clerk session. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}

/**
 * Resolve a human display name for a Clerk user id. Falls back through
 * username → full name → email local-part → a short id so a post always has a
 * readable author label.
 */
export async function resolveDisplayName(userId: string): Promise<string> {
  try {
    const user = await clerkClient.users.getUser(userId);
    if (user.username) return user.username;
    const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    if (full) return full;
    const email = user.emailAddresses?.[0]?.emailAddress;
    if (email) return email.split("@")[0];
  } catch {
    /* fall through to a generic label */
  }
  return `Player ${userId.slice(-4)}`;
}
