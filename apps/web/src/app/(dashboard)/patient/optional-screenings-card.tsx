"use client";

import { useOptionalScreeningOffers, useAcceptOptionalScreening } from "@/lib/queries/screening";
import type { ScreeningProfile } from "@/lib/rules/screening-recommendations";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * The other half of screen_types.is_optional (see its column comment:
 * "Offered when due, never assumed. The patient opts in rather than finding
 * it already inside their review."). computeScreeningRecommendations/
 * actions.ts never auto-schedules one of these onto the calendar — this
 * card is the only place an optional screening (currently dental/oral
 * check-up, ferritin, TFT, vitamin B12) is ever surfaced, and only once its
 * own cadence says it's actually due (useOptionalScreeningOffers filters on
 * that), never just because the patient is eligible. Renders nothing when
 * there's nothing to offer, same as any other supplementary card on this
 * page — no empty state, no clutter — but a genuine fetch failure gets its
 * own message rather than silently looking identical to "nothing to offer".
 */
export function OptionalScreeningsCard({
  patientId,
  profile,
}: {
  patientId: string;
  profile: ScreeningProfile;
}) {
  const { data: offers, isLoading, isError } = useOptionalScreeningOffers(patientId, profile);
  const acceptOffer = useAcceptOptionalScreening();

  if (isLoading) return null;

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
            Optional screenings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-300">
            Could not load optional screenings you might want to add.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!offers || offers.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          Optional screenings
        </CardTitle>
        <CardDescription>
          These aren&apos;t on your calendar automatically — add one only if you want it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {offers.map((offer) => {
            // One shared mutation instance across the whole list — every
            // button disables while ANY accept is in flight (not just the
            // clicked row's), so a second click on a different row can't
            // race the first one's still-pending insert into creating a
            // duplicate screening_schedules row for that screen type
            // (there's no partial-unique constraint stopping that at the
            // DB level). acceptOffer.variables identifies which row is
            // actually mid-flight, purely for the button's own label.
            const isThisOnePending =
              acceptOffer.isPending && acceptOffer.variables?.screenTypeId === offer.screenTypeId;
            return (
              <li key={offer.screenTypeId} className="flex items-center justify-between gap-3 py-3">
                <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                  {offer.screenTypeName}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={acceptOffer.isPending}
                  onClick={() =>
                    acceptOffer.mutate({
                      patientId,
                      screenTypeId: offer.screenTypeId,
                      dueDate: offer.dueDate,
                    })
                  }
                >
                  {isThisOnePending ? "Adding…" : "Add to my calendar"}
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
