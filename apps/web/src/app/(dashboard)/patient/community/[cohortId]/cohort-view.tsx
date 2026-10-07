"use client";

import { useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/form-error";
import { REPORT_REASONS, REPORT_REASON_KEYS, UNIT_KEYS, communityErrorKey, communityJoinPath, type Challenge, type ReportReason } from "@/lib/community/model";
import {
  CommunityError,
  useBoard,
  useCloseCohort,
  useCohortChallenges,
  useContribute,
  useCreateInvite,
  useLeave,
  useModeratorReports,
  useMute,
  useMyCohorts,
  useRemoveMember,
  useReport,
  useRoster,
  useStartChallenge,
  useTemplates,
  useTotalsConsent,
} from "@/lib/queries/community";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

function errText(e: unknown, locale: Locale): string | null {
  if (!e) return null;
  return t(communityErrorKey(e instanceof CommunityError ? e.message : null), locale);
}

/** A goal bar. It shows the cohort's percentage only; there is no input anywhere that could carry a person's figure. */
function GoalBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label} className="h-3 w-full overflow-hidden rounded-full bg-charcoal-ink/10 dark:bg-night-ink/20">
        <div className="h-full rounded-full bg-brand-green" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-sm">{label}</p>
    </div>
  );
}

function BoardPanel({ challengeId, locale }: { challengeId: string; locale: Locale }) {
  const board = useBoard(challengeId);
  if (board.isPending || !board.data || board.data.state === "hidden") return null;
  return (
    <div role="group" aria-labelledby={`board-${challengeId}`} className="space-y-2 rounded-lg border p-3">
      <h4 id={`board-${challengeId}`} className="font-medium">{t("community.board.title", locale)}</h4>
      <p className={`text-sm ${MUTED}`}>{t("community.board.note", locale)}</p>
      {board.data.state === "not_ready" ? <p className="text-sm">{t("community.board.not_ready", locale)}</p> : (
        <ol className="space-y-1">
          {board.data.rows.map((r) => (
            <li key={`${r.rank}-${r.label}`} className={r.is_yours ? "font-medium" : ""}>
              {t("community.board.row", locale, { label: r.is_yours ? t("community.board.yours", locale) : r.label, percent: String(r.progress_pct) })}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ChallengeCard({ c, locale, consenting }: { c: Challenge; locale: Locale; consenting: boolean }) {
  const contribute = useContribute();
  const [minutes, setMinutes] = useState("");
  const isMinutes = c.unit === "minutes";
  const result = contribute.data;
  const needsConsent = !consenting || result?.reason === "consent_needed";
  const phaseKey = c.phase === "scheduled" ? "community.challenge.phase.scheduled" : c.phase === "active" ? "community.challenge.phase.active" : "community.challenge.phase.ended";
  const phaseDate = c.phase === "scheduled" ? c.starts_on : c.ends_on;
  return (
    <li className="space-y-3 rounded-lg border p-4">
      <div>
        <h4 className="font-medium">{c.label}</h4>
        <p className={`text-sm ${MUTED}`}>{t(phaseKey, locale, { date: phaseDate })}</p>
      </div>

      {c.total.state === "shown" ? (
        <div className="space-y-2">
          <GoalBar percent={c.total.progress_pct} label={t("community.challenge.progress", locale, { percent: String(c.total.progress_pct) })} />
          <p>{t("community.challenge.total", locale, { total: String(c.total.total), unit: t(UNIT_KEYS[c.unit], locale) })}</p>
          {c.total.goal_reached ? <p role="status" className="font-medium">{t("community.challenge.goal", locale)}</p> : null}
          <p className={`text-sm ${MUTED}`}>{t("community.challenge.group_size", locale, { band: c.total.group_size })} · {t("community.challenge.as_of", locale, { date: c.total.as_of })}</p>
        </div>
      ) : c.total.state === "hidden" ? <p className={MUTED}>{t("community.challenge.hidden", locale)}</p> : <p className={MUTED}>{t("community.challenge.pending", locale)}</p>}

      {!c.available ? <p className="text-sm">{t("community.challenge.unavailable", locale)}</p> : c.phase === "active" ? (
        <div className="space-y-2">
          {needsConsent ? <p className="text-sm">{t("community.challenge.needs_consent", locale)}</p> : (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                contribute.mutate({ challenge: c.challenge_id, minutes: isMinutes ? Number(minutes) : undefined }, { onSuccess: () => setMinutes("") });
              }}
            >
              {isMinutes ? (
                <div className="space-y-1">
                  <Label htmlFor={`min-${c.challenge_id}`}>{t("community.challenge.minutes", locale)}</Label>
                  <Input id={`min-${c.challenge_id}`} type="number" inputMode="numeric" min={1} max={180} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-28" required />
                </div>
              ) : null}
              <Button type="submit" className={TOUCH} disabled={contribute.isPending || (isMinutes && Number(minutes) < 1)}>
                {t("community.challenge.add_today", locale)}
              </Button>
            </form>
          )}
          {result?.ok ? <p role="status" className="text-sm">{t(result.capped ? "community.challenge.capped" : "community.challenge.counted", locale)}</p> : null}
          {result && !result.ok && result.reason === "not_available" ? <p className="text-sm">{t("community.challenge.unavailable", locale)}</p> : null}
          <FormError id={`contribute-error-${c.challenge_id}`} message={errText(contribute.error, locale)} />
        </div>
      ) : null}

      <BoardPanel challengeId={c.challenge_id} locale={locale} />
    </li>
  );
}

function ModeratorTools({ cohortId, locale }: { cohortId: string; locale: Locale }) {
  const invite = useCreateInvite();
  const templates = useTemplates(true);
  const start = useStartChallenge();
  const close = useCloseCohort();
  const reports = useModeratorReports(cohortId, true);
  const remove = useRemoveMember();
  const [template, setTemplate] = useState("");
  const [days, setDays] = useState("14");
  const [copied, setCopied] = useState(false);
  const link = invite.data ? `${typeof window === "undefined" ? "" : window.location.origin}${communityJoinPath(invite.data.token)}` : null;

  async function share(url: string) {
    // The phone's own share menu is the only way out. There is no WhatsApp button or link (founder decision, spec 17 safety rules).
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try { await navigator.share({ url, title: t("community.join.title", locale) }); return; } catch { /* fall through to copy */ }
    }
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* the link stays on screen to copy by hand */ }
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  return (
    <Card>
      <CardHeader><CardTitle>{t("community.mod.title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <p className={`text-sm ${MUTED}`}>{t("community.mod.no_health", locale)}</p>

        <section className="space-y-2" aria-label={t("community.mod.invite", locale)}>
          <Button type="button" className={TOUCH} disabled={invite.isPending} onClick={() => { setCopied(false); invite.mutate(cohortId); }}>{t("community.mod.invite", locale)}</Button>
          <p className={`text-sm ${MUTED}`}>{t("community.mod.invite_note", locale)}</p>
          {link ? (
            <div className="space-y-2">
              <p className="break-all rounded border p-2 text-sm">{link}</p>
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" className={TOUCH} onClick={() => void share(link)}>{t("community.mod.share", locale)}</Button>
                {copied ? <span role="status" className="self-center text-sm">{t("community.mod.copied", locale)}</span> : null}
              </div>
            </div>
          ) : null}
          <FormError id="invite-error" message={errText(invite.error, locale)} />
        </section>

        <section className="space-y-2" aria-label={t("community.mod.start", locale)}>
          <h4 className="font-medium">{t("community.mod.start", locale)}</h4>
          {(templates.data ?? []).length === 0 ? <p className={`text-sm ${MUTED}`}>{t("community.mod.no_templates", locale)}</p> : (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                start.mutate({ cohort: cohortId, template, startsOn: today, days: Number(days) });
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="mod-template">{t("community.mod.template", locale)}</Label>
                <select id="mod-template" className={`rounded-md border bg-transparent px-3 ${TOUCH}`} value={template} onChange={(e) => { setTemplate(e.target.value); const tp = templates.data?.find((x) => x.code === e.target.value); if (tp) setDays(String(tp.default_days)); }} required>
                  <option value="" />
                  {(templates.data ?? []).map((tp) => <option key={tp.code} value={tp.code}>{tp.label}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mod-days">{t("community.mod.days", locale)}</Label>
                <Input id="mod-days" type="number" min={7} max={60} value={days} onChange={(e) => setDays(e.target.value)} className="w-24" required />
              </div>
              <Button type="submit" className={TOUCH} disabled={!template || start.isPending}>{t("community.mod.start", locale)}</Button>
            </form>
          )}
          <FormError id="start-error" message={errText(start.error, locale)} />
        </section>

        <section className="space-y-2" aria-label={t("community.mod.reports", locale)}>
          <h4 className="font-medium">{t("community.mod.reports", locale)}</h4>
          {(reports.data ?? []).length === 0 ? <p className={`text-sm ${MUTED}`}>{t("community.mod.no_reports", locale)}</p> : (
            <ul className="space-y-2">
              {(reports.data ?? []).map((r) => (
                <li key={r.report_id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-2">
                  <span className="text-sm">{t(REPORT_REASON_KEYS[(REPORT_REASONS as readonly string[]).includes(r.reason) ? (r.reason as ReportReason) : "something_else"], locale)} · {r.created_on}</span>
                  <Button type="button" variant="outline" className={TOUCH} disabled={remove.isPending} onClick={() => remove.mutate({ cohort: cohortId, member: r.member_id })}>{t("community.mod.remove", locale)}</Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <Button
            type="button"
            variant="outline"
            className={TOUCH}
            disabled={close.isPending}
            onClick={() => { if (window.confirm(t("community.mod.close_confirm", locale))) close.mutate(cohortId); }}
          >
            {t("community.mod.close", locale)}
          </Button>
        </section>
      </CardContent>
    </Card>
  );
}

export function CohortView({ cohortId, locale }: { cohortId: string; locale: Locale }) {
  const mine = useMyCohorts();
  const challenges = useCohortChallenges(cohortId);
  const roster = useRoster(cohortId);
  const consent = useTotalsConsent();
  const mute = useMute();
  const leave = useLeave();
  const report = useReport();
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState<ReportReason>("concerning_behaviour");

  if (mine.isPending) return <p className={MUTED} role="status">{t("community.loading", locale)}</p>;
  const cohort = mine.data?.cohorts.find((c) => c.cohort_id === cohortId);
  if (!mine.data?.open || !cohort) {
    return <p role="status">{leave.data?.ok ? t("community.left", locale) : t("community.closed", locale)}</p>;
  }
  if (cohort.state === "closed") return <p role="status">{t("community.mod.closed", locale)}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-semibold">{cohort.name}</h2>
        {cohort.muted ? <p className={`text-sm ${MUTED}`}>{t("community.muted_note", locale)}</p> : null}
      </div>

      <Card>
        <CardHeader><CardTitle>{t("community.totals.title", locale)}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className={`text-sm ${MUTED}`}>{t("community.totals.consent_body", locale)}</p>
          <p role="status">{t(cohort.contributing ? "community.totals.on" : "community.totals.off", locale)}</p>
          <Button type="button" variant="outline" className={TOUCH} disabled={consent.isPending} onClick={() => consent.mutate({ cohort: cohortId, on: !cohort.contributing })}>
            {t(cohort.contributing ? "community.totals.withdraw" : "community.totals.agree", locale)}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("community.challenges.title", locale)}</CardTitle></CardHeader>
        <CardContent>
          {challenges.isPending ? <p className={MUTED} role="status">…</p> : (challenges.data ?? []).length === 0 ? <p className={MUTED}>{t("community.challenges.none", locale)}</p> : (
            <ul className="space-y-4">
              {(challenges.data ?? []).map((c) => <ChallengeCard key={c.challenge_id} c={c} locale={locale} consenting={cohort.contributing} />)}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("community.group.members", locale)}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className={`text-sm ${MUTED}`}>{t("community.group.members_note", locale)}</p>
          <ul className="space-y-2">
            {(roster.data ?? []).map((m) => (
              <li key={m.member_id} className="flex flex-wrap items-center justify-between gap-3">
                <span>{m.first_name}{m.is_you ? ` (${t("community.group.you", locale)})` : ""} · {t(m.role === "moderator" ? "community.group.role.moderator" : "community.group.role.member", locale)}</span>
                {!m.is_you ? (
                  <Button type="button" variant="outline" className={TOUCH} onClick={() => setReporting(reporting === m.member_id ? null : m.member_id)}>{t("community.report.member", locale)}</Button>
                ) : null}
                {reporting === m.member_id ? (
                  <div className="w-full space-y-2 rounded border p-3">
                    <p className={`text-sm ${MUTED}`}>{t("community.report.note", locale)}</p>
                    <select aria-label={t("community.report.title", locale)} className={`rounded-md border bg-transparent px-3 ${TOUCH}`} value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
                      {REPORT_REASONS.map((r) => <option key={r} value={r}>{t(REPORT_REASON_KEYS[r], locale)}</option>)}
                    </select>
                    <Button type="button" className={TOUCH} disabled={report.isPending} onClick={() => report.mutate({ cohort: cohortId, member: m.member_id, reason }, { onSuccess: () => setReporting(null) })}>{t("community.report.title", locale)}</Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {report.data?.ok ? <p role="status" className="text-sm">{t("community.report.sent", locale)}</p> : null}
        </CardContent>
      </Card>

      {cohort.is_moderator ? <ModeratorTools cohortId={cohortId} locale={locale} /> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" className={TOUCH} disabled={mute.isPending} onClick={() => mute.mutate({ cohort: cohortId, muted: !cohort.muted })}>
          {t(cohort.muted ? "community.unmute" : "community.mute", locale)}
        </Button>
        <Button type="button" variant="outline" className={TOUCH} disabled={leave.isPending} onClick={() => { if (window.confirm(t("community.leave.confirm", locale))) leave.mutate(cohortId); }}>
          {t("community.leave", locale)}
        </Button>
      </div>
    </div>
  );
}
