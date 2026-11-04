import { View } from "react-native";
import { asLocale, circleMonthlyLines, t } from "@tarragon/i18n";
import { testCodeLabel } from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { resultValueText, type SupporterBlockFields } from "@/lib/care-circle/supporter-home";
import type { SupporterView } from "@/lib/care-circle/parse";
import { Card, MutedText } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";
import { FamilyDoctorNoteCard } from "./family-doctor-note-card";

function lagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}
function lagosDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * The health blocks a supporter sees, and nothing else. Used by the supporter's own page and by the patient's "see what they see"
 * preview, so the preview cannot show anything the real page does not. A block that is absent is simply not shared. `name` is the
 * person's first name, used only in the "ask them" line under shared results. Mirrors the web SupporterBlocks block for block.
 */
export function SupporterBlocks({ view, name }: { view: Pick<SupporterView, SupporterBlockFields>; name?: string }) {
  const locale = asLocale(useUiLanguage());
  const dir = view.bpTrend?.direction ?? null;
  const monthly = (view.monthly ?? []).filter((r) => circleMonthlyLines(r, locale).length > 0);
  return (
    <>
      {/* the doctor's line for the family first. Absent = not shared; null = none written yet. */}
      {view.doctorNote !== undefined ? <FamilyDoctorNoteCard note={view.doctorNote} /> : null}

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

      {/* Care Circle P2: where each everyday test has got to. Names and stages only, never a value. */}
      {view.investigations ? (
        <Card style={{ gap: 4 }}>
          <AppText variant="bodyStrong">{t("circlep2.tests.title", locale)}</AppText>
          {view.investigations.length === 0 ? <MutedText>{t("circlep2.tests.none", locale)}</MutedText> : null}
          {/* one row per schedule, so the same test can appear twice (one done, the next one due): keyed by position, not code */}
          {view.investigations.map((row, i) => (
            <View key={`${row.code}-${i}`} style={{ gap: 2, paddingVertical: 4 }}>
              <AppText variant="bodyStrong">{testCodeLabel(row.code)}</AppText>
              <AppText variant="body">{t(`circlep2.stage.${row.stage}`, locale)}</AppText>
              {row.dueDate && (row.stage === "due" || row.stage === "overdue") ? <MutedText>{t("circlep2.tests.due_on", locale, { date: lagosDate(row.dueDate) })}</MutedText> : null}
              {row.followUp ? <AppText variant="bodyStrong">{t("circlep2.tests.follow_up", locale)}</AppText> : null}
            </View>
          ))}
        </Card>
      ) : null}

      {/* D2: values only of results a doctor reviewed and released; in plain words against the lab's own range, never a verdict. */}
      {view.results ? (
        <Card style={{ gap: 4 }}>
          <AppText variant="bodyStrong">{t("circlep2.results.title", locale)}</AppText>
          {view.results.length === 0 ? <MutedText>{t("circlep2.results.none", locale)}</MutedText> : null}
          {view.results.map((r, i) => (
            <View key={`${r.code}-${r.at}-${i}`} style={{ gap: 2, paddingVertical: 4 }}>
              <AppText variant="body">{`${testCodeLabel(r.code)}: ${resultValueText(r)}`}</AppText>
              {r.inRange !== null ? <AppText variant="body">{t(r.inRange ? "circlep2.results.in_range" : "circlep2.results.out_range", locale)}</AppText> : null}
              <MutedText>{t("circlep2.results.on", locale, { date: lagosDate(r.at) })}</MutedText>
            </View>
          ))}
          {view.results.length > 0 ? <AppText variant="bodyStrong">{t("circlep2.results.ask", locale, { name: name ?? "" })}</AppText> : null}
        </Card>
      ) : null}

      {view.weightTrend ? (
        <Card style={{ gap: 4 }}>
          <AppText variant="bodyStrong">{t("circlep2.weight.title", locale)}</AppText>
          {view.weightTrend.weeks.every((w) => w.kg === null) ? <MutedText>{t("circlep2.weight.none", locale)}</MutedText> : null}
          {view.weightTrend.weeks.flatMap((w) =>
            w.kg === null ? [] : [<AppText variant="body" key={w.weekStart}>{t("circlep2.weight.row", locale, { date: lagosDate(w.weekStart), kg: String(w.kg) })}</AppText>],
          )}
          {view.weightTrend.direction ? <AppText variant="bodyStrong">{t(`circlep2.weight.${view.weightTrend.direction}`, locale)}</AppText> : null}
        </Card>
      ) : null}

      {view.planProgress ? (
        <Card style={{ gap: 4 }}>
          <AppText variant="bodyStrong">{t("circlep2.plan.title", locale)}</AppText>
          {view.planProgress.done + view.planProgress.due + view.planProgress.overdue === 0 ? (
            <MutedText>{t("circlep2.plan.none", locale)}</MutedText>
          ) : (
            <AppText variant="body">{t("circlep2.plan.line", locale, { done: view.planProgress.done, due: view.planProgress.due, overdue: view.planProgress.overdue })}</AppText>
          )}
          {view.planProgress.nextDue ? <MutedText>{t("circlep2.plan.next", locale, { date: lagosDate(view.planProgress.nextDue) })}</MutedText> : null}
        </Card>
      ) : null}
    </>
  );
}
