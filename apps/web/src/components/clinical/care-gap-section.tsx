"use client";

import { useState } from "react";
import Link from "next/link";
import { careGapText, type CareGapCopyKey } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useCareGapAttempts,
  useCloseCareGap,
  useLogCareGapAttempt,
  useOpenCareGaps,
  type CareGapWithPeople,
} from "@/lib/queries/care-gaps";
import {
  ATTEMPT_RESULTS,
  MANUAL_CLOSURE_REASONS,
  gapTypeLabel,
  isDoctorGap,
  lagosShortDate,
  nextAttempt,
  nextAttemptText,
  reviewClock,
  reviewClockText,
  whyOpenLines,
  type AttemptResult,
  type ManualClosureReason,
} from "@/lib/care-gaps/gap-model";

const selectClass =
  "h-8 rounded-md border border-charcoal-ink/20 bg-white px-2 text-xs text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";

/** The panel that answers "why is this gap open": the failed criterion and the last signal. Staff only; no notification ever carries it. */
function WhyOpenPanel({ gap }: { gap: CareGapWithPeople }) {
  const lines = whyOpenLines(gap);
  return (
    <div className="space-y-1 rounded-md border border-charcoal-ink/10 bg-warm-ivory/60 p-3" data-testid="why-open-panel">
      <p className="text-xs font-medium text-charcoal-ink/70">{careGapText("staff.why.heading")}</p>
      {lines.map((line) => (
        <p key={line} className="text-xs text-charcoal-ink">
          {line}
        </p>
      ))}
      <p className="text-[11px] text-charcoal-ink/60">{careGapText("staff.why.staff_only")}</p>
    </div>
  );
}

function AttemptLog({ gapId }: { gapId: string }) {
  const { data, isLoading, isError } = useCareGapAttempts(gapId, true);
  if (isLoading) return <p className="text-xs text-charcoal-ink/60">Loading…</p>;
  if (isError) return <p className="text-xs text-red-600">Could not load the contact log.</p>;
  if (!data || data.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs text-charcoal-ink/80">
      {data.map((a) => (
        <li key={a.id}>
          {lagosShortDate(a.attempted_at)} · {a.step.replace(/_/g, " ")} · {a.result.replace(/_/g, " ")}
          {a.note ? ` · ${a.note}` : ""}
        </li>
      ))}
    </ul>
  );
}

function LogAttemptForm({ gapId }: { gapId: string }) {
  const log = useLogCareGapAttempt();
  const [result, setResult] = useState<AttemptResult>("call_no_answer");
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-charcoal-ink/70">{careGapText("staff.log.heading")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <select aria-label={careGapText("staff.log.heading")} className={selectClass} value={result} onChange={(e) => setResult(e.target.value as AttemptResult)}>
          {ATTEMPT_RESULTS.map((r) => (
            <option key={r} value={r}>
              {careGapText(`staff.log.result.${r}` as CareGapCopyKey)}
            </option>
          ))}
        </select>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={careGapText("staff.log.note")} className="h-8 min-w-56 flex-1 text-xs" />
        <Button
          size="sm"
          disabled={log.isPending || note.trim().length === 0}
          onClick={() => log.mutate({ gapId, result, note: note.trim() }, { onSuccess: () => setNote("") })}
        >
          {careGapText("staff.log.submit")}
        </Button>
      </div>
      {log.isError && <p className="text-xs text-red-600">{(log.error as Error).message || "Could not log this."}</p>}
    </div>
  );
}

