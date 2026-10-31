/**
 * Song identification from a short sung/typed lyric snippet.
 *
 * Pipeline:
 *   1. Expand the heard words into a few search variants (informal/formal
 *      contractions, first or last word dropped in case it was misheard).
 *   2. Run them through a full-text lyric search (Genius) and merge the hits.
 *   3. Fetch each candidate's actual lyrics and fuzzy-align the heard words
 *      against them (see lyric-match.ts). This is the main ranking signal:
 *      the search engine finds *possible* songs; alignment checks the snippet
 *      really is in there, and finds the line.
 *   4. Collapse covers/remasters of the same song, prefer the original
 *      (popularity, no karaoke/tribute markers, synced lyrics available).
 *   5. Judge confidence from the gap between the best song and the best
 *      *different* song.
 *
 * Network access is injected so this file can be unit-tested and evaluated
 * outside the server.
 */
import {
  alignHeard,
  heardTokens,
  heardWeights,
  judgeConfidence,
  prepareLyrics,
  songKey,
  type Confidence,
  type PreparedLyrics,
} from "./lyric-match";

export interface SearchHit {
  title: string;
  artist: string;
  /** Genius page views when available — a proxy for "this is the original". */
  pageviews?: number;
}

export interface FetchedLyrics {
  text: string | null;
  hasSynced: boolean;
  hasPlain: boolean;
}

export interface RankDeps {
  search: (query: string) => Promise<SearchHit[]>;
  lyrics: (artist: string, title: string) => Promise<FetchedLyrics>;
}

export interface RankedSong {
  title: string;
  artist: string;
  hasSynced: boolean;
  hasPlain: boolean;
  /** 0..1 final ranking score. */
  score: number;
  /** 0..1 alignment of the heard words with this song's lyrics (null = lyrics unavailable). */
  matchScore: number | null;
  /** The lyric line(s) the snippet matched, for display. */
  matchedLine?: string;
  /** Other artists found for the same song (covers / versions). */
  alsoBy?: string[];
}

export interface RankResult {
  results: RankedSong[];
  confidence: Confidence;
  heard: string;
  queries: string[];
}

const JUNK_RE =
  /\b(karaoke|tribute|instrumental|made famous|in the style of|originally performed|backing track|8[- ]?bit|lullaby|music box|piano version|cover version|parody|re-?recorded|reaction|slowed|sped up|nightcore|remix)\b/i;

