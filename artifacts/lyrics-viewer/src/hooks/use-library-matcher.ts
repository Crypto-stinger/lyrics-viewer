import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFavorites } from "./use-favorites";
import { useSetlists } from "./use-setlists";
import { fetchLyrics } from "@/lib/lyrics";
import { alignHeard, heardWeights, prepareLyrics, type PreparedLyrics } from "@/lib/lyric-match";

export interface LibraryHit {
  artist: string;
  title: string;
  matchScore: number;
  matchedLine?: string;
}

interface LibrarySong {
  artist: string;
  title: string;
}

// Prepared lyrics survive modal close/open for the whole page session.
const prepared = new Map<string, PreparedLyrics | null>();
const keyOf = (s: LibrarySong) => `${s.artist.toLowerCase().trim()}|${s.title.toLowerCase().trim()}`;

/**
 * Matches heard words against the band's own songs (setlists + favourites)
 * before anything goes to the internet. A band's repertoire is a few dozen to
 * a few hundred songs, so 5 words are usually decisive, it's instant, and it
 * works offline because those lyrics are already pre-cached for the gig.
 */
export function useLibraryMatcher(enabled: boolean) {
  const { favorites } = useFavorites();
  const { setlists } = useSetlists();
  const songs = useMemo(() => {
    const seen = new Set<string>();
    const out: LibrarySong[] = [];
    for (const s of [...setlists.flatMap((sl) => sl.songs), ...favorites]) {
      const k = keyOf(s);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ artist: s.artist, title: s.title });
    }
    return out;
  }, [favorites, setlists]);

  const [ready, setReady] = useState(0);
  const songsRef = useRef(songs);
  songsRef.current = songs;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const todo = songs.filter((s) => !prepared.has(keyOf(s)));
    setReady(songs.length - todo.length);
    let i = 0;
    const worker = async () => {
      while (!cancelled && i < todo.length) {
        const s = todo[i++];
        const text = await fetchLyrics(s.artist, s.title).catch(() => null);
        prepared.set(keyOf(s), text ? prepareLyrics(text) : null);
        if (!cancelled) setReady((r) => r + 1);
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => { cancelled = true; };
  }, [enabled, songs]);

  const match = useCallback((heard: string[]): LibraryHit[] => {
    if (heard.length === 0) return [];
    const w = heardWeights(heard);
    const hits: LibraryHit[] = [];
    for (const s of songsRef.current) {
      const prep = prepared.get(keyOf(s));
      if (!prep) continue;
      const a = alignHeard(heard, prep, w);
      if (a.score <= 0) continue;
      hits.push({
        artist: s.artist,
        title: s.title,
        matchScore: a.score,
        matchedLine:
          a.startLine >= 0
            ? prep.lines.slice(a.startLine, Math.min(a.endLine, a.startLine + 1) + 1).map((l) => l.trim()).filter(Boolean).join(" / ")
            : undefined,
      });
    }
    hits.sort((a, b) => b.matchScore - a.matchScore);
    return hits.slice(0, 5);
  }, []);

  return { match, total: songs.length, ready };
}
