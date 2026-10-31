# Lyra: song ID and auto-cue rework (Oct 2026)

## What changed

### Live Cover ID (identify a song from about 5 sung words)
- **Fuzzy lyric matching** (`lib/lyric-match.ts`): heard words are aligned against each candidate's full lyrics, with partial credit for misheard words, sound-alikes, contractions ("going to" = "gonna") and split/merged words ("any time" = "anytime"). It also finds the matched line, which is shown on screen.
- **Server search** (`api-server/src/lib/lyric-rank.ts`, `routes/lyric-search.ts`):
  - Runs up to 4 Genius search variants: as heard, formal/informal contractions, and with the first or last word dropped.
  - Checks each candidate's lyrics (LRCLIB first, then lyrics.ovh) and ranks mainly on how well the heard words actually match.
  - Groups covers and remasters of the same song. The original is preferred using Genius page views and karaoke/tribute penalties.
  - Returns a `confidence` level (`high` / `medium` / `low` / `none`).
  - Caches searches for 6 h and lyrics for 24 h, spaces out LRCLIB calls, retries on 429, and stops checking lyrics after a 4 s budget.
  - The rate limit is raised to 60 requests per 5 minutes per IP.
- **Progressive listening** (`components/cover-id-modal.tsx`):
  - The first search goes out once about 5 words are heard, and again every 3 new words (at most 5 searches per listen, 20 s maximum).
  - A "best guess" is shown while it listens.
  - On a **high**-confidence match it stops listening and shows the available matches with their matched lines. The user must choose a song; lyrics never open automatically.
- **Your songs first** (`hooks/use-library-matcher.ts`): every setlist and favourite song is checked locally before the web search. This is instant, works offline (the lyrics are already pre-cached for gigs), and among a few dozen songs 5 words are usually decisive.
- **High confidence** requires all of the following:
  - at least 5 words
  - a match score of 0.75 or more
  - a clear lead over the best *different* song, where less popular songs and karaoke versions that quote the same line count for less
  - a lyrics check on at least one rival song

  Generic phrases ("oh baby baby oh yeah") never auto-open.

### Auto-cue: Follow mode keeps time with the band (`lib/cue-engine.ts`, `hooks/use-live-sync.ts`)
- The cue keeps a running **position** in the timed lyrics and the band's **tempo relative to the record**. The tempo is a median slope through recent word matches, so a single bad match can't throw it off.
- **Between matches** it keeps moving at the band's tempo, so it no longer freezes in loud sections. It runs at most 8 lines past the last line it confirmed.
- **Gaps:**
  - If the singer stops, the cue finishes the line and waits.
  - During an instrumental break in the record, it runs through the break but holds before the next sung line.
  - When new words arrive, it jumps to the next line, so long solos and shortened breaks both work.
- **Repeats and skipped verses:** a strong match more than 8 lines away moves the cue there.
- The recogniser restarts after 150 ms instead of 2.5 s, and restart gaps aren't mistaken for silence.
- The banner shows the state ("following the singer", "keeping time with the band", "instrumental — waiting for vocals") and the band's tempo, e.g. "band slower than record (92%)".
- **Tap any line** while Follow is on to correct the cue by hand.

## Test results
- **Cue engine, simulated gigs** (7 scenarios × 3 songs: tempo ±10–12%, drift, a solo 2.5× longer, a break cut by 60%, loud rooms):

  | | Correct line | Within 1 line |
  |---|---|---|
  | New engine, normal rooms | 79–84% | 95–100% |
  | Old Follow logic, same tests | 6–19% | 26–50% |
  | New engine, very loud rooms (12–30% of words heard) | 54–56% | 72–85% |

- **In-app test** (real UI in Chromium with a scripted recogniser, band 10% slower, 30 s solo):
  - Cover ID locked onto the song 3 s after the first word, once 5 words were in.
  - Follow measured the tempo at 92% and held through the solo.
  - It picked up the next line on re-entry and was on the right line 81% of the time (99% within one line).
- **Live lyric search** (18 real songs with one realistic mishearing each, via the live Genius endpoint plus LRCLIB):
  - The correct song ranked first for 16 of 18. Before the change, mishearings gave about 3 of 9.
  - The two generic phrases were never marked "sure".

## Known limits
- **Speech recognition is still the browser's built-in recogniser** (Google's engine in Chrome). It is built for speech, not for singing over a band, and it gets the words wrong more often than anything else in the pipeline. The matching now tolerates errors, but a loud stage will still produce fewer usable words. The next step up would be server-side Whisper or Deepgram.
- **LRCLIB rate-limits bursts** and sends 429 errors. Candidates it can't check in time stay unchecked. The app always shows matches for explicit user selection.
- **Popularity tie-breaks were not tested live.** They use Genius `stats.pageviews`, which this test harness couldn't see.
- **Follow mode needs synced (timed) lyrics.** Tap mode is still the fallback.

## Keep in sync
`artifacts/lyrics-viewer/src/lib/lyric-match.ts` and `artifacts/api-server/src/lib/lyric-match.ts` are identical copies. If you change one, copy it to the other.
