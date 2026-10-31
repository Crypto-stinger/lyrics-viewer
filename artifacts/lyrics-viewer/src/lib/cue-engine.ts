/**
 * Auto-cue engine: keeps the highlighted lyric line in time with a live band.
 *
 * The old Follow mode only moved when the speech recogniser caught enough
 * words, so it froze whenever the room was loud and never knew how fast the
 * band was playing. This engine keeps a running *position* in the song's
 * timed lyrics (LRC time) and a *rate* (band tempo ÷ record tempo):
 *
 *   - Between word matches the position advances at `rate`, so the cue keeps
 *     moving through lines the recogniser missed.
 *   - Every confident word match pins the position to where the singer
 *     actually is and adds an anchor. The slope through recent anchors is the
 *     band's tempo relative to the record (e.g. 0.92 = 8% slower), which the
 *     rate follows smoothly.
 *   - Gaps: when the singer stops, the cue finishes the current line and then
 *     waits. If the record has an instrumental break there, the cue runs
 *     through it but stops just before the next sung line. When vocals come
 *     back, it jumps straight to the next line — so a solo that runs long or a
 *     break that's cut short doesn't throw it off.
 *   - Repeats / skipped verses: a strong match far from the current line moves
 *     the cue there (stricter threshold so common words can't cause jumps).
 *
 * Pure TypeScript with an injected clock, so it can be simulated in tests.
 */
import { alignHeard, heardTokens, prepareLyrics, type PreparedLyrics } from "./lyric-match";

export interface CueLine {
  timeMs: number;
  text: string;
}

export type CueState =
  | "listening" // not locked onto the song yet
  | "following" // recent word match
  | "coasting" // singer audible, recogniser missing words: running at band tempo
  | "instrumental" // record has a break here; running through it
  | "waiting"; // holding for the singer to come back in

export interface CueSnapshot {
  index: number;
  positionMs: number;
  rate: number;
  state: CueState;
}

export interface CueOptions {
  /** Delay between a word being sung and the recogniser reporting it. */
  latencyMs?: number;
  /** No recogniser activity for this long = the singer has stopped. */
  silenceMs?: number;
  /** Max lines to run ahead of the last confirmed line while vocals continue. */
  maxCoastLines?: number;
}

interface Anchor {
  wall: number;
  lrc: number;
}

const HEARD_WINDOW = 9; // most recent words used for matching
const LOCAL_BEFORE = 2;
const LOCAL_AFTER = 6;
const FAR_JUMP_LINES = 8;

export class CueEngine {
  private readonly starts: number[];
  private readonly sungMs: number[]; // estimated sung length of each line
  private readonly gapAfter: boolean[]; // record has an instrumental after line i
  private readonly prep: PreparedLyrics;
  private readonly lineTokCount: number[];
  private readonly latency: number;
  private readonly silenceMs: number;
  private readonly maxCoast: number;

  private pos = 0;
  private rate = 1;
  private lastTick = -1;
  private confirmed = -1;
  private lastConfirmAt = -Infinity;
  private lastVoiceAt = -Infinity;
  private deaf = false;
  private anchors: Anchor[] = [];
  private state: CueState = "listening";
  private lastHeardKey = "";
  private lastChangeAt = -Infinity;

  constructor(lines: CueLine[], opts: CueOptions = {}) {
    this.latency = opts.latencyMs ?? 700;
    this.silenceMs = opts.silenceMs ?? 2200;
    this.maxCoast = opts.maxCoastLines ?? 8;
    this.starts = lines.map((l) => l.timeMs);
    this.prep = prepareLyrics(lines.map((l) => l.text));
    this.lineTokCount = lines.map(() => 0);
    for (const li of this.prep.tokenLine) this.lineTokCount[li] += 1;

    const n = lines.length;
    const spans: number[] = [];
    for (let i = 0; i < n - 1; i++) spans.push(this.starts[i + 1] - this.starts[i]);
    const sorted = spans.filter((d) => d > 0).sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 3500;
    const typical = Math.max(1500, Math.min(6000, median));
    this.sungMs = lines.map((_, i) => {
      const span = i < n - 1 ? spans[i] : typical * 1.5;
      // A line is sung over at most ~1.6× a typical line; the rest is band.
      const byWords = 450 * Math.max(2, this.lineTokCount[i]) + 600;
      return Math.max(800, Math.min(span, Math.max(typical * 1.6, byWords)));
    });
    this.gapAfter = lines.map((_, i) => i < n - 1 && spans[i] - this.sungMs[i] > 3000);
  }

  get lineCount(): number {
    return this.starts.length;
  }

