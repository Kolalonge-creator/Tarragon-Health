import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, TextInput, View } from "react-native";
import { t } from "@tarragon/i18n";
import { fastingMessageKey, mayStartFast, type Fast } from "@tarragon/clinical/fasting-safety";
import { UNAVAILABLE_DETAILS, type FastingDetails } from "@tarragon/clinical/fasting-details";
import { endFastingPlan, loadFastingDetails, startFastingPlan } from "@/lib/fasting";
import type { SectionId } from "@/lib/sections";
import { radius, spacing } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

const FASTS: readonly Fast[] = ["ramadan", "lent"];

/**
 * Fasting and your health (S50b, 6.13), native. A safety answer for Ramadan and Lent, not a fasting feature: no timer, no schedule, and no sentence that
 * tells anyone to fast or to stop. The answer is the database's; any doubt shows "talk to your care team". The only timing shown is the plan a clinician
 * wrote and signed, in their words, with their name. A dangerous reading still raises the app's normal emergency guidance; this screen adds none of its own.
 * Someone acting for another person sees only the safe line.
 */
export function FastingScreen({ acting, onNavigate }: { acting: boolean; onNavigate: (section: SectionId) => void }) {
  const colors = useLegacyColors();
  const [fast, setFast] = useState<Fast>("ramadan");
  const [details, setDetails] = useState<FastingDetails | null>(null);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [endFailed, setEndFailed] = useState(false);
  // Only the newest request may set the screen: a slow reply for Ramadan must never overwrite what Lent shows.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setDetails(null);
    let next: FastingDetails;
    try {
      next = acting ? UNAVAILABLE_DETAILS : await loadFastingDetails(fast);
    } catch {
      next = UNAVAILABLE_DETAILS; // never a spinner that does not end, and never a permissive guess
    }
    if (mine === seq.current) setDetails(next);
  }, [fast, acting]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setFailed(false);
    const r = await startFastingPlan(fast, starts.trim(), ends.trim());
    setBusy(false);
    if (!r.ok) {
      setFailed(true);
      return;
    }
    setSaved(true);
    await load();
  }

  async function stop(reason: "finished" | "stopped_by_person") {
    setBusy(true);
    setEndFailed(false);
    const r = await endFastingPlan(reason);
    setBusy(false);
    if (!r.ok) {
      setEndFailed(true);
      return;
    }
    setSaved(false);
    await load();
  }

  const answer = details?.answer ?? { state: "unavailable" as const };
  const ok = answer.state === "ok";
  const label = t(!ok ? "fasting.label.unavailable" : answer.decision === "may_fast_with_guidance" ? "fasting.label.may" : answer.decision === "needs_clinician_plan" ? "fasting.label.needs_plan" : "fasting.label.paused");

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <View style={{ gap: 6 }}>
        <ScreenTitle>{t("fasting.title")}</ScreenTitle>
        <MutedText>{t("fasting.intro")}</MutedText>
      </View>

      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 8 }}>
        {FASTS.map((f) => (f === fast ? <PrimaryButton key={f} title={t(`fasting.fast.${f}`)} onPress={() => setFast(f)} /> : <SecondaryButton key={f} title={t(`fasting.fast.${f}`)} onPress={() => setFast(f)} />))}
      </View>

      {details === null ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <>
          <Card style={{ gap: 8 }} >
            <Badge tone={ok && answer.decision === "may_fast_with_guidance" ? "brand" : "neutral"}>{label}</Badge>
            <AppText variant="body" accessibilityLiveRegion="polite">{t(fastingMessageKey(answer))}</AppText>
          </Card>

          {ok ? (
            <MutedText>
              {details.calendar.status === "expected" ? t("fasting.calendar.expected", "en", { start: details.calendar.start, end: details.calendar.end }) : t("fasting.calendar.unknown")}
            </MutedText>
          ) : null}

          {details.timingPlans.length > 0 ? (
            <Card style={{ gap: 8 }}>
              <AppText variant="bodyStrong">{t("fasting.timing_plan.title")}</AppText>
              {details.timingPlans.map((p) => (
                <View key={`${p.signedAt}-${p.validTo}`} style={{ gap: 4 }}>
                  <AppText variant="body">{p.summary}</AppText>
                  <MutedText>
                    {t("fasting.timing_plan.signed_by", "en", { name: p.signedByName ?? "your care team", date: p.signedAt.slice(0, 10), from: p.validFrom, to: p.validTo })}
                  </MutedText>
                </View>
              ))}
              <MutedText>{t("fasting.timing_plan.note")}</MutedText>
            </Card>
          ) : null}

          {details.plan ? (
            <Card style={{ gap: 10 }}>
              <AppText variant="body">
                {t("fasting.plan.active", "en", { fast: t(`fasting.fast.${details.plan.fast}`), start: details.plan.startsOn, end: details.plan.endsOn })}
              </AppText>
              {details.planPaused ? <ErrorText>{t("fasting.plan.paused")}</ErrorText> : null}
              {endFailed ? <ErrorText>{t("fasting.plan.end_failed")}</ErrorText> : null}
              <SecondaryButton title={t("fasting.plan.finished")} disabled={busy} onPress={() => void stop("finished")} />
              <SecondaryButton title={t("fasting.plan.stopped")} disabled={busy} onPress={() => void stop("stopped_by_person")} />
            </Card>
          ) : mayStartFast(answer) ? (
            <Card style={{ gap: 10 }}>
              <AppText variant="bodyStrong">{t("fasting.start.title")}</AppText>
              <MutedText>{t("fasting.start.starts")} (YYYY-MM-DD)</MutedText>
              <TextInput value={starts} onChangeText={setStarts} placeholder="2027-02-08" autoCapitalize="none" keyboardType="numbers-and-punctuation" accessibilityLabel={t("fasting.start.starts")} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 12, minHeight: 44, color: colors.ink }} />
              <MutedText>{t("fasting.start.ends")} (YYYY-MM-DD)</MutedText>
              <TextInput value={ends} onChangeText={setEnds} placeholder="2027-03-09" autoCapitalize="none" keyboardType="numbers-and-punctuation" accessibilityLabel={t("fasting.start.ends")} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 12, minHeight: 44, color: colors.ink }} />
              {failed ? <ErrorText>{t("fasting.start.failed")}</ErrorText> : null}
              {saved && !failed ? <MutedText>{t("fasting.start.done")}</MutedText> : null}
              <PrimaryButton title={t("fasting.start.button")} disabled={busy || starts.trim() === "" || ends.trim() === ""} loading={busy} onPress={() => void save()} />
            </Card>
          ) : null}
        </>
      )}

      <View style={{ gap: 10 }}>
        <SecondaryButton title={t("fasting.message_team")} onPress={() => onNavigate("messages")} />
        <MutedText>{t("fasting.emergency")}</MutedText>
        <MutedText>{t("fasting.disclaimer")}</MutedText>
      </View>
    </ScrollView>
  );
}
