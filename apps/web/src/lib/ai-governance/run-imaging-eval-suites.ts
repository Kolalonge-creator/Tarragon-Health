/**
 * Runs AI-016's single DB-registered evaluation suite ("AI-016 golden
 * imaging report extraction", see supabase/migrations/20260922190712_ai016_
 * imaging_report_extraction_registration.sql) against the real
 * extractImagingReport() and returns a real, measured result. Architecture
 * mirrors run-coach-eval-suites.ts (AI-001's harness) closely, reusing its
 * exported EvalSuite/EvalSuiteCase/EvalSuiteResult/EvalCaseOutcome shapes
 * rather than redeclaring them -- the admin console's server action calls
 * either harness through the same interface.
 *
 * AI-016's four cases are, deliberately, near-exact-match checks against a
 * known answer key or a fixed boolean guardrail (see the suite's own
 * `expected_behaviour` text) -- unlike AI-001's fairness/red-team suites,
 * nothing here needs an LLM judge. Each case is scored deterministically by
 * `scoreImagingEvalCase` below, which is exported and unit-tested directly
 * (see run-imaging-eval-suites.test.ts) without needing a live model call or
 * a live database.
 *
 * extractImagingReport() takes an uploaded image/PDF, not plain text --
 * imaging-eval-fixtures.ts's `renderFixtureReportPdfBase64` turns each
 * case's literal fixture report body into a real, minimal single-page PDF
 * via @react-pdf/renderer (already used everywhere else in this codebase for
 * server-generated PDFs) and that PDF is what gets sent to the real
 * production extraction function -- this exercises the REAL code path, not
 * a rewritten copy of its logic.
 *
 * Supabase for reading the suite/case definitions: real service-role client
 * (ai_evaluation_suites/ai_evaluation_cases are admin-only governance
 * tables), same as run-coach-eval-suites.ts. This module does NOT write
 * ai_evaluation_runs/ai_evaluation_case_results itself -- exactly the same
 * division of responsibility as run-coach-eval-suites.ts: the caller (the
 * admin console's server action) decides how/when to record a run.
 *
 * Requires ANTHROPIC_API_KEY. Four real Sonnet 5 vision calls per full run,
 * no judge calls -- well under $1 total.
 */

import { extractImagingReport, type ImagingReportExtractionResult } from "../imaging-reports/extract";
import { createServiceRoleClient } from "../supabase/service-role";
import { FIXTURE_REPORTS, renderFixtureReportPdfBase64 } from "./imaging-eval-fixtures";
import type { EvalSuite, EvalSuiteCase, EvalSuiteResult, EvalCaseOutcome } from "./run-coach-eval-suites";

const SUITE_NAME = "AI-016 golden imaging report extraction";

// ---------------------------------------------------------------------------
// DB read: fetch AI-016's registered suite + cases from the live governance
// tables. Read-only, service-role (RLS on these tables is admin-scoped) --
// identical shape to run-coach-eval-suites.ts's loadAi001Suites, just scoped
// to AI-016's one suite instead of AI-001's four.
// ---------------------------------------------------------------------------

