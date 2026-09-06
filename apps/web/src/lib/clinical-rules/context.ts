import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { ageFromDateOfBirth } from "@tarragon/shared";
import type { ClinicalRuleEventRow, EvaluationContext, RuleWindowSpec } from "./types";
import { evaluateWindow } from "./window";

/**
 * Builds the flat context object population/conditions predicates are
 * evaluated against (§32.3's "population" and "conditions"). Derived fresh
 * from the database at evaluation time rather than trusting the event's own
 * payload snapshot for anything about the PATIENT (only the event's own
 * facts — the reading, the result — come from the payload) — a patient's
 * age, active conditions or plan can have changed between when an event was
 * queued and when it is evaluated, and population rules must see the
 * current state, not a stale one.
 *
 * Field naming: patient/profile fields are flat (`age`, `sex`,
 * `has_condition_hypertension`); the event's own payload is namespaced
 * under `event.*` so two different event_types can reuse a field name
 * (`event.systolic`) without colliding with a population field.
 */
export async function buildEvaluationContext(
  supabase: SupabaseClient<Database>,
  event: ClinicalRuleEventRow,
  window?: RuleWindowSpec
): Promise<EvaluationContext> {
  const context: EvaluationContext = {
    event_type: event.event_type,
    organisation_id: event.organisation_id,
  };

  for (const [key, value] of Object.entries(event.payload as Record<string, unknown>)) {
    context[`event.${key}`] = value;
  }

  if (event.patient_id) {
    const [{ data: profile }, { data: carePlans }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, sex, date_of_birth, is_pregnant, receives_care, state")
        .eq("id", event.patient_id)
        .maybeSingle(),
      supabase
        .from("care_plans")
        .select("condition, status")
        .eq("patient_id", event.patient_id)
        .eq("status", "active"),
    ]);

    if (profile) {
      context.patient_id = profile.id;
      context.sex = profile.sex;
      context.age = ageFromDateOfBirth(profile.date_of_birth);
      context.is_pregnant = profile.is_pregnant;
      context.receives_care = profile.receives_care;
      context.state = profile.state;
    }

    const activeConditions = (carePlans ?? []).map((c) => c.condition);
    context.active_conditions = activeConditions;
    for (const condition of activeConditions) {
      context[`has_condition_${condition}`] = true;
    }

    if (window) {
      const count = await evaluateWindow(supabase, event.patient_id, window);
      context["window.count"] = count;
      context["window.supported"] = count !== null;
    }
  }

  return context;
}
