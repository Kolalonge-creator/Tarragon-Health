"use client";

import { usePharmacistDispenseHistory } from "@/lib/queries/pharmacist";

export function PharmacistHistory() {
  const { data, isLoading, isError } = usePharmacistDispenseHistory();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-charcoal-ink/60">Everything dispensed against orders at your pharmacy.</p>

      <div className="overflow-hidden rounded-xl border border-charcoal-ink/10 bg-white shadow-sm">
        <div className="grid grid-cols-[1.3fr_1.3fr_0.7fr_1fr] gap-2.5 bg-warm-ivory px-5 py-2.5 text-[11px] font-bold uppercase tracking-wide text-charcoal-ink/50">
          <div>Patient</div>
          <div>Medication</div>
          <div>Qty</div>
          <div>Dispensed on</div>
        </div>

        {isLoading && <p className="px-5 py-5 text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="px-5 py-5 text-sm text-red-600">Could not load your dispensing history.</p>}
        {!isLoading && !isError && (data ?? []).length === 0 && (
          <p className="px-5 py-5 text-sm text-charcoal-ink/60">Nothing dispensed yet.</p>
        )}
        {(data ?? []).map((d) => (
          <div
            key={d.dispense_id}
            className="grid grid-cols-[1.3fr_1.3fr_0.7fr_1fr] items-center gap-2.5 border-t border-charcoal-ink/[0.06] px-5 py-3 text-sm"
          >
            <div className="font-medium text-charcoal-ink">{d.patient_name ?? "Patient"}</div>
            <div className="text-charcoal-ink/65">{d.drug_name}</div>
            <div className="text-charcoal-ink/65">{d.quantity ?? "—"}</div>
            <div className="text-xs text-charcoal-ink/50">
              {new Date(d.dispensed_on).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
