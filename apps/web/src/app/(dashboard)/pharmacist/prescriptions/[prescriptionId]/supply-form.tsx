"use client";

import { useState, type FormEvent } from "react";
import { useDispensePrescription } from "@/lib/pharmacy-collection/desk-queries";
import { CONTROLLED_AT_COUNTER_TEXT, dispenseProblem, NOTE_MAX, NOTE_MIN, type DispenseResult } from "@/lib/pharmacy-collection/model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PROBLEM_TEXT = {
  registration: "Check the PCN registration number: 3 to 40 letters, numbers, spaces, slashes, dots or hyphens.",
  pharmacist: "Enter the pharmacist name (2 to 120 characters).",
  note: `For a partial supply, write what is owed and when (${NOTE_MIN} to ${NOTE_MAX} characters).`,
  batch: "Enter the batch number and the expiry date of the pack. They are your record of what was handed over.",
} as const;
export const DISPENSE_TEXT: Record<string, string> = {
  recorded: "Recorded as supplied. The patient was told.",
  partial_recorded: "Recorded as a partial supply. It stays waiting for the rest.",
  not_found: "This prescription is no longer waiting at your pharmacy.",
  wrong_code: "The code is not right.",
  locked: "The code is locked. The patient must get a new code in the app.",
  expired: "The code has expired. The patient must get a new code in the app.",
  already_collected: "This was already collected.",
  invalid: "Check the pharmacist name and registration, the expiry date and, for a partial supply, the note about what is owed.",
  not_active: "This prescription is no longer active (replaced, stopped or expired). Do not supply it.",
  no_supply_available: "All the permitted supplies of this prescription have been recorded already. Do not supply it again.",
  no_medication: "This prescription cannot be supplied from here. Ask the prescriber.",
  batch_required: "Enter the batch number and the expiry date of the pack. They are your record of what was handed over.",
  batch_expired: "That pack has already expired, so it cannot be recorded as supplied.",
  controlled_medicine: CONTROLLED_AT_COUNTER_TEXT,
};

export interface Supplier {
  pharmacist: string;
  registration: string;
}

/**
 * One supply for one prescription: pharmacist, registration, quantity, batch and expiry, full or partial. Used on the single counter page and, once
 * per medicine, on the visit counter (S28e). The database re-checks the code, the controlled list and the shared supply count on every call, so nothing
 * here can be skipped by changing the page. `who` is shared across the items of a visit so the pharmacist types their name and number once.
 */
export function SupplyForm({ prescriptionId, code, who, onWho, idPrefix = "" }: { prescriptionId: string; code: string; who: Supplier; onWho: (next: Supplier) => void; idPrefix?: string }) {
  const dispense = useDispensePrescription();
  const [done, setDone] = useState<DispenseResult | null>(null);
  const [problem, setProblem] = useState<"registration" | "pharmacist" | "note" | "batch" | null>(null);
  const [partial, setPartial] = useState(false);
  const [f, setF] = useState({ quantity: "", note: "", batch: "", expiry: "" });
  const id = (name: string) => `${idPrefix}${name}`;

  function onSupply(e: FormEvent) {
    e.preventDefault();
    const p = dispenseProblem({ partial, note: f.note, registration: who.registration, pharmacist: who.pharmacist, batch: f.batch, expiry: f.expiry });
    setProblem(p);
    if (p) return;
    dispense.mutate(
      { prescription: prescriptionId, code, partial, quantity: f.quantity, note: f.note, batch: f.batch, expiry: f.expiry, registration: who.registration, pharmacist: who.pharmacist },
      { onSuccess: (r) => setDone(r) },
    );
  }

  if (done) {
    return (
      <p role="status" className={`rounded-lg px-3 py-2 text-sm ${done.outcome === "recorded" || done.outcome === "partial_recorded" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
        {DISPENSE_TEXT[done.outcome] ?? "Could not record the supply."}
      </p>
    );
  }
  return (
    <form onSubmit={onSupply} className="space-y-3 border-t border-charcoal-ink/10 pt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor={id("pharmacist")}>Pharmacist name</Label><Input id={id("pharmacist")} value={who.pharmacist} onChange={(e) => onWho({ ...who, pharmacist: e.target.value })} required /></div>
        <div className="space-y-1.5"><Label htmlFor={id("registration")}>PCN registration number</Label><Input id={id("registration")} value={who.registration} onChange={(e) => onWho({ ...who, registration: e.target.value })} required /></div>
        <div className="space-y-1.5"><Label htmlFor={id("quantity")}>Quantity supplied</Label><Input id={id("quantity")} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} maxLength={100} /></div>
        <div className="space-y-1.5"><Label htmlFor={id("batch")}>Batch number</Label><Input id={id("batch")} value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value })} maxLength={60} required /></div>
        <div className="space-y-1.5"><Label htmlFor={id("expiry")}>Expiry date of the pack</Label><Input id={id("expiry")} type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} required /></div>
      </div>
      <p className="text-xs text-charcoal-ink/70">The batch and expiry are your record of what you handed over. Tarragon Health does not check that a batch is genuine.</p>
      <label className="flex items-center gap-2"><input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> Partial supply: part of it is still owed</label>
      {partial && (
        <div className="space-y-1.5">
          <Label htmlFor={id("note")}>What is owed and when ({NOTE_MIN} to {NOTE_MAX} characters)</Label>
          <Input id={id("note")} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={NOTE_MAX} />
        </div>
      )}
      {problem && <p role="alert" className="text-sm text-red-600">{PROBLEM_TEXT[problem]}</p>}
      {dispense.isError && <p role="alert" className="text-sm text-red-600">{(dispense.error as Error).message || "Could not record the supply."}</p>}
      <Button type="submit" disabled={dispense.isPending}>{dispense.isPending ? "Recording…" : partial ? "Record partial supply" : "Record supply"}</Button>
    </form>
  );
}
