import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { AuthenticateWithRedirectCallback, ClerkProvider, SignIn, SignUp, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import SearchPage from "@/pages/search";
import ViewPage from "@/pages/view";
import FavoritesPage from "@/pages/favorites";
import SetlistsPage from "@/pages/setlists";
import { CurrentSongProvider } from "@/hooks/use-current-song";
import { ThemeProvider } from "@/hooks/use-theme";
import { LyraDataProvider } from "@/hooks/use-lyra-data";
import { PwaStatus } from "@/components/pwa-status";
import { PrecacheProvider } from "@/hooks/use-precache-songs";
import { Logo } from "@/components/logo";

// One canonical address. Sign-in is tied to the bare domain (lyricviewer.com):
// on www.lyricviewer.com the sign-in key below would be derived for
// "clerk.www.lyricviewer.com", which doesn't exist, and Google sign-in fails.
if (typeof window !== "undefined" && window.location.hostname.startsWith("www.")) {
  const { protocol, hostname, port, pathname, search, hash } = window.location;
  window.location.replace(
    `${protocol}//${hostname.slice(4)}${port ? `:${port}` : ""}${pathname}${search}${hash}`,
  );
}

// Resolve Clerk publishable key from window.location.hostname so the same build
// can serve multiple Clerk custom domains; fall back to the env-injected key
// during development.
const clerkPubKey = publishableKeyFromHost(
  typeof window !== "undefined" ? window.location.hostname.replace(/^www\./, "") : "",
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// Sign-in traffic goes through our own server at /api/__clerk (see the API
// server's clerkProxyMiddleware). Replit sets this automatically; anywhere
// else (e.g. Render) it defaults to this site's own /api/__clerk in production.
// Clerk development keys (pk_test_…) don't use the proxy — handy for testing
// on a temporary address such as lyra.onrender.com before the domain moves.
const clerkProxyUrl =
  (import.meta.env.VITE_CLERK_PROXY_URL as string | undefined) ||
  (import.meta.env.PROD && typeof window !== "undefined" && !clerkPubKey.startsWith("pk_test_")
    ? `${window.location.origin}/api/__clerk`
    : undefined);

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in environment");
}

// Clerk passes full paths to routerPush/routerReplace; wouter's setLocation
// prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl:
      typeof window !== "undefined"
        ? `${window.location.origin}${basePath}/logo.svg`
        : `${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#22D3EE", // brand cyan
    colorForeground: "#F1F5F9",
    colorMutedForeground: "#94A3B8",
    colorDanger: "#F43F5E",
    colorBackground: "#0F172A",
    colorInput: "#0B1224",
    colorInputForeground: "#F1F5F9",
    colorNeutral: "#1E293B",
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-[#0F172A] border border-[#1E293B] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl shadow-cyan-500/5",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-slate-50",
    headerSubtitle: "text-slate-400",
    socialButtonsBlockButtonText: "text-slate-100",
    formFieldLabel: "text-slate-200",
    footerActionLink: "text-cyan-400 hover:text-cyan-300",
    footerActionText: "text-slate-400",
    dividerText: "text-slate-500",
    identityPreviewEditButton: "text-cyan-400",
    formFieldSuccessText: "text-emerald-400",
    alertText: "text-slate-100",
    logoBox: "flex justify-center mb-4",
    logoImage: "h-12 w-12",
    socialButtonsBlockButton:
      "bg-[#0B1224] border border-[#1E293B] hover:bg-[#111c33]",
    formButtonPrimary:
      "bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 text-white hover:opacity-90",
    formFieldInput:
      "bg-[#0B1224] border border-[#1E293B] text-slate-100",
    footerAction: "text-slate-400",
    dividerLine: "bg-[#1E293B]",
    alert: "bg-[#0B1224] border border-[#1E293B]",
    otpCodeFieldInput: "bg-[#0B1224] border border-[#1E293B] text-slate-100",
    formFieldRow: "",
    main: "",
  },
};

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#0A0F1F] px-4 py-10 gap-6">
      <a href={basePath || "/"} className="flex items-center gap-2 text-2xl font-serif italic font-bold">
        <Logo size={32} />
        <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">Lyra</span>
      </a>
      {children}
      <p className="text-xs text-slate-500">By Justin Stark Media</p>
    </div>
  );
}

function SignInPage() {
  return (
    <AuthShell>
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={basePath || "/"}
      />
    </AuthShell>
  );
}

function SignUpPage() {
  return (
    <AuthShell>
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={basePath || "/"}
      />
    </AuthShell>
  );
}

// Where Google (and other social logins) send the browser back to. Clerk
// finishes the sign-in here and then goes to the home page. Kept as its own
// route so a return trip never lands on the "page not found" screen.
function SsoCallbackPage() {
  return (
    <AuthShell>
      <p className="text-sm text-slate-300" data-testid="text-finishing-sign-in">Finishing sign-in…</p>
      <AuthenticateWithRedirectCallback
        signInFallbackRedirectUrl={basePath || "/"}
        signUpFallbackRedirectUrl={basePath || "/"}
      />
    </AuthShell>
  );
}

// Clear react-query cache when the signed-in user changes so one user's data
// never leaks into another's session.
function ClerkQueryCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const id = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== id) {
        qc.clear();
      }
      prevUserIdRef.current = id;
    });
    return unsubscribe;
  }, [addListener, qc]);
  return null;
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/" component={SearchPage} />
      <Route path="/view" component={ViewPage} />
      <Route path="/favorites" component={FavoritesPage} />
      <Route path="/setlists" component={SetlistsPage} />
      <Route path="/sso-callback" component={SsoCallbackPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey!}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      signInFallbackRedirectUrl={basePath || "/"}
      signUpFallbackRedirectUrl={basePath || "/"}
      afterSignOutUrl={basePath || "/"}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to see your setlists and sync your notes and favourites across devices.",
          },
        },
        signUp: {
          start: {
            title: "Create your Lyra account",
            subtitle: "Singers, musicians and cover bands — your stage version, on every device.",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryCacheInvalidator />
        <ThemeProvider>
          <TooltipProvider>
            <LyraDataProvider>
              <PrecacheProvider>
                <CurrentSongProvider>
                  <AppRoutes />
                  <PwaStatus />
                </CurrentSongProvider>
              </PrecacheProvider>
            </LyraDataProvider>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
