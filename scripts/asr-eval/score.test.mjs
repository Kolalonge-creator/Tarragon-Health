// Run with: node --test scripts/asr-eval/score.test.mjs
// Synthetic data only: no real clip, no audio, no patient. These check the scoring maths and the highlighting, not any vendor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { align, drugSet, evaluate, normaliseNumbers, renderReport, scoreClip, tokenise, words } from "./score.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const list = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "drug-names.json"), "utf8"));
const drugs = drugSet(list);
const t = (speaker, text) => ({ speaker, text });
const clip = (id, accent, ref, hyp) => ({ id, accent, reference: { segments: ref }, hypothesis: { segments: hyp } });

test("the drug list covers the catalogue sources it says it does", () => {
  for (const d of ["metformin", "amlodipine", "tramadol", "warfarin", "gliclazide", "coartem"]) assert.ok(drugs.has(d), d);
  assert.ok(!drugs.has("tablet"));
});

test("tokeniser keeps decimals together, splits a slash, drops punctuation and apostrophes", () => {
  assert.deepEqual(tokenise("Take 2.5 mg, don't stop; BP 120/80."), ["take", "2.5", "mg", "dont", "stop", "bp", "120", "80"]);
  assert.deepEqual(tokenise("1,200 mg"), ["1200", "mg"]);
  assert.deepEqual(tokenise(null), []);
});

test("spoken numbers become digits: tens, hundreds, blood pressure style, thousands, decimals", () => {
  const n = (s) => normaliseNumbers(tokenise(s)).join(" ");
  assert.equal(n("twenty five"), "25");
  assert.equal(n("one hundred and twenty"), "120");
  assert.equal(n("one twenty over eighty"), "120 over 80");
  assert.equal(n("one forty five over ninety"), "145 over 90");
  assert.equal(n("two point five milligrams"), "2.5 milligrams");
  assert.equal(n("one thousand two hundred"), "1200");
  assert.equal(n("five five"), "5 5");
  assert.equal(n("fifteen"), "15");
  assert.equal(n("nineteen ninety"), "19 90");
});

test("a lone 'one' stays a word unless it sits beside a dose or time word", () => {
  assert.equal(normaliseNumbers(tokenise("one of my tablets")).join(" "), "one of my tablets");
  assert.equal(normaliseNumbers(tokenise("take one tablet daily")).join(" "), "take 1 tablet daily");
  assert.equal(normaliseNumbers(tokenise("take two tablets")).join(" "), "take 2 tablets");
});

test("alignment counts substitutions, deletions and insertions", () => {
  const ops = align(["a", "b", "c"], ["a", "x", "c", "d"]);
  assert.deepEqual(ops.map((o) => o.kind), ["match", "sub", "match", "ins"]);
  assert.deepEqual(align([], ["a"]).map((o) => o.kind), ["ins"]);
  assert.deepEqual(align(["a"], []).map((o) => o.kind), ["del"]);
});

test("a perfect transcript is 0% everywhere and has no mismatches", () => {
  const r = evaluate([clip("c1", "yoruba", [t("clinician", "Take amlodipine 5 mg once daily")], [t("clinician", "take amlodipine five mg once daily")])], drugs);
  assert.equal(r.totals.wer, 0);
  assert.equal(r.totals.drugWer, 0);
  assert.equal(r.totals.numberWer, 0);
  assert.deepEqual(r.mismatches, []);
});

test("overall WER is errors over reference words", () => {
  const r = evaluate([clip("c1", "igbo", [t("patient", "my head hurts a lot")], [t("patient", "my bed hurts lot")])], drugs);
  assert.equal(r.totals.errors, 2); // head became bed, "a" was lost
  assert.equal(r.totals.refWords, 5);
  assert.equal(r.totals.wer, 2 / 5);
});

test("a wrong drug name is found, reported with context, and counted in the drug rate not just the overall rate", () => {
  const r = evaluate([clip("c1", "hausa", [t("clinician", "start metformin 500 mg with food")], [t("clinician", "start metoprolol 500 mg with food")])], drugs);
  assert.equal(r.totals.drugTerms, 1);
  assert.equal(r.totals.drugWrong, 1);
  assert.equal(r.totals.drugWer, 1);
  assert.equal(r.totals.numberWrong, 0);
  assert.equal(r.mismatches.length, 1);
  assert.deepEqual({ kind: r.mismatches[0].kind, expected: r.mismatches[0].expected, heard: r.mismatches[0].heard }, { kind: "drug", expected: "metformin", heard: "metoprolol" });
  assert.match(r.mismatches[0].contextReference, /start metformin 500 mg/);
  assert.match(r.mismatches[0].contextHeard, /start metoprolol 500 mg/);
  assert.equal(r.falseEntities.some((f) => f.kind === "drug" && f.heard === "metoprolol"), false); // a drug swapped for a drug is one mismatch, not also a hallucination
  assert.match(renderReport(r), /DRUG \| \[\[metformin\]\] \| \[\[metoprolol\]\]/);
});

