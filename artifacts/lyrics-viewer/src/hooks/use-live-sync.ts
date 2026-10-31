import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LrcLine } from "@/lib/lrc";
import { CueEngine, type CueState } from "@/lib/cue-engine";

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
  /** Band tempo relative to the recording (1 = same, 0.9 = 10% slower). */
  rate: number;
  /** What the cue is doing right now, for the status banner. */
  cueState: CueState;
  start: () => Promise<boolean>;
  stop: () => void;
  /** Manually move the cue (e.g. the singer tapped a line). */
  jumpTo: (index: number) => void;
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

const TICK_MS = 100;

// "Follow the singer" auto-cue.
//
// The speech recogniser feeds words into a CueEngine (lib/cue-engine.ts),
// which keeps a running position in the song and the band's tempo relative to
// the record. Between word matches the cue keeps moving at that tempo, waits
// when the singer stops, and jumps to the next line when they come back in —
// so it stays in time through loud sections, solos and tempo changes instead
// of freezing until the next recognised word.
export function useLiveSync(lrcLines: LrcLine[] | null, lang: string = "en-US"): UseLiveSyncResult {
  const [active, setActive] = useState(false);
  const [matchedIndex, setMatchedIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [lastHeard, setLastHeard] = useState("");
  const [rate, setRate] = useState(1);
  const [cueState, setCueState] = useState<CueState>("listening");
  const lastHeardUpdateRef = useRef(0);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const engineRef = useRef<CueEngine | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  const wantActiveRef = useRef(false);
  const matchedIndexRef = useRef(-1);
  const rateRef = useRef(1);
  const cueStateRef = useRef<CueState>("listening");
  const startingRef = useRef(false);
  const sessionIdRef = useRef(0);
  const langRef = useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);

  const restartTimerRef = useRef<number | null>(null);
  const lastStartAtRef = useRef(0);
  const quickEndsRef = useRef(0);

  const supported = useMemo(() => {
    if (getSpeechRecognitionCtor() === null) return false;
    if (typeof window !== "undefined" && !window.isSecureContext) return false;
    return true;
  }, []);

  const publish = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const snap = eng.tick(performance.now());
    if (snap.index !== matchedIndexRef.current) {
      matchedIndexRef.current = snap.index;
      setMatchedIndex(snap.index);
    }
    const r = Math.round(snap.rate * 100) / 100;
    if (r !== rateRef.current) { rateRef.current = r; setRate(r); }
    if (snap.state !== cueStateRef.current) { cueStateRef.current = snap.state; setCueState(snap.state); }
  }, []);

  const stop = useCallback(() => {
    sessionIdRef.current += 1;
    wantActiveRef.current = false;
    startingRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    engineRef.current = null;
    setActive(false);
    setMatchedIndex(-1);
    setLastHeard("");
    setRate(1);
    setCueState("listening");
    matchedIndexRef.current = -1;
    rateRef.current = 1;
    cueStateRef.current = "listening";
  }, []);

  const jumpTo = useCallback((index: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.jumpTo(index, performance.now());
    publish();
  }, [publish]);

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
      const engine = new CueEngine(lrcLines);
      engineRef.current = engine;
      const r = new SR();
      r.continuous = true;
      r.interimResults = true;
      r.lang = langRef.current;
      r.onresult = (e) => {
        if (isStale()) return;
        // The last few result segments = the most recent phrase. Older,
        // already-final segments aren't needed: the engine only looks at the
        // last ~9 words.
        let transcript = "";
        for (let i = Math.max(0, e.results.length - 3); i < e.results.length; i++) {
          transcript += e.results[i][0].transcript + " ";
        }
        const now = performance.now();
        engine.hear(transcript, now);
        if (now - lastHeardUpdateRef.current > 250) {
          lastHeardUpdateRef.current = now;
          setLastHeard(transcript.trim().slice(-80));
        }
        publish();
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
        // While the recogniser restarts it hears nothing — tell the engine so
        // that silence isn't read as "the singer stopped".
        engine.setDeaf(true, performance.now());
        // Restart fast (the old 2.5 s pause lost whole lines). Back off only
        // if the browser keeps ending sessions immediately.
        const ranFor = Date.now() - lastStartAtRef.current;
        quickEndsRef.current = ranFor < 1500 ? quickEndsRef.current + 1 : 0;
        const wait = quickEndsRef.current >= 3 ? 2000 : 150;
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null;
          if (isStale() || !wantActiveRef.current || recognitionRef.current !== r) return;
          try {
            lastStartAtRef.current = Date.now();
            r.start();
            engine.setDeaf(false, performance.now());
          } catch {
            stop();
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
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
      tickTimerRef.current = window.setInterval(publish, TICK_MS);
      setActive(true);
      startingRef.current = false;
      return true;
    } catch {
      startingRef.current = false;
      if (!isStale()) setError("Could not start speech recognition. Please try again.");
      return false;
    }
  }, [lrcLines, stop, active, publish]);

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

  return { active, matchedIndex, error, supported, lastHeard, rate, cueState, start, stop, jumpTo };
}
