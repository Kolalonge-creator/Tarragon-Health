import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { chartGeometry, displayCode, groupByUnit, labRangeLabel, targetLabel, type TrendPoint, type TrendSeries } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import {
  flagLabel,
  formatResultValue,
  latestLabel,
  loadBiomarkerList,
  loadBiomarkerTrend,
  readingSourceLabel,
  readingsLabel,
  trendSummary,
  type BiomarkerListItem,
} from "@/lib/biomarkers";
import { formatPassportDate } from "@/lib/passport-format";
import { space, useTheme } from "@/ui/design";
import { AppText, Button, Card, Chip, EmptyState, InlineAlert, Screen } from "@/ui/kit";
import { LoadFailed, PassportHeader, StaleNotice } from "@/screens/sections/passport-parts";
import { ReportedValuesCard } from "@/screens/sections/reported-values-card";

interface Props {
  subjectId: string;
  /** The signed-in person. A copy is kept for offline reading only when this is the person's own record. */
  userId: string;
}

const CHART_HEIGHT = 160;

type Load<T> = { kind: "loading" } | { kind: "failed"; offline: boolean; refused: boolean } | { kind: "ready"; data: T; stale: { offline: boolean; savedAt: string } | null };

/**
 * One single-unit line. The shaded band is the laboratory's own range (drawn only when every point shares one). The care team's target is NEVER
 * drawn here (it has no unit, OQ-S43m-4): do not pass one to chartGeometry until a unit travels with it. The range is said in words under the chart, and every point is in the list under it, so the chart is never the only way to read a
 * result. The drawing is hidden from the screen reader behind a one-sentence summary.
 */
function Chart({ code, unit, points }: { code: string; unit: string | null; points: TrendPoint[] }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const g = width > 0 ? chartGeometry(points, null, width, CHART_HEIGHT) : null;
  const range = g?.band ? labRangeLabel(points[0]) : null;
  const rangeCaption = range ? t("biomarkers.chart.range", "en", { range }) : null;
  return (
    <View
      onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}
      accessible
      accessibilityRole="image"
      accessibilityLabel={[trendSummary(code, unit, points), rangeCaption].filter(Boolean).join(". ")}
      style={{ gap: space.xs }}
    >
      <View style={{ height: CHART_HEIGHT }}>
        {g ? (
          <Svg width={g.width} height={g.height}>
            {g.band ? <Rect x={0} width={g.width} y={Math.min(g.band.y1, g.band.y2)} height={Math.abs(g.band.y2 - g.band.y1)} fill={colors.brandTint} /> : null}
            <Path d={g.path} fill="none" stroke={colors.brand} strokeWidth={2} />
            {g.dots.map((d, i) => (
              <Circle key={i} cx={d.x} cy={d.y} r={3.5} fill={colors.brand} />
            ))}
          </Svg>
        ) : null}
      </View>
      {rangeCaption ? (
        <AppText variant="caption" tone="textMuted">
          {rangeCaption}
        </AppText>
      ) : null}
    </View>
  );
}

function ReadingRow({ p }: { p: TrendPoint }) {
  const flag = flagLabel(p.flag);
  const range = labRangeLabel(p);
  const from = readingSourceLabel(p);
  return (
    <View style={{ gap: 2, paddingVertical: space.sm }} accessible>
      <AppText variant="bodyStrong">
        {formatPassportDate(p.takenAt)}: {formatResultValue(p.value)}
        {p.unit ? ` ${p.unit}` : ""}
        {flag ? `, ${flag}` : ""}
      </AppText>
      <AppText variant="caption" tone="textMuted">
        {[range ? `${t("biomarkers.col.range")}: ${range}` : null, `${t("biomarkers.col.from")}: ${from}`].filter(Boolean).join(" · ")}
      </AppText>
    </View>
  );
}

const ROWS_AT_A_TIME = 40;

/** One unit's chart and readings. Newest first, forty at a time: a test measured often over years can have hundreds, and a low-end phone should not draw them all at once. */
function UnitCard({ code, unit, points }: { code: string; unit: string | null; points: TrendPoint[] }) {
  const [shown, setShown] = useState(ROWS_AT_A_TIME);
  const newestFirst = [...points].reverse();
  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title" heading>
        {displayCode(code)}
        {unit ? ` (${unit})` : ""}
      </AppText>
      <Chart code={code} unit={unit} points={points} />
      <View>
        {newestFirst.slice(0, shown).map((p, i) => (
          <ReadingRow key={`${p.takenAt}-${i}`} p={p} />
        ))}
      </View>
      {newestFirst.length > shown ? <Button title={t("mpass.bio.show_earlier")} variant="secondary" onPress={() => setShown((n) => n + ROWS_AT_A_TIME)} /> : null}
    </Card>
  );
}