function CloseForm({ gapId }: { gapId: string }) {
  const close = useCloseCareGap();
  const [reason, setReason] = useState<ManualClosureReason>("declined");
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-charcoal-ink/70">{careGapText("staff.close.heading")}</p>
      <p className="text-[11px] text-charcoal-ink/60">{careGapText("staff.close.help")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <select aria-label={careGapText("staff.close.heading")} className={selectClass} value={reason} onChange={(e) => setReason(e.target.value as ManualClosureReason)}>
          {MANUAL_CLOSURE_REASONS.map((r) => (
            <option key={r} value={r}>
              {careGapText(`staff.close.${r}` as CareGapCopyKey)}
            </option>
          ))}
        </select>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={careGapText("staff.close.note")} className="h-8 min-w-56 flex-1 text-xs" />
        <Button size="sm" variant="outline" disabled={close.isPending || note.trim().length < 5} onClick={() => close.mutate({ gapId, reason, note: note.trim() })}>
          {careGapText("staff.close.submit")}
        </Button>
      </div>
      {close.isError && <p className="text-xs text-red-600">{(close.error as Error).message || "Could not close this gap."}</p>}
    </div>
  );
}

function GapRow({ gap }: { gap: CareGapWithPeople }) {
  const [open, setOpen] = useState(false);
  const next = nextAttempt(gap);
  const review = reviewClock(gap);
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          <Link href={`/clinician/patients/${gap.patient_id}`} className="hover:underline">
            {gap.patient?.full_name ?? "Patient"}
          </Link>
          {gap.patient?.patient_number ? ` · ${gap.patient.patient_number}` : ""}
        </p>
        <Badge variant="blue">{gapTypeLabel(gap.gap_type)}</Badge>
        {gap.days_overdue > 0 && <Badge variant={gap.days_overdue >= 14 ? "amber" : "grey"}>{careGapText("staff.overdue", { days: gap.days_overdue })}</Badge>}
        {gap.trend_flag && <Badge variant="red">{careGapText("staff.trend.flag")}</Badge>}
        {isDoctorGap(gap) && <Badge variant="grey">{careGapText("staff.owner.doctor")}</Badge>}
        {gap.shadow && <Badge variant="grey">{careGapText("staff.shadow.badge")}</Badge>}
        {gap.owner_id === null && <Badge variant="red">{careGapText("staff.unowned.note")}</Badge>}
      </div>
      <p className="text-xs text-charcoal-ink/70">
        {nextAttemptText(next)} · {careGapText("staff.attempts", { n: gap.attempt_count })}
      </p>
      {review.kind !== "none" && (
        <p className={review.kind === "overdue" ? "text-xs font-medium text-red-700" : "text-xs text-charcoal-ink/70"} data-testid="review-clock">
          {reviewClockText(review)}
          {gap.review_escalated_at ? ` · ${careGapText("staff.review.escalated")}` : ""}
        </p>
      )}
      {gap.shadow && <p className="text-[11px] text-charcoal-ink/60">{careGapText("staff.shadow.note")}</p>}
      <WhyOpenPanel gap={gap} />
      <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide log and actions" : "Log a contact or close"}
      </Button>
      {open && (
        <div className="space-y-3 rounded-md border border-charcoal-ink/10 p-3">
          <AttemptLog gapId={gap.id} />
          <LogAttemptForm gapId={gap.id} />
          <CloseForm gapId={gap.id} />
        </div>
      )}
    </li>
  );
}

/**
 * S90: the care gaps assigned to the signed-in staff member, ranked, each with its "why this gap is open" panel, the contact log and the two ways a person
 * may close one without an outcome. Rendered on the coordinator and clinician outreach worklists. Reads through row level security only.
 */
export function CareGapSection({ unowned = false }: { unowned?: boolean } = {}) {
  const { data, isLoading, isError } = useOpenCareGaps();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{careGapText(unowned ? "staff.unowned.title" : "staff.section.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-charcoal-ink/60">{careGapText(unowned ? "staff.unowned.intro" : "staff.section.intro")}</p>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the care gaps.</p>}
        {data && data.length === 0 && <p className="text-sm text-charcoal-ink/60">{careGapText(unowned ? "staff.unowned.empty" : "staff.section.empty")}</p>}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((gap) => (
              <GapRow key={gap.id} gap={gap} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
