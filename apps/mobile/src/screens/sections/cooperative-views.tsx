import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { getProposedConfig, sharedGoalPath, type CooperativeRules } from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { loadHistory, loadSummary, restCheckin, skipWeek } from "@/lib/cohorts/api";
import type { ChallengeSummary, EffortHistory } from "@/lib/cohorts/parse";
import { useLegacyColors } from "@/ui/design";
import { Card, MutedText, SecondaryButton } from "@/ui/legacy-kit";

/**
 * The shared-goal path (S69c). Drawn from the cohort's published progress only (null when pending or hidden: an empty path). Each step is
 * told by SHAPE (filled circle with a tick, ringed circle, dashed circle) and by WORDS, never colour alone. No name, rank or comparison.
 */
export function SharedGoalPath({ progressPct }: { progressPct: number | null }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const rules = getProposedConfig("cohorts.cooperative").value as CooperativeRules;
  const path = sharedGoalPath(progressPct, rules.path_milestones);
  const summary = progressPct === null
    ? t("community.coop.path.waiting", locale)
    : path.complete ? t("community.coop.path.complete", locale)
      : t("community.coop.path.summary", locale, { reached: String(path.reachedCount), total: String(path.total) });
  return (
    <View accessibilityRole="summary" accessibilityLabel={`${t("community.coop.path.title", locale)}. ${summary}`} style={{ gap: 6 }}>
      <Text style={{ fontWeight: "600", color: colors.ink }}>{t("community.coop.path.title", locale)}</Text>
      {path.steps.map((s) => {
        const state = s.reached ? "reached" : s.current ? "next" : "ahead";
        const key = `community.coop.path.state.${state}` as MessageKey;
        return (
          <View key={s.index} style={{ flexDirection: "row", alignItems: "center", gap: 8 }} accessible accessibilityLabel={t("community.coop.path.step", locale, { index: String(s.index), total: String(path.total), state: t(key, locale) })}>
            <View importantForAccessibility="no-hide-descendants" style={{
              width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center",
              backgroundColor: s.reached ? colors.brand : "transparent", borderWidth: s.reached ? 0 : s.current ? 3 : 2, borderColor: colors.ink, borderStyle: s.reached || s.current ? "solid" : "dashed",
            }}>
              {s.reached ? <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>{"✓"}</Text> : null}
            </View>
            <Text style={{ color: colors.ink }}>{t("community.coop.path.step", locale, { index: String(s.index), total: String(path.total), state: t(key, locale) })}</Text>
          </View>
        );
      })}
      <Text style={{ color: colors.ink }}>{summary}</Text>
    </View>
  );
}

/** Weeks active, the rest check-in and skip this week. Private to the member; none of it reaches the group. */
export function CooperativeActions({ challengeId, active, consenting }: { challengeId: string; active: boolean; consenting: boolean }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [summary, setSummary] = useState<ChallengeSummary>({ available: false });
  const [note, setNote] = useState<MessageKey | null>(null);
  const refresh = useCallback(async () => {
    const r = await loadSummary(challengeId);
    if (r.ok) setSummary(r.data);
  }, [challengeId]);
  useEffect(() => { void refresh(); }, [refresh]);
  if (!summary.available) return null;
  async function rest() {
    const r = await restCheckin(challengeId);
    setNote(r.ok && r.result.ok ? "community.coop.rest.done" : null);
    void refresh();
  }
  async function skip(next: boolean) {
    const r = await skipWeek(challengeId, next);
    setNote(r.ok && next ? "community.coop.skip.done" : null);
    void refresh();
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.ink }}>{summary.weeksActive > 0 ? t("community.coop.weeks", locale, { weeks: String(summary.weeksActive) }) : t("community.coop.weeks_none", locale)}</Text>
      <MutedText>{t("community.coop.weeks_note", locale)}</MutedText>
      {active ? (
        <>
          {summary.restAvailable && consenting ? (
            <View style={{ gap: 4 }}>
              <SecondaryButton title={t("community.coop.rest.button", locale)} onPress={() => void rest()} />
              <MutedText>{t("community.coop.rest.note", locale)}</MutedText>
            </View>
          ) : null}
          <View style={{ gap: 4 }}>
            <SecondaryButton title={t(summary.skippedThisWeek ? "community.coop.skip.undo" : "community.coop.skip.button", locale)} onPress={() => void skip(!summary.skippedThisWeek)} />
            <MutedText>{t("community.coop.skip.note", locale)}</MutedText>
          </View>
        </>
      ) : null}
      {note ? <MutedText>{t(note, locale)}</MutedText> : null}
    </View>
  );
}

/** The member's own record view: their own effort history, kept after a challenge ends. */
export function EffortHistoryCard() {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [h, setH] = useState<EffortHistory>({ weeksActive: 0, challenges: [] });
  useEffect(() => { void loadHistory().then((r) => { if (r.ok) setH(r.data); }); }, []);
  return (
    <Card style={{ gap: 6 }}>
      <Text style={{ fontWeight: "700", color: colors.ink }}>{t("community.coop.history.title", locale)}</Text>
      <MutedText>{t("community.coop.history.note", locale)}</MutedText>
      {h.challenges.length === 0 ? <Text style={{ color: colors.ink }}>{t("community.coop.history.empty", locale)}</Text> : (
        <>
          <Text style={{ color: colors.ink }}>{t("community.coop.history.weeks", locale, { weeks: String(h.weeksActive) })}</Text>
          {h.challenges.map((c) => (
            <Text key={`${c.label}-${c.startsOn}`} style={{ color: colors.ink }}>{t("community.coop.history.row", locale, { label: c.label, days: String(c.daysWithEffort), rest: String(c.restDays) })}</Text>
          ))}
        </>
      )}
    </Card>
  );
}
