"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCaseReviewActions,
  useConfirmCaseAction,
  useDismissCaseAction,
  useProposeCaseActions,
  type CaseReviewAction,
} from "@/lib/queries/case-review-actions";
import type { ProposedPayload } from "@/lib/case-cockpit/propose";

/**
 * The cockpit's confirm surface.
 *
 * The whole feature rests on one behavioural claim: a doctor who CONFIRMS is
 * still deciding, not rubber-stamping. Three choices here exist to keep that
 * claim true, and none of them are cosmetic:
 *
 *  1. THE REASON IS ALWAYS VISIBLE, never behind a disclosure. If a doctor has
 *     to click to find out why something is suggested, most will not, and the
 *     confirmation stops being a judgment.
 *  2. EVERY ACTION IS EDITABLE BEFORE CONFIRMING, and editing is a first-class
 *     outcome ('modified') rather than an escape hatch. A UI that only offers
 *     yes/no teaches yes.
 *  3. DISMISSING REQUIRES A REASON. It costs the doctor a sentence and it is
 *     the only way the platform ever learns a protocol default is wrong in
 *     practice.
 *
 * The AI's drafted note is deliberately NOT pre-loaded into the note action's
 * textarea. It sits in the separate, clearly-labelled brief card above, and
 * the doctor copies from it if they want it. Pre-filling would blur the one
 * line this design will not cross -- the model drafts prose for a human to
 * read; it never occupies the field whose submission is a clinical record.
 */
