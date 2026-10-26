import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "lyrics-viewer-language";

export const LANGUAGE_OPTIONS = [
  { code: "auto",  label: "Auto-detect" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "es-ES", label: "Español (España)" },
  { code: "es-MX", label: "Español (México)" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "pt-PT", label: "Português (Portugal)" },
  { code: "fr-FR", label: "Français" },
  { code: "it-IT", label: "Italiano" },
  { code: "de-DE", label: "Deutsch" },
  { code: "ja-JP", label: "日本語" },
  { code: "ko-KR", label: "한국어" },
  { code: "zh-CN", label: "中文" },
] as const;

export function useLanguage() {
  const [lang, setLangState] = useState<string>(() => {
    if (typeof window === "undefined") return "auto";
    try {
      return localStorage.getItem(STORAGE_KEY) ?? "auto";
    } catch {
      return "auto";
    }
  });

  const setLang = useCallback((value: string) => {
    setLangState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore quota / private mode errors */
    }
  }, []);

  // Cross-tab sync (nice for testing in two windows)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) setLangState(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { lang, setLang };
}
