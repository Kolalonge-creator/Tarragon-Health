"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  usePharmacistOwnPartnerId,
  usePharmacistOwnMedications,
  useSetPharmacistMedicationActive,
} from "@/lib/queries/pharmacist";
import { koboToNaira } from "@tarragon/shared";

/**
 * Self-service catalogue availability (docs/CLINICAL_NETWORK_SPEC.md §4.15)
 * — the pharmacist-side counterpart of lab-partner-services.tsx.
 * Availability-only; price/commission stay admin-managed
 * (private.restrict_pharmacy_medication_partner_edit_to_availability,
 * 20260827203240).
 */
export function PharmacistServices() {
  const { data: partnerId } = usePharmacistOwnPartnerId();
  const { data: medications, isLoading } = usePharmacistOwnMedications(partnerId);
  const toggle = useSetPharmacistMedicationActive();

  if (!partnerId) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your medications</CardTitle>
        <CardDescription>
          Mark a medication unavailable when you&apos;re out of stock. Prices and commission rates
          are set by Tarragon. Contact support to change one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-charcoal-ink/60">Loading…</p>
        ) : (medications ?? []).length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No medications on your catalogue yet.</p>
        ) : (
          (medications ?? []).map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-charcoal-ink/10 px-4 py-2"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-charcoal-ink">
                  {m.drug_name}
                  {m.pack_size && <span className="text-charcoal-ink/60"> · {m.pack_size}</span>}
                </span>
                <Badge variant={m.is_active ? "green" : "grey"}>{m.is_active ? "Active" : "Inactive"}</Badge>
                <span className="text-xs text-charcoal-ink/50">₦{koboToNaira(m.price_kobo).toLocaleString()}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ id: m.id, isActive: !m.is_active })}
              >
                {m.is_active ? "Mark unavailable" : "Mark available"}
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
