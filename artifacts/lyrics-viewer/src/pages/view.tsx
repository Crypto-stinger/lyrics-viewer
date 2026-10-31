import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { ArrowLeft, Heart, Minus, Plus, Play, Pause, ChevronsUp, ChevronsDown, Sun, Moon, ChevronDown, Maximize2, Minimize2, AudioLines, Crosshair, Languages, MoreVertical, Check, ListMusic, ChevronRight, ChevronLeft, SkipForward, MousePointerClick, NotebookPen, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCurrentSong } from "@/hooks/use-current-song";
import { useFavorites } from "@/hooks/use-favorites";
import { useZoom } from "@/hooks/use-zoom";
import { useFont, FONT_OPTIONS } from "@/hooks/use-font";
import { useTheme } from "@/hooks/use-theme";
import { useSmartScroll } from "@/hooks/use-smart-scroll";
import { useLrc } from "@/hooks/use-lrc";
import { useLiveSync } from "@/hooks/use-live-sync";
import { useLanguage, LANGUAGE_OPTIONS } from "@/hooks/use-language";
import { detectLanguage, languageLabel } from "@/lib/detect-language";
import { useEngineConfig } from "@/hooks/use-engine-config";
import { useAcrSync } from "@/hooks/use-acr-sync";
import { useTapSync } from "@/hooks/use-tap-sync";
import { useSongKey, KEY_OPTIONS } from "@/hooks/use-song-key";
import { useSetlists } from "@/hooks/use-setlists";
import { useSongNotes } from "@/hooks/use-song-notes";
import { SongNotesEditor } from "@/components/song-notes-editor";
import { useSetlistOverrides } from "@/hooks/use-setlist-overrides";
import { StageVersionEditor } from "@/components/stage-version-editor";
import { fetchLyrics } from "@/lib/lyrics";

const GUIDE_PERCENT = 40;
const MIN_SPEED = 10;
const MAX_SPEED = 180;
const SPEED_STEP = 15;

