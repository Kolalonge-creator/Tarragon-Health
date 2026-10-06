"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dispensePrescription, flagPrescription, openPharmacyPrescription } from "@/lib/pharmacy-collection/actions";
import { answerText, QUESTION_REASONS, questionText, type InboxRow, type PharmacyPrescriptionDetail } from "@/lib/pharmacy-collection/collection";

export type { InboxRow } from "@/lib/pharmacy-collection/collection";

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }) : "";
}

function Detail({ row, onClose }: { row: InboxRow; onClose: () => void }) {
  const router = useRouter();
  const [detail, setDetail] = useState<PharmacyPrescriptionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [partial, setPartial] = useState(false);
  const [asking, setAsking] = useState(false);

  function open() {
    setError(null);
    startTransition(async () => {
      const r = await openPharmacyPrescription(row.prescription_id);
      if (r.ok) setDetail(r.detail);
      else setError(r.error);
    });
  }

  function dispense(form: FormData) {
    setError(null);
    setNotice(null);
    const text = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
    };
    startTransition(async () => {
      const r = await dispensePrescription({
        prescriptionId: row.prescription_id,
        code: text("code") ?? "",
        pharmacistName: text("pharmacistName") ?? "",
        registration: text("registration"),
        quantity: text("quantity"),
        batchNumber: text("batchNumber"),
        batchExpiry: text("batchExpiry"),
        partial,
        note: text("note"),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNotice(r.partial ? "Partial supply recorded. The prescription stays open." : "Supply recorded.");
      router.refresh();
    });
  }

  function flag(input: { kind: "out_of_stock" } | { kind: "query_to_prescriber"; reason: string }) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await flagPrescription({ prescriptionId: row.prescription_id, ...input });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNotice(input.kind === "out_of_stock" ? "The patient has been asked to choose another pharmacy." : "Your question has been sent to the prescriber.");
      setAsking(false);
      router.refresh();
    });
  }

  if (!detail) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-charcoal-ink/70">Opening a prescription is recorded in the audit log.</p>
        <div className="flex gap-2">
          <Button type="button" disabled={pending} onClick={open}>
            {pending ? "Opening" : "Open prescription"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  const waiting = detail.state === "sent";
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {detail.patient.full_name ?? "Patient"}
          {detail.patient.age_years !== null ? `, ${detail.patient.age_years} years` : ""}
        </p>
        <p className="text-xs text-charcoal-ink/70">
          Signed {when(detail.signed_at)}
          {detail.signed_by_name ? ` by ${detail.signed_by_name}` : ""}. Supplies recorded: {detail.supplies_recorded} of {detail.supplies_permitted}.
        </p>
        {detail.is_test && <Badge>Test</Badge>}
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/60">Allergies on record</p>
        {detail.allergies.length === 0 ? (
          <p className="text-sm">None recorded. Please still ask the patient.</p>
        ) : (
          <ul className="text-sm">
            {detail.allergies.map((a, i) => (
              <li key={i}>
                {a.allergen}
                {a.severity ? ` (${a.severity})` : ""}
                {a.reaction ? `: ${a.reaction}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ul className="divide-y divide-charcoal-ink/10">
        {detail.items.map((it, i) => (
          <li key={i} className="space-y-0.5 py-2">
            <p className="text-sm font-medium">
              {it.drug_name}
              {it.dose ? `, ${it.dose}` : ""}
            </p>
            <p className="text-sm">
              {[it.frequency, it.route, it.duration_days ? `${it.duration_days} days` : null, it.quantity ? `quantity ${it.quantity}` : null]
                .filter(Boolean)
                .join(", ")}
            </p>
            {it.instructions && <p className="text-xs text-charcoal-ink/70">{it.instructions}</p>}
          </li>
        ))}
      </ul>

      {detail.questions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/60">Your questions to the prescriber</p>
          <ul className="text-sm">
            {detail.questions.map((q, i) => (
              <li key={i}>
                {questionText(q.reason_code)}, asked {when(q.asked_at)}.{" "}
                {q.answered_at ? `Answer: ${answerText(q.answer_code)}.` : "Not answered yet."}
              </li>
            ))}
          </ul>
          <p className="text-xs text-charcoal-ink/70">An answer never changes the signed prescription. If it is changed, a new prescription is sent.</p>
        </div>
      )}

      {waiting && (
        <>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              // onSubmit, not a form action: a form action clears every field when it finishes, which would wipe what the
              // pharmacist typed after a wrong code.
              e.preventDefault();
              dispense(new FormData(e.currentTarget));
            }}
          >
            <p className="text-sm font-medium">Record the supply</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="code">Collection code the patient shows</Label>
                <Input id="code" name="code" autoComplete="off" required className="font-mono uppercase" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pharmacistName">Pharmacist name</Label>
                <Input id="pharmacistName" name="pharmacistName" required minLength={2} maxLength={120} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="registration">PCN registration (optional)</Label>
                <Input id="registration" name="registration" maxLength={40} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="quantity">Quantity supplied (optional)</Label>
                <Input id="quantity" name="quantity" maxLength={100} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="batchNumber">Batch number</Label>
                <Input id="batchNumber" name="batchNumber" maxLength={60} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="batchExpiry">Batch expiry</Label>
                <Input id="batchExpiry" name="batchExpiry" type="date" required />
              </div>
            </div>
            <p className="text-xs text-charcoal-ink/70">
              The batch and expiry are your record of what you handed over. Tarragon Health does not check that a batch is genuine.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={partial} onChange={(e) => setPartial(e.target.checked)} />
              Partial supply (some items are outstanding)
            </label>
            {partial && (
              <div className="space-y-1">
                <Label htmlFor="note">What is outstanding</Label>
                <Textarea id="note" name="note" maxLength={500} required />
              </div>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Saving" : partial ? "Record partial supply" : "Mark dispensed"}
            </Button>
          </form>

          <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
            <p className="text-sm font-medium">Something wrong?</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={() => flag({ kind: "out_of_stock" })}>
                We cannot supply this (out of stock)
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setAsking((a) => !a)}>
                Ask the prescriber a question
              </Button>
            </div>
            {asking && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const reason = new FormData(e.currentTarget).get("question");
                  if (typeof reason === "string" && reason !== "") flag({ kind: "query_to_prescriber", reason });
                }}
              >
                <Label htmlFor="question">What do you need to ask the prescriber?</Label>
                <select id="question" name="question" required defaultValue="" className="min-h-11 w-full rounded-md border border-charcoal-ink/20 bg-transparent px-3 text-sm">
                  <option value="" disabled>
                    Choose one
                  </option>
                  {Object.entries(QUESTION_REASONS).map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-charcoal-ink/70">Questions are a fixed list so nothing about the patient is typed into a message. The prescriber answers from a fixed list too.</p>
                <Button type="submit" disabled={pending}>
                  Send question
                </Button>
              </form>
            )}
          </div>
        </>
      )}

      {!waiting && <p className="text-sm">Dispensed {when(detail.dispensed_at)}.</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <Button type="button" variant="outline" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

export function PharmacistPrescriptions({ rows }: { rows: InboxRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const waiting = rows.filter((r) => r.state === "sent");
  const done = rows.filter((r) => r.state === "dispensed");

  const renderRow = (r: InboxRow) => (
    <li key={r.prescription_id} className="space-y-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <p className="font-mono text-lg font-semibold tracking-widest">{r.collection_code ?? "........"}</p>
          <p className="text-sm text-charcoal-ink/70">
            {r.first_name || "Patient"}, {r.medicine_count} {r.medicine_count === 1 ? "medicine" : "medicines"}.{" "}
            {r.state === "sent" ? `Sent ${when(r.sent_at)}` : `Dispensed ${when(r.dispensed_at)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {r.is_test && <Badge>Test</Badge>}
          {r.has_open_flag && <Badge>Question open</Badge>}
          {openId !== r.prescription_id && (
            <Button type="button" variant="outline" onClick={() => setOpenId(r.prescription_id)}>
              Open
            </Button>
          )}
        </div>
      </div>
      {openId === r.prescription_id && <Detail row={r} onClose={() => setOpenId(null)} />}
    </li>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Waiting for collection</CardTitle>
        </CardHeader>
        <CardContent>
          {waiting.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">Nothing is waiting. A prescription appears here when a patient chooses your pharmacy.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">{waiting.map(renderRow)}</ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Dispensed in the last 14 days</CardTitle>
        </CardHeader>
        <CardContent>
          {done.length === 0 ? <p className="text-sm text-charcoal-ink/70">Nothing yet.</p> : <ul className="divide-y divide-charcoal-ink/10">{done.map(renderRow)}</ul>}
        </CardContent>
      </Card>
    </div>
  );
}
