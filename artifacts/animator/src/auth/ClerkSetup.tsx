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

// Resolve the key from window.location.hostname so the same build serves
// multiple Clerk custom domains. Falls back to the env key when the host
// doesn't map to a custom domain (dev).
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// Empty in dev (Clerk hits dev FAPI directly), auto-set in prod. Do not gate on
// import.meta.env.PROD / NODE_ENV — the empty dev value is intentional.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Clerk passes full paths to routerPush/routerReplace, but wouter's setLocation
// prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

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
    cardBox: "bg-[#0b1220] border border-[#1d2b45] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl",
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

// Invalidate cached gallery/lobby data when the signed-in user changes.
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

// Attach the live Clerk session token to every api-client request so
// authenticated routes (post create / my posts) work once signed in.
function ApiAuthBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(async () => {
      try {
        return (await getToken()) ?? null;
      } catch {
        return null;
      }
    });
    return () => setAuthTokenGetter(null);
  }, [getToken]);
  return null;
}

function ClerkProviderWithRoutes({ home }: { home: ReactNode }) {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
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

/** Top-level shell: wires Wouter, Clerk, and React Query around the app. */
export function AppShell({ home }: { home: ReactNode }) {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes home={home} />
    </WouterRouter>
  );
}
