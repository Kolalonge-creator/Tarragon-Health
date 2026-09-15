import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import { evaluatePredicate } from "@/lib/rules/predicate";
import { applyAction } from "./actions";
import { buildEvaluationContext } from "./context";
import { resolveConflicts } from "./conflict";
import { renderExplanation } from "./explain";
import { parseClinicalRule } from "./parse";
import { buildEpisodeKey, buildSuppressionKey, findActiveSuppression, recordSuppressionAfterFire } from "./suppression";
import type { ClinicalRuleEventRow, ClinicalRuleRow, EvaluationContext, EvaluationResult, ParsedClinicalRule } from "./types";

/**
 * §32.6: EVENT -> matching rules -> evaluate conditions -> action. This is
 * that pipeline's implementation. `dispatchEvent` is the entry point used by
 * both the real worker (worker.ts, writes durable rows) and the simulator
 * (simulate.ts, pure/read-only) — the actual evaluation logic
 * (`evaluateOneRule`) is shared so a simulation can never disagree with what
 * the real worker would have done.
 */

/**
 * Fetches every candidate rule for this event via the DB's
 * clinical_rule_candidates RPC (the single source of truth for candidate
 * selection — see that function's own comment) and evaluates each,
 * resolving §32.9 conflicts among the ones that would act.
 */
export async function evaluateEvent(
  supabase: SupabaseClient<Database>,
  event: ClinicalRuleEventRow
): Promise<EvaluationResult[]> {
  const { data: candidateJson, error } = await supabase.rpc("clinical_rule_candidates", {
    p_event_type: event.event_type,
    p_organisation_id: event.organisation_id,
    p_patient_id: event.patient_id ?? undefined,
    p_at: event.occurred_at,
    p_include_shadow: true,
  });
  if (error) throw error;

  const rows = (candidateJson ?? []) as unknown as ClinicalRuleRow[];
  const rules = rows.map(parseClinicalRule);

  // Evaluate population + conditions for every candidate first (each rule
  // needs its own window aggregate, since different rules can name
  // different window specs), THEN resolve conflicts only among the ones
  // that actually matched -- a rule whose population/conditions didn't
  // match was never really competing for anything.
  const evaluated: Array<{ rule: ParsedClinicalRule; context: EvaluationContext; wouldAct: boolean }> = [];
  for (const rule of rules) {
    const context = await buildEvaluationContext(supabase, event, rule.conditions.window);
    const populationMatches = evaluatePredicate(rule.population, context);
    const conditionsMatch = populationMatches
      ? evaluatePredicate(rule.conditions.predicate ?? { op: "true" }, context)
      : false;
    evaluated.push({ rule, context, wouldAct: populationMatches && conditionsMatch });
  }

  const { winners, losers } = resolveConflicts(evaluated.filter((e) => e.wouldAct).map((e) => e.rule));
  const winnerIds = new Set(winners.map((r) => r.id));

  const results: EvaluationResult[] = [];

  for (const { rule, context, wouldAct } of evaluated) {
    if (!wouldAct) {
      const populationMatches = evaluatePredicate(rule.population, context);
      results.push({
        rule,
        outcome: populationMatches ? "conditions_not_met" : "population_not_matched",
        explanation: renderNegativeExplanation(rule, context, populationMatches),
        context,
        actions: [],
      });
      continue;
    }

    if (losers.has(rule.id)) {
      const winner = losers.get(rule.id)!;
      results.push({
        rule,
        outcome: "superseded",
        supersededByRuleId: winner.id,
        explanation: `${rule.name} would have acted, but ${winner.name} (rule_key ${winner.rule_key}) is more specific/higher priority for the same action and took precedence (§32.9).`,
        context,
        actions: [],
      });
      continue;
    }

    if (!winnerIds.has(rule.id)) {
      // Defensive: should be unreachable (every wouldAct rule is either a
      // winner or a recorded loser), but never silently drop a match.
      const detail = `${rule.name} (rule_key ${rule.rule_key}) matched but was not resolved by conflict resolution -- this is an engine bug, not a clinical decision.`;
      results.push({
        rule,
        outcome: "error",
        explanation: detail,
        errorDetail: detail,
        context,
        actions: [],
      });
      continue;
    }

    const explanation = renderExplanation(rule.explanation_template, buildFacts(rule, context));

    if (rule.status === "shadow") {
      results.push({ rule, outcome: "shadow_recorded", explanation, context, actions: rule.actions });
      continue;
    }

    // status === 'active' from here. Check suppression before committing to
    // act -- a suppressed rule is still "matched", just held back (§32.10).
    if (event.patient_id) {
      const suppressionKey = buildSuppressionKey(rule, event.patient_id, context);
      const episodeKey = buildEpisodeKey(rule, event.patient_id, context);
      const suppression = await findActiveSuppression(supabase, rule, event.patient_id, suppressionKey, episodeKey);
      if (suppression) {
        results.push({
          rule,
          outcome: "suppressed",
          suppressedBy: suppression.mechanism,
          explanation: `${explanation} (Suppressed: ${suppression.reason})`,
          context,
          actions: [],
        });
        continue;
      }
    }

    results.push({ rule, outcome: "actions_emitted", explanation, context, actions: rule.actions });
  }

  return results;
}

