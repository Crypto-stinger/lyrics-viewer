import { useCallback, useEffect, useRef, useState } from "react";
import { X, Wand2, RotateCcw, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSetlistOverrides } from "@/hooks/use-setlist-overrides";
import { KEY_OPTIONS } from "@/hooks/use-song-key";

interface StageVersionEditorProps {
  setlistId: string;
  setlistName: string;
  artist: string;
  title: string;
  /** The fetched original lyrics — used as the baseline when the user first edits. */
  originalLyrics: string | null;
  open: boolean;
  onClose: () => void;
}

/**
 * The "Stage Version" editor — singer's per-setlist arrangement of a song.
 *
 * Lets the singer:
 *   - Edit the lyric text directly (add/remove/reorder lines, insert "boys" repeats, etc.)
 *   - Override key/capo/tempo for this gig only
 *   - Add per-setlist performance notes
 *
 * Saves are debounced (250ms) and always flushed on close to avoid
 * re-rendering the whole performance screen on every keystroke.
 */
export function StageVersionEditor({
  setlistId,
  setlistName,
  artist,
  title,
  originalLyrics,
  open,
  onClose,
}: StageVersionEditorProps) {
  const { getOverride, setOverride, clearOverride } = useSetlistOverrides();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Local draft so typing is fast.
  const saved = getOverride(setlistId, artist, title);
  const [customLyrics, setCustomLyrics] = useState(saved?.customLyrics ?? "");
  const [capo, setCapo] = useState(saved?.capo ?? "");
  const [tempo, setTempo] = useState(saved?.tempo ?? "");
  const [key, setKey] = useState(saved?.key ?? "");
  const [notes, setNotes] = useState(saved?.notes ?? "");

  const customLyricsRef = useRef(customLyrics); customLyricsRef.current = customLyrics;
  const capoRef = useRef(capo); capoRef.current = capo;
  const tempoRef = useRef(tempo); tempoRef.current = tempo;
  const keyRef = useRef(key); keyRef.current = key;
  const notesRef = useRef(notes); notesRef.current = notes;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setOverrideRef = useRef(setOverride); setOverrideRef.current = setOverride;

  const flush = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    setOverrideRef.current(setlistId, artist, title, {
      customLyrics: customLyricsRef.current,
      capo: capoRef.current,
      tempo: tempoRef.current,
      key: keyRef.current,
      notes: notesRef.current,
    });
  }, [setlistId, artist, title]);

  const scheduleFlush = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(flush, 250);
  }, [flush]);

  // Re-seed from storage whenever the modal opens for a different song / setlist.
  useEffect(() => {
    if (!open) return;
    const fresh = getOverride(setlistId, artist, title);
    setCustomLyrics(fresh?.customLyrics ?? "");
    setCapo(fresh?.capo ?? "");
    setTempo(fresh?.tempo ?? "");
    setKey(fresh?.key ?? "");
    setNotes(fresh?.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, setlistId, artist, title]);

  // Always flush on unmount so a closed-mid-edit draft is never lost.
  useEffect(() => () => flush(), [flush]);

  // Esc / outside-click close, both flushing first.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { flush(); onClose(); } };
    const onClick = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        flush(); onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => window.addEventListener("mousedown", onClick), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
      clearTimeout(t);
    };
  }, [open, onClose, flush]);

  if (!open) return null;

  const handleClose = () => { flush(); onClose(); };

  // Seed the lyrics editor with the fetched original — useful when the singer
  // first taps Edit and faces an empty box. Only used when customLyrics is empty.
  const seedFromOriginal = () => {
    if (!originalLyrics) return;
    setCustomLyrics(originalLyrics);
    scheduleFlush();
  };

  // Revert back to the original song — clears just customLyrics, keeps the
  // singer's notes/capo/tempo/key intact. We confirm because this is destructive
  // for the lyric edits.
  const revertLyrics = () => {
    if (!customLyrics) return;
    if (!confirm("Revert your edited lyrics back to the original? Your performance notes, key, capo and tempo for this gig will stay.")) return;
    setCustomLyrics("");
    setOverride(setlistId, artist, title, { customLyrics: "" });
  };

  const removeStageVersion = () => {
    if (!confirm("Remove this entire stage version? Your edits, notes, key, capo and tempo for this gig will be deleted. This cannot be undone.")) return;
    setCustomLyrics(""); setCapo(""); setTempo(""); setKey(""); setNotes("");
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    clearOverride(setlistId, artist, title);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-stretch sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Stage version editor"
    >
      <div
        ref={dialogRef}
        data-testid="stage-version-editor"
        className="w-full sm:max-w-2xl bg-card border border-card-border rounded-none sm:rounded-2xl shadow-2xl flex flex-col max-h-screen sm:max-h-[92vh]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 bg-card">
          <div className="flex items-center gap-2 min-w-0">
            <Wand2 className="w-5 h-5 text-primary shrink-0" />
            <div className="min-w-0">
              <h2 className="font-semibold text-foreground truncate">Stage version</h2>
              <p className="text-xs text-muted-foreground truncate">
                {title} — {artist} <span className="opacity-60">·</span> {setlistName}
              </p>
            </div>
          </div>
          <button
            data-testid="button-close-stage-editor"
            onClick={handleClose}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* The headline feature: editable lyrics. Big, monospaced, plain text. */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-muted-foreground">
                Lyrics for this gig
                <span className="ml-2 font-normal text-muted-foreground/70">— edit, reorder, add your own bits</span>
              </label>
              <div className="flex items-center gap-1">
                {!customLyrics && originalLyrics && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={seedFromOriginal}
                    data-testid="button-seed-from-original"
                    className="h-7 text-xs"
                  >
                    <Pencil className="w-3 h-3 mr-1" /> Start from original
                  </Button>
                )}
                {customLyrics && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={revertLyrics}
                    data-testid="button-revert-lyrics"
                    className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" /> Revert
                  </Button>
                )}
              </div>
            </div>
            <textarea
              data-testid="textarea-custom-lyrics"
              value={customLyrics}
              onChange={(e) => { setCustomLyrics(e.target.value); scheduleFlush(); }}
              placeholder={originalLyrics
                ? "Tap 'Start from original' above to edit the existing lyrics, or paste/type your own version here."
                : "Paste or type the lyrics for this gig here. One line per line. Empty lines for stanza breaks."}
              rows={14}
              spellCheck={false}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[260px] font-mono leading-relaxed"
              maxLength={20000}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground/70">
              These lyrics replace the original ONLY when this song is opened from <span className="font-medium text-foreground/80">{setlistName}</span>.
              Note: Auto-cue Follow needs the original timed lyrics; on edited songs use Tap mode.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Key (this gig)</label>
              <select
                data-testid="select-stage-key"
                value={key}
                onChange={(e) => { setKey(e.target.value); scheduleFlush(); }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">— use global —</option>
                {KEY_OPTIONS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Capo</label>
              <Input
                data-testid="input-stage-capo"
                value={capo}
                onChange={(e) => { setCapo(e.target.value); scheduleFlush(); }}
                placeholder="e.g. Capo 3"
                maxLength={40}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Tempo / feel</label>
              <Input
                data-testid="input-stage-tempo"
                value={tempo}
                onChange={(e) => { setTempo(e.target.value); scheduleFlush(); }}
                placeholder="e.g. Slower, half-time"
                maxLength={120}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Performance notes (this gig)
              <span className="ml-2 font-normal text-muted-foreground/70">— overrides global notes when set</span>
            </label>
            <textarea
              data-testid="textarea-stage-notes"
              value={notes}
              onChange={(e) => { setNotes(e.target.value); scheduleFlush(); }}
              placeholder={`Examples:\n• Repeat chorus \u00d72 at the end\n• Boys join on the "oh ohhh" section\n• Skip 2nd verse, jump straight to bridge\n• Drop down to acoustic before bridge`}
              rows={5}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[100px] font-mono"
              maxLength={4000}
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border/50 bg-card flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={removeStageVersion}
            data-testid="button-remove-stage-version"
            className="text-muted-foreground hover:text-destructive"
          >
            Remove stage version
          </Button>
          <Button
            data-testid="button-done-stage-editor"
            onClick={handleClose}
            variant="default"
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
