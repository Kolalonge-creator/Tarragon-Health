// Run with: node --test scripts/asr-eval/gate.test.mjs   (synthetic data only)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { drugSet, evaluate } from "./score.mjs";
import { DEFAULTS, gate, renderGate } from "./gate.mjs";
import { ACCENTS, SCENARIOS, buildManifest, scaffold } from "./scaffold.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const drugs = drugSet(JSON.parse(readFileSync(resolve(here, "drug-names.json"), "utf8")));
const seg = (text) => ({ segments: [{ speaker: "clinician", text }] });
const clip = (i, ref, hyp, accent = "yoruba") => ({ id: `c${i}`, accent, reference: seg(ref), hypothesis: seg(hyp) });
// 30 clips, each carrying one drug and one number
const make = (wrongDrugs, wrongNumbers, accentOf = () => "yoruba") =>
  Array.from({ length: 30 }, (_, i) => clip(i, "take amlodipine 5 mg daily", `take ${i < wrongDrugs ? "metformin" : "amlodipine"} ${i < wrongNumbers ? 9 : 5} mg daily`, accentOf(i)));

test("a set at the mark on both drug names and numbers passes", () => {
  const g = gate(evaluate(make(1, 1), drugs));
  assert.equal(g.verdict, "PASS");
  assert.ok(g.drugAccuracy >= 0.95 && g.numberAccuracy >= 0.95);
});

test("each class is held to the mark on its own: perfect numbers cannot cover weak drug names", () => {
  const g = gate(evaluate(make(3, 0), drugs));
  assert.equal(g.verdict, "FAIL");
  assert.ok(g.numberAccuracy === 1 && g.drugAccuracy < 0.95);
  assert.equal(gate(evaluate(make(0, 3), drugs)).verdict, "FAIL");
});

test("exactly 95 percent passes and just under fails", () => {
  const set = make(0, 0);
  const near = evaluate(set, drugs);
  near.totals.drugTerms = 100; near.totals.drugWrong = 5; near.totals.numberTerms = 100; near.totals.numberWrong = 0;
  assert.equal(gate(near).verdict, "PASS");
  near.totals.drugWrong = 6;
  assert.equal(gate(near).verdict, "FAIL");
});

test("too few clips or terms is NOT_ENOUGH_DATA, but a failing score is a FAIL however small the set", () => {
  assert.equal(gate(evaluate(make(0, 0).slice(0, 5), drugs)).verdict, "NOT_ENOUGH_DATA");
  assert.equal(gate(evaluate([clip(1, "take amlodipine 5 mg", "take metformin 5 mg")], drugs)).verdict, "FAIL");
  const none = gate(evaluate([clip(1, "hello", "hello")], drugs));
  assert.equal(none.verdict, "NOT_ENOUGH_DATA");
  assert.equal(none.drugAccuracy, null);
  assert.match(renderGate(none), /not enough data/);
});

test("an accent that is below the mark is shown even when the total passes; invented entities and dropped negations are reported", () => {
  const r = evaluate(make(2, 0, (i) => (i < 2 ? "hausa" : i < 6 ? "igbo" : "yoruba")).concat([clip(99, "no chest pain", "chest pain 7")]), drugs);
  const g = gate(r, { minClipsForAccentGap: 2 });
  assert.ok(g.accentGaps.some((a) => a.accent === "hausa"));
  assert.equal(g.safety.negationsDropped, 1);
  assert.ok(g.safety.inventedNumbers >= 1);
  assert.match(renderGate(g), /accent gap: hausa/);
});

test("the default mark is the Q19 mark of 95 percent", () => {
  assert.equal(DEFAULTS.passMark, 0.95);
});

test("the scaffold covers every scenario and accent, refuses an existing folder, and writes empty references", () => {
  const m = buildManifest();
  assert.equal(m.clips.length, 24);
  assert.deepEqual([...new Set(m.clips.map((c) => c.scenario))].sort(), [...SCENARIOS].sort());
  assert.deepEqual([...new Set(m.clips.map((c) => c.accent))].sort(), [...ACCENTS].sort());
  const dir = join(mkdtempSync(join(tmpdir(), "gold-")), "set");
  scaffold(dir);
  assert.throws(() => scaffold(dir), /already exists/);
  assert.equal(JSON.parse(readFileSync(join(dir, "ref", "c01.json"), "utf8")).segments[0].text, "");
});

test("run.mjs exits 3 on FAIL, 4 on not enough data, 0 on PASS, and --pass-mark none restores measure only", () => {
  const dir = mkdtempSync(join(tmpdir(), "gold-run-"));
  mkdirSync(join(dir, "ref")); mkdirSync(join(dir, "hyp"));
  const writeSet = (n, hypFor) => {
    const clips = [];
    for (let i = 0; i < n; i++) {
      writeFileSync(join(dir, "ref", `c${i}.json`), JSON.stringify(seg("take amlodipine 5 mg daily")));
      writeFileSync(join(dir, "hyp", `c${i}.json`), JSON.stringify(seg(hypFor(i))));
      clips.push({ id: `c${i}`, accent: "yoruba", reference: `ref/c${i}.json`, hypothesis: `hyp/c${i}.json` });
    }
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ clips }));
  };
  const run = (...extra) => spawnSync(process.execPath, [join(here, "run.mjs"), join(dir, "manifest.json"), ...extra], { encoding: "utf8" });
  writeSet(30, () => "take amlodipine 5 mg daily");
  assert.equal(run().status, 0);
  assert.match(run().stdout, /PASS MARK 95%.*PASS/);
  writeSet(30, (i) => (i < 5 ? "take metformin 5 mg daily" : "take amlodipine 5 mg daily"));
  assert.equal(run().status, 3);
  assert.equal(run("--pass-mark", "none").status, 0);
  assert.doesNotMatch(run("--pass-mark", "none").stdout, /PASS MARK/);
  assert.equal(run("--pass-mark", "0").status, 2);
  assert.equal(run("--pass-mark", "0.95").status, 2); // a fraction is not a percent: it would have been a 0.95 percent mark
  assert.equal(run("--pass-mark", "abc").status, 2);
  assert.equal(run("--pass-mark", "101").status, 2);
  writeSet(4, () => "take amlodipine 5 mg daily");
  assert.equal(run().status, 4);
});
