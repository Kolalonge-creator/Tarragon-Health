import { Text } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import type { SupporterView } from "@/lib/care-circle/parse";
import { useLegacyColors } from "@/ui/design";
import { Card, MutedText } from "@/ui/legacy-kit";

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
export function SupporterBlocks({ view }: { view: Pick<SupporterView, "adherence" | "bpTrend" | "appointments"> }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const dir = view.bpTrend?.direction ?? null;
  return (
    <>
      {view.adherence ? (
        <Card style={{ gap: 4 }}>
          <Text style={{ fontWeight: "700", color: colors.ink }}>{t("circle.view.adherence.title", locale)}</Text>
          {view.adherence.due === 0 || view.adherence.percent === null ? (
            <MutedText>{t("circle.view.adherence.none", locale)}</MutedText>
          ) : (
            <Text style={{ color: colors.ink }}>{t("circle.view.adherence.line", locale, { taken: view.adherence.taken, due: view.adherence.due, percent: view.adherence.percent })}</Text>
          )}
        </Card>
      ) : null}

      {view.bpTrend ? (
        <Card style={{ gap: 4 }}>
          <Text style={{ fontWeight: "700", color: colors.ink }}>{t("circle.view.bp.title", locale)}</Text>
          {view.bpTrend.weeks.length === 0 ? <MutedText>{t("circle.view.bp.none", locale)}</MutedText> : null}
          {view.bpTrend.weeks.map((w) => (
            <Text key={w.weekStart} style={{ color: colors.ink }}>{t("circle.view.bp.row", locale, { date: lagosDate(w.weekStart), systolic: w.systolic, diastolic: w.diastolic, count: w.readings })}</Text>
          ))}
          {dir ? <Text style={{ fontWeight: "600", color: colors.ink }}>{t(`circle.view.bp.${dir}`, locale)}</Text> : null}
        </Card>
      ) : null}

      {view.appointments ? (
        <Card style={{ gap: 4 }}>
          <Text style={{ fontWeight: "700", color: colors.ink }}>{t("circle.view.appt.title", locale)}</Text>
          <Text style={{ color: colors.ink }}>{view.appointments.nextAt ? t("circle.view.appt.next", locale, { date: lagosDateTime(view.appointments.nextAt) }) : t("circle.view.appt.none", locale)}</Text>
          <MutedText>{t("circle.view.appt.missed", locale, { count: view.appointments.missed30d })}</MutedText>
        </Card>
      ) : null}
    </>
  );
}
