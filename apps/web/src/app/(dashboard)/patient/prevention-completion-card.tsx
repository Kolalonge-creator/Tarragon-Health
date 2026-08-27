import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";
import {
  computePreventionCompletion,
  lifestyleCategoryStatus,
  PREVENTION_CATEGORY_LABEL,
  type PreventionCategory,
  type PreventionCategorySummary,
  type PreventionItem,
} from "@/lib/rules/prevention-completion";

/**
 * "My Preventive Care" completion checklist (spec §2.9/§2.12) — deliberately
 * NOT a single score. Sits directly under HealthScoreCard on the patient
 * dashboard as an addition to it, not a replacement: the Health Score stays
 * exactly as it is (a 0-100 non-diagnostic composite of a few specific
 * inputs), and this card answers a different question — "what preventive
 * care is outstanding, by area" — the way a checklist can and a single
 * number can't.
 */
async function resolvePreventionCompletion(patientId: string): Promise<PreventionCategorySummary[]> {
  const supabase = await createClient();

  const [screeningsResult, vaccinationsResult, latestResponseResult] = await Promise.all([
    supabase
      .from("screening_schedules")
      .select("status, screen_type:screen_types(category)")
      .eq("patient_id", patientId)
      .neq("status", "cancelled"),
    supabase
      .from("vaccination_schedules")
      .select("status")
      .eq("patient_id", patientId)
      .neq("status", "cancelled"),
    supabase
      .from("risk_assessment_responses")
      .select("created_at")
      .eq("profile_id", patientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const items: PreventionItem[] = [];
  for (const row of screeningsResult.data ?? []) {
    const category = (row.screen_type as { category: PreventionCategory | null } | null)?.category;
    items.push({ category: category ?? "general_health", status: row.status });
  }
  for (const row of vaccinationsResult.data ?? []) {
    items.push({ category: "vaccination", status: row.status });
  }

  const summaries = computePreventionCompletion(items);
  summaries.push(lifestyleCategoryStatus(latestResponseResult.data?.created_at ?? null));
  return summaries.sort((a, b) =>
    a.status === b.status ? 0 : a.status === "needs_attention" ? -1 : 1
  );
}

export async function PreventionCompletionCard({ patientId }: { patientId: string }) {
  const summaries = await resolvePreventionCompletion(patientId);
  if (summaries.length === 0) return null;

  const outstandingCount = summaries.filter((s) => s.status === "needs_attention").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your preventive care
        </CardTitle>
        <p className="text-sm text-charcoal-ink/60">
          {outstandingCount === 0
            ? "Everything below is up to date."
            : `${outstandingCount} ${outstandingCount === 1 ? "area needs" : "areas need"} attention.`}
        </p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {summaries.map((summary) => (
            <li key={summary.category} className="flex items-center justify-between gap-3 py-2.5">
              <Link href="/patient/prevention" className="text-sm text-charcoal-ink hover:underline">
                {PREVENTION_CATEGORY_LABEL[summary.category]}
              </Link>
              {summary.status === "complete" ? (
                <span className="shrink-0 text-sm font-medium text-brand-green" aria-label="Up to date">
                  ✓
                </span>
              ) : (
                <span
                  className="shrink-0 text-sm font-medium text-amber-600"
                  aria-label={`${summary.dueCount + summary.overdueCount} item(s) need attention`}
                >
                  {summary.overdueCount > 0 ? "! Overdue" : "! Due"}
                </span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