  /** Mark the recogniser as temporarily not listening (e.g. restarting), so
   *  its silence isn't mistaken for the singer stopping. */
  setDeaf(deaf: boolean, now: number): void {
    if (this.deaf && !deaf) this.lastVoiceAt = now; // grace period after restart
    this.deaf = deaf;
  }

  /** Force the cue to a line (e.g. the singer tapped it). */
  jumpTo(index: number, now: number): void {
    if (index < 0 || index >= this.starts.length) return;
    this.advance(now);
    this.pos = this.starts[index];
    this.confirmed = index;
    this.lastConfirmAt = now;
    this.anchors = [];
    this.state = "following";
  }

  /** Feed the recogniser's latest transcript (interim or final). */
  hear(transcript: string, now: number): void {
    this.advance(now);
    const tokens = heardTokens(transcript);
    if (tokens.length === 0) return;

    // Recognisers repeat the same interim text many times a second. A repeat
    // shortly after new words still means "the singer is singing" (a held
    // note), but it is not new evidence of position, and a repeat long after
    // the last new word is just the recogniser idling.
    const key = tokens.slice(-4).join(" ");
    const changed = key !== this.lastHeardKey;
    if (changed) { this.lastHeardKey = key; this.lastChangeAt = now; }
    if (changed || now - this.lastChangeAt < 3000) this.lastVoiceAt = now;
    if (!changed) return;

    // Vocal re-entry: new words while we're holding at the end of a line or
    // in an instrumental break means the singer has come back in. Go to the
    // next line now — the band decides how long a break lasts, not the record.
    if (this.confirmed >= 0 && (this.state === "waiting" || this.state === "instrumental")) {
      const k = this.lineAt(this.pos);
      const next = k + 1;
      if (next < this.starts.length && this.starts[next] - this.pos < 20000 * this.rate) {
        this.pos = this.starts[next] + Math.min(this.latency, 400) * this.rate;
        this.state = "coasting";
        this.anchors = []; // gap length is the band's choice, not tempo
      }
    }

    // Then let the words themselves confirm or correct the position (this also
    // undoes the re-entry jump if the words were really the end of the last line).
    this.match(tokens.slice(-HEARD_WINDOW), now);
  }

  /** Advance the clock and return the current cue. Call ~10×/second. */
  tick(now: number): CueSnapshot {
    this.advance(now);
    return {
      index: this.confirmed < 0 ? -1 : this.lineAt(this.pos),
      positionMs: this.pos,
      rate: this.rate,
      state: this.state,
    };
  }

  // ---------------------------------------------------------------------------

