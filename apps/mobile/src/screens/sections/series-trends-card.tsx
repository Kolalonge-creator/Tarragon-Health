import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useGlucoseDisplayUnit } from "@/lib/glucose-unit";
import { loadSeries, type SeriesKind, type SeriesLoad } from "@/lib/series-bands";
import { buildSeriesModel } from "@/lib/series-band-model";
import { useUiLanguage } from "@/lib/ui-language";
import { radii, space, useTheme } from "@/ui/design";
import { AppText, Card, SegmentedControl, Skeleton, SkeletonGroup } from "@/ui/kit";

const HEIGHT = 140;
const WINDOW_DAYS = 30;

/**
 * Blood sugar and weight over the last 30 days, with the shaded target range when one applies (S47b, v5 4.6). Drawn with plain views (no new native
 * module). The band is also written out in a sentence, so colour is never the only signal, and the sentence says a reading outside it is not a
 * diagnosis. Shows nothing when the person has no readings of either kind.
 */
export function SeriesTrendsCard({ subjectId }: { subjectId: string }) {
  const language = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, language, params);
  const { colors } = useTheme();
  const unit = useGlucoseDisplayUnit();
  const [kind, setKind] = useState<SeriesKind>("glucose");
  const [width, setWidth] = useState(0);
  const [loads, setLoads] = useState<Partial<Record<SeriesKind, SeriesLoad | null>>>({});
  const [loading, setLoading] = useState(true);
  const nowMs = useMemo(() => Date.now(), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([loadSeries(subjectId, "glucose", unit, WINDOW_DAYS), loadSeries(subjectId, "weight", unit, WINDOW_DAYS)])
      .then(([glucose, weight]) => alive && setLoads({ glucose, weight }))
      .catch(() => alive && setLoads({}))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [subjectId, unit]);

  const hasAny = (loads.glucose?.readings.length ?? 0) > 0 || (loads.weight?.readings.length ?? 0) > 0;
  const load = loads[kind] ?? null;
  const model = load ? buildSeriesModel(load.readings, WINDOW_DAYS, nowMs, load.band) : null;
  const unitLabel = kind === "weight" ? "kg" : unit === "mg_dl" ? "mg/dL" : "mmol/L";
  const what = kind === "glucose" ? tr("trend.series.glucose") : tr("trend.series.weight");

  if (loading) {
    return (
      <SkeletonGroup label={tr("trend.series.glucose")}>
        <Skeleton height={HEIGHT} radius={radii.md} />
      </SkeletonGroup>
    );
  }
  if (!hasAny) return null;

  const summary = model ? tr("trend.series.summary", { what, days: WINDOW_DAYS, count: model.count, min: model.min, max: model.max, unit: unitLabel, latest: model.latest }) : tr("trend.series.empty", { days: WINDOW_DAYS });
  const caption = load?.band
    ? tr(load.band.origin === "care_team" ? "trend.series.band_care_team" : "trend.series.band_standard", { low: load.band.low, high: load.band.high, unit: unitLabel })
    : null;

  return (
    <Card style={{ gap: space.md }}>
      <SegmentedControl
        accessibilityLabel={what}
        value={kind}
        onChange={setKind}
        options={[
          { value: "glucose", label: tr("trend.series.glucose") },
          { value: "weight", label: tr("trend.series.weight") },
        ]}
      />
      <AppText variant="body">{summary}</AppText>
      {model ? (
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={summary}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          style={{ height: HEIGHT, borderRadius: radii.md, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}
        >
          {model.band ? (
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: model.band.bottom * HEIGHT,
                height: Math.max(2, (model.band.top - model.band.bottom) * HEIGHT),
                backgroundColor: colors.brandText,
                opacity: 0.18,
              }}
            />
          ) : null}
          {width > 0
            ? model.points.map((p) => (
                <View
                  key={p.atMs}
                  style={{
                    position: "absolute",
                    left: Math.min(width - 10, Math.max(0, p.x * width - 5)),
                    bottom: Math.min(HEIGHT - 10, Math.max(0, p.y * HEIGHT - 5)),
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: colors.text,
                  }}
                />
              ))
            : null}
        </View>
      ) : null}
      {model && caption ? (
        <AppText variant="caption" tone="textMuted">
          {caption}
        </AppText>
      ) : null}
    </Card>
  );
}