export function CaseActionsPanel({
  clinicianAlertId,
  patientId,
}: {
  clinicianAlertId: string;
  patientId: string;
}) {
  const { data: actions, isLoading, isError } = useCaseReviewActions(clinicianAlertId);
  const propose = useProposeCaseActions(clinicianAlertId);

  // Generate the first set on open, once. A doctor should not have to ask for
  // suggestions on a case they just opened -- but re-running on every render
  // would burn writes and could reorder the list under their cursor.
  //
  // The latch is a ref, not state, deliberately: it is a "has this fired yet"
  // flag that nothing renders, so making it state would trigger a cascading
  // re-render for no visible change (which is exactly what
  // react-hooks/set-state-in-effect flags).
  const hasRequested = useRef(false);
  const proposeMutate = propose.mutate;
  useEffect(() => {
    if (hasRequested.current) return;
    if (isLoading || !actions || actions.length > 0) return;
    hasRequested.current = true;
    proposeMutate();
  }, [isLoading, actions, proposeMutate]);

  const live = (actions ?? []).filter((action) => action.status === "proposed");
  const decided = (actions ?? []).filter((action) => action.status !== "proposed");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Suggested actions</CardTitle>
            <CardDescription>
              Derived from this patient&apos;s own record and the signed protocol. Each one is a
              draft for you to confirm, change, or decline. Nothing here has happened yet.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={propose.isPending}
            onClick={() => propose.mutate()}
          >
            {propose.isPending ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">
            Could not load suggested actions. The case detail below is unaffected.
          </p>
        )}
        {propose.isError && (
          <p className="text-sm text-red-600">{propose.error.message}</p>
        )}

        {!isLoading && live.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            No suggested actions for this case. Work it through the case detail and forms below as
            normal.
          </p>
        )}

        {live.map((action) => (
          <ActionRow
            key={action.id}
            action={action}
            clinicianAlertId={clinicianAlertId}
            patientId={patientId}
          />
        ))}

        {decided.length > 0 && (
          <div className="space-y-2 border-t border-charcoal-ink/10 pt-4">
            <h3 className="text-sm font-medium text-charcoal-ink">Already decided</h3>
            {decided.map((action) => (
              <DecidedRow key={action.id} action={action} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActionRow({
  action,
  clinicianAlertId,
  patientId,
}: {
  action: CaseReviewAction;
  clinicianAlertId: string;
  patientId: string;
}) {
  const confirm = useConfirmCaseAction(clinicianAlertId, patientId);
  const dismiss = useDismissCaseAction(clinicianAlertId);
  const [isEditing, setIsEditing] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const [dismissReason, setDismissReason] = useState("");

  const proposed = action.proposed_payload as unknown as ProposedPayload;
  const [draft, setDraft] = useState<ProposedPayload>(proposed);
  // Which judgement criteria the doctor has ticked, for a resolve action.
  const [acknowledged, setAcknowledged] = useState<string[]>([]);

  const checklist =
    proposed.kind === "resolve_case" ? proposed.judgementChecklist : [];
  const checklistComplete = checklist.every((item) => acknowledged.includes(item));

  const isDirty = JSON.stringify(draft) !== JSON.stringify(proposed);

  function submit() {
    // A resolve action records exactly which criteria the doctor attested to,
    // so "no red flags" is a statement someone made, not one the software
    // inferred. That makes it a modified payload by definition.
    if (proposed.kind === "resolve_case" && checklist.length > 0) {
      confirm.mutate({
        actionId: action.id,
        modifiedPayload: {
          ...(draft as Extract<ProposedPayload, { kind: "resolve_case" }>),
          judgementChecklist: acknowledged,
        },
      });
      return;
    }
    confirm.mutate({
      actionId: action.id,
      modifiedPayload: isDirty ? draft : undefined,
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-charcoal-ink/10 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">{labelFor(proposed)}</p>
        <ProtocolBadge action={action} />
      </div>

      {/* Always visible, never collapsed — see (1) in the file header. */}
      <p className="text-sm text-charcoal-ink/70">{action.rationale}</p>

      {isEditing ? (
        <PayloadEditor payload={draft} onChange={setDraft} />
      ) : (
        <PayloadPreview payload={draft} />
      )}

      {checklist.length > 0 && (
        <fieldset className="space-y-2 rounded-md bg-charcoal-ink/[0.03] p-3">
          <legend className="text-xs font-medium text-charcoal-ink">
            Confirm you have considered these: the data cannot judge them
          </legend>
          {checklist.map((item) => (
            <label key={item} className="flex items-start gap-2 text-sm text-charcoal-ink/80">
              <input
                type="checkbox"
                className="mt-1"
                checked={acknowledged.includes(item)}
                onChange={(event) =>
                  setAcknowledged((current) =>
                    event.target.checked
                      ? [...current, item]
                      : current.filter((entry) => entry !== item)
                  )
                }
              />
              <span>{item}</span>
            </label>
          ))}
        </fieldset>
      )}

      {confirm.isError && <p className="text-sm text-red-600">{confirm.error.message}</p>}
      {dismiss.isError && <p className="text-sm text-red-600">{dismiss.error.message}</p>}

      {isDismissing ? (
        <div className="space-y-2">
          <Label htmlFor={`dismiss-${action.id}`}>Why are you declining this?</Label>
          <Input
            id={`dismiss-${action.id}`}
            value={dismissReason}
            onChange={(event) => setDismissReason(event.target.value)}
            placeholder="e.g. patient already reviewed this in clinic yesterday"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={dismiss.isPending || dismissReason.trim().length === 0}
              onClick={() =>
                dismiss.mutate(
                  { actionId: action.id, reason: dismissReason },
                  { onSuccess: () => setIsDismissing(false) }
                )
              }
            >
              {dismiss.isPending ? "Saving…" : "Record decision"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIsDismissing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={confirm.isPending || !checklistComplete} onClick={submit}>
            {confirm.isPending ? "Saving…" : isDirty ? "Confirm with my changes" : "Confirm"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setIsEditing((value) => !value)}>
            {isEditing ? "Done editing" : "Change"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setIsDismissing(true)}>
            Decline
          </Button>
        </div>
      )}

      {!checklistComplete && checklist.length > 0 && (
        <p className="text-xs text-charcoal-ink/60">
          Tick every criterion above to confirm, or decline this suggestion and close the case
          yourself below.
        </p>
      )}
    </div>
  );
}

/**
 * Null-gated protocol attribution. No protocol_version row means no version
 * claim at all — the same rule as ReviewedByDoctor. The "no signed protocol"
 * state is stated plainly rather than left blank, because a doctor confirming
 * an action is entitled to know it has no signed protocol behind it.
 */
function ProtocolBadge({ action }: { action: CaseReviewAction }) {
  if (!action.protocol_version) {
    return <Badge variant="grey">No signed protocol</Badge>;
  }
  return (
    <Badge variant="green">
      {action.protocol_version.title} v{action.protocol_version.version_number}
    </Badge>
  );
}

function labelFor(payload: ProposedPayload): string {
  switch (payload.kind) {
    case "log_review_note":
      return "Log a review note";
    case "schedule_follow_up":
      return "Schedule follow-up";
    case "confirm_medication_refill":
      return `Confirm refill: ${payload.medicationName}`;
    case "order_investigation":
      return `Order ${payload.panelName}`;
    case "resolve_case":
      return "Resolve this case";
  }
}

function PayloadPreview({ payload }: { payload: ProposedPayload }) {
  switch (payload.kind) {
    case "log_review_note":
      return <PreviewText value={payload.note} />;
    case "schedule_follow_up":
      return (
        <PreviewText value={`${payload.note} Due ${formatDate(payload.nextFollowUpAt)}.`} />
      );
    case "confirm_medication_refill":
      return (
        <PreviewText
          value={`Continue ${payload.medicationName}, next refill ${formatDate(payload.refillDate)}. Dose and frequency are unchanged.`}
        />
      );
    case "order_investigation":
      return (
        <PreviewText
          value={`${payload.panelName}. The patient arranges this at any lab and uploads the result.`}
        />
      );
    case "resolve_case":
      return <PreviewText value={payload.resolutionNote} />;
  }
}

function PreviewText({ value }: { value: string }) {
  return (
    <p className="rounded-md bg-charcoal-ink/[0.03] p-3 text-sm text-charcoal-ink">{value}</p>
  );
}

/**
 * Editing is limited to the fields a doctor should be free to change. The
 * identifiers a payload carries (which medication, which panel, which
 * escalation) are NOT editable: those came from the patient's record, and
 * letting the form retarget them would turn "confirm this refill" into a
 * generic write tool pointed at anything.
 */
function PayloadEditor({
  payload,
  onChange,
}: {
  payload: ProposedPayload;
  onChange: (next: ProposedPayload) => void;
}) {
  switch (payload.kind) {
    case "log_review_note":
      return (
        <Textarea
          rows={4}
          value={payload.note}
          onChange={(event) => onChange({ ...payload, note: event.target.value })}
        />
      );
    case "schedule_follow_up":
      return (
        <div className="space-y-2">
          <Textarea
            rows={2}
            value={payload.note}
            onChange={(event) => onChange({ ...payload, note: event.target.value })}
          />
          <Input
            type="date"
            value={payload.nextFollowUpAt.slice(0, 10)}
            onChange={(event) =>
              onChange({
                ...payload,
                nextFollowUpAt: new Date(event.target.value).toISOString(),
              })
            }
          />
        </div>
      );
    case "confirm_medication_refill":
      return (
        <Input
          type="date"
          value={payload.refillDate.slice(0, 10)}
          onChange={(event) => onChange({ ...payload, refillDate: event.target.value })}
        />
      );
    case "order_investigation":
      // Nothing safely editable: changing the bundle would order a different
      // test than the one the schedule is due for.
      return (
        <p className="text-sm text-charcoal-ink/60">
          This orders exactly the test the patient is due. To order something else, use the
          patient&apos;s own order form.
        </p>
      );
    case "resolve_case":
      return (
        <Textarea
          rows={3}
          value={payload.resolutionNote}
          onChange={(event) => onChange({ ...payload, resolutionNote: event.target.value })}
        />
      );
  }
}

/**
 * The decided history. Attribution is rendered ONLY from a real joined staff
 * record — no name, no line. The DB makes the missing case impossible for a
 * confirmed row (case_review_actions_accepted_requires_attribution), so this
 * gate should never fire; it is here because a UI that would happily render an
 * unattributed clinical claim is one migration away from doing so.
 */
function DecidedRow({ action }: { action: CaseReviewAction }) {
  const payload = action.proposed_payload as unknown as ProposedPayload;
  const signer = action.confirmed_by_staff_record;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1 text-sm">
      <span className="text-charcoal-ink/80">{labelFor(payload)}</span>
      {action.status === "dismissed" ? (
        <span className="text-charcoal-ink/60">
          Declined
          {action.dismissed_by_staff_record
            ? ` by ${action.dismissed_by_staff_record.full_name}`
            : ""}
          {action.dismissal_reason ? `: ${action.dismissal_reason}` : ""}
        </span>
      ) : signer && action.confirmed_at ? (
        <span className="text-charcoal-ink/60">
          {action.status === "modified" ? "Confirmed with changes" : "Confirmed"} by{" "}
          {signer.full_name}
          {signer.credential_type && signer.credential_number
            ? ` (${signer.credential_type} ${signer.credential_number})`
            : ""}{" "}
          on {formatDate(action.confirmed_at)}
        </span>
      ) : (
        <span className="text-charcoal-ink/60">Recorded</span>
      )}
    </div>
  );
}

// Fixed locale — a bare toLocaleDateString resolves the server's locale on
// first render and the browser's on hydration, a real mismatch already caught
// on the case-brief card.
function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
