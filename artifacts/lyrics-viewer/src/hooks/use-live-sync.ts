import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LrcLine } from "@/lib/lrc";

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechResultEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechResultEventLike {
  resultIndex: number;
  results: { [i: number]: { [j: number]: { transcript: string }; length: number }; length: number };
}

interface UseLiveSyncResult {
  active: boolean;
  matchedIndex: number;
  error: string | null;
  supported: boolean;
  lastHeard: string;
  start: () => Promise<boolean>;
  stop: () => void;
}

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","i","you","we","he","she","it","is","am","are","was","were","be","been","being",
  "to","of","in","on","at","by","for","with","as","my","your","our","their","this","that","these","those","not",
  "do","does","did","just","so","too","up","down","yeah","oh","ooh","hey","ah",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

function getSpeechRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// "Follow the singer" sync: every time the speech recogniser hands us a new
// transcript chunk, find the lyric line whose tokens best overlap the recent
// transcript window — biased toward staying near the current line so the
// highlight doesn't ping-pong across the song on weak hits.
//
// Critically, we do NOT "ride" the LRC timeline after a match: cover bands
// don't play at the recorded tempo, skip verses, repeat choruses, and stretch
// outros. Riding the timeline drifts off within seconds. Continuous matching
// stays glued to whatever the singer actually sings.
export function useLiveSync(lrcLines: LrcLine[] | null, lang: string = "en-US"): UseLiveSyncResult {
  const [active, setActive] = useState(false);
  const [matchedIndex, setMatchedIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [lastHeard, setLastHeard] = useState("");
  const lastHeardUpdateRef = useRef(0);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantActiveRef = useRef(false);
  const matchedIndexRef = useRef(-1);
  const startingRef = useRef(false);
  const sessionIdRef = useRef(0);
  const langRef = useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);

  const restartTimerRef = useRef<number | null>(null);
  const lastStartAtRef = useRef(0);
  const lrcLinesRef = useRef<LrcLine[] | null>(lrcLines);
  useEffect(() => { lrcLinesRef.current = lrcLines; }, [lrcLines]);

  const supported = useMemo(() => {
    if (getSpeechRecognitionCtor() === null) return false;
    if (typeof window !== "undefined" && !window.isSecureContext) return false;
    return true;
  }, []);

  const lineTokens = useMemo(() => {
    if (!lrcLines) return [];
    return lrcLines.map((l) => tokenize(l.text));
  }, [lrcLines]);

  const matchTranscript = useCallback(
    (transcript: string) => {
      const now = performance.now();
      if (now - lastHeardUpdateRef.current > 250) {
        lastHeardUpdateRef.current = now;
        setLastHeard(transcript.trim().slice(-80));
      }

      const tokens = tokenize(transcript);
      if (tokens.length === 0) return;
      // Recent window — last ~12 meaningful tokens so we react to the current phrase
      const recent = tokens.slice(-12);
      const recentSet = new Set(recent);

      const cur = matchedIndexRef.current;

      // Score every line. Bias strongly toward lines near the current one.
      // Far-away jumps require a much stronger match — this stops "love" or "baby"
      // (which appear in 30% of songs) from teleporting the cursor across the page.
      let bestScore = 0;
      let bestIdx = -1;
      let bestDistinctHits = 0;
      for (let i = 0; i < lineTokens.length; i++) {
        const lt = lineTokens[i];
        if (lt.length === 0) continue;
        // Count distinct token hits (de-dupe so "baby baby baby" only counts once)
        const ltSet = new Set(lt);
        let distinctHits = 0;
        for (const t of ltSet) if (recentSet.has(t)) distinctHits++;
        if (distinctHits === 0) continue;
        const lineCoverage = distinctHits / Math.max(ltSet.size, 1);
        const transcriptCoverage = distinctHits / Math.max(recent.length, 1);
        const overlap = 0.7 * lineCoverage + 0.3 * transcriptCoverage;

        // Proximity bonus / penalty:
        //  - Same / next 1-2 lines: full score (advancing naturally)
        //  - Within ±8 lines: small penalty
        //  - Far away: heavy penalty (must be a very strong, multi-word match to win)
        let proximityFactor = 1;
        if (cur >= 0) {
          const distance = Math.abs(i - cur);
          if (distance <= 2) proximityFactor = 1.0;
          else if (distance <= 8) proximityFactor = 0.85;
          else proximityFactor = 0.45;
        }

        const adjusted = overlap * proximityFactor;
        if (adjusted > bestScore) {
          bestScore = adjusted;
          bestIdx = i;
          bestDistinctHits = distinctHits;
        }
      }

      if (bestIdx < 0) return;

      // Acceptance gates:
      //  - First lock (no current line yet): need a clearly strong hit AND >=2 distinct
      //    tokens so we don't snap to a random line on the first stray word.
      //  - Tracking near current line: looser, single-word hits OK so the cursor keeps
      //    moving with the singer through short connector lines.
      //  - Far jumps (>8 lines from current): require BOTH a strong score AND >=2 distinct
      //    tokens. A single repeated common word is never enough to teleport across the page.
      const distance = cur >= 0 ? Math.abs(bestIdx - cur) : 0;
      const isFarJump = cur >= 0 && distance > 8;
      const isFirstLock = cur < 0;

      let accept: boolean;
      if (isFirstLock) {
        accept = bestScore >= 0.45 && bestDistinctHits >= 2;
      } else if (isFarJump) {
        accept = bestScore >= 0.40 && bestDistinctHits >= 2;
      } else {
        accept = bestScore >= 0.25;
      }

      if (accept && bestIdx !== cur) {
        matchedIndexRef.current = bestIdx;
        setMatchedIndex(bestIdx);
      }
    },
    [lineTokens],
  );

  const matchTranscriptRef = useRef(matchTranscript);
  useEffect(() => { matchTranscriptRef.current = matchTranscript; }, [matchTranscript]);

  const stop = useCallback(() => {
    sessionIdRef.current += 1;
    wantActiveRef.current = false;
    startingRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setActive(false);
    setMatchedIndex(-1);
    setLastHeard("");
    matchedIndexRef.current = -1;
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (startingRef.current || recognitionRef.current) return active;
    startingRef.current = true;
    setError(null);

    const sessionId = ++sessionIdRef.current;
    const isStale = () => sessionId !== sessionIdRef.current;

    const SR = getSpeechRecognitionCtor();
    if (!SR) {
      startingRef.current = false;
      setError("Live sync needs a browser with speech recognition (Chrome, Edge, or Safari).");
      return false;
    }
    if (!lrcLines || lrcLines.length === 0) {
      startingRef.current = false;
      setError("No timed lyrics found for this song. Live sync needs synced lyrics.");
      return false;
    }

    try {
      const r = new SR();
      r.continuous = true;
      r.interimResults = true;
      r.lang = langRef.current;
      r.onresult = (e) => {
        if (isStale()) return;
        let transcript = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          transcript += e.results[i][0].transcript + " ";
        }
        matchTranscriptRef.current(transcript);
      };
      r.onerror = (e) => {
        if (isStale()) return;
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setError("Microphone permission was denied. Please allow microphone access and try again.");
          stop();
        } else if (e.error === "audio-capture") {
          setError("No microphone detected. Please check your microphone and try again.");
          stop();
        }
        // Other errors (no-speech, aborted, network): let onend auto-restart
      };
      r.onend = () => {
        if (isStale() || !wantActiveRef.current || recognitionRef.current !== r) return;
        const RESTART_DELAY_MS = 2500;
        const elapsed = Date.now() - lastStartAtRef.current;
        const wait = Math.max(0, RESTART_DELAY_MS - elapsed);
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null;
          if (isStale() || !wantActiveRef.current || recognitionRef.current !== r) return;
          try {
            lastStartAtRef.current = Date.now();
            r.start();
          } catch {
            recognitionRef.current = null;
            wantActiveRef.current = false;
            setActive(false);
            setError("Live sync stopped unexpectedly. Tap Live Sync to restart.");
          }
        }, wait);
      };
      lastStartAtRef.current = Date.now();
      r.start();

      if (isStale()) {
        try { r.stop(); } catch { /* ignore */ }
        startingRef.current = false;
        return false;
      }

      recognitionRef.current = r;
      wantActiveRef.current = true;
      setActive(true);
      startingRef.current = false;
      return true;
    } catch {
      startingRef.current = false;
      if (!isStale()) setError("Could not start speech recognition. Please try again.");
      return false;
    }
  }, [lrcLines, stop, active]);

  useEffect(() => () => stop(), [stop]);

  // When the song's LRC changes, fully stop active recognition
  useEffect(() => {
    stop();
  }, [lrcLines, stop]);

  // When language changes during an active session, restart with the new lang
  const startRef = useRef(start);
  useEffect(() => { startRef.current = start; }, [start]);
  const prevLangRef = useRef(lang);
  useEffect(() => {
    if (prevLangRef.current === lang) return;
    prevLangRef.current = lang;
    if (recognitionRef.current) {
      stop();
      void startRef.current();
    }
  }, [lang, stop]);

  return { active, matchedIndex, error, supported, lastHeard, start, stop };
}
