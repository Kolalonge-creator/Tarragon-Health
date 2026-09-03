import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canReviewSafeguardingConcern } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResolveSafeguardingConcernForm } from "./resolve-form";

const CONCERN_CATEGORY_LABEL: Record<string, string> = {
  child_safety: "Child safety",
  vulnerable_adult: "Vulnerable adult",
  abuse: "Abuse",
  neglect: "Neglect",
  exploitation: "Exploitation",
  immediate_safety_risk: "Immediate safety risk",
  other: "Other / needs triage",
};

const SOURCE_LABEL: Record<string, string> = {
  adolescent_psychosocial_screen: "Adolescent check-in (auto-raised)",
  mental_health_screen: "Mental health screen",
  clinician_raised: "Filed by a clinician",
  other: "Other",
};

const STATUS_BADGE: Record<string, { label: string; variant: "amber" | "grey" | "green" | "red" }> = {
  open: { label: "Open", variant: "red" },
  under_review: { label: "Under review", variant: "amber" },
  closed: { label: "Closed", variant: "grey" },
};

/**
 * Safeguarding worklist (spec §49.11), reading the shared, general Patient
 * Safety safeguarding_concerns table (§89,
 * 20260829213100_safeguarding_concerns.sql) — not a table this module owns.
 * Its RLS never admits the patient or a profile_access grantee: SELECT
 * requires private.can_review_safeguarding_concern (Tier 3+/Clinical
 * Director) or being the original reporter, both of which are always org
 * staff by construction (INSERT requires private.is_org_staff, and
 * 20260902204423_extend_safeguarding_concerns_adolescent_linkage.sql closes
 * the one gap that could have let an auto-raised, patient-session-triggered
 * concern attribute reported_by to the patient themselves). Every org
 * clinical staff member (including Care Coordinator and Tier 1/2) can see
 * this worklist and add a review-outcome/corrective-action note; only
 * Tier 3+/Clinical Director can move a concern into review or close it
 * (canReviewSafeguardingConcern mirrors the DB trigger that actually
 * enforces this — private.enforce_safeguarding_concern_attribution).
 */
export default async function SafeguardingPage() {
  const staff = await getCurrentClinicalStaff();
  const canResolve = canReviewSafeguardingConcern(staff);

  const supabase = await createClient();
  const { data: concerns } = await supabase
    .from("safeguarding_concerns")
    .select(
      "id, concern_category, status, source, description, created_at, review_outcome, corrective_action, patient:profiles!safeguarding_concerns_patient_id_fkey(full_name)"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Safeguarding</h1>
        <p className="text-sm text-charcoal-ink/60">
          Restricted worklist: never visible to the patient or a family member. Moving a concern
          into review, or resolving/closing it, needs a Tier 3+ clinician or the Clinical Director.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Concerns</CardTitle>
          <CardDescription>Most recent first, including closed cases.</CardDescription>
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
                      <Badge variant="red">
                        {CONCERN_CATEGORY_LABEL[concern.concern_category] ?? concern.concern_category}
                      </Badge>
                      <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                      {concern.source && (
                        <span className="text-xs text-charcoal-ink/60">
                          {SOURCE_LABEL[concern.source] ?? concern.source}
                        </span>
                      )}
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
                    {concern.description && (
                      <p className="text-sm text-charcoal-ink/80">{concern.description}</p>
                    )}
                    {concern.review_outcome && (
                      <p className="text-sm text-charcoal-ink/60">
                        <span className="font-medium">Review outcome:</span> {concern.review_outcome}
                      </p>
                    )}
                    {concern.corrective_action && (
                      <p className="text-sm text-charcoal-ink/60">
                        <span className="font-medium">Corrective action:</span> {concern.corrective_action}
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
