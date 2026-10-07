import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { t } from "@tarragon/i18n";
import type { MoodTrendDay } from "@tarragon/shared";
import { loadMoodBesideReadings, wellbeingTagLabel } from "@/lib/wellbeing";
import { useLegacyColors } from "@/ui/design";
import { Card, MutedText } from "@/ui/legacy-kit";

/**
 * Mood beside blood pressure and sleep (10.1): one row per day for the last two weeks, so a hard week and a high reading can be seen on
 * the same days. A plain list, no chart (small phone, screen reader, low data). States no cause and gives no score.
 */
export function MoodBesideReadings({ patientId, reloadToken }: { patientId: string; reloadToken: number }) {
  const colors = useLegacyColors();
  const [rows, setRows] = useState<MoodTrendDay[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadMoodBesideReadings(patientId)
      .then((r) => { if (!cancelled) { setRows(r); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [patientId, reloadToken]);

  const shown = [...(rows ?? [])].reverse().slice(0, 14);
  return (
    <Card style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("mood.beside.title")}</Text>
      {failed ? (
        <MutedText>{t("mood.beside.error")}</MutedText>
      ) : rows === null ? (
        <MutedText>{t("mood.beside.loading")}</MutedText>
      ) : shown.length === 0 ? (
        <MutedText>{t("mood.beside.empty")}</MutedText>
      ) : (
        shown.map((r) => (
          <View key={r.day} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 }} accessible accessibilityLabel={`${r.day}`}>
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>{new Date(`${r.day}T12:00:00+01:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</Text>
            <Text style={{ fontSize: 12.5, color: colors.ink }}>
              {t("mood.beside.col_mood")}: {r.mood ?? "-"}   {t("mood.beside.col_stress")}: {r.stress ?? "-"}
            </Text>
            <Text style={{ fontSize: 12.5, color: colors.ink }}>
              {t("mood.beside.col_bp")}: {r.systolic !== null && r.diastolic !== null ? `${r.systolic}/${r.diastolic}` : "-"}   {t("mood.beside.col_sleep")}: {r.sleepMinutes !== null ? `${Math.floor(r.sleepMinutes / 60)}h ${r.sleepMinutes % 60}m` : "-"}
            </Text>
            {r.tags.length > 0 && <MutedText>{r.tags.map((tag) => wellbeingTagLabel(tag)).join(", ")}</MutedText>}
          </View>
        ))
      )}
      <MutedText>{t("mood.beside.caption")}</MutedText>
    </Card>
  );
}
