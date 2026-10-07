import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  ClinicalRulesManager,
  type ClinicalRuleVersionRow,
} from "@/app/(dashboard)/admin/settings/clinical-rules/clinical-rules-manager";

/**
 * The Chief Medical Officer / Clinical Director's own reachable path to the
 * Clinical Rules & Care Protocol Engine governance console (spec §32).
 * Mirrors /clinician/protocols and /clinician/triage-protocols' pattern
 * exactly: `admin/settings/clinical-rules/page.tsx` hard-redirects anyone
 * whose `profiles.role !== "admin"`, and proxy.ts's /admin/* gate refuses a
 * plain `clinician` login before that page would even load — so a real CMO
 * (account role always `clinician`) could not reach this at all, even
 * though sign_clinical_rule (the RPC that actually activates a rule) has
 * always been Clinical-Director-only, never admin. Found 2026-09-22, same
 * audit that also found clinical_rules_insert was admin-only RLS with no
 * CMO fallback — fixed in
 * 20260922193255_cmo_clinical_rules_insert_dual_gate.sql, which this page
 * depends on for the "assign owner & link protocol" form to work.
 *
 * Reuses ClinicalRulesManager as-is (its own draft/promote/sign/rollback/
 * retire actions live in admin/settings/clinical-rules/actions.ts, which
 * already carried no app-layer role check at all — each relies entirely on
 * its own RPC or the RLS insert policy above to gate who may act).
 */
export default async function ClinicianClinicalRulesPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }

  const supabase = await createClient();
  const { data: rules, error: rulesError } = await supabase
    .from("clinical_rules")
    .select(
      `id, rule_key, version, name, description, category, domain, event_type,
       population, conditions, actions, priority, specificity, escalation,
       suppression, explanation_template, status, effective_from, effective_to,
       owner_clinical_staff_id, protocol_version_id, organisation_id, patient_id,
       approved_by, approved_at, activated_at, retired_at, retired_reason,
       rolled_back_at, rollback_reason, notes, created_at`
    )
    .order("rule_key", { ascending: true })
    .order("version", { ascending: false });

  const rows = (rules as ClinicalRuleVersionRow[] | null) ?? [];

  const { data: staffOptions, error: staffError } = await supabase
    .from("clinical_staff")
    .select("id, full_name, doctor_tier")
    .eq("active", true)
    .order("full_name", { ascending: true });
  const { data: protocols, error: protocolsError } = await supabase
    .from("protocol_versions")
    .select("id, protocol_id, title, version_number")
    .not("approved_by", "is", null)
    .order("protocol_id", { ascending: true })
    .order("version_number", { ascending: false });
  const pickersFailed = Boolean(staffError || protocolsError);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clinical Rules & Care Protocol Engine"
        description="Configurable clinical decision logic (spec §32): every rule below is data, versioned and governed, not a hardcoded threshold in application code. A new or edited rule always starts as a draft, moves to shadow (evaluated against real events, never acting on a patient) for validation, and only a signed, owned, protocol-linked version a Clinical Director activates can ever reach a patient. Every evaluation (including a rule that considered a patient and declined to act) is recorded and explainable; see each rule's shadow report before promoting it."
      />
      {rulesError ? (
        <LoadFailure>
          The clinical rules could not be loaded. This is not a report that no rules exist or that
          none are active. Do not draft or activate a rule from here until it loads.
        </LoadFailure>
      ) : (
        <>
          {pickersFailed && (
            <LoadFailure>
              The owner/protocol picker lists could not be fully loaded. If the &ldquo;assign owner
              &amp; link protocol&rdquo; form below shows no options, that is a failed read, not
              proof none exist — reload before assuming a rule has nothing to link to.
            </LoadFailure>
          )}
          <ClinicalRulesManager
            rules={rows}
            clinicalStaff={staffOptions ?? []}
            signedProtocols={protocols ?? []}
            basePath="/clinician"
          />
        </>
      )}
    </div>
  );
}
