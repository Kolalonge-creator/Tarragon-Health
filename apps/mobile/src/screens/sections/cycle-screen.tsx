import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { supabase } from "@/lib/supabase";
import {
  deletePeriod,
  endPeriod,
  loadCycleTracker,
  logPeriod,
  saveDailyLog,
  setConceptionPlanningMode,
  type CycleTrackerData,
  type MenstrualFlowLevel,
  type MenstrualMood,
  type MenstrualOvulationTestResult,
  type MenstrualSymptom,
} from "@/lib/cycle";
import {
  FERTILE_WINDOW_DISCLAIMER,
  PHASE_DESCRIPTION,
  PHASE_LABEL,
  nextPeriodSummary,
  type CycleClinicalFlag,
  type CycleConfidence,
  type ReproductiveLifeStage,
} from "@/lib/cycle-prediction";
import { describeFertileWindow, NOT_CONTRACEPTION_LABEL } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import type { SectionId } from "@/lib/sections";
import { PrivateSection } from "@/ui/private-section";
import { CycleDangerSigns } from "@/ui/cycle-danger-signs";
import { CyclePrivacyControls } from "@/ui/cycle-privacy-controls";
import { radius, spacing } from "@/ui/theme";
import { useLegacyColors, useTextInputStyle, useTheme, placeholderColorFor } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/legacy-kit";

/**
 * The cycle tracker's native screen (spec §44's large sub-feature —
 * previously WebView-only, see docs/mobile-native-conversion/womens-health.md
 * and the note this replaced in womens-health-screen.tsx). Mirrors
 * apps/web/.../patient/cycle/{page,cycle-tracker,cycle-day-log}.tsx: period
 * logging, the day-by-day symptom/mood/flow log, the prediction engine's
 * "what to expect" numbers, clinical flags, patterns, and history.
 *
 * Deliberately NOT ported in this pass: the month-grid calendar visual
 * (cycle-calendar.tsx) and the pattern-over-time/thermal-shift insights
 * cards (cycle-insights-card.tsx, lib/rules/cycle-insights.ts,
 * lib/rules/cycle-thermal-shift.ts) and the health-library "worth a read"
 * card (lib/rules/cycle-reading.ts). Every field those would need is still
 * captured here (BBT, ovulation test, symptoms, moods) so no data is lost —
 * a day is picked with the stepper below rather than a calendar grid, and
 * the underlying prediction/flags engine (lib/cycle-prediction.ts) is a
 * verbatim, un-simplified port. Revisit the calendar/insights visuals as a
 * follow-up if the founder wants full parity.
 */

interface CycleScreenProps {
  patientId: string;
  organisationId: string;
  onNavigate: (section: SectionId) => void;
}

function longDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function shortDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
  });
}

const CONFIDENCE_LABEL: Record<CycleConfidence, string> = {
  none: "No estimate yet",
  low: "Rough estimate",
  medium: "Fairly confident",
  high: "Confident",
};

const confidenceColor = (colors: ReturnType<typeof useLegacyColors>): Record<CycleConfidence, string> => ({
  none: colors.faint,
  low: colors.status.warn,
  medium: colors.brand,
  high: colors.brand,
});

function Chip({ label, active, onPress, tone = "neutral" }: { label: string; active: boolean; onPress: () => void; tone?: "neutral" | "period" }) {
  const colors = useLegacyColors();
  return (
    <Text
      onPress={onPress}
      style={{
        fontSize: 12.5,
        fontWeight: "600",
        paddingVertical: 7,
        paddingHorizontal: 11,
        borderRadius: 999,
        backgroundColor: active ? (tone === "period" ? colors.danger : colors.brand) : colors.groupBg,
        color: active ? "#FFFFFF" : colors.ink,
      }}
    >
      {label}
    </Text>
  );
}

const FLOW_OPTIONS: { value: MenstrualFlowLevel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "spotting", label: "Spotting" },
  { value: "light", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "heavy", label: "Heavy" },
  { value: "flooding", label: "Very heavy" },
];

