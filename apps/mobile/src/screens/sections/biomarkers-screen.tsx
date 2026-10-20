import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { chartGeometry, displayCode, groupByUnit, labRangeLabel, targetLabel, type TrendPoint, type TrendSeries } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import {
  flagLabel,
  latestLabel,
  loadBiomarkerList,
  loadBiomarkerTrend,
  readingsLabel,
  trendSummary,
  type BiomarkerListItem,
} from "@/lib/biomarkers";
import { formatPassportDate } from "@/lib/passport-format";
import { space, useTheme } from "@/ui/design";
import { AppText, Card, Chip, EmptyState, InlineAlert, Screen } from "@/ui/kit";
import { LoadFailed, PassportHeader, StaleNotice } from "@/screens/sections/passport-parts";

interface Props {
  subjectId: string;
  /** The signed-in person. A copy is kept for offline reading only when this is the person's own record. */
  userId: string;
}

const CHART_HEIGHT = 160;

type Load<T> = { kind: "loading" } | { kind: "failed"; offline: boolean } | { kind: "ready"; data: T; stale: { offline: boolean; savedAt: string } | null };

/**
 * One single-unit line. The shaded band is the laboratory's own range (drawn only when every point shares one); the dashed band is the care
 * team's target. Both are said in words under the chart, and every point is in the list under it, so the chart is never the only way to read a
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
  const from = p.laboratory ?? t(`biomarkers.source.${p.source === "legacy_report" ? "legacy_report" : "lab_result"}` as MessageKey);
  return (
    <View style={{ gap: 2, paddingVertical: space.sm }} accessible>
      <AppText variant="bodyStrong">
        {formatPassportDate(p.takenAt)}: {p.value}
        {p.unit ? ` ${p.unit}` : ""}
        {flag ? `, ${flag}` : ""}
      </AppText>
      <AppText variant="caption" tone="textMuted">
        {[range ? `${t("biomarkers.col.range")}: ${range}` : null, `${t("biomarkers.col.from")}: ${from}`].filter(Boolean).join(" · ")}
      </AppText>
    </View>
  );
}

function SeriesView({ series }: { series: TrendSeries }) {
  const groups = groupByUnit(series.points);
  return (
    <>
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
        <Card key={g.unit ?? "none"} style={{ gap: space.md }}>
          <AppText variant="title" heading>
            {displayCode(series.code)}
            {g.unit ? ` (${g.unit})` : ""}
          </AppText>
          <Chart code={series.code} unit={g.unit} points={g.points} />
          <View>
            {[...g.points].reverse().map((p, i) => (
              <ReadingRow key={`${p.takenAt}-${i}`} p={p} />
            ))}
          </View>
        </Card>
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
  const [trend, setTrend] = useState<Load<TrendSeries | null>>({ kind: "loading" });

  // A slower answer for an earlier person or an earlier visit must never replace the current one (it would show one person's tests under another's name).
  const listRequest = useRef(0);
  const loadList = useCallback(async () => {
    const mine = ++listRequest.current;
    setList({ kind: "loading" });
    setCode(null);
    const r = await loadBiomarkerList(subjectId, own);
    if (mine !== listRequest.current) return;
    if (!r.ok) {
      setList({ kind: "failed", offline: r.offline });
      return;
    }
    setList({ kind: "ready", data: r.data, stale: r.stale ? { offline: r.offline, savedAt: r.savedAt } : null });
    setCode((current) => (current && r.data.some((i) => i.code === current) ? current : (r.data[0]?.code ?? null)));
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
      if (!r.ok) setTrend({ kind: "failed", offline: r.offline });
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

      {list.kind === "loading" ? <ActivityIndicator color={colors.brand} accessibilityLabel={t("mpass.loading")} /> : null}
      {list.kind === "failed" ? <LoadFailed offline={list.offline} onRetry={() => void loadList()} /> : null}

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
              {trend.kind === "failed" && code ? <LoadFailed offline={trend.offline} onRetry={() => void loadTrend(code)} /> : null}
              {trend.kind === "ready" ? (
                <>
                  {trend.stale ? <StaleNotice offline={trend.stale.offline} savedAt={trend.stale.savedAt} /> : null}
                  {trend.data ? <SeriesView series={trend.data} /> : <EmptyState icon="vitals" title={t("biomarkers.none")} />}
                </>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}
