import { asLocale, circleMonthlyLines, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import type { SupporterView } from "@/lib/care-circle/parse";
import { Card, MutedText } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

function lagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}
function lagosDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * The health blocks a supporter sees, and nothing else. Used by the supporter's own page and by the patient's "see what they see"
 * preview, so the preview cannot show anything the real page does not. A block that is absent is simply not shared.
 */
export function SupporterBlocks({ view }: { view: Pick<SupporterView, "adherence" | "bpTrend" | "appointments" | "monthly"> }) {
  const locale = asLocale(useUiLanguage());
  const dir = view.bpTrend?.direction ?? null;
  const monthly = (view.monthly ?? []).filter((r) => circleMonthlyLines(r, locale).length > 0);
  return (
    <>
      {view.adherence ? (
        <Card style={{ gap: 4 }}>
          <AppText variant="bodyStrong">{t("circle.view.adherence.title", locale)}</AppText>
          {view.adherence.due === 0 || view.adherence.percent === null ? (
            <MutedText>{t("circle.view.adherence.none", locale)}</MutedText>
          ) : (
            <AppText variant="body">{t("circle.view.adherence.line", locale, { taken: view.adherence.taken, due: view.adherence.due, percent: view.adherence.percent })}</AppText>
          )}
        </Card>
      ) : null}

      {view.bpTrend ? (
        <Card style={{ gap: 4 }}>
          <AppText variant="bodyStrong">{t("circle.view.bp.title", locale)}</AppText>
          {view.bpTrend.weeks.every((w) => w.readings === 0) ? <MutedText>{t("circle.view.bp.none", locale)}</MutedText> : null}
          {view.bpTrend.weeks.filter((w) => w.readings > 0).map((w) => (
            <AppText variant="body" key={w.weekStart}>
              {w.systolic !== null && w.diastolic !== null
                ? t("circle.view.bp.row", locale, { date: lagosDate(w.weekStart), systolic: w.systolic, diastolic: w.diastolic, count: w.readings })
                : t("supporterview.bp.row_few", locale, { date: lagosDate(w.weekStart) })}
            </AppText>
          ))}
          {dir ? <AppText variant="bodyStrong">{t(`circle.view.bp.${dir}`, locale)}</AppText> : null}
        </Card>
      ) : null}

      {monthly.length > 0 ? (
        <Card style={{ gap: 4 }}>
          <AppText variant="bodyStrong">{t("circle.view.monthly.title", locale)}</AppText>
          {monthly.flatMap((r) => circleMonthlyLines(r, locale).map((l) => <AppText variant="body" key={`${r.month}-${l}`}>{l}</AppText>))}
        </Card>
      ) : null}

      {view.appointments ? (
        <Card style={{ gap: 4 }}>
          <AppText variant="bodyStrong">{t("circle.view.appt.title", locale)}</AppText>
          <AppText variant="body">{view.appointments.nextAt ? t("circle.view.appt.next", locale, { date: lagosDateTime(view.appointments.nextAt) }) : t("circle.view.appt.none", locale)}</AppText>
          <MutedText>{t("circle.view.appt.missed", locale, { count: view.appointments.missed30d })}</MutedText>
        </Card>
      ) : null}
    </>
  );
}
