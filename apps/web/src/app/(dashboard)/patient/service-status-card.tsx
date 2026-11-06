import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { SEMANTIC_ICON } from "@/lib/icons";
import { formatPatientDate } from "@/lib/format-date";

export type ServiceAccessStatus = "membership_active" | "monitoring_active" | "service_active" | "self_tracking";

export type ServiceAccess = {
  status: ServiceAccessStatus;
  monitoringExpiresAt: string | null;
  /** Set only for membership_active: the Membership tier ("plus" carries the yearly blood panel) and when it ends. */
  membershipTier?: string | null;
  membershipEndsAt?: string | null;
  resolvedAt: string;
};

/** What a Membership tier is called on screen. Mirrors catalog.membership_annual.name / membership_annual_no_panel in packages/i18n. */
function membershipTierLabel(tier: string | null | undefined): string {
  return tier === "plus" ? "Membership Plus" : "Membership";
}

/**
 * A founder-commissioned launch-scope audit's boundary rule (a local
 * document, not tracked in this repo -- see the PR description for the one
 * this card was written against): a free/self-tracking patient must never be
 * left to infer a clinician relationship that isn't actually funded. This
 * card is the one place on the dashboard that states the boundary plainly,
 * sourced from public.resolve_patient_service_access() -- never a hardcoded
 * string, and never inferred client-side from other cards.
 *
 * Exported for testing: the "fails closed to null on error" behaviour is the
 * one thing that matters here (a broken RPC must never render as an active
 * monitoring service, the opposite failure direction from every worklist
 * counter in worklist-counts.ts, which must never render a failure as 0).
 */
async function resolveServiceAccessUncached(patientId: string): Promise<ServiceAccess | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_patient_service_access", {
    p_patient_id: patientId,
  });
  if (error) {
    // Fails closed to the free-tier message rather than throwing -- an
    // outage here must never look like an active clinician service, and
    // must never block the rest of the dashboard from rendering.
    return null;
  }
  return data as unknown as ServiceAccess;
}

/** Request-cached: the service card and Home's care journey both ask, and should cost one RPC between them. */
export const resolveServiceAccess = cache(resolveServiceAccessUncached);

const COPY: Record<
  ServiceAccessStatus,
  { icon: keyof typeof SEMANTIC_ICON; title: string; body: (access: ServiceAccess) => string }
> = {
  membership_active: {
    icon: "clinicianFollowUp",
    title: "Your Membership is active",
    body: (access) =>
      access.membershipEndsAt
        ? `${membershipTierLabel(access.membershipTier)} runs until ${formatPatientDate(access.membershipEndsAt)}. A doctor on your care team is told when one of your readings is dangerous.`
        : `${membershipTierLabel(access.membershipTier)} is active. A doctor on your care team is told when one of your readings is dangerous.`,
  },
  monitoring_active: {
    icon: "preventive",
    title: "Monitoring active",
    body: (access) =>
      access.monitoringExpiresAt
        ? `Your Continuous Monitoring service runs until ${formatPatientDate(access.monitoringExpiresAt)}.`
        : "Your Continuous Monitoring service is active.",
  },
  service_active: {
    icon: "clinicianFollowUp",
    title: "A paid service is active",
    body: () =>
      "You have an active clinician-backed service on your account. See Services & receipts for what's included and when it's due.",
  },
  self_tracking: {
    icon: "billing",
    title: "Self-tracking",
    body: () =>
      "This account does not include a clinician monitoring service. Choose a service below to have a clinician review a Health Check or follow your readings.",
  },
};

export async function ServiceStatusCard({ patientId, acting }: { patientId: string; acting: boolean }) {
  // Unlike SinceYouWereLastHere (which hides for a caregiver because "since
  // you were last here" is about the BROWSING session, not the record on
  // screen), this card states a fact about the PATIENT record itself -- a
  // caregiver acting on a dependent's behalf needs to see that dependent's
  // own service boundary just as much as the patient would. `acting` is kept
  // as a prop for call-site parity with sibling cards, not because it changes
  // whether this one renders.
  void acting;

  const access = await resolveServiceAccess(patientId);
  if (!access) return null;

  const copy = COPY[access.status];
  const Icon = SEMANTIC_ICON[copy.icon];

  return (
    <div className="flex items-start gap-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 dark:border-night-ink/15 dark:bg-deep-forest/40">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-deep-forest dark:text-brand-green-bright" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{copy.title}</p>
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{copy.body(access)}</p>
      </div>
    </div>
  );
}
