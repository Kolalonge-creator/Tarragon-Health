import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";
import Svg, { Line, Path, Polyline, Text as SvgText } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { t } from "@tarragon/i18n";
import {
  ageInMonths,
  bandForPoint,
  CRISIS_CARD_OFFLINE,
  crisisCallHref,
  latestBand,
  layoutGrowthChart,
  markerPath,
  mayLog,
  normaliseCrisisCard,
  type ChartPointInput,
  type GrowthBand,
  type GrowthBandResult,
} from "@tarragon/shared";
import { logChildGrowth, type ChildDetail, type GrowthRow, type TapOutcome } from "@/lib/child-log";
import { radius } from "@/ui/theme";
import { placeholderColorFor, useLegacyColors, useTextInputStyle, useTheme } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton } from "@/ui/legacy-kit";

const BAND_KEY: Record<GrowthBand, Parameters<typeof t>[0]> = {
  growing_well: "cdl.growth.band_growing_well",
  keep_an_eye_on: "cdl.growth.band_keep_an_eye_on",
  talk_to_care_team: "cdl.growth.band_talk_to_care_team",
};
const HELP_KEY: Record<GrowthBand, Parameters<typeof t>[0]> = {
  growing_well: "cdl.growth.help_growing_well",
  keep_an_eye_on: "cdl.growth.help_keep_an_eye_on",
  talk_to_care_team: "cdl.growth.help_talk_to_care_team",
};
const OUTCOME_KEY: Record<TapOutcome, Parameters<typeof t>[0]> = {
  sent: "cdl.log.saved",
  on_phone: "cdl.growth.saved_on_phone",
  not_open: "cdl.log.not_open",
  failed: "cdl.log.failed",
  view_only: "cdl.log.view_only",
};
const CRISIS_CACHE_KEY = "tarragon.crisisCard.v1";

/** The headline result for a series: the latest row, with the acute-nutrition class carried forward from the latest row that had a reading. */
export function latestResultOf(rows: readonly GrowthRow[]): GrowthBandResult | null {
  return latestBand(rows.map((r) => ({ ...rowInput(r), measuredAt: r.measuredAt, muacMm: r.muacMm, bilateralOedema: r.bilateralOedema })));
}

function rowInput(r: GrowthRow) {
  return { weightForAgeZ: r.weightForAgeZ, heightForAgeZ: r.heightForAgeZ, weightForHeightZ: r.weightForHeightZ, nutritionClass: r.nutritionClass, implausible: r.implausible };
}

export function resultOf(r: GrowthRow): GrowthBandResult {
  return bandForPoint({
    weightForAgeZ: r.weightForAgeZ,
    heightForAgeZ: r.heightForAgeZ,
    weightForHeightZ: r.weightForHeightZ,
    nutritionClass: r.nutritionClass,
    implausible: r.implausible,
  });
}

/** Leads with "go to the nearest clinic now" and a call button, above everything else, whenever the latest result is a crisis. */
export function CrisisLead() {
  const colors = useLegacyColors();
  const [number, setNumber] = useState<string>(CRISIS_CARD_OFFLINE.emergencyNumber);
  useEffect(() => {
    void AsyncStorage.getItem(CRISIS_CACHE_KEY)
      .then((raw) => (raw ? setNumber(normaliseCrisisCard(JSON.parse(raw)).emergencyNumber) : undefined))
      .catch(() => undefined);
  }, []);
  const href = crisisCallHref(number);
  return (
    <Card style={{ gap: 10, borderWidth: 2, borderColor: colors.status.critical }}>
      <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: "800", color: colors.ink }}>{t("cdl.crisis.lead")}</Text>
      {href && (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("crisis.call", "en", { number })}
          onPress={() => void Linking.openURL(href)}
          style={{ backgroundColor: colors.status.critical, borderRadius: radius.control, paddingVertical: 16, alignItems: "center" }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "800" }}>{t("crisis.call", "en", { number })}</Text>
        </Pressable>
      )}
      <MutedText>{t("crisis.call_note")}</MutedText>
      <Text style={{ fontSize: 14, color: colors.ink }}>{t("cdl.crisis.then")}</Text>
    </Card>
  );
}

function GrowthChart({ points, label, axis }: { points: readonly ChartPointInput[]; label: string; axis: string }) {
  const colors = useLegacyColors();
  const layout = useMemo(() => layoutGrowthChart(points, { width: 320, height: 200 }), [points]);
  if (layout.markers.length === 0) return null;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Text style={{ fontSize: 12.5, color: colors.muted }}>{axis}</Text>
      <Svg width="100%" height={200} viewBox="0 0 320 200">
        {layout.yTicks.map((tick) => (
          <SvgText key={`y${tick.at}`} x={2} y={tick.at + 4} fontSize={10} fill={colors.muted}>{tick.label}</SvgText>
        ))}
        {layout.xTicks.map((tick) => (
          <SvgText key={`x${tick.at}`} x={tick.at - 6} y={196} fontSize={10} fill={colors.muted}>{tick.label}</SvgText>
        ))}
        <Line x1={32} y1={168} x2={288} y2={168} stroke={colors.border} strokeWidth={1} />
        {layout.polyline !== "" && <Polyline points={layout.polyline} fill="none" stroke={colors.muted} strokeWidth={1.5} />}
        {layout.markers.map((m) => (
          <Path key={m.id} d={markerPath(m.shape, m.x, m.y, 6)} fill={m.band === "talk_to_care_team" ? colors.status.critical : m.band === "keep_an_eye_on" ? colors.status.warn : colors.brand} stroke={colors.ink} strokeWidth={1.5} />
        ))}
      </Svg>
    </View>
  );
}

