/**
 * Fuzzy lyric matching shared by Live Cover ID and Auto-cue.
 *
 * KEEP IN SYNC: an identical copy lives at
 *   artifacts/api-server/src/lib/lyric-match.ts
 * (the API server is a separate package, so the file is duplicated rather than
 * shared through a workspace library). If you change one, copy it to the other.
 *
 * Why this exists: speech-to-text on sung vocals over a band gets words wrong
 * all the time ("going to" for "gonna", "light" for "life", "any time" for
 * "anytime", dropped words). A plain keyword search fails on the first wrong
 * word. This module aligns what was heard against a song's full lyrics with
 * partial credit for near-misses and sound-alikes, so 5 words with one or two
 * mistakes still land on the right song and the right line.
 *
 * Pure TypeScript, no dependencies, safe to run in the browser or Node.
 */

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Multi-word sung contractions → one canonical token. Applied to BOTH the
 *  heard text and the lyrics, so "going to" and "gonna" compare equal. */
const PHRASES: Array<[RegExp, string]> = [
  [/\bgoing to\b/g, "gonna"],
  [/\bgoin to\b/g, "gonna"],
  [/\bwant to\b/g, "wanna"],
  [/\bwant a\b/g, "wanna"],
  [/\bgot to\b/g, "gotta"],
  [/\bgot a\b/g, "gotta"],
  [/\bhave to\b/g, "hafta"],
  [/\bkind of\b/g, "kinda"],
  [/\bsort of\b/g, "sorta"],
  [/\bout of\b/g, "outta"],
  [/\blet me\b/g, "lemme"],
  [/\bgive me\b/g, "gimme"],
  [/\bdon t know\b/g, "dunno"],
  [/\bdo not\b/g, "dont"],
  [/\bcan not\b/g, "cannot"],
  [/\bany time\b/g, "anytime"],
  [/\bevery body\b/g, "everybody"],
  [/\bevery one\b/g, "everyone"],
  [/\bsome body\b/g, "somebody"],
  [/\bsome one\b/g, "someone"],
  [/\bto night\b/g, "tonight"],
  [/\bto day\b/g, "today"],
  [/\bal right\b/g, "alright"],
  [/\ball right\b/g, "alright"],
  [/\bwhoa+\b/g, "oh"],
  [/\bwo+ah\b/g, "oh"],
  [/\bo+h+\b/g, "oh"],
];

/** Single-word spelling variants → canonical. */
const WORDS: Record<string, string> = {
  cause: "because", cuz: "because", coz: "because", cos: "because", bc: "because",
  til: "until", till: "until",
  ya: "you", yah: "you", u: "you", yall: "youall",
  em: "them",
  tho: "though", thru: "through",
  ok: "okay",
  yeah: "yeah", yea: "yeah", yep: "yeah",
  im: "im", ive: "ive",
  luv: "love",
  nite: "night",
  lil: "little",
  mama: "mama", momma: "mama",
  na: "na", nah: "na",
};

/** Words that carry little identifying information. They still count, but at
 *  reduced weight, so "is this the real life" (mostly stop words) still works
 *  while "baby baby oh" can't produce a confident match on its own. */
export const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "i", "you", "we", "he", "she", "it", "they", "me", "him", "her", "us", "them",
  "is", "am", "are", "was", "were", "be", "been", "being", "im", "its", "youre", "were", "theyre",
  "to", "of", "in", "on", "at", "by", "for", "with", "as", "from", "into",
  "my", "your", "our", "their", "his", "this", "that", "these", "those", "there",
  "not", "no", "do", "does", "did", "dont", "just", "so", "too", "up", "down", "all", "if", "when",
  "yeah", "oh", "ooh", "hey", "ah", "la", "na", "baby", "love",
]);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Lower-case, unify apostrophes, drop punctuation, apply sung-contraction
 *  rules. Returns canonical tokens. */
