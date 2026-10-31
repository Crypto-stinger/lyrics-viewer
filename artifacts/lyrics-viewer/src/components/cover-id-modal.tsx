import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, X, Loader2, AlertCircle, Search, RotateCcw, Type, ListMusic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { heardTokens, judgeConfidence, type Confidence } from "@/lib/lyric-match";
import { useLibraryMatcher, type LibraryHit } from "@/hooks/use-library-matcher";

interface Props {
  onClose: () => void;
  onOpenLyrics: (artist: string, title: string) => void;
}

// Tunables. We listen for up to 20 s but search as soon as ~5 words are in,
// and stop the moment one song is a clear winner — usually well before the
// timer runs out.
const LISTEN_SECONDS = 20;
const FIRST_SEARCH_WORDS = 5;
const MORE_WORDS_BEFORE_RESEARCH = 3;
const MAX_SEARCHES_PER_LISTEN = 5;
const LYRIC_SEARCH_ENDPOINT = `${import.meta.env.BASE_URL}api/lyric-search`;
const LRCLIB_SEARCH = (q: string) => `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;

// ---- Web Speech API typings (kept minimal so we don't depend on dom.lib) -----
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    [i: number]: { [j: number]: { transcript: string }; isFinal: boolean; length: number };
    length: number;
  };
}
function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ---- API contracts -----------------------------------------------------------
interface LrcLibHit { trackName?: string; artistName?: string; syncedLyrics?: string | null; plainLyrics?: string | null }

interface LyricCandidate {
  artist: string;
  title: string;
  hasSynced?: boolean;
  hasPlain?: boolean;
  /** 0..1 — how well the heard words line up with this song's lyrics. */
  matchScore?: number | null;
  matchedLine?: string;
  alsoBy?: string[];
  /** Found in the band's own setlists / favourites. */
  fromLibrary?: boolean;
}
interface LyricSearchResponse {
  success: boolean;
  results?: LyricCandidate[];
  confidence?: Confidence;
  message?: string;
}
interface SearchOutcome {
  results: LyricCandidate[];
  confidence: Confidence | null;
}

const NO_CONFIDENCE: Confidence = { level: "none", score: 0, margin: 0, words: 0 };

/** Put library (setlist/favourite) hits first when they match well, and drop
 *  duplicates of the same song coming back from the web search. */
function mergeWithLibrary(lib: LibraryHit[], web: LyricCandidate[]): LyricCandidate[] {
  const good = lib.filter((h) => h.matchScore >= 0.6);
  const key = (a: string, t: string) => `${a.toLowerCase()}|${t.toLowerCase()}`;
  const seen = new Set(good.map((h) => key(h.artist, h.title)));
  return [
    ...good.map((h) => ({ ...h, fromLibrary: true, hasSynced: undefined, hasPlain: undefined })),
    ...web.filter((w) => !seen.has(key(w.artist, w.title))),
  ];
}

// ---- Helpers -----------------------------------------------------------------

/** Collapse consecutive duplicate words / 2-3 word phrases that the speech
 *  engine emits when re-finalising sung phrases. Turns
 *  "sweet sweet sweet calendar sweet calendar like" into "sweet calendar like"
 *  so the lyric search has a real chance. */
function dedupeTranscript(raw: string): string {
  const words = raw.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const noSingleRepeats: string[] = [];
  for (const w of words) {
    if (noSingleRepeats[noSingleRepeats.length - 1] !== w) noSingleRepeats.push(w);
  }
  let arr = noSingleRepeats;
  for (const span of [3, 2]) {
    const out: string[] = [];
    let i = 0;
    while (i < arr.length) {
      if (i + span * 2 <= arr.length) {
        const a = arr.slice(i, i + span).join(" ");
        const b = arr.slice(i + span, i + span * 2).join(" ");
        if (a === b) { out.push(...arr.slice(i, i + span)); i += span * 2; continue; }
      }
      out.push(arr[i]); i += 1;
    }
    arr = out;
  }
  return arr.join(" ");
}

/** Fallback: LRCLIB's own search endpoint only indexes track/artist names,
 *  not lyric bodies — so it can only match if your snippet happens to appear
 *  in the song title. We keep it as a last resort if our Genius-backed
 *  /api/lyric-search endpoint is unavailable. */
async function searchLrclib(query: string): Promise<LyricCandidate[]> {
  const res = await fetch(LRCLIB_SEARCH(query));
  if (!res.ok) return [];
  const results = (await res.json()) as LrcLibHit[];
  if (!Array.isArray(results) || results.length === 0) return [];
  const seen = new Set<string>();
  const out: LyricCandidate[] = [];
  for (const r of results) {
    if (!r.trackName || !r.artistName) continue;
    const k = `${r.artistName.toLowerCase()}|${r.trackName.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      artist: r.artistName,
      title: r.trackName,
      hasSynced: !!r.syncedLyrics,
      hasPlain: !!r.plainLyrics,
    });
    if (out.length >= 10) break;
  }
  return out;
}

