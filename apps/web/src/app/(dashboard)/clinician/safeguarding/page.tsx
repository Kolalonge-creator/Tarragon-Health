import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canReviewSafeguardingConcern } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  compareSafeguardingConcerns,
  safeguardingCategoryVariant,
} from "@/lib/worklist/safeguarding-rank";
import { timeAgo } from "@/lib/worklist/sla-label";
import Link from "next/link";
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

/** Open work vs the whole register. Plain links, since this is a Server
 * Component and the view belongs in the URL. */
const VIEWS = [
  { value: "open", label: "Open and under review" },
  { value: "all", label: "All, including closed" },
] as const;

type ConcernView = (typeof VIEWS)[number]["value"];

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
export default async function SafeguardingPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const requestedView = (await searchParams).view;
  const view: ConcernView = requestedView === "all" ? "all" : "open";
  const staff = await getCurrentClinicalStaff();
  const canResolve = canReviewSafeguardingConcern(staff);

  const supabase = await createClient();
  const { data: concerns, error: concernsError } = await supabase
    .from("safeguarding_concerns")
    .select(
      "id, concern_category, status, source, description, created_at, review_outcome, corrective_action, patient:profiles!safeguarding_concerns_patient_id_fkey(full_name)"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  // The fetch order (newest first, closed interleaved with open) is not a
  // triage order. Rank open work first, most severe category first, oldest
  // first within that — an old open immediate-safety-risk is the row that
  // must be at the top, not whatever was filed most recently.
  const ranked = (concerns ?? []).slice().sort(compareSafeguardingConcerns);
  const openCount = ranked.filter((c) => c.status !== "closed").length;
  const visible = view === "all" ? ranked : ranked.filter((c) => c.status !== "closed");

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
          <CardTitle>Concerns{concernsError ? "" : ` (${openCount} open)`}</CardTitle>
          <CardDescription>
            Open work first, most serious category first, oldest first within that. Closed cases
            sit behind the open ones.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!concernsError && ranked.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {VIEWS.map((option) => (
                <Link
                  key={option.value}
                  href={
                    option.value === "open"
                      ? "/clinician/safeguarding"
                      : `/clinician/safeguarding?view=${option.value}`
                  }
                  aria-current={view === option.value ? "page" : undefined}
                  className={
                    view === option.value
                      ? "rounded-full border border-brand-green bg-brand-green/10 px-3 py-1 text-xs font-medium text-deep-forest"
                      : "rounded-full border border-charcoal-ink/20 px-3 py-1 text-xs text-charcoal-ink/70 hover:border-brand-green"
                  }
                >
                  {option.label} ({option.value === "open" ? openCount : ranked.length})
                </Link>
              ))}
            </div>
          )}
          {/* A swallowed error here used to render "No safeguarding concerns
              on file." — a false all-clear on the child-safety and
              vulnerable-adult queue, the highest-consequence one on the
              platform. An unread query is never an empty queue. */}
          {concernsError && (
            <LoadFailure>
              This queue could not be loaded. Do not treat it as empty. Reload the page, and if it
              keeps failing, raise it with the platform team before assuming there is nothing open.
            </LoadFailure>
          )}
          {!concernsError && ranked.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No safeguarding concerns on file.</p>
          )}
          {!concernsError && ranked.length > 0 && visible.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">
              Nothing open. Choose &ldquo;All, including closed&rdquo; to see the register.
            </p>
          )}
          {!concernsError && visible.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {visible.map((concern) => {
                const statusBadge = STATUS_BADGE[concern.status] ?? { label: concern.status, variant: "grey" as const };
                const isOpen = concern.status === "open" || concern.status === "under_review";
                return (
                  <li key={concern.id} className="space-y-2 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Not red on every row: red on everything reads the
                          same as red on nothing. Only the categories that mean
                          somebody may be in danger right now carry it. */}
                      <Badge
                        variant={safeguardingCategoryVariant(concern.concern_category, concern.status)}
                      >
                        {CONCERN_CATEGORY_LABEL[concern.concern_category] ?? concern.concern_category}
                      </Badge>
                      <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                      {concern.source && (
                        <span className="text-xs text-charcoal-ink/60">
                          {SOURCE_LABEL[concern.source] ?? concern.source}
                        </span>
                      )}
                      <span className="text-xs text-charcoal-ink/60">
                        Raised {timeAgo(concern.created_at)} (
                        {new Date(concern.created_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                        )
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
                      <ResolveSafeguardingConcernForm
                        concernId={concern.id}
                        canResolve={canResolve}
                        patientName={concern.patient?.full_name ?? "Unknown patient"}
                        categoryLabel={
                          CONCERN_CATEGORY_LABEL[concern.concern_category] ?? concern.concern_category
                        }
                      />
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
