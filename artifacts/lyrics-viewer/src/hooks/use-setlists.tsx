import { useCallback, useMemo, type ReactNode } from "react";
import { useLyraData, type Setlist, type SetlistSong } from "./use-lyra-data";

export type { Setlist, SetlistSong };

function newId(): string {
  return `sl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sameSong(a: SetlistSong, b: SetlistSong): boolean {
  return (
    a.artist.toLowerCase().trim() === b.artist.toLowerCase().trim() &&
    a.title.toLowerCase().trim() === b.title.toLowerCase().trim()
  );
}

/**
 * Backwards-compatible Provider — kept so existing <SetlistsProvider> mounts
 * in App.tsx continue to work. Real state lives in <LyraDataProvider>.
 */
export function SetlistsProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useSetlists() {
  const { data, update } = useLyraData();
  const setlists = data.setlists;

  const createSetlist = useCallback((name: string): Setlist => {
    const now = Date.now();
    const sl: Setlist = {
      id: newId(),
      name: name.trim() || "New setlist",
      songs: [],
      createdAt: now,
      updatedAt: now,
    };
    update(prev => ({ ...prev, setlists: [sl, ...prev.setlists] }));
    return sl;
  }, [update]);

  const renameSetlist = useCallback((id: string, name: string) => {
    update(prev => ({
      ...prev,
      setlists: prev.setlists.map(s =>
        s.id === id ? { ...s, name: name.trim() || s.name, updatedAt: Date.now() } : s,
      ),
    }));
  }, [update]);

  const deleteSetlist = useCallback((id: string) => {
    update(prev => {
      const nextOverrides = { ...prev.setlistOverrides };
      delete nextOverrides[id];
      return {
        ...prev,
        setlists: prev.setlists.filter(s => s.id !== id),
        setlistOverrides: nextOverrides,
      };
    });
  }, [update]);

  const addSong = useCallback((id: string, song: SetlistSong) => {
    update(prev => ({
      ...prev,
      setlists: prev.setlists.map(s => {
        if (s.id !== id) return s;
        if (s.songs.some(existing => sameSong(existing, song))) return s;
        return { ...s, songs: [...s.songs, song], updatedAt: Date.now() };
      }),
    }));
  }, [update]);

  const removeSong = useCallback((id: string, index: number) => {
    update(prev => ({
      ...prev,
      setlists: prev.setlists.map(s => {
        if (s.id !== id) return s;
        const next = s.songs.slice();
        if (index < 0 || index >= next.length) return s;
        next.splice(index, 1);
        return { ...s, songs: next, updatedAt: Date.now() };
      }),
    }));
  }, [update]);

  const moveSong = useCallback((id: string, fromIndex: number, toIndex: number) => {
    update(prev => ({
      ...prev,
      setlists: prev.setlists.map(s => {
        if (s.id !== id) return s;
        const next = s.songs.slice();
        if (fromIndex < 0 || fromIndex >= next.length) return s;
        if (toIndex < 0 || toIndex >= next.length) return s;
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return { ...s, songs: next, updatedAt: Date.now() };
      }),
    }));
  }, [update]);

  const getSetlist = useCallback(
    (id: string) => setlists.find(s => s.id === id),
    [setlists],
  );

  return useMemo(() => ({
    setlists,
    createSetlist,
    renameSetlist,
    deleteSetlist,
    addSong,
    removeSong,
    moveSong,
    getSetlist,
  }), [setlists, createSetlist, renameSetlist, deleteSetlist, addSong, removeSong, moveSong, getSetlist]);
}
