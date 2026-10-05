import { useState } from "react";
import { View } from "react-native";
import type { MessageKey } from "@tarragon/i18n";
import type { TrendInsights } from "@/lib/bp-trend-insights";
import { space } from "@/ui/design";
import { AppText, Badge, Button, Card, ListItem } from "@/ui/kit";

type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Under the chart: the care team's target, an average only when there are enough
 * readings, and a per-day list. The words describe what was logged; nothing here
 * says a trend is good, bad or improving, and no reading is called "in range"
 * (the target has no lower limit, so the wording is "above" or "not above"). With
 * no target readable there are no statuses at all (see lib/bp-trend-insights.ts).
 *
 * With too few readings for a chart the list is shown straight away, because a
 * line through two dots would imply a trend that is not there.
 */
export function TrendInsightsCard({
  insights,
  tr,
  minReadingsForChart,
  targetKnowable,
}: {
  insights: TrendInsights;
  tr: Tr;
  minReadingsForChart: number;
  /** False while acting for someone else: the care team's target is not readable from here, so the card must not claim there is none. */
  targetKnowable: boolean;
}) {
  const [showList, setShowList] = useState(false);
  const listVisible = showList || insights.displayMode === "list";
  const value = (s: number, d: number) => `${s}/${d}`;
  const readings = (n: number) => (n === 1 ? tr("trends.day.readings_one") : tr("trends.day.readings_many", { count: n }));

  const shortfallText = (() => {
    const s = insights.shortfall;
    if (!s) return null;
    if (s.moreDays > 0) return s.moreDays === 1 ? tr("trends.average.more_days_one") : tr("trends.average.more_days_many", { count: s.moreDays });
    return s.moreReadings === 1 ? tr("trends.average.more_readings_one") : tr("trends.average.more_readings_many", { count: s.moreReadings });
  })();

  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title" heading>
        {tr("trends.average.title")}
      </AppText>

      {insights.average ? (
        <View style={{ gap: space.xs }}>
          <AppText variant="bodyStrong">
            {tr("trends.average.value", {
              readings: insights.average.readings,
              days: insights.average.days,
              value: value(insights.average.systolic, insights.average.diastolic),
            })}
          </AppText>
          {insights.morningAverage ? (
            <AppText variant="body" tone="textMuted">
              {tr("trends.average.morning", {
                value: value(insights.morningAverage.meanSystolic, insights.morningAverage.meanDiastolic),
                count: insights.morningAverage.count,
              })}
            </AppText>
          ) : null}
          {insights.eveningAverage ? (
            <AppText variant="body" tone="textMuted">
              {tr("trends.average.evening", {
                value: value(insights.eveningAverage.meanSystolic, insights.eveningAverage.meanDiastolic),
                count: insights.eveningAverage.count,
              })}
            </AppText>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: space.xs }}>
          <AppText variant="body">{tr("trends.average.not_enough")}</AppText>
          {shortfallText ? (
            <AppText variant="body" tone="textMuted">
              {shortfallText}
            </AppText>
          ) : null}
        </View>
      )}

      {insights.target.kind !== "none" || targetKnowable ? (
        <AppText variant="body" tone="textMuted">
          {insights.target.kind === "care_team"
            ? tr("trends.target.set", { systolic: insights.target.systolicBelow, diastolic: insights.target.diastolicBelow })
            : insights.target.kind === "standard"
              ? tr("trends.target.standard", { systolic: insights.target.systolicBelow, diastolic: insights.target.diastolicBelow })
              : tr("trends.target.none")}
        </AppText>
      ) : null}

      {insights.ignoredClose > 0 ? (
        <AppText variant="caption" tone="textSubtle">
          {insights.ignoredClose === 1 ? tr("trends.ignored_one") : tr("trends.ignored_many", { count: insights.ignoredClose })}
        </AppText>
      ) : null}

      {insights.displayMode === "list" ? (
        <View style={{ gap: space.xs }}>
          <AppText variant="bodyStrong">{tr("trends.few.title")}</AppText>
          <AppText variant="body" tone="textMuted">
            {tr("trends.few.body", { count: minReadingsForChart })}
          </AppText>
        </View>
      ) : insights.days.length > 0 ? (
        <Button
          title={showList ? tr("trends.list.hide") : tr("trends.list.show")}
          variant="secondary"
          fullWidth={false}
          onPress={() => setShowList((v) => !v)}
        />
      ) : null}

      {listVisible && insights.days.length > 0 ? (
        <View accessibilityLabel={tr("trends.list.title")}>
          <AppText variant="bodyStrong" heading>
            {tr("trends.list.title")}
          </AppText>
          {insights.days.map((d) => {
            const parts = [
              readings(d.count),
              tr("trends.day.average", { value: value(d.meanSystolic, d.meanDiastolic) }),
              d.morning ? tr("trends.day.morning", { value: value(d.morning.meanSystolic, d.morning.meanDiastolic) }) : null,
              d.evening ? tr("trends.day.evening", { value: value(d.evening.meanSystolic, d.evening.meanDiastolic) }) : null,
              d.aboveCount !== null && d.aboveCount > 0 ? tr("trends.day.above_count", { above: d.aboveCount, count: d.count }) : null,
            ].filter((x): x is string => x !== null);
            return (
              <ListItem
                key={d.localDate}
                title={`${tr(d.weekdayKey)} ${d.dayMonth}`}
                subtitle={parts.join(". ")}
                trailing={
                  d.status === null ? null : (
                    <Badge label={tr(d.status === "above" ? "trends.status.above" : "trends.status.not_above")} tone={d.status === "above" ? "warn" : "neutral"} />
                  )
                }
              />
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}