const SYMPTOM_OPTIONS: { value: MenstrualSymptom; label: string }[] = [
  { value: "cramps", label: "Cramps" },
  { value: "headache", label: "Headache" },
  { value: "bloating", label: "Bloating" },
  { value: "breast_tenderness", label: "Sore breasts" },
  { value: "back_pain", label: "Back pain" },
  { value: "fatigue", label: "Tiredness" },
  { value: "nausea", label: "Nausea" },
  { value: "acne", label: "Skin breakout" },
  { value: "diarrhoea", label: "Loose stool" },
  { value: "constipation", label: "Constipation" },
  { value: "food_cravings", label: "Cravings" },
  { value: "insomnia", label: "Trouble sleeping" },
];

const MOOD_OPTIONS: { value: MenstrualMood; label: string }[] = [
  { value: "calm", label: "Calm" },
  { value: "happy", label: "Happy" },
  { value: "energetic", label: "Energetic" },
  { value: "irritable", label: "Irritable" },
  { value: "anxious", label: "Anxious" },
  { value: "low", label: "Low" },
  { value: "mood_swings", label: "Up and down" },
];

const OVULATION_TEST_OPTIONS: { value: MenstrualOvulationTestResult; label: string }[] = [
  { value: "negative", label: "Negative" },
  { value: "positive", label: "Positive" },
  { value: "peak", label: "Peak" },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * S66: the whole tracker sits behind the section PIN (optional, on by default, re-asked after backgrounding). The danger signs are the one
 * thing that stays outside it: they hold no personal data and must be readable on a locked screen. The lock is keyed to the SIGNED-IN
 * account, so a phone shared by two people keeps two PINs.
 */
export function CycleScreen(props: CycleScreenProps) {
  const colors = useLegacyColors();
  const [accountId, setAccountId] = useState(props.patientId);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user?.id) setAccountId(data.user.id);
    });
  }, []);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <View>
        <ScreenTitle>Your cycle</ScreenTitle>
      </View>
      <PrivateSection accountId={accountId} title="Your tracker" outside={<CycleDangerSigns />}>
        <CycleScreenBody {...props} />
        {accountId === props.patientId && <CyclePrivacyControls />}
      </PrivateSection>
    </ScrollView>
  );
}

