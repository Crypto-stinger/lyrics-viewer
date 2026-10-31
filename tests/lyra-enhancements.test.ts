import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { alignHeard, heardTokens, judgeConfidence, prepareLyrics } from "../artifacts/lyrics-viewer/src/lib/lyric-match";
import { CueEngine } from "../artifacts/lyrics-viewer/src/lib/cue-engine";
import { identifyFromLyrics } from "../artifacts/api-server/src/lib/lyric-rank";

test("client and server matchers remain identical", () => {
  assert.equal(
    readFileSync(new URL("../artifacts/lyrics-viewer/src/lib/lyric-match.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../artifacts/api-server/src/lib/lyric-match.ts", import.meta.url), "utf8"),
  );
});

test("distinctive lyrics tolerate one misheard word", () => {
  const match = alignHeard(
    heardTokens("you can check out any time you bike"),
    prepareLyrics("Welcome to the Hotel California\nYou can check out any time you like\nBut you can never leave"),
  );
  assert.ok(match.score >= 0.75, `score was ${match.score}`);
  assert.equal(match.startLine, 1);
});

test("generic phrases and short snippets cannot trigger auto-open", () => {
  for (const text of ["oh baby baby oh yeah", "oh baby baby oh yeah tonight", "oh baby yeah tonight oh tonight", "you can check"]) {
    assert.notEqual(judgeConfidence(1, 0, heardTokens(text)).level, "high");
  }
});

test("ranking checks lyrics, prefers originals and includes confidence", async () => {
  const result = await identifyFromLyrics("you can check out anytime you like", {
    search: async () => [
      { title: "Hotel California", artist: "Eagles", pageviews: 1000000 },
      { title: "Hotel California (Karaoke)", artist: "Tribute Band", pageviews: 10 },
      { title: "Different Song", artist: "Another Band", pageviews: 100 },
    ],
    lyrics: async (artist) => ({
      text: artist === "Another Band" ? "Dancing through the moonlit forest tonight" : "You can check out anytime you like\nBut you can never leave",
      hasPlain: true,
      hasSynced: artist === "Eagles",
    }),
  }, { verifyBudgetMs: 50 });
  assert.equal(result.results[0].artist, "Eagles");
  assert.ok((result.results[0].matchScore ?? 0) >= 0.9);
  assert.match(result.results[0].matchedLine ?? "", /check out/i);
  assert.equal(result.confidence.level, "high");
});

test("unverified candidates never receive high confidence", async () => {
  const result = await identifyFromLyrics("you can check out anytime you like", {
    search: async () => [{ title: "Hotel California", artist: "Eagles" }],
    lyrics: async () => ({ text: null, hasPlain: false, hasSynced: false }),
  }, { verifyBudgetMs: 50 });
  assert.notEqual(result.confidence.level, "high");
});

const lines = [
  { timeMs: 0, text: "Silver lanterns shimmer by the river" },
  { timeMs: 4000, text: "Golden mountains greet the morning sun" },
  { timeMs: 8000, text: "Velvet shadows dance across the valley" },
  { timeMs: 40000, text: "Thunder echoes through the distant canyon" },
];

test("cue supports manual correction and ignores repeated position evidence", () => {
  const engine = new CueEngine(lines, { latencyMs: 0 });
  const phrase = "Silver lanterns shimmer by the";
  engine.hear(phrase, 0);
  assert.equal(engine.tick(0).index, 0);
  engine.jumpTo(2, 1000);
  engine.hear(phrase, 1100);
  assert.equal(engine.tick(1100).index, 2);
  engine.jumpTo(-1, 1200);
  assert.equal(engine.tick(1200).index, 2);
});

test("cue waits through a long instrumental and picks up returning vocals", () => {
  const engine = new CueEngine(lines, { latencyMs: 0 });
  engine.jumpTo(2, 0);
  let snap = engine.tick(0);
  for (let time = 100; time <= 60000; time += 100) snap = engine.tick(time);
  assert.equal(snap.index, 2);
  assert.equal(snap.state, "waiting");
  engine.hear(lines[3].text, 60100);
  assert.equal(engine.tick(60100).index, 3);
});