/** Generate up to `max` distinct search strings from the heard tokens. */
export function queryVariants(raw: string, max = 4): string[] {
  const tokens = heardTokens(raw);
  const base = tokens.join(" ");
  const informal = base; // tokenizeLyric already maps "going to" → "gonna"
  const formal = base
    .replace(/\bgonna\b/g, "going to")
    .replace(/\bwanna\b/g, "want to")
    .replace(/\bgotta\b/g, "got to")
    .replace(/\bim\b/g, "i'm")
    .replace(/\bdont\b/g, "don't")
    .replace(/\bcant\b/g, "can't");
  const out: string[] = [];
  const push = (q: string) => {
    const t = q.trim();
    if (t.split(" ").length >= 3 && !out.includes(t)) out.push(t);
  };
  push(raw.trim().toLowerCase());
  push(informal);
  push(formal);
  if (tokens.length >= 5) {
    push(tokens.slice(1).join(" ")); // first word misheard
    push(tokens.slice(0, -1).join(" ")); // last word misheard / cut off
  }
  if (tokens.length >= 9) {
    // Long transcripts: the most recent phrase is usually the cleanest
    push(tokens.slice(-6).join(" "));
  }
  return out.slice(0, max);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function identifyFromLyrics(
  rawQuery: string,
  deps: RankDeps,
  opts: { maxQueries?: number; maxCandidates?: number; verifyBudgetMs?: number } = {},
): Promise<RankResult> {
  // Lyric checks are the slow part. On stage an answer in ~4 s beats a
  // perfect answer in 15 s, so candidates not checked in time stay unverified.
  const verifyDeadline = Date.now() + (opts.verifyBudgetMs ?? 4000);
  const heard = heardTokens(rawQuery);
  const weights = heardWeights(heard);
  const queries = queryVariants(rawQuery, opts.maxQueries ?? 4);

  // ---- 1-2. Search and merge -------------------------------------------------
  const hitLists = await Promise.all(
    queries.map((q) => deps.search(q).catch(() => [] as SearchHit[])),
  );
  type Cand = SearchHit & { prior: number; firstSeen: number };
  const byKey = new Map<string, Cand>();
  let order = 0;
  hitLists.forEach((hits, qi) => {
    const qWeight = qi === 0 ? 1 : 0.8;
    hits.forEach((h, rank) => {
      const k = `${h.artist.toLowerCase()}|${h.title.toLowerCase()}`;
      const add = qWeight / (rank + 1);
      const ex = byKey.get(k);
      if (ex) {
        ex.prior += add;
        if (h.pageviews && !ex.pageviews) ex.pageviews = h.pageviews;
      } else {
        byKey.set(k, { ...h, prior: add, firstSeen: order++ });
      }
    });
  });
  const cands = [...byKey.values()]
    .sort((a, b) => b.prior - a.prior || a.firstSeen - b.firstSeen)
    .slice(0, opts.maxCandidates ?? 10);

  if (cands.length === 0 || heard.length === 0) {
    return { results: [], confidence: judgeConfidence(0, 0, heard), heard: heard.join(" "), queries };
  }

  // ---- 3. Verify against real lyrics ----------------------------------------
  const maxPrior = Math.max(...cands.map((c) => c.prior));
  const maxViews = Math.max(1, ...cands.map((c) => c.pageviews ?? 0));
  const verified = await mapLimit(cands, 4, async (c) => {
    const none: FetchedLyrics = { text: null, hasSynced: false, hasPlain: false };
    const left = verifyDeadline - Date.now();
    const ly: FetchedLyrics =
      left <= 0
        ? none
        : await Promise.race([
            deps.lyrics(c.artist, c.title).catch(() => none),
            new Promise<FetchedLyrics>((r) => setTimeout(() => r(none), left)),
          ]);
    let matchScore: number | null = null;
    let matchedLine: string | undefined;
    if (ly.text) {
      const prep: PreparedLyrics = prepareLyrics(ly.text);
      const a = alignHeard(heard, prep, weights);
      matchScore = a.score;
      if (a.startLine >= 0) {
        matchedLine = prep.lines
          .slice(a.startLine, Math.min(a.endLine, a.startLine + 1) + 1)
          .map((l) => l.replace(/\[\d+:\d+(?:\.\d+)?\]/g, "").trim())
          .filter(Boolean)
          .join(" / ");
      }
    }
    const junk = JUNK_RE.test(`${c.title} ${c.artist}`);
    const popularity = c.pageviews ? Math.log10(1 + c.pageviews) / Math.log10(1 + maxViews) : 0;
    const prior = c.prior / maxPrior;
    // Unverified candidates (no lyrics found) are kept but capped well below
    // anything that actually matched, so they never produce a confident pick.
    const verify = matchScore ?? Math.min(0.45, 0.25 + 0.2 * prior);
    const score =
      0.78 * verify +
      0.08 * prior +
      0.08 * popularity +
      (ly.hasSynced ? 0.06 : ly.hasPlain ? 0.03 : 0) -
      (junk ? 0.25 : 0);
    return {
      title: c.title,
      artist: c.artist,
      hasSynced: ly.hasSynced,
      hasPlain: ly.hasPlain,
      score: Math.max(0, Math.min(1, score)),
      matchScore,
      matchedLine,
      junk,
      popularity,
    };
  });

  // ---- 4. Collapse versions of the same song --------------------------------
  verified.sort((a, b) => b.score - a.score);
  const groups = new Map<string, typeof verified>();
  for (const v of verified) {
    const k = songKey(v.title) || v.title.toLowerCase();
    const g = groups.get(k);
    if (g) g.push(v);
    else groups.set(k, [v]);
  }
  const songs: RankedSong[] = [];
  // popularity / junk of each song's representative, for the confidence step
  const meta = new Map<RankedSong, { popularity: number; junk: boolean }>();
  for (const g of groups.values()) {
    // Representative: best match, then non-junk, then most popular.
    g.sort((a, b) => {
      const d = (b.matchScore ?? 0) - (a.matchScore ?? 0);
      if (Math.abs(d) > 0.05) return d;
      if (a.junk !== b.junk) return a.junk ? 1 : -1;
      if (b.popularity !== a.popularity) return b.popularity - a.popularity;
      return b.score - a.score;
    });
    const rep = g[0];
    const alsoBy = [...new Set(g.slice(1).map((x) => x.artist))].filter((a) => a !== rep.artist).slice(0, 4);
    const song: RankedSong = {
      title: rep.title,
      artist: rep.artist,
      hasSynced: rep.hasSynced || g.some((x) => x.hasSynced && x.artist === rep.artist),
      hasPlain: rep.hasPlain,
      score: Math.max(...g.map((x) => x.score)),
      matchScore: rep.matchScore,
      matchedLine: rep.matchedLine,
      ...(alsoBy.length ? { alsoBy } : {}),
    };
    meta.set(song, { popularity: Math.max(...g.map((x) => x.popularity)), junk: g.every((x) => x.junk) });
    songs.push(song);
  }
  songs.sort((a, b) => b.score - a.score);

  // ---- 5. Confidence --------------------------------------------------------
  // Compare the top song with the best *other verified* song. Songs whose
  // lyrics couldn't be fetched say nothing either way, so they don't widen
  // the margin — and with fewer than two verified songs we can't be "sure".
  const top = songs[0];
  const best = top?.matchScore ?? 0;
  const others = songs.slice(1).filter((s) => s.matchScore !== null);
  // Famous lines get quoted by parodies, mash-ups and lesser-known songs. A
  // rival that matches equally well but is far less popular (or is a
  // karaoke/tribute track) shouldn't stop us being sure of the original.
  const topPop = top ? meta.get(top)?.popularity ?? 0 : 0;
  const rivalScore = (s: RankedSong) => {
    const m = meta.get(s);
    const popGap = Math.max(0, topPop - (m?.popularity ?? 0));
    return (s.matchScore ?? 0) - 0.25 * popGap - (m?.junk ? 0.15 : 0);
  };
  const runner = others.length ? Math.max(0, ...others.map(rivalScore)) : 0;
  const confidence = judgeConfidence(best, runner, heard);
  if (top && top.matchScore === null) confidence.level = "low";
  else if (others.length === 0 && confidence.level === "high") confidence.level = "medium";

  return { results: songs.slice(0, 10), confidence, heard: heard.join(" "), queries };
}
