import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { chartGeometry, displayCode, groupByUnit, labRangeLabel, targetLabel, type TrendPoint, type TrendSeries, type TrendTarget } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import {
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
function Chart({ code, unit, points, target }: { code: string; unit: string | null; points: TrendPoint[]; target: TrendTarget | null }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const g = width > 0 ? chartGeometry(points, target, width, CHART_HEIGHT) : null;
  const range = g?.band ? labRangeLabel(points[0]) : null;
  return (
    <View
      onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}
      accessible
      accessibilityRole="image"
      accessibilityLabel={trendSummary(code, unit, points)}
      style={{ gap: space.xs }}
    >
      <View style={{ height: CHART_HEIGHT }}>
        {g ? (
          <Svg width={g.width} height={g.height}>
            {g.band ? <Rect x={0} width={g.width} y={Math.min(g.band.y1, g.band.y2)} height={Math.abs(g.band.y2 - g.band.y1)} fill={colors.brandTint} /> : null}
            {g.targetBand ? (
              <Rect
                x={1}
                width={g.width - 2}
                y={Math.min(g.targetBand.y1, g.targetBand.y2)}
                height={Math.abs(g.targetBand.y2 - g.targetBand.y1)}
                fill="none"
                stroke={colors.text}
                strokeWidth={1}
                strokeDasharray="4 3"
              />
            ) : null}
            <Path d={g.path} fill="none" stroke={colors.brand} strokeWidth={2} />
            {g.dots.map((d, i) => (
              <Circle key={i} cx={d.x} cy={d.y} r={3.5} fill={colors.brand} />
            ))}
          </Svg>
        ) : null}
      </View>
      {range ? (
        <AppText variant="caption" tone="textMuted">
          {t("biomarkers.chart.range", "en", { range })}
        </AppText>
      ) : null}
      {target && g?.targetBand ? (
        <AppText variant="caption" tone="textMuted">
          {t("biomarkers.chart.target", "en", { range: targetLabel(target) })}
        </AppText>
      ) : null}
    </View>
  );
}

function ReadingRow({ p }: { p: TrendPoint }) {
  const flag = p.flag && p.flag !== "normal" ? t(`biomarkers.flag.${p.flag}` as MessageKey) : null;
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
        <AppText variant="bodyStrong" tone="brandText">
          {t("biomarkers.care_target", "en", { range: targetLabel(series.target) })}
        </AppText>
      ) : null}
      {groups.map((g) => (
        <Card key={g.unit ?? "none"} style={{ gap: space.md }}>
          <AppText variant="title" heading>
            {displayCode(series.code)}
            {g.unit ? ` (${g.unit})` : ""}
          </AppText>
          <Chart code={series.code} unit={g.unit} points={g.points} target={groups.length === 1 ? series.target : null} />
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

  const loadList = useCallback(async () => {
    setList({ kind: "loading" });
    const r = await loadBiomarkerList(subjectId, own);
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
      else setTrend({ kind: "ready", data: r.data, stale: r.stale ? { offline: r.offline, savedAt: r.savedAt } : null });
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