function SeriesView({ series, totalReadings }: { series: TrendSeries; totalReadings: number | null }) {
  const groups = groupByUnit(series.points);
  return (
    <>
      {totalReadings !== null && totalReadings > series.points.length ? (
        <InlineAlert tone="info" message={t("mpass.bio.trimmed", "en", { shown: String(series.points.length), total: String(totalReadings) })} />
      ) : null}
      {series.unitMixed ? <InlineAlert tone="warn" message={t("biomarkers.unit_mixed")} /> : null}
      {series.target ? (
        <View style={{ gap: space.xs }} accessible>
          <AppText variant="bodyStrong" tone="brandText">
            {t("biomarkers.care_target", "en", { range: targetLabel(series.target) })}
          </AppText>
          <AppText variant="caption" tone="textMuted">
            {t("mpass.bio.target_unit_note")}
          </AppText>
        </View>
      ) : null}
      {groups.map((g) => (
        <UnitCard key={g.unit ?? "none"} code={series.code} unit={g.unit} points={g.points} />
      ))}
      <AppText variant="caption" tone="textMuted">
        {t("biomarkers.note")}
      </AppText>
    </>
  );
}

export function BiomarkersScreen({ subjectId, userId }: Props) {
  const { colors } = useTheme();
  const own = subjectId === userId;
  const [list, setList] = useState<Load<BiomarkerListItem[]>>({ kind: "loading" });
  const [code, setCode] = useState<string | null>(null);
  const [trend, setTrend] = useState<Load<TrendSeries>>({ kind: "loading" });

  // A slower answer for an earlier person or an earlier visit must never replace the current one (it would show one person's tests under another's name).
  const listRequest = useRef(0);
  const loadList = useCallback(async () => {
    const mine = ++listRequest.current;
    setList({ kind: "loading" });
    setCode(null);
    const r = await loadBiomarkerList(subjectId, own);
    if (mine !== listRequest.current) return;
    if (!r.ok) {
      setList({ kind: "failed", offline: r.offline, refused: r.refused });
      return;
    }
    setList({ kind: "ready", data: r.data, stale: r.stale ? { offline: r.offline, savedAt: r.savedAt } : null });
    setCode(r.data[0]?.code ?? null);
  }, [subjectId, own]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Choosing another test while one is loading must not let the slower answer replace the newer one.
  const latestRequest = useRef(0);
  const loadTrend = useCallback(
    async (c: string) => {
      const mine = ++latestRequest.current;
      setTrend({ kind: "loading" });
      const r = await loadBiomarkerTrend(subjectId, c, own);
      if (mine !== latestRequest.current) return;
      if (!r.ok) setTrend({ kind: "failed", offline: r.offline, refused: r.refused });
      else {
        setTrend({ kind: "ready", data: r.data, stale: r.stale ? { offline: r.offline, savedAt: r.savedAt } : null });
        // A change of test is otherwise only visible on screen.
        AccessibilityInfo.announceForAccessibility(t("mpass.bio.showing", "en", { name: displayCode(c) }));
      }
    },
    [subjectId, own]
  );

  useEffect(() => {
    if (code) void loadTrend(code);
  }, [code, loadTrend]);

  return (
    <Screen edges={[]}>
      <PassportHeader title={t("biomarkers.title")} description={t("biomarkers.description")} />

      {/* Numbers read from a report the person uploaded themselves, to check and confirm. Their own record only: nobody confirms numbers on
          someone else's behalf. Shown above the list so it is also there when there is no result yet. */}
      {own ? <ReportedValuesCard onConfirmed={() => void loadList()} /> : null}

      {list.kind === "loading" ? <ActivityIndicator color={colors.brand} accessibilityLabel={t("mpass.loading")} /> : null}
      {list.kind === "failed" ? <LoadFailed offline={list.offline} refused={list.refused} onRetry={() => void loadList()} /> : null}

      {list.kind === "ready" ? (
        <>
          {list.stale ? <StaleNotice offline={list.stale.offline} savedAt={list.stale.savedAt} /> : null}
          {list.data.length === 0 ? (
            <EmptyState icon="vitals" title={t("biomarkers.none")} />
          ) : (
            <>
              <AppText variant="label" tone="textMuted">
                {t("biomarkers.pick")}
              </AppText>
              <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {list.data.map((item) => {
                  const latest = latestLabel(item);
                  return (
                    <Chip
                      key={item.code}
                      label={displayCode(item.code)}
                      selected={item.code === code}
                      onPress={() => setCode(item.code)}
                      accessibilityLabel={[displayCode(item.code), readingsLabel(item.readings), latest ? t("biomarkers.latest", "en", { value: latest }) : null].filter(Boolean).join(", ")}
                    />
                  );
                })}
              </View>

              {trend.kind === "loading" ? <ActivityIndicator color={colors.brand} accessibilityLabel={t("mpass.loading")} /> : null}
              {trend.kind === "failed" && code ? <LoadFailed offline={trend.offline} refused={trend.refused} onRetry={() => void loadTrend(code)} /> : null}
              {trend.kind === "ready" ? (
                <>
                  {trend.stale ? <StaleNotice offline={trend.stale.offline} savedAt={trend.stale.savedAt} /> : null}
                  {trend.data.points.length > 0 ? <SeriesView series={trend.data} totalReadings={list.data.find((i) => i.code === code)?.readings ?? null} /> : <EmptyState icon="vitals" title={t("biomarkers.none")} />}
                </>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}
