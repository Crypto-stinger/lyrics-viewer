import { Check, CloudDownload, CloudOff } from "lucide-react";
import { usePrecacheStatus } from "@/hooks/use-precache-songs";
import { useOnlineStatus } from "@/hooks/use-online-status";

/**
 * Pre-gig reliability signal: tells the singer how many of their favourite +
 * setlist songs are cached and safe to use without wifi. Hidden when there's
 * nothing to warm (no favourites, no setlists) so it never adds noise.
 *
 * Three states:
 *   - All ready (warmed === total)         → cyan check pill, "All N ready offline"
 *   - Warming in progress                  → muted pill with download icon
 *   - Idle but incomplete                  → muted pill with cloud-off icon
 *
 * On mobile the label collapses to "warmed/total" to keep the header tight.
 */
export function OfflineReadyBadge() {
  const { total, warmed, warming } = usePrecacheStatus();
  const online = useOnlineStatus();

  if (total === 0) return null;

  const allReady = warmed >= total;
  const Icon = allReady ? Check : warming ? CloudDownload : CloudOff;

  const longLabel = allReady
    ? `All ${total} song${total === 1 ? "" : "s"} ready offline`
    : warming
      ? `Saving offline · ${warmed} of ${total}`
      : `${warmed} of ${total} ready offline`;
  const shortLabel = `${warmed}/${total}`;

  const tone = allReady
    ? "bg-primary/10 text-primary border-primary/20"
    : "bg-muted text-muted-foreground border-border";

  const tooltip = allReady
    ? "All your favourite and setlist songs are saved for offline use."
    : online
      ? "Lyra is saving these songs in the background so they work without wifi."
      : "You're offline — Lyra will finish saving the rest when you're back online.";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}
      role="status"
      aria-live="polite"
      title={tooltip}
      data-testid="badge-offline-ready"
      data-warmed={warmed}
      data-total={total}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">{longLabel}</span>
      <span className="sm:hidden">{shortLabel}</span>
    </span>
  );
}
