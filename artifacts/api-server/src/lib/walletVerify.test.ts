import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  buildOwnershipMessage,
  decodeSolanaAddress,
  decodeSignature,
  verifyOwnershipSignature,
} from "./walletVerify";

/** Make a throwaway Solana-style keypair and sign the ownership message. */
function signedFixture(nonce = "test-nonce-123") {
  const kp = nacl.sign.keyPair();
  const address = bs58.encode(kp.publicKey);
  const message = buildOwnershipMessage(address, nonce);
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
  return { kp, address, nonce, signature: bs58.encode(sig), rawSig: sig };
}

describe("buildOwnershipMessage", () => {
  it("is deterministic and embeds address + nonce", () => {
    const a = buildOwnershipMessage("addr", "n1");
    expect(a).toBe(buildOwnershipMessage("addr", "n1"));
    expect(a).toContain("Wallet: addr");
    expect(a).toContain("Nonce: n1");
    expect(a).not.toBe(buildOwnershipMessage("addr", "n2"));
  });
});

describe("decodeSolanaAddress", () => {
  it("accepts a 32-byte base58 pubkey", () => {
    const { address } = signedFixture();
    expect(decodeSolanaAddress(address)).toHaveLength(32);
  });

  it("rejects junk and wrong-length input", () => {
    expect(decodeSolanaAddress("not-base58-0OIl")).toBeNull();
    expect(decodeSolanaAddress(bs58.encode(new Uint8Array(16)))).toBeNull();
    expect(decodeSolanaAddress("")).toBeNull();
  });
});

describe("decodeSignature", () => {
  it("decodes base58 signatures", () => {
    const { signature, rawSig } = signedFixture();
    expect(decodeSignature(signature)).toEqual(rawSig);
  });

  it("decodes base64 and base64url signatures", () => {
    const { rawSig } = signedFixture();
    const b64 = Buffer.from(rawSig).toString("base64");
    const b64url = Buffer.from(rawSig).toString("base64url");
    expect(decodeSignature(b64)).toEqual(rawSig);
    expect(decodeSignature(b64url)).toEqual(rawSig);
  });

  it("rejects wrong-length or garbage input", () => {
    expect(decodeSignature("abc")).toBeNull();
    expect(decodeSignature(bs58.encode(new Uint8Array(10)))).toBeNull();
  });
});

describe("verifyOwnershipSignature", () => {
  it("accepts a genuine signature from the wallet's own key", () => {
    const { address, nonce, signature } = signedFixture();
    expect(verifyOwnershipSignature(address, nonce, signature)).toBe(true);
  });

  it("rejects a signature made by a DIFFERENT key (forged link)", () => {
    const victim = nacl.sign.keyPair();
    const attacker = nacl.sign.keyPair();
    const victimAddress = bs58.encode(victim.publicKey);
    const nonce = "nonce-forge";
    const message = buildOwnershipMessage(victimAddress, nonce);
    const forged = nacl.sign.detached(
      new TextEncoder().encode(message),
      attacker.secretKey,
    );
    expect(verifyOwnershipSignature(victimAddress, nonce, bs58.encode(forged))).toBe(false);
  });

  it("rejects a signature over a different nonce (replay)", () => {
    const { address, signature } = signedFixture("nonce-A");
    expect(verifyOwnershipSignature(address, "nonce-B", signature)).toBe(false);
  });

  it("rejects a signature presented for a different address", () => {
    const { nonce, signature } = signedFixture();
    const other = bs58.encode(nacl.sign.keyPair().publicKey);
    expect(verifyOwnershipSignature(other, nonce, signature)).toBe(false);
  });

  it("rejects malformed inputs outright", () => {
    expect(verifyOwnershipSignature("junk", "n", "sig")).toBe(false);
    expect(verifyOwnershipSignature("", "", "")).toBe(false);
  });
});
