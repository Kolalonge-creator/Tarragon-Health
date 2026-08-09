"use client";

import { useMemo, useState } from "react";
import {
  usePharmacistOrders,
  usePharmacistOrderAllergies,
  usePharmacistOrderMedications,
  usePharmacistRecordDispense,
} from "@/lib/queries/pharmacist";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { itemsSummary, type PharmacistOrderRow } from "../_lib/items";
import { statusMeta, isOpenStatus, isAwaitingStatus } from "../_lib/order-status";
import { formatRequestedAt } from "../_lib/format";

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
