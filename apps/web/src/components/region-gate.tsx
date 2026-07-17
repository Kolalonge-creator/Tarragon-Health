"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  useRegionServiceAvailable,
  useJoinRegionWaitlist,
  useMyOpenWaitlist,
  type RegionServiceType,
} from "@/lib/queries/service-regions";

const SERVICE_LABELS: Record<RegionServiceType, string> = {
  lab: "Lab tests",
  pharmacy: "Pharmacy orders",
  home_visit: "Home sample collection",
  delivery: "Medication delivery",
  specialist: "Specialist referrals",
};

/**
 * Gates a partner-dependent action (book a lab, order pharmacy, etc.) by whether the
 * care-recipient's state is live AND has an active partner for that service
 * (public.region_service_available). When available, renders the real booking UI
 * (children). When not, renders a "coming soon in {state}" card with a one-tap
 * "notify me when it's live" waitlist button — the same data-driven, no-feature-flag
 * pattern as HomeCollectionAvailability, extended to also respect the state master switch.
 *
 * The Free / self-service tier never wraps in this — only partner-dependent actions do, so
 * a patient in a dark state keeps full self-service access and only sees this on the parts
 * that genuinely need an in-state partner.
 *
 * `state` is the care-recipient's state (a family member is gated by their own state, not
 * the account holder's). Contact snapshots (toEmail/toPhone) are stored on the waitlist row
 * so a later detail change doesn't redirect the go-live alert.
 */
export function RegionGate({
  state,
  service,
  careRecipientId = null,
  toEmail = null,
  toPhone = null,
  serviceLabel,
  children,
}: {
  state: string | null | undefined;
  service: RegionServiceType;
  careRecipientId?: string | null;
  toEmail?: string | null;
  toPhone?: string | null;
  serviceLabel?: string;
  children: React.ReactNode;
}) {
  const label = serviceLabel ?? SERVICE_LABELS[service];
  const { data: available, isLoading } = useRegionServiceAvailable(state, service);
  const { data: alreadyJoined } = useMyOpenWaitlist(state, service, careRecipientId);
  const joinWaitlist = useJoinRegionWaitlist();
  const [justJoined, setJustJoined] = useState(false);

  // No state on file yet — can't evaluate the gate. Prompt to add a location rather than
  // silently allowing or blocking (the DB backstop only acts on a known state anyway).
  if (!state) {
    return (
      <div className="rounded-lg border border-dashed border-charcoal-ink/15 bg-charcoal-ink/[0.02] p-3">
        <p className="text-sm font-medium text-charcoal-ink/70">
          Add your state to see {label.toLowerCase()} near you
        </p>
        <p className="text-xs text-charcoal-ink/50">
          Set your location on your profile so we can show what&apos;s available where you are.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return <p className="text-xs text-charcoal-ink/60">Checking availability in {state}…</p>;
  }

  if (available) {
    return <>{children}</>;
  }

  const onList = alreadyJoined || justJoined;

  return (
    <div className="rounded-lg border border-dashed border-charcoal-ink/15 bg-charcoal-ink/[0.02] p-3">
      <p className="text-sm font-medium text-charcoal-ink/70">
        {label}: coming soon in {state}
      </p>
      <p className="mt-0.5 text-xs text-charcoal-ink/50">
        We&apos;re not live in {state} yet. You can keep using everything else in the app — and
        we&apos;ll let you know the moment {label.toLowerCase()} are available near you.
      </p>
      <div className="mt-2">
        {onList ? (
          <p className="text-xs font-medium text-brand-green">
            ✓ You&apos;re on the list — we&apos;ll be in touch when we launch in {state}.
          </p>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={joinWaitlist.isPending}
            onClick={() =>
              joinWaitlist.mutate(
                { state, serviceType: service, careRecipientId, toEmail, toPhone },
                { onSuccess: () => setJustJoined(true) },
              )
            }
          >
            {joinWaitlist.isPending ? "Adding you…" : "Notify me when it's live"}
          </Button>
        )}
        {joinWaitlist.isError && !onList && (
          <p className="mt-1 text-xs text-red-600">Couldn&apos;t add you just now — please try again.</p>
        )}
      </div>
    </div>
  );
}
