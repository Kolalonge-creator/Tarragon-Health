#!/usr/bin/env node
// Usage: node scripts/audio-fallback-measure/report.mjs <run.json|dir> [...more] [--out report-dir]
// Reads the files the handset probe (probe.html) produced and writes a report plus a CANDIDATE `video.audio_fallback` value.
//
// What this never does: change a configured value. The candidate is a proposal for the CMO/founder; the signed configuration in
// packages/shared/src/proposed-config/registry.ts changes only through its own versioned, signed process. With too little evidence it
// refuses to propose anything (see MIN_RUNS) and says exactly what is missing.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SCHEMA = "tarragon-audio-fallback-run/v1";
/** Evidence needed before a candidate is proposed: runs per condition, and distinct handset models overall. */
export const MIN_RUNS = { perProfile: 5, handsetModels: 2 };
/** The currently proposed values (version 2) the candidate is compared with. Read from the registry by a test, so this cannot drift. */
export const CURRENT = { poorSamplesToDowngrade: 3, goodSamplesToOfferVideo: 6, poorBelowKbps: 100, poorAudioLossPercent: 10, poorAudioRttMs: 600, sampleIntervalSeconds: 3 };
const BAD_RESULTS = new Set(["unintelligible", "dropped"]);

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const round1 = (n) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 10) / 10);
const secs = (ms) => (ms === null ? null : round1(ms / 1000));

/** Throws a readable error for a file that is not a run. */
export function validateRun(run, label = "run") {
  const bad = (m) => { throw new Error(`${label}: ${m}`); };
  if (!run || typeof run !== "object") bad("not an object");
  if (run.schema !== SCHEMA) bad(`schema is not ${SCHEMA}`);
  if (typeof run.profile !== "string" || !run.profile) bad("no profile");
  if (typeof run.handset?.model !== "string" || !run.handset.model.trim()) bad("no handset model");
  if (!Array.isArray(run.lossSteps)) bad("lossSteps is not a list");
  for (const s of run.lossSteps) {
    if (!(Number.isFinite(s?.lossPercent) && s.lossPercent >= 0 && s.lossPercent <= 100)) bad("a loss step has a loss outside 0 to 100");
    if (!["clear", "choppy", "unintelligible", "dropped"].includes(s?.result)) bad(`unknown loss result ${s?.result}`);
  }
  for (const k of ["joinTimeMs", "fallbackDelayMs"]) if (run[k] != null && !(Number.isFinite(run[k]) && run[k] >= 0)) bad(`${k} is not a positive number`);
  if (run.rttProbe != null && !Array.isArray(run.rttProbe.samples)) bad("rttProbe.samples is not a list");
  return run;
}

/** The lowest loss at which speech could not be understood (or the call dropped) in this run, or null when it never got that bad. */
export function lossBreakingPoint(run) {
  const bad = run.lossSteps.filter((s) => BAD_RESULTS.has(s.result)).map((s) => s.lossPercent);
  return bad.length ? Math.min(...bad) : null;
}
/** The highest loss at which speech was still understood (clear or choppy) BELOW the breaking point. */
export function lossTolerated(run) {
  const breaking = lossBreakingPoint(run);
  const ok = run.lossSteps.filter((s) => !BAD_RESULTS.has(s.result) && (breaking === null || s.lossPercent < breaking)).map((s) => s.lossPercent);
  return ok.length ? Math.max(...ok) : null;
}
export function rttSummary(run) {
  const samples = run.rttProbe?.samples ?? [];
  if (!samples.length) return null;
  const ok = samples.filter((x) => Number.isFinite(x));
  return { n: samples.length, failedPercent: round1(((samples.length - ok.length) / samples.length) * 100), medianMs: median(ok), p95Ms: pct(ok, 95) };
}

export function summariseProfile(name, runs) {
  const join = runs.map((r) => r.joinTimeMs).filter(Number.isFinite);
  const fb = runs.map((r) => r.fallbackDelayMs).filter(Number.isFinite);
  const breaking = runs.map(lossBreakingPoint).filter((x) => x !== null);
  const tolerated = runs.map(lossTolerated).filter((x) => x !== null);
  const rtts = runs.map(rttSummary).filter(Boolean);
  return {
    profile: name,
    runs: runs.length,
    handsetModels: [...new Set(runs.map((r) => r.handset.model.trim().toLowerCase()))].length,
    joinSeconds: { n: join.length, median: secs(median(join)), p95: secs(pct(join, 95)), max: join.length ? secs(Math.max(...join)) : null },
    fallbackDelaySeconds: { n: fb.length, median: secs(median(fb)), p95: secs(pct(fb, 95)) },
    lossBreakingPercent: { n: breaking.length, lowest: breaking.length ? Math.min(...breaking) : null, median: median(breaking) },
    lossToleratedPercent: { n: tolerated.length, median: median(tolerated) },
    linkRttMs: { n: rtts.length, median: round1(median(rtts.map((r) => r.medianMs).filter(Number.isFinite))), p95: round1(pct(rtts.map((r) => r.p95Ms).filter(Number.isFinite), 95)) },
    linkFailedPercent: round1(median(rtts.map((r) => r.failedPercent))),
  };
}

