import { useCallback, useMemo, type ReactNode } from "react";
import { useLyraData, type FavoriteSong } from "./use-lyra-data";

export type { FavoriteSong };

function eqSong(a: FavoriteSong, artist: string, title: string): boolean {
  return (
    a.artist.toLowerCase() === artist.toLowerCase() &&
    a.title.toLowerCase() === title.toLowerCase()
  );
}

/** Back-compat shim — real state lives in <LyraDataProvider>. */
export function FavoritesProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useFavorites() {
  const { data, update } = useLyraData();
  const favorites = data.favorites;

  const toggleFavorite = useCallback((artist: string, title: string) => {
    update(prev => {
      const exists = prev.favorites.some(f => eqSong(f, artist, title));
      const nextFavorites = exists
        ? prev.favorites.filter(f => !eqSong(f, artist, title))
        : [...prev.favorites, { artist, title }];
      return { ...prev, favorites: nextFavorites };
    });
  }, [update]);

  const isFavorite = useCallback(
    (artist: string, title: string) => favorites.some(f => eqSong(f, artist, title)),
    [favorites],
  );

  return useMemo(
    () => ({ favorites, toggleFavorite, isFavorite }),
    [favorites, toggleFavorite, isFavorite],
  );
}
