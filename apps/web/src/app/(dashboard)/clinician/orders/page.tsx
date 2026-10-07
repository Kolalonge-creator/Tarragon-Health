"use client";

import { useState } from "react";
import Link from "next/link";
import { useOrgLabOrders, type LabOrderWithDetails } from "@/lib/queries/lab-orders";
import { useOrgPharmacyOrders } from "@/lib/queries/pharmacy-orders";
import { useMatchedHomeVisitProviders, useAssignHomeVisitProvider } from "@/lib/queries/logistics-partners";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { listQueryState } from "@/lib/queries/list-query-state";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { koboToNaira, type LabOrderStatus, type PharmacyOrderStatus } from "@tarragon/shared";

const LAB_ORDER_STATUS_BADGE: Record<LabOrderStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending_payment: { variant: "amber", label: "Awaiting payment" },
  payment_confirmed: { variant: "blue", label: "Booking confirmed" },
  ordered: { variant: "blue", label: "In progress" },
  sample_collected: { variant: "blue", label: "Sample collected" },
  sample_rejected: { variant: "red", label: "Sample rejected" },
  processing: { variant: "blue", label: "In progress" },
  resulted: { variant: "green", label: "Results ready" },
  cancelled: { variant: "grey", label: "Cancelled" },
};

const PHARMACY_ORDER_STATUS_BADGE: Record<PharmacyOrderStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending_payment: { variant: "amber", label: "Awaiting payment" },
  payment_confirmed: { variant: "blue", label: "Booking confirmed" },
  requested: { variant: "blue", label: "In progress" },
  confirmed: { variant: "blue", label: "In progress" },
  unavailable: { variant: "amber", label: "Medicine unavailable" },
  dispensed: { variant: "blue", label: "Dispensed" },
  cancelled: { variant: "grey", label: "Cancelled" },
};

/**
 * Staff-only "Assign home visit provider + time" control. State is manually
 * selected at scheduling time, same UX as /clinician/referrals/page.tsx's
 * AssignProviderForm — there is no profiles.state/region column anywhere in
 * this codebase to read from instead.
 */
function AssignHomeVisitForm({ order }: { order: LabOrderWithDetails }) {
  const [state, setState] = useState("");
  const { data: providers, isLoading } = useMatchedHomeVisitProviders({ region: state || undefined });
  const [providerId, setProviderId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const assign = useAssignHomeVisitProvider();

  const noMatches = !isLoading && state.length > 0 && (providers?.length ?? 0) === 0;

  return (
    <div className="space-y-2 border-t border-charcoal-ink/10 pt-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`hv-state-${order.id}`}>State</Label>
          <Input
            id={`hv-state-${order.id}`}
            placeholder="e.g. Lagos"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="w-32"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`hv-provider-${order.id}`}>Home visit provider</Label>
          {isLoading && <p className="text-xs text-charcoal-ink/60">Loading…</p>}
          {noMatches && <p className="text-xs text-charcoal-ink/60">No active providers cover this state yet.</p>}
          {(providers?.length ?? 0) > 0 && (
            <Select id={`hv-provider-${order.id}`} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">Select a provider</option>
              {providers!.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}: ₦{koboToNaira(p.home_visit_fee_kobo).toLocaleString()}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor={`hv-time-${order.id}`}>Scheduled time</Label>
          <Input
            id={`hv-time-${order.id}`}
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          disabled={!providerId || !scheduledAt || assign.isPending}
          onClick={() =>
            assign.mutate({
              orderId: order.id,
              homeVisitProviderId: providerId,
              scheduledAt: new Date(scheduledAt).toISOString(),
            })
          }
        >
          {assign.isPending ? "Scheduling…" : "Schedule home visit"}
        </Button>
      </div>
      {assign.isError && <p className="text-xs text-red-600">Could not schedule. Try again.</p>}
    </div>
  );
}

function LabOrdersWorklist() {
  const { data, isLoading, isError } = useOrgLabOrders();
  const state = listQueryState({ isLoading, isError, count: data?.length });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lab orders</CardTitle>
      </CardHeader>
      <CardContent>
        {state === "loading" && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {state === "error" && (
          <LoadFailure>
            Lab orders could not be loaded. This is not a report that none are outstanding, and a
            result waiting on a patient is not visible here. Reload to try again.
          </LoadFailure>
        )}
        {state === "empty" && <p className="text-sm text-charcoal-ink/60">No lab orders yet.</p>}
        {state === "ready" && data && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((order) => {
              const badge = LAB_ORDER_STATUS_BADGE[order.status];
              return (
                <li key={order.id} className="space-y-2 py-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <span className="text-xs text-charcoal-ink/60">{order.order_number}</span>
                  </div>
                  <p className="text-sm font-medium text-charcoal-ink">
                    {order.panel_bundle?.name ?? "Lab test"}
                    {order.provider && <span className="text-charcoal-ink/60"> · {order.provider.name}</span>}
                  </p>
                  {order.home_visit_provider ? (
                    <p className="text-xs text-charcoal-ink/60">
                      Home visit: {order.home_visit_provider.name}
                      {order.home_visit_scheduled_at &&
                        `, ${new Date(order.home_visit_scheduled_at).toLocaleString("en-GB", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}`}
                    </p>
                  ) : (
                    (order.status === "payment_confirmed" || order.status === "ordered") && (
                      <AssignHomeVisitForm order={order} />
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PharmacyOrdersWorklist() {
  const { data, isLoading, isError } = useOrgPharmacyOrders();
  const state = listQueryState({ isLoading, isError, count: data?.length });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pharmacy orders</CardTitle>
      </CardHeader>
      <CardContent>
        {state === "loading" && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {state === "error" && (
          <LoadFailure>
            Pharmacy orders could not be loaded. This is not a report that none are outstanding, and
            a medicine waiting on a patient is not visible here. Reload to try again.
          </LoadFailure>
        )}
        {state === "empty" && <p className="text-sm text-charcoal-ink/60">No pharmacy orders yet.</p>}
        {state === "ready" && data && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((order) => {
              const badge = PHARMACY_ORDER_STATUS_BADGE[order.status];
              return (
                <li key={order.id} className="space-y-2 py-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {order.order_number && <span className="text-xs text-charcoal-ink/60">{order.order_number}</span>}
                  </div>
                  <p className="text-xs text-charcoal-ink/60">
                    ₦{koboToNaira(order.total_kobo).toLocaleString()}
                    {order.requires_cold_chain && <span className="ml-2 text-blue-700">· Cold-chain</span>}
                  </p>
                  {order.status === "unavailable" && (
                    <p className="text-xs text-amber-700">
                      Flagged unavailable{order.unavailable_reason ? `: ${order.unavailable_reason}` : ""}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function ClinicianOrdersPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/clinician" className="text-sm text-brand-green hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Home visits &amp; pharmacy orders</h1>
        <p className="text-charcoal-ink/60">
          Assign a home-visit provider once a lab order is paid. Pharmacy orders are collection
          only, so they are listed here for reference.
        </p>
      </div>
      <LabOrdersWorklist />
      <PharmacyOrdersWorklist />
    </div>
  );
}
