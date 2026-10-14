"use client";

import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  confirmRecordChange,
  rejectRecordChange,
  type RecordChangeDecisionState,
} from "./actions";

export interface RecordChangeAllergy {
  allergen: string;
  reaction: string | null;
  severity: "mild" | "moderate" | "severe" | null;
  source: string;
  noted_at: string | null;
}

export interface RecordChangeRequest {
  id: string;
  requested_status: "corrected" | "amended" | "entered_in_error";
  reason: string;
  replacement: {
    allergen?: string;
    reaction?: string | null;
    severity?: string | null;
  } | null;
  created_at: string;
  patient: { full_name: string | null; patient_number: string | null } | null;
  /** The allergy as recorded now, or null. */
  allergy: RecordChangeAllergy | null;
  /** True when the current record could not be loaded (the audited read was refused or failed), so null does not mean "gone". */
  allergyUnavailable: boolean;
}

const SEVERITY_LABEL: Record<string, string> = {
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};
const SOURCE_LABEL: Record<string, string> = {
  patient: "Entered by the patient",
  clinician: "Recorded by a clinician",
  fhir_import: "Imported from an external record",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** What the patient asks for, in one line, for the queue row. */
export function describeRequest(
  request: Pick<RecordChangeRequest, "requested_status" | "replacement">,
): string {
  if (request.requested_status === "entered_in_error" || !request.replacement) {
    return "Remove this allergy (entered by mistake)";
  }
  const parts = [
    request.replacement.allergen,
    request.replacement.severity
      ? (SEVERITY_LABEL[request.replacement.severity] ??
        request.replacement.severity)
      : null,
  ].filter((part): part is string => Boolean(part));
  return `Change to: ${parts.join(", ") || "new details"}`;
}

function Fields({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string | null | undefined]>;
}) {
  return (
    <div className="space-y-1 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
      <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">
        {title}
      </p>
      <dl className="space-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="w-24 shrink-0 text-charcoal-ink/60 dark:text-night-ink/60">
              {label}
            </dt>
            <dd className="text-charcoal-ink dark:text-night-ink">
              {value && value.length > 0 ? value : "Not given"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function RequestCard({ request }: { request: RecordChangeRequest }) {
  const [open, setOpen] = useState(false);
  const [confirmState, confirmAction, confirming] = useActionState<
    RecordChangeDecisionState,
    FormData
  >(confirmRecordChange, undefined);
  const [rejectState, rejectAction, rejecting] = useActionState<
    RecordChangeDecisionState,
    FormData
  >(rejectRecordChange, undefined);
  const busy = confirming || rejecting;
  const current = request.allergy;
  const replacement = request.replacement;
  const removing =
    request.requested_status === "entered_in_error" || !replacement;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {request.patient?.full_name ?? "Patient"}
            {request.patient?.patient_number ? (
              <span className="ml-2 text-xs font-normal text-charcoal-ink/60 dark:text-night-ink/60">
                {request.patient.patient_number}
              </span>
            ) : null}
          </CardTitle>
          <Badge variant="amber">Waiting for you</Badge>
        </div>
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          On record:{" "}
          <span className="font-medium">
            {current?.allergen ??
              (request.allergyUnavailable
                ? "(could not be loaded)"
                : "(entry no longer current)")}
          </span>
          {current?.severity ? `, ${SEVERITY_LABEL[current.severity]}` : ""}
        </p>
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Asks: <span className="font-medium">{describeRequest(request)}</span>
        </p>
        <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
          Asked {formatDate(request.created_at)}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Close" : "Open request"}
        </Button>

        {open && (
          <div className="space-y-4">
            {request.allergyUnavailable && (
              <p role="alert" className="text-sm text-destructive">
                The current record could not be loaded. Check the patient&apos;s record before you decide.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Fields
                title="Current record"
                rows={[
                  ["Allergen", current?.allergen],
                  ["Reaction", current?.reaction],
                  [
                    "Severity",
                    current?.severity ? SEVERITY_LABEL[current.severity] : null,
                  ],
                  [
                    "Source",
                    current
                      ? (SOURCE_LABEL[current.source] ?? current.source)
                      : null,
                  ],
                ]}
              />
              {removing ? (
                <Fields
                  title="What the patient asks"
                  rows={[["Change", "Remove this entry"]]}
                />
              ) : (
                <Fields
                  title="What the patient asks"
                  rows={[
                    ["Allergen", replacement?.allergen ?? current?.allergen],
                    [
                      "Reaction",
                      replacement && "reaction" in replacement
                        ? replacement.reaction
                        : current?.reaction,
                    ],
                    [
                      "Severity",
                      replacement && "severity" in replacement
                        ? replacement.severity
                          ? (SEVERITY_LABEL[replacement.severity] ??
                            replacement.severity)
                          : null
                        : current?.severity
                          ? SEVERITY_LABEL[current.severity]
                          : null,
                    ],
                  ]}
                />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">
                Reason given by the patient
              </p>
              <p className="whitespace-pre-wrap text-sm text-charcoal-ink dark:text-night-ink">
                {request.reason}
              </p>
            </div>

            <div className="space-y-3 border-t border-charcoal-ink/10 pt-3 dark:border-night-ink/15">
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  Until you confirm, the allergy stays active for prescribing
                  and on the emergency card.
                </p>
                <div className="flex flex-wrap items-start gap-3">
                  <form action={confirmAction}>
                    <input type="hidden" name="id" value={request.id} />
                    <Button type="submit" size="sm" disabled={busy}>
                      {confirming ? "Confirming…" : "Confirm the change"}
                    </Button>
                  </form>
                </div>
                <form action={rejectAction} className="space-y-2">
                  <input type="hidden" name="id" value={request.id} />
                  <Label htmlFor={`note-${request.id}`} className="text-xs">
                    Internal note (optional, the patient never sees this)
                  </Label>
                  <textarea
                    id={`note-${request.id}`}
                    name="note"
                    maxLength={1000}
                    rows={2}
                    className="w-full rounded-md border border-charcoal-ink/20 bg-transparent p-2 text-sm dark:border-night-ink/25"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                  >
                    {rejecting ? "Saving…" : "Leave the record as it was"}
                  </Button>
                </form>
                {confirmState?.error && (
                  <p role="alert" className="text-sm text-destructive">
                    {confirmState.error}
                  </p>
                )}
                {rejectState?.error && (
                  <p role="alert" className="text-sm text-destructive">
                    {rejectState.error}
                  </p>
                )}
                {confirmState?.message && (
                  <p className="text-sm text-charcoal-ink/70">
                    {confirmState.message}
                  </p>
                )}
                {rejectState?.message && (
                  <p className="text-sm text-charcoal-ink/70">
                    {rejectState.message}
                  </p>
                )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RecordChangesQueue({ requests }: { requests: RecordChangeRequest[] }) {
  if (requests.length === 0) {
    return (
      <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
        No record changes are waiting for you.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {requests.map((request) => (
        <RequestCard key={request.id} request={request} />
      ))}
    </div>
  );
}
