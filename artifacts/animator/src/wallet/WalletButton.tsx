/**
 * Combined GBUX + wallet chrome control.
 *
 * One pill shows the player's GBUX balance and wallet link status. Click opens
 * the fleet-canonical account wallets surface at wallet.grudge-studio.com —
 * the same destination every Grudge Studio app uses for linked Solana wallets
 * and GBux (Railway /api/me/wallets via Grudge ID session).
 */
import { Wallet, ExternalLink } from "lucide-react";
import { useWallet } from "./useWallet";
import { useGbux, formatGbux } from "../lib/gbux";
import { GRUDGE_WALLET_URL, openGrudgeWallet } from "./grudgeWallet";
import "./wallet.css";

export function WalletButton() {
  const wallet = useWallet();
  const gbux = useGbux();

  const busy = wallet.phase !== "idle";
  const linked = wallet.linkedWallet;

  const phaseLabel: Record<string, string> = {
    connecting: "Connecting…",
    signing: "Check Phantom…",
    linking: "Linking…",
    unlinking: "Unlinking…",
  };

  const label = busy
    ? (phaseLabel[wallet.phase] ?? "Working…")
    : linked
      ? `GBUX ${formatGbux(gbux)} · wallet linked — open account wallets`
      : `GBUX ${formatGbux(gbux)} — open account wallets`;

  return (
    <div className="wallet-root">
      <button
        type="button"
        className={`wallet-pill combined ${linked ? "linked" : ""} ${busy ? "busy" : ""}`}
        onClick={() => openGrudgeWallet()}
        aria-label={label}
        aria-busy={busy}
        title={`${label}\n${GRUDGE_WALLET_URL}`}
        data-tip="Account wallets & GBUX — opens Grudge Studio wallet"
      >
        <Wallet size={15} className="wallet-pill-icon" aria-hidden />
        <span className="wallet-gbux-inline">
          <span className="wallet-gbux-amount">{formatGbux(gbux)}</span>
          <span className="wallet-gbux-unit">GBUX</span>
        </span>
        {linked && <span className="wallet-pill-dot" aria-hidden />}
        <ExternalLink size={12} className="wallet-pill-ext" aria-hidden />
      </button>
    </div>
  );
}
