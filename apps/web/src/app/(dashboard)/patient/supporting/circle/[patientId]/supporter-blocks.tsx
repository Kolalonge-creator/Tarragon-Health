import { circleMonthlyLines, parseCircleMonthly, t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";
import type { SupporterView } from "@/lib/care-circle/model";
import { FamilyDoctorNoteCard } from "@/components/care-circle/family-doctor-note-card";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/**
 * The health blocks a supporter sees, and nothing else. Used by the supporter's own page and by the patient's "see what they see"
 * preview, so the preview cannot show anything the real page does not. A block that is absent is simply not shared.
 */
export function SupporterBlocks({ view, locale }: { view: Pick<SupporterView, "adherence" | "bp_trend" | "appointments" | "monthly" | "doctor_note">; locale: Locale }) {
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
    </>
  );
}

/**
 * True when at least one health block above would render. A view with only check-in requests or paying shared has none. A block
 * added above must be added here too, or its page would also show the empty state.
 */
export function hasSharedBlocks(view: Pick<SupporterView, "adherence" | "bp_trend" | "appointments" | "monthly" | "doctor_note">, locale: Locale): boolean {
  const monthly = parseCircleMonthly(view.monthly).filter((r) => circleMonthlyLines(r, locale).length > 0);
  // a doctor's note the patient released counts too, or a page whose only shared item is that note would show the empty state
  return Boolean(view.adherence || view.bp_trend || view.appointments || monthly.length > 0 || view.doctor_note != null);
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