/** Pure: runs in, report object out. */
export function buildReport(runs) {
  runs.forEach((r, i) => validateRun(r, `run ${i + 1}`));
  const byProfile = new Map();
  for (const r of runs) byProfile.set(r.profile, [...(byProfile.get(r.profile) ?? []), r]);
  const profiles = [...byProfile.entries()].map(([n, rs]) => summariseProfile(n, rs));
  const models = new Set(runs.map((r) => r.handset.model.trim().toLowerCase()));
  const missing = [];
  if (models.size < MIN_RUNS.handsetModels) missing.push(`runs from at least ${MIN_RUNS.handsetModels} different handset models (have ${models.size})`);
  const stressed = profiles.filter((p) => p.profile !== "4g");
  if (!stressed.length) missing.push("any run on a stressed condition (3G throttled, power saving, 2G, lossy Wi-Fi)");
  for (const p of stressed) if (p.runs < MIN_RUNS.perProfile) missing.push(`${MIN_RUNS.perProfile - p.runs} more run(s) on "${p.profile}" (have ${p.runs} of ${MIN_RUNS.perProfile})`);
  const evidence = missing.length === 0;

  const findings = [];
  let candidate = null;
  if (evidence) {
    const lowest = Math.min(...stressed.map((p) => p.lossBreakingPercent.lowest ?? Infinity));
    // Drop to audio only well before speech breaks: half the lowest observed breaking loss, to a multiple of 5, never below 5.
    const loss = Number.isFinite(lowest) ? Math.max(5, Math.floor((lowest / 2) / 5) * 5) : CURRENT.poorAudioLossPercent;
    const delays = stressed.map((p) => p.fallbackDelaySeconds.p95).filter(Number.isFinite);
    const worstDelay = delays.length ? Math.max(...delays) : null;
    const expected = CURRENT.poorSamplesToDowngrade * CURRENT.sampleIntervalSeconds;
    candidate = { ...CURRENT, poorAudioLossPercent: loss };
    findings.push(`Lowest loss at which speech broke on any stressed condition: ${Number.isFinite(lowest) ? `${lowest}%` : "never reached in these runs"}. Candidate poorAudioLossPercent: ${loss} (current ${CURRENT.poorAudioLossPercent}).`);
    if (worstDelay !== null) {
      findings.push(`Slowest p95 time from a bad link to the audio-only screen: ${worstDelay}s. The configured values imply about ${expected}s (poorSamplesToDowngrade ${CURRENT.poorSamplesToDowngrade} x sampleIntervalSeconds ${CURRENT.sampleIntervalSeconds}). ${worstDelay > expected * 2 ? "It is more than double: the ladder is slower on a real handset than on paper. Do not shorten samples before finding out why." : "Within double."}`);
    }
    const joins = stressed.map((p) => p.joinSeconds.p95).filter(Number.isFinite);
    if (joins.length) findings.push(`Slowest p95 join time on a stressed condition: ${Math.max(...joins)}s.`);
  }
  return { generatedAt: new Date().toISOString(), runs: runs.length, handsetModels: [...models], profiles, evidence: { enough: evidence, missing, required: MIN_RUNS }, findings, current: CURRENT, candidate };
}

export function renderMarkdown(report) {
  const L = [];
  L.push("# Audio fallback handset report", "", `Generated ${report.generatedAt}. ${report.runs} run(s), handsets: ${report.handsetModels.join(", ")}.`, "");
  L.push("A proposal, not a setting. The signed `video.audio_fallback` configuration is not changed by this report; the CMO or founder decides.", "");
  L.push("| Condition | Runs | Join median / p95 (s) | Bad link to audio-only median / p95 (s) | Lowest loss that broke speech | Median loss tolerated | Link round trip median / p95 (ms) | Link requests failed (%) |", "|---|---|---|---|---|---|---|---|");
  for (const p of report.profiles) {
    const v = (x) => (x === null || x === undefined || Number.isNaN(x) ? "n/a" : x);
    L.push(`| ${p.profile} | ${p.runs} | ${v(p.joinSeconds.median)} / ${v(p.joinSeconds.p95)} | ${v(p.fallbackDelaySeconds.median)} / ${v(p.fallbackDelaySeconds.p95)} | ${v(p.lossBreakingPercent.lowest)} | ${v(p.lossToleratedPercent.median)} | ${v(p.linkRttMs.median)} / ${v(p.linkRttMs.p95)} | ${v(p.linkFailedPercent)} |`);
  }
  L.push("");
  if (!report.evidence.enough) {
    L.push("## Not enough evidence to propose values", "", "Still needed:", ...report.evidence.missing.map((m) => `- ${m}`), "");
  } else {
    L.push("## Findings", "", ...report.findings.map((f) => `- ${f}`), "", "## Candidate value (proposed, unsigned)", "", "```json", JSON.stringify(report.candidate, null, 2), "```", "");
  }
  L.push("The loss figures come from the tester's judgement of speech at each added-loss step; the link figures are timed requests from the handset, a rough stand-in for packet loss. Both are evidence for a decision, not a guarantee.");
  return L.join("\n");
}

function collect(paths) {
  const files = [];
  for (const p of paths) {
    const full = resolve(p);
    if (!existsSync(full)) throw new Error(`not found: ${p}`);
    if (statSync(full).isDirectory()) for (const f of readdirSync(full)) { if (f.endsWith(".json")) files.push(join(full, f)); }
    else files.push(full);
  }
  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
  if (args.length === 0) { console.error("usage: node scripts/audio-fallback-measure/report.mjs <run.json|dir> [...] [--out dir]"); process.exit(2); }
  try {
    const runs = collect(args).map((f) => JSON.parse(readFileSync(f, "utf8")));
    const report = buildReport(runs);
    const md = renderMarkdown(report);
    console.log(md);
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "audio-fallback-report.md"), md);
      writeFileSync(join(out, "audio-fallback-report.json"), JSON.stringify(report, null, 2));
      if (report.candidate) writeFileSync(join(out, "video.audio_fallback.candidate.json"), JSON.stringify({ key: "video.audio_fallback", status: "proposed", signed: false, note: "Candidate from handset measurements. Not applied. Needs CMO or founder sign-off through the versioned configuration.", value: report.candidate }, null, 2));
    }
    process.exit(report.evidence.enough ? 0 : 3);
  } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); }
}
