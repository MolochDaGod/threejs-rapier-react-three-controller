/**
 * Wallet chrome control: a compact pill next to the app launcher plus a
 * popover "account card" that shows the signed-in email alongside the linked
 * wallet, with connect / disconnect / replace / unlink actions and an install
 * fallback when Phantom isn't available.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useUser } from "@clerk/clerk-react";
import { Wallet, Unlink, RefreshCcw, LogOut, ExternalLink, X } from "lucide-react";
import { useWallet } from "./useWallet";
import { PHANTOM_INSTALL_URL, shortenAddress } from "./phantom";
import { useGbux, formatGbux } from "../lib/gbux";
import "./wallet.css";

export function WalletButton() {
  const wallet = useWallet();
  const { user } = useUser();
  const gbux = useGbux();
  const [open, setOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const busy = wallet.phase !== "idle";
  const linked = wallet.linkedWallet;
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const phaseLabel: Record<string, string> = {
    connecting: "Connecting…",
    signing: "Check Phantom…",
    linking: "Linking…",
    unlinking: "Unlinking…",
  };

  return (
    <div className="wallet-root" ref={cardRef}>
      <button
        className={`wallet-pill ${linked ? "linked" : ""} ${busy ? "busy" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={busy ? `Wallet — ${phaseLabel[wallet.phase] ?? "working"}` : "Wallet"}
        aria-busy={busy}
        title={busy ? (phaseLabel[wallet.phase] ?? "Working…") : "Wallet"}
      >
        <Wallet size={16} className="wallet-pill-icon" />
        {linked && <span className="wallet-pill-dot" />}
      </button>

      <div className="wallet-gbux" title="GBUX balance">
        {formatGbux(gbux)} <span className="wallet-gbux-unit">GBUX</span>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="wallet-card"
            role="dialog"
            aria-label="Wallet"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            <div className="wallet-card-head">
              <span>Account</span>
              <button className="wallet-icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                <X size={14} />
              </button>
            </div>

            {wallet.isSignedIn ? (
              <div className="wallet-identity">
                {email && <div className="wallet-email">{email}</div>}
                <div className="wallet-linked-row">
                  <span className="wallet-linked-label">Linked wallet</span>
                  {wallet.linkedLoading ? (
                    <span className="wallet-muted">Loading…</span>
                  ) : linked ? (
                    <span className="wallet-address" title={linked.address}>
                      {shortenAddress(linked.address, 6, 6)}
                    </span>
                  ) : (
                    <span className="wallet-muted">None</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="wallet-identity">
                <div className="wallet-muted">
                  Sign in to save a wallet to your account. You can still connect Phantom for
                  this session.
                </div>
              </div>
            )}

            {wallet.needsInstall && (
              <div className="wallet-note">
                Phantom isn&apos;t installed in this browser.
                <a
                  className="wallet-install-link"
                  href={PHANTOM_INSTALL_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Get Phantom <ExternalLink size={12} />
                </a>
              </div>
            )}
            {wallet.error && <div className="wallet-note error">{wallet.error}</div>}

            <div className="wallet-actions">
              {!linked && (
                <button
                  className="wallet-action primary"
                  disabled={busy}
                  onClick={() => void wallet.connectAndLink()}
                >
                  <Wallet size={14} />
                  {busy
                    ? (phaseLabel[wallet.phase] ?? "Working…")
                    : wallet.isSignedIn
                      ? "Connect Phantom & link"
                      : "Connect Phantom"}
                </button>
              )}
              {linked && (
                <button
                  className="wallet-action"
                  disabled={busy}
                  onClick={() => void wallet.connectAndLink()}
                  title="Connect a different wallet and link it instead"
                >
                  <RefreshCcw size={14} /> Replace wallet
                </button>
              )}
              {linked && (
                <button
                  className="wallet-action danger"
                  disabled={busy}
                  onClick={() => void wallet.unlink()}
                >
                  <Unlink size={14} /> Unlink from account
                </button>
              )}
              {wallet.connectedAddress && (
                <button
                  className="wallet-action"
                  disabled={busy}
                  onClick={() => void wallet.disconnect()}
                  title="Disconnect this browser session (keeps the account link)"
                >
                  <LogOut size={14} /> Disconnect session
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
