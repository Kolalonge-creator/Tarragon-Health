import { createClient } from "@/lib/supabase/server";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  AiSystemVersionCard,
  ClinicalAccuracyReviewSection,
  type AiClinicalAccuracyCaseRow,
  type AiSystemVersionRow,
} from "@/app/(dashboard)/admin/settings/ai-governance/ai-governance-console";
import {
  AI_SYSTEM_VERSION_COLUMNS,
  AI_EVALUATION_CASE_COLUMNS,
} from "@/app/(dashboard)/admin/settings/ai-governance/ai-governance-columns";

/**
 * The two AI governance actions only an active Chief Medical Officer can close
 * (approving an AI system version, recording an independent tier judgement on a
 * clinical-accuracy scenario). Shared by /clinician/ai-governance and the
 * sign-off hub, which opens it inline. Access is gated by the page that renders it.
 */
export async function AiGovernancePanel() {
  const supabase = await createClient();

  const [versionsRes, casesRes] = await Promise.all([
    supabase
      .from("ai_system_versions")
      // Same column list the admin console's page.tsx queries
      // (AI_SYSTEM_VERSION_COLUMNS), plus the ai_systems join this page needs
      // for the system-name header the console instead builds from its own
      // separate systemById map.
      .select(`${AI_SYSTEM_VERSION_COLUMNS}, ai_systems(name, system_code)`)
      .is("approved_at", null)
      .is("retired_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("ai_evaluation_cases")
      .select(AI_EVALUATION_CASE_COLUMNS)
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
    <div className="space-y-8">
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
