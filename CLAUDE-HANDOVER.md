# Lyra handover — 31 October 2026

## Current owner requirements

- Always present song matches for the user to choose. Never open a song automatically, including high-confidence matches. This supersedes the automatic-opening behaviour in the original enhancement handover.
- Always start in dark mode on a fresh load or refresh. The light-mode toggle remains available for the current session.
- Keep live-band cue following, manual line correction, and conservative confidence scoring.
- Do not run MediaRecorder/getUserMedia alongside browser speech recognition.

## Integrated work

The supplied song-identification and auto-cue enhancements are integrated:

- Fuzzy lyric matching, candidate lyric verification, ranking, confidence, caching, and request throttling.
- Progressive speech searches and local favourites/setlist matching.
- Tempo-aware Follow cue engine with instrumental holds and manual correction.
- Client and server copies of `lyric-match.ts` remain byte-identical.

Integration fixes include protecting the result screen from late responses, cleaning up the cue timer after recognizer restart failure, keyboard support for manual line correction, and requiring distinct non-filler words before reporting high confidence. The subsequently removed auto-open countdown is no longer part of the product.

## Verification and limitations

- Both Lyrics Viewer and API Server passed typechecks and production builds after enhancement integration and confidence fixes.
- Seven focused tests passed, including fuzzy matching, ranking, generic-phrase confidence, identical matcher copies, cue correction, and instrumental re-entry.
- Subsequent manual-selection and dark-start changes passed frontend typechecking. Dark startup was visually verified in Preview.
- A real Genius-backed search for `you can check out anytime you like` returned Hotel California by Eagles first with a matched lyric line.
- A browser check verified the typed search and lyric rendering. Scripted speech exposed a generic-phrase false-high result; it was corrected and confirmed through unit tests and a real API request.
- Remaining browser checks: manual-selection behaviour for high-confidence speech and local-library results, Follow controls, and manual cue correction. Real microphone/live-band performance has not been verified.
- The full workspace typecheck/build still fails in the separate mockup sandbox's Vite plugin type resolution. The two application packages pass individually.
- Do not assume the running published site contains these changes; this source export does not publish the application.

## Commands

```sh
pnpm install
pnpm --filter @workspace/scripts exec tsx --test ../tests/lyra-enhancements.test.ts
pnpm --filter @workspace/lyrics-viewer --filter @workspace/api-server run typecheck
pnpm --filter @workspace/lyrics-viewer --filter @workspace/api-server run build
cmp artifacts/lyrics-viewer/src/lib/lyric-match.ts artifacts/api-server/src/lib/lyric-match.ts
```

Use the existing managed workflows in Replit. Running elsewhere requires equivalent environment and routing configuration.

## Credentials and data

Credentials are not included in this repository. The app uses existing Clerk, database, ACRCloud and Genius configuration. The saved ACRCloud key/secret and Genius token were confirmed present; the Genius token was exercised successfully. ACRCloud's enabled flag confirms configuration presence, not an authenticated audio-recognition test.

Live database records, dependency folders, build outputs, internal agent files, and uploaded source ZIPs are excluded from this export.