export default function ViewPage() {
  const { currentSong, setCurrentSong } = useCurrentSong();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { zoom, zoomIn, zoomOut, minZoom, maxZoom } = useZoom();
  const { font, fontIndex, setFontIndex } = useFont();
  const { theme, toggleTheme } = useTheme();
  const smart = useSmartScroll();
  const lrc = useLrc(currentSong?.artist, currentSong?.title);
  const { lang: langPref, setLang } = useLanguage();
  const detectedLang = useMemo(() => {
    if (!lrc.lines || lrc.lines.length === 0) return "en-US";
    return detectLanguage(lrc.lines.map(l => l.text).join(" "));
  }, [lrc.lines]);
  const effectiveLang = langPref === "auto" ? detectedLang : langPref;
  const liveSync = useLiveSync(lrc.lines, effectiveLang);
  const engineConfig = useEngineConfig();
  const acrSync = useAcrSync(lrc.lines);
  const overridesApi = useSetlistOverrides();
  const search = useSearch();
  // Early lookup of the per-setlist custom lyrics (if any). Computed up here so
  // renderedLineCount + tap-mode bounds reflect the ACTUAL rendered lyric source,
  // not the original — otherwise tap mode would clamp wrong when the singer adds
  // or removes lines in their stage version.
  const earlyCustomLyrics = useMemo(() => {
    if (!currentSong) return null;
    const params = new URLSearchParams(search);
    const id = params.get("setlist");
    if (!id) return null;
    const ov = overridesApi.getOverride(id, currentSong.artist, currentSong.title);
    return ov?.customLyrics?.trim() ? ov.customLyrics : null;
  }, [search, currentSong, overridesApi]);
  // Number of rendered lines for tap-sync. Custom stage lyrics win, then LRC,
  // then fetched plain lyrics.
  const renderedLineCount = useMemo(() => {
    if (earlyCustomLyrics) return earlyCustomLyrics.split("\n").length;
    if (lrc.lines && lrc.lines.length > 0) return lrc.lines.length;
    if (currentSong?.lyrics) return currentSong.lyrics.split("\n").length;
    return 0;
  }, [earlyCustomLyrics, lrc.lines, currentSong?.lyrics]);
  const tapSyncSongKey = currentSong ? `${currentSong.artist}::${currentSong.title}` : null;
  const tapSync = useTapSync(renderedLineCount, tapSyncSongKey);
  const songKey = useSongKey(currentSong?.artist, currentSong?.title);
  const setlistsApi = useSetlists();
  const songNotesApi = useSongNotes();
  const songNotes = currentSong ? songNotesApi.getNotes(currentSong.artist, currentSong.title) : null;
  const [notesEditorOpen, setNotesEditorOpen] = useState(false);
  const [notesPanelOpen, setNotesPanelOpen] = useState(true);
  const [stageEditorOpen, setStageEditorOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [fontSubOpen, setFontSubOpen] = useState(false);
  const [addToSetlistOpen, setAddToSetlistOpen] = useState(false);
  const [setlistNavLoading, setSetlistNavLoading] = useState(false);
  const setlistNavInFlightRef = useRef(false);

  // Setlist context from URL: ?setlist=ID&i=N — only valid if both id and i resolve to a real song.
  const setlistCtx = useMemo(() => {
    const params = new URLSearchParams(search);
    const id = params.get("setlist");
    const iStr = params.get("i");
    if (!id || iStr === null) return null;
    const i = Number(iStr);
    if (!Number.isInteger(i) || i < 0) return null;
    const sl = setlistsApi.getSetlist(id);
    if (!sl || i >= sl.songs.length) return null;
    return { setlist: sl, index: i };
  }, [search, setlistsApi]);

  const navigateSetlist = useCallback(async (delta: number) => {
    if (!setlistCtx) return;
    if (setlistNavInFlightRef.current) return;
    const next = setlistCtx.index + delta;
    if (next < 0 || next >= setlistCtx.setlist.songs.length) return;
    const song = setlistCtx.setlist.songs[next];
    setlistNavInFlightRef.current = true;
    setSetlistNavLoading(true);
    try {
      const lyrics = await fetchLyrics(song.artist, song.title).catch(() => null);
      setCurrentSong({ artist: song.artist, title: song.title, lyrics });
      // Update URL with the new index, then notify wouter so the new index is read.
      const basePath = window.location.pathname;
      window.history.replaceState(null, "", `${basePath}?setlist=${encodeURIComponent(setlistCtx.setlist.id)}&i=${next}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
      window.scrollTo(0, 0);
    } finally {
      setSetlistNavLoading(false);
      setlistNavInFlightRef.current = false;
    }
  }, [setlistCtx, setCurrentSong]);

  // Effective matched line: tap (manual) > ACR (offset) > Live (speech)
  const effectiveMatchedIndex = tapSync.active
    ? tapSync.matchedIndex
    : acrSync.active
      ? acrSync.matchedIndex
      : liveSync.active
        ? liveSync.matchedIndex
        : -1;
  const anyLiveActive = tapSync.active || acrSync.active || liveSync.active;
  const [, setLocation] = useLocation();

  const [isScrolling, setIsScrolling] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(40);
  const [activeLine, setActiveLine] = useState(-1);
  const [fitMode, setFitMode] = useState(false);
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });

  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const lineRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const liveSpeedRef = useRef<number>(0);
  // Tracks whether the user has manually adjusted the speed for this song.
  // While untouched, we auto-tune the baseline from the LRC duration so most songs
  // start at a sensible pace instead of the generic default that's too fast for some
  // songs and too slow for others.
  const userTouchedSpeedRef = useRef(false);

  useEffect(() => {
    if (!currentSong) setLocation("/");
  }, [currentSong, setLocation]);

  // Close language menu when clicking outside
  useEffect(() => {
    if (!langMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [langMenuOpen]);

  // Close settings menu on outside click
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
        setFontSubOpen(false);
        setAddToSetlistOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [settingsOpen]);

  // Live speed used by the scroll loop — gated by smart-scroll vocal activity
  useEffect(() => {
    if (smart.active && !smart.vocalActive) {
      liveSpeedRef.current = 0;
    } else {
      liveSpeedRef.current = scrollSpeed;
    }
  }, [scrollSpeed, smart.active, smart.vocalActive]);

  // Auto-scroll loop (reads live speed from ref to avoid restart on every change)
  useEffect(() => {
    if (!isScrolling) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      lastTimeRef.current = null;
      return;
    }
    const step = (ts: number) => {
      if (lastTimeRef.current === null) lastTimeRef.current = ts;
      const delta = (ts - lastTimeRef.current) / 1000;
      lastTimeRef.current = ts;
      if (liveSpeedRef.current > 0) {
        window.scrollBy(0, liveSpeedRef.current * delta);
        const atBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight - 10;
        if (atBottom) { setIsScrolling(false); return; }
      }
      animFrameRef.current = requestAnimationFrame(step);
    };
    animFrameRef.current = requestAnimationFrame(step);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [isScrolling]);

  // Stop smart listening when leaving the page
  useEffect(() => {
    return () => smart.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-cue mode picker. Persisted globally so the user's last-used mode sticks
  // across songs and reloads. Default is "off" — at the gig, you opt-in.
  type AutoCueMode = "off" | "follow" | "tap";
  const AUTOCUE_KEY = "lyra:auto-cue-mode";
  const [autoCueMode, setAutoCueModeState] = useState<AutoCueMode>(() => {
    if (typeof window === "undefined") return "off";
    const v = window.localStorage.getItem(AUTOCUE_KEY);
    return v === "follow" || v === "tap" ? v : "off";
  });
  const setAutoCueMode = useCallback((m: AutoCueMode) => {
    setAutoCueModeState(m);
    try { window.localStorage.setItem(AUTOCUE_KEY, m); } catch { /* ignore */ }
  }, []);

  // Hard exclusivity: at most one of {Smart Scroll, Auto-cue Follow, Auto-cue Tap, ACR Sync}
  // is ever active. They all compete for either the mic or the highlighted line, and any
  // overlap creates conflicting scroll/highlight behaviour mid-performance.
  const toggleSmart = useCallback(async () => {
    if (smart.active) {
      smart.stop();
    } else {
      if (liveSync.active) liveSync.stop();
      if (tapSync.active) tapSync.stop();
      if (acrSync.active) acrSync.stop();
      setAutoCueMode("off");
      const ok = await smart.start();
      if (ok) setIsScrolling(true);
    }
  }, [smart, liveSync, tapSync, acrSync, setAutoCueMode]);

  const toggleAcrSync = useCallback(async () => {
    if (acrSync.active) {
      acrSync.stop();
      return;
    }
    // ACR locks the highlight to LRC line indices via the song timeline. When
    // the singer has edited the lyrics for this gig, those indices no longer
    // match what's on screen — refuse to engage to avoid wrong-line highlight.
    if (earlyCustomLyrics) return;
    if (smart.active) smart.stop();
    if (liveSync.active) liveSync.stop();
    if (tapSync.active) tapSync.stop();
    setAutoCueMode("off");
    const ok = await acrSync.start();
    if (ok) setIsScrolling(false);
  }, [acrSync, smart, liveSync, tapSync, setAutoCueMode, earlyCustomLyrics]);

  // Defensive: if ACR was already running and the singer just enabled stage
  // lyric edits (or navigated into a song that has them), force-stop ACR so
  // its LRC-indexed highlight doesn't fire on the wrong rendered lines.
  useEffect(() => {
    if (earlyCustomLyrics && acrSyncRef.current?.active) acrSyncRef.current.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earlyCustomLyrics]);

  // Reconcile sync engines whenever the user changes mode or the song changes.
  // No more auto-engage on song load: the singer opts in once, and the picked
  // mode re-engages on each new song. Mode "off" means stop everything mic-driven.
  const liveSyncRef = useRef(liveSync);
  const tapSyncRef = useRef(tapSync);
  const acrSyncRef = useRef(acrSync);
  const smartRef = useRef(smart);
  useEffect(() => { liveSyncRef.current = liveSync; }, [liveSync]);
  useEffect(() => { tapSyncRef.current = tapSync; }, [tapSync]);
  useEffect(() => { acrSyncRef.current = acrSync; }, [acrSync]);
  useEffect(() => { smartRef.current = smart; }, [smart]);

  useEffect(() => {
    if (!currentSong) return;
    // Always tear down whatever sync was running before flipping modes
    if (autoCueMode !== "follow" && liveSyncRef.current.active) liveSyncRef.current.stop();
    if (autoCueMode !== "tap" && tapSyncRef.current.active) tapSyncRef.current.stop();
    // If the singer just enabled lyric edits while Follow was running, stop it
    // immediately — running it would highlight wrong lines.
    if (autoCueMode === "follow" && earlyCustomLyrics && liveSyncRef.current.active) {
      liveSyncRef.current.stop();
    }

    if (autoCueMode === "follow") {
      // Need synced lyrics to follow against
      if (!lrc.lines || lrc.lines.length === 0) return;
      if (!liveSyncRef.current.supported) return;
      // When the singer has edited the lyrics for this gig, the LRC line
      // indices no longer line up with the rendered text — the highlight would
      // drift onto the wrong lines. Refuse to engage Follow in that case.
      if (earlyCustomLyrics) return;
      // Mutual exclusivity: stop every other mic-using / line-driving engine
      if (acrSyncRef.current.active) acrSyncRef.current.stop();
      if (smartRef.current.active) smartRef.current.stop();
      if (!liveSyncRef.current.active) void liveSyncRef.current.start();
    } else if (autoCueMode === "tap") {
      if (renderedLineCount === 0) return;
      // Tap mode owns the highlighted line; nothing else may drive it
      if (acrSyncRef.current.active) acrSyncRef.current.stop();
      if (smartRef.current.active) smartRef.current.stop();
      if (!tapSyncRef.current.active) tapSyncRef.current.start();
    }
  }, [autoCueMode, currentSong, lrc.lines, renderedLineCount, earlyCustomLyrics]);

  // Auto-cue: when matched line changes, smoothly scroll it to the guide position
  useEffect(() => {
    if (!anyLiveActive || effectiveMatchedIndex < 0) return;
    const el = lineRefs.current[effectiveMatchedIndex];
    if (!el) return;
    const guideY = window.innerHeight * (GUIDE_PERCENT / 100);
    const rect = el.getBoundingClientRect();
    const delta = (rect.top + rect.height / 2) - guideY;
    if (Math.abs(delta) > 4) {
      window.scrollBy({ top: delta, behavior: "smooth" });
    }
  }, [effectiveMatchedIndex, anyLiveActive]);

  // Tap mode keyboard shortcut: Space = next line, Shift+Space = previous.
  // Ignored when typing into inputs / selects so it doesn't fight the search bar.
  useEffect(() => {
    if (!tapSync.active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) tapSync.prev();
      else tapSync.next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tapSync]);

  // Track which line is at the guide position
  const updateActiveLine = useCallback(() => {
    const guideY = window.innerHeight * (GUIDE_PERCENT / 100);
    let closest = -1;
    let closestDist = Infinity;
    lineRefs.current.forEach((el, i) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const dist = Math.abs(center - guideY);
      if (dist < closestDist) { closestDist = dist; closest = i; }
    });
    setActiveLine(closest);
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", updateActiveLine, { passive: true });
    updateActiveLine();
    return () => window.removeEventListener("scroll", updateActiveLine);
  }, [updateActiveLine]);

  // Track viewport size for fit-mode calculation
  useEffect(() => {
    const update = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Auto-fit font size to fill the visible viewport
  const fitFontSize = useMemo(() => {
    if (!fitMode || !currentSong?.lyrics) return null;
    const lineCount = currentSong.lyrics.split("\n").length;
    if (lineCount === 0 || viewportSize.h === 0) return null;
    // Reserve space for header, title block, and bottom padding
    const reserved = 64 + 140 + 40;
    const available = Math.max(viewportSize.h - reserved, 200);
    // Show up to ~22 lines comfortably; longer songs scroll
    const linesToFit = Math.min(lineCount, 22);
    const lineHeight = 1.8;
    const px = available / (linesToFit * lineHeight);
    return Math.max(18, Math.min(96, Math.round(px)));
  }, [fitMode, currentSong, viewportSize]);

  const effectiveFontSize = fitFontSize ?? zoom;

  const slowDown = () => {
    userTouchedSpeedRef.current = true;
    setScrollSpeed(s => Math.max(MIN_SPEED, s - SPEED_STEP));
  };
  const speedUp = () => {
    userTouchedSpeedRef.current = true;
    setScrollSpeed(s => Math.min(MAX_SPEED, s + SPEED_STEP));
  };

  // Reset the "user-touched" flag whenever a new song loads, so the next song
  // gets its own LRC-derived baseline.
  useEffect(() => {
    userTouchedSpeedRef.current = false;
  }, [currentSong?.title, currentSong?.artist]);

  // LRC-derived baseline auto-scroll speed.
  // When timed lyrics are available, set the scroll rate so the page would scroll
  // through in roughly the song's actual duration. Recomputed once per song (and
  // when the viewport changes), only if the user hasn't touched the speed dial.
  useEffect(() => {
    if (userTouchedSpeedRef.current) return;
    const lines = lrc.lines;
    if (!lines || lines.length < 2) return;
    const songDurationSec = lines[lines.length - 1].timeMs / 1000;
    if (songDurationSec < 30) return; // sanity guard — partial/bad LRC
    // Wait one frame so layout is settled and scrollHeight reflects rendered lyrics
    const id = window.setTimeout(() => {
      if (userTouchedSpeedRef.current) return;
      const scrollable = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      if (scrollable <= 0) return;
      const target = scrollable / songDurationSec;
      const clamped = Math.max(MIN_SPEED, Math.min(MAX_SPEED, target));
      setScrollSpeed(Math.round(clamped));
    }, 50);
    return () => window.clearTimeout(id);
  }, [lrc.lines, viewportSize.h, effectiveFontSize]);
  const speedLabel = Math.round((scrollSpeed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED) * 9) + 1;

  if (!currentSong) return null;

  const isFav  = isFavorite(currentSong.artist, currentSong.title);

  // Per-setlist "stage version" override — only loaded when this view was opened
  // from inside a setlist (setlistCtx). Outside the setlist, the song stays clean.
  const stageOverride = setlistCtx
    ? overridesApi.getOverride(setlistCtx.setlist.id, currentSong.artist, currentSong.title)
    : null;
  const hasCustomLyrics = !!stageOverride?.customLyrics?.trim();

  // Effective performance metadata: setlist-version overrides global "My version".
  // Notes are NOT merged — if a stage note exists it fully replaces the global note,
  // because mixing them on stage would be confusing.
  const effectiveCapo  = stageOverride?.capo  ?? songNotes?.capo  ?? null;
  const effectiveTempo = stageOverride?.tempo ?? songNotes?.tempo ?? null;
  const effectiveNotes = stageOverride?.notes ?? songNotes?.notes ?? null;

  // Lyric source precedence:
  //   1. Custom stage lyrics (singer-edited, plain text only — no LRC sync)
  //   2. LRC-synced lines from the API (enables Auto-cue Follow)
  //   3. Plain fetched lyrics
  const lines = hasCustomLyrics
    ? stageOverride!.customLyrics!.split("\n")
    : lrc.lines && lrc.lines.length > 0
      ? lrc.lines.map(l => l.text)
      : currentSong.lyrics ? currentSong.lyrics.split("\n") : null;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border/40 bg-background/90 backdrop-blur-md">
        <div className="max-w-4xl mx-auto w-full px-4 h-16 flex items-center justify-between gap-2">

          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setIsScrolling(false); setLocation(setlistCtx ? "/setlists" : "/"); }}
            className="text-muted-foreground hover:text-foreground -ml-2 shrink-0"
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back
          </Button>

          {/* Performance controls — only the bits you actually touch mid-song */}
          <div className="flex items-center gap-1">

            {/* Setlist Prev / Next (only when in a setlist) */}
            {setlistCtx && (
              <>
                <button
                  data-testid="button-setlist-prev"
                  onClick={() => navigateSetlist(-1)}
                  disabled={setlistCtx.index === 0 || setlistNavLoading}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent disabled:opacity-30"
                  title="Previous song in setlist"
                  aria-label="Previous song"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  data-testid="button-setlist-next"
                  onClick={() => navigateSetlist(1)}
                  disabled={setlistCtx.index >= setlistCtx.setlist.songs.length - 1 || setlistNavLoading}
                  className="bg-primary text-primary-foreground hover:opacity-90 transition-opacity px-2.5 py-1.5 rounded-md disabled:opacity-30 text-sm font-medium flex items-center gap-1"
                  title="Next song in setlist"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
                <div className="w-px h-5 bg-border mx-1" />
              </>
            )}

            {/* Scroll speed */}
            <button
              data-testid="button-scroll-slower"
              onClick={slowDown}
              disabled={scrollSpeed <= MIN_SPEED}
              className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent disabled:opacity-30"
              title="Scroll slower"
            >
              <ChevronsDown className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-muted-foreground w-5 text-center tabular-nums" title="Scroll speed">
              {speedLabel}
            </span>
            <button
              data-testid="button-scroll-faster"
              onClick={speedUp}
              disabled={scrollSpeed >= MAX_SPEED}
              className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent disabled:opacity-30"
              title="Scroll faster"
            >
              <ChevronsUp className="w-4 h-4" />
            </button>

            {/* Play / Pause */}
            <button
              data-testid="button-scroll-toggle"
              onClick={() => setIsScrolling(s => !s)}
              className={`p-1.5 rounded-md transition-colors ml-1 ${
                isScrolling
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
              title={isScrolling ? "Pause scroll" : "Start auto-scroll"}
            >
              {isScrolling ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>

            {/* Favourite */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => toggleFavorite(currentSong.artist, currentSong.title)}
              className="transition-colors text-muted-foreground hover:text-foreground"
              title={isFav ? "Remove from favorites" : "Add to favorites"}
            >
              {isFav
                ? <Heart className="w-5 h-5 fill-secondary text-secondary" />
                : <Heart className="w-5 h-5" />
              }
            </Button>

            {/* Settings overflow — text size, font, modes, language, theme */}
            <div className="relative" ref={settingsRef}>
              <button
                data-testid="button-settings"
                onClick={() => { setSettingsOpen(o => !o); setFontSubOpen(false); }}
                className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent"
                title="Settings"
                aria-label="Settings"
                aria-expanded={settingsOpen}
              >
                <MoreVertical className="w-5 h-5" />
              </button>

              {settingsOpen && (
                <div
                  data-testid="settings-menu"
                  className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-border bg-popover shadow-lg z-30 py-1 max-h-[80vh] overflow-y-auto"
                >
                  {/* Text size */}
                  <div className="px-3 py-2 flex items-center justify-between">
                    <span className="text-sm text-foreground">Text size</span>
                    <div className="flex items-center gap-1">
                      <button
                        data-testid="button-zoom-out"
                        onClick={zoomOut}
                        disabled={zoom <= minZoom}
                        className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent disabled:opacity-30"
                        aria-label="Smaller text"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="text-sm font-medium text-muted-foreground w-7 text-center tabular-nums">{zoom}</span>
                      <button
                        data-testid="button-zoom-in"
                        onClick={zoomIn}
                        disabled={zoom >= maxZoom}
                        className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent disabled:opacity-30"
                        aria-label="Larger text"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Font */}
                  <button
                    data-testid="button-cycle-font"
                    onClick={() => setFontSubOpen(o => !o)}
                    className="w-full px-3 py-2 flex items-center justify-between hover:bg-accent transition-colors"
                  >
                    <span className="text-sm text-foreground">Font</span>
                    <span className="flex items-center gap-1 text-sm text-muted-foreground" style={{ fontFamily: font.family }}>
                      {font.label}
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${fontSubOpen ? "rotate-180" : ""}`} />
                    </span>
                  </button>
                  {fontSubOpen && (
                    <div className="border-y border-border/40 bg-muted/30">
                      {FONT_OPTIONS.map((opt, i) => (
                        <button
                          key={opt.value}
                          onClick={() => { setFontIndex(i); setFontSubOpen(false); }}
                          className={`w-full text-left px-6 py-2 text-sm transition-colors hover:bg-accent flex items-center justify-between ${
                            fontIndex === i ? "text-primary font-semibold" : "text-foreground"
                          }`}
                          style={{ fontFamily: opt.family }}
                        >
                          <span>{opt.label}</span>
                          {fontIndex === i && <Check className="w-4 h-4" />}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Fit to screen */}
                  <button
                    data-testid="button-fit-screen"
                    onClick={() => setFitMode(f => !f)}
                    className="w-full px-3 py-2 flex items-center justify-between hover:bg-accent transition-colors"
                  >
                    <span className="text-sm text-foreground flex items-center gap-2">
                      {fitMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                      Fit to screen
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${fitMode ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}>
                      {fitMode ? "On" : "Off"}
                    </span>
                  </button>

                  {/* Smart Scroll */}
                  <button
                    data-testid="button-smart-scroll"
                    onClick={toggleSmart}
                    className="w-full px-3 py-2 flex items-center justify-between hover:bg-accent transition-colors"
                  >
                    <span className="text-sm text-foreground flex items-center gap-2">
                      <AudioLines className={`w-4 h-4 ${smart.active && smart.vocalActive ? "animate-pulse" : ""}`} />
                      Smart Scroll
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      smart.active
                        ? smart.vocalActive
                          ? "bg-primary/15 text-primary"
                          : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground"
                    }`}>
                      {smart.active ? (smart.vocalActive ? "Listening" : "Quiet") : "Off"}
                    </span>
                  </button>

                  {/* ACR Sync — hidden when stage lyrics are edited, since the
                      ACR timeline maps to original LRC indices that no longer
                      line up with the rendered text. */}
                  {engineConfig.acrcloudEnabled && lrc.lines && lrc.lines.length > 0 && !earlyCustomLyrics && (
                    <button
                      data-testid="button-acr-sync"
                      onClick={toggleAcrSync}
                      className="w-full px-3 py-2 flex items-center justify-between hover:bg-accent transition-colors"
                    >
                      <span className="text-sm text-foreground flex items-center gap-2">
                        <Crosshair className={`w-4 h-4 ${acrSync.active ? "animate-pulse" : ""}`} strokeWidth={2.5} />
                        ACR Sync
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${acrSync.active ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}>
                        {acrSync.active ? "On" : "Off"}
                      </span>
                    </button>
                  )}

                  {/* Auto-cue mode picker — Off / Follow (mic) / Tap (manual).
                      Always available, even without LRC: Tap mode works on plain lyrics too. */}
                  {renderedLineCount > 0 && (
                    <>
                      <div className="px-3 py-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-foreground flex items-center gap-2">
                            <Crosshair className="w-4 h-4" />
                            Auto-cue
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/40 p-1">
                          <button
                            data-testid="autocue-mode-off"
                            onClick={() => setAutoCueMode("off")}
                            className={`text-xs py-1.5 rounded-md transition-colors ${
                              autoCueMode === "off"
                                ? "bg-background text-foreground font-medium shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Off
                          </button>
                          <button
                            data-testid="autocue-mode-follow"
                            onClick={() => setAutoCueMode("follow")}
                            disabled={!liveSync.supported || !lrc.lines || lrc.lines.length === 0 || !!earlyCustomLyrics}
                            title={
                              !liveSync.supported
                                ? "Speech recognition not supported in this browser"
                                : !lrc.lines || lrc.lines.length === 0
                                  ? "Follow needs synced (timed) lyrics"
                                  : earlyCustomLyrics
                                    ? "Follow can't be used on edited stage lyrics — use Tap mode"
                                    : "Listen to the singer and follow along"
                            }
                            className={`text-xs py-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                              autoCueMode === "follow"
                                ? "bg-background text-foreground font-medium shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Follow
                          </button>
                          <button
                            data-testid="autocue-mode-tap"
                            onClick={() => setAutoCueMode("tap")}
                            className={`text-xs py-1.5 rounded-md transition-colors ${
                              autoCueMode === "tap"
                                ? "bg-background text-foreground font-medium shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Tap
                          </button>
                        </div>
                        <p className="text-[11px] text-muted-foreground/70 mt-2 leading-snug">
                          {autoCueMode === "follow"
                            ? "Mic listens to the singer and keeps time with the band — holds through gaps, picks up when vocals return. Tap a line to correct it."
                            : autoCueMode === "tap"
                              ? "Tap the button (or press Space) to advance lines. Most reliable live."
                              : "Pick Follow (mic) or Tap (manual) to highlight the current line."}
                        </p>
                      </div>
                    </>
                  )}

                  {/* Language */}
                  {liveSync.supported && lrc.lines && lrc.lines.length > 0 && (
                    <div className="relative" ref={langMenuRef}>
                      <button
                        data-testid="button-language"
                        onClick={() => setLangMenuOpen(o => !o)}
                        className="w-full px-3 py-2 flex items-center justify-between hover:bg-accent transition-colors"
                      >
                        <span className="text-sm text-foreground flex items-center gap-2">
                          <Languages className="w-4 h-4" />
                          Language
                        </span>
                        <span className="flex items-center gap-1 text-sm text-muted-foreground">
                          {langPref === "auto" ? `Auto (${languageLabel(detectedLang)})` : languageLabel(langPref)}
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${langMenuOpen ? "rotate-180" : ""}`} />
                        </span>
                      </button>
                      {langMenuOpen && (
                        <div className="border-y border-border/40 bg-muted/30 max-h-64 overflow-y-auto">
                          {LANGUAGE_OPTIONS.map(opt => (
                            <button
                              key={opt.code}
                              data-testid={`language-option-${opt.code}`}
                              onClick={() => { setLang(opt.code); setLangMenuOpen(false); }}
                              className={`w-full text-left px-6 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between ${
                                langPref === opt.code ? "text-primary font-medium" : "text-foreground"
                              }`}
                            >
                              <span>{opt.label}</span>
                              {opt.code === "auto" && (
                                <span className="text-xs text-muted-foreground">{languageLabel(detectedLang)}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="h-px bg-border/40 my-1" />

                  {/* Stage version — only when in setlist mode. Per-gig customisation
                      that includes editable lyrics. Listed above "My version" because
                      when you're in a setlist this is what you usually want. */}
                  {setlistCtx && (
                    <button
                      data-testid="menu-stage-version"
                      onClick={() => { setSettingsOpen(false); setStageEditorOpen(true); }}
                      className="w-full px-3 py-2 flex items-center justify-between hover:bg-accent transition-colors"
                    >
                      <span className="text-sm text-foreground flex items-center gap-2">
                        <Wand2 className="w-4 h-4 text-primary" />
                        Stage version
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">this gig</span>
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${stageOverride ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}>
                        {hasCustomLyrics ? "Edited" : stageOverride ? "Saved" : "Add"}
                      </span>
                    </button>
                  )}

                  {/* My version — capo, tempo, performance notes */}
                  <button
                    data-testid="menu-my-version"
                    onClick={() => { setSettingsOpen(false); setNotesEditorOpen(true); }}
                    className="w-full px-3 py-2 flex items-center justify-between hover:bg-accent transition-colors"
                  >
                    <span className="text-sm text-foreground flex items-center gap-2">
                      <NotebookPen className="w-4 h-4" />
                      My version
                      {setlistCtx && <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">global</span>}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${songNotes ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}>
                      {songNotes ? "Saved" : "Add"}
                    </span>
                  </button>

                  {/* Add to setlist */}
                  <button
                    data-testid="button-add-to-setlist"
                    onClick={() => setAddToSetlistOpen(o => !o)}
                    className="w-full px-3 py-2 flex items-center justify-between hover:bg-accent transition-colors"
                  >
                    <span className="text-sm text-foreground flex items-center gap-2">
                      <ListMusic className="w-4 h-4" />
                      Add to setlist
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${addToSetlistOpen ? "rotate-180" : ""}`} />
                  </button>
                  {addToSetlistOpen && (
                    <div className="border-y border-border/40 bg-muted/30 max-h-64 overflow-y-auto">
                      {setlistsApi.setlists.length === 0 ? (
                        <div className="px-6 py-3 text-sm text-muted-foreground">
                          No setlists yet.
                          <button
                            className="ml-2 text-primary underline"
                            onClick={() => { setSettingsOpen(false); setLocation("/setlists"); }}
                          >
                            Create one
                          </button>
                        </div>
                      ) : (
                        <>
                          {setlistsApi.setlists.map(sl => {
                            const already = sl.songs.some(
                              s => s.artist.toLowerCase().trim() === currentSong.artist.toLowerCase().trim()
                                && s.title.toLowerCase().trim() === currentSong.title.toLowerCase().trim(),
                            );
                            return (
                              <button
                                key={sl.id}
                                data-testid={`add-to-setlist-${sl.id}`}
                                disabled={already}
                                onClick={() => {
                                  setlistsApi.addSong(sl.id, { artist: currentSong.artist, title: currentSong.title });
                                  setAddToSetlistOpen(false);
                                  setSettingsOpen(false);
                                }}
                                className="w-full text-left px-6 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <span className="truncate text-foreground">{sl.name}</span>
                                {already
                                  ? <Check className="w-4 h-4 text-primary shrink-0 ml-2" />
                                  : <Plus className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
                                }
                              </button>
                            );
                          })}
                          <button
                            className="w-full text-left px-6 py-2 text-sm hover:bg-accent transition-colors text-primary border-t border-border/40"
                            onClick={() => { setSettingsOpen(false); setLocation("/setlists"); }}
                          >
                            Manage setlists…
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  <div className="h-px bg-border/40 my-1" />

                  {/* Theme */}
                  <button
                    data-testid="button-theme-toggle"
                    onClick={toggleTheme}
                    className="w-full px-3 py-2 flex items-center justify-between hover:bg-accent transition-colors"
                  >
                    <span className="text-sm text-foreground flex items-center gap-2">
                      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                      {theme === "dark" ? "Light mode" : "Dark mode"}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Smart scroll / Live Sync / ACR Sync error banner */}
      {(smart.error || liveSync.error || acrSync.error) && (
        <div className="bg-destructive/10 border-b border-destructive/20 text-destructive text-xs px-4 py-2 text-center">
          {smart.error || liveSync.error || acrSync.error}
        </div>
      )}

      {/* Live Sync (Follow mode — speech recognition) active banner */}
      {liveSync.active && (
        <div className="bg-primary/10 border-b border-primary/20 text-primary text-xs px-4 py-2 text-center">
          <div className="flex items-center justify-center gap-2">
            <Crosshair className="w-3 h-3 animate-pulse" />
            <span data-testid="text-follow-status">
              Auto-cue: Follow ({effectiveLang}) —{" "}
              {liveSync.cueState === "listening"
                ? "listening for vocals…"
                : liveSync.cueState === "following"
                  ? "following the singer"
                  : liveSync.cueState === "coasting"
                    ? "keeping time with the band"
                    : liveSync.cueState === "instrumental"
                      ? "instrumental — waiting for vocals"
                      : "waiting for the singer"}
              {liveSync.matchedIndex >= 0 && Math.abs(liveSync.rate - 1) >= 0.03 && (
                <> · band {liveSync.rate < 1 ? "slower" : "faster"} than record ({Math.round(liveSync.rate * 100)}%)</>
              )}
              {liveSync.matchedIndex >= 0 && " · tap a line to correct"}
            </span>
          </div>
          {liveSync.lastHeard && (
            <div className="mt-1 text-[11px] text-primary/70 italic truncate max-w-2xl mx-auto" data-testid="text-last-heard">
              Heard: "{liveSync.lastHeard}"
            </div>
          )}
        </div>
      )}

      {/* Tap Sync active banner */}
      {tapSync.active && (
        <div className="bg-primary/10 border-b border-primary/20 text-primary text-xs px-4 py-2 text-center flex items-center justify-center gap-2">
          <MousePointerClick className="w-3 h-3" />
          <span>
            Auto-cue: Tap — {tapSync.matchedIndex >= 0 ? `line ${tapSync.matchedIndex + 1}` : "tap the button (or Space) to start"}
            {" · "}tap a lyric to jump to it
          </span>
        </div>
      )}

      {/* ACR Sync (audio fingerprint) active banner */}
      {acrSync.active && (
        <div className="bg-primary/10 border-b border-primary/20 text-primary text-xs px-4 py-2 text-center flex items-center justify-center gap-2">
          <Crosshair className="w-3 h-3 animate-pulse" />
          <span>
            ACR Sync on — {acrSync.status === "locked" ? "locked to song timeline" : "listening to identify the song…"}
          </span>
        </div>
      )}

      {/* Reading guide */}
      {isScrolling && (
        <div
          className="fixed left-0 right-0 z-10 pointer-events-none"
          style={{ top: `${GUIDE_PERCENT}%` }}
          aria-hidden
        >
          <div className="h-px w-full bg-primary/25" />
          <div className="w-full bg-primary/8" style={{ height: `calc(${zoom}px * 1.8)` }} />
          <div className="h-px w-full bg-primary/25" />
        </div>
      )}

      {/* Lyrics */}
      <main className={`flex-1 w-full mx-auto flex flex-col ${
        fitMode
          ? "max-w-none px-3 sm:px-6 py-4 sm:py-6"
          : "max-w-3xl px-6 py-12 sm:py-16"
      }`}>
        <div className={fitMode ? "mb-4 text-center sm:text-left" : "mb-12 text-center sm:text-left"}>
          <h1
            className={`font-bold text-foreground leading-tight ${
              fitMode
                ? "text-xl sm:text-2xl mb-1"
                : "text-4xl sm:text-5xl md:text-6xl mb-4"
            }`}
            style={{ fontFamily: font.family }}
          >
            {currentSong.title}
          </h1>
          <p
            className={`text-muted-foreground italic ${fitMode ? "text-sm sm:text-base" : "text-xl sm:text-2xl"}`}
            style={{ fontFamily: font.family }}
          >
            {currentSong.artist}
          </p>

          {/* My-version chips: key, capo, tempo. These are the singer's personal performance metadata.
              Always show key (it's the most-used field); show capo/tempo as chips only if set.
              In setlist mode the key picker is "stage-aware": writes go to the per-gig stage
              override so the global song key is left untouched (per the user's "don't spread
              everywhere" directive). */}
          <div className={`flex items-center gap-2 flex-wrap justify-center sm:justify-start ${fitMode ? "mt-2" : "mt-4"}`}>
            <label className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
              setlistCtx && stageOverride?.key
                ? "border-primary/40 bg-primary/10"
                : "border-border/60 bg-muted/30"
            }`}>
              <span className="text-muted-foreground">Key</span>
              <select
                aria-label="Song key"
                data-testid="song-key-select"
                value={(stageOverride?.key ?? songKey.key) ?? ""}
                onChange={(e) => {
                  const next = e.target.value || null;
                  if (setlistCtx) {
                    // In setlist mode, key changes are scoped to this gig.
                    overridesApi.setOverride(setlistCtx.setlist.id, currentSong.artist, currentSong.title, { key: next ?? "" });
                  } else {
                    songKey.setKey(next);
                  }
                }}
                className="bg-transparent font-semibold text-foreground focus:outline-none cursor-pointer"
                title={setlistCtx
                  ? `Key for this gig only ("${setlistCtx.setlist.name}"). Doesn't change the song's global key.`
                  : "Song key"}
              >
                <option value="">—</option>
                {KEY_OPTIONS.map(k => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
            {effectiveCapo && (
              <button
                data-testid="chip-capo"
                onClick={() => (stageOverride?.capo ? setStageEditorOpen(true) : setNotesEditorOpen(true))}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
                  stageOverride?.capo
                    ? "border-primary/40 bg-primary/10 hover:bg-primary/15"
                    : "border-border/60 bg-muted/30 hover:bg-accent"
                }`}
                title={stageOverride?.capo ? "Edit stage version" : "Edit my version"}
              >
                <span className="text-muted-foreground">Capo</span>
                <span className="font-semibold text-foreground">{effectiveCapo}</span>
              </button>
            )}
            {effectiveTempo && (
              <button
                data-testid="chip-tempo"
                onClick={() => (stageOverride?.tempo ? setStageEditorOpen(true) : setNotesEditorOpen(true))}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors max-w-[260px] ${
                  stageOverride?.tempo
                    ? "border-primary/40 bg-primary/10 hover:bg-primary/15"
                    : "border-border/60 bg-muted/30 hover:bg-accent"
                }`}
                title={stageOverride?.tempo ? "Edit stage version" : "Edit my version"}
              >
                <span className="text-muted-foreground shrink-0">Tempo</span>
                <span className="font-semibold text-foreground truncate">{effectiveTempo}</span>
              </button>
            )}
            {/* Stage-version pill — visible only inside a setlist. Dual-purpose:
                opens the full editor (lyrics + per-gig overrides) and shows status. */}
            {setlistCtx && (
              <button
                data-testid="button-stage-version"
                onClick={() => setStageEditorOpen(true)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
                  stageOverride
                    ? "border-primary/50 bg-primary/15 text-foreground hover:bg-primary/20"
                    : "border-dashed border-primary/40 text-primary/90 hover:bg-primary/5"
                }`}
                title={stageOverride
                  ? `Edit your stage version of this song for "${setlistCtx.setlist.name}"`
                  : `Make a stage version of this song for "${setlistCtx.setlist.name}" — edit the lyrics, key, capo, tempo and notes for this gig only`}
              >
                <Wand2 className="w-3.5 h-3.5" />
                {hasCustomLyrics
                  ? "Stage version (edited)"
                  : stageOverride
                    ? "Stage version"
                    : "Make stage version"}
              </button>
            )}
            <button
              data-testid="button-edit-my-version"
              onClick={() => setNotesEditorOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border/60 px-3 py-1 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title={setlistCtx
                ? "Global capo, tempo and notes (apply everywhere — for this gig only, use Stage version)"
                : "Add capo, tempo, and performance notes"}
            >
              <NotebookPen className="w-3.5 h-3.5" />
              {songNotesApi.hasNotes(currentSong.artist, currentSong.title) ? "Edit my version" : "Add my version"}
            </button>
          </div>

          {/* Performance notes panel — collapsible, shown above the lyrics so the singer
              sees their own cues before each section. We default to open because that's
              the whole point of having notes. */}
          {effectiveNotes && (
            <div className={`mt-4 rounded-xl border bg-primary/5 ${stageOverride?.notes ? "border-primary/40" : "border-primary/20"} ${fitMode ? "" : "max-w-2xl mx-auto sm:mx-0"}`} data-testid="panel-performance-notes">
              <button
                onClick={() => setNotesPanelOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 px-4 py-2 text-left"
                aria-expanded={notesPanelOpen}
                data-testid="button-toggle-notes-panel"
              >
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
                  {stageOverride?.notes ? <Wand2 className="w-3.5 h-3.5" /> : <NotebookPen className="w-3.5 h-3.5" />}
                  {stageOverride?.notes ? `Notes for this gig — ${setlistCtx?.setlist.name ?? "this setlist"}` : "My notes"}
                </span>
                <ChevronDown className={`w-4 h-4 text-primary/70 transition-transform ${notesPanelOpen ? "rotate-180" : ""}`} />
              </button>
              {notesPanelOpen && (
                <div className="px-4 pb-3 -mt-1">
                  <pre
                    className="whitespace-pre-wrap font-sans text-sm sm:text-base text-foreground/90 leading-relaxed"
                    style={{ fontFamily: font.family }}
                    data-testid="text-performance-notes"
                  >
                    {effectiveNotes}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={fitMode ? "pb-12" : "pb-48"}>
          {lines ? (
            <div
              data-testid="lyrics-text"
              style={{ fontSize: `${effectiveFontSize}px`, lineHeight: 1.8, fontFamily: font.family }}
              className="transition-[font-size] duration-200"
            >
              {lines.map((line, i) => {
                const isMatched = anyLiveActive && effectiveMatchedIndex === i;
                const isCurrent = isMatched || (isScrolling && activeLine === i);
                // In tap mode, clicking a line jumps the highlight there.
                // Empty lines remain non-interactive so we don't mis-trigger on stanza gaps.
                const tapJumpable = (tapSync.active || liveSync.active) && line.trim().length > 0;
                return (
                  <span
                    key={i}
                    ref={el => { lineRefs.current[i] = el; }}
                    onClick={tapJumpable ? () => (tapSync.active ? tapSync.setIndex(i) : liveSync.jumpTo(i)) : undefined}
                    onKeyDown={tapJumpable ? (event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      if (tapSync.active) tapSync.setIndex(i);
                      else liveSync.jumpTo(i);
                    } : undefined}
                    role={tapJumpable ? "button" : undefined}
                    tabIndex={tapJumpable ? 0 : undefined}
                    data-testid={tapJumpable ? `tap-line-${i}` : undefined}
                    className={`block transition-colors duration-150 ${
                      isCurrent ? "text-primary font-semibold" : "text-foreground/85"
                    } ${tapJumpable ? "cursor-pointer hover:bg-primary/5 rounded-md px-1 -mx-1" : ""}`}
                    style={{ minHeight: "1em" }}
                  >
                    {line || "\u00A0"}
                  </span>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-20 space-y-4" data-testid="lyrics-unavailable">
              <p className="text-2xl text-muted-foreground italic" style={{ fontFamily: font.family }}>
                Lyrics not available for this track.
              </p>
              <p className="text-sm text-muted-foreground">Try searching for a different version or spelling.</p>
              <button
                onClick={() => setLocation("/")}
                className="mt-4 text-primary underline underline-offset-4 text-sm hover:opacity-70 transition-opacity"
              >
                Back to search
              </button>
            </div>
          )}
        </div>
      </main>

      {/* My-version editor (global, applies everywhere) */}
      {currentSong && (
        <SongNotesEditor
          artist={currentSong.artist}
          title={currentSong.title}
          open={notesEditorOpen}
          onClose={() => setNotesEditorOpen(false)}
        />
      )}

      {/* Stage-version editor — only mounts when we're inside a setlist. */}
      {currentSong && setlistCtx && (
        <StageVersionEditor
          setlistId={setlistCtx.setlist.id}
          setlistName={setlistCtx.setlist.name}
          artist={currentSong.artist}
          title={currentSong.title}
          originalLyrics={currentSong.lyrics ?? null}
          open={stageEditorOpen}
          onClose={() => setStageEditorOpen(false)}
        />
      )}

      {/* Tap-mode floating advance bar — fixed at bottom for thumb reach on stage */}
      {tapSync.active && (
        <div
          className="fixed bottom-0 left-0 right-0 z-30 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 bg-gradient-to-t from-background via-background/95 to-transparent"
          data-testid="tap-controls"
        >
          <div className="max-w-3xl mx-auto flex items-center gap-2">
            <button
              data-testid="button-tap-prev"
              onClick={tapSync.prev}
              disabled={tapSync.matchedIndex <= 0}
              className="h-14 px-4 rounded-xl bg-card border border-border text-foreground hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
              aria-label="Previous line"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              data-testid="button-tap-next"
              onClick={tapSync.next}
              className="flex-1 h-14 rounded-xl bg-primary text-primary-foreground font-semibold text-base hover:opacity-90 active:opacity-80 transition-opacity flex items-center justify-center gap-2 shadow-lg"
            >
              <SkipForward className="w-5 h-5" />
              Next line
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
