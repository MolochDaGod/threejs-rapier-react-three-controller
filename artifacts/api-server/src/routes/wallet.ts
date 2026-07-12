import { Router, type IRouter, type Response } from "express";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, walletLinksTable, walletNoncesTable } from "@workspace/db";
import { CreateWalletNonceBody, LinkWalletBody } from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import {
  buildOwnershipMessage,
  decodeSolanaAddress,
  verifyOwnershipSignature,
} from "../lib/walletVerify";

const router: IRouter = Router();

/** How long an issued ownership-proof nonce stays valid. */
const NONCE_TTL_MS = 5 * 60 * 1000;

/** Serialize a wallet row into the API `WalletInfo` shape. */
function toWalletInfo(row: typeof walletLinksTable.$inferSelect) {
  return {
    address: row.address,
    chain: row.chain,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Return the wallet linked to the current account (or null).
router.get("/wallet", requireAuth, async (req: AuthedRequest, res: Response) => {
  const [row] = await db
    .select()
    .from(walletLinksTable)
    .where(eq(walletLinksTable.ownerId, req.userId!))
    .limit(1);
  res.json({ wallet: row ? toWalletInfo(row) : null });
});

// Issue a one-time nonce + message for the user to sign in their wallet.
router.post("/wallet/nonce", requireAuth, async (req: AuthedRequest, res: Response) => {
  const parsed = CreateWalletNonceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { address } = parsed.data;
  if (!decodeSolanaAddress(address)) {
    res.status(400).json({ error: "Invalid wallet address" });
    return;
  }

  const nonce = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);

  // One outstanding nonce per user: overwrite any previous one.
  await db
    .insert(walletNoncesTable)
    .values({ ownerId: req.userId!, nonce, expiresAt })
    .onConflictDoUpdate({
      target: walletNoncesTable.ownerId,
      set: { nonce, expiresAt, createdAt: new Date() },
    });

  res.json({ nonce, message: buildOwnershipMessage(address, nonce) });
});

// Verify the signed nonce and link (or replace) the wallet on the account.
router.post("/wallet/link", requireAuth, async (req: AuthedRequest, res: Response) => {
  const parsed = LinkWalletBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { address, signature } = parsed.data;

  if (!decodeSolanaAddress(address)) {
    res.status(400).json({ error: "Invalid wallet address" });
    return;
  }

  // Load the nonce we issued this user; reject if missing or expired.
  const [nonceRow] = await db
    .select()
    .from(walletNoncesTable)
    .where(eq(walletNoncesTable.ownerId, req.userId!))
    .limit(1);
  if (!nonceRow || nonceRow.expiresAt.getTime() < Date.now()) {
    res.status(401).json({ error: "Nonce expired — start again" });
    return;
  }

  if (!verifyOwnershipSignature(address, nonceRow.nonce, signature)) {
    res.status(401).json({ error: "Signature did not verify" });
    return;
  }

  // Single-use nonce: consume it now that it has verified.
  await db.delete(walletNoncesTable).where(eq(walletNoncesTable.ownerId, req.userId!));

  // One wallet per account: insert or replace by ownerId.
  const [row] = await db
    .insert(walletLinksTable)
    .values({ ownerId: req.userId!, address, chain: "solana" })
    .onConflictDoUpdate({
      target: walletLinksTable.ownerId,
      set: { address, chain: "solana", updatedAt: new Date() },
    })
    .returning();

  res.json(toWalletInfo(row));
});

// Unlink whatever wallet is on the account (idempotent).
router.delete("/wallet", requireAuth, async (req: AuthedRequest, res: Response) => {
  await db.delete(walletLinksTable).where(eq(walletLinksTable.ownerId, req.userId!));
  res.status(204).end();
});

export default router;
