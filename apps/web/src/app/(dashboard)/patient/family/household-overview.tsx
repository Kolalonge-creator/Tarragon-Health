"use client";

import { useHouseholdCareCircle, type HouseholdMember } from "@/lib/queries/care-access";
import { useSupportedPersonHealth } from "@/lib/queries/sponsorship";
import { useVaccinationSchedules } from "@/lib/queries/vaccination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const CONDITION_LABEL: Record<string, string> = {
  hypertension: "High blood pressure",
  diabetes: "Diabetes",
  obesity: "Weight",
  cardiovascular: "Heart health",
  asthma: "Asthma",
  ckd: "Kidney health",
  heart_failure: "Heart failure",
};

function humanCondition(condition: string): string {
  return CONDITION_LABEL[condition] ?? condition.replace(/_/g, " ");
}

/**
 * "FAMILY HEALTH" (docs/FAMILY_CARE_CIRCLE_SPEC.md §3.5 / the brief's own
 * §22.8 mockup): one glance at everyone in this account's consent graph —
 * condition, care status, what's due. Every field it shows was already
 * built and RLS-gated somewhere else (useSupportedPersonHealth for
 * conditions/screenings, useVaccinationSchedules for the vaccination card)
 * — this is purely a rollup, no new tables, no new consent rule. What
 * private.can_read_clinical already refuses to return, this cannot show
 * either: a grant with zero categories renders name and "ask them to share
 * their health information" only, same message /patient/supporting already
 * uses. Reconciled 2026-09-02 to read the category-scoped grant
 * (profile_access_categories, 20260830103251) rather than the superseded
 * clinical_access_level column — see docs/FAMILY_CARE_CIRCLE_SPEC.md §3.4.
 */
export function HouseholdOverview() {
  const { data: members, isLoading, isError } = useHouseholdCareCircle();

  if (isLoading) return null;
  if (isError || !members || members.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Family health</CardTitle>
        <CardDescription>
          Everyone whose care you follow or manage, and what&apos;s due next for each of them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {members.map((member) => (
            <HouseholdMemberRow key={member.profileId} member={member} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function HouseholdMemberRow({ member }: { member: HouseholdMember }) {
  const hasClinicalAccess = member.categories.length > 0;
  const { data: health } = useSupportedPersonHealth(member.profileId, hasClinicalAccess);
  const { data: schedules } = useVaccinationSchedules(member.profileId);

  const today = new Date().toISOString().slice(0, 10);
  const vaccinationsDue = (schedules ?? []).filter((s) => s.due_date <= today).length;

  const name = member.fullName ?? "Someone you have added";

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-charcoal-ink">{name}</p>
          {member.dependentKind === "minor_child" && <Badge variant="grey">Child</Badge>}
        </div>

        {hasClinicalAccess ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {health && health.activeConditions.length > 0 ? (
              health.activeConditions.map((condition) => (
                <Badge key={condition} variant="grey">
                  {humanCondition(condition)}
                </Badge>
              ))
            ) : (
              <p className="text-xs text-charcoal-ink/50">No active condition on file.</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-charcoal-ink/50">
            Following logistics only. Ask them to share their health information from their own
            account to see more here.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {hasClinicalAccess && health && health.screeningsDue > 0 && (
          <Badge variant="amber">
            {health.screeningsDue} screening{health.screeningsDue === 1 ? "" : "s"} due
          </Badge>
        )}
        {hasClinicalAccess && health && health.openFollowUps > 0 && (
          <Badge variant="red">
            {health.openFollowUps} follow-up{health.openFollowUps === 1 ? "" : "s"} open
          </Badge>
        )}
        {vaccinationsDue > 0 && (
          <Badge variant="amber">
            {vaccinationsDue} vaccination{vaccinationsDue === 1 ? "" : "s"} due
          </Badge>
        )}
        {hasClinicalAccess &&
          health &&
          health.screeningsDue === 0 &&
          health.openFollowUps === 0 &&
          vaccinationsDue === 0 && <Badge variant="green">All caught up</Badge>}
      </div>
    </li>
  );
}