  private lineAt(ms: number): number {
    const s = this.starts;
    let lo = 0;
    let hi = s.length - 1;
    if (ms < s[0]) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid] <= ms) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private advance(now: number): void {
    if (this.lastTick < 0) { this.lastTick = now; return; }
    const dt = Math.max(0, Math.min(1000, now - this.lastTick));
    this.lastTick = now;
    if (this.confirmed < 0) { this.state = "listening"; return; }

    const silent = !this.deaf && now - this.lastVoiceAt > this.silenceMs;
    const k = this.lineAt(this.pos);
    const lineEnd = this.starts[k] + this.sungMs[k];
    const nextStart = k + 1 < this.starts.length ? this.starts[k + 1] : this.starts[k] + this.sungMs[k];
    let target = this.pos + this.rate * dt;

    if (this.pos >= lineEnd && this.gapAfter[k]) {
      // The record has an instrumental break here: run through it, but don't
      // start the next sung line until the singer does (see hear()).
      const hold = nextStart - 250;
      if (target >= hold) { target = Math.max(this.pos, hold); this.state = "waiting"; }
      else this.state = "instrumental";
    } else if (silent) {
      // Singer stopped where the record keeps singing: finish this line, wait.
      const hold = Math.min(lineEnd, nextStart - 250);
      if (target >= hold) { target = Math.max(this.pos, hold); this.state = "waiting"; }
      else this.state = now - this.lastConfirmAt < 4000 ? "following" : "coasting";
    } else {
      // Vocals continuing: run at band tempo, but not too far past the last
      // line we actually confirmed.
      const capLine = Math.min(this.starts.length - 1, this.confirmed + this.maxCoast);
      const cap = capLine + 1 < this.starts.length ? this.starts[capLine + 1] - 250 : this.starts[capLine] + this.sungMs[capLine];
      if (target > cap) target = Math.max(this.pos, cap);
      this.state = now - this.lastConfirmAt < 4000 ? "following" : "coasting";
    }
    const last = this.starts.length - 1;
    const songEnd = this.starts[last] + this.sungMs[last];
    this.pos = Math.min(target, songEnd);
  }

  /** Align the recent words with the lyrics and update position + tempo. */
  private match(heard: string[], now: number): void {
    if (heard.length < 2) return;
    const cur = this.confirmed;
    const nLines = this.starts.length;

    // Local search around the current line (cheap and biased to stay put).
    let local: { line: number; frac: number; score: number } | null = null;
    if (cur >= 0) {
      const curLine = this.lineAt(this.pos);
      const from = Math.max(0, Math.min(cur, curLine) - LOCAL_BEFORE);
      const to = Math.min(nLines - 1, Math.max(cur, curLine) + LOCAL_AFTER);
      local = this.alignRange(heard, from, to);
    }
    // Global search: for locking on and for repeats / skipped sections.
    const global = this.alignRange(heard, 0, nLines - 1);

    let pick: { line: number; frac: number; score: number } | null = null;
    let jumped = false;
    if (cur < 0) {
      if (global && global.score >= 0.62 && heard.length >= 4) { pick = global; jumped = true; }
    } else {
      if (local && local.score >= 0.5 && heard.length >= 3) pick = local;
      if (
        global &&
        Math.abs(global.line - cur) > FAR_JUMP_LINES &&
        global.score >= 0.78 &&
        heard.length >= 5 &&
        global.score - (local?.score ?? 0) >= 0.2
      ) {
        pick = global;
        jumped = true;
      }
    }
    if (!pick) return;

    const i = pick.line;
    // Where in the song the singer was when they sang the last matched word…
    const obs = this.starts[i] + pick.frac * this.sungMs[i];
    // …and where they are now, allowing for recogniser delay.
    const obsNow = obs + this.latency * this.rate;

    if (jumped || Math.abs(obsNow - this.pos) > 2500 * this.rate) this.pos = obsNow;
    else this.pos += 0.5 * (obsNow - this.pos);

    // ---- Tempo -----------------------------------------------------------
    if (jumped) {
      this.anchors = [];
    } else {
      const prev = this.anchors[this.anchors.length - 1];
      const prevLine = prev ? this.lineAt(prev.lrc) : -1;
      let crossesGap = false;
      for (let g = Math.max(0, prevLine); g < i && prevLine >= 0; g++) if (this.gapAfter[g]) crossesGap = true;
      if (crossesGap || (prev && obs < prev.lrc - 1500)) this.anchors = [];
      const last = this.anchors[this.anchors.length - 1];
      if (!last || obs > last.lrc + 400) this.anchors.push({ wall: now - this.latency, lrc: obs });
      while (this.anchors.length > 10 || (this.anchors.length > 2 && now - this.anchors[0].wall > 45000)) this.anchors.shift();
      this.updateRate();
    }

    this.confirmed = i;
    this.lastConfirmAt = now;
    this.state = "following";
  }

  /** Tempo = median slope between pairs of anchors (Theil–Sen), which shrugs
   *  off the odd mis-placed match far better than a least-squares fit. */
  private updateRate(): void {
    const a = this.anchors;
    if (a.length < 3) return;
    const span = a[a.length - 1].wall - a[0].wall;
    if (span < 6000) return;
    const slopes: number[] = [];
    for (let i = 0; i < a.length; i++) {
      for (let j = i + 1; j < a.length; j++) {
        const dw = a[j].wall - a[i].wall;
        if (dw >= 2500) slopes.push((a[j].lrc - a[i].lrc) / dw);
      }
    }
    if (slopes.length < 3) return;
    slopes.sort((x, y) => x - y);
    const slope = Math.max(0.7, Math.min(1.4, slopes[Math.floor(slopes.length / 2)]));
    // Trust the fit more as the anchors span more of the song.
    const gain = Math.min(0.35, 0.1 + span / 80000);
    this.rate += gain * (slope - this.rate);
  }

  /** Best alignment of the heard words within lines [from, to]. */
  private alignRange(heard: string[], from: number, to: number): { line: number; frac: number; score: number } | null {
    const tl = this.prep.tokenLine;
    let t0 = 0;
    while (t0 < tl.length && tl[t0] < from) t0++;
    let t1 = t0;
    while (t1 < tl.length && tl[t1] <= to) t1++;
    if (t1 <= t0) return null;
    const sub: PreparedLyrics = {
      tokens: this.prep.tokens.slice(t0, t1),
      tokenLine: tl.slice(t0, t1),
      lines: this.prep.lines,
    };
    const r = alignHeard(heard, sub);
    if (r.score <= 0 || r.endToken <= 0) return null;
    const lastTok = t0 + r.endToken - 1;
    const line = tl[lastTok];
    // Position of the last matched word within its line (0..1).
    let firstOfLine = lastTok;
    while (firstOfLine > 0 && tl[firstOfLine - 1] === line) firstOfLine--;
    const count = Math.max(1, this.lineTokCount[line]);
    const frac = Math.min(1, (lastTok - firstOfLine + 1) / count);
    return { line, frac, score: r.score };
  }
}
