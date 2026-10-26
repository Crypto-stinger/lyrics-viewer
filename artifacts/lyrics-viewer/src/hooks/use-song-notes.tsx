import { useCallback, useMemo, type ReactNode } from "react";
import { useLyraData, songKey, type SongNotes } from "./use-lyra-data";

export type { SongNotes };

function isEmpty(n: Partial<SongNotes>): boolean {
  return !(n.capo?.trim() || n.tempo?.trim() || n.notes?.trim());
}

/** Back-compat shim — real state lives in <LyraDataProvider>. */
export function SongNotesProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useSongNotes() {
  const { data, update } = useLyraData();
  const map = data.songNotes;

  const getNotes = useCallback(
    (artist: string, title: string): SongNotes | null => map[songKey(artist, title)] ?? null,
    [map],
  );

  const hasNotes = useCallback(
    (artist: string, title: string): boolean => {
      const n = map[songKey(artist, title)];
      return !!n && !isEmpty(n);
    },
    [map],
  );

  const setNotes = useCallback((
    artist: string,
    title: string,
    patch: Partial<Omit<SongNotes, "updatedAt">>,
  ) => {
    const id = songKey(artist, title);
    update(prev => {
      const current = prev.songNotes[id] ?? { updatedAt: 0 };
      const merged: SongNotes = {
        ...current,
        ...Object.fromEntries(
          Object.entries(patch).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]),
        ),
        updatedAt: Date.now(),
      };
      for (const k of ["capo", "tempo", "notes"] as const) {
        if (typeof merged[k] === "string" && merged[k]!.length === 0) delete merged[k];
      }
      const nextMap = { ...prev.songNotes };
      if (isEmpty(merged)) delete nextMap[id];
      else nextMap[id] = merged;
      return { ...prev, songNotes: nextMap };
    });
  }, [update]);

  return useMemo(
    () => ({ getNotes, setNotes, hasNotes }),
    [getNotes, setNotes, hasNotes],
  );
}
