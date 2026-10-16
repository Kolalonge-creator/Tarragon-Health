"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useVerifyVisit } from "@/lib/pharmacy-collection/desk-queries";
import { CONTROLLED_AT_COUNTER_TEXT, type VisitItem } from "@/lib/pharmacy-collection/model";
import { itemLine } from "@/lib/pharmacy-flags/model";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SupplyForm, type Supplier } from "../../[prescriptionId]/supply-form";

const VERIFY_TEXT: Record<string, string> = {
  not_found: "This visit was not sent to your pharmacy, or nothing in it is waiting any more.",
  wrong_code: "That code is not right. Check it with the patient and try again. Too many wrong tries lock the code for the whole visit.",
  locked: "The code is locked after too many wrong tries. The patient must get a new code in the app.",
  expired: "The code has expired. The patient must get a new code in the app.",
  already_collected: "This was already collected.",
};
const ITEM_TEXT: Record<string, string> = {
  controlled_medicine: CONTROLLED_AT_COUNTER_TEXT,
  no_medication: "This prescription cannot be supplied from here. Ask the prescriber.",
};

/**
 * S28e (OQ-275): the counter for a visit, several prescriptions the patient sent together under one code. The code is checked once. Each medicine
 * then stands on its own: its own supply form (full or partial), its own batch and expiry, its own controlled-medicine check, and the same shared
 * supply count the single counter uses. One medicine being refused never stops the others. English only (staff page, as OQ-102).
 */
export function VisitDesk({ visitId }: { visitId: string }) {
  const verify = useVerifyVisit();
  const [code, setCode] = useState("");
  const [rows, setRows] = useState<VisitItem[] | null>(null);
  const [who, setWho] = useState<Supplier>({ pharmacist: "", registration: "" });

  function onCheck(e: FormEvent) {
    e.preventDefault();
    setRows(null);
    verify.mutate({ visit: visitId, code }, { onSuccess: (d) => setRows(d) });
  }

  const failure = rows && rows[0]?.outcome !== "ok" ? rows[0].outcome : null;
  const items = rows && !failure ? rows : [];
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader><CardTitle>Check the visit code</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-charcoal-ink/70">The patient sent several medicines together. One code covers the visit. Each medicine is checked and supplied on its own.</p>
          <form onSubmit={onCheck} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="visit_code">Code the patient shows</Label>
              <Input id="visit_code" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} className="w-48 font-mono uppercase" required />
            </div>
            <Button type="submit" disabled={verify.isPending}>{verify.isPending ? "Checking…" : "Check code"}</Button>
          </form>
          {verify.isError && <p role="alert" className="mt-2 text-sm text-red-600">{(verify.error as Error).message || "Could not check the code."}</p>}
          {failure && <p role="status" className="mt-2 text-sm text-amber-800">{VERIFY_TEXT[failure] ?? "Could not check the code."}</p>}
        </CardContent>
      </Card>

      {items.map((it) => (
        <Card key={it.prescription_id ?? "none"}>
          <CardHeader>
            <CardTitle>
              {it.item_outcome === "ok" ? (
                <>{it.patient_name ?? "Patient"} <span className="text-sm font-normal text-charcoal-ink/60">{it.patient_number ?? ""}</span></>
              ) : (
                "This medicine cannot be supplied"
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {it.item_outcome !== "ok" ? (
              <p role="status" className="text-amber-800">{ITEM_TEXT[it.item_outcome ?? ""] ?? "This medicine cannot be supplied from here. Ask the prescriber."}</p>
            ) : (
              <>
                <ul className="list-disc pl-5">{(it.items ?? []).map((x, i) => <li key={i}>{itemLine(x)}</li>)}</ul>
                <p>
                  <span className="font-semibold">Allergies on file: </span>
                  {(it.allergies ?? []).length === 0 ? "none recorded" : (it.allergies ?? []).map((a) => [a.allergen, a.reaction, a.severity].filter(Boolean).join(" / ")).join("; ")}
                </p>
                <p>Supplies recorded: {it.supplies_dispensed} of {it.supplies_permitted}.{it.outstanding_note ? ` Owed from before: ${it.outstanding_note}` : ""}</p>
                {it.prescription_id && <SupplyForm prescriptionId={it.prescription_id} code={code} who={who} onWho={setWho} idPrefix={`${it.prescription_id}-`} />}
              </>
            )}
          </CardContent>
        </Card>
      ))}
      <p><Link href="/pharmacist/prescriptions" className="text-sm font-semibold text-brand-green underline">Back to the list</Link></p>
    </div>
  );
}
