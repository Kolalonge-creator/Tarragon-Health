"use client";

import { useRouter } from "next/navigation";
import { useAssignSpecialistProvider, useMatchedSpecialistProviders } from "@/lib/queries/specialist-referrals";
import { Button } from "@/components/ui/button";
import { koboToNaira, type Tables } from "@tarragon/shared";

/**
 * Lets org staff assign a real, active, specialty-matched partner
 * specialist_providers row to a pending/waitlisted referral — the
 * clinician-side counterpart to useAssignSpecialistProvider's reactivated
 * set_referral_specialist_provider() RPC. Purely additive: a referral that
 * is never assigned here stays self_arranged exactly as before, and this
 * list is a plain filter (useMatchedSpecialistProviders), never a scored or
 * ranked recommendation — see docs/CLINICAL_NETWORK_SPEC.md §3.
 */
export function AssignSpecialistProviderForm({
  referralId,
  specialistType,
}: {
  referralId: string;
  specialistType: Tables<"specialist_referrals">["specialist_type"];
}) {
  const router = useRouter();
  const { data: providers, isLoading } = useMatchedSpecialistProviders({ specialistType });
  const assign = useAssignSpecialistProvider();

  return (
    <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
      <p className="text-xs font-medium text-charcoal-ink">
        Assign a partner specialist (optional, this referral stays self-arranged until you do)
      </p>
      {isLoading && <p className="text-xs text-charcoal-ink/60">Loading specialists…</p>}
      {!isLoading && (!providers || providers.length === 0) && (
        <p className="text-xs text-charcoal-ink/60">
          No active partner specialists on file for this specialty yet.
        </p>
      )}
      {providers && providers.length > 0 && (
        <ul className="divide-y divide-charcoal-ink/10">
          {providers.map((provider) => (
            <li key={provider.id} className="flex items-center justify-between gap-2 py-2">
              <div>
                <p className="text-sm text-charcoal-ink">{provider.name}</p>
                <p className="text-xs text-charcoal-ink/60">
                  {[provider.city, provider.state].filter(Boolean).join(", ") || "Location on file"}, ₦
                  {koboToNaira(provider.consultation_fee_kobo).toLocaleString()}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={assign.isPending}
                onClick={() =>
                  assign.mutate(
                    { referralId, specialistProviderId: provider.id },
                    { onSuccess: () => router.refresh() }
                  )
                }
              >
                {assign.isPending ? "Assigning…" : "Assign"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {assign.isError && (
        <p className="text-xs text-red-600">
          {(assign.error as Error).message || "Could not assign. Try again."}
        </p>
      )}
    </div>
  );
}
