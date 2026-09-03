"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useLabPartnerOwnProviderId,
  useLabPartnerOwnTests,
  useSetLabPartnerTestActive,
} from "@/lib/queries/lab-partner";
import { koboToNaira } from "@tarragon/shared";

/**
 * Self-service catalogue availability (docs/CLINICAL_NETWORK_SPEC.md §4.15).
 * Deliberately availability-only — price/commission stay admin-managed
 * (private.restrict_lab_test_partner_edit_to_availability, 20260827203240)
 * since they feed the commission ledger and partner billing pipeline.
 */
export function LabPartnerServices() {
  const { data: providerId } = useLabPartnerOwnProviderId();
  const { data: tests, isLoading } = useLabPartnerOwnTests(providerId);
  const toggle = useSetLabPartnerTestActive();

  if (!providerId) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your services</CardTitle>
        <CardDescription>
          Mark a test unavailable when you can&apos;t currently run it. Prices and commission rates
          are set by Tarragon. Contact support to change one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-charcoal-ink/60">Loading…</p>
        ) : (tests ?? []).length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No tests on your catalogue yet.</p>
        ) : (
          (tests ?? []).map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-charcoal-ink/10 px-4 py-2"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-charcoal-ink">{t.name}</span>
                <Badge variant={t.is_active ? "green" : "grey"}>{t.is_active ? "Active" : "Inactive"}</Badge>
                <span className="text-xs text-charcoal-ink/50">
                  ₦{koboToNaira(t.price_kobo).toLocaleString()}
                  {t.turnaround_hours ? ` · ${t.turnaround_hours}h turnaround` : ""}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ id: t.id, isActive: !t.is_active })}
              >
                {t.is_active ? "Mark unavailable" : "Mark available"}
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
