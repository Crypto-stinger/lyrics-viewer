import { Link } from "wouter";
import { Search, Heart, Sun, Moon, ListMusic, LogIn, LogOut, User } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { Logo } from "@/components/logo";
import { OfflineBadge } from "@/components/pwa-status";
import { OfflineReadyBadge } from "@/components/offline-ready-badge";
import { Show, useUser, useClerk } from "@clerk/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function AccountMenu() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const initial =
    user?.username?.[0]?.toUpperCase() ??
    user?.primaryEmailAddress?.emailAddress?.[0]?.toUpperCase() ??
    user?.firstName?.[0]?.toUpperCase() ??
    "?";
  const label =
    user?.username ??
    user?.primaryEmailAddress?.emailAddress ??
    user?.fullName ??
    "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="button-account-menu"
        className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 via-purple-500 to-pink-500 text-white text-xs font-semibold hover:opacity-90 transition-opacity"
        aria-label="Account menu"
      >
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Signed in as</span>
            <span className="text-sm truncate">{label}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="button-sign-out"
          onClick={() => signOut({ redirectUrl: basePath || "/" })}
          className="cursor-pointer"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SignedOutAccountButton() {
  return (
    <Link
      href="/sign-in"
      data-testid="link-sign-in"
      className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2"
      title="Sign in to sync your setlists across devices"
    >
      <LogIn className="w-4 h-4" />
      <span className="hidden sm:inline">Sign in</span>
    </Link>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border/50 bg-background/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto w-full px-4 h-16 flex items-center justify-between">
          <Link href="/" className="font-serif italic font-bold text-xl flex items-center gap-2" aria-label="Lyra — home">
            <Logo size={26} className="not-italic shrink-0" />
            <span className="text-aurora">Lyra</span>
          </Link>
          <nav className="flex items-center gap-3 sm:gap-5">
            <OfflineReadyBadge />
            <OfflineBadge />
            <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2">
              <Search className="w-4 h-4" />
              <span className="hidden sm:inline">Search</span>
            </Link>
            <Link href="/setlists" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2">
              <ListMusic className="w-4 h-4" />
              <span className="hidden sm:inline">Setlists</span>
            </Link>
            <Link href="/favorites" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2">
              <Heart className="w-4 h-4" />
              <span className="hidden sm:inline">Favorites</span>
            </Link>
            <button
              data-testid="button-theme-toggle"
              onClick={toggleTheme}
              className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark"
                ? <Sun className="w-4 h-4" />
                : <Moon className="w-4 h-4" />
              }
            </button>
            <Show when="signed-in">
              <AccountMenu />
            </Show>
            <Show when="signed-out">
              <SignedOutAccountButton />
            </Show>
          </nav>
        </div>
      </header>
      <main className="flex-1 w-full flex flex-col">
        {children}
      </main>
    </div>
  );
}

// Re-export for callers that want it elsewhere
export { User };
