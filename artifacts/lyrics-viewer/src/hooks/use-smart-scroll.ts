import { useCallback, useEffect, useRef, useState } from "react";

interface SmartScrollState {
  active: boolean;
  vocalActive: boolean;
  level: number;
  error: string | null;
  start: () => Promise<boolean>;
  stop: () => void;
}

const VOCAL_LOW_HZ = 200;
const VOCAL_HIGH_HZ = 3000;
const VOCAL_ENERGY_THRESHOLD = 38;
const SILENCE_TIMEOUT_MS = 2500;
const LEVEL_UPDATE_MS = 100; // throttle level state updates to 10fps

export function useSmartScroll(): SmartScrollState {
  const [active, setActive] = useState(false);
  const [vocalActive, setVocalActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastVocalTimeRef = useRef<number>(0);
  const lastLevelUpdateRef = useRef<number>(0);
  const sessionIdRef = useRef<number>(0);
  const startingRef = useRef<boolean>(false);

  const stop = useCallback(() => {
    sessionIdRef.current += 1; // invalidate any in-flight start()
    startingRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setActive(false);
    setVocalActive(false);
    setLevel(0);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    // Reentrancy guard
    if (startingRef.current || audioCtxRef.current) return active;
    startingRef.current = true;
    setError(null);

    const sessionId = ++sessionIdRef.current;
    const isStale = () => sessionId !== sessionIdRef.current;

    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      startingRef.current = false;
      setError("Audio capture is not supported in this browser.");
      return false;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      startingRef.current = false;
      if (!isStale()) {
        setError("We could not access your microphone. Please allow microphone permission and try again.");
      }
      return false;
    }

    // Cancelled during getUserMedia: clean up the stream we just got and bail
    if (isStale()) {
      stream.getTracks().forEach((t) => t.stop());
      startingRef.current = false;
      return false;
    }

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      stream.getTracks().forEach((t) => t.stop());
      startingRef.current = false;
      setError("Audio analysis is not supported in this browser.");
      return false;
    }

    let ctx: AudioContext;
    try {
      ctx = new Ctor();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);

      // Final stale check after sync setup; commit refs only if still owned
      if (isStale()) {
        ctx.close().catch(() => {});
        stream.getTracks().forEach((t) => t.stop());
        startingRef.current = false;
        return false;
      }

      streamRef.current = stream;
      audioCtxRef.current = ctx;

      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const binWidth = ctx.sampleRate / analyser.fftSize;
      const lowBin = Math.max(1, Math.floor(VOCAL_LOW_HZ / binWidth));
      const highBin = Math.min(freqData.length - 1, Math.floor(VOCAL_HIGH_HZ / binWidth));

      lastVocalTimeRef.current = performance.now();
      lastLevelUpdateRef.current = 0;

      const tick = () => {
        if (sessionId !== sessionIdRef.current) return; // session ended
        analyser.getByteFrequencyData(freqData);
        let sum = 0;
        for (let i = lowBin; i < highBin; i++) sum += freqData[i];
        const avg = sum / (highBin - lowBin);

        const now = performance.now();
        if (now - lastLevelUpdateRef.current >= LEVEL_UPDATE_MS) {
          lastLevelUpdateRef.current = now;
          setLevel(Math.min(1, avg / 110));
        }

        if (avg > VOCAL_ENERGY_THRESHOLD) {
          lastVocalTimeRef.current = now;
          setVocalActive((v) => (v ? v : true));
        } else if (now - lastVocalTimeRef.current > SILENCE_TIMEOUT_MS) {
          setVocalActive((v) => (v ? false : v));
        }

        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      setActive(true);
      startingRef.current = false;
      return true;
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      startingRef.current = false;
      if (!isStale()) setError("Could not start audio analysis. Please try again.");
      return false;
    }
  }, [active]);

  useEffect(() => () => stop(), [stop]);

  return { active, vocalActive, level, error, start, stop };
}