function CycleScreenBody({ patientId, organisationId, onNavigate }: CycleScreenProps) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tracker, setTracker] = useState<CycleTrackerData | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [dateDraft, setDateDraft] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setActionError(null);
    // Same query shape as web's CyclePage: read the patient's self-reported
    // life stage + average cycle length to seed the prediction, defaulting
    // to "menstruating" exactly like the web page does when nothing is
    // recorded yet (the tracker itself is what somebody menstruating opens).
    const { data: profile } = await supabase
      .from("reproductive_health_profiles")
      .select("life_stage, average_cycle_length_days, conception_planning_mode")
      .eq("patient_id", patientId)
      .maybeSingle();
    const stage: ReproductiveLifeStage = (profile?.life_stage as ReproductiveLifeStage | null) ?? "menstruating";

    const result = await loadCycleTracker(patientId, stage, profile?.average_cycle_length_days ?? null, profile?.conception_planning_mode ?? false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setTracker(result.data);
    setSelectedDate((prev) => prev || result.data.today);
  }, [patientId]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    setDateDraft(selectedDate);
  }, [selectedDate]);

  if (loading) {
    return (
      <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 40 }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (error || !tracker) {
    return (
      <View style={{ gap: 16 }}>
        <Card style={{ gap: 8 }}>
          <ErrorText>{error ?? "We could not load your cycle just now."}</ErrorText>
          <SecondaryButton title="Try again" onPress={() => { setLoading(true); refresh().finally(() => setLoading(false)); }} />
        </Card>
      </View>
    );
  }

  const { cycles, dailyLogs, prediction, openCycle, today, conceptionPlanning } = tracker;
  const hasHistory = cycles.length > 0;
  const selectedLog = dailyLogs.find((log) => log.log_date === selectedDate) ?? null;
  const canLogSelectedAsStart = selectedDate !== "" && selectedDate < today;

  async function withAction(run: () => Promise<{ ok: boolean; error?: string }>) {
    setActionError(null);
    setActionPending(true);
    const result = await run();
    setActionPending(false);
    if (!result.ok) {
      setActionError(result.error ?? "Could not save that just now. Please try again.");
      return;
    }
    await refresh();
  }

  return (
    <View style={{ gap: 16 }}>
      <View>
        <MutedText>
          Log your period and how you feel, and see what to expect next. Everything here is an
          estimate from your own history, not a diagnosis.
        </MutedText>
      </View>

      <FlagsCard flags={prediction.flags} onNavigate={onNavigate} />

      {/* ---------- Where you are now ---------- */}
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Where you are now</Text>
          <Text style={{ fontSize: 11.5, fontWeight: "700", color: confidenceColor(colors)[prediction.confidence] }}>
            {CONFIDENCE_LABEL[prediction.confidence]}
          </Text>
        </View>
        <MutedText>{prediction.confidenceReason}</MutedText>

        {prediction.currentPhase !== "unknown" && (
          <View style={{ backgroundColor: colors.brandTint, borderRadius: radius.control, padding: 10, gap: 2 }}>
            <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>
              {PHASE_LABEL[prediction.currentPhase]}
              {prediction.currentCycleDay ? ` · Day ${prediction.currentCycleDay}` : ""}
            </Text>
            <Text style={{ fontSize: 12.5, color: colors.muted }}>{PHASE_DESCRIPTION[prediction.currentPhase]}</Text>
          </View>
        )}

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {openCycle ? (
            <SecondaryButton
              title="My period has ended"
              loading={actionPending}
              onPress={() => withAction(() => endPeriod({ cycleId: openCycle.id, endDate: today }))}
            />
          ) : (
            <SecondaryButton
              title="My period started today"
              loading={actionPending}
              onPress={() => withAction(() => logPeriod({ patientId, organisationId, periodStartDate: today }))}
            />
          )}
        </View>
        {actionError && <ErrorText>{actionError}</ErrorText>}
      </Card>

      {/* ---------- Planning a pregnancy (off by default, S66 A14) ---------- */}
      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("cycle.planning.title")}</Text>
        <MutedText>{t("cycle.planning.description")}</MutedText>
        <Text style={{ fontSize: 13, color: colors.ink }}>{conceptionPlanning ? t("cycle.planning.on_label") : t("cycle.planning.off_label")}</Text>
        <MutedText>{conceptionPlanning ? t("cycle.planning.turn_off_note") : t("cycle.planning.off_note")}</MutedText>
        <SecondaryButton
          title={conceptionPlanning ? t("cycle.planning.turn_off") : t("cycle.planning.turn_on")}
          loading={actionPending}
          onPress={() => withAction(() => setConceptionPlanningMode(!conceptionPlanning))}
        />
      </Card>

      {/* ---------- What to expect ---------- */}
      {hasHistory && (
        <Card style={{ gap: 10 }}>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>What to expect</Text>
          <MutedText>
            Estimates from your own logged cycles. They are not a promise, and they get sharper
            each time you log a period.
          </MutedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <View style={{ flexBasis: "45%", flexGrow: 1 }}>
              <MutedText>{prediction.isOverdue ? "Was expected" : "Next period"}</MutedText>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
                {longDate(prediction.predictedNextPeriodDate)}
              </Text>
              {prediction.predictedNextPeriodEarliest && (
                <MutedText>
                  Most likely {shortDate(prediction.predictedNextPeriodEarliest)} to{" "}
                  {shortDate(prediction.predictedNextPeriodLatest)}
                </MutedText>
              )}
              <MutedText>{nextPeriodSummary(prediction)}</MutedText>
            </View>
            {conceptionPlanning && (
              <View style={{ flexBasis: "45%", flexGrow: 1 }}>
                <MutedText>Estimated ovulation</MutedText>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
                  {longDate(prediction.predictedOvulationDate)}
                </Text>
                {describeFertileWindow(prediction, shortDate) && <MutedText>{describeFertileWindow(prediction, shortDate)}</MutedText>}
              </View>
            )}
          </View>
          {conceptionPlanning && <Text style={{ fontSize: 11.5, color: colors.subtle }}>{FERTILE_WINDOW_DISCLAIMER}</Text>}
        </Card>
      )}

      {/* ---------- Day log ---------- */}
      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Log a day</Text>
        <MutedText>Tap anything that applies. Nothing here is required.</MutedText>

        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Date</Text>
            <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={dateDraft} onChangeText={setDateDraft} placeholder="YYYY-MM-DD" style={textInputStyle} />
          </View>
          <SecondaryButton
            title="Go"
            onPress={() => {
              if (dateDraft && !Number.isNaN(Date.parse(`${dateDraft}T00:00:00Z`))) setSelectedDate(dateDraft);
            }}
          />
          {selectedDate !== today && <SecondaryButton title="Today" onPress={() => setSelectedDate(today)} />}
        </View>

        {canLogSelectedAsStart && (
          <Text
            onPress={() => withAction(() => logPeriod({ patientId, organisationId, periodStartDate: selectedDate }))}
            style={{ fontSize: 12.5, fontWeight: "700", color: colors.brandPressed }}
          >
            It started on {shortDate(selectedDate)} →
          </Text>
        )}

        <DayLogForm
          key={selectedDate}
          patientId={patientId}
          organisationId={organisationId}
          date={selectedDate}
          existing={selectedLog}
          dateLabel={longDate(selectedDate)}
          onSaved={refresh}
          planning={conceptionPlanning}
        />
      </Card>

      {/* ---------- Patterns ---------- */}
      {prediction.stats.usedCycles > 0 && (
        <Card style={{ gap: 10 }}>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Your patterns</Text>
          <MutedText>
            Measured from the {prediction.stats.usedCycles} most recent cycle
            {prediction.stats.usedCycles === 1 ? "" : "s"} you logged.
          </MutedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
            <View style={{ flexBasis: "28%", flexGrow: 1 }}>
              <MutedText>Average cycle</MutedText>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
                {prediction.stats.averageCycleLengthDays} days
              </Text>
              {prediction.stats.shortestCycleDays !== null && (
                <MutedText>
                  {prediction.stats.shortestCycleDays}–{prediction.stats.longestCycleDays} days
                </MutedText>
              )}
            </View>
            <View style={{ flexBasis: "28%", flexGrow: 1 }}>
              <MutedText>Period length</MutedText>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
                {prediction.stats.averagePeriodDurationDays !== null
                  ? `${prediction.stats.averagePeriodDurationDays} days`
                  : "Not logged"}
              </Text>
            </View>
            <View style={{ flexBasis: "28%", flexGrow: 1 }}>
              <MutedText>Regularity</MutedText>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
                {prediction.stats.regularity === "regular"
                  ? "Regular"
                  : prediction.stats.regularity === "irregular"
                    ? "Variable"
                    : "Not enough data"}
              </Text>
            </View>
          </View>
        </Card>
      )}

      {/* ---------- History ---------- */}
      {hasHistory && (
        <Card style={{ gap: 8 }}>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Periods you have logged</Text>
          <MutedText>
            Remove any that were logged by mistake. A wrong start date changes every estimate
            that comes after it.
          </MutedText>
          {cycles.slice(0, 12).map((cycle) => (
            <View
              key={cycle.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                borderTopWidth: 1,
                borderTopColor: colors.border,
                paddingTop: 8,
              }}
            >
              <Text style={{ fontSize: 13, color: colors.ink }}>
                {longDate(cycle.period_start_date)}
                {cycle.period_end_date ? ` to ${shortDate(cycle.period_end_date)}` : " (open)"}
              </Text>
              <Text
                onPress={() => withAction(() => deletePeriod(cycle.id))}
                style={{ fontSize: 12.5, fontWeight: "700", color: colors.danger }}
              >
                Remove
              </Text>
            </View>
          ))}
        </Card>
      )}

      <Text style={{ fontSize: 11.5, color: colors.subtle }}>
        Your cycle information is part of your health record. Your care team can see it; nobody
        else can. It plays no part in scoring your health risk.
      </Text>
    </View>
  );
}

