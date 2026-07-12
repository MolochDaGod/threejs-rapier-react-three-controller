import { pgTable, text, serial, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Wallet links: a self-custodied crypto wallet (currently Solana / Phantom)
 * bound to a signed-in Clerk account. The app never holds keys — ownership is
 * proven by the user signing a server-issued nonce inside Phantom, which the
 * server verifies before storing the public address here.
 *
 * One wallet per account: `ownerId` is unique, so re-linking a different wallet
 * replaces the previous row (the "replace" flow).
 */
export const walletLinksTable = pgTable(
  "wallet_links",
  {
    id: serial("id").primaryKey(),
    /** Clerk user id of the account this wallet is linked to. */
    ownerId: text("owner_id").notNull(),
    /** Public wallet address (base58 for Solana). Never a private key. */
    address: text("address").notNull(),
    /** Chain family the address belongs to (currently always "solana"). */
    chain: text("chain").notNull().default("solana"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wallet_links_owner_idx").on(t.ownerId),
    index("wallet_links_address_idx").on(t.address),
  ],
);

export const insertWalletLinkSchema = createInsertSchema(walletLinksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWalletLink = z.infer<typeof insertWalletLinkSchema>;
export type WalletLink = typeof walletLinksTable.$inferSelect;

/**
 * One-time ownership-proof nonces. The server issues a random nonce per user
 * when they begin linking a wallet; the user signs a message containing it and
 * the server verifies the signature against the stored nonce, then deletes it
 * (single use). `ownerId` is unique so issuing a new nonce overwrites any
 * outstanding one for that user.
 */
export const walletNoncesTable = pgTable(
  "wallet_nonces",
  {
    id: serial("id").primaryKey(),
    /** Clerk user id the nonce was issued to. */
    ownerId: text("owner_id").notNull(),
    /** The random nonce the user must include in the signed message. */
    nonce: text("nonce").notNull(),
    /** When the nonce stops being valid. */
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("wallet_nonces_owner_idx").on(t.ownerId)],
);

export type WalletNonce = typeof walletNoncesTable.$inferSelect;
