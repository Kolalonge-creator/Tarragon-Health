"use client";

import { useState, type FormEvent } from "react";
import {
  useReportMedicationAffordability,
  useReportMedicationConcern,
} from "@/lib/queries/medication-issues";
import type { Medication } from "@/lib/queries/medications";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type ReportKind = "cost" | "concern";

/**
 * Pharmacy Engine spec §12.13 (concern) and §12.16 (affordability), the two
 * patient-facing signals from docs/PHARMACY_ENGINE_SPEC.md's Phase 1 list.
 * Same self-report shape as MedicationCollectionForm: writes straight
 * through the patient's own RLS-permitted session, no server action needed.
 * Kept as one combined control since both are short, occasional, "something
 * went wrong with this medication" reports — a patient shouldn't have to
 * guess which of two buttons to click.
 */
export function MedicationIssueReportForm({
  medication,
  patientId,
}: {
  medication: Medication;
  patientId: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind>("cost");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);

  const reportAffordability = useReportMedicationAffordability();
  const reportConcern = useReportMedicationConcern();
  const isPending = reportAffordability.isPending || reportConcern.isPending;
  const isError = reportAffordability.isError || reportConcern.isError;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (kind === "cost") {
      reportAffordability.mutate(
        {
          patientId,
          organisationId: medication.organisation_id,
          medicationId: medication.id,
          note: note.trim() || null,
        },
        { onSuccess: () => setDone(true) }
      );
      return;
    }
    if (!note.trim()) return;
    reportConcern.mutate(
      {
        patientId,
        organisationId: medication.organisation_id,
        medicationId: medication.id,
        note: note.trim(),
      },
      { onSuccess: () => setDone(true) }
    );
  }

  if (done) {
    return (
      <p className="text-xs font-medium text-brand-green dark:text-brand-green-bright">
        Thanks for letting us know. Your care team can see this.
      </p>
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-11 px-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60"
        onClick={() => setOpen(true)}
      >
        Report a problem
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
      <div className="space-y-1">
        <Label htmlFor={`issue_kind_${medication.id}`} className="text-xs">
          What&apos;s the problem?
        </Label>
        <Select
          id={`issue_kind_${medication.id}`}
          className="h-8 text-xs"
          value={kind}
          onChange={(event) => setKind(event.target.value as ReportKind)}
        >
          <option value="cost">I couldn&apos;t afford it</option>
          <option value="concern">Something else (a concern about this medication)</option>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`issue_note_${medication.id}`} className="text-xs">
          {kind === "cost" ? "Tell us more (optional)" : "Tell us what's wrong"}
        </Label>
        <Textarea
          id={`issue_note_${medication.id}`}
          className="min-h-16 text-xs"
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          required={kind === "concern"}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={isPending || (kind === "concern" && !note.trim())}
        >
          {isPending ? "Sending…" : "Send to my care team"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {isError && (
          <p className="text-xs text-red-600 dark:text-red-300">Could not send that. Please try again.</p>
        )}
      </div>
    </form>
  );
}
