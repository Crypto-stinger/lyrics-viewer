import { useCallback, useEffect, useState } from "react";

interface UseTapSyncResult {
  active: boolean;
  matchedIndex: number;
  start: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  setIndex: (i: number) => void;
}

// Manual "tap to advance" auto-cue. Zero magic — the singer (or someone in the
// band) taps a button to move the highlighted line to the next lyric. Most
// reliable mode for live performance because it never depends on the mic
// hearing anything intelligible over a loud band.
export function useTapSync(lineCount: number, songKey: string | null): UseTapSyncResult {
  const [active, setActive] = useState(false);
  const [matchedIndex, setMatchedIndex] = useState(-1);

  const start = useCallback(() => {
    setActive(true);
    setMatchedIndex(0);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    setMatchedIndex(-1);
  }, []);

  const next = useCallback(() => {
    if (lineCount <= 0) return;
    setMatchedIndex((i) => Math.min(lineCount - 1, i < 0 ? 0 : i + 1));
  }, [lineCount]);

  const prev = useCallback(() => {
    setMatchedIndex((i) => Math.max(0, i - 1));
  }, []);

  const setIndex = useCallback((i: number) => {
    setMatchedIndex(i);
  }, []);

  // Reset when the song changes
  useEffect(() => {
    setActive(false);
    setMatchedIndex(-1);
  }, [songKey]);

  return { active, matchedIndex, start, stop, next, prev, setIndex };
}
