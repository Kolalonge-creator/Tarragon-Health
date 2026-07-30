import { Card, CardContent } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * I9 requires this to be stated plainly on the institution's own screen, not
 * buried in a contract: the employer/HMO sees group patterns, never a person.
 * Rendered on both /dashboard/corporate and /dashboard/hmo.
 */
export function InstitutionPrivacyNotice({
  entityLabel = "staff",
}: {
  /** "staff" (corporate) or "member" (HMO) — copy only. */
  entityLabel?: "staff" | "member";
}) {
  const plural = entityLabel === "member" ? "members" : "staff";

  return (
    <Card className="border-deep-forest/20 bg-deep-forest/[0.03]">
      <CardContent className="flex gap-3 py-4">
        <SEMANTIC_ICON.preventive className="mt-0.5 h-5 w-5 shrink-0 text-deep-forest" strokeWidth={2} />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-charcoal-ink">
            Tarragon does not share individual health records with your organisation.
          </p>
          <p className="text-charcoal-ink/70">
            Everything here describes your {plural} as a group. You cannot see who has a
            condition, whose result was abnormal, or who has missed a screening, and neither
            can we show you on request. Figures covering too few people are withheld
            entirely, because a percentage of a small group identifies the people in it.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Shown in place of the dashboards' numbers when the cohort is below the
 * organisation's min_cohort_size. Deliberately states the reason — an empty
 * panel reads as a bug and invites someone to "fix" it.
 */
export function CohortTooSmallNotice({
  cohortSize,
  minCohortSize,
  entityLabel = "staff",
}: {
  cohortSize: number;
  minCohortSize: number;
  entityLabel?: "staff" | "member";
}) {
  const plural = entityLabel === "member" ? "members" : "staff";

  return (
    <Card>
      <CardContent className="space-y-2 py-6 text-sm">
        <p className="font-medium text-charcoal-ink">Not enough people yet to report safely.</p>
        <p className="text-charcoal-ink/70">
          {cohortSize === 0
            ? `No ${plural} have enrolled yet.`
            : `${cohortSize} of your ${plural} ${cohortSize === 1 ? "has" : "have"} enrolled.`}{" "}
          Health figures appear once at least {minCohortSize} have joined. Below that, any
          number we showed would point at individuals rather than describe a group.
        </p>
      </CardContent>
    </Card>
  );
}
