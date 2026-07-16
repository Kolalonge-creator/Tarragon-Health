"use client";

import { useState } from "react";
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

type OrderRow = {
  order_id: string;
  order_number: string | null;
  status: string;
  patient_name: string | null;
  patient_number: string | null;
  items: unknown;
  requested_at: string;
};

function itemsSummary(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((i) => {
      const it = i as { drug_name?: string; quantity?: number };
      return it.drug_name ? `${it.drug_name}${it.quantity ? ` × ${it.quantity}` : ""}` : "";
    })
    .filter(Boolean)
    .join(", ");
}

function OrderCard({ order }: { order: OrderRow }) {
  const [expanded, setExpanded] = useState(false);
  const { data: allergies } = usePharmacistOrderAllergies(order.order_id, expanded);
  const { data: medications } = usePharmacistOrderMedications(order.order_id, expanded);
  const record = usePharmacistRecordDispense();

  const [drugName, setDrugName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [dispensedOn, setDispensedOn] = useState(
    new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }),
  );

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-charcoal-ink">
          {order.patient_name ?? "Patient"}
          {order.patient_number ? ` · ${order.patient_number}` : ""}
        </span>
        {order.order_number && (
          <Badge variant="blue">{order.order_number}</Badge>
        )}
      </div>
      <p className="text-xs text-charcoal-ink/60">{itemsSummary(order.items)}</p>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-charcoal-ink/70"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? "Hide" : "Show"} allergies & current medications
      </Button>

      {expanded && (
        <div className="space-y-2 rounded-md bg-charcoal-ink/5 p-3">
          <div>
            <p className="text-xs font-medium text-charcoal-ink/70">Allergies</p>
            {allergies && allergies.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {allergies.map((a, i) => (
                  <li key={i} className="text-sm text-red-700">
                    {a.allergen}
                    {a.severity ? ` (${a.severity})` : ""}
                    {a.reaction ? ` — ${a.reaction}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-charcoal-ink/60">No known allergies on file.</p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-charcoal-ink/70">Current medications</p>
            {medications && medications.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {medications.map((m, i) => (
                  <li key={i} className="text-sm text-charcoal-ink">
                    {m.drug_name}
                    {m.dose ? ` — ${m.dose}` : ""}
                    {m.frequency ? ` (${m.frequency})` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-charcoal-ink/60">None on file.</p>
            )}
          </div>

          <div className="border-t border-charcoal-ink/10 pt-2">
            <p className="text-xs font-medium text-charcoal-ink/70">Record dispensed</p>
            <div className="mt-1 flex flex-wrap items-end gap-2">
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
                variant="outline"
                disabled={record.isPending || !drugName.trim()}
                onClick={() =>
                  record.mutate(
                    { orderId: order.order_id, drugName: drugName.trim(), quantity: quantity.trim(), dispensedOn },
                    { onSuccess: () => { setDrugName(""); setQuantity(""); } },
                  )
                }
              >
                {record.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
            {record.isError && (
              <p className="mt-1 text-xs text-red-600">Could not record. Try again.</p>
            )}
            {record.isSuccess && !record.isPending && (
              <p className="mt-1 text-xs text-brand-green">Recorded.</p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function PharmacistWorklist() {
  const { data, isLoading, isError } = usePharmacistOrders();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Orders to fulfil</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load your orders.</p>}
          {data && data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No orders routed to your pharmacy yet.</p>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {(data as OrderRow[]).map((order) => (
                <OrderCard key={order.order_id} order={order} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
