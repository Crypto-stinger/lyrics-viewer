import { Link, useLocation } from "wouter";
import { AuthenticateWithRedirectCallback } from "@clerk/react";
import { Compass, Loader2 } from "lucide-react";

// Paths Clerk can send the browser back to after Google / email sign-in.
// If one of these ever lands here, finish the sign-in instead of showing a
// dead end — this was the "404 after Google login" screen.
const AUTH_RETURN = /(sso-callback|oauth|callback|verify|factor-(one|two)|continue|reset-password)/i;

export default function NotFound() {
  const [location] = useLocation();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  if (AUTH_RETURN.test(location)) {
    return (
      <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center gap-3 bg-background text-foreground" data-testid="auth-return">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Finishing sign-in…</p>
        <AuthenticateWithRedirectCallback
          signInFallbackRedirectUrl={basePath || "/"}
          signUpFallbackRedirectUrl={basePath || "/"}
        />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-background px-4" data-testid="page-not-found">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center space-y-4">
        <Compass className="w-8 h-8 text-primary mx-auto" />
        <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          That address isn't part of Lyra. Your songs and setlists are safe.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90"
          data-testid="link-home"
        >
          Back to Lyra
        </Link>
      </div>
    </div>
  );
}
