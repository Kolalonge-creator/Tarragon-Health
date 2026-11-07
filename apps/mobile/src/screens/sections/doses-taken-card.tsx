import { View } from "react-native";
import type { DoseHistory, DoseWindow } from "@tarragon/medicines";
import type { QueryResult } from "@/lib/medications";
import { doseChartSummary } from "@/lib/dose-bars";
import { space } from "@/ui/design";
import { AppText, Card, InlineAlert } from "@/ui/kit";
import { DoseBars } from "@/ui/reading-charts";

function Figure({ window, label }: { window: DoseWindow; label: string }) {
  return (
    <View style={{ flex: 1, gap: space.xxs }}>
      {window.percent !== null ? (
        <AppText variant="hero">{window.percent}%</AppText>
      ) : (
        <AppText variant="body" tone="textSubtle" style={{ paddingVertical: space.xs }}>
          Too few doses to show a percentage
        </AppText>
      )}
      <AppText variant="label" tone="textMuted">
        {label}
      </AppText>
      <AppText variant="caption" tone="textMuted">
        {window.due === 0 ? "Nothing was due" : `${window.taken} of ${window.due} marked taken`}
      </AppText>
    </View>
  );
}

/**
 * "Doses taken" on Medicines (founder, 2026-11-06, the phone twin of the web card): the last 7 and last 30 days as big percentages
 * and a 4-week chart of each day. Same formula as the printed report (completed days only, so today's open doses never count as
 * missed). A record, not a grade: no colour band or target line. Hidden while loading and when nothing was scheduled in the last
 * month; a failed read says it could not load rather than drawing an empty month.
 */
export function DosesTakenCard({ history }: { history: QueryResult<DoseHistory> | null }) {
  if (history === null) return null;
  if (!history.ok) {
    return (
      <Card style={{ gap: space.sm }}>
        <AppText variant="bodyStrong">Doses taken</AppText>
        <InlineAlert tone="warn" message="Couldn't load your dose history just now. Pull down or reopen this screen to try again." />
      </Card>
    );
  }
  const { last7, last30, days } = history.data;
  if (last30.due === 0) return null;
  const four = days.reduce((acc, d) => ({ due: acc.due + d.due, taken: acc.taken + d.taken }), { due: 0, taken: 0 });
  return (
    <Card style={{ gap: space.lg }}>
      <AppText variant="title" heading>
        Doses taken
      </AppText>
      <View style={{ flexDirection: "row", gap: space.lg }}>
        <Figure window={last7} label="Last 7 days" />
        <Figure window={last30} label="Last 30 days" />
      </View>
      <View accessible accessibilityLabel={`Each day, last 4 weeks. ${doseChartSummary(four, days.length)}`} style={{ gap: space.sm }}>
        <AppText variant="caption" tone="textMuted">
          Each day, last 4 weeks
        </AppText>
        <DoseBars days={days} />
      </View>
      <AppText variant="caption" tone="textSubtle">
        {"Counts the doses you marked as taken, up to yesterday. Today is in Today's doses."}
      </AppText>
    </Card>
  );
}
