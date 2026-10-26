import { useState, useEffect } from "react";

export interface FontOption {
  label: string;
  value: string;
  family: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { label: "Merriweather", value: "'Merriweather', serif",           family: "Merriweather" },
  { label: "Lora",         value: "'Lora', serif",                   family: "Lora" },
  { label: "Crimson Pro",  value: "'Crimson Pro', serif",            family: "Crimson Pro" },
  { label: "Sans",         value: "'Plus Jakarta Sans', sans-serif", family: "Plus Jakarta Sans" },
];

const DEFAULT_INDEX = 0;
const STORAGE_KEY = "lyrics_font";

export function useFont() {
  const [fontIndex, setFontIndexState] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        const idx = parseInt(stored, 10);
        if (!isNaN(idx) && idx >= 0 && idx < FONT_OPTIONS.length) return idx;
      }
    } catch { /* ignore */ }
    return DEFAULT_INDEX;
  });

  const setFontIndex = (idx: number) => {
    setFontIndexState(idx);
    localStorage.setItem(STORAGE_KEY, idx.toString());
  };

  const cycleFont = () => setFontIndex((fontIndex + 1) % FONT_OPTIONS.length);

  return { font: FONT_OPTIONS[fontIndex], fontIndex, setFontIndex, cycleFont };
}
