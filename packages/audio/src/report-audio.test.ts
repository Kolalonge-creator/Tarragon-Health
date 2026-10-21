import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createCatalogue, parseManifest } from "./manifest";
import { finished, realManifestJson, REPO_ROOT } from "./test-helpers";
import {
  REPORT_AUDIO_EXCLUDED_PATTERN,
  REPORT_GROUP,
  REPORT_READ_THROUGH_SECTIONS,
  RESULT_EXPLANATION_OUTCOMES,
  isReportAudioExcludedCode,
  reportAudioClipId,
  reportAudioFor,
  reportClips,
  withReportClips,
} from "./report-audio";

describe("S46d report and result audio hooks (draft slots, nothing recorded)", () => {
  const base = parseManifest(realManifestJson());
  const merged = withReportClips(base);

  it("adds one draft clip per section and per outcome, and the merged manifest still passes the strict parser", () => {
    expect(reportClips()).toHaveLength(REPORT_READ_THROUGH_SECTIONS.length + RESULT_EXPLANATION_OUTCOMES.length);
    expect(() => parseManifest(JSON.parse(JSON.stringify(merged)))).not.toThrow();
    expect(base.clips.some((c) => c.group === REPORT_GROUP)).toBe(false);
    const existing = new Set(base.clips.map((c) => c.id));
    expect(reportClips().filter((c) => existing.has(c.id))).toEqual([]);
  });

  it("fabricates no audio: nothing is recorded, nothing is signed, every slot is clinical", () => {
    for (const c of reportClips()) {
      expect(c.files.en).toMatchObject({ sha256: null, bytes: null, duration_ms: null, approvals: [] });
      expect(c.clinical).toBe(true);
      expect(c.script_hash).toBeNull();
    }
  });

  it("falls back to the text for every draft slot (no recording)", () => {
    const cat = createCatalogue(merged);
    for (const section of REPORT_READ_THROUGH_SECTIONS) expect(reportAudioFor(cat, { kind: "section", section })).toEqual({ ok: false, reason: "no_recording" });
    expect(reportAudioFor(cat, { kind: "result", analyteCode: "fasting_glucose", outcome: "high" })).toEqual({ ok: false, reason: "no_recording" });
  });

  it("control: a recorded, fully signed clip plays; recorded without the clinical review it is held", () => {
    const clip = reportClips().find((c) => c.id === "RPT-104") ?? reportClips()[0]!;
    const done = finished(clip);
    const target = { kind: "section", section: "summary" } as const;
    expect(reportAudioFor(createCatalogue({ ...merged, clips: [done] }), target).ok).toBe(true);
    const unsigned = { ...done, files: { en: { ...done.files.en!, approvals: done.files.en!.approvals.filter((a) => a.review === "brand") } } };
    expect(reportAudioFor(createCatalogue({ ...merged, clips: [unsigned] }), target)).toEqual({ ok: false, reason: "awaiting_review" });
  });

  it("HIV, hepatitis B surface antigen and hepatitis C antibody (and look-alikes) can NEVER map to a clip, even when every clip is recorded and signed", () => {
    const allDone = createCatalogue({ ...merged, clips: reportClips().map((c) => finished(c)) });
    for (const code of ["hiv", "HIV_SCREEN", "hiv_ab_ag", "hbsag", "hbs_ag", "hep_b", "hep_c", "hcv_ab", "anti_hcv", "hbv_dna", "hepatitis_b_core", "anti_hbs", "syphilis", "chlamydia_gonorrhoea"]) {
      for (const outcome of RESULT_EXPLANATION_OUTCOMES) {
        expect(reportAudioClipId({ kind: "result", analyteCode: code, outcome })).toBeNull();
        expect(reportAudioFor(allDone, { kind: "result", analyteCode: code, outcome })).toEqual({ ok: false, reason: "sensitive_never" });
      }
    }
    // a flagged sensitive positive on an ordinary-looking code is refused too
    expect(reportAudioFor(allDone, { kind: "result", analyteCode: "screen_x", outcome: "high", sensitivePositive: true })).toEqual({ ok: false, reason: "sensitive_never" });
    // control: an ordinary analyte plays once its clip is recorded and signed
    expect(reportAudioFor(allDone, { kind: "result", analyteCode: "fasting_glucose", outcome: "high" }).ok).toBe(true);
    expect(isReportAudioExcludedCode("fasting_glucose")).toBe(false);
  });

  it("the exclusion pattern is the database's own (public.report_excluded_code)", () => {
    const dir = join(REPO_ROOT, "supabase", "migrations");
    const file = readdirSync(dir).find((f) => f.endsWith("_s46_results_serology_health_report.sql")) as string;
    const sql = readFileSync(join(dir, file), "utf8");
    const m = /report_excluded_code[\s\S]*?~ '\(\^\|\[\^a-z\]\)\(([^)]*)\)/.exec(sql);
    expect(m?.[1]).toBeTruthy();
    expect(REPORT_AUDIO_EXCLUDED_PATTERN.source).toContain(m?.[1] as string);
  });
});