function FlagsCard({ flags, onNavigate }: { flags: CycleClinicalFlag[]; onNavigate: (section: SectionId) => void }) {
  const colors = useLegacyColors();
  if (flags.length === 0) return null;
  const urgent = flags.filter((f) => f.severity === "urgent");
  const rest = flags.filter((f) => f.severity !== "urgent");

  return (
    <View style={{ gap: 10 }}>
      {urgent.map((flag) => (
        <View key={flag.id} style={{ borderLeftWidth: 4, borderLeftColor: colors.danger, backgroundColor: colors.status.warnBg, borderRadius: radius.control, padding: 12, gap: 4 }}>
          <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.danger }}>{flag.label}</Text>
          <Text style={{ fontSize: 12.5, color: colors.ink }}>{flag.detail}</Text>
          <Text onPress={() => onNavigate("messages")} style={{ fontSize: 12.5, fontWeight: "700", color: colors.danger }}>
            Message your care team →
          </Text>
        </View>
      ))}
      {rest.length > 0 && (
        <Card style={{ gap: 8 }}>
          <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>Worth mentioning to your care team</Text>
          <MutedText>These are patterns we noticed in what you logged. None of them is an emergency.</MutedText>
          {rest.map((flag) => (
            <View key={flag.id}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{flag.label}</Text>
              <MutedText>{flag.detail}</MutedText>
            </View>
          ))}
          <Text onPress={() => onNavigate("messages")} style={{ fontSize: 12.5, fontWeight: "700", color: colors.brandPressed }}>
            Message your care team →
          </Text>
        </Card>
      )}
    </View>
  );
}

