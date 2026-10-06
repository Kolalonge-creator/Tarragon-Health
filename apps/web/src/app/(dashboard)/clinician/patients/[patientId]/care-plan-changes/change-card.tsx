"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormError } from "@/components/ui/form-error";
import { SafetyFindingsPrompt } from "@/components/prescribing/safety-findings-prompt";
import { isSafetyResubmitReady, type SafetyError } from "@/lib/prescriptions/parse-safety-error";
import { rejectCareChange, signCareChange } from "./actions";
import {
  KIND_LABEL,
  STATE_LABEL,
  describeChange,
  describeEngineInputs,
  describeSafetyChecks,
  stateSummary,
  stateTone,
  type StaffCareChange,
} from "./change-model";

export function formatLagosDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an unknown date";
  return d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/**
 * One care plan change as the clinician sees it: what it is, who proposed it, why, for an engine proposal the exact inputs and step it
 * used, the safety checks and any override reason, and who signed it and when. A draft can be signed or rejected here by a prescriber.
 * Signing needs a plain-language summary typed by the signer (nothing is prefilled) because that is what the patient reads.
 */
export function ChangeCard({
  change,
  patientId,
  canAct,
  onChanged,
}: {
  change: StaffCareChange;
  patientId: string;
  canAct: boolean;
  onChanged: () => void;
}) {
  const sentences = describeChange(change);
  const engineInputs = describeEngineInputs(change.engineInputs);
  const safetyLines = describeSafetyChecks(change.safetyChecks);
  const [mode, setMode] = useState<"none" | "sign" | "reject">("none");

  return (
    <li className="space-y-3 py-4" data-testid={`care-change-${change.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={stateTone(change.state)}>{STATE_LABEL[change.state]}</Badge>
        <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{KIND_LABEL[change.kind]}</span>
        <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          {change.proposedBy === "engine"
            ? "Suggested by the titration engine"
            : change.proposedByName
              ? `Proposed by ${change.proposedByName}`
              : "Proposed by a clinician"}
        </span>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{sentences.heading}</p>
        {sentences.before !== null && (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            <span className="text-xs uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">Now </span>
            {sentences.before}
          </p>
        )}
        {sentences.after !== null && (
          <p className="text-sm text-charcoal-ink dark:text-night-ink">
            <span className="text-xs uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">Proposed </span>
            {sentences.after}
          </p>
        )}
      </div>

      <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
        <span className="font-medium">Why: </span>
        {change.rationale}
      </p>

      {change.proposedBy === "engine" && (
        <details className="rounded-md border border-charcoal-ink/10 p-2 dark:border-night-ink/15">
          <summary className="cursor-pointer text-xs font-medium text-charcoal-ink/80 dark:text-night-ink/80">
            What the engine saw
            {change.protocolVersion !== null ? ` (approved step table, version ${change.protocolVersion})` : ""}
          </summary>
          {engineInputs.length === 0 ? (
            <p className="mt-2 text-xs text-charcoal-ink/60">No inputs were recorded.</p>
          ) : (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {engineInputs.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="capitalize text-charcoal-ink/50 dark:text-night-ink/55">{row.label}</dt>
                  <dd className="break-words text-charcoal-ink dark:text-night-ink">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            This is a draft from a table the Chief Medical Officer approved. You can sign it, reject it, or ignore it. Nothing reaches the patient until you sign.
          </p>
        </details>
      )}

      {change.patientSummary && (
        <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          <span className="font-medium">What the patient reads: </span>
          {change.patientSummary}
        </p>
      )}

      {safetyLines.length > 0 && change.state !== "proposed" && change.state !== "rejected" && (
        <div className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
          <p className="font-medium">Safety checks at signing</p>
          <ul className="list-inside list-disc">
            {safetyLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{stateSummary(change, formatLagosDate)}</p>
      {change.signedAt && (
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          Signed{change.signedByName ? ` by ${change.signedByName}` : ""} on {formatLagosDate(change.signedAt)}.
        </p>
      )}
      {change.state === "rejected" && change.rejectionReason && (
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">Reason: {change.rejectionReason}</p>
      )}
      {change.state === "declined" && change.declineReason && (
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">The patient said: {change.declineReason}</p>
      )}

      {change.state === "proposed" && canAct && mode === "none" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setMode("sign")}>
            Sign and send to the patient
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode("reject")}>
            Reject
          </Button>
        </div>
      )}
      {change.state === "proposed" && !canAct && (
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">Only a prescriber tied to this patient can sign or reject a draft.</p>
      )}

      {mode === "sign" && (
        <SignForm
          changeId={change.id}
          patientId={patientId}
          onCancel={() => setMode("none")}
          onDone={() => {
            setMode("none");
            onChanged();
          }}
        />
      )}
      {mode === "reject" && (
        <RejectForm
          changeId={change.id}
          patientId={patientId}
          onCancel={() => setMode("none")}
          onDone={() => {
            setMode("none");
            onChanged();
          }}
        />
      )}
    </li>
  );
}

function SignForm({ changeId, patientId, onCancel, onDone }: { changeId: string; patientId: string; onCancel: () => void; onDone: () => void }) {
  const [summary, setSummary] = useState("");
  const [allergiesConfirmed, setAllergiesConfirmed] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [safety, setSafety] = useState<SafetyError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const safetyReady = safety ? isSafetyResubmitReady(safety, { allergiesConfirmed, overrideReason }) : true;

  async function submit() {
    setPending(true);
    setError(null);
    const result = await signCareChange({
      patientId,
      changeId,
      patientSummary: summary,
      allergiesConfirmed,
      overrideReason: overrideReason || undefined,
    });
    setPending(false);
    if (result.ok) {
      onDone();
      return;
    }
    if (result.safety) {
      setSafety(result.safety);
      setError(null);
      return;
    }
    setSafety(null);
    setError(result.error);
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-ink/10 bg-charcoal-ink/5 p-3 dark:border-night-ink/15 dark:bg-night-ink/5">
      <div className="space-y-1.5">
        <Label htmlFor={`summary-${changeId}`} className="text-xs">
          What this means for the patient, in plain words (required)
        </Label>
        <Textarea
          id={`summary-${changeId}`}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          maxLength={1000}
          placeholder="This is what the patient reads in the app. Say what changes and why, in short sentences."
        />
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          Signing sends this to the patient to confirm or decline. Nothing changes for the patient until they confirm it in the app.
        </p>
      </div>
      {safety && (
        <SafetyFindingsPrompt
          error={safety}
          idPrefix={`sign-${changeId}`}
          allergiesConfirmed={allergiesConfirmed}
          onAllergiesConfirmedChange={setAllergiesConfirmed}
          overrideReason={overrideReason}
          onOverrideReasonChange={setOverrideReason}
        />
      )}
      <FormError id={`sign-error-${changeId}`} message={error} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={submit} disabled={pending || !safetyReady || summary.trim() === ""}>
          {pending ? "Signing..." : "Sign and send"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function RejectForm({ changeId, patientId, onCancel, onDone }: { changeId: string; patientId: string; onCancel: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    const result = await rejectCareChange({ patientId, changeId, reason });
    setPending(false);
    if (result.ok) onDone();
    else setError(result.error);
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-ink/10 bg-charcoal-ink/5 p-3 dark:border-night-ink/15 dark:bg-night-ink/5">
      <div className="space-y-1.5">
        <Label htmlFor={`reject-${changeId}`} className="text-xs">
          Reason for rejecting (required)
        </Label>
        <Textarea id={`reject-${changeId}`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
      </div>
      <FormError id={`reject-error-${changeId}`} message={error} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={submit} disabled={pending || reason.trim() === ""}>
          {pending ? "Rejecting..." : "Reject this change"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
