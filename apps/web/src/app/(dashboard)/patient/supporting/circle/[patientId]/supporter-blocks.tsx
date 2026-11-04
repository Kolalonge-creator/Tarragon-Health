import { circleMonthlyLines, parseCircleMonthly, t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";
import type { SupporterView } from "@/lib/care-circle/model";
import { testCodeLabel } from "@/lib/labs/test-code-labels";
import { FamilyDoctorNoteCard } from "@/components/care-circle/family-doctor-note-card";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/**
 * The health blocks a supporter sees, and nothing else. Used by the supporter's own page and by the patient's "see what they see"
 * preview, so the preview cannot show anything the real page does not. A block that is absent is simply not shared.
 */
type BlockFields = "adherence" | "bp_trend" | "appointments" | "monthly" | "doctor_note" | "investigations" | "results" | "weight_trend" | "plan_progress";

export function SupporterBlocks({ view, locale, name }: { view: Pick<SupporterView, BlockFields>; locale: Locale; name?: string }) {
  const monthly = parseCircleMonthly(view.monthly).filter((r) => circleMonthlyLines(r, locale).length > 0);
  return (
    <>
      {/* the doctor's line for the family first: the most personal thing on the page. Absent = not shared; null = none written yet. */}
      {view.doctor_note !== undefined ? <FamilyDoctorNoteCard note={view.doctor_note} locale={locale} /> : null}

      {view.adherence ? (
        <Card>
          <CardHeader><CardTitle>{t("circle.view.adherence.title", locale)}</CardTitle></CardHeader>
          <CardContent>
            {view.adherence.due === 0 || view.adherence.percent === null ? (
              <p className={MUTED}>{t("circle.view.adherence.none", locale)}</p>
            ) : (
              <p>{t("circle.view.adherence.line", locale, { taken: view.adherence.taken, due: view.adherence.due, percent: view.adherence.percent })}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {view.bp_trend ? (
        <Card>
          <CardHeader><CardTitle>{t("circle.view.bp.title", locale)}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {view.bp_trend.weeks.every((w) => w.readings === 0) ? <p className={MUTED}>{t("circle.view.bp.none", locale)}</p> : null}
            <ul className="space-y-1">
              {view.bp_trend.weeks.filter((w) => w.readings > 0).map((w) => (
                <li key={w.week_start}>
                  {w.systolic !== null && w.diastolic !== null
                    ? t("circle.view.bp.row", locale, { date: formatPatientDate(w.week_start), systolic: w.systolic, diastolic: w.diastolic, count: w.readings })
                    : t("supporterview.bp.row_few", locale, { date: formatPatientDate(w.week_start) })}
                </li>
              ))}
            </ul>
            {view.bp_trend.direction ? <p className="font-medium">{t(`circle.view.bp.${view.bp_trend.direction}`, locale)}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {monthly.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>{t("circle.view.monthly.title", locale)}</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {monthly.flatMap((r) => circleMonthlyLines(r, locale).map((l) => <li key={`${r.month}-${l}`}>{l}</li>))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {view.appointments ? (
        <Card>
          <CardHeader><CardTitle>{t("circle.view.appt.title", locale)}</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <p>{view.appointments.next_at ? t("circle.view.appt.next", locale, { date: formatPatientDateTime(view.appointments.next_at) }) : t("circle.view.appt.none", locale)}</p>
            <p className={MUTED}>{t("circle.view.appt.missed", locale, { count: view.appointments.missed_30d })}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Care Circle P2: where each everyday test has got to. Names and stages only, never a value. */}
      {view.investigations ? (
        <Card>
          <CardHeader><CardTitle>{t("circlep2.tests.title", locale)}</CardTitle></CardHeader>
          <CardContent>
            {view.investigations.length === 0 ? <p className={MUTED}>{t("circlep2.tests.none", locale)}</p> : null}
            <ul className="divide-y">
              {view.investigations.map((row) => (
                <li key={row.code} className="py-2">
                  <p className="font-medium">{testCodeLabel(row.code)}</p>
                  <p className="text-sm">{t(`circlep2.stage.${row.stage}`, locale)}</p>
                  {row.due_date && (row.stage === "due" || row.stage === "overdue") ? (
                    <p className={`text-sm ${MUTED}`}>{t("circlep2.tests.due_on", locale, { date: formatPatientDate(row.due_date) })}</p>
                  ) : null}
                  {row.follow_up ? <p className="text-sm font-medium">{t("circlep2.tests.follow_up", locale)}</p> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* D2: values only of results a doctor reviewed and released; in plain words against the lab's own range, never a verdict. */}
      {view.results ? (
        <Card>
          <CardHeader><CardTitle>{t("circlep2.results.title", locale)}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {view.results.length === 0 ? <p className={MUTED}>{t("circlep2.results.none", locale)}</p> : null}
            <ul className="divide-y">
              {view.results.map((r) => (
                <li key={r.code} className="py-2">
                  <p>
                    <span className="font-medium">{testCodeLabel(r.code)}</span>
                    {": "}
                    {r.value !== null ? `${r.value} ${r.unit}` : (r.value_text ?? "")}
                  </p>
                  {r.in_range !== null ? (
                    <p className="text-sm">{r.in_range ? t("circlep2.results.in_range", locale) : t("circlep2.results.out_range", locale)}</p>
                  ) : null}
                  <p className={`text-sm ${MUTED}`}>{t("circlep2.results.on", locale, { date: formatPatientDate(r.at) })}</p>
                </li>
              ))}
            </ul>
            {view.results.length > 0 ? <p className="text-sm font-medium">{t("circlep2.results.ask", locale, { name: name ?? "" })}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {view.weight_trend ? (
        <Card>
          <CardHeader><CardTitle>{t("circlep2.weight.title", locale)}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {view.weight_trend.weeks.every((w) => w.kg === null) ? <p className={MUTED}>{t("circlep2.weight.none", locale)}</p> : null}
            <ul className="space-y-1">
              {view.weight_trend.weeks.filter((w) => w.kg !== null).map((w) => (
                <li key={w.week_start}>{t("circlep2.weight.row", locale, { date: formatPatientDate(w.week_start), kg: String(w.kg) })}</li>
              ))}
            </ul>
            {view.weight_trend.direction ? <p className="font-medium">{t(`circlep2.weight.${view.weight_trend.direction}`, locale)}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {view.plan_progress ? (
        <Card>
          <CardHeader><CardTitle>{t("circlep2.plan.title", locale)}</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {view.plan_progress.done + view.plan_progress.due + view.plan_progress.overdue === 0 ? (
              <p className={MUTED}>{t("circlep2.plan.none", locale)}</p>
            ) : (
              <p>{t("circlep2.plan.line", locale, { done: view.plan_progress.done, due: view.plan_progress.due, overdue: view.plan_progress.overdue })}</p>
            )}
            {view.plan_progress.next_due ? <p className={MUTED}>{t("circlep2.plan.next", locale, { date: formatPatientDate(view.plan_progress.next_due) })}</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

/**
 * True when at least one health block above would render. A view with only check-in requests or paying shared has none. A block
 * added above must be added here too, or its page would also show the empty state.
 */
export function hasSharedBlocks(view: Pick<SupporterView, BlockFields>, locale: Locale): boolean {
  const monthly = parseCircleMonthly(view.monthly).filter((r) => circleMonthlyLines(r, locale).length > 0);
  // a doctor's note the patient released counts too, or a page whose only shared item is that note would show the empty state
  return Boolean(view.adherence || view.bp_trend || view.appointments || monthly.length > 0 || view.doctor_note != null
    || view.investigations || view.results || view.weight_trend || view.plan_progress);
}

/**
 * The empty state for a person who shared only check-in requests or paying: a calm sentence that nothing health-related is shown
 * here, and what still holds, so an empty page never reads as "something is wrong".
 */
export function SupporterBlocksEmpty({ view, locale }: { view: Pick<SupporterView, "name" | "permissions">; locale: Locale }) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-6" data-testid="supporter-blocks-empty">
        <p>{t("supporterjoin.view.empty", locale, { name: view.name })}</p>
        {view.permissions.includes("red_alerts") ? <p className={MUTED}>{t("supporterjoin.view.empty_alerts", locale)}</p> : null}
        {view.permissions.includes("pay_for_care") ? <p className={MUTED}>{t("supporterjoin.view.empty_pay", locale)}</p> : null}
      </CardContent>
    </Card>
  );
}
