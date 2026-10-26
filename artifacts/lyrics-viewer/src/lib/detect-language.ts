// Lightweight heuristic language detector for LRC lyrics text.
// Returns a BCP-47 language tag suitable for SpeechRecognition.lang.

interface ScriptRule {
  lang: string;
  test: RegExp;
}

interface LatinRule {
  lang: string;
  words: string[];
  chars?: RegExp;
}

const SCRIPT_RULES: ScriptRule[] = [
  { lang: "ja-JP", test: /[\u3040-\u309F\u30A0-\u30FF]/ }, // hiragana/katakana
  { lang: "ko-KR", test: /[\uAC00-\uD7AF]/ },               // hangul
  { lang: "zh-CN", test: /[\u4E00-\u9FFF]/ },               // CJK ideographs
  { lang: "ar-SA", test: /[\u0600-\u06FF]/ },               // arabic
  { lang: "ru-RU", test: /[\u0400-\u04FF]/ },               // cyrillic
  { lang: "hi-IN", test: /[\u0900-\u097F]/ },               // devanagari
];

const LATIN_RULES: LatinRule[] = [
  {
    lang: "es-ES",
    words: ["que","los","las","una","con","por","para","pero","cuando","donde","como","amor","corazon","corazón","mi","tu","vida","noche","quiero","bailar"],
    chars: /[ñ¿¡]/,
  },
  {
    lang: "pt-BR",
    words: ["não","nao","você","voce","eu","ela","ele","com","para","muito","então","entao","amor","coração","coracao","saudade","minha","tua"],
    chars: /[ãõç]/,
  },
  {
    lang: "fr-FR",
    words: ["le","la","les","est","vous","nous","mais","pour","avec","très","tres","amour","cœur","coeur","toi","moi"],
    chars: /[çàâéèêëîïôûùœ]/,
  },
  {
    lang: "it-IT",
    words: ["non","che","sono","della","cosa","sempre","amore","cuore","quando","perché","perche","tutto"],
    chars: /[àèéìòù]/,
  },
  {
    lang: "de-DE",
    words: ["der","die","das","und","nicht","ich","ist","mit","auf","ein","eine","liebe","herz","mein","dein"],
    chars: /[äöüß]/,
  },
  {
    lang: "en-US",
    words: ["the","you","love","heart","baby","yeah","never","always","when","where","like","just","know","feel","got","let"],
  },
];

export function detectLanguage(text: string | null | undefined): string {
  if (!text) return "en-US";

  // Script-based rules win immediately when present.
  for (const r of SCRIPT_RULES) {
    if (r.test.test(text)) return r.lang;
  }

  const lower = text.toLowerCase();
  const tokens = lower
    .replace(/[^a-zàâäéèêëîïôöùûüçñãõßœ'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  let best = "en-US";
  let bestScore = 0;
  for (const rule of LATIN_RULES) {
    let score = 0;
    const wordSet = new Set(rule.words);
    for (const t of tokens) if (wordSet.has(t)) score += 1;
    if (rule.chars && rule.chars.test(text)) score += 6;
    if (score > bestScore) {
      bestScore = score;
      best = rule.lang;
    }
  }
  return best;
}

export function languageLabel(code: string): string {
  const map: Record<string, string> = {
    "en-US": "English",
    "en-GB": "English (UK)",
    "es-ES": "Spanish",
    "es-MX": "Spanish (MX)",
    "pt-BR": "Portuguese (BR)",
    "pt-PT": "Portuguese (PT)",
    "fr-FR": "French",
    "it-IT": "Italian",
    "de-DE": "German",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "zh-CN": "Chinese",
    "ar-SA": "Arabic",
    "ru-RU": "Russian",
    "hi-IN": "Hindi",
  };
  return map[code] ?? code;
}
