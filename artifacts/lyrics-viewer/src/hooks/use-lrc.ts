import { useEffect, useState } from "react";
import { fetchLrc, type LrcLine } from "@/lib/lrc";

interface UseLrcResult {
  lines: LrcLine[] | null;
  loading: boolean;
}

export function useLrc(artist: string | undefined, title: string | undefined): UseLrcResult {
  const [lines, setLines] = useState<LrcLine[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!artist || !title) {
      setLines(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLines(null);
    fetchLrc(artist, title)
      .then((result) => {
        if (!cancelled) setLines(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artist, title]);

  return { lines, loading };
}
