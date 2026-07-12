/**
 * Phantom wallet client (Solana) for Grudge Studio.
 *
 * Thin singleton around `@phantom/browser-sdk`. We use Phantom only to PROVE
 * ownership of a wallet (the user signs a server-issued nonce); the app never
 * touches keys, balances, tokens, or transactions.
 *
 * The SDK is configured with both the injected (browser-extension) and embedded
 * providers plus our public App ID, so it works for extension users on desktop
 * and falls back to the hosted/embedded flow elsewhere.
 */
import {
  BrowserSDK,
  AddressType,
  NetworkId,
  isMobileDevice,
  getDeeplinkToPhantom,
  waitForPhantomExtension,
} from "@phantom/browser-sdk";
import bs58 from "bs58";

/** Public Phantom App ID for Grudge Studio (safe to ship to the client). */
const PHANTOM_APP_ID = "399d2638-ad4a-4306-84ea-7270d7a7bef9";

/** Where to install Phantom when the extension isn't present. */
export const PHANTOM_INSTALL_URL = "https://phantom.app/download";

/**
 * Redirect target for the embedded/hosted auth flow. Uses the live origin so it
 * naturally becomes the production domain (e.g. grudge-studio.com) in prod and
 * the Replit dev domain during development — both must be whitelisted in the
 * Phantom developer portal for this App ID.
 */
function redirectUrl(): string {
  return window.location.origin + import.meta.env.BASE_URL;
}

let sdk: BrowserSDK | null = null;

/** Lazily build (and cache) the configured SDK instance. */
export function getPhantom(): BrowserSDK {
  if (!sdk) {
    sdk = new BrowserSDK({
      providers: ["injected", "phantom"],
      addressTypes: [AddressType.solana],
      appId: PHANTOM_APP_ID,
      authOptions: { redirectUrl: redirectUrl() },
    });
  }
  return sdk;
}

export { isMobileDevice, getDeeplinkToPhantom, waitForPhantomExtension };

/** Re-export so callers don't reach into the SDK package directly. */
export const SOLANA_MAINNET = NetworkId.SOLANA_MAINNET;

/** Encode a raw signature (Uint8Array) as base58 for transport to the server. */
export function encodeSignature(sig: Uint8Array): string {
  return bs58.encode(sig);
}

/** Shorten a base58 address for display, e.g. `7Xk9…3Fad`. */
export function shortenAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}
