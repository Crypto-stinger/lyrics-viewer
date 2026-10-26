import { useCallback, useEffect, useRef, useState } from "react";
import type { LrcLine } from "@/lib/lrc";

interface UseAcrSyncResult {
  active: boolean;
  matchedIndex: number;
  error: string | null;
  status: "idle" | "listening" | "locked";
  start: () => Promise<boolean>;
  stop: () => void;
}

const SAMPLE_DURATION_MS = 5000;       // record 5s for fingerprinting
const FINGERPRINT_INTERVAL_MS = 8000;  // re-fingerprint every ~8s
const TICK_INTERVAL_MS = 200;          // update matched line 5x/sec between fingerprints

interface Anchor {
  offsetMs: number;        // playback offset within song at the moment of capture
  capturedAtMs: number;    // local clock time when the sample finished recording
}

export function useAcrSync(lrcLines: LrcLine[] | null): UseAcrSyncResult {
  const [active, setActive] = useState(false);
  const [matchedIndex, setMatchedIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "listening" | "locked">("idle");

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  const fingerprintTimerRef = useRef<number | null>(null);
  const sessionIdRef = useRef(0);
  const startingRef = useRef(false);
  const anchorRef = useRef<Anchor | null>(null);
  const lrcLinesRef = useRef<LrcLine[] | null>(lrcLines);
  useEffect(() => { lrcLinesRef.current = lrcLines; }, [lrcLines]);

  const stop = useCallback(() => {
    sessionIdRef.current += 1;
    startingRef.current = false;
    if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }
    if (fingerprintTimerRef.current) { clearInterval(fingerprintTimerRef.current); fingerprintTimerRef.current = null; }
    if (recorderRef.current) {
      try { if (recorderRef.current.state !== "inactive") recorderRef.current.stop(); } catch { /* ignore */ }
      recorderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    anchorRef.current = null;
    setActive(false);
    setStatus("idle");
    setMatchedIndex(-1);
  }, []);

  const computeLineFromAnchor = useCallback(() => {
    const anchor = anchorRef.current;
    const lines = lrcLinesRef.current;
    if (!anchor || !lines || lines.length === 0) return;
    const elapsed = Date.now() - anchor.capturedAtMs;
    const currentMs = anchor.offsetMs + elapsed;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].timeMs <= currentMs) idx = i;
      else break;
    }
    if (idx >= 0) {
      setMatchedIndex((prev) => (prev === idx ? prev : idx));
    }
  }, []);

  const captureSample = useCallback(async (sessionId: number): Promise<Blob | null> => {
    if (sessionId !== sessionIdRef.current || !streamRef.current) return null;
    return new Promise<Blob | null>((resolve) => {
      try {
        const recorder = new MediaRecorder(streamRef.current!, { mimeType: "audio/webm" });
        recorderRef.current = recorder;
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
          if (sessionId !== sessionIdRef.current) { resolve(null); return; }
          resolve(new Blob(chunks, { type: "audio/webm" }));
        };
        recorder.onerror = () => resolve(null);
        recorder.start();
        setTimeout(() => {
          try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* ignore */ }
        }, SAMPLE_DURATION_MS);
      } catch {
        resolve(null);
      }
    });
  }, []);

  const fingerprint = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    const blob = await captureSample(sessionId);
    if (!blob || sessionId !== sessionIdRef.current) return;

    const form = new FormData();
    form.append("audio", blob, "sample.webm");
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/sync-position`, {
        method: "POST",
        body: form,
      });
      if (sessionId !== sessionIdRef.current) return;
      const data = (await res.json()) as {
        success: boolean;
        playOffsetMs?: number;
        capturedAt?: number;
        message?: string;
      };
      if (data.success && typeof data.playOffsetMs === "number") {
        anchorRef.current = {
          offsetMs: data.playOffsetMs,
          capturedAtMs: Date.now() - SAMPLE_DURATION_MS / 2, // anchor mid-sample
        };
        setStatus("locked");
        setError(null);
        computeLineFromAnchor();
      } else if (!anchorRef.current) {
        // No lock yet — keep "listening" status
        setStatus("listening");
      }
    } catch {
      if (!anchorRef.current) setStatus("listening");
    }
  }, [captureSample, computeLineFromAnchor]);

  const start = useCallback(async (): Promise<boolean> => {
    if (startingRef.current || streamRef.current) return active;
    startingRef.current = true;
    setError(null);

    if (!lrcLines || lrcLines.length === 0) {
      startingRef.current = false;
      setError("No timed lyrics found for this song.");
      return false;
    }
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      startingRef.current = false;
      setError("Audio capture is not supported in this browser.");
      return false;
    }
    if (typeof MediaRecorder === "undefined") {
      startingRef.current = false;
      setError("Audio recording is not supported in this browser.");
      return false;
    }

    const sessionId = ++sessionIdRef.current;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      startingRef.current = false;
      setError("Microphone permission denied. Please allow microphone access.");
      return false;
    }

    if (sessionId !== sessionIdRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      startingRef.current = false;
      return false;
    }

    streamRef.current = stream;
    setActive(true);
    setStatus("listening");
    startingRef.current = false;

    // First fingerprint immediately, then on interval
    void fingerprint();
    fingerprintTimerRef.current = window.setInterval(() => { void fingerprint(); }, FINGERPRINT_INTERVAL_MS);
    tickTimerRef.current = window.setInterval(computeLineFromAnchor, TICK_INTERVAL_MS);
    return true;
  }, [active, lrcLines, fingerprint, computeLineFromAnchor]);

  useEffect(() => () => stop(), [stop]);

  // Stop when LRC changes (new song)
  useEffect(() => {
    stop();
  }, [lrcLines, stop]);

  return { active, matchedIndex, error, status, start, stop };
}
