"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  useRegionServiceAvailable,
  useJoinRegionWaitlist,
  useMyOpenWaitlist,
  type RegionServiceType,
} from "@/lib/queries/service-regions";
import { resolveNigerianState } from "@/lib/nigeria-states";

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
  // Resolved once (a single normalization pass) and reused for: whether `state` is a
  // recognized Nigerian state at all (below), every waitlist read/write, and the "coming
  // soon" display copy — so a patient whose profile holds a non-canonical spelling (e.g.
  // "Lagos State") doesn't join a waitlist keyed by that raw string —
  // private.notify_region_waitlist does an EXACT match against the canonical
  // service_regions.state when a state goes live, so a raw, un-canonicalized write would
  // silently never fire for that patient (region_service_available itself was fixed to
  // tolerate the variant on read; this closes the same gap on the waitlist write/read path).
  const { recognized: isRecognizedState, canonical: canonicalState } = resolveNigerianState(state);
  const { data: alreadyJoined } = useMyOpenWaitlist(canonicalState || null, service, careRecipientId);
  const joinWaitlist = useJoinRegionWaitlist();
  const [justJoined, setJustJoined] = useState(false);

  // No state on file yet — can't evaluate the gate. Prompt to add a location rather than
  // silently allowing or blocking (the DB backstop only acts on a known state anyway).
  if (!state) {
    return (
      <div className="rounded-lg border border-dashed border-charcoal-ink/15 dark:border-night-ink/20 bg-charcoal-ink/[0.02] dark:bg-night-ink/10 p-3">
        <p className="text-sm font-medium text-charcoal-ink/70 dark:text-night-ink/70">
          Add your state to see {label.toLowerCase()} near you
        </p>
        <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
          Set your location on your profile so we can show what&apos;s available where you are.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        Checking availability in {canonicalState || state}…
      </p>
    );
  }

  if (available) {
    return <>{children}</>;
  }

  // region_service_available already tolerates a casing/whitespace/"...State"-suffix
  // variant of a real state (see 20260923212037_region_service_available_normalized_state_fallback.sql),
  // so `available` being false here means either a genuinely unserviced Nigerian state OR
  // a saved location that matches no Nigerian state at all — old free-text data, a typo too
  // garbled to recognise, or a diaspora patient's home country. Those two causes need
  // different copy: "coming soon" implies we'll get there, which isn't true or actionable
  // for the second case, and "please reselect" would be actively confusing for a patient
  // who genuinely isn't in Nigeria.
  if (!isRecognizedState) {
    return (
      <div className="rounded-lg border border-dashed border-charcoal-ink/15 dark:border-night-ink/20 bg-charcoal-ink/[0.02] dark:bg-night-ink/10 p-3">
        <p className="text-sm font-medium text-charcoal-ink/70 dark:text-night-ink/70">
          {label}: we don&apos;t recognize &quot;{state}&quot;
        </p>
        <p className="mt-0.5 text-xs text-charcoal-ink/50 dark:text-night-ink/55">
          That doesn&apos;t match a Nigerian state we cover. If this is an old or mistyped
          entry, update your location on your profile. If you&apos;re not currently in
          Nigeria, {label.toLowerCase()} aren&apos;t available for you yet.
        </p>
      </div>
    );
  }

  const onList = alreadyJoined || justJoined;

  return (
    <div className="rounded-lg border border-dashed border-charcoal-ink/15 dark:border-night-ink/20 bg-charcoal-ink/[0.02] dark:bg-night-ink/10 p-3">
      <p className="text-sm font-medium text-charcoal-ink/70 dark:text-night-ink/70">
        {label}: coming soon in {canonicalState}
      </p>
      <p className="mt-0.5 text-xs text-charcoal-ink/50 dark:text-night-ink/55">
        We&apos;re not live in {canonicalState} yet. You can keep using everything else in the app, and
        we&apos;ll let you know the moment {label.toLowerCase()} are available near you.
      </p>
      <div className="mt-2">
        {onList ? (
          <p className="text-xs font-medium text-brand-green dark:text-brand-green-bright">
            ✓ You&apos;re on the list. We&apos;ll be in touch when we launch in {canonicalState}.
          </p>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={joinWaitlist.isPending}
            onClick={() =>
              joinWaitlist.mutate(
                { state: canonicalState, serviceType: service, careRecipientId, toEmail, toPhone },
                { onSuccess: () => setJustJoined(true) },
              )
            }
          >
            {joinWaitlist.isPending ? "Adding you…" : "Notify me when it's live"}
          </Button>
        )}
        {joinWaitlist.isError && !onList && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-300">Couldn&apos;t add you just now. Please try again.</p>
        )}
      </div>
    </div>
  );
}
