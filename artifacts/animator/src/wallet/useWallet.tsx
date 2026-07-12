/**
 * Wallet connect + account-link state machine.
 *
 * Flow: connect Phantom (injected extension, mobile deeplink, or install
 * fallback) → ask the server for a one-time nonce → the user signs the exact
 * message in Phantom → the server verifies the ed25519 signature and stores the
 * address against the signed-in Clerk account.
 *
 * The provider exposes both the browser-session connection (Phantom) and the
 * server-side link (which survives across devices/sessions independently of
 * whether Phantom is currently connected).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@clerk/clerk-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyWallet,
  getGetMyWalletQueryKey,
  createWalletNonce,
  linkWallet,
  unlinkWallet,
  type WalletInfo,
} from "@workspace/api-client-react";
import {
  getPhantom,
  encodeSignature,
  isMobileDevice,
  getDeeplinkToPhantom,
  waitForPhantomExtension,
} from "./phantom";

/** What the connect/link pipeline is currently doing. */
export type WalletPhase =
  | "idle"
  | "connecting"
  | "signing"
  | "linking"
  | "unlinking";

export interface WalletState {
  /** Address of the Phantom wallet connected in THIS browser session (or null). */
  connectedAddress: string | null;
  /** The wallet linked to the account server-side (survives sessions), or null. */
  linkedWallet: WalletInfo | null;
  /** True while the initial server-link query is loading. */
  linkedLoading: boolean;
  phase: WalletPhase;
  /** Human-readable failure from the last attempt (cleared on retry). */
  error: string | null;
  /** True when no extension was found on a desktop browser — show install CTA. */
  needsInstall: boolean;
  /** Whether the current visitor is signed in (linking requires an account). */
  isSignedIn: boolean;
  /** Connect Phantom and (when signed in) prove ownership + link to account. */
  connectAndLink: () => Promise<void>;
  /** Disconnect the browser session only (server link untouched). */
  disconnect: () => Promise<void>;
  /** Remove the server-side link from the account. */
  unlink: () => Promise<void>;
  /** Clear an error / install prompt without acting. */
  dismissError: () => void;
}

const WalletContext = createContext<WalletState | null>(null);

/** Surface a readable message out of unknown SDK / fetch failures. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    // Server responses come back as {error} JSON strings in the message body.
    try {
      const parsed = JSON.parse(err.message) as { error?: string };
      if (parsed?.error) return parsed.error;
    } catch {
      /* not JSON — use as-is */
    }
    if (/reject|denied|cancel/i.test(err.message)) return "Request was cancelled in Phantom.";
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const { isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [phase, setPhase] = useState<WalletPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [needsInstall, setNeedsInstall] = useState(false);
  const busyRef = useRef(false);

  // Server-side link (only meaningful when signed in).
  const walletQuery = useGetMyWallet({
    query: {
      queryKey: getGetMyWalletQueryKey(),
      enabled: !!isSignedIn,
      staleTime: 60_000,
    },
  });
  const linkedWallet = isSignedIn ? (walletQuery.data?.wallet ?? null) : null;

  // Silently resume an existing Phantom session on mount (never prompts).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sdk = getPhantom();
        await sdk.autoConnect();
        if (cancelled) return;
        const addresses = await sdk.getAddresses();
        const sol = addresses.find((a) => a.addressType === "Solana");
        if (sol) setConnectedAddress(sol.address);
      } catch {
        /* no prior session — stay disconnected */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshLink = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: getGetMyWalletQueryKey() });
  }, [queryClient]);

  const connectAndLink = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setNeedsInstall(false);
    try {
      const sdk = getPhantom();

      // 1. Make sure Phantom is reachable in this browser.
      setPhase("connecting");
      const hasExtension = await waitForPhantomExtension(1200);
      if (!hasExtension) {
        if (isMobileDevice()) {
          // Reopen this page inside Phantom's in-app browser.
          window.location.href = getDeeplinkToPhantom("grudge-studio");
          return;
        }
        setNeedsInstall(true);
        return;
      }

      // 2. Connect (Phantom shows its approval popup).
      await sdk.connect({ provider: "injected" });
      const addresses = await sdk.getAddresses();
      const sol = addresses.find((a) => a.addressType === "Solana");
      if (!sol) throw new Error("No Solana address available in this wallet.");
      setConnectedAddress(sol.address);

      // 3. Ownership proof + account link (needs a signed-in account).
      if (!isSignedIn) return;

      setPhase("signing");
      const { message } = await createWalletNonce({ address: sol.address });
      const signed = await sdk.solana.signMessage(message);

      setPhase("linking");
      await linkWallet({
        address: sol.address,
        signature: encodeSignature(signed.signature),
      });
      await refreshLink();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPhase("idle");
      busyRef.current = false;
    }
  }, [isSignedIn, refreshLink]);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await getPhantom().disconnect();
    } catch {
      /* already disconnected */
    }
    setConnectedAddress(null);
  }, []);

  const unlink = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setPhase("unlinking");
    try {
      await unlinkWallet();
      await refreshLink();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPhase("idle");
      busyRef.current = false;
    }
  }, [refreshLink]);

  const dismissError = useCallback(() => {
    setError(null);
    setNeedsInstall(false);
  }, []);

  const value: WalletState = {
    connectedAddress,
    linkedWallet,
    linkedLoading: !!isSignedIn && walletQuery.isLoading,
    phase,
    error,
    needsInstall,
    isSignedIn: !!isSignedIn,
    connectAndLink,
    disconnect,
    unlink,
    dismissError,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
