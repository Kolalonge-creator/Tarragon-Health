"use client";

import { useState } from "react";
import {
  useOpenMedicationReconciliation,
  useConfirmMedicationList,
} from "@/lib/queries/medication-reconciliations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, FormSuccess, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";
import { raiseMedicationNotSureTask } from "./medication-not-sure-actions";

/**
 * Medication safety pathway 64.3, step 1 of 2 — "Patient confirms". Shown
 * whether the episode was opened by a clinician (awaiting the patient) or
 * the patient opens it themselves; either way, confirming here is what lets
 * a clinician's later reconciliation happen at all (private.stamp_
 * medication_reconciliation_transition enforces that ordering server-side).
 */
export function MedicationReconciliationConfirm({ patientId }: { patientId: string }) {
  const { data: open } = useOpenMedicationReconciliation(patientId);
  const confirm = useConfirmMedicationList(patientId);
  const [note, setNote] = useState("");
  // P16: "I'm not sure" leaves the list unconfirmed (confirming means "this list is accurate", which a patient who is
  // unsure cannot say). Per the CMO decision from chat (2026-11-07) it raises one routine task on the medicine-issue
  // worklist (at most one per patient per day); the reassurance below shows only once that task is in.
  const [unsure, setUnsure] = useState(false);
  const [unsurePending, setUnsurePending] = useState(false);
  const [unsureError, setUnsureError] = useState<string | null>(null);

  async function answerNotSure() {
    setUnsurePending(true);
    setUnsureError(null);
    const r = await raiseMedicationNotSureTask({ source: "reconciliation" });
    setUnsurePending(false);
    if (r.ok) setUnsure(true);
    else setUnsureError(r.error);
  }
  const errorId = fieldErrorId("reconciliation_note");

  if (open?.patient_confirmed_at) {
    // Already confirmed, waiting on the clinician side — nothing more for
    // the patient to do here.
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Confirm your medication list</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Is the medication list above still correct, with nothing missing and nothing that you have
          stopped taking? Confirming lets your care team check it against your records at your next visit.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="reconciliation_note">Anything to flag? (optional)</Label>
          <Input
            id="reconciliation_note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            placeholder="e.g. I stopped taking ibuprofen a month ago"
            {...fieldErrorProps(errorId, confirm.isError)}
          />
        </div>
        {/* The raw mutation message used to be printed first, which meant a
            Supabase error string was the patient's headline. */}
        <FormError id={errorId} message={confirm.isError && "Could not confirm your medication list."} />
        <FormSuccess message={confirm.isSuccess && "Thanks. Your care team can now reconcile it."} />
        <Button
          size="sm"
          variant="outline"
          disabled={confirm.isPending}
          onClick={() =>
            confirm.mutate({ existingId: open?.id ?? null, note: note.trim() || null })
          }
        >
          {confirm.isPending ? "Confirming…" : "Confirm this list is accurate"}
        </Button>
        <Button size="sm" variant="ghost" disabled={confirm.isPending || unsurePending} onClick={answerNotSure}>
          I&apos;m not sure
        </Button>
        {unsureError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-300">{unsureError}</p>
        ) : null}
        {/* CMO signed from chat 2026-11-07 */}
        {unsure ? (
          <p role="status" className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            That&apos;s fine. Your list stays unconfirmed for now. If a medicine on it looks wrong, use &quot;Report a
            problem&quot; beside it, or bring your medicine packs to your next consultation so the doctor can go through
            them with you.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