function buildFacts(rule: ParsedClinicalRule, context: EvaluationContext): Record<string, unknown> {
  return {
    ...context,
    rule: { key: rule.rule_key, name: rule.name, version: rule.version },
    window: {
      count: context["window.count"],
      threshold: rule.conditions.window?.threshold,
      days: rule.conditions.window?.days,
      comparator: rule.conditions.window?.comparator,
      vital_type: rule.conditions.window?.vital_type,
    },
  };
}

function renderNegativeExplanation(
  rule: ParsedClinicalRule,
  context: EvaluationContext,
  populationMatched: boolean
): string {
  if (!populationMatched) {
    return `${rule.name}: this patient is outside the rule's population (§32.3) for this event.`;
  }
  return renderExplanation(
    `${rule.name}: conditions were evaluated and not met -- window.count={{window.count}}` +
      (rule.conditions.window ? `, threshold={{window.threshold}} over {{window.days}} days.` : "."),
    buildFacts(rule, context)
  );
}

/**
 * Persists one evaluateEvent() result set as clinical_rule_executions (+
 * clinical_rule_action_records for anything that actually/would-have acted)
 * and, for a real active-mode fire, applies the action and records
 * suppression state. Called only by the real worker -- the simulator uses
 * evaluateEvent() directly without ever calling this, so a simulation never
 * writes a durable row.
 */
export async function persistAndApply(
  supabase: SupabaseClient<Database>,
  event: ClinicalRuleEventRow,
  results: EvaluationResult[]
): Promise<void> {
  for (const result of results) {
    const mode = result.rule.status === "shadow" ? "shadow" : "active";

    const { data: executionRow, error: executionError } = await supabase
      .from("clinical_rule_executions")
      .insert({
        organisation_id: event.organisation_id,
        event_id: event.id,
        rule_id: result.rule.id,
        rule_key: result.rule.rule_key,
        rule_version: result.rule.version,
        patient_id: event.patient_id,
        mode,
        outcome: result.outcome,
        superseded_by_rule_id: result.supersededByRuleId ?? null,
        suppressed_by: result.suppressedBy ?? null,
        explanation: result.explanation,
        error_detail: result.errorDetail ?? null,
        evaluation_trace: { context: result.context } as unknown as Json,
      })
      .select("id")
      .single();

    if (executionError) {
      // A duplicate (event_id, rule_id) pair means this event was already
      // evaluated for this rule -- the worker's own idempotency guard
      // (unique constraint, part 2). Not an error worth surfacing per-row;
      // move on to the next rule.
      if (executionError.code === "23505") continue;
      throw executionError;
    }

    for (const action of result.actions) {
      if (result.outcome === "shadow_recorded") {
        await supabase.from("clinical_rule_action_records").insert({
          organisation_id: event.organisation_id,
          execution_id: executionRow.id,
          rule_id: result.rule.id,
          rule_key: result.rule.rule_key,
          patient_id: event.patient_id,
          action_type: action.action_type,
          action_payload: (action.payload ?? {}) as unknown as Json,
          status: "shadow_recorded",
          requires_clinician_oversight: action.requires_clinician_oversight ?? true,
        });
        continue;
      }

      if (result.outcome !== "actions_emitted") continue;

      const applied = await applyAction(supabase, event.organisation_id, event.patient_id, action, result.explanation);
      await supabase.from("clinical_rule_action_records").insert({
        organisation_id: event.organisation_id,
        execution_id: executionRow.id,
        rule_id: result.rule.id,
        rule_key: result.rule.rule_key,
        patient_id: event.patient_id,
        action_type: action.action_type,
        action_payload: (action.payload ?? {}) as unknown as Json,
        status: applied.status,
        requires_clinician_oversight: applied.status === "awaiting_oversight",
        produced_table: applied.producedTable ?? null,
        produced_id: applied.producedId ?? null,
        failure_detail: applied.failureDetail ?? null,
      });
    }

    if (result.outcome === "actions_emitted" && event.patient_id) {
      const suppressionKey = buildSuppressionKey(result.rule, event.patient_id, result.context);
      const episodeKey = buildEpisodeKey(result.rule, event.patient_id, result.context);
      await recordSuppressionAfterFire(
        supabase,
        event.organisation_id,
        result.rule,
        event.patient_id,
        suppressionKey,
        episodeKey
      );
    }
  }
}