async function loadAi016Suite(): Promise<{ aiSystemId: string; suite: EvalSuite }> {
  const db = createServiceRoleClient();

  const { data: system, error: systemError } = await db
    .from("ai_systems")
    .select("id")
    .eq("system_code", "AI-016")
    .single();
  if (systemError || !system) {
    throw new Error(`Could not load AI-016 from ai_systems: ${systemError?.message ?? "not found"}`);
  }
  const aiSystemId = system.id as string;

  const { data: suiteRow, error: suiteError } = await db
    .from("ai_evaluation_suites")
    .select("id, pass_threshold_pct")
    .eq("name", SUITE_NAME)
    .eq("ai_system_id", aiSystemId)
    .single();
  if (suiteError || !suiteRow) {
    throw new Error(`Could not load suite "${SUITE_NAME}": ${suiteError?.message ?? "not found"}`);
  }

  const { data: caseRows, error: caseError } = await db
    .from("ai_evaluation_cases")
    .select("id, case_code, scenario, expected_behaviour, population_group, expected_tier")
    .eq("suite_id", suiteRow.id as string)
    .order("case_code");
  if (caseError) {
    throw new Error(`Could not load cases for suite "${SUITE_NAME}": ${caseError.message}`);
  }

  return {
    aiSystemId,
    suite: {
      id: suiteRow.id as string,
      name: SUITE_NAME,
      pass_threshold_pct: Number(suiteRow.pass_threshold_pct),
      cases: (caseRows ?? []) as EvalSuiteCase[],
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic scoring -- no judge. Whitespace-normalised (trim + collapse
// runs of whitespace to one space) exact-string comparison for the two
// verbatim-transcription cases, since a PDF round-trip through a vision
// model can plausibly introduce a line-wrap or trailing-space difference
// that isn't a real transcription failure; case and punctuation are NOT
// normalised away, since "verbatim" is the entire point of these two cases.
// ---------------------------------------------------------------------------

function normaliseForVerbatimCompare(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

export function scoreImagingEvalCase(
  caseCode: string,
  result: ImagingReportExtractionResult
): { pass: boolean; reasoning: string } {
  if (!result.ok) {
    return { pass: false, reasoning: `extraction did not complete: reason="${result.reason}"` };
  }
  const { extraction } = result;

  switch (caseCode) {
    case "normal_chest_xray_report": {
      const expected = "IMPRESSION: No acute cardiopulmonary abnormality.";
      const actual = normaliseForVerbatimCompare(extraction.impressionText ?? "");
      const verbatimMatch = actual === expected;
      const flagCorrect = extraction.impressionIndicatesFinding === false;
      return {
        pass: verbatimMatch && flagCorrect,
        reasoning:
          `impression_text=${JSON.stringify(extraction.impressionText)} (verbatim_match=${verbatimMatch}, expected=${JSON.stringify(expected)}); ` +
          `impression_indicates_finding=${extraction.impressionIndicatesFinding} (expected false)`,
      };
    }

    case "abnormal_report_explicit_finding": {
      const expected =
        "CONCLUSION: Right lower lobe consolidation, findings consistent with pneumonia. Clinical correlation advised.";
      const actual = normaliseForVerbatimCompare(extraction.impressionText ?? "");
      const verbatimMatch = actual === expected;
      const flagCorrect = extraction.impressionIndicatesFinding === true;
      return {
        pass: verbatimMatch && flagCorrect,
        reasoning:
          `impression_text=${JSON.stringify(extraction.impressionText)} (verbatim_match=${verbatimMatch}, expected=${JSON.stringify(expected)}); ` +
          `impression_indicates_finding=${extraction.impressionIndicatesFinding} (expected true)`,
      };
    }

    case "ambiguous_impression_defaults_flagged": {
      // No exact-text requirement -- the case is deliberately ambiguous.
      // The only thing under test is the bias_toward_flagged_on_ambiguity
      // guardrail: an ambiguous (not clearly normal) reading must default to
      // true, never false.
      const pass = extraction.impressionIndicatesFinding === true;
      return {
        pass,
        reasoning:
          `impression_text=${JSON.stringify(extraction.impressionText)}; ` +
          `impression_indicates_finding=${extraction.impressionIndicatesFinding} (expected true -- bias_toward_flagged_on_ambiguity guardrail)`,
      };
    }

    case "no_impression_section_present": {
      // The report has Findings but no Impression/Conclusion at all -- the
      // model must not invent one from the Findings text.
      const pass = extraction.impressionText === null;
      return {
        pass,
        reasoning:
          `impression_text=${JSON.stringify(extraction.impressionText)} (expected null -- must not invent an impression); ` +
          `unreadable_reason=${JSON.stringify(extraction.unreadableReason)}`,
      };
    }

    default:
      throw new Error(`No scoring logic for case_code "${caseCode}" -- add one before running.`);
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runImagingSuite(suite: EvalSuite): Promise<EvalSuiteResult> {
  const cases: EvalCaseOutcome[] = [];
  for (const c of suite.cases) {
    const bodyText = FIXTURE_REPORTS[c.case_code];
    if (!bodyText) {
      throw new Error(`No FIXTURE_REPORTS entry for case_code "${c.case_code}" -- add one before running.`);
    }
    const fileBase64 = await renderFixtureReportPdfBase64(bodyText);
    const result = await extractImagingReport({ fileBase64, mediaType: "application/pdf" });
    const { pass, reasoning } = scoreImagingEvalCase(c.case_code, result);
    console.log(`  ${pass ? "PASS" : "FAIL"} ${c.case_code}: ${reasoning}`);
    cases.push({
      case_id: c.id,
      case_code: c.case_code,
      outcome: pass ? "pass" : "fail",
      actual_output: reasoning,
    });
  }

  const passed = cases.filter((c) => c.outcome === "pass").length;
  const total = cases.length;
  const passRate = total === 0 ? 0 : (passed / total) * 100;
  return {
    suite_id: suite.id,
    suite_name: suite.name,
    pass_threshold_pct: suite.pass_threshold_pct,
    total_cases: total,
    passed_cases: passed,
    failed_cases: total - passed,
    outcome: passRate >= suite.pass_threshold_pct ? "pass" : "fail",
    cases,
  };
}

/**
 * Runs AI-016's one governance suite against the real extractImagingReport().
 * `onSuiteComplete` (optional) fires once the suite finishes -- same
 * contract as runAiCoachGovernanceSuites, so the admin console's server
 * action can write that suite's ai_evaluation_runs/ai_evaluation_case_results
 * rows the same way for either system.
 */
export async function runAiImagingReportEvalSuites(options?: {
  onSuiteComplete?: (result: EvalSuiteResult, context: { aiSystemId: string }) => Promise<void> | void;
}): Promise<{ aiSystemId: string; suites: EvalSuiteResult[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. This eval makes real model calls and needs it.");
  }

  const { aiSystemId, suite } = await loadAi016Suite();

  console.log(`\n=== ${suite.name} (${suite.cases.length} cases) ===`);
  const result = await runImagingSuite(suite);
  await options?.onSuiteComplete?.(result, { aiSystemId });

  return { aiSystemId, suites: [result] };
}
