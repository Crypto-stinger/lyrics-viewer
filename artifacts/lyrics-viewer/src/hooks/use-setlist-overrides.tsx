import { useCallback, useMemo, type ReactNode } from "react";
import { useLyraData, songKey, type SetlistSongOverride } from "./use-lyra-data";

export type { SetlistSongOverride };

function isEmpty(o: Partial<SetlistSongOverride>): boolean {
  return !(
    o.customLyrics?.trim() ||
    o.capo?.trim() ||
    o.tempo?.trim() ||
    o.key?.trim() ||
    o.notes?.trim()
  );
}

/** Back-compat shim — real state lives in <LyraDataProvider>. */
export function SetlistOverridesProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useSetlistOverrides() {
  const { data, update } = useLyraData();
  const map = data.setlistOverrides;

  const getOverride = useCallback(
    (setlistId: string, artist: string, title: string): SetlistSongOverride | null =>
      map[setlistId]?.[songKey(artist, title)] ?? null,
    [map],
  );

  const hasOverride = useCallback(
    (setlistId: string, artist: string, title: string): boolean => {
      const ov = map[setlistId]?.[songKey(artist, title)];
      return !!ov && !isEmpty(ov);
    },
    [map],
  );

  const hasCustomLyrics = useCallback(
    (setlistId: string, artist: string, title: string): boolean => {
      const ov = map[setlistId]?.[songKey(artist, title)];
      return !!ov?.customLyrics?.trim();
    },
    [map],
  );

  const setOverride = useCallback((
    setlistId: string,
    artist: string,
    title: string,
    patch: Partial<Omit<SetlistSongOverride, "updatedAt">>,
  ) => {
    const sk = songKey(artist, title);
    update(prev => {
      const innerPrev = prev.setlistOverrides[setlistId] ?? {};
      const current = innerPrev[sk] ?? { updatedAt: 0 };
      const trimmed: Partial<SetlistSongOverride> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (typeof v === "string") {
          trimmed[k as keyof SetlistSongOverride] =
            (k === "customLyrics" ? v : v.trim()) as never;
        }
      }
      const merged: SetlistSongOverride = { ...current, ...trimmed, updatedAt: Date.now() };
      for (const k of ["capo", "tempo", "key", "notes"] as const) {
        if (typeof merged[k] === "string" && merged[k]!.length === 0) delete merged[k];
      }
      if (typeof merged.customLyrics === "string" && merged.customLyrics.trim().length === 0) {
        delete merged.customLyrics;
      }
      const nextInner = { ...innerPrev };
      if (isEmpty(merged)) delete nextInner[sk];
      else nextInner[sk] = merged;
      const next = { ...prev.setlistOverrides };
      if (Object.keys(nextInner).length === 0) delete next[setlistId];
      else next[setlistId] = nextInner;
      return { ...prev, setlistOverrides: next };
    });
  }, [update]);

  const clearOverride = useCallback((setlistId: string, artist: string, title: string) => {
    const sk = songKey(artist, title);
    update(prev => {
      const innerPrev = prev.setlistOverrides[setlistId];
      if (!innerPrev || !(sk in innerPrev)) return prev;
      const nextInner = { ...innerPrev };
      delete nextInner[sk];
      const next = { ...prev.setlistOverrides };
      if (Object.keys(nextInner).length === 0) delete next[setlistId];
      else next[setlistId] = nextInner;
      return { ...prev, setlistOverrides: next };
    });
  }, [update]);

  const clearSetlist = useCallback((setlistId: string) => {
    update(prev => {
      if (!(setlistId in prev.setlistOverrides)) return prev;
      const next = { ...prev.setlistOverrides };
      delete next[setlistId];
      return { ...prev, setlistOverrides: next };
    });
  }, [update]);

  return useMemo(
    () => ({
      getOverride,
      setOverride,
      hasOverride,
      hasCustomLyrics,
      clearOverride,
      clearSetlist,
    }),
    [getOverride, setOverride, hasOverride, hasCustomLyrics, clearOverride, clearSetlist],
  );
}
