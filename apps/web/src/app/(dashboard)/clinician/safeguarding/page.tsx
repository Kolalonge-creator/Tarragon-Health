import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canReviewSafeguardingConcern } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResolveSafeguardingConcernForm } from "./resolve-form";

const CONCERN_TYPE_LABEL: Record<string, string> = {
  abuse: "Abuse",
  neglect: "Neglect",
  exploitation: "Exploitation",
  self_harm: "Self-harm",
  immediate_danger: "Immediate danger",
  other: "Other / needs triage",
};

const STATUS_BADGE: Record<string, { label: string; variant: "amber" | "grey" | "green" | "red" }> = {
  open: { label: "Open", variant: "red" },
  under_review: { label: "Under review", variant: "amber" },
  escalated_external: { label: "Escalated externally", variant: "amber" },
  resolved: { label: "Resolved", variant: "green" },
  closed_no_action: { label: "Closed, no action", variant: "grey" },
};

/**
 * Safeguarding worklist (spec §49.11). Deliberately the ONLY surface that
 * can read safeguarding_concerns — its RLS never admits the patient or a
 * profile_access grantee (see supabase/migrations/20260829121248_
 * adolescent_health_module.sql). Every org clinical staff member (including
 * Care Coordinator and Tier 1) can see this worklist and add notes; only
 * Tier 2+/Clinical Director can resolve or close a concern
 * (canReviewSafeguardingConcern mirrors the DB trigger that actually
 * enforces this).
 */
export default async function SafeguardingPage() {
  const staff = await getCurrentClinicalStaff();
  const canResolve = canReviewSafeguardingConcern(staff);

  const supabase = await createClient();
  const { data: concerns } = await supabase
    .from("safeguarding_concerns")
    .select(
      "id, concern_type, status, source, narrative, created_at, resolution_notes, patient:profiles!safeguarding_concerns_patient_id_fkey(full_name)"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Safeguarding</h1>
        <p className="text-sm text-charcoal-ink/60">
          Restricted worklist — never visible to the patient or a family member. Resolving or
          closing a concern needs a Tier 2+ clinician or the Clinical Director.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Concerns</CardTitle>
          <CardDescription>Most recent first, including resolved and closed cases.</CardDescription>
        </CardHeader>
        <CardContent>
          {(!concerns || concerns.length === 0) && (
            <p className="text-sm text-charcoal-ink/60">No safeguarding concerns on file.</p>
          )}
          {concerns && concerns.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {concerns.map((concern) => {
                const statusBadge = STATUS_BADGE[concern.status] ?? { label: concern.status, variant: "grey" as const };
                const isOpen = concern.status === "open" || concern.status === "under_review";
                return (
                  <li key={concern.id} className="space-y-2 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="red">{CONCERN_TYPE_LABEL[concern.concern_type] ?? concern.concern_type}</Badge>
                      <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                      <span className="text-xs text-charcoal-ink/60">
                        {new Date(concern.created_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      {concern.patient?.full_name ?? "Unknown patient"}
                    </p>
                    {concern.narrative && <p className="text-sm text-charcoal-ink/80">{concern.narrative}</p>}
                    {concern.resolution_notes && (
                      <p className="text-sm text-charcoal-ink/60">
                        <span className="font-medium">Resolution:</span> {concern.resolution_notes}
                      </p>
                    )}
                    {isOpen && (
                      <ResolveSafeguardingConcernForm concernId={concern.id} canResolve={canResolve} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
