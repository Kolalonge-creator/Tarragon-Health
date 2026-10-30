import { createClient } from "@/lib/supabase/server";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  AiSystemVersionCard,
  ClinicalAccuracyReviewSection,
  type AiClinicalAccuracyCaseRow,
  type AiSystemVersionRow,
} from "@/app/(dashboard)/admin/settings/ai-governance/ai-governance-console";
import { AiGuardrailApproval, AiKnowledgeSourceApproval, type AiApprovalItem } from "@/app/(dashboard)/admin/settings/ai-governance/ai-approval-list";
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

  const [versionsRes, casesRes, guardrailsRes, sourcesRes] = await Promise.all([
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
    supabase
      .from("ai_guardrails")
      .select("id, rule_code, kind, description, enforcement, config, ai_systems(name, system_code)")
      .eq("is_active", true)
      .is("approved_at", null)
      .order("ai_system_id")
      .order("rule_code"),
    supabase
      .from("ai_knowledge_sources")
      .select("id, title, source_type, citation_label, external_url, reference_table, ai_systems(name, system_code)")
      .eq("is_active", true)
      .is("approved_at", null)
      .order("title"),
  ]);

  if (versionsRes.error || casesRes.error || guardrailsRes.error || sourcesRes.error) {
    return <LoadFailure>AI governance sign-off items could not be loaded.</LoadFailure>;
  }

  const versions = (versionsRes.data ?? []) as unknown as (AiSystemVersionRow & {
    ai_systems: { name: string; system_code: string } | null;
  })[];
  const cases = (casesRes.data ?? []) as unknown as AiClinicalAccuracyCaseRow[];

  const guardrailsBySystem = new Map<string, { name: string; items: AiApprovalItem[] }>();
  for (const g of guardrailsRes.data ?? []) {
    const code = g.ai_systems?.system_code;
    if (!code) continue;
    const group = guardrailsBySystem.get(code) ?? { name: g.ai_systems?.name ?? code, items: [] };
    group.items.push({
      id: g.id,
      headline: g.rule_code,
      detail: g.description,
      meta: `${g.kind.replace(/_/g, " ")} · ${g.enforcement}${
        g.config && Object.keys(g.config as Record<string, unknown>).length > 0 ? ` · ${JSON.stringify(g.config)}` : ""
      }`,
    });
    guardrailsBySystem.set(code, group);
  }
  const sourceItems: AiApprovalItem[] = (sourcesRes.data ?? []).map((k) => ({
    id: k.id,
    headline: `${k.title} · ${k.ai_systems?.name ?? "all AI systems"}`,
    detail: `Patients are shown: "${k.citation_label}"`,
    meta: `${k.source_type.replace(/_/g, " ")}${k.external_url ? ` · ${k.external_url}` : k.reference_table ? ` · ${k.reference_table}` : ""}`,
  }));

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

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">AI guardrails awaiting your approval</h2>
        <p className="max-w-3xl text-sm text-charcoal-ink/70">
          These rules already apply to the AI systems. Approving the list for a system records that you have read every rule shown
          and stand behind it, under your name. If a rule is edited later, your approval on it is removed and it comes back here.
        </p>
        {guardrailsBySystem.size === 0 ? (
          <p className="text-sm text-charcoal-ink/60">Nothing waiting. Every active guardrail is approved.</p>
        ) : (
          <div className="space-y-6">
            {[...guardrailsBySystem.entries()].map(([code, g]) => (
              <AiGuardrailApproval key={code} systemCode={code} systemName={g.name} items={g.items} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">AI knowledge sources awaiting your approval</h2>
        <p className="max-w-3xl text-sm text-charcoal-ink/70">
          An AI answer can only cite a source you have approved. The line in quotes is what patients are shown.
        </p>
        {sourceItems.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">Nothing waiting. Every active knowledge source is approved.</p>
        ) : (
          <AiKnowledgeSourceApproval items={sourceItems} />
        )}
      </section>

      <ClinicalAccuracyReviewSection cases={cases} />
    </div>
  );
}
