"use client";

import { useState } from "react";
import Link from "next/link";
import { useOrgLabOrders, type LabOrderWithDetails } from "@/lib/queries/lab-orders";
import { useOrgPharmacyOrders, type PharmacyOrderWithLogistics } from "@/lib/queries/pharmacy-orders";
import {
  useMatchedHomeVisitProviders,
  useMatchedLogisticsPartners,
  useAssignHomeVisitProvider,
  useAssignLogisticsPartner,
  useConfirmPharmacyDelivery,
  useRecordFailedDelivery,
  type DeliveryFailureReason,
} from "@/lib/queries/logistics-partners";
import { useOrderDeliveryAttempts } from "@/lib/queries/pharmacy-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { koboToNaira, type LabOrderStatus, type PharmacyOrderStatus } from "@tarragon/shared";

const FAILURE_REASON_OPTIONS: { value: DeliveryFailureReason; label: string }[] = [
  { value: "patient_unavailable", label: "Patient unavailable" },
  { value: "incorrect_address", label: "Incorrect address" },
  { value: "courier_failure", label: "Courier failure" },
  { value: "security_access_issue", label: "Security/access issue" },
  { value: "other", label: "Other" },
];

const LAB_ORDER_STATUS_BADGE: Record<LabOrderStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending_payment: { variant: "amber", label: "Awaiting payment" },
  payment_confirmed: { variant: "blue", label: "Booking confirmed" },
  ordered: { variant: "blue", label: "In progress" },
  sample_collected: { variant: "blue", label: "Sample collected" },
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
  out_for_delivery: { variant: "blue", label: "Out for delivery" },
  delivery_failed: { variant: "red", label: "Delivery failed" },
  delivered: { variant: "green", label: "Delivered" },
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lab orders</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load lab orders.</p>}
        {data && data.length === 0 && <p className="text-sm text-charcoal-ink/60">No lab orders yet.</p>}
        {data && data.length > 0 && (
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

/** Staff-only "Assign courier/logistics partner" control, same manual-state-entry UX as the lab side. */
function AssignLogisticsForm({ order, isRetry = false }: { order: PharmacyOrderWithLogistics; isRetry?: boolean }) {
  const address = order.delivery_address as unknown as { state?: string } | null;
  const [state, setState] = useState(address?.state ?? "");
  const { data: partners, isLoading } = useMatchedLogisticsPartners({
    region: state || undefined,
    requiresColdChain: order.requires_cold_chain,
  });
  const [partnerId, setPartnerId] = useState("");
  const [estimatedAt, setEstimatedAt] = useState("");
  const [courierRef, setCourierRef] = useState("");
  const assign = useAssignLogisticsPartner();

  const noMatches = !isLoading && state.length > 0 && (partners?.length ?? 0) === 0;

  return (
    <div className="space-y-2 border-t border-charcoal-ink/10 pt-2">
      {order.requires_cold_chain && (
        <p className="text-xs font-medium text-blue-700">
          Cold-chain: needs insulated packaging — only cold-chain-capable couriers are listed.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`lg-state-${order.id}`}>State</Label>
          <Input
            id={`lg-state-${order.id}`}
            placeholder="e.g. Lagos"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="w-32"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`lg-partner-${order.id}`}>Logistics partner</Label>
          {isLoading && <p className="text-xs text-charcoal-ink/60">Loading…</p>}
          {noMatches && (
            <p className="text-xs text-charcoal-ink/60">
              No active {order.requires_cold_chain ? "cold-chain-capable " : ""}couriers cover this state yet.
            </p>
          )}
          {(partners?.length ?? 0) > 0 && (
            <Select id={`lg-partner-${order.id}`} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">Select a courier</option>
              {partners!.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}: ₦{koboToNaira(p.delivery_fee_kobo).toLocaleString()}
                  {p.estimated_delivery_hours ? ` · ~${p.estimated_delivery_hours}h` : ""}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor={`lg-eta-${order.id}`}>Estimated delivery</Label>
          <Input
            id={`lg-eta-${order.id}`}
            type="datetime-local"
            value={estimatedAt}
            onChange={(e) => setEstimatedAt(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`lg-ref-${order.id}`}>Courier reference (optional)</Label>
          <Input
            id={`lg-ref-${order.id}`}
            value={courierRef}
            onChange={(e) => setCourierRef(e.target.value)}
            className="w-32"
          />
        </div>
        <Button
          size="sm"
          disabled={!partnerId || !estimatedAt || assign.isPending}
          onClick={() =>
            assign.mutate({
              orderId: order.id,
              logisticsPartnerId: partnerId,
              estimatedDeliveryAt: new Date(estimatedAt).toISOString(),
              courierReference: courierRef.trim() || undefined,
            })
          }
        >
          {assign.isPending ? "Assigning…" : isRetry ? "Retry delivery" : "Send for delivery"}
        </Button>
      </div>
      {assign.isError && <p className="text-xs text-red-600">Could not assign courier. Try again.</p>}
    </div>
  );
}

/** Staff-only "record a failed delivery attempt" control (spec §63.10) — reason is required, notes optional. */
function MarkFailedDeliveryForm({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DeliveryFailureReason | "">("");
  const [notes, setNotes] = useState("");
  const recordFailed = useRecordFailedDelivery();

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Mark failed
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md bg-red-50 p-2">
      <div className="space-y-1">
        <Label htmlFor={`fail-reason-${orderId}`}>Why did it fail?</Label>
        <Select
          id={`fail-reason-${orderId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value as DeliveryFailureReason)}
        >
          <option value="">Select a reason</option>
          {FAILURE_REASON_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-40 flex-1 space-y-1">
        <Label htmlFor={`fail-notes-${orderId}`}>Notes (optional)</Label>
        <Input id={`fail-notes-${orderId}`} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <Button
        size="sm"
        disabled={!reason || recordFailed.isPending}
        onClick={() =>
          recordFailed.mutate(
            { orderId, failureReason: reason as DeliveryFailureReason, notes: notes.trim() || undefined },
            { onSuccess: () => setOpen(false) },
          )
        }
      >
        {recordFailed.isPending ? "Saving…" : "Confirm"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {recordFailed.isError && <p className="basis-full text-xs text-red-600">Could not save. Try again.</p>}
    </div>
  );
}

const FAILURE_REASON_LABEL: Record<string, string> = Object.fromEntries(
  FAILURE_REASON_OPTIONS.map((r) => [r.value, r.label]),
);

/** Delivery attempt history — spec §63.10's resolution workflow needs each attempt visible, not just the current status. */
function DeliveryAttemptHistory({ orderId }: { orderId: string }) {
  const { data: attempts } = useOrderDeliveryAttempts(orderId);
  if (!attempts || attempts.length === 0) return null;

  return (
    <ul className="space-y-0.5">
      {attempts.map((a) => (
        <li key={a.id} className="text-[11px] text-charcoal-ink/55">
          Attempt {a.attempt_number}: {a.result === "delivered" ? "Delivered" : FAILURE_REASON_LABEL[a.failure_reason ?? "other"] ?? "Failed"}
          {" · "}
          {new Date(a.attempted_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
          {a.notes && ` · ${a.notes}`}
        </li>
      ))}
    </ul>
  );
}

function PharmacyOrdersWorklist() {
  const { data, isLoading, isError } = useOrgPharmacyOrders();
  const confirmDelivery = useConfirmPharmacyDelivery();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pharmacy orders</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load pharmacy orders.</p>}
        {data && data.length === 0 && <p className="text-sm text-charcoal-ink/60">No pharmacy orders yet.</p>}
        {data && data.length > 0 && (
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
                  {order.logistics_partner ? (
                    <div className="space-y-1.5">
                      <p className="text-xs text-charcoal-ink/60">
                        Courier: {order.logistics_partner.name}
                        {order.courier_reference && ` · Ref ${order.courier_reference}`}
                      </p>
                      <DeliveryAttemptHistory orderId={order.id} />
                      {order.status === "out_for_delivery" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={confirmDelivery.isPending}
                            onClick={() => confirmDelivery.mutate(order.id)}
                          >
                            {confirmDelivery.isPending ? "Saving…" : "Mark delivered"}
                          </Button>
                          <MarkFailedDeliveryForm orderId={order.id} />
                        </div>
                      )}
                      {order.status === "delivery_failed" && <AssignLogisticsForm order={order} isRetry />}
                    </div>
                  ) : (
                    (order.status === "payment_confirmed" ||
                      order.status === "confirmed" ||
                      order.status === "dispensed") && <AssignLogisticsForm order={order} />
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
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Home visits &amp; deliveries</h1>
        <p className="text-charcoal-ink/60">
          Assign a home-visit provider or courier once an order is paid. This is the mechanism
          that moves a pharmacy order through confirmed → out for delivery → delivered.
        </p>
      </div>
      <LabOrdersWorklist />
      <PharmacyOrdersWorklist />
    </div>
  );
}
