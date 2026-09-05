import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { ClinicalRulesManager, type ClinicalRuleVersionRow } from "./clinical-rules-manager";

/**
 * Clinical Rules & Care Protocol Engine governance console (spec §32).
 *
 * §32.16's acceptance criteria: "Configurable logic -> governed deployment
 * -> explainable actions -> auditability -> rollback." This page is the
 * governed-deployment surface — a Clinical Director (or admin, for the
 * shadow step) reviews every version of every rule and drives its
 * lifecycle through the gated RPCs in
 * supabase/migrations/20260829093519_clinical_rules_engine_governance_rpcs.sql,
 * mirroring /admin/settings/escalation-slas and /admin/settings/alert-rules'
 * existing shape for the same kind of decision.
 *
 * Every rule fetched here is read straight from public.clinical_rules — no
 * separate "preview" representation — so what a Director reviews here is
 * exactly what the engine (apps/web/src/lib/clinical-rules/) will evaluate.
 */
export default async function ClinicalRulesSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: rules } = await supabase
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clinical Rules & Care Protocol Engine"
        description="Configurable clinical decision logic (spec §32): every rule below is data, versioned and governed, not a hardcoded threshold in application code. A new or edited rule always starts as a draft, moves to shadow (evaluated against real events, never acting on a patient) for validation, and only a signed, owned, protocol-linked version a Clinical Director activates can ever reach a patient. Every evaluation (including a rule that considered a patient and declined to act) is recorded and explainable; see each rule's shadow report before promoting it."
      />
      <ClinicalRulesManager rules={rows} />
    </div>
  );
}