export function tokenizeLyric(text: string): string[] {
  let s = stripAccents(text.toLowerCase())
    .replace(/[‘’ʼ`´]/g, "'")
    // g-dropping: "nothin'", "lovin'" → "nothing", "loving"
    .replace(/\b([a-z]{2,})in'(?=\s|$|[^a-z])/g, "$1ing")
    // "'cause", "'til", "'em" lose the leading apostrophe
    .replace(/(^|\s)'([a-z])/g, "$1$2")
    // remaining apostrophes join the word ("don't" → "dont")
    .replace(/'/g, "")
    // section markers in lyrics: [Chorus], (x2)
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\(x?\d+x?\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [re, rep] of PHRASES) s = s.replace(re, rep);
  if (!s) return [];
  return s.split(" ").map((w) => WORDS[w] ?? w).filter(Boolean);
}

/** Remove the stutter the speech engine produces when it re-finalises a sung
 *  phrase ("sweet sweet sweet caroline sweet caroline" → "sweet caroline"). */
export function dedupeTokens(tokens: string[]): string[] {
  const single: string[] = [];
  for (const w of tokens) if (single[single.length - 1] !== w) single.push(w);
  let arr = single;
  for (const span of [4, 3, 2]) {
    const out: string[] = [];
    let i = 0;
    while (i < arr.length) {
      if (i + span * 2 <= arr.length) {
        let same = true;
        for (let k = 0; k < span; k++) if (arr[i + k] !== arr[i + span + k]) { same = false; break; }
        if (same) { out.push(...arr.slice(i, i + span)); i += span * 2; continue; }
      }
      out.push(arr[i]);
      i += 1;
    }
    arr = out;
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Word similarity
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Rough English sound key: keeps the consonant skeleton and merges consonants
 *  that speech engines confuse (b/p, d/t, g/k/c, s/z, f/v/ph). Two words with
 *  the same key are treated as probable mishearings of each other. */
export function soundKey(w: string): string {
  let s = w
    .replace(/^kn/, "n").replace(/^wr/, "r").replace(/^ps/, "s")
    .replace(/ph/g, "f").replace(/gh/g, "").replace(/ck/g, "k")
    .replace(/sh/g, "X").replace(/ch/g, "X").replace(/th/g, "0")
    .replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/q/g, "k").replace(/x/g, "ks")
    .replace(/[bp]/g, "B").replace(/[dt]/g, "T").replace(/[gk]/g, "K")
    .replace(/[sz]/g, "S").replace(/[fv]/g, "F");
  const first = s[0] ?? "";
  s = first + s.slice(1).replace(/[aeiouyhw]/g, "");
  // vowel-initial words: keep a single generic vowel marker
  s = s.replace(/^[aeiouy]/, "A").replace(/(.)\1+/g, "$1");
  return s.toUpperCase();
}

const simCache = new Map<string, number>();

/** 0..1 similarity between a heard word and a lyric word. */
export function wordSim(a: string, b: string): number {
  if (a === b) return 1;
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  const hit = simCache.get(key);
  if (hit !== undefined) return hit;
  let sim = 0;
  const maxLen = Math.max(a.length, b.length);
  // Plurals / tense: "dream" vs "dreams", "walk" vs "walked"
  if (maxLen >= 4 && (a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 2) {
    sim = 0.85;
  } else {
    const ratio = 1 - levenshtein(a, b) / maxLen;
    const sk = soundKey(a) === soundKey(b) && maxLen >= 3;
    if (sk) sim = Math.max(0.8, ratio);
    else if (ratio >= 0.6 && maxLen >= 4) sim = ratio * 0.8;
    else if (ratio >= 0.5 && maxLen >= 3) sim = ratio * 0.5;
  }
  if (simCache.size > 50_000) simCache.clear();
  simCache.set(key, sim);
  return sim;
}

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

export interface PreparedLyrics {
  tokens: string[];
  /** Line index (in the original text, split on newlines) for each token. */
  tokenLine: number[];
  lines: string[];
}

/** Tokenise lyrics once so repeated matches against the same song are cheap. */
export function prepareLyrics(text: string | string[]): PreparedLyrics {
  const lines = Array.isArray(text) ? text : text.split(/\r?\n/);
  const tokens: string[] = [];
  const tokenLine: number[] = [];
  lines.forEach((raw, li) => {
    // Strip LRC timestamps if synced lyrics were passed in.
    const line = raw.replace(/\[\d+:\d+(?:\.\d+)?\]/g, "");
    for (const t of tokenizeLyric(line)) {
      tokens.push(t);
      tokenLine.push(li);
    }
  });
  return { tokens, tokenLine, lines };
}

export interface AlignResult {
  /** 0..1 — share of what was heard that lines up with these lyrics. */
  score: number;
  /** First and last lyric line touched by the best alignment (-1 if none). */
  startLine: number;
  endLine: number;
  /** Lyric token range [startToken, endToken) of the best alignment. */
  startToken: number;
  endToken: number;
}

const SKIP_HEARD_PENALTY = 0.05; // recogniser inserted a word that isn't in the lyric
const SKIP_LYRIC_PENALTY = 0.22; // recogniser dropped a word the singer sang
const STOP_WEIGHT = 0.45;

export function heardWeights(heard: string[]): number[] {
  return heard.map((w) => (STOP_WORDS.has(w) ? STOP_WEIGHT : 1));
}

/**
 * Best local alignment of the heard words inside the lyric token stream.
 * Every heard word is either matched (partial credit by similarity), merged
 * with its neighbour ("any"+"time" ≈ "anytime"), split ("tonight" ≈ "to night"),
 * or skipped. Lyric words skipped inside the matched region cost a little,
 * which keeps scattered common words from adding up to a false match.
 */
export function alignHeard(heard: string[], lyr: PreparedLyrics, weights = heardWeights(heard)): AlignResult {
  const n = heard.length;
  const L = lyr.tokens;
  const m = L.length;
  const empty: AlignResult = { score: 0, startLine: -1, endLine: -1, startToken: -1, endToken: -1 };
  if (n === 0 || m === 0) return empty;
  let W = 0;
  for (const w of weights) W += w;

  const width = m + 1;
  const NEG = -1e9;
  const dp = new Float64Array((n + 1) * width).fill(NEG);
  const st = new Int32Array((n + 1) * width).fill(-1); // start token of alignment
  for (let j = 0; j <= m; j++) { dp[j] = 0; st[j] = j; }

  const relax = (i: number, j: number, v: number, s: number) => {
    const k = i * width + j;
    if (v > dp[k]) { dp[k] = v; st[k] = s; }
  };

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const k = i * width + j;
      const v = dp[k];
      if (v <= NEG / 2) continue;
      const s = st[k];
      // Skip a lyric word (only once the alignment has started).
      if (j < m && i > 0) relax(i, j + 1, v - SKIP_LYRIC_PENALTY, s);
      if (i < n) {
        // Skip a heard word.
        relax(i + 1, j, v - SKIP_HEARD_PENALTY, i === 0 ? j : s);
        if (j < m) {
          const sim = wordSim(heard[i], L[j]);
          if (sim > 0) relax(i + 1, j + 1, v + weights[i] * sim, i === 0 ? j : s);
          // Heard two words where the lyric has one ("any time" → "anytime").
          if (i + 1 < n) {
            const merged = heard[i] + heard[i + 1];
            const ms = merged === L[j] ? 1 : merged.length >= 5 ? wordSim(merged, L[j]) : 0;
            if (ms >= 0.8) relax(i + 2, j + 1, v + (weights[i] + weights[i + 1]) * ms, i === 0 ? j : s);
          }
          // Heard one word where the lyric has two ("tonight" → "to night").
          if (j + 1 < m) {
            const split = L[j] + L[j + 1];
            const ss = split === heard[i] ? 1 : split.length >= 5 ? wordSim(heard[i], split) : 0;
            if (ss >= 0.8) relax(i + 1, j + 2, v + weights[i] * ss, i === 0 ? j : s);
          }
        }
      }
    }
  }

  let best = NEG;
  let bestJ = -1;
  for (let j = 0; j <= m; j++) {
    const v = dp[n * width + j];
    if (v > best) { best = v; bestJ = j; }
  }
  if (bestJ < 0 || best <= 0) return empty;
  const startToken = Math.max(0, st[n * width + bestJ]);
  const endToken = Math.max(startToken + 1, bestJ);
  return {
    score: Math.max(0, Math.min(1, best / W)),
    startToken,
    endToken,
    startLine: lyr.tokenLine[Math.min(startToken, m - 1)] ?? -1,
    endLine: lyr.tokenLine[Math.min(endToken - 1, m - 1)] ?? -1,
  };
}

/** Convenience: normalise a raw transcript into heard tokens. */
export function heardTokens(transcript: string): string[] {
  return dedupeTokens(tokenizeLyric(transcript));
}

/** How much identifying information a phrase carries. Content words count 1,
 *  stop words 0.45. 5 ordinary words ≈ 3–4; "oh baby baby" ≈ 1.3. */
export function informationWeight(heard: string[]): number {
  let w = 0;
  for (const t of heard) w += STOP_WORDS.has(t) ? STOP_WEIGHT : 1;
  return w;
}

// ---------------------------------------------------------------------------
// Confidence across candidate songs
// ---------------------------------------------------------------------------

/** Title key that treats remasters / live versions / covers as the same song. */
export function songKey(title: string): string {
  return tokenizeLyric(
    title
      .replace(/\s*[([][^)\]]*[)\]]\s*/g, " ")
      .replace(/\s+-\s+.*$/, ""),
  ).join(" ");
}

export type ConfidenceLevel = "high" | "medium" | "low" | "none";

export interface Confidence {
  level: ConfidenceLevel;
  /** Best alignment score, 0..1. */
  score: number;
  /** Gap to the best *different* song. 1 when there is no rival. */
  margin: number;
  /** Words heard (after clean-up). */
  words: number;
}

/**
 * Decide how sure we are, from the best and runner-up *different-song* scores.
 * "high" is what the UI auto-opens on. Thresholds were set from simulated
 * mishearings of real lyrics — see the test harness notes in LYRA-CHANGES.md.
 */
export function judgeConfidence(best: number, runnerUp: number, heard: string[]): Confidence {
  const words = heard.length;
  const info = informationWeight(heard);
  // Repeated filler plus one ordinary word is not distinctive enough for
  // automatic navigation, even when it matches a candidate perfectly.
  const distinctContentWords = new Set(heard.filter((word) => !STOP_WORDS.has(word))).size;
  const margin = Math.max(0, best - runnerUp);
  let level: ConfidenceLevel = "none";
  if (best >= 0.5) level = "low";
  if (best >= 0.62 && words >= 4 && margin >= 0.06) level = "medium";
  if (best >= 0.75 && words >= 5 && info >= 2.6 && distinctContentWords >= 2 && margin >= 0.12) level = "high";
  return { level, score: best, margin, words };
}
