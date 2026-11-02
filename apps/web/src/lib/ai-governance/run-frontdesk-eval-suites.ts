/**
 * Runs AI-023's governance suites against the real website-receptionist model call (frontdesk/receptionist.ts), with the approved-knowledge prompt
 * and the output guard the product applies, and returns real, measured results:
 *  - "AI-023 website receptionist golden questions": the 68 model-routed cases of the 150-message evaluation set plus three adversarial probes
 *    sent straight to the model. Scored by frontdesk/eval/probes.ts. Any unsafe reply fails the whole suite, whatever the percentage.
 *  - the shared "Platform AI safety baseline" suite's AI-023 pair, evidenced by results the dedicated suite already produced (no extra model call).
 *
 * Same division of responsibility as run-coach-eval-suites.ts: this reads the suite definitions and returns results; the admin console's server
 * action records the runs. It writes nothing, approves nothing, and sends only the synthetic visitor messages in the eval set, never patient data.
 * Two deliberate departures, both noted for the reviewer: (1) the model is called through callReceptionistModel directly, not runGovernedAi,
 * because AI-023 is disabled until this very run passes and the governed path would refuse; the console action records the run and its cost
 * instead. (2) The knowledge text is the fixed fixture in eval/cases.ts, so re-run this after any approved wording changes.
 * Needs ANTHROPIC_API_KEY. About 71 model calls on claude-haiku-4-5 per full run, well under one dollar.
 */
import { callReceptionistModel } from "../frontdesk/receptionist";
import { EVAL_CASES, EVAL_KNOWLEDGE } from "../frontdesk/eval/cases";
import type { ReceptionistAnswer } from "../frontdesk/types";
import {
  ADVERSARIAL_PROBES,
  dbCaseCode,
  mapWithConcurrency,
  BASELINE_CASE_SOURCE,
  scoreAdversarialProbe,
  scoreModelCase,
  suiteOutcome,
  type CaseScore,
} from "../frontdesk/eval/probes";
import { createServiceRoleClient } from "../supabase/service-role";
import type { EvalCaseOutcome, EvalSuite, EvalSuiteCase, EvalSuiteResult } from "./run-coach-eval-suites";

export const SUITE_NAME = "AI-023 website receptionist golden questions";
const BASELINE_SUITE_NAME = "Platform AI safety baseline";
const LAUNCH_DATE = "31 December 2026";
const CONCURRENCY = 8;


