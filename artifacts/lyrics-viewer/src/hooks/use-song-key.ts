import { useCallback } from "react";
import { useLyraData, songKey } from "./use-lyra-data";

export function useSongKey(artist: string | undefined, title: string | undefined) {
  const { data, update } = useLyraData();
  const id = artist && title ? songKey(artist, title) : null;
  const value = id ? (data.songKeys[id] ?? null) : null;

  const setKey = useCallback(
    (next: string | null) => {
      if (!id) return;
      update(prev => {
        const copy = { ...prev.songKeys };
        if (next === null || next === "") delete copy[id];
        else copy[id] = next;
        return { ...prev, songKeys: copy };
      });
    },
    [id, update],
  );

  return { key: value, setKey };
}

// Common keys singers actually use. Keep it simple: major + minor for each pitch.
export const KEY_OPTIONS: string[] = [
  "C", "Cm",
  "C#/Db", "C#m/Dbm",
  "D", "Dm",
  "D#/Eb", "D#m/Ebm",
  "E", "Em",
  "F", "Fm",
  "F#/Gb", "F#m/Gbm",
  "G", "Gm",
  "G#/Ab", "G#m/Abm",
  "A", "Am",
  "A#/Bb", "A#m/Bbm",
  "B", "Bm",
];
