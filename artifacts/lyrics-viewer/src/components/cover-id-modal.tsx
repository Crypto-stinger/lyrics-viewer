import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, X, Loader2, AlertCircle, Search, RotateCcw, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  onClose: () => void;
  onOpenLyrics: (artist: string, title: string) => void;
}

// Tunables. 10 seconds is long enough for Web Speech to capture a clean lyric
// line and short enough that a singer on stage isn't staring at a spinner.
const LISTEN_SECONDS = 10;
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
}
interface LyricSearchResponse {
  success: boolean;
  results?: Array<{ artist: string; title: string; hasSynced?: boolean; hasPlain?: boolean }>;
  message?: string;
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

/** Server-side Genius search (full-text over lyric bodies), enriched with
 *  LRCLIB availability flags so the UI can prefer songs we can actually
 *  display synced lyrics for. Falls back to client-side LRCLIB search if the
 *  server endpoint fails. */
async function searchByLyricSnippet(query: string): Promise<LyricCandidate[]> {
  try {
    const res = await fetch(LYRIC_SEARCH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    // 400 = the server explicitly rejected the query (too short, etc.). We
    // surface zero results so the snippet UI can show its own "type a longer
    // line" message rather than papering over it with LRCLIB title-only hits.
    if (res.status === 400) return [];
    if (!res.ok) {
      // 503 / 429 / 502 — service degraded. Give the user *something* by
      // falling back to LRCLIB's title-only search.
      return await searchLrclib(query);
    }
    const data = (await res.json()) as LyricSearchResponse;
    if (data.success && Array.isArray(data.results) && data.results.length > 0) {
      return data.results;
    }
    // Server reachable but no hits — try LRCLIB as a cross-check.
    return await searchLrclib(query);
  } catch {
    return await searchLrclib(query);
  }
}

// ---- Component ---------------------------------------------------------------
type Mode = "idle" | "listening" | "processing" | "results" | "error";

export function CoverIdModal({ onClose, onOpenLyrics }: Props) {
  const [mode, setMode] = useState<Mode>("idle");
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
      const hits = await searchByLyricSnippet(query);
      if (!alive()) return;
      if (hits.length === 0) {
        setSnippetError("No songs found for that phrase. Try a longer or more distinctive line.");
      } else {
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

    try {
      const hits = await searchByLyricSnippet(transcript);
      if (!alive()) return;
      setLyricCandidates(hits);
    } catch {
      /* swallow — surfaced via no-results state */
    } finally {
      if (alive()) setMode("results");
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
      setLiveTranscript(dedupeTranscript((transcriptRef.current + " " + interim).trim()));
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
  }, []);

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
                Listen for {LISTEN_SECONDS}s
              </Button>
              <p className="text-[11px] text-muted-foreground/70 text-center -mt-2 px-2">
                We'll transcribe the vocals and search the lyrics — works best on the chorus.
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
                          <p className="text-xs text-muted-foreground truncate">{s.artist}</p>
                        </div>
                        {s.hasSynced ? (
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
