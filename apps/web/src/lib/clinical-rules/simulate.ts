import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { evaluatePredicate } from "@/lib/rules/predicate";
import { buildEvaluationContext } from "./context";
import { renderExplanation } from "./explain";
import type { ClinicalRuleEventRow, ParsedClinicalRule } from "./types";

/**
 * §32.12 simulation: "what would this rule have done to the last N
 * patients?" — run BEFORE a draft rule is even promoted to shadow, using
 * clinical_rule_events history that has already accumulated from the part-4
 * emitters (every vital reading, screening result, etc. logged since those
 * triggers went live). Deliberately read-only and side-effect-free: it
 * never writes to clinical_rule_executions/action_records (those tables
 * only ever record a REAL evaluation run by the worker) and never touches
 * suppression state, so running a simulation ten times over while tuning a
 * threshold costs nothing and leaves no trace.
 *
 * This intentionally reuses the same population/conditions evaluation the
 * real dispatcher uses (evaluatePredicate + buildEvaluationContext) rather
 * than a parallel simulation-only implementation — the whole point of a
 * simulation is that it predicts what the real engine will do, which is
 * only true if it runs the identical logic.
 */
export interface SimulationSummary {
  ruleKey: string;
  eventsConsidered: number;
  wouldHaveFired: number;
  conditionsNotMet: number;
  outOfPopulation: number;
  distinctPatientsAffected: number;
  sampleExplanations: string[];
}

export async function simulateRule(
  supabase: SupabaseClient<Database>,
  rule: ParsedClinicalRule,
  options: { organisationId: string; sinceDays?: number; limit?: number } = { organisationId: "" }
): Promise<SimulationSummary> {
  const since = new Date(Date.now() - (options.sinceDays ?? 90) * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from("clinical_rule_events")
    .select("*")
    .eq("event_type", rule.event_type)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(options.limit ?? 5000);

  if (options.organisationId) {
    query = query.eq("organisation_id", options.organisationId);
  }
  if (rule.organisation_id) {
    query = query.eq("organisation_id", rule.organisation_id);
  }
  if (rule.patient_id) {
    query = query.eq("patient_id", rule.patient_id);
  }

  const { data: events, error } = await query;
  if (error) throw error;

  let wouldHaveFired = 0;
  let conditionsNotMet = 0;
  let outOfPopulation = 0;
  const affectedPatients = new Set<string>();
  const sampleExplanations: string[] = [];

  for (const event of (events ?? []) as ClinicalRuleEventRow[]) {
    const context = await buildEvaluationContext(supabase, event, rule.conditions.window);
    const populationMatches = evaluatePredicate(rule.population, context);
    if (!populationMatches) {
      outOfPopulation += 1;
      continue;
    }
    const conditionsMatch = evaluatePredicate(rule.conditions.predicate ?? { op: "true" }, context);
    if (!conditionsMatch) {
      conditionsNotMet += 1;
      continue;
    }

    wouldHaveFired += 1;
    if (event.patient_id) affectedPatients.add(event.patient_id);
    if (sampleExplanations.length < 5) {
      sampleExplanations.push(
        renderExplanation(rule.explanation_template, {
          ...context,
          rule: { key: rule.rule_key, name: rule.name, version: rule.version },
          window: {
            count: context["window.count"],
            threshold: rule.conditions.window?.threshold,
            days: rule.conditions.window?.days,
          },
        })
      );
    }
  }

  return {
    ruleKey: rule.rule_key,
    eventsConsidered: events?.length ?? 0,
    wouldHaveFired,
    conditionsNotMet,
    outOfPopulation,
    distinctPatientsAffected: affectedPatients.size,
    sampleExplanations,
  };
}
