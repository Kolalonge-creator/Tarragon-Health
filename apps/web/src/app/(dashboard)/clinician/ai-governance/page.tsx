import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  AiSystemVersionCard,
  ClinicalAccuracyReviewSection,
  type AiClinicalAccuracyCaseRow,
  type AiSystemVersionRow,
} from "@/app/(dashboard)/admin/settings/ai-governance/ai-governance-console";

export const metadata = { title: "AI governance sign-off" };

/**
 * The Chief Medical Officer / Clinical Director's own reachable path to the
 * two pieces of AI governance work only they can close — approving an
 * `ai_system_versions` row, and recording an independent tier judgement on
 * an `ai_evaluation_cases` clinical-accuracy scenario. Mirrors
 * /clinician/clinical-signoff's pattern exactly (see that page's own
 * comment): `admin/settings/ai-governance/page.tsx` is gated on the
 * `ai_governance.manage` permission key, but proxy.ts's `/admin/*` gate
 * refuses a plain `clinician` login before that page would even load unless
 * the account holds an explicit delegated grant — so a real CMO (account
 * role always `clinician`, per CLAUDE.md's "never re-split the account
 * role" rule) had no way to even see this work existed, let alone act on
 * it, despite the admin dashboard's own welcome banner naming it "real,
 * time-sensitive work sitting on a Chief Medical Officer's desk."
 *
 * Deliberately scoped to just the two sign-off actions the admin welcome
 * banner flags — not a second copy of the full console (kill switch,
 * incident triage, prompt activation, monitoring dashboard), which stays
 * admin-only for now. `readPendingAiGovernanceSignoff` is the shared count
 * both this page and that banner read, so they can never disagree.
 */
export default async function ClinicianAiGovernancePage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }

  const supabase = await createClient();

  const [versionsRes, casesRes] = await Promise.all([
    supabase
      .from("ai_system_versions")
      .select(
        "id, ai_system_id, version, model_identifier, intended_population, excluded_population, validation_summary, validation_completed_at, approved_at, deployed_at, retired_at, review_due_on, change_summary, created_at, validated_by_staff:clinical_staff!ai_system_versions_validated_by_fkey(full_name), approved_by_staff:clinical_staff!ai_system_versions_approved_by_fkey(full_name), ai_systems(name, system_code)"
      )
      .is("approved_at", null)
      .is("retired_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("ai_evaluation_cases")
      .select(
        "id, suite_id, case_code, scenario, expected_tier, labeled_at, label_rationale, ai_evaluation_suites!inner(name, kind, ai_system_id), labeled_by_staff:clinical_staff!ai_evaluation_cases_labeled_by_fkey(full_name)"
      )
      .eq("ai_evaluation_suites.kind", "clinical")
      .is("expected_tier", null)
      .order("case_code"),
  ]);

  if (versionsRes.error || casesRes.error) {
    return <LoadFailure>AI governance sign-off items could not be loaded.</LoadFailure>;
  }

  const versions = (versionsRes.data ?? []) as unknown as (AiSystemVersionRow & {
    ai_systems: { name: string; system_code: string } | null;
  })[];
  const cases = (casesRes.data ?? []) as unknown as AiClinicalAccuracyCaseRow[];

  return (
    <div className="space-y-8 p-6">
      <div>
        <h1 className="text-xl font-semibold text-charcoal-ink">AI governance sign-off</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">
          Everything the platform&apos;s AI systems owe your signature or your independent clinical
          judgement before they can be called validated. Kill-switch control, incident triage, and
          the full monitoring dashboard stay on the admin console; this page is only the two actions
          that need an active Chief Medical Officer specifically.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
          AI system versions awaiting your approval
        </h2>
        {versions.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">Nothing waiting — every registered version is approved.</p>
        ) : (
          <div className="space-y-4">
            {versions.map((v) => (
              <div key={v.id} className="space-y-1">
                <p className="text-sm font-medium text-charcoal-ink/80">
                  {v.ai_systems?.name ?? v.ai_system_id}
                  {v.ai_systems?.system_code && (
                    <span className="font-mono text-xs text-charcoal-ink/50"> · {v.ai_systems.system_code}</span>
                  )}
                </p>
                <AiSystemVersionCard version={v} />
              </div>
            ))}
          </div>
        )}
      </section>

      <ClinicalAccuracyReviewSection cases={cases} />
    </div>
  );
}
