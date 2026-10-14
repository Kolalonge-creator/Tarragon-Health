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

export interface RecordChangeCondition {
  condition_name: string;
  icd10_code: string | null;
  status: string;
  source: string;
  date_identified: string | null;
}

export interface RecordChangeRequest {
  id: string;
  /** Which record the patient asked to change (S05b-f: conditions follow the same hold rule as allergies). */
  kind: "allergy" | "condition";
  requested_status: "corrected" | "amended" | "entered_in_error";
  reason: string;
  replacement: {
    allergen?: string;
    reaction?: string | null;
    severity?: string | null;
    condition_name?: string;
    icd10_code?: string | null;
    date_identified?: string | null;
  } | null;
  created_at: string;
  patient: { full_name: string | null; patient_number: string | null } | null;
  /** The allergy as recorded now (kind "allergy"), or null. */
  allergy: RecordChangeAllergy | null;
  /** The condition as recorded now (kind "condition"), or null. */
  condition: RecordChangeCondition | null;
  /** True when the current record could not be loaded (the audited read was refused or failed), so null does not mean "gone". */
  currentUnavailable: boolean;
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

/** A date-only value (a condition's date identified) for the screen; the stored value is YYYY-MM-DD. */
function formatDay(day: string): string {
  const parsed = new Date(`${day}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? day
    : parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

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
  request: Pick<RecordChangeRequest, "kind" | "requested_status" | "replacement">,
): string {
  if (request.requested_status === "entered_in_error" || !request.replacement) {
    return request.kind === "condition"
      ? "Remove this condition (entered by mistake)"
      : "Remove this allergy (entered by mistake)";
  }
  const parts =
    request.kind === "condition"
      ? [request.replacement.condition_name, request.replacement.date_identified ? `identified ${formatDay(request.replacement.date_identified)}` : null]
      : [
          request.replacement.allergen,
          request.replacement.severity
            ? (SEVERITY_LABEL[request.replacement.severity] ?? request.replacement.severity)
            : null,
        ];
  return `Change to: ${parts.filter((part): part is string => Boolean(part)).join(", ") || "new details"}`;
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

function statusLabel(status: string): string {
  const text = status.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The name of the record as it stands now, for the row header. */
function currentName(request: RecordChangeRequest): string | null {
  return request.kind === "condition" ? (request.condition?.condition_name ?? null) : (request.allergy?.allergen ?? null);
}

/** The "Current record" panel, per kind. */
function currentRows(request: RecordChangeRequest): Array<[string, string | null | undefined]> {
  if (request.kind === "condition") {
    const current = request.condition;
    return [
      ["Condition", current?.condition_name],
      ["Code", current?.icd10_code],
      ["Identified", current?.date_identified ? formatDay(current.date_identified) : null],
      ["Status", current ? statusLabel(current.status) : null],
      ["Source", current ? (SOURCE_LABEL[current.source] ?? current.source) : null],
    ];
  }
  const current = request.allergy;
  return [
    ["Allergen", current?.allergen],
    ["Reaction", current?.reaction],
    ["Severity", current?.severity ? SEVERITY_LABEL[current.severity] : null],
    ["Source", current ? (SOURCE_LABEL[current.source] ?? current.source) : null],
  ];
}

/** The "What the patient asks" panel for a change (not a removal): her values, with the current ones where she named none. */
function askedRows(request: RecordChangeRequest): Array<[string, string | null | undefined]> {
  const replacement = request.replacement;
  if (request.kind === "condition") {
    const current = request.condition;
    return [
      ["Condition", replacement?.condition_name ?? current?.condition_name],
      ["Code", replacement && "icd10_code" in replacement ? replacement.icd10_code : current?.icd10_code],
      [
        "Identified",
        (() => {
          const day = replacement && "date_identified" in replacement ? replacement.date_identified : current?.date_identified;
          return day ? formatDay(day) : null;
        })(),
      ],
    ];
  }
  const current = request.allergy;
  return [
    ["Allergen", replacement?.allergen ?? current?.allergen],
    ["Reaction", replacement && "reaction" in replacement ? replacement.reaction : current?.reaction],
    [
      "Severity",
      replacement && "severity" in replacement
        ? replacement.severity
          ? (SEVERITY_LABEL[replacement.severity] ?? replacement.severity)
          : null
        : current?.severity
          ? SEVERITY_LABEL[current.severity]
          : null,
    ],
  ];
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
  const replacement = request.replacement;
  const removing =
    request.requested_status === "entered_in_error" || !replacement;
  const name = currentName(request);
  const severity = request.kind === "allergy" ? request.allergy?.severity : null;

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
            {name ??
              (request.currentUnavailable
                ? "(could not be loaded)"
                : "(entry no longer current)")}
          </span>
          {severity ? `, ${SEVERITY_LABEL[severity]}` : ""}
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
            {request.currentUnavailable && (
              <p role="alert" className="text-sm text-destructive">
                The current record could not be loaded. Check the patient&apos;s record before you decide.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Fields title="Current record" rows={currentRows(request)} />
              {removing ? (
                <Fields
                  title="What the patient asks"
                  rows={[["Change", "Remove this entry"]]}
                />
              ) : (
                <Fields title="What the patient asks" rows={askedRows(request)} />
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
                  {request.kind === "condition"
                    ? "Until you confirm, the condition stays on the patient's record and in every reader."
                    : "Until you confirm, the allergy stays active for prescribing and on the emergency card."}
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
