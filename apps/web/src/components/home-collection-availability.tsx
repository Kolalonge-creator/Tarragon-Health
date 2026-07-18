"use client";

import { useMatchedHomeVisitProviders } from "@/lib/queries/logistics-partners";
import { useRegionServiceAvailable } from "@/lib/queries/service-regions";
import { koboToNaira } from "@tarragon/shared";
import { Badge } from "@/components/ui/badge";

/**
 * Data-driven home-collection availability block for a lab order. There is
 * deliberately no feature flag here: with zero active home_visit_providers
 * rows in a region, this renders the static "coming soon" block below purely
 * because the query returns no matches. The moment ops adds a real active
 * row covering that region/sample type, this same component renders the
 * real scheduling status automatically — no redeploy, no flag flip.
 *
 * This is a read-only status view for the patient (scheduling itself is a
 * staff action, per the brief's ops-assigns-provider design — see
 * AssignHomeVisitForm on the clinician lab-order view). It shows: nothing
 * scheduled yet (but available), a scheduled visit, or the "coming soon"
 * block.
 */
export function HomeCollectionAvailability({
  region,
  sampleType,
  homeVisitProviderName,
  homeVisitScheduledAt,
}: {
  region: string | null;
  sampleType?: string;
  homeVisitProviderName?: string | null;
  homeVisitScheduledAt?: string | null;
}) {
  const { data: providers, isLoading } = useMatchedHomeVisitProviders({
    region: region ?? undefined,
    sampleType,
  });
  // Also require the state's rollout master switch to be on — an active provider whose
  // region hasn't been launched yet must still read "coming soon".
  const { data: regionOk, isLoading: regionLoading } = useRegionServiceAvailable(
    region,
    "home_visit",
  );

  if (homeVisitProviderName) {
    return (
      <div className="rounded-lg border border-charcoal-ink/10 bg-warm-ivory p-3">
        <div className="mb-1 flex items-center gap-2">
          <Badge variant="blue">Home collection scheduled</Badge>
        </div>
        <p className="text-sm text-charcoal-ink">
          {homeVisitProviderName}
          {homeVisitScheduledAt && (
            <span className="text-charcoal-ink/60">
              {" "}
              — {new Date(homeVisitScheduledAt).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          )}
        </p>
      </div>
    );
  }

  if (isLoading || regionLoading) {
    return <p className="text-xs text-charcoal-ink/60">Checking home collection availability…</p>;
  }

  const available = (providers?.length ?? 0) > 0 && regionOk === true;

  if (!available) {
    return (
      <div className="rounded-lg border border-dashed border-charcoal-ink/15 bg-charcoal-ink/[0.02] p-3">
        <p className="text-sm font-medium text-charcoal-ink/70">
          Home collection: coming soon in your area
        </p>
        <p className="text-xs text-charcoal-ink/50">
          We&apos;re not yet able to send someone to collect a sample here — visit a partner lab
          instead. We&apos;ll let you know as soon as this is available near you.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-charcoal-ink/10 bg-warm-ivory p-3">
      <div className="mb-1 flex items-center gap-2">
        <Badge variant="green">Home collection available</Badge>
      </div>
      <p className="text-xs text-charcoal-ink/60">
        {providers!.length === 1
          ? `${providers![0].name} covers your area`
          : `${providers!.length} home-collection providers cover your area`}
        {providers![0].home_visit_fee_kobo > 0 &&
          ` — from ₦${koboToNaira(providers![0].home_visit_fee_kobo).toLocaleString()}`}
        . Your care team will schedule a visit.
      </p>
    </div>
  );
}