function DayLogForm({
  patientId,
  organisationId,
  date,
  existing,
  dateLabel,
  onSaved,
  planning,
}: {
  patientId: string;
  organisationId: string;
  date: string;
  existing: import("@/lib/cycle").MenstrualDailyLog | null;
  dateLabel: string;
  onSaved: () => Promise<void>;
  /** S66 (A14): temperature and ovulation test belong to planning mode; hidden while off, saved values kept. */
  planning: boolean;
}) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [flow, setFlow] = useState<MenstrualFlowLevel | null>(existing?.flow ?? null);
  const [symptoms, setSymptoms] = useState<MenstrualSymptom[]>((existing?.symptoms as MenstrualSymptom[]) ?? []);
  const [moods, setMoods] = useState<MenstrualMood[]>((existing?.moods as MenstrualMood[]) ?? []);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [bbt, setBbt] = useState(existing?.basal_body_temperature_c != null ? String(existing.basal_body_temperature_c) : "");
  const [ovulationTest, setOvulationTest] = useState<MenstrualOvulationTestResult | null>(
    (existing?.ovulation_test_result as MenstrualOvulationTestResult | null) ?? null
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit() {
    if (!date) return;
    setError(null);
    setSaved(false);
    setSubmitting(true);
    const result = await saveDailyLog({
      patientId,
      organisationId,
      logDate: date,
      flow,
      symptoms,
      moods,
      notes: notes.trim() || null,
      basalBodyTemperatureC: bbt.trim() === "" ? null : Number(bbt),
      ovulationTestResult: ovulationTest,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    await onSaved();
  }

  return (
    <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
      <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.ink }}>{dateLabel}</Text>

      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Flow</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {FLOW_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            tone="period"
            active={flow === option.value}
            onPress={() => setFlow(flow === option.value ? null : option.value)}
          />
        ))}
      </View>

      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>How you felt physically</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {SYMPTOM_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            active={symptoms.includes(option.value)}
            onPress={() => setSymptoms((current) => toggle(current, option.value))}
          />
        ))}
      </View>

      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Mood</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {MOOD_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            active={moods.includes(option.value)}
            onPress={() => setMoods((current) => toggle(current, option.value))}
          />
        ))}
      </View>

      {planning && (<>
      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Tracking ovulation? (optional)</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <MutedText>Waking temperature (°C)</MutedText>
          <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={bbt} onChangeText={setBbt} placeholder="36.50" keyboardType="decimal-pad" style={textInputStyle} />
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {OVULATION_TEST_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            active={ovulationTest === option.value}
            onPress={() => setOvulationTest(ovulationTest === option.value ? null : option.value)}
          />
        ))}
      </View>
      <MutedText>
        Take your temperature before getting out of bed. A sustained rise suggests ovulation has
        already happened, so it confirms rather than predicts. {NOT_CONTRACEPTION_LABEL}
      </MutedText>
      </>)}

      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Anything else (optional)</Text>
      <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)}
        value={notes}
        onChangeText={setNotes}
        placeholder="Only you and your care team can see this."
        style={textInputStyle}
        multiline
      />

      {error && <ErrorText>Could not save that just now. Please try again.</ErrorText>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <PrimaryButton title="Save this day" onPress={submit} loading={submitting} />
        {saved && !submitting && <MutedText>Saved</MutedText>}
      </View>
    </View>
  );
}