test("a wrong or missing number is the most visible kind of mismatch", () => {
  const r = evaluate([clip("c1", "pidgin-free", [t("clinician", "your pressure is 150 over 90")], [t("clinician", "your pressure is 15 over 90")]), clip("c2", "x", [t("clinician", "take 10 mg")], [t("clinician", "take mg")])], drugs);
  const nums = r.mismatches.filter((m) => m.kind === "number");
  assert.equal(nums.length, 2);
  assert.deepEqual(nums.map((m) => [m.expected, m.heard]), [["150", "15"], ["10", null]]);
  assert.equal(nums[1].contextHeard !== undefined, true);
  assert.equal(r.totals.numberWer, 2 / 3); // 150, 90 and 10 are said; 150 and 10 went wrong
});

test("an invented drug name or number is reported separately", () => {
  const r = evaluate([clip("c1", "yoruba", [t("patient", "I feel dizzy")], [t("patient", "I feel dizzy warfarin 5")])], drugs);
  assert.equal(r.totals.falseDrugs, 1);
  assert.equal(r.totals.falseNumbers, 1);
  assert.deepEqual(r.falseEntities.map((f) => [f.kind, f.heard]), [["drug", "warfarin"], ["number", "5"]]);
});

test("a dropped negation is counted, because it reverses a symptom", () => {
  const r = evaluate([clip("c1", "igbo", [t("patient", "I do not have chest pain and no cough")], [t("patient", "I do have chest pain and cough")])], drugs);
  assert.equal(r.totals.negations, 2);
  assert.equal(r.totals.negationsDropped, 2);
});

test("results split by speaker and by accent, at corpus level (total errors over total words)", () => {
  const r = evaluate([
    clip("c1", "yoruba", [t("clinician", "take it daily"), t("patient", "okay doctor")], [t("clinician", "take it daily"), t("patient", "okay docta")]),
    clip("c2", "igbo", [t("clinician", "stop the tablets now")], [t("clinician", "stop tablets")]),
  ], drugs);
  const sp = Object.fromEntries(r.bySpeaker.map((s) => [s.key, s]));
  assert.equal(sp.clinician.refWords, 7);
  assert.equal(sp.clinician.errors, 2);
  assert.equal(sp.patient.errors, 1);
  const ac = Object.fromEntries(r.byAccent.map((a) => [a.key, a]));
  assert.equal(ac.yoruba.wer, 1 / 5);
  assert.equal(ac.igbo.wer, 2 / 4);
  assert.equal(r.totals.wer, 3 / 9);
  assert.deepEqual(r.byAccent.map((a) => a.key), ["igbo", "yoruba"]);
});

test("an untagged clip and an unlabelled speaker are grouped, not dropped", () => {
  const r = evaluate([{ id: "c1", reference: { segments: [{ text: "hello there" }] }, hypothesis: { segments: [{ text: "hello" }] } }], drugs);
  assert.equal(r.byAccent[0].key, "untagged");
  assert.equal(r.bySpeaker[0].key, "unknown");
  assert.equal(scoreClip({ id: "x", reference: { segments: [] }, hypothesis: { segments: [] } }, drugs).overall.errors, 0);
  assert.deepEqual(words(undefined), []);
});

test("a small gold set carries a warning, and there is no pass mark", () => {
  const r = evaluate([clip("c1", "yoruba", [t("patient", "hello")], [t("patient", "hello")])], drugs);
  assert.ok(r.warnings.some((w) => /20 to 30 clip/.test(w)));
  assert.ok(r.warnings.some((w) => /drug-name occurrence/.test(w)));
  const text = renderReport(r);
  assert.match(text, /no pass mark/);
  assert.doesNotMatch(text, /\bPASS\b/);
});

test("with no reference words the rates are n/a, not a crash", () => {
  const r = evaluate([{ id: "c1", reference: { segments: [] }, hypothesis: { segments: [{ text: "noise" }] } }], drugs);
  assert.equal(r.totals.wer, null);
  assert.match(renderReport(r), /n\/a/);
});
