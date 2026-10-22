// Run with: node --test scripts/audio-fallback-measure/report.test.mjs   (synthetic runs only: no handset, no person)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CURRENT, MIN_RUNS, SCHEMA, buildReport, lossBreakingPoint, lossTolerated, renderMarkdown, rttSummary, validateRun } from "./report.mjs";

const run = (over = {}) => ({
  schema: SCHEMA, runId: "r", profile: "3g_throttled", handset: { model: "Tecno Spark 10" }, joinTimeMs: 9000, fallbackDelayMs: 14000,
  lossSteps: [{ lossPercent: 0, result: "clear" }, { lossPercent: 10, result: "choppy" }, { lossPercent: 20, result: "unintelligible" }, { lossPercent: 30, result: "dropped" }],
  rttProbe: { url: "x", samples: [300, 350, null, 400, 320] }, ...over,
});
const many = (n, over) => Array.from({ length: n }, (_, i) => run({ runId: `r${i}`, ...(typeof over === "function" ? over(i) : over) }));

test("CURRENT is exactly the proposed video.audio_fallback version 2 in the registry (it cannot drift)", () => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/shared/src/proposed-config/registry.ts"), "utf8");
  const m = /value: \{ (poorSamplesToDowngrade: 3, goodSamplesToOfferVideo: 6, poorBelowKbps: 100, poorAudioLossPercent: 10, poorAudioRttMs: 600, sampleIntervalSeconds: 3) \},/.exec(src);
  assert.ok(m, "the v2 value line was not found in the registry");
  const parsed = Object.fromEntries(m[1].split(", ").map((kv) => kv.split(": ")).map(([k, v]) => [k, Number(v)]));
  assert.deepEqual(parsed, CURRENT);
});

test("breaking point, tolerated loss and link summary", () => {
  assert.equal(lossBreakingPoint(run()), 20);
  assert.equal(lossTolerated(run()), 10);
  assert.equal(lossBreakingPoint(run({ lossSteps: [{ lossPercent: 5, result: "clear" }] })), null);
  assert.equal(lossTolerated(run({ lossSteps: [] })), null);
  assert.deepEqual(rttSummary(run()), { n: 5, failedPercent: 20, medianMs: 335, p95Ms: 400 });
  assert.equal(rttSummary(run({ rttProbe: null })), null);
});

test("too little evidence proposes nothing and says what is missing", () => {
  const r = buildReport(many(2));
  assert.equal(r.candidate, null);
  assert.equal(r.evidence.enough, false);
  assert.ok(r.evidence.missing.some((m) => /handset models/.test(m)));
  assert.ok(r.evidence.missing.some((m) => /more run/.test(m)));
  assert.match(renderMarkdown(r), /Not enough evidence/);
  assert.equal(buildReport(many(6, { profile: "4g" })).candidate, null);
});

test("enough evidence proposes a loss threshold well before speech breaks, and leaves every other value alone", () => {
  const runs = [...many(MIN_RUNS.perProfile), ...many(MIN_RUNS.perProfile, (i) => ({ runId: `b${i}`, handset: { model: "Samsung A15" }, profile: "power_saving", lossSteps: [{ lossPercent: 30, result: "unintelligible" }] }))];
  const r = buildReport(runs);
  assert.equal(r.evidence.enough, true);
  assert.equal(r.candidate.poorAudioLossPercent, 10);
  for (const k of Object.keys(CURRENT)) if (k !== "poorAudioLossPercent") assert.equal(r.candidate[k], CURRENT[k]);
  assert.match(renderMarkdown(r), /proposed, unsigned/);
  // a handset that breaks at 8 percent pulls the candidate down, but never below 5
  const worse = buildReport(runs.map((x, i) => (i === 0 ? { ...x, lossSteps: [{ lossPercent: 8, result: "unintelligible" }] } : x)));
  assert.equal(worse.candidate.poorAudioLossPercent, 5);
});

test("a ladder that is much slower on a handset than on paper is called out", () => {
  const slow = buildReport([...many(5, { fallbackDelayMs: 40000 }), ...many(5, (i) => ({ runId: `s${i}`, handset: { model: "Other" }, fallbackDelayMs: 40000, profile: "power_saving" }))]);
  assert.ok(slow.findings.some((f) => /more than double/.test(f)));
});

test("a file that is not a run, or has impossible values, is refused with a reason", () => {
  assert.throws(() => validateRun({}, "f"), /schema/);
  assert.throws(() => validateRun(run({ handset: { model: " " } })), /handset model/);
  assert.throws(() => validateRun(run({ lossSteps: [{ lossPercent: 140, result: "clear" }] })), /outside 0 to 100/);
  assert.throws(() => validateRun(run({ lossSteps: [{ lossPercent: 5, result: "fine" }] })), /unknown loss result/);
  assert.throws(() => validateRun(run({ joinTimeMs: -1 })), /joinTimeMs/);
  assert.throws(() => validateRun(run({ profile: "" })), /profile/);
  assert.throws(() => validateRun(run({ rttProbe: { samples: "x" } })), /samples/);
  assert.throws(() => buildReport([{ ...run(), lossSteps: "x" }]), /lossSteps/);
});
