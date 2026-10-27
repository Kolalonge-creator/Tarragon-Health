import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { moodInsights, moodInsightsConfig, renderInsight, type MoodInsightsResult } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { loadMoodDays } from "@/lib/wellbeing";
import { supabase } from "@/lib/supabase";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, SecondaryButton } from "@/ui/legacy-kit";

const tr = (key: string, params?: Record<string, string | number>) => t(key as MessageKey, "en", params);

/**
 * Patterns in the person's own check-ins (S56b, function 3), worked out ON THIS PHONE from their own entries. The counts are never sent
 * anywhere, stored, scored, pushed or shown to anyone else; the only thing saved (on the server) is the person's choice to hide the card.
 * The sentences come from four fixed templates that describe what happened on the same days and never say why. Behind the CMO-switched guard
 * mood_insights_enabled: the screen does not render this card until it is open.
 */
export function MoodPatternsCard({ patientId, enabled, initiallyHidden, reloadToken }: { patientId: string; enabled: boolean; initiallyHidden: boolean; reloadToken: number }) {
  const colors = useLegacyColors();
  const [hidden, setHidden] = useState(initiallyHidden);
  const [result, setResult] = useState<MoodInsightsResult | null | "failed">(null);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => { setHidden(initiallyHidden); }, [initiallyHidden]);

  useEffect(() => {
    if (!enabled || hidden) return;
    let cancelled = false;
    const cfg = moodInsightsConfig();
    loadMoodDays(patientId, cfg.window_days)
      .then((days) => { if (!cancelled) setResult(moodInsights(days, { config: cfg })); })
      .catch(() => { if (!cancelled) setResult("failed"); });
    return () => { cancelled = true; };
  }, [enabled, hidden, patientId, reloadToken]);

  if (!enabled) return null;

  async function setHiddenPreference(next: boolean) {
    setSaveFailed(false);
    const { error } = await supabase.rpc("set_mood_insights_hidden", { p_hidden: next });
    if (error) setSaveFailed(true);
    else { setHidden(next); setResult(null); }
  }

  if (hidden) {
    return (
      <Card style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{tr("insights.title")}</Text>
        <MutedText>{tr("insights.hidden")}</MutedText>
        <SecondaryButton title={tr("insights.show_again")} onPress={() => void setHiddenPreference(false)} />
        {saveFailed && <ErrorText>{tr("insights.error")}</ErrorText>}
      </Card>
    );
  }

  return (
    <Card style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{tr("insights.title")}</Text>
      <MutedText>{tr("insights.intro")}</MutedText>
      {result === null ? (
        <MutedText>{tr("insights.loading")}</MutedText>
      ) : result === "failed" ? (
        <MutedText>{tr("insights.error")}</MutedText>
      ) : result.status === "not_enough_data" ? (
        <Text style={{ fontSize: 13.5, color: colors.ink }}>{tr("insights.need_more", { days: result.neededDays, window: result.windowDays, have: result.daysWithMood })}</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {result.insights.length === 0 ? (
            <Text style={{ fontSize: 13.5, color: colors.ink }}>{tr("insights.none")}</Text>
          ) : (
            result.insights.map((i) => <Text key={`${i.kind}-${i.tag ?? i.weekday ?? ""}`} style={{ fontSize: 13.5, color: colors.ink }}>{`• ${renderInsight(i, tr)}`}</Text>)
          )}
          <MutedText>{tr("insights.basis", { days: result.daysWithMood, window: result.windowDays, median: result.medianMood ?? "-" })}</MutedText>
        </View>
      )}
      <MutedText>{tr("insights.not_advice")}</MutedText>
      <MutedText>{tr("insights.private")}</MutedText>
      <SecondaryButton title={tr("insights.hide")} onPress={() => void setHiddenPreference(true)} />
      {saveFailed && <ErrorText>{tr("insights.error")}</ErrorText>}
    </Card>
  );
}
