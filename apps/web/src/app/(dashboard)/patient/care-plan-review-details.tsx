"use client";

import { useState } from "react";
import { Disclosure } from "@/components/ui/disclosure";
import { Button } from "@/components/ui/button";
import { CARE_PLAN_CATEGORY_LABEL, CARE_PLAN_COPY } from "@/lib/care-plan/patient-copy";
import {
  formatPlanDate,
  groupActionsByCategory,
  pendingAcknowledgements,
  snapshotActions,
  type CarePlanRevision,
  type PlanActionView,
} from "@/lib/care-plan/plan-view";
import { acknowledgeCarePlanChange } from "@/app/(dashboard)/patient/care-plan-acknowledge-action";

const MUTED = "text-xs text-charcoal-ink/60 dark:text-night-ink/60";

function humanize(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function snapshotCondition(snapshot: unknown): string | null {
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) return null;
  const c = (snapshot as Record<string, unknown>).condition;
  return typeof c === "string" ? humanize(c) : null;
}

/**
 * PD-06: the box at the top of the care plan listing changes the doctor marked as needing acknowledgement. "Got it" records
 * the acknowledgement for each listed change; the box goes away once they are all saved (onAcknowledged refetches). While a
 * supporter is acting for the patient there is no button: only the patient can confirm, and the database refuses anyone else.
 */
export function CarePlanChangeNotice({
  revisions,
  actingForName,
  onAcknowledged,
}: {
  revisions: readonly CarePlanRevision[];
  /** The patient's name when a supporter is acting for them; undefined when the patient is signed in themself. */
  actingForName?: string | null;
  onAcknowledged: () => void;
}) {
  const pending = pendingAcknowledgements(revisions);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (pending.length === 0 || hidden) return null;
  const acting = actingForName !== undefined;

  async function gotIt() {
    setSaving(true);
    setFailed(false);
    let allOk = true;
    for (const revision of pending) {
      const result = await acknowledgeCarePlanChange({ revisionId: revision.id });
      if (!result.ok) allOk = false;
    }
    setSaving(false);
    if (allOk) setHidden(true);
    else setFailed(true);
    onAcknowledged();
  }

  return (
    <section
      aria-label={CARE_PLAN_COPY.changeNoticeTitle}
      className="space-y-3 rounded-lg border border-brand-green/40 bg-white p-3 dark:border-brand-green-bright/40 dark:bg-night-card"
    >
      <div>
        <p className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">{CARE_PLAN_COPY.changeNoticeTitle}</p>
        <p className={MUTED}>{CARE_PLAN_COPY.changeNoticeIntro}</p>
      </div>
      <ul className="space-y-2">
        {pending.map((revision) => {
          const condition = snapshotCondition(revision.plan_snapshot);
          return (
            <li key={revision.id} className="text-sm text-charcoal-ink dark:text-night-ink">
              <p className={MUTED}>
                {condition ? `${condition} · ` : ""}
                {CARE_PLAN_COPY.changeNoticeChangedOn} {formatPlanDate(revision.published_at)}
              </p>
              <p>{revision.change_summary}</p>
            </li>
          );
        })}
      </ul>
      {acting ? (
        <p className={MUTED}>{CARE_PLAN_COPY.ackOnlyPatient(actingForName?.trim().split(/\s+/)[0] || null)}</p>
      ) : (
        <Button size="sm" disabled={saving} onClick={gotIt}>
          {saving ? CARE_PLAN_COPY.saving : CARE_PLAN_COPY.gotIt}
        </Button>
      )}
      {failed && <p className="text-xs text-red-600 dark:text-red-300">{CARE_PLAN_COPY.ackFailed}</p>}
    </section>
  );
}

/** Review dates for one plan. */
export function CarePlanReviewDates({ lastReviewedAt, nextReviewAt }: { lastReviewedAt: string | null; nextReviewAt: string | null }) {
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
      <div className="flex gap-1">
        <dt>{CARE_PLAN_COPY.lastReviewed}:</dt>
        <dd className="font-medium text-charcoal-ink dark:text-night-ink">{formatPlanDate(lastReviewedAt) ?? CARE_PLAN_COPY.notReviewedYet}</dd>
      </div>
      <div className="flex gap-1">
        <dt>{CARE_PLAN_COPY.nextReview}:</dt>
        <dd className="font-medium text-charcoal-ink dark:text-night-ink">{formatPlanDate(nextReviewAt) ?? CARE_PLAN_COPY.noNextReview}</dd>
      </div>
    </dl>
  );
}

function ActionItem({ action }: { action: PlanActionView }) {
  return (
    <li className="space-y-0.5 py-1.5">
      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
        {action.description}
        {action.frequency && <span className="font-normal text-charcoal-ink/60 dark:text-night-ink/60"> · {action.frequency}</span>}
      </p>
      {action.why && (
        <p className={MUTED}>
          <span className="font-semibold">{CARE_PLAN_COPY.why}:</span> {action.why}
        </p>
      )}
      {action.when && (
        <p className={MUTED}>
          <span className="font-semibold">{CARE_PLAN_COPY.when}:</span> {action.when}
        </p>
      )}
      {action.how && (
        <p className={MUTED}>
          <span className="font-semibold">{CARE_PLAN_COPY.how}:</span> {action.how}
        </p>
      )}
    </li>
  );
}

/** A plan's actions grouped by category, each with its why / when / how. */
export function CarePlanActionsByCategory({ actions, showHeading = true }: { actions: readonly PlanActionView[]; showHeading?: boolean }) {
  const groups = groupActionsByCategory(actions);
  return (
    <div className="space-y-2">
      {showHeading && (
        <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
          {CARE_PLAN_COPY.actionsHeading}
        </p>
      )}
      {groups.length === 0 ? (
        <p className={MUTED}>{CARE_PLAN_COPY.noActions}</p>
      ) : (
        groups.map((group) => (
          <div key={group.category ?? "other"}>
            <p className="text-xs font-medium text-deep-forest dark:text-brand-green-bright">
              {group.category ? CARE_PLAN_CATEGORY_LABEL[group.category] : CARE_PLAN_COPY.otherActions}
            </p>
            <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
              {group.actions.map((action, i) => (
                <ActionItem key={`${action.description}-${i}`} action={action} />
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

/**
 * Earlier versions of one plan, folded. Every published version is listed, newest first, with what changed and the plan
 * as it stood when that version was published (the live plan above may have moved on since the newest one).
 */
export function CarePlanEarlierVersions({ revisions }: { revisions: readonly CarePlanRevision[] }) {
  const older = [...revisions].sort((a, b) => b.version_number - a.version_number);
  return (
    <Disclosure title={CARE_PLAN_COPY.earlierVersions} hint={CARE_PLAN_COPY.earlierVersionsHint}>
      {older.length === 0 ? (
        <p className={MUTED}>{CARE_PLAN_COPY.noEarlierVersions}</p>
      ) : (
        <ol className="space-y-4">
          {older.map((revision) => (
            <li key={revision.id} className="space-y-1">
              <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                {CARE_PLAN_COPY.versionLabel(revision.version_number)} · {formatPlanDate(revision.published_at)}
              </p>
              <p className={MUTED}>
                <span className="font-semibold">{CARE_PLAN_COPY.whatChanged}:</span> {revision.change_summary}
              </p>
              <CarePlanActionsByCategory actions={snapshotActions(revision.plan_snapshot)} showHeading={false} />
            </li>
          ))}
        </ol>
      )}
    </Disclosure>
  );
}
