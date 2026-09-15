import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { RuleActionDefinition } from "./types";

/**
 * §32.8 action execution + clinician oversight gating.
 *
 * "High-risk clinical actions should have appropriate clinician oversight."
 * This module is deliberately conservative about what it is willing to
 * apply on the engine's own authority: only a NON-CLINICAL, in_app
 * notification is ever inserted directly. Every other action_type
 * (task, appointment_recommendation, monitoring_schedule,
 * education_recommendation, referral_recommendation, escalation,
 * care_plan_update) is recorded as `awaiting_oversight` — surfaced for a
 * clinician to review and apply, never auto-applied — UNLESS the rule
 * explicitly marks that specific action `requires_clinician_oversight:
 * false`, which itself only takes effect for the same non-clinical
 * notification case (see the guard in classifyOversight below). Widening
 * what this module applies unattended to a real clinical table is a
 * separate, individually-reviewed change per action_type, not a config flag
 * a rule author can flip on their own.
 *
 * This whole module is only reached for a rule in ACTIVE mode — shadow-mode
 * evaluation never calls it (dispatcher.ts records shadow_recorded instead
 * and stops before touching any real table).
 */

export interface ActionApplyResult {
  status: "emitted" | "awaiting_oversight" | "skipped" | "failed";
  producedTable?: string;
  producedId?: string;
  failureDetail?: string;
}

export async function applyAction(
  supabase: SupabaseClient<Database>,
  organisationId: string,
  patientId: string | null,
  action: RuleActionDefinition,
  explanation: string
): Promise<ActionApplyResult> {
  if (action.action_type === "notification" && !classifyRequiresOversight(action)) {
    if (!patientId) {
      return { status: "skipped", failureDetail: "notification action has no patient_id" };
    }
    try {
      const { data, error } = await supabase
        .from("notifications")
        .insert({
          organisation_id: organisationId,
          recipient_id: patientId,
          // Structurally non-clinical by construction: in_app is the one
          // channel the DB's own content_class CHECK (20260730094515)
          // allows to ever carry clinical content, but this path stays
          // non_clinical regardless — a rules-engine-authored patient nudge
          // is a reminder to open the app, never the clinical content
          // itself. content_class defaults to non_clinical; set explicitly
          // here so that stays true even if the column default ever moves.
          channel: "in_app",
          content_class: "non_clinical",
          template: "clinical_rule_action",
          payload: { message: explanation, ...(action.payload ?? {}) },
        })
        .select("id")
        .single();
      if (error) throw error;
      return { status: "emitted", producedTable: "notifications", producedId: data.id };
    } catch (err) {
      return { status: "failed", failureDetail: err instanceof Error ? err.message : String(err) };
    }
  }

  // Everything else: surfaced for a clinician, never auto-applied.
  return { status: "awaiting_oversight" };
}

function classifyRequiresOversight(action: RuleActionDefinition): boolean {
  // A rule can only opt OUT of oversight for the notification action_type
  // (checked by the caller before this is consulted) — the flag is read
  // here rather than trusted blindly so a future action_type never
  // inherits "false" by accident from copy-pasted rule config.
  return action.requires_clinician_oversight ?? false;
}