/** Server-side search: Genius full-text search, then each candidate's lyrics
 *  are fetched and fuzzy-aligned with what was heard, so the ranking and the
 *  confidence reflect whether the words are really in the song. Falls back to
 *  client-side LRCLIB title search if the server endpoint fails. */
async function searchByLyricSnippet(query: string): Promise<SearchOutcome> {
  try {
    const res = await fetch(LYRIC_SEARCH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    // 400 = the server explicitly rejected the query (too short, etc.). We
    // surface zero results so the snippet UI can show its own "type a longer
    // line" message rather than papering over it with LRCLIB title-only hits.
    if (res.status === 400) return { results: [], confidence: null };
    if (!res.ok) {
      // 503 / 429 / 502 — service degraded. Give the user *something* by
      // falling back to LRCLIB's title-only search (never auto-opened).
      return { results: await searchLrclib(query), confidence: null };
    }
    const data = (await res.json()) as LyricSearchResponse;
    if (data.success && Array.isArray(data.results) && data.results.length > 0) {
      return { results: data.results, confidence: data.confidence ?? null };
    }
    // Server reachable but no hits — try LRCLIB as a cross-check.
    return { results: await searchLrclib(query), confidence: null };
  } catch {
    return { results: await searchLrclib(query), confidence: null };
  }
}

// ---- Component ---------------------------------------------------------------
type Mode = "idle" | "listening" | "processing" | "results" | "error";

export function CoverIdModal({ onClose, onOpenLyrics }: Props) {
  const [mode, setMode] = useState<Mode>("idle");
  const library = useLibraryMatcher(true);
  // Best match so far; confidence is advisory, never permission to navigate.
  const [bestGuess, setBestGuess] = useState<{ cand: LyricCandidate; conf: Confidence } | null>(null);
  const [searching, setSearching] = useState(false);
  const [countdown, setCountdown] = useState(LISTEN_SECONDS);
  const [errorMsg, setErrorMsg] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");

  const [lyricCandidates, setLyricCandidates] = useState<LyricCandidate[]>([]);

  // Typed-snippet path (always available, unaffected by mic flow)
  const [snippetText, setSnippetText] = useState("");
  const [snippetLoading, setSnippetLoading] = useState(false);
  const [snippetError, setSnippetError] = useState("");

  // Surfaces *why* speech-to-text isn't producing a transcript so the singer
  // sees a clear reason rather than a silent empty box.
  const [speechIssue, setSpeechIssue] = useState("");

  // Capture refs
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const speechCtorRef = useRef<(new () => SpeechRecognitionLike) | null>(null);
  const transcriptRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef(LISTEN_SECONDS);
  // Cleared on Stop / countdown end so Speech's onend doesn't try to restart
  // and re-spin the mic after we've moved into "processing".
  const userStoppedRef = useRef(false);
  // Bumped on every new listen, on reset, and on unmount. The async lyric
  // search promise checks this before touching state, so a slow response
  // from a previous session can never overwrite a fresh one.
  const sessionIdRef = useRef(0);
  const mountedRef = useRef(true);
  // Progressive search bookkeeping (per listen).
  const searchInFlightRef = useRef(false);
  const searchedWordsRef = useRef(0);
  const searchesRef = useRef(0);
  const lockedRef = useRef(false);
  const latestResultsRef = useRef<SearchOutcome>({ results: [], confidence: null });
  const libraryRef = useRef(library);
  libraryRef.current = library;

  // ---- Cleanup ---------------------------------------------------------------
  const stopMicAndTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (speechRef.current) {
      speechRef.current.onresult = null;
      speechRef.current.onend = null;
      speechRef.current.onerror = null;
      try { speechRef.current.stop(); } catch { /* ignore */ }
      speechRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => {
      mountedRef.current = false;
      // Invalidate any in-flight session promises so they no-op on resolve.
      sessionIdRef.current += 1;
      document.removeEventListener("keydown", handler);
      stopMicAndTimer();
    };
  }, [onClose, stopMicAndTimer]);

  // A confident match ends listening, but always leaves selection to the user.
  const lockIn = useCallback((cand: LyricCandidate, conf: Confidence, candidates: LyricCandidate[]) => {
    if (lockedRef.current || conf.level !== "high") return;
    lockedRef.current = true;
    userStoppedRef.current = true;
    stopMicAndTimer();
    setBestGuess({ cand, conf });
    setLyricCandidates(candidates.length ? candidates : [cand]);
    setSearching(false);
    setMode("results");
  }, [stopMicAndTimer]);

  /** Check the band's own songs first: instant, offline, and 5 words are
   *  usually decisive among a few dozen songs. */
  const checkLibrary = useCallback((heard: string[]): LibraryHit[] => {
    if (heard.length < 4) return [];
    const hits = libraryRef.current.match(heard);
    if (hits.length && !lockedRef.current) {
      const conf = judgeConfidence(hits[0].matchScore, hits[1]?.matchScore ?? 0, heard);
      // A small library makes big margins easy, so ask for a stronger match.
      if (conf.level === "high" && hits[0].matchScore >= 0.82) {
        lockIn({ ...hits[0], fromLibrary: true }, conf, mergeWithLibrary(hits, latestResultsRef.current.results));
      }
    }
    return hits;
  }, [lockIn]);

  /** While listening: search once ~5 words are in, then again every few new
   *  words, and lock in as soon as one song is clearly ahead. */
  const maybeSearch = useCallback((text: string) => {
    if (lockedRef.current) return;
    const heard = heardTokens(text);
    const libHits = checkLibrary(heard);
    if (lockedRef.current) return;
    if (heard.length < FIRST_SEARCH_WORDS) return;
    if (searchInFlightRef.current || searchesRef.current >= MAX_SEARCHES_PER_LISTEN) return;
    if (searchesRef.current > 0 && heard.length - searchedWordsRef.current < MORE_WORDS_BEFORE_RESEARCH) return;
    searchInFlightRef.current = true;
    searchesRef.current += 1;
    searchedWordsRef.current = heard.length;
    const session = sessionIdRef.current;
    setSearching(true);
    void searchByLyricSnippet(heard.join(" "))
      .then((out) => {
        if (!mountedRef.current || sessionIdRef.current !== session || lockedRef.current) return;
        const merged = mergeWithLibrary(libHits, out.results);
        latestResultsRef.current = { results: merged, confidence: out.confidence };
        const top = merged[0];
        if (!top) return;
        const conf = top.fromLibrary
          ? judgeConfidence(top.matchScore ?? 0, merged[1]?.matchScore ?? 0, heard)
          : out.confidence ?? NO_CONFIDENCE;
        setBestGuess({ cand: top, conf });
        if (conf.level === "high" && (top.matchScore ?? 0) > 0) lockIn(top, conf, merged);
      })
      .finally(() => {
        if (mountedRef.current && sessionIdRef.current === session) {
          searchInFlightRef.current = false;
          setSearching(false);
        }
      });
  }, [checkLibrary, lockIn]);

  // ---- Typed-snippet path (primary, always works) ---------------------------
  const handleSnippetSearch = useCallback(async (queryArg?: string) => {
    const query = (queryArg ?? snippetText).trim();
    if (!query) return;
    // Capture the session this search belongs to so a slow response can't
    // flip the modal to "results" if the user has since pressed Listen,
    // pressed Start Over, or closed the modal entirely.
    const session = sessionIdRef.current;
    const alive = () => mountedRef.current && sessionIdRef.current === session;
    setSnippetLoading(true);
    setSnippetError("");
    setLyricCandidates([]);
    try {
      const heard = heardTokens(query);
      const libHits = heard.length >= 3 ? libraryRef.current.match(heard) : [];
      const out = await searchByLyricSnippet(query);
      if (!alive()) return;
      const hits = mergeWithLibrary(libHits, out.results);
      if (hits.length === 0) {
        setSnippetError("No songs found for that phrase. Try a longer or more distinctive line.");
      } else {
        const top = hits[0];
        const conf = top.fromLibrary
          ? judgeConfidence(top.matchScore ?? 0, hits[1]?.matchScore ?? 0, heard)
          : out.confidence ?? NO_CONFIDENCE;
        setBestGuess({ cand: top, conf });
        setLyricCandidates(hits);
        setMode("results");
      }
    } catch {
      if (alive()) setSnippetError("Search failed. Check your connection and try again.");
    } finally {
      if (alive()) setSnippetLoading(false);
    }
  }, [snippetText]);

  // ---- Web Speech listen path ----------------------------------------------
  /** Once the recording window closes, send the transcript to the server-side
   *  Genius/LRCLIB search and show the candidates. */
  const finaliseAndIdentify = useCallback(async () => {
    const session = sessionIdRef.current;
    const alive = () => mountedRef.current && sessionIdRef.current === session;

    if (lockedRef.current) return;
    setMode("processing");
    stopMicAndTimer();

    const transcript = dedupeTranscript(transcriptRef.current.trim());
    setLiveTranscript(transcript);
    setLyricCandidates([]);

    if (!transcript) {
      // No vocals captured — drop straight into the "no results" UI with the
      // typed-snippet fallback prominently visible.
      if (alive()) setMode("results");
      return;
    }

    const heard = heardTokens(transcript);
    // Already searched with (nearly) all of these words while listening.
    if (latestResultsRef.current.results.length > 0 && heard.length - searchedWordsRef.current < 2) {
      setLyricCandidates(latestResultsRef.current.results);
      setMode("results");
      return;
    }
    try {
      const libHits = libraryRef.current.match(heard);
      const out = await searchByLyricSnippet(heard.join(" "));
      if (!alive() || lockedRef.current) return;
      const hits = mergeWithLibrary(libHits, out.results);
      if (hits[0]) {
        const conf = hits[0].fromLibrary
          ? judgeConfidence(hits[0].matchScore ?? 0, hits[1]?.matchScore ?? 0, heard)
          : out.confidence ?? NO_CONFIDENCE;
        setBestGuess({ cand: hits[0], conf });
      }
      setLyricCandidates(hits);
    } catch {
      /* swallow — surfaced via no-results state */
    } finally {
      if (alive() && !lockedRef.current) setMode("results");
    }
  }, [stopMicAndTimer]);

  /** Build a fresh SpeechRecognition instance and wire it up. We restart on
   *  premature end (browsers — particularly Chrome on Android — kill the
   *  recognizer after a few seconds of silence even with continuous=true) so
   *  the user actually gets the full listen window. */
  const attachRecognizer = useCallback((): SpeechRecognitionLike | null => {
    const Ctor = speechCtorRef.current;
    if (!Ctor) return null;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    r.onresult = (e) => {
      let interim = "";
      let appendedFinal = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0]?.transcript ?? "";
        if (e.results[i].isFinal) appendedFinal += t + " ";
        else interim += t;
      }
      if (appendedFinal) {
        transcriptRef.current = (transcriptRef.current + " " + appendedFinal).trim();
        setSpeechIssue("");
      }
      const soFar = (transcriptRef.current + " " + interim).trim();
      setLiveTranscript(dedupeTranscript(soFar));
      maybeSearch(soFar);
    };
    r.onerror = (ev) => {
      // eslint-disable-next-line no-console
      console.warn("[cover-id] SpeechRecognition error:", ev.error);
      // "no-speech" / "aborted" are recoverable; let onend restart us.
      if (ev.error === "no-speech" || ev.error === "aborted") return;
      const friendly =
        ev.error === "not-allowed" || ev.error === "service-not-allowed"
          ? "Microphone access was blocked. Allow microphone in your browser settings and try again."
          : ev.error === "audio-capture"
          ? "No audio is reaching the mic. Check that no other app is using it."
          : ev.error === "network"
          ? "Speech engine couldn't reach Google's servers. Check your connection."
          : `Speech transcription failed (${ev.error}).`;
      setSpeechIssue(friendly);
      // Fatal error — flag the session as stopped so onend doesn't churn
      // by restarting a recognizer that will just fail again.
      userStoppedRef.current = true;
      try { r.stop(); } catch { /* ignore */ }
    };
    r.onend = () => {
      if (!userStoppedRef.current && countdownRef.current > 0) {
        const next = attachRecognizer();
        if (next) {
          speechRef.current = next;
          try { next.start(); return; } catch { /* fall through */ }
        }
      }
    };
    return r;
  }, [maybeSearch]);

  const startListening = useCallback(() => {
    // New session — invalidates any in-flight finalisers from a prior listen.
    sessionIdRef.current += 1;
    setErrorMsg("");
    setLiveTranscript("");
    setSpeechIssue("");
    setLyricCandidates([]);
    transcriptRef.current = "";
    countdownRef.current = LISTEN_SECONDS;
    setCountdown(LISTEN_SECONDS);
    userStoppedRef.current = false;
    lockedRef.current = false;
    searchInFlightRef.current = false;
    searchedWordsRef.current = 0;
    searchesRef.current = 0;
    latestResultsRef.current = { results: [], confidence: null };
    setBestGuess(null);
    setSearching(false);

    if (typeof window !== "undefined" && !window.isSecureContext) {
      setErrorMsg("Listening requires HTTPS. Open the site over a secure connection.");
      setMode("error");
      return;
    }

    speechCtorRef.current = getSpeechRecognitionCtor();
    if (!speechCtorRef.current) {
      setErrorMsg(
        "Your browser can't transcribe vocals. Try Chrome or Edge — or type a line you heard below.",
      );
      setMode("error");
      return;
    }

    const r = attachRecognizer();
    if (!r) {
      setErrorMsg("Could not start speech recognition. Try again or type a line you heard.");
      setMode("error");
      return;
    }
    speechRef.current = r;
    try {
      // SpeechRecognition.start() triggers its own mic-permission prompt the
      // first time. No separate getUserMedia call needed — keeping it that
      // way avoids the Chrome-Android conflict where MediaRecorder hogs the
      // mic and the recognizer silently produces no transcript.
      r.start();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[cover-id] SpeechRecognition.start() threw:", err);
      setErrorMsg("Couldn't start listening. Tap the button again, or type a line you heard.");
      setMode("error");
      return;
    }

    setMode("listening");

    timerRef.current = setInterval(() => {
      countdownRef.current -= 1;
      setCountdown(countdownRef.current);
      if (countdownRef.current <= 0) {
        userStoppedRef.current = true;
        void finaliseAndIdentify();
      }
    }, 1000);
  }, [attachRecognizer, finaliseAndIdentify]);

  const stopListening = useCallback(() => {
    userStoppedRef.current = true;
    void finaliseAndIdentify();
  }, [finaliseAndIdentify]);

  const reset = () => {
    sessionIdRef.current += 1;
    stopMicAndTimer();
    lockedRef.current = false;
    setBestGuess(null);
    setSearching(false);
    userStoppedRef.current = false;
    setMode("idle");
    setErrorMsg("");
    setLiveTranscript("");
    setSpeechIssue("");
    setLyricCandidates([]);
    setSnippetText("");
    setSnippetError("");
    setCountdown(LISTEN_SECONDS);
    transcriptRef.current = "";
  };

  // ---- Render --------------------------------------------------------------
  const progressPct = ((LISTEN_SECONDS - countdown) / LISTEN_SECONDS) * 100;
  const showResults = mode === "results";
  const noResultsAtAll = showResults && lyricCandidates.length === 0;
  const hasAnyResults = lyricCandidates.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Find this song"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md bg-background border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-foreground text-base">Find this song</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Listen for the vocals, or type a line you heard</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-accent transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Idle: dual options */}
          {mode === "idle" && !hasAnyResults && (
            <>
              <Button
                size="lg"
                className="w-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 text-white hover:opacity-90"
                onClick={startListening}
                data-testid="button-start-listening"
              >
                <Mic className="w-5 h-5 mr-2" />
                Listen
              </Button>
              <p className="text-[11px] text-muted-foreground/70 text-center -mt-2 px-2">
                About 5 clear words is usually enough — we check your setlists first and stop as soon as we're sure.
              </p>

              <div className="flex items-center gap-3">
                <div className="h-px bg-border flex-1" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="h-px bg-border flex-1" />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Type className="w-3 h-3" /> Type a line you heard
                </label>
                <div className="flex gap-2">
                  <Input
                    placeholder='e.g. "and the cradle will rock"'
                    value={snippetText}
                    onChange={(e) => setSnippetText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleSnippetSearch(); }}
                    className="h-10 text-sm"
                    data-testid="input-lyric-snippet"
                  />
                  <Button
                    size="default"
                    className="shrink-0 px-4"
                    onClick={() => { void handleSnippetSearch(); }}
                    disabled={snippetLoading || !snippetText.trim()}
                    data-testid="button-search-snippet"
                  >
                    {snippetLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </Button>
                </div>
                {snippetError && (
                  <p className="text-xs text-destructive">{snippetError}</p>
                )}
              </div>
            </>
          )}

          {/* Listening */}
          {mode === "listening" && (
            <div className="space-y-4">
              <div className="text-center space-y-3">
                <div className="relative w-16 h-16 mx-auto">
                  <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                  <div className="relative w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <Mic className="w-7 h-7 text-primary" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Listening…</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {countdown}s remaining — point the mic at the vocals
                  </p>
                </div>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 rounded-full transition-all duration-1000" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="min-h-[2.5rem] px-3 py-2 bg-muted/40 border border-border rounded-lg text-xs text-muted-foreground italic" data-testid="text-cover-id-transcript">
                {liveTranscript ? `"${liveTranscript}"` : "Listening for vocals…"}
              </div>
              {speechIssue && (
                <p className="text-[11px] text-amber-500/90 px-1" data-testid="text-speech-issue">
                  {speechIssue}
                </p>
              )}
              <div className="min-h-[2.75rem] px-3 py-2 rounded-lg border border-dashed border-border text-xs" data-testid="text-best-guess">
                {bestGuess ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-muted-foreground">Best guess so far</p>
                      <p className="text-foreground font-medium truncate">{bestGuess.cand.title} — {bestGuess.cand.artist}</p>
                    </div>
                    <ConfidenceBadge level={bestGuess.conf.level} />
                  </div>
                ) : (
                  <p className="text-muted-foreground flex items-center gap-2">
                    {searching && <Loader2 className="w-3 h-3 animate-spin" />}
                    {heardTokens(liveTranscript).length < FIRST_SEARCH_WORDS
                      ? `Need about ${FIRST_SEARCH_WORDS} words to start matching…`
                      : "Checking…"}
                    {library.total > 0 && ` · checking your ${library.total} saved songs first`}
                  </p>
                )}
              </div>
              <Button variant="outline" className="w-full" onClick={stopListening} data-testid="button-stop-listening">
                Stop &amp; Identify Now
              </Button>
            </div>
          )}

          {/* Processing */}
          {mode === "processing" && (
            <div className="space-y-3 py-4">
              <div className="flex items-center gap-3 px-3 py-2.5 bg-muted/30 border border-border rounded-lg">
                <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                <p className="text-xs text-foreground">Searching lyrics…</p>
              </div>
              {liveTranscript && (
                <p className="text-[11px] text-muted-foreground/70 italic px-1">"{liveTranscript}"</p>
              )}
            </div>
          )}

          {/* Results */}
          {showResults && hasAnyResults && (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Lyric matches — pick the right one
                </p>
                <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden" data-testid="list-snippet-results">
                  {lyricCandidates.map((s, i) => (
                    <li key={i} className="bg-card hover:bg-accent/50 transition-colors">
                      <button
                        className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-3"
                        onClick={() => onOpenLyrics(s.artist, s.title)}
                        data-testid={`button-pick-result-${i}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground leading-snug truncate">{s.title}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {s.artist}
                            {s.alsoBy && s.alsoBy.length > 0 && <span className="text-muted-foreground/60"> · also {s.alsoBy.slice(0, 2).join(", ")}</span>}
                          </p>
                          {s.matchedLine && (
                            <p className="text-[11px] text-muted-foreground/80 italic truncate">"{s.matchedLine}"</p>
                          )}
                        </div>
                        {i === 0 && bestGuess && bestGuess.cand.title === s.title && bestGuess.cand.artist === s.artist && (
                          <ConfidenceBadge level={bestGuess.conf.level} />
                        )}
                        {s.fromLibrary ? (
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30 flex items-center gap-1">
                            <ListMusic className="w-3 h-3" /> yours
                          </span>
                        ) : s.hasSynced ? (
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
                            synced
                          </span>
                        ) : s.hasPlain ? (
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                            plain
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={reset} data-testid="button-reset">
                <RotateCcw className="w-3 h-3 mr-1.5" /> Start over
              </Button>
            </div>
          )}

          {/* No results */}
          {noResultsAtAll && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 bg-muted/40 border border-border rounded-xl">
                <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm text-foreground">No confident match.</p>
                  <p className="text-xs text-muted-foreground">
                    {liveTranscript
                      ? "The vocals were transcribed but no clear song matched. Try a more distinctive line below."
                      : "No vocals were heard. Try again during the chorus, or type a memorable lyric line."}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Type className="w-3 h-3" /> Type a line you heard
                </label>
                <div className="flex gap-2">
                  <Input
                    placeholder='e.g. "sweet caroline good times never seemed so good"'
                    value={snippetText || liveTranscript}
                    onChange={(e) => setSnippetText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleSnippetSearch(); }}
                    className="h-10 text-sm"
                    data-testid="input-lyric-snippet"
                  />
                  <Button
                    size="default"
                    className="shrink-0 px-4"
                    onClick={() => { void handleSnippetSearch(snippetText || liveTranscript); }}
                    disabled={snippetLoading || !(snippetText.trim() || liveTranscript.trim())}
                    data-testid="button-search-snippet"
                  >
                    {snippetLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </Button>
                </div>
                {snippetError && (
                  <p className="text-xs text-destructive">{snippetError}</p>
                )}
              </div>
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={reset} data-testid="button-reset">
                <RotateCcw className="w-3 h-3 mr-1.5" /> Start over
              </Button>
            </div>
          )}

          {/* Error */}
          {mode === "error" && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 bg-destructive/10 border border-destructive/30 rounded-xl">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-foreground" data-testid="text-cover-id-error">{errorMsg}</p>
              </div>
              <Button variant="outline" className="w-full" onClick={reset} data-testid="button-reset">
                <RotateCcw className="w-3 h-3 mr-1.5" /> Try again
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfidenceBadge({ level }: { level: Confidence["level"] }) {
  const map: Record<Confidence["level"], { label: string; cls: string }> = {
    high: { label: "sure", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
    medium: { label: "likely", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" },
    low: { label: "unsure", cls: "bg-muted text-muted-foreground border-border" },
    none: { label: "no match", cls: "bg-muted text-muted-foreground border-border" },
  };
  const m = map[level];
  return (
    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border ${m.cls}`} data-testid="badge-confidence">
      {m.label}
    </span>
  );
}
