"use client";

import { useActionState, useState } from "react";
import { previewPatientMerge, confirmPatientMerge } from "./actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

export type MergeCandidate = {
  id: string;
  full_name: string | null;
  patient_number: string | null;
  date_of_birth: string | null;
  phone: string | null;
};

function CandidateCard({
  candidate,
  selected,
  onSelect,
}: {
  candidate: MergeCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-md border p-3 text-left transition-colors ${
        selected ? "border-brand-green bg-brand-green/5" : "border-charcoal-ink/10"
      }`}
    >
      <p className="text-sm font-medium text-charcoal-ink">{candidate.full_name ?? "Unnamed patient"}</p>
      <p className="text-xs text-charcoal-ink/60">{candidate.patient_number ?? "No patient number"}</p>
      <p className="text-xs text-charcoal-ink/60">DOB {candidate.date_of_birth ?? "—"}</p>
      <p className="text-xs text-charcoal-ink/60">{candidate.phone ?? "No phone on file"}</p>
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
    <div className="max-h-64 overflow-y-auto rounded-md border border-charcoal-ink/10">
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

  const previewedFor = previewState?.result;
  const canConfirm =
    !!previewedFor &&
    previewedFor.keep_id === keepId &&
    previewedFor.merge_id === mergeId &&
    !previewedFor.merge_log_id;
  const merged = confirmState?.result?.merge_log_id;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <CandidateCard candidate={candidateA} selected={keepId === candidateA.id} onSelect={() => setKeepId(candidateA.id)} />
        <CandidateCard candidate={candidateB} selected={keepId === candidateB.id} onSelect={() => setKeepId(candidateB.id)} />
      </div>

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

          <form
            action={confirmAction}
            onSubmit={(e) => {
              if (!confirm("Merge these two records? This cannot be undone automatically.")) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="keepId" value={keepId} />
            <input type="hidden" name="mergeId" value={mergeId} />
            <input type="hidden" name="reason" value={reason} />
            <Button
              type="submit"
              className="bg-red-600 hover:bg-red-700"
              disabled={!canConfirm || confirmPending}
            >
              {confirmPending ? "Merging…" : "Confirm merge"}
            </Button>
            {!canConfirm && <p className="mt-1 text-xs text-charcoal-ink/50">Preview the merge first.</p>}
            {confirmState?.error && <p className="text-sm text-red-600">{confirmState.error}</p>}
          </form>
        </>
      )}
    </div>
  );
}
