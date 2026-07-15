/**
 * App shell — Grudge ID is primary auth for the fleet.
 * Clerk is OPTIONAL and only mounts when a real publishable key is present
 * AND we are not forced onto a broken proxy host (clerk.<vercel-app> often fails).
 */
import { useEffect, useRef, type ReactNode } from "react";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  useAuth,
  useClerk,
} from "@clerk/clerk-react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { dark } from "@clerk/themes";
import {
  Switch,
  Route,
  useLocation,
  Router as WouterRouter,
} from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient";
import { readFleetToken } from "./fleetCore";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

/** True publishable key only — never throw if missing (Grudge ID still works). */
function resolveClerkPubKey(): string | null {
  try {
    const fromHost = publishableKeyFromHost(
      typeof window !== "undefined" ? window.location.hostname : "",
      import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
    );
    const key = (fromHost || import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "").trim();
    if (!key || !key.startsWith("pk_")) return null;
    return key;
  } catch {
    return null;
  }
}

/**
 * Only use proxyUrl when it is an absolute https URL that is NOT the broken
 * clerk.<app>.vercel.app pattern (ERR_CONNECTION_CLOSED in production).
 * Empty / relative / broken → omit so Clerk uses its default FAPI host.
 */
function resolveClerkProxyUrl(): string | undefined {
  const raw = (import.meta.env.VITE_CLERK_PROXY_URL as string | undefined)?.trim();
  if (!raw) return undefined;
  // Relative proxy paths are only valid when the host actually serves them.
  if (raw.startsWith("/")) return undefined;
  try {
    const u = new URL(raw);
    if (!/^https?:$/i.test(u.protocol)) return undefined;
    // Known-broken: clerk.<vercel-project>.vercel.app often does not resolve/serve Clerk JS
    if (
      /\.vercel\.app$/i.test(u.hostname) &&
      /^clerk\./i.test(u.hostname)
    ) {
      console.warn(
        "[Clerk] Ignoring broken proxyUrl",
        raw,
        "— using Clerk FAPI directly. Prefer Grudge ID for fleet auth.",
      );
      return undefined;
    }
    return raw;
  } catch {
    return undefined;
  }
}

const clerkPubKey = resolveClerkPubKey();
const clerkProxyUrl = resolveClerkProxyUrl();
const clerkEnabled = Boolean(clerkPubKey);

const clerkAppearance = {
  baseTheme: dark,
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "#6ea8ff",
    colorBackground: "#0b1220",
    colorInputBackground: "#111a2c",
    colorInputText: "#eaf4ff",
    colorText: "#eaf4ff",
    colorTextSecondary: "#9bb3d4",
    colorDanger: "#ff6b6b",
    fontFamily: "'Inter', system-ui, sans-serif",
    borderRadius: "0.6rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-[#0b1220] border border-[#1d2b45] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl",
    card: "!bg-transparent",
    headerTitle: "text-[#eaf4ff]",
    headerSubtitle: "text-[#9bb3d4]",
    socialButtonsBlockButton: "border border-[#26375a] text-[#eaf4ff]",
    formFieldLabel: "text-[#cfe0fa]",
    formButtonPrimary: "bg-[#4f7bff] hover:bg-[#3f6bef] text-white",
    footerActionText: "text-[#9bb3d4]",
    footerActionLink: "text-[#8ec3ff] hover:text-[#aed4ff]",
    dividerText: "text-[#9bb3d4]",
  },
};

function SignInPage() {
  if (!clerkEnabled) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-[#070b14] px-4 text-center text-[#eaf4ff]">
        <h1 className="text-xl font-semibold">Sign in with Grudge ID</h1>
        <p className="max-w-md text-sm text-[#9bb3d4]">
          Clerk is not configured on this host. Use fleet Grudge ID (id.grudge-studio.com) from the
          app header / Account hub.
        </p>
        <a
          className="rounded-lg border border-[#4f7bff] bg-[#1a2a4a] px-4 py-2 text-sm text-[#8ec3ff]"
          href="https://id.grudge-studio.com/login"
        >
          Open Grudge ID
        </a>
      </div>
    );
  }
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#070b14] px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        afterSignInUrl={basePath || "/"}
      />
    </div>
  );
}

function SignUpPage() {
  if (!clerkEnabled) {
    return <SignInPage />;
  }
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#070b14] px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        afterSignUpUrl={basePath || "/"}
      />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ApiAuthBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(async () => {
      try {
        const clerkTok = await getToken();
        if (clerkTok) return clerkTok;
      } catch {
        /* fall through to fleet token */
      }
      return readFleetToken() || null;
    });
    return () => setAuthTokenGetter(null);
  }, [getToken]);
  return null;
}

/** Fleet token only (no Clerk hooks). */
function FleetApiAuthBridge() {
  useEffect(() => {
    setAuthTokenGetter(async () => readFleetToken() || null);
    return () => setAuthTokenGetter(null);
  }, []);
  return null;
}

function ClerkProviderWithRoutes({ home }: { home: ReactNode }) {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey!}
      {...(clerkProxyUrl ? { proxyUrl: clerkProxyUrl } : {})}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ApiAuthBridge />
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route>{home}</Route>
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function GrudgeOnlyShell({ home }: { home: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <FleetApiAuthBridge />
      <Switch>
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route>{home}</Route>
      </Switch>
    </QueryClientProvider>
  );
}

/** Top-level shell: Wouter + optional Clerk + React Query. Never hard-crashes without Clerk. */
export function AppShell({ home }: { home: ReactNode }) {
  useEffect(() => {
    if (!clerkEnabled) {
      console.info(
        "[AppShell] Clerk disabled — using Grudge ID / fleet JWT only (no clerk.*.vercel.app script load).",
      );
    }
  }, []);

  return (
    <WouterRouter base={basePath}>
      {clerkEnabled ? (
        <ClerkProviderWithRoutes home={home} />
      ) : (
        <GrudgeOnlyShell home={home} />
      )}
    </WouterRouter>
  );
}

export { clerkEnabled };
