"use client";

import { useActionState, useRef, useState } from "react";
import { previewPatientMerge, confirmPatientMerge } from "./actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";

/** How much clinical history a candidate record carries. Counts only — the
 * merge screen never reads the content of anyone's record. */
export type RecordWeight = {
  vitals: number;
  medications: number;
  results: number;
  appointments: number;
};

export type MergeCandidate = {
  id: string;
  full_name: string | null;
  patient_number: string | null;
  date_of_birth: string | null;
  phone: string | null;
  created_at: string;
  weight: RecordWeight;
};

function totalWeight(w: RecordWeight): number {
  return w.vitals + w.medications + w.results + w.appointments;
}

/**
 * Name, patient number, DOB and phone say which record is which. They do not
 * say which one carries the patient's care history, which is the thing the
 * operator is actually choosing between — so the counts sit alongside, with
 * the heavier record marked.
 */
function CandidateCard({
  candidate,
  selected,
  heavier,
  onSelect,
}: {
  candidate: MergeCandidate;
  selected: boolean;
  heavier: boolean;
  onSelect: () => void;
}) {
  const { weight } = candidate;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-md border p-3 text-left transition-colors ${
        selected ? "border-brand-green bg-brand-green/5" : "border-charcoal-ink/10"
      }`}
    >
      <p className="text-sm font-medium text-charcoal-ink">{candidate.full_name ?? "Unnamed patient"}</p>
      <p className="text-xs text-charcoal-ink/60">{candidate.patient_number ?? "No patient number"}</p>
      <p className="text-xs text-charcoal-ink/60">DOB {candidate.date_of_birth ?? "—"}</p>
      <p className="text-xs text-charcoal-ink/60">{candidate.phone ?? "No phone on file"}</p>
      <p className="text-xs text-charcoal-ink/60">
        Registered{" "}
        {new Date(candidate.created_at).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </p>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-charcoal-ink/10 pt-2 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-charcoal-ink/60">Vitals</dt>
          <dd className="font-medium tabular-nums text-charcoal-ink">{weight.vitals}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-charcoal-ink/60">Medications</dt>
          <dd className="font-medium tabular-nums text-charcoal-ink">{weight.medications}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-charcoal-ink/60">Results</dt>
          <dd className="font-medium tabular-nums text-charcoal-ink">{weight.results}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-charcoal-ink/60">Appointments</dt>
          <dd className="font-medium tabular-nums text-charcoal-ink">{weight.appointments}</dd>
        </div>
      </dl>

      {heavier && totalWeight(weight) > 0 && (
        <p className="mt-2 text-xs text-charcoal-ink/70">
          Carries more of the clinical history of the two.
        </p>
      )}
      {totalWeight(weight) === 0 && (
        <p className="mt-2 text-xs text-charcoal-ink/70">No clinical history recorded yet.</p>
      )}
      <p className="mt-2 text-xs font-medium text-brand-green">
        {selected ? "Keeping this record" : "Click to keep this one instead"}
      </p>
    </button>
  );
}

function TablesAffected({ tables }: { tables: Record<string, number> }) {
  const entries = Object.entries(tables);
  if (entries.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">No rows reference the losing record. Nothing to move.</p>;
  }
  return (
    <div className="max-h-64 overflow-x-auto overflow-y-auto rounded-md border border-charcoal-ink/10">
      <table className="w-full text-sm">
        <thead className="bg-charcoal-ink/5 text-left text-xs uppercase text-charcoal-ink/50">
          <tr>
            <th className="px-3 py-2">Table.column</th>
            <th className="px-3 py-2">Rows</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, count]) => (
            <tr key={key} className="border-t border-charcoal-ink/10">
              <td className="px-3 py-1.5 font-mono text-xs">{key}</td>
              <td className="px-3 py-1.5">{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MergeTool({ candidateA, candidateB }: { candidateA: MergeCandidate; candidateB: MergeCandidate }) {
  const [keepId, setKeepId] = useState(candidateA.id);
  const mergeId = keepId === candidateA.id ? candidateB.id : candidateA.id;
  const [reason, setReason] = useState("");
  const [previewState, previewAction, previewPending] = useActionState(previewPatientMerge, undefined);
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmPatientMerge, undefined);
  const confirmFormRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);

  const previewedFor = previewState?.result;
  const canConfirm =
    !!previewedFor &&
    previewedFor.keep_id === keepId &&
    previewedFor.merge_id === mergeId &&
    !previewedFor.merge_log_id;
  const merged = confirmState?.result?.merge_log_id;
  const keptCandidate = keepId === candidateA.id ? candidateA : candidateB;
  const retiredCandidate = keepId === candidateA.id ? candidateB : candidateA;
  const rowsMoving = previewedFor
    ? Object.values(previewedFor.tables_affected).reduce((sum, n) => sum + n, 0)
    : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <CandidateCard
          candidate={candidateA}
          selected={keepId === candidateA.id}
          heavier={totalWeight(candidateA.weight) > totalWeight(candidateB.weight)}
          onSelect={() => setKeepId(candidateA.id)}
        />
        <CandidateCard
          candidate={candidateB}
          selected={keepId === candidateB.id}
          heavier={totalWeight(candidateB.weight) > totalWeight(candidateA.weight)}
          onSelect={() => setKeepId(candidateB.id)}
        />
      </div>
      <p className="text-xs text-charcoal-ink/60">
        Everything on the record you do not keep moves onto the one you do, so neither column is
        lost. What differs is which patient number, name and contact details survive, and which
        record the patient&apos;s history is filed under from now on.
      </p>

      <div className="space-y-1.5">
        <label htmlFor="reason" className="text-sm font-medium text-charcoal-ink">
          Reason (required)
        </label>
        <Textarea
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Same person: confirmed by phone number and DOB match, patient re-signed up after losing access to their first account."
          rows={3}
        />
      </div>

      {merged ? (
        <Card variant="soft">
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-medium text-brand-green">
              Merged. The losing record is retired and every row that referenced it now references
              the kept record.
            </p>
            <TablesAffected tables={confirmState.result!.tables_affected} />
          </CardContent>
        </Card>
      ) : (
        <>
          <form action={previewAction} className="flex items-center gap-2">
            <input type="hidden" name="keepId" value={keepId} />
            <input type="hidden" name="mergeId" value={mergeId} />
            <input type="hidden" name="reason" value={reason} />
            <Button type="submit" variant="outline" disabled={previewPending || !reason.trim()}>
              {previewPending ? "Checking…" : "Preview merge"}
            </Button>
            {previewState?.error && <p className="text-sm text-red-600">{previewState.error}</p>}
          </form>

          {previewedFor && (
            <Card variant="soft">
              <CardContent className="space-y-3 pt-6">
                <p className="text-sm text-charcoal-ink/70">
                  This is what would move. Nothing has changed yet.
                </p>
                <TablesAffected tables={previewedFor.tables_affected} />
              </CardContent>
            </Card>
          )}

          <form ref={confirmFormRef} action={confirmAction}>
            <input type="hidden" name="keepId" value={keepId} />
            <input type="hidden" name="mergeId" value={mergeId} />
            <input type="hidden" name="reason" value={reason} />
            {/* A window.confirm ("Merge these two records?") named neither
                record and gave no numbers. The dialog states which record
                survives, which is retired, and how many rows move. */}
            <Button
              type="button"
              className="bg-red-600 hover:bg-red-700"
              disabled={!canConfirm || confirmPending}
              onClick={() => setConfirming(true)}
            >
              {confirmPending ? "Merging…" : "Confirm merge"}
            </Button>
            {!canConfirm && <p className="mt-1 text-xs text-charcoal-ink/50">Preview the merge first.</p>}
            {confirmState?.error && <p className="text-sm text-red-600">{confirmState.error}</p>}
          </form>

          <ConfirmDialog
            open={confirming}
            title="Merge these two patient records?"
            description="Every row on the retired record is repointed onto the kept record and the retired record is closed. This is not reversible from the app."
            confirmLabel="Merge the records"
            cancelLabel="Cancel"
            destructive
            onConfirm={() => {
              setConfirming(false);
              confirmFormRef.current?.requestSubmit();
            }}
            onCancel={() => setConfirming(false)}
          >
            <ConfirmDialogFacts
              rows={[
                {
                  label: "Record kept",
                  value: `${keptCandidate.full_name ?? "Unnamed patient"} (${keptCandidate.patient_number ?? "no patient number"})`,
                },
                {
                  label: "Record retired",
                  value: `${retiredCandidate.full_name ?? "Unnamed patient"} (${retiredCandidate.patient_number ?? "no patient number"})`,
                },
                { label: "Rows moving", value: rowsMoving },
              ]}
            />
          </ConfirmDialog>
        </>
      )}
    </div>
  );
}