/** Growth for one child: crisis lead first, then the plain-language band for the latest measurement, the chart (kg and cm), a table, and a form. */
export function ChildGrowth({ child, rows, failed, onChanged }: { child: ChildDetail; rows: GrowthRow[] | null; failed: boolean; onChanged: () => void }) {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const inputStyle = useTextInputStyle();
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [status, setStatus] = useState<TapOutcome | null>(null);

  const latestResult = rows ? latestResultOf(rows) : null;
  const dob = child.dateOfBirth;
  const toPoints = (pick: (r: GrowthRow) => number | null): ChartPointInput[] =>
    (rows ?? []).flatMap((r) => {
      const v = pick(r);
      if (v === null || !dob) return [];
      const res = resultOf(r);
      return [{ id: r.id, ageMonths: ageInMonths(dob, r.measuredAt), value: v, band: res.kind === "band" ? res.band : null }];
    });

  async function save() {
    const w = weight.trim() === "" ? null : Number(weight);
    const h = height.trim() === "" ? null : Number(height);
    if ((w !== null && !Number.isFinite(w)) || (h !== null && !Number.isFinite(h))) { setStatus("failed"); return; }
    const outcome = await logChildGrowth(child, { weightKg: w, heightCm: h }, "");
    setStatus(outcome);
    if (outcome === "sent" || outcome === "on_phone") { setWeight(""); setHeight(""); onChanged(); }
  }

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ gap: 10 }}>
        <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{t("cdl.growth.title")}</Text>
        <MutedText>{t("cdl.growth.intro")}</MutedText>
        {failed && <ErrorText>{t("cdl.log.failed")}</ErrorText>}
        {rows && rows.length === 0 && <MutedText>{t("cdl.growth.empty")}</MutedText>}
        {latestResult?.kind === "band" && (
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 18, fontWeight: "800", color: colors.ink }}>{t(BAND_KEY[latestResult.band])}</Text>
            <Text style={{ fontSize: 14, color: colors.ink }}>{t(HELP_KEY[latestResult.band])}</Text>
            {latestResult.recheck && <Text style={{ fontSize: 14, color: colors.ink }}>{t("mch.growth.check_measurement")}</Text>}
          </View>
        )}
        {latestResult?.kind === "check_measurement" && <Text style={{ fontSize: 14, color: colors.ink }}>{t("mch.growth.check_measurement")}</Text>}
        {latestResult?.kind === "no_reference" && <Text style={{ fontSize: 14, color: colors.ink }}>{t("mch.growth.reference_missing")}</Text>}
        {rows && rows.length > 0 && dob && (
          <>
            <GrowthChart points={toPoints((r) => r.weightKg)} label={t("cdl.growth.chart_weight_label")} axis={t("cdl.growth.weight_axis")} />
            <GrowthChart points={toPoints((r) => r.heightCm)} label={t("cdl.growth.chart_height_label")} axis={t("cdl.growth.height_axis")} />
            <MutedText>{t("cdl.growth.age_axis")}</MutedText>
            <View style={{ gap: 2 }}>
              <Text style={{ fontSize: 12.5, color: colors.muted }}>{t("cdl.growth.shape_circle")}</Text>
              <Text style={{ fontSize: 12.5, color: colors.muted }}>{t("cdl.growth.shape_diamond")}</Text>
              <Text style={{ fontSize: 12.5, color: colors.muted }}>{t("cdl.growth.shape_triangle")}</Text>
            </View>
          </>
        )}
        {rows && rows.length > 0 && (
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>{t("cdl.growth.table_caption")}</Text>
            {[...rows].reverse().map((r) => {
              const res = resultOf(r);
              return (
                <Text key={r.id} style={{ fontSize: 13.5, color: colors.ink }}>
                  {new Date(r.measuredAt).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "2-digit" })}
                  {r.weightKg !== null ? `  ${r.weightKg} kg` : ""}
                  {r.heightCm !== null ? `  ${r.heightCm} cm` : ""}
                  {res.kind === "band" ? `  ${t(BAND_KEY[res.band])}` : ""}
                </Text>
              );
            })}
          </View>
        )}
      </Card>
      {mayLog(child) && (
        <Card style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{t("cdl.growth.log_title")}</Text>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{t("cdl.growth.weight_label")}</Text>
          <TextInput accessibilityLabel={t("cdl.growth.weight_label")} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="0.0" placeholderTextColor={placeholderColorFor(scheme)} style={inputStyle} />
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{t("cdl.growth.height_label")}</Text>
          <TextInput accessibilityLabel={t("cdl.growth.height_label")} value={height} onChangeText={setHeight} keyboardType="decimal-pad" placeholder="0.0" placeholderTextColor={placeholderColorFor(scheme)} style={inputStyle} />
          <PrimaryButton title={t("cdl.growth.save")} onPress={() => void save()} disabled={weight.trim() === "" && height.trim() === ""} />
          <View accessibilityLiveRegion="polite">{status && <Text style={{ fontSize: 14, color: colors.ink }}>{t(OUTCOME_KEY[status])}</Text>}</View>
        </Card>
      )}
    </View>
  );
}
