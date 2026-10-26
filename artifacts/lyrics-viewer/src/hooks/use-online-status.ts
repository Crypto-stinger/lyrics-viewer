import { useEffect, useState } from "react";

/**
 * Tracks navigator.onLine. Re-renders on online/offline events.
 *
 * Note: navigator.onLine reports "connected to a network" rather than
 * "internet reachable" — a captive-portal wifi will still report online. For
 * Lyra's purposes this is fine: the offline badge is an advisory cue to the
 * singer, not a hard guarantee.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}
