"use client";

import { useMemo, useState } from "react";
import {
  usePharmacistOrders,
  usePharmacistOrderAllergies,
  usePharmacistOrderMedications,
  usePharmacistRecordDispense,
  usePharmacistAcceptOrder,
  usePharmacistFlagUnavailable,
} from "@/lib/queries/pharmacist";
import { assessAllergyFindings, type AllergyInput, type MedicationInput } from "@/lib/rules/drug-safety";
import { controlledSubstanceInfo } from "@/lib/rules/controlled-substances";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { itemsSummary, type PharmacistOrderRow } from "../_lib/items";
import { statusMeta, isOpenStatus, isAwaitingStatus } from "../_lib/order-status";
import { formatRequestedAt } from "../_lib/format";

const CAN_ACCEPT = new Set(["requested", "payment_confirmed"]);
const CAN_FLAG_UNAVAILABLE = new Set(["requested", "payment_confirmed", "confirmed"]);

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
  const accept = usePharmacistAcceptOrder();
  const flagUnavailable = usePharmacistFlagUnavailable();

  const [drugName, setDrugName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [dispensedOn, setDispensedOn] = useState(
    new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }),
  );
  const [quantityPrescribed, setQuantityPrescribed] = useState("");
  const [isPartial, setIsPartial] = useState(false);
  const [outstandingNote, setOutstandingNote] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [isSubstitution, setIsSubstitution] = useState(false);
  const [substitutedFor, setSubstitutedFor] = useState("");
  const [substitutionReason, setSubstitutionReason] = useState("");
  const [enhancedVerificationConfirmed, setEnhancedVerificationConfirmed] = useState(false);
  const [unavailableOpen, setUnavailableOpen] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState("");

  const controlledInfo = useMemo(() => controlledSubstanceInfo(drugName), [drugName]);

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

      {CAN_ACCEPT.has(order.status) && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={accept.isPending}
            onClick={() => accept.mutate(order.order_id)}
          >
            {accept.isPending ? "Accepting…" : "Accept order"}
          </Button>
          {accept.isError && <p className="text-xs text-red-600">Could not accept. Try again.</p>}
        </div>
      )}

      {CAN_FLAG_UNAVAILABLE.has(order.status) && (
        <div>
          {!unavailableOpen ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-fit px-0 text-xs font-semibold text-red-700 hover:bg-transparent hover:text-red-800"
              onClick={() => setUnavailableOpen(true)}
            >
              Medicine unavailable
            </Button>
          ) : (
            <div className="flex flex-wrap items-end gap-2 rounded-md bg-red-50 p-2">
              <div className="min-w-48 flex-1 space-y-1">
                <Label htmlFor={`unavail_reason_${order.order_id}`} className="text-xs">
                  Why can&apos;t this be fulfilled as prescribed?
                </Label>
                <Input
                  id={`unavail_reason_${order.order_id}`}
                  value={unavailableReason}
                  onChange={(e) => setUnavailableReason(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="e.g. Out of stock, discontinued…"
                />
              </div>
              <Button
                size="sm"
                disabled={flagUnavailable.isPending || !unavailableReason.trim()}
                onClick={() =>
                  flagUnavailable.mutate(
                    { orderId: order.order_id, reason: unavailableReason.trim() },
                    { onSuccess: () => setUnavailableOpen(false) },
                  )
                }
              >
                {flagUnavailable.isPending ? "Saving…" : "Confirm"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setUnavailableOpen(false)}>
                Cancel
              </Button>
              {flagUnavailable.isError && (
                <p className="basis-full text-xs text-red-600">Could not save. Try again.</p>
              )}
            </div>
          )}
        </div>
      )}

      {order.status === "unavailable" && (
        <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          Flagged unavailable. A substitution can still be dispensed below once agreed with the prescriber.
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
              <div className="w-24 space-y-1">
                <Label htmlFor={`d_qty_prescribed_${order.order_id}`} className="text-xs">
                  Prescribed
                </Label>
                <Input
                  id={`d_qty_prescribed_${order.order_id}`}
                  value={quantityPrescribed}
                  onChange={(e) => setQuantityPrescribed(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="e.g. 30"
                />
              </div>
              <div className="w-24 space-y-1">
                <Label htmlFor={`d_qty_${order.order_id}`} className="text-xs">
                  Dispensed
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
              <div className="w-32 space-y-1">
                <Label htmlFor={`d_batch_${order.order_id}`} className="text-xs">
                  Batch (optional)
                </Label>
                <Input
                  id={`d_batch_${order.order_id}`}
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <label className="mt-2 flex items-center gap-1.5 text-xs text-charcoal-ink/70">
              <input
                type="checkbox"
                checked={isPartial}
                onChange={(e) => setIsPartial(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              This only partially fills the prescription
            </label>
            {isPartial && (
              <div className="mt-1.5 space-y-1">
                <Label htmlFor={`d_outstanding_${order.order_id}`} className="text-xs">
                  Outstanding note (e.g. &quot;10 tablets outstanding, restock expected Friday&quot;)
                </Label>
                <Textarea
                  id={`d_outstanding_${order.order_id}`}
                  value={outstandingNote}
                  onChange={(e) => setOutstandingNote(e.target.value)}
                  className="min-h-14 text-xs"
                />
              </div>
            )}

            <label className="mt-2 flex items-center gap-1.5 text-xs text-charcoal-ink/70">
              <input
                type="checkbox"
                checked={isSubstitution}
                onChange={(e) => setIsSubstitution(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Dispensing a substitute for the prescribed medicine
            </label>
            {isSubstitution && (
              <div className="mt-1.5 flex flex-wrap items-end gap-2">
                <div className="min-w-40 flex-1 space-y-1">
                  <Label htmlFor={`d_sub_for_${order.order_id}`} className="text-xs">
                    Originally prescribed
                  </Label>
                  <Input
                    id={`d_sub_for_${order.order_id}`}
                    value={substitutedFor}
                    onChange={(e) => setSubstitutedFor(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="min-w-40 flex-1 space-y-1">
                  <Label htmlFor={`d_sub_reason_${order.order_id}`} className="text-xs">
                    Reason (prescriber involvement confirmed where required)
                  </Label>
                  <Input
                    id={`d_sub_reason_${order.order_id}`}
                    value={substitutionReason}
                    onChange={(e) => setSubstitutionReason(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )}

            {controlledInfo && (
              <div
                className={cn(
                  "mt-2 rounded border p-2 text-xs leading-relaxed",
                  controlledInfo.tier === "narcotic"
                    ? "border-red-300 bg-red-50 text-red-900"
                    : "border-amber-300 bg-amber-50 text-amber-900",
                )}
              >
                <p className="font-semibold">{controlledInfo.label} — enhanced verification required.</p>
                <p className="mt-0.5">{controlledInfo.note}</p>
                <label className="mt-1.5 flex items-center gap-1.5 font-medium">
                  <input
                    type="checkbox"
                    checked={enhancedVerificationConfirmed}
                    onChange={(e) => setEnhancedVerificationConfirmed(e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  I confirm the additional safeguard above for this controlled/restricted medicine
                </label>
              </div>
            )}

            <div className="mt-2">
              <Button
                size="sm"
                disabled={
                  record.isPending || !drugName.trim() || (!!controlledInfo && !enhancedVerificationConfirmed)
                }
                onClick={() =>
                  record.mutate(
                    {
                      orderId: order.order_id,
                      drugName: drugName.trim(),
                      quantity: quantity.trim(),
                      dispensedOn,
                      quantityPrescribed: quantityPrescribed.trim() || undefined,
                      isPartial,
                      outstandingNote: isPartial ? outstandingNote.trim() || undefined : undefined,
                      batchNumber: batchNumber.trim() || undefined,
                      substitutedFor: isSubstitution ? substitutedFor.trim() || undefined : undefined,
                      substitutionReason: isSubstitution ? substitutionReason.trim() || undefined : undefined,
                      controlledTier: controlledInfo?.tier ?? null,
                      enhancedVerificationConfirmed,
                    },
                    {
                      onSuccess: () => {
                        setDrugName("");
                        setQuantity("");
                        setQuantityPrescribed("");
                        setIsPartial(false);
                        setOutstandingNote("");
                        setBatchNumber("");
                        setIsSubstitution(false);
                        setSubstitutedFor("");
                        setSubstitutionReason("");
                        setEnhancedVerificationConfirmed(false);
                      },
                    },
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
