"use client";

import { useMemo, useState } from "react";
import {
  usePharmacistOrders,
  usePharmacistOrderAllergies,
  usePharmacistOrderMedications,
  usePharmacistRecordDispense,
  usePharmacistAcceptOrder,
  usePharmacistDeclineOrder,
} from "@/lib/queries/pharmacist";
import { assessAllergyFindings, type AllergyInput, type MedicationInput } from "@/lib/rules/drug-safety";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { itemsSummary, type PharmacistOrderRow } from "../_lib/items";
import { statusMeta, isOpenStatus, isAwaitingStatus, needsPharmacistResponse } from "../_lib/order-status";
import { formatRequestedAt } from "../_lib/format";

/** Naira display for a kobo amount, e.g. 150000 -> "₦1,500.00". */
function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

/**
 * Pharmacy Engine spec §12.5 — accept (confirm availability/quantity/price/
 * fulfilment time) or decline (out of stock) a paid order awaiting response.
 * Shown only while needsPharmacistResponse(order.status) is true; the
 * "Record dispensed" section below stays available regardless, since a
 * pharmacist might dispense without ever using this app (the no-login SMS/
 * email fulfilment path CLAUDE.md documents) and this form must not become
 * the only way an order can move forward.
 */
function AcceptDeclineForm({ order }: { order: PharmacistOrderRow }) {
  const accept = usePharmacistAcceptOrder();
  const decline = usePharmacistDeclineOrder();
  const [mode, setMode] = useState<"accept" | "decline" | null>(null);
  const [confirmedQuantity, setConfirmedQuantity] = useState("");
  const [confirmedPrice, setConfirmedPrice] = useState(
    order.payable_kobo != null ? String(order.payable_kobo / 100) : "",
  );
  const [fulfilmentAt, setFulfilmentAt] = useState("");
  const [declineReason, setDeclineReason] = useState("");

  if (mode === null) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
        <p className="flex-1 text-xs text-amber-900">
          Paid{order.payable_kobo != null ? ` · ${formatNaira(order.payable_kobo)}` : ""}. Confirm
          you can fulfil this, or decline if it&apos;s out of stock.
        </p>
        <Button type="button" size="sm" onClick={() => setMode("accept")}>
          Accept
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setMode("decline")}>
          Decline
        </Button>
      </div>
    );
  }

  if (mode === "accept") {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-charcoal-ink/15 bg-charcoal-ink/[0.03] p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-32 flex-1 space-y-1">
            <Label htmlFor={`acc_qty_${order.order_id}`} className="text-xs">
              Confirmed quantity
            </Label>
            <Input
              id={`acc_qty_${order.order_id}`}
              value={confirmedQuantity}
              onChange={(e) => setConfirmedQuantity(e.target.value)}
              className="h-8 text-xs"
              placeholder="e.g. 30 tablets"
            />
          </div>
          <div className="w-32 space-y-1">
            <Label htmlFor={`acc_price_${order.order_id}`} className="text-xs">
              Price (₦)
            </Label>
            <Input
              id={`acc_price_${order.order_id}`}
              type="number"
              min={0}
              value={confirmedPrice}
              onChange={(e) => setConfirmedPrice(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="w-44 space-y-1">
            <Label htmlFor={`acc_eta_${order.order_id}`} className="text-xs">
              Ready by (optional)
            </Label>
            <Input
              id={`acc_eta_${order.order_id}`}
              type="datetime-local"
              value={fulfilmentAt}
              onChange={(e) => setFulfilmentAt(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>
        {confirmedPrice &&
          order.payable_kobo != null &&
          Math.round(Number(confirmedPrice) * 100) < order.payable_kobo && (
            <p className="text-[11px] text-amber-700">
              Lower than what the patient paid. The difference will be refunded automatically.
            </p>
          )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={accept.isPending || !confirmedQuantity.trim()}
            onClick={() =>
              accept.mutate({
                orderId: order.order_id,
                confirmedQuantity: confirmedQuantity.trim(),
                confirmedPriceKobo: confirmedPrice ? Math.round(Number(confirmedPrice) * 100) : null,
                estimatedFulfilmentAt: fulfilmentAt ? new Date(fulfilmentAt).toISOString() : null,
              })
            }
          >
            {accept.isPending ? "Confirming…" : "Confirm accept"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)}>
            Cancel
          </Button>
          {accept.isError && (
            <p className="text-xs text-red-600">{(accept.error as Error).message || "Could not accept."}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
      <Label htmlFor={`dec_reason_${order.order_id}`} className="text-xs">
        Why can&apos;t this be fulfilled?
      </Label>
      <Textarea
        id={`dec_reason_${order.order_id}`}
        value={declineReason}
        onChange={(e) => setDeclineReason(e.target.value)}
        className="min-h-8 text-xs"
        placeholder="e.g. Out of stock, no restock date"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={decline.isPending || !declineReason.trim()}
          onClick={() => decline.mutate({ orderId: order.order_id, reason: declineReason.trim() })}
        >
          {decline.isPending ? "Declining…" : "Confirm decline"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)}>
          Cancel
        </Button>
        {decline.isError && (
          <p className="text-xs text-red-600">{(decline.error as Error).message || "Could not decline."}</p>
        )}
      </div>
      <p className="text-[11px] text-red-700">
        The patient paid for this. Declining flags a full refund automatically.
      </p>
    </div>
  );
}

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "awaiting", label: "Awaiting" },
  { key: "all", label: "All" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function OrderCard({ order }: { order: PharmacistOrderRow }) {
  const [expanded, setExpanded] = useState(false);
  const { data: allergies } = usePharmacistOrderAllergies(order.order_id, expanded);
  const { data: medications } = usePharmacistOrderMedications(order.order_id, expanded);
  const record = usePharmacistRecordDispense();

  const [drugName, setDrugName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [dispensedOn, setDispensedOn] = useState(
    new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }),
  );

  const meta = statusMeta(order.status);

  // Point-of-dispense allergy check: cross-checks the drug about to be
  // dispensed, live, against this patient's recorded allergies and current
  // medications. Advisory only — it never blocks Save; the pharmacist decides.
  const dispenseAllergyWarnings = useMemo(() => {
    const typed = drugName.trim();
    if (!typed || !allergies || allergies.length === 0) return [];

    const allergyInputs: AllergyInput[] = allergies.map((a, i) => ({
      id: `a${i}`,
      allergen: a.allergen,
      reaction: a.reaction,
      severity: a.severity as AllergyInput["severity"],
    }));
    const currentMeds: MedicationInput[] = (medications ?? []).map((m, i) => ({
      id: `m${i}`,
      drugName: m.drug_name,
    }));
    const candidate: MedicationInput = { id: "__dispensing__", drugName: typed };

    return assessAllergyFindings([...currentMeds, candidate], allergyInputs).filter((f) =>
      f.medicationIds.includes("__dispensing__"),
    );
  }, [drugName, allergies, medications]);

  return (
    <li className="flex flex-col gap-2 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-charcoal-ink">
          {order.patient_name ?? "Patient"}
          {order.patient_number ? ` · ${order.patient_number}` : ""}
        </span>
        {order.order_number && <Badge variant="blue">{order.order_number}</Badge>}
        <Badge variant={meta.badge}>{meta.label}</Badge>
      </div>
      <p className="text-xs text-charcoal-ink/60">{itemsSummary(order.items)}</p>
      <p className="text-[11px] text-charcoal-ink/45">Requested {formatRequestedAt(order.requested_at)}</p>

      {needsPharmacistResponse(order.status) && <AcceptDeclineForm order={order} />}

      {order.status === "cancelled" && order.cancellation_reason && (
        <p className="text-xs text-charcoal-ink/50">
          Declined: {order.cancellation_reason}
        </p>
      )}
      {(order.status === "confirmed" ||
        order.status === "dispensed" ||
        order.status === "out_for_delivery" ||
        order.status === "delivered") &&
        order.confirmed_quantity && (
          <p className="text-xs text-charcoal-ink/50">
            Accepted: {order.confirmed_quantity}
            {order.estimated_fulfilment_at &&
              ` · ready by ${new Date(order.estimated_fulfilment_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`}
          </p>
        )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-fit px-0 text-xs font-semibold text-charcoal-ink/65 hover:bg-transparent hover:text-charcoal-ink"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? "Hide" : "Show"} allergies &amp; current medications
      </Button>

      {expanded && (
        <div className="flex flex-col gap-3 rounded-lg bg-charcoal-ink/[0.03] p-3.5">
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-charcoal-ink/55">Allergies</p>
            {allergies && allergies.length > 0 ? (
              <ul className="space-y-0.5">
                {allergies.map((a, i) => (
                  <li key={i} className="text-sm text-red-600">
                    {a.allergen}
                    {a.severity ? ` (${a.severity})` : ""}
                    {a.reaction ? `: ${a.reaction}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-charcoal-ink/50">No known allergies on file.</p>
            )}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-charcoal-ink/55">
              Current medications
            </p>
            {medications && medications.length > 0 ? (
              <ul className="space-y-0.5">
                {medications.map((m, i) => (
                  <li key={i} className="text-sm text-charcoal-ink">
                    {m.drug_name}
                    {m.dose ? `: ${m.dose}` : ""}
                    {m.frequency ? ` (${m.frequency})` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-charcoal-ink/50">None on file.</p>
            )}
          </div>

          <div className="border-t border-charcoal-ink/10 pt-2.5">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-charcoal-ink/55">
              Record dispensed
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1 space-y-1">
                <Label htmlFor={`d_drug_${order.order_id}`} className="text-xs">
                  Medication
                </Label>
                <Input
                  id={`d_drug_${order.order_id}`}
                  value={drugName}
                  onChange={(e) => setDrugName(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="w-20 space-y-1">
                <Label htmlFor={`d_qty_${order.order_id}`} className="text-xs">
                  Qty
                </Label>
                <Input
                  id={`d_qty_${order.order_id}`}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="w-36 space-y-1">
                <Label htmlFor={`d_date_${order.order_id}`} className="text-xs">
                  Date
                </Label>
                <Input
                  id={`d_date_${order.order_id}`}
                  type="date"
                  value={dispensedOn}
                  onChange={(e) => setDispensedOn(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <Button
                size="sm"
                disabled={record.isPending || !drugName.trim()}
                onClick={() =>
                  record.mutate(
                    { orderId: order.order_id, drugName: drugName.trim(), quantity: quantity.trim(), dispensedOn },
                    { onSuccess: () => { setDrugName(""); setQuantity(""); } },
                  )
                }
              >
                {record.isPending ? "Saving…" : order.status === "dispensed" ? "Log another" : "Save"}
              </Button>
            </div>
            {dispenseAllergyWarnings.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {dispenseAllergyWarnings.map((finding, i) => (
                  <li
                    key={`${finding.title}-${i}`}
                    className={cn(
                      "rounded border p-2 text-xs leading-relaxed",
                      finding.severity === "contraindicated"
                        ? "border-red-300 bg-red-50 text-red-900"
                        : finding.severity === "caution"
                          ? "border-amber-300 bg-amber-50 text-amber-900"
                          : "border-charcoal-ink/15 bg-charcoal-ink/[0.03] text-charcoal-ink/70",
                    )}
                  >
                    <span className="font-semibold">{finding.title}.</span> {finding.message}
                  </li>
                ))}
              </ul>
            )}
            {record.isError && <p className="mt-1.5 text-xs text-red-600">Could not record. Try again.</p>}
            {record.isSuccess && !record.isPending && (
              <p className="mt-1.5 text-xs text-brand-green">Recorded.</p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function PharmacistOrders() {
  const { data, isLoading, isError } = usePharmacistOrders();
  const [filter, setFilter] = useState<FilterKey>("open");

  const visibleOrders = useMemo(() => {
    const rows = (data ?? []) as PharmacistOrderRow[];
    if (filter === "all") return rows;
    if (filter === "open") return rows.filter((o) => isOpenStatus(o.status));
    return rows.filter((o) => isAwaitingStatus(o.status));
  }, [data, filter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-brand-green/15 bg-brand-green/5 p-4 text-[13px] leading-relaxed text-charcoal-ink/70">
        Orders routed to your pharmacy. Check allergies and current medications before dispensing, then log what
        was given.
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors",
              filter === f.key
                ? "border-brand-green bg-brand-green text-white"
                : "border-charcoal-ink/15 bg-white text-charcoal-ink hover:bg-charcoal-ink/5",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="sr-only">
          <CardTitle>Orders</CardTitle>
        </CardHeader>
        <CardContent className="p-0 px-5">
          {isLoading && <p className="py-5 text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="py-5 text-sm text-red-600">Could not load your orders.</p>}
          {!isLoading && !isError && visibleOrders.length === 0 && (
            <p className="py-5 text-sm text-charcoal-ink/60">No orders in this filter.</p>
          )}
          {visibleOrders.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {visibleOrders.map((order) => (
                <OrderCard key={order.order_id} order={order} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