async function loadSuites(): Promise<{ aiSystemId: string; suite: EvalSuite; baseline: EvalSuite | null; modelId: string }> {
  const db = createServiceRoleClient();
  const { data: system, error: systemError } = await db.from("ai_systems").select("id").eq("system_code", "AI-023").single();
  if (systemError || !system) throw new Error(`Could not load AI-023 from ai_systems: ${systemError?.message ?? "not found"}`);
  const aiSystemId = system.id as string;

  const { data: version } = await db
    .from("ai_system_versions")
    .select("model_identifier")
    .eq("ai_system_id", aiSystemId)
    .is("retired_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const modelId = (version?.model_identifier as string | undefined) ?? "claude-haiku-4-5";

  const { data: suiteRow, error: suiteError } = await db
    .from("ai_evaluation_suites")
    .select("id, pass_threshold_pct")
    .eq("name", SUITE_NAME)
    .eq("ai_system_id", aiSystemId)
    .single();
  if (suiteError || !suiteRow) throw new Error(`Could not load suite "${SUITE_NAME}": ${suiteError?.message ?? "not found"}`);

  const { data: caseRows, error: caseError } = await db
    .from("ai_evaluation_cases")
    .select("id, case_code, scenario, expected_behaviour, population_group, expected_tier")
    .eq("suite_id", suiteRow.id as string)
    .order("case_code");
  if (caseError) throw new Error(`Could not load cases for suite "${SUITE_NAME}": ${caseError.message}`);

  const suite: EvalSuite = {
    id: suiteRow.id as string,
    name: SUITE_NAME,
    pass_threshold_pct: Number(suiteRow.pass_threshold_pct),
    cases: (caseRows ?? []) as EvalSuiteCase[],
  };

  const { data: baseRow, error: baseRowError } = await db
    .from("ai_evaluation_suites")
    .select("id, pass_threshold_pct")
    .eq("name", BASELINE_SUITE_NAME)
    .is("ai_system_id", null)
    .maybeSingle();
  if (baseRowError) throw new Error(`Could not load suite "${BASELINE_SUITE_NAME}": ${baseRowError.message}`);
  let baseline: EvalSuite | null = null;
  if (baseRow) {
    const { data: baseCases, error: baseError } = await db
      .from("ai_evaluation_cases")
      .select("id, case_code, scenario, expected_behaviour, population_group, expected_tier")
      .eq("suite_id", baseRow.id as string)
      .in("case_code", Object.keys(BASELINE_CASE_SOURCE))
      .order("case_code");
    if (baseError) throw new Error(`Could not load AI-023's cases for suite "${BASELINE_SUITE_NAME}": ${baseError.message}`);
    if (baseCases && baseCases.length > 0) {
      baseline = {
        id: baseRow.id as string,
        name: BASELINE_SUITE_NAME,
        pass_threshold_pct: Number(baseRow.pass_threshold_pct),
        cases: baseCases as EvalSuiteCase[],
      };
    }
  }
  return { aiSystemId, suite, baseline, modelId };
}

function toResult(suite: EvalSuite, outcomes: EvalCaseOutcome[], scores: CaseScore[]): EvalSuiteResult {
  const passed = outcomes.filter((c) => c.outcome === "pass").length;
  return {
    suite_id: suite.id,
    suite_name: suite.name,
    pass_threshold_pct: suite.pass_threshold_pct,
    total_cases: outcomes.length,
    passed_cases: passed,
    failed_cases: outcomes.length - passed,
    outcome: suiteOutcome(scores, suite.pass_threshold_pct),
    cases: outcomes,
  };
}

async function runDedicatedSuite(
  suite: EvalSuite,
  modelId: string,
): Promise<{ result: EvalSuiteResult; scoreByCase: Record<string, CaseScore> }> {
  const evalById = new Map(EVAL_CASES.map((c) => [dbCaseCode(c.id), c]));
  const probeByCode = new Map(ADVERSARIAL_PROBES.map((p) => [p.caseCode, p]));
  const scoreByCase: Record<string, CaseScore> = {};

  // Calls run a few at a time: 71 serial calls take far longer than the console page's 300 second limit and a timeout would lose the whole run.
  const results = await mapWithConcurrency(suite.cases, CONCURRENCY, async (c) => {
    const evalCase = evalById.get(c.case_code);
    const probe = probeByCode.get(c.case_code);
    if (!evalCase && !probe) throw new Error(`No evaluation input for case_code "${c.case_code}" -- add one before running.`);
    const input = (evalCase?.input ?? probe!.input) as string;
    const answer: ReceptionistAnswer = await callReceptionistModel({
      history: [{ role: "visitor", content: input }],
      knowledge: EVAL_KNOWLEDGE,
      prelaunch: true,
      launchDate: LAUNCH_DATE,
      modelId,
    });
    const score = evalCase ? scoreModelCase(evalCase, answer) : scoreAdversarialProbe(c.case_code, answer);
    console.log(`  ${score.unsafe ? "UNSAFE" : score.pass ? "PASS" : "FAIL"} ${c.case_code}: ${score.note}`);
    const outcome: EvalCaseOutcome = {
      case_id: c.id,
      case_code: c.case_code,
      outcome: score.pass ? "pass" : "fail",
      actual_output: `${score.unsafe ? "UNSAFE: " : ""}${score.note}. Reply: ${answer.reply}`.slice(0, 1500),
    };
    return { score, outcome };
  });
  const outcomes = results.map((x) => x.outcome);
  const scores = results.map((x) => x.score);
  suite.cases.forEach((c, i) => {
    scoreByCase[c.case_code] = scores[i]!;
  });
  return { result: toResult(suite, outcomes, scores), scoreByCase };
}

/** Scores the baseline pair against results the dedicated suite already produced. Throws if the evidence case is missing. */
export function scoreBaseline(suite: EvalSuite, scoreByCase: Record<string, CaseScore>): EvalSuiteResult {
  const scores: CaseScore[] = [];
  const outcomes: EvalCaseOutcome[] = suite.cases.map((c) => {
    const source = BASELINE_CASE_SOURCE[c.case_code];
    const evidence = source ? scoreByCase[source] : undefined;
    if (!source || !evidence) {
      throw new Error(`No dedicated-suite evidence for baseline case_code "${c.case_code}" -- add it to BASELINE_CASE_SOURCE before running.`);
    }
    // The baseline suite is about safety: it passes when the evidencing reply was not unsafe.
    const score: CaseScore = { pass: !evidence.unsafe, unsafe: evidence.unsafe, note: `(reusing ${source}'s result) ${evidence.note}` };
    scores.push(score);
    return { case_id: c.id, case_code: c.case_code, outcome: score.pass ? "pass" : "fail", actual_output: score.note };
  });
  return toResult(suite, outcomes, scores);
}

export async function runAiFrontDeskEvalSuites(options?: {
  onSuiteComplete?: (result: EvalSuiteResult, context: { aiSystemId: string }) => Promise<void> | void;
}): Promise<{ aiSystemId: string; suites: EvalSuiteResult[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. This eval makes real model calls and needs it.");
  }
  const { aiSystemId, suite, baseline, modelId } = await loadSuites();

  console.log(`\n=== ${suite.name} (${suite.cases.length} cases, model ${modelId}) ===`);
  const { result, scoreByCase } = await runDedicatedSuite(suite, modelId);
  await options?.onSuiteComplete?.(result, { aiSystemId });
  const suites = [result];

  if (baseline) {
    console.log(`\n=== ${baseline.name} (AI-023's ${baseline.cases.length} cases) ===`);
    const baselineResult = scoreBaseline(baseline, scoreByCase);
    await options?.onSuiteComplete?.(baselineResult, { aiSystemId });
    suites.push(baselineResult);
  }
  return { aiSystemId, suites };
}
