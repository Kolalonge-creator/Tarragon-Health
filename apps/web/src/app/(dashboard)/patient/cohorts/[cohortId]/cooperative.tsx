"use client";

import { t, type Locale } from "@tarragon/i18n";
import { getProposedConfig, sharedGoalPath, type CooperativeRules } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useChallengeSummary, useEffortHistory, useRestCheckin, useSkipWeek } from "@/lib/queries/cohorts";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

/**
 * The shared-goal path (S69c). It is drawn from the cohort's published progress only (null when the total is pending or hidden, which
 * draws an empty path). Each step is told by SHAPE (filled circle with a tick, ringed circle, dashed circle) and by WORDS, never colour alone.
 * There is no input here that could carry a person's figure, and no name, rank or comparison.
 */
export function SharedGoalPath({ progressPct, locale, idPrefix }: { progressPct: number | null; locale: Locale; idPrefix: string }) {
  const rules = getProposedConfig("cohorts.cooperative").value as CooperativeRules;
  const path = sharedGoalPath(progressPct, rules.path_milestones);
  const waiting = progressPct === null;
  return (
    <div role="group" aria-labelledby={`${idPrefix}-path`} className="space-y-2">
      <h5 id={`${idPrefix}-path`} className="font-medium">{t("community.coop.path.title", locale)}</h5>
      <ol className="flex flex-wrap items-center gap-2">
        {path.steps.map((s) => {
          const state = s.reached ? "reached" : s.current ? "next" : "ahead";
          const stateText = t(`community.coop.path.state.${state}`, locale);
          return (
            <li key={s.index} className="flex items-center gap-1">
              <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" focusable="false" className="shrink-0">
                {s.reached ? (
                  <g><circle cx="14" cy="14" r="12" className="fill-brand-green" /><path d="M8 14.5l4 4 8-9" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></g>
                ) : s.current ? (
                  <circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" strokeWidth="3" />
                ) : (
                  <circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
                )}
              </svg>
              <span className="text-sm">{t("community.coop.path.step", locale, { index: String(s.index), total: String(path.total), state: stateText })}</span>
            </li>
          );
        })}
      </ol>
      <p className="text-sm" role="status">
        {waiting
          ? t("community.coop.path.waiting", locale)
          : path.complete
            ? t("community.coop.path.complete", locale)
            : t("community.coop.path.summary", locale, { reached: String(path.reachedCount), total: String(path.total) })}
      </p>
    </div>
  );
}

/** Weeks active, the rest check-in and skip this week. All of it is private to the member; none of it reaches the group. */
export function CooperativeActions({ challengeId, active, consenting, locale }: { challengeId: string; active: boolean; consenting: boolean; locale: Locale }) {
  const summary = useChallengeSummary(challengeId);
  const rest = useRestCheckin();
  const skip = useSkipWeek();
  const s = summary.data;
  if (!s || !s.available) return null;
  const skipped = s.skipped_this_week;
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p>{s.weeks_active > 0 ? t("community.coop.weeks", locale, { weeks: String(s.weeks_active) }) : t("community.coop.weeks_none", locale)}</p>
      <p className={`text-sm ${MUTED}`}>{t("community.coop.weeks_note", locale)}</p>
      {active ? (
        <div className="flex flex-wrap gap-3">
          {s.rest_available && consenting ? (
            <div className="space-y-1">
              <Button type="button" variant="outline" className={TOUCH} disabled={rest.isPending} onClick={() => rest.mutate(challengeId)}>{t("community.coop.rest.button", locale)}</Button>
              <p className={`text-sm ${MUTED}`}>{t("community.coop.rest.note", locale)}</p>
              {rest.data?.ok ? <p role="status" className="text-sm">{t("community.coop.rest.done", locale)}</p> : null}
            </div>
          ) : null}
          <div className="space-y-1">
            <Button type="button" variant="outline" className={TOUCH} disabled={skip.isPending} onClick={() => skip.mutate({ challenge: challengeId, skip: !skipped })}>
              {t(skipped ? "community.coop.skip.undo" : "community.coop.skip.button", locale)}
            </Button>
            <p className={`text-sm ${MUTED}`}>{t("community.coop.skip.note", locale)}</p>
            {skipped ? <p role="status" className="text-sm">{t("community.coop.skip.done", locale)}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The member's own record view: their own effort history, kept after a challenge ends. Only the member can see it. */
export function EffortHistoryCard({ locale }: { locale: Locale }) {
  const history = useEffortHistory();
  const h = history.data;
  return (
    <Card>
      <CardHeader><CardTitle>{t("community.coop.history.title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className={`text-sm ${MUTED}`}>{t("community.coop.history.note", locale)}</p>
        {!h || h.challenges.length === 0 ? <p>{t("community.coop.history.empty", locale)}</p> : (
          <>
            <p>{t("community.coop.history.weeks", locale, { weeks: String(h.weeks_active) })}</p>
            <ul className="space-y-1">
              {h.challenges.map((c) => (
                <li key={`${c.label}-${c.starts_on}`}>{t("community.coop.history.row", locale, { label: c.label, days: String(c.days_with_effort), rest: String(c.rest_days) })}</li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
