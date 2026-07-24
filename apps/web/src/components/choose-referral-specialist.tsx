"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMatchedSpecialistProviders } from "@/lib/queries/specialist-referrals";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { koboToNaira, type SpecialistType } from "@tarragon/shared";

export interface ReferralPatientLocation {
  state: string | null;
  city: string | null;
}

/**
 * Lets the PATIENT pick a nearby specialist/hospital for a referral the
 * clinician has approved (urgency set) but not yet assigned a provider for —
 * additive to the existing clinician-side AssignProviderForm, never
 * overrides an assignment a clinician already made. Reuses the same matched
 * catalogue clinicians already use (useMatchedSpecialistProviders), so
 * "same state/city first" sorting is identical on both sides. Picking here
 * is what moves the referral to pending_payment (or straight to
 * payment_confirmed for a capitated org), which is what fires the
 * specialist-facing notification (private.enqueue_referral_notifications).
 */
export function ChooseReferralSpecialist({
  referralId,
  specialistType,
  patientLocation,
}: {
  referralId: string;
  specialistType: SpecialistType;
  patientLocation?: ReferralPatientLocation | null;
}) {
  const queryClient = useQueryClient();
  const { data: providers, isLoading } = useMatchedSpecialistProviders({
    specialistType,
    state: patientLocation?.state ?? undefined,
    city: patientLocation?.city ?? undefined,
  });

  const assign = useMutation({
    mutationFn: async (specialistProviderId: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_referral_specialist_provider", {
        p_referral_id: referralId,
        p_specialist_provider_id: specialistProviderId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals"] });
    },
  });

  if (isLoading) return <p className="text-xs text-charcoal-ink/60">Finding specialists near you…</p>;
  if (!providers || providers.length === 0) {
    return (
      <p className="text-xs text-charcoal-ink/60">
        Your care team is finding the right specialist for you — check back soon.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <p className="text-xs font-medium text-charcoal-ink">Choose who you&apos;d like to see</p>
      <ul className="divide-y divide-charcoal-ink/10">
        {providers.map((provider) => (
          <li key={provider.id} className="flex items-center justify-between gap-2 py-2">
            <div>
              <p className="text-sm text-charcoal-ink">{provider.name}</p>
              <p className="text-xs text-charcoal-ink/60">
                {[provider.city, provider.state].filter(Boolean).join(", ") || "Location on file"} — ₦
                {koboToNaira(provider.consultation_fee_kobo).toLocaleString()}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={assign.isPending}
              onClick={() => assign.mutate(provider.id)}
            >
              Choose
            </Button>
          </li>
        ))}
      </ul>
      {assign.isError && <p className="text-xs text-red-600">Could not save. Try again.</p>}
    </div>
  );
}
