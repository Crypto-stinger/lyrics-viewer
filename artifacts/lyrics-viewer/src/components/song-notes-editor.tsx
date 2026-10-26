import { useCallback, useEffect, useRef, useState } from "react";
import { X, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSongNotes } from "@/hooks/use-song-notes";

interface SongNotesEditorProps {
  artist: string;
  title: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Modal for editing the singer's personal "my version" of a song:
 * capo, tempo cues, and free-form notes (structure tweaks, repeats, harmonies, …).
 *
 * Saves on every keystroke via the SongNotes context (debouncing isn't worth the
 * complexity at this scale — localStorage writes are cheap and we want zero risk
 * of losing a singer's note if the tab closes mid-edit).
 */
export function SongNotesEditor({ artist, title, open, onClose }: SongNotesEditorProps) {
  const { getNotes, setNotes } = useSongNotes();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Local draft — typing only mutates LOCAL state so we never re-render the
  // whole app tree on every keystroke. Persist is debounced (250ms idle) and
  // always flushed on close / unmount, so nothing is ever lost.
  const saved = getNotes(artist, title);
  const [capo, setCapo] = useState(saved?.capo ?? "");
  const [tempo, setTempo] = useState(saved?.tempo ?? "");
  const [notes, setNotesField] = useState(saved?.notes ?? "");

  // Refs let the debounced flusher always read the freshest values without
  // needing to be re-created on every keystroke.
  const capoRef = useRef(capo); capoRef.current = capo;
  const tempoRef = useRef(tempo); tempoRef.current = tempo;
  const notesRef = useRef(notes); notesRef.current = notes;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setNotesRef = useRef(setNotes); setNotesRef.current = setNotes;

  const flush = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    setNotesRef.current(artist, title, {
      capo: capoRef.current,
      tempo: tempoRef.current,
      notes: notesRef.current,
    });
  }, [artist, title]);

  const scheduleFlush = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(flush, 250);
  }, [flush]);

  // Re-seed local state whenever we open for a different song (or re-open).
  // We deliberately do NOT depend on `saved` here — it changes when context
  // updates, which would otherwise stomp on the user's in-flight edits.
  useEffect(() => {
    if (!open) return;
    const fresh = getNotes(artist, title);
    setCapo(fresh?.capo ?? "");
    setTempo(fresh?.tempo ?? "");
    setNotesField(fresh?.notes ?? "");
    // Focus first field for fast entry on a phone
    requestAnimationFrame(() => firstFieldRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, artist, title]);

  // Always flush on unmount so a closed-mid-edit draft is never lost.
  useEffect(() => () => flush(), [flush]);

  // Esc closes; click outside closes. Both flush before closing.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { flush(); onClose(); } };
    const onClick = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        flush();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    // Defer the click listener so the click that opened the modal doesn't immediately close it
    const t = setTimeout(() => window.addEventListener("mousedown", onClick), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
      clearTimeout(t);
    };
  }, [open, onClose, flush]);

  if (!open) return null;

  // Typing only updates local state + schedules a debounced persist.
  const onCapoChange = (v: string) => { setCapo(v); scheduleFlush(); };
  const onTempoChange = (v: string) => { setTempo(v); scheduleFlush(); };
  const onNotesChange = (v: string) => { setNotesField(v); scheduleFlush(); };

  const clearAll = () => {
    setCapo(""); setTempo(""); setNotesField("");
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    setNotes(artist, title, { capo: "", tempo: "", notes: "" });
  };

  const handleClose = () => { flush(); onClose(); };

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit my version of this song"
    >
      <div
        ref={dialogRef}
        data-testid="song-notes-editor"
        className="w-full sm:max-w-lg bg-card border border-card-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 sticky top-0 bg-card z-10">
          <div className="flex items-center gap-2 min-w-0">
            <NotebookPen className="w-5 h-5 text-primary shrink-0" />
            <div className="min-w-0">
              <h2 className="font-semibold text-foreground truncate">My version</h2>
              <p className="text-xs text-muted-foreground truncate">{title} — {artist}</p>
            </div>
          </div>
          <button
            data-testid="button-close-notes-editor"
            onClick={handleClose}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Capo</label>
            <Input
              ref={firstFieldRef}
              data-testid="input-capo"
              value={capo}
              onChange={(e) => onCapoChange(e.target.value)}
              placeholder="e.g. Capo 3, no capo"
              maxLength={40}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Tempo / feel</label>
            <Input
              data-testid="input-tempo"
              value={tempo}
              onChange={(e) => onTempoChange(e.target.value)}
              placeholder="e.g. Slower than original, half-time bridge, 120 bpm"
              maxLength={120}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Performance notes
              <span className="ml-2 font-normal text-muted-foreground/70">— structure, repeats, harmonies, cues</span>
            </label>
            <textarea
              data-testid="textarea-performance-notes"
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder={`Examples:\n• Repeat chorus ×2 at the end\n• Skip 2nd verse, jump to bridge\n• Harmonies in on "won't back down"\n• Drop down to acoustic before bridge\n• Boys join on the "oh ohhh" section`}
              rows={8}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[140px] font-mono"
              maxLength={4000}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground/70">
              These notes show above the lyrics on the performance screen. Saves automatically.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border/50 flex items-center justify-between sticky bottom-0 bg-card">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            data-testid="button-clear-notes"
            className="text-muted-foreground hover:text-destructive"
          >
            Clear all
          </Button>
          <Button
            data-testid="button-done-notes"
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
