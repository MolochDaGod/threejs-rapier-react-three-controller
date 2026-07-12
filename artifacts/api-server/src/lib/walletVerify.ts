/**
 * Pure helpers for the wallet ownership-proof flow (no Express/DB deps so they
 * can be unit-tested directly). The client signs a deterministic message built
 * from (address, nonce); the server rebuilds the same message and verifies the
 * ed25519 signature against the address's public key.
 */
import nacl from "tweetnacl";
import bs58 from "bs58";

/**
 * Build the exact human-readable message a user signs to prove wallet
 * ownership. Deterministic from (address, nonce) so the server can rebuild and
 * compare byte-for-byte against what was signed.
 */
export function buildOwnershipMessage(address: string, nonce: string): string {
  return [
    "Grudge Studio — verify wallet ownership",
    "",
    "Sign this message to link this wallet to your account.",
    "This is free and does not authorize any transaction.",
    "",
    `Wallet: ${address}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

/** A Solana address is 32 bytes once base58-decoded. */
export function decodeSolanaAddress(address: string): Uint8Array | null {
  try {
    const bytes = bs58.decode(address);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Decode a signature that may arrive as base58 (Phantom's default) or, as a
 * fallback, base64 / base64url. Returns 64 raw bytes or null.
 */
export function decodeSignature(signature: string): Uint8Array | null {
  try {
    const b58 = bs58.decode(signature);
    if (b58.length === 64) return b58;
  } catch {
    /* not base58, try base64 below */
  }
  try {
    const normalized = signature.replace(/-/g, "+").replace(/_/g, "/");
    const b64 = new Uint8Array(Buffer.from(normalized, "base64"));
    if (b64.length === 64) return b64;
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Verify that `signature` is a valid ed25519 signature of the ownership
 * message for (address, nonce), signed by the wallet whose public key IS the
 * address. Returns false on any malformed input.
 */
export function verifyOwnershipSignature(
  address: string,
  nonce: string,
  signature: string,
): boolean {
  const pubkey = decodeSolanaAddress(address);
  const sig = decodeSignature(signature);
  if (!pubkey || !sig) return false;
  const messageBytes = new TextEncoder().encode(buildOwnershipMessage(address, nonce));
  return nacl.sign.detached.verify(messageBytes, sig, pubkey);
}
