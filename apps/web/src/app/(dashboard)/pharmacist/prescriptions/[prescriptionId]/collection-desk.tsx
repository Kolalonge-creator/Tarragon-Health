"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useAskPrescriber, usePrescriptionQuestions, useReportOutOfStock, useVerifyCollection } from "@/lib/pharmacy-collection/desk-queries";
import { answerText, CONTROLLED_AT_COUNTER_TEXT, QUESTION_REASONS, questionText, type DeskVerification } from "@/lib/pharmacy-collection/model";
import { itemLine } from "@/lib/pharmacy-flags/model";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DISPENSE_TEXT, SupplyForm, type Supplier } from "./supply-form";

const VERIFY_TEXT: Record<string, string> = {
  not_found: "This prescription was not sent to your pharmacy, or it is no longer waiting.",
  wrong_code: "That code is not right. Check it with the patient and try again. Too many wrong tries lock the code.",
  locked: "The code is locked after too many wrong tries. The patient must get a new code in the app.",
  expired: "The code has expired. The patient must get a new code in the app.",
  already_collected: "This was already collected.",
  controlled_medicine: CONTROLLED_AT_COUNTER_TEXT,
  no_medication: DISPENSE_TEXT.no_medication,
};

/**
 * S28c: a question to the prescriber is one of six, chosen from a list, and the answer is one of three. No free text, no chat. An answer never
 * changes the signed prescription: if the medicine or dose changes, a new prescription is sent.
 */
function Questions({ prescriptionId }: { prescriptionId: string }) {
  const questions = usePrescriptionQuestions(prescriptionId);
  const ask = useAskPrescriber(prescriptionId);
  const stock = useReportOutOfStock(prescriptionId);
  const [choice, setChoice] = useState("");
  const [sentStock, setSentStock] = useState(false);
  return (
    <Card>
      <CardHeader><CardTitle>Something wrong?</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        {questions.isError && <p role="alert" className="text-red-600">Your earlier questions could not be loaded just now.</p>}
        {questions.data && questions.data.length > 0 && (
          <ul className="space-y-1">
            {questions.data.map((q, i) => (
              <li key={i}>{questionText(q.question_code)}. {q.answered_at ? `Answer: ${answerText(q.answer_code)}.` : "Not answered yet."}</li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (choice) ask.mutate(choice, { onSuccess: () => setChoice("") });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="question">What do you need to ask the prescriber?</Label>
            <select id="question" value={choice} onChange={(e) => setChoice(e.target.value)} required className="min-h-11 w-72 rounded-md border border-charcoal-ink/20 bg-transparent px-3 text-sm">
              <option value="" disabled>Choose one</option>
              {Object.entries(QUESTION_REASONS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </div>
          <Button type="submit" disabled={ask.isPending || !choice}>{ask.isPending ? "Sending…" : "Send question"}</Button>
        </form>
        <p className="text-xs text-charcoal-ink/70">Questions are a fixed list so nothing about the patient is typed into a message. The prescriber answers from a fixed list too. An answer never changes the signed prescription.</p>
        {ask.isError && <p role="alert" className="text-red-600">The question could not be sent. Please try again.</p>}
        {ask.isSuccess && <p role="status">Your question was sent to the prescriber.</p>}
        <div className="border-t border-charcoal-ink/10 pt-3">
          <Button type="button" variant="outline" disabled={stock.isPending || sentStock} onClick={() => stock.mutate(undefined, { onSuccess: () => setSentStock(true) })}>
            We cannot supply this (out of stock)
          </Button>
          {sentStock && <p role="status" className="mt-2">The patient has been told and can choose another pharmacy.</p>}
          {stock.isError && <p role="alert" className="mt-2 text-red-600">That could not be sent. Please try again.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * S28 counter desk (spec 9.6): the pharmacist checks the patient's collection code, sees what was prescribed and the allergies on file,
 * then records a full or partial supply. English only (staff page, as OQ-102). The database re-checks the code on the supply itself, so
 * nothing here can be skipped by changing the page.
 */
export function CollectionDesk({ prescriptionId }: { prescriptionId: string }) {
  const verify = useVerifyCollection();
  const [code, setCode] = useState("");
  const [seen, setSeen] = useState<DeskVerification | null>(null);
  const [who, setWho] = useState<Supplier>({ pharmacist: "", registration: "" });

  function onCheck(e: FormEvent) {
    e.preventDefault();
    setSeen(null);
    verify.mutate({ prescription: prescriptionId, code }, { onSuccess: (d) => setSeen(d) });
  }

  const ok = seen?.outcome === "ok";
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader><CardTitle>Check the collection code</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={onCheck} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="collection_code">Code the patient shows</Label>
              <Input id="collection_code" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} className="w-48 font-mono uppercase" required />
            </div>
            <Button type="submit" disabled={verify.isPending}>{verify.isPending ? "Checking…" : "Check code"}</Button>
          </form>
          {verify.isError && <p role="alert" className="mt-2 text-sm text-red-600">{(verify.error as Error).message || "Could not check the code."}</p>}
          {seen && !ok && <p role="status" className="mt-2 text-sm text-amber-800">{VERIFY_TEXT[seen.outcome] ?? "Could not check the code."}</p>}
        </CardContent>
      </Card>

      {seen && ok && (
        <Card>
          <CardHeader><CardTitle>{seen.patient_name ?? "Patient"} <span className="text-sm font-normal text-charcoal-ink/60">{seen.patient_number ?? ""}</span></CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ul className="list-disc pl-5">{(seen.items ?? []).map((it, i) => <li key={i}>{itemLine(it)}</li>)}</ul>
            <p>
              <span className="font-semibold">Allergies on file: </span>
              {(seen.allergies ?? []).length === 0 ? "none recorded" : (seen.allergies ?? []).map((a) => [a.allergen, a.reaction, a.severity].filter(Boolean).join(" / ")).join("; ")}
            </p>
            <p>Supplies recorded: {seen.supplies_dispensed} of {seen.supplies_permitted}.{seen.outstanding_note ? ` Owed from before: ${seen.outstanding_note}` : ""}</p>
            <SupplyForm prescriptionId={prescriptionId} code={code} who={who} onWho={setWho} />
          </CardContent>
        </Card>
      )}
      <Questions prescriptionId={prescriptionId} />
      <p><Link href="/pharmacist/prescriptions" className="text-sm font-semibold text-brand-green underline">Back to the list</Link></p>
    </div>
  );
}
