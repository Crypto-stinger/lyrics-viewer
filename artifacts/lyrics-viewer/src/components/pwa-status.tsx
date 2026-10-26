import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { WifiOff, RefreshCw, X } from "lucide-react";
import { useOnlineStatus } from "@/hooks/use-online-status";

/**
 * Small offline pill for the header. Renders nothing when online so it never
 * adds visual noise during normal use; appears the moment connectivity drops
 * so the singer always knows the app's state.
 */
export function OfflineBadge() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground border border-border"
      role="status"
      aria-live="polite"
      data-testid="badge-offline"
    >
      <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
      Offline
    </span>
  );
}

/**
 * Bottom-centre update banner. Surfaces only when a new SW version is waiting.
 * The user must explicitly tap "Reload" — we never force a refresh, because
 * a forced refresh mid-song would be catastrophic on stage.
 */
export function PwaStatus() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(err) {
      // eslint-disable-next-line no-console
      console.error("Lyra service worker registration failed:", err);
    },
  });

  // First-run "ready offline" confirmation — shows once after install.
  const [showReady, setShowReady] = useState(false);
  useEffect(() => {
    if (!offlineReady) return;
    setShowReady(true);
    const t = setTimeout(() => {
      setShowReady(false);
      setOfflineReady(false);
    }, 4000);
    return () => clearTimeout(t);
  }, [offlineReady, setOfflineReady]);

  if (!needRefresh && !showReady) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center pointer-events-none px-4">
      {needRefresh ? (
        <div
          className="pointer-events-auto flex items-center gap-3 rounded-full bg-foreground text-background shadow-lg px-4 py-2.5 text-sm max-w-md"
          role="status"
          data-testid="banner-pwa-update"
        >
          <RefreshCw className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">A new version of Lyra is available.</span>
          <button
            type="button"
            onClick={() => updateServiceWorker(true)}
            className="font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity"
            data-testid="button-pwa-reload"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => setNeedRefresh(false)}
            className="opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Dismiss update notice"
            data-testid="button-pwa-dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-foreground text-background shadow-lg px-4 py-2.5 text-sm"
          role="status"
          data-testid="banner-pwa-ready"
        >
          <span aria-hidden="true">✓</span>
          <span>Lyra is ready to use offline.</span>
        </div>
      )}
    </div>
  );
}
