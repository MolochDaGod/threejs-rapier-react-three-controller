/**
 * Fleet-canonical Grudge Studio account wallets surface.
 *
 * Same host every Grudge Studio product uses for linked Solana wallets + GBux
 * (wallet.grudge-studio.com → Grudge ID session → Railway /api/me/wallets).
 */

/** Production account-wallets app (shared across the fleet). */
export const GRUDGE_WALLET_URL = "https://wallet.grudge-studio.com/";

/**
 * Open the canonical account wallets page. Uses a new tab so the player stays
 * in-game; SSO cookies on *.grudge-studio.com carry the Grudge ID session.
 */
export function openGrudgeWallet(): void {
  // window.open can return null under popup blockers — fall back to top navigation.
  const win = window.open(GRUDGE_WALLET_URL, "_blank", "noopener,noreferrer");
  if (!win) {
    window.location.assign(GRUDGE_WALLET_URL);
  }
}
