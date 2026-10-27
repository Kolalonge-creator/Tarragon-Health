import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Switch, useWindowDimensions, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { en, FERTILE_WINDOW_LABEL, FERTILE_WINDOW_LINK_TEXT, t } from "@tarragon/i18n";
import { phaseDescription, phaseLabel, THERMAL_SHIFT_EXPLAINER } from "@/lib/cycle-fertile-mode";
import {
  deletePeriod,
  endPeriod,
  loadCycleTracker,
  loadPlanningMode,
  logPeriod,
  savePlanningMode,
  saveDailyLog,
  type CycleTrackerData,
  type MenstrualFlowLevel,
  type MenstrualMood,
  type MenstrualOvulationTestResult,
  type MenstrualSymptom,
} from "@/lib/cycle";
import { FERTILE_WINDOW_DISCLAIMER, nextPeriodSummary, type CycleClinicalFlag, type ReproductiveLifeStage } from "@/lib/cycle-prediction";
import { countPendingCycleLogs, draftFor, guardedAction, refreshFailureView, saveFeedback, withDraft, withoutDraft, type DayDraft, type SaveFeedback } from "@/lib/cycle-ui";
import { getConnectionKind } from "@/lib/connection-kind";
import type { SectionId } from "@/lib/sections";
import { space, useTheme } from "@/ui/design";
import { AppText, Button, Card, Field, Icon, Screen, Sheet, Skeleton, SkeletonGroup, type IconName } from "@/ui/kit";
import { PrivateSection } from "@/ui/private-section";
import { CycleDangerSigns } from "@/ui/cycle-danger-signs";
import { CyclePrivacyControls } from "@/ui/cycle-privacy-controls";
import { FeatureConsentGate } from "@/ui/feature-consent-gate";
import { CycleActionButton, CycleChip, CycleListen, CycleSaveNote } from "@/ui/cycle-parts";
import { CycleStatusCard } from "@/ui/cycle-status-card";
import { CycleWeekStrip } from "@/ui/cycle-date-picker";

/**
 * The cycle tracker's native screen (spec §44's large sub-feature). Mirrors apps/web/.../patient/cycle/{page,cycle-tracker,cycle-day-log}.tsx:
 * period logging, the day-by-day symptom/mood/flow log, the prediction engine's "what to expect" numbers, clinical flags, patterns, history.
 *
 * UI-A redesign (docs/research/S66-S70-design-ui-comparison.md, changes 1 to 4, 7, 8, 10, 11, 12, 14): the screen is on the kit now
 * (14 point body, 16 point actions, the dark palette, text scaling), the top card is one plain-word status with confidence in words and
 * three dots, the day is picked from a week strip (no typed date), the day log is a bottom sheet with tick-and-word chips and the save
 * pinned at the bottom, and every card that explains something can be listened to once a recorded clip exists. "Nothing here is
 * required." stays. No streaks, no "you missed a day", no red outside the clinical flags and the danger signs.
 *
 * Deliberately NOT ported: the month-grid calendar visual (cycle-calendar.tsx) beyond the date-picking sheet, and the pattern-over-time
 * and thermal-shift insights cards. Every field they need is still captured here.
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

const FLOW_VALUES: MenstrualFlowLevel[] = ["none", "spotting", "light", "medium", "heavy", "flooding"];
const SYMPTOM_VALUES: MenstrualSymptom[] = ["cramps", "headache", "bloating", "breast_tenderness", "back_pain", "fatigue", "nausea", "acne", "diarrhoea", "constipation", "food_cravings", "insomnia"];
const MOOD_VALUES: MenstrualMood[] = ["calm", "happy", "energetic", "irritable", "anxious", "low", "mood_swings"];
const OVULATION_TEST_VALUES: MenstrualOvulationTestResult[] = ["negative", "positive", "peak"];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * S66: the whole tracker sits behind the section PIN (optional, on by default, re-asked after backgrounding). The danger signs are the one
 * thing that stays outside it: they hold no personal data and must be readable on a locked screen. The lock is keyed to the SIGNED-IN
 * account, so a phone shared by two people keeps two PINs.
 */
function CycleScreenInner(props: CycleScreenProps) {
  const [accountId, setAccountId] = useState(props.patientId);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user?.id) setAccountId(data.user.id);
    });
  }, []);
  return (
    <Screen>
      <AppText variant="headline" heading>
        Your cycle
      </AppText>
      <PrivateSection accountId={accountId} title="Your tracker" outside={<CycleDangerSigns onMessageCareTeam={() => props.onNavigate("messages")} />}>
        <CycleScreenBody {...props} />
        {accountId === props.patientId && <CyclePrivacyControls />}
      </PrivateSection>
    </Screen>
  );
}

function CycleScreenBody({ patientId, organisationId, onNavigate }: CycleScreenProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tracker, setTracker] = useState<CycleTrackerData | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  // Unsaved choices live here, not in the sheet: the sheet unmounts its form when it closes. Cleared only by a successful save.
  const [drafts, setDrafts] = useState<Record<string, DayDraft>>({});
  // A save went through but the re-read failed: keep the screen and say so, never "we could not load your cycle".
  const [refreshFailed, setRefreshFailed] = useState(false);
  const hasData = useRef(false);
  const [savedNote, setSavedNote] = useState<SaveFeedback | "idle">("idle");
  const [pendingLogs, setPendingLogs] = useState(0);
  // "Planning a pregnancy" (S85 D2): the fertile window and temperature-based ovulation confirmation show only while on.
  const [planningMode, setPlanningMode] = useState(false);
  const [modePending, setModePending] = useState(false);
  const [modeError, setModeError] = useState(false);

  // Turning it ON waits for the save and shows the window only once the prediction is rebuilt with it. Turning it OFF
  // hides everything at once and stays hidden even if the save fails (with a message): hidden is the safe state.
  async function changePlanningMode(next: boolean) {
    setModeError(false);
    setModePending(true);
    if (!next) setPlanningMode(false);
    let saved = false;
    try {
      saved = (await savePlanningMode({ patientId, organisationId, enabled: next })).ok;
    } catch {
      saved = false;
    }
    setModePending(false);
    if (!saved) {
      setModeError(true);
      return;
    }
    // Rebuild from the choice just saved (not a fresh read, which would turn a read hiccup into a silent switch-off).
    await refresh(next);
  }

  /** Re-reads the tracker. Returns whether it worked; a failure after data is on screen keeps the screen (see refreshFailureView). */
  const refresh = useCallback(async (modeOverride?: boolean): Promise<boolean> => {
    setActionError(null);
    try {
      return await refreshInner(modeOverride);
    } catch {
      return failRefresh();
    }
  }, [patientId]);

  function failRefresh(): boolean {
    if (refreshFailureView(hasData.current) === "saved_note") setRefreshFailed(true);
    else setError(t("cycle.load_failed"));
    return false;
  }

  async function refreshInner(modeOverride?: boolean): Promise<boolean> {
    // Same query shape as web's CyclePage: read the patient's self-reported
    // life stage + average cycle length to seed the prediction, defaulting
    // to "menstruating" exactly like the web page does when nothing is
    // recorded yet (the tracker itself is what somebody menstruating opens).
    const { data: profile } = await supabase
      .from("reproductive_health_profiles")
      .select("life_stage, average_cycle_length_days")
      .eq("patient_id", patientId)
      .maybeSingle();
    const stage: ReproductiveLifeStage = (profile?.life_stage as ReproductiveLifeStage | null) ?? "menstruating";
    // Off unless the person switched on "Planning a pregnancy" (S85 D2); any read problem also means off.
    const mode = modeOverride ?? (await loadPlanningMode(patientId));

    const result = await loadCycleTracker(patientId, stage, profile?.average_cycle_length_days ?? null, mode);
    if (!result.ok) return failRefresh();
    hasData.current = true;
    setRefreshFailed(false);
    setError(null);
    // The mode and the prediction built with it change together, so a screen never pairs one with the other's.
    setPlanningMode(mode);
    setTracker(result.data);
    setSelectedDate((prev) => prev || result.data.today);
    setPendingLogs(await countPendingCycleLogs());
    return true;
  }

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Marks for the week strip and the date sheet: days with a log, and days of a logged period.
  const loggedDays = useMemo(() => new Set((tracker?.dailyLogs ?? []).filter((l) => l.flow || l.symptoms.length > 0 || l.moods.length > 0 || l.notes).map((l) => l.log_date)), [tracker]);
  const periodDays = useMemo(() => {
    const days = new Set<string>();
    for (const c of tracker?.cycles ?? []) {
      const end = c.period_end_date ?? c.period_start_date;
      const d = new Date(`${c.period_start_date}T00:00:00Z`);
      for (let guard = 0; guard < 20 && d.toISOString().slice(0, 10) <= end; guard += 1) {
        days.add(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    return days;
  }, [tracker]);

  if (loading) {
    return (
      <SkeletonGroup label={t("cycle.status.listen_title")}>
        <Skeleton width="100%" height={140} />
      </SkeletonGroup>
    );
  }

  // A failed load says it failed and offers a retry: it is never shown as "nothing logged".
  if (error || !tracker) {
    return (
      <Card style={{ gap: space.md }}>
        <AppText variant="body" accessibilityRole="alert">
          {t("cycle.load_failed")}
        </AppText>
        <CycleActionButton
          title={t("cycle.load_retry")}
          variant="secondary"
          onPress={() => {
            setLoading(true);
            refresh().finally(() => setLoading(false));
          }}
        />
      </Card>
    );
  }

  const { cycles, dailyLogs, prediction, openCycle, today } = tracker;
  const hasHistory = cycles.length > 0;
  const selectedLog = dailyLogs.find((log) => log.log_date === selectedDate) ?? null;
  const canLogSelectedAsStart = selectedDate !== "" && selectedDate < today;
  const periodInProgress = openCycle ? { startedOn: openCycle.period_start_date, today } : null;

  async function withAction(run: () => Promise<{ ok: boolean; error?: string }>) {
    setActionError(null);
    setActionPending(true);
    // guardedAction never throws, so the button always comes back to life.
    const result = await guardedAction(run);
    setActionPending(false);
    if (!result.ok) {
      setActionError(result.error ?? "Could not save that just now. Please try again.");
      return;
    }
    await refresh();
  }

  return (
    <View style={{ gap: space.lg }}>
      <AppText variant="body" tone="textMuted">
        Log your period and how you feel, and see what to expect next. Everything here is an estimate from your own history, not a diagnosis.
      </AppText>

      {refreshFailed && (
        <Card style={{ gap: space.sm }}>
          <AppText variant="body" accessibilityRole="alert">
            {t("cycle.refresh_failed")}
          </AppText>
          <CycleActionButton title={t("cycle.load_retry")} variant="secondary" onPress={() => void refresh()} />
        </Card>
      )}

      <FlagsCard flags={prediction.flags} onNavigate={onNavigate} />

      {/* ---------- Where you are now ---------- */}
      <CycleStatusCard prediction={prediction} inProgress={periodInProgress}>
        {prediction.currentPhase !== "unknown" && (
          <View accessible style={{ gap: 2 }}>
            <AppText variant="bodyStrong">
              {phaseLabel(prediction.currentPhase, planningMode)}
              {prediction.currentCycleDay ? ` · Day ${prediction.currentCycleDay}` : ""}
            </AppText>
            <AppText variant="body" tone="textMuted">
              {phaseDescription(prediction.currentPhase, planningMode)}
            </AppText>
          </View>
        )}

        <PlanningModeSwitch enabled={planningMode} pending={modePending} error={modeError} onChange={changePlanningMode} />
        {/* Shown once on the screen: with history the "What to expect" card below carries it. */}
        {planningMode && !hasHistory && <FertileWindowNotice onNavigate={onNavigate} />}

        {openCycle ? (
          <CycleActionButton
            title="My period has ended"
            variant="secondary"
            loading={actionPending}
            onPress={() => withAction(() => endPeriod({ cycleId: openCycle.id, endDate: today }))}
          />
        ) : (
          <CycleActionButton
            title="My period started today"
            loading={actionPending}
            onPress={() => withAction(() => logPeriod({ patientId, organisationId, periodStartDate: today }))}
          />
        )}
        {actionError && (
          <AppText variant="body" tone="dangerText" accessibilityRole="alert">
            {actionError}
          </AppText>
        )}
      </CycleStatusCard>

      {/* ---------- What to expect ---------- */}
      {hasHistory && (
        <Card style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
            <AppText variant="title" heading style={{ flex: 1 }}>
              What to expect
            </AppText>
            <CycleListen card="expect" />
          </View>
          <AppText variant="body" tone="textMuted">
            Estimates from your own logged cycles. They are not a promise, and they get sharper each time you log a period.
          </AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg }}>
            <View style={{ flexBasis: "45%", flexGrow: 1, gap: 2 }}>
              <AppText variant="body" tone="textMuted">{prediction.isOverdue ? "Was expected" : "Next period"}</AppText>
              <AppText variant="bodyLarge" style={{ fontWeight: "700" }}>
                {longDate(prediction.predictedNextPeriodDate)}
              </AppText>
              {prediction.predictedNextPeriodEarliest && (
                <AppText variant="body" tone="textMuted">
                  Most likely {shortDate(prediction.predictedNextPeriodEarliest)} to {shortDate(prediction.predictedNextPeriodLatest)}
                </AppText>
              )}
              {!periodInProgress && <AppText variant="body" tone="textMuted">{nextPeriodSummary(prediction)}</AppText>}
            </View>
            {planningMode && (
              <View style={{ flexBasis: "45%", flexGrow: 1, gap: 2 }}>
                <AppText variant="body" tone="textMuted">Estimated ovulation</AppText>
                <AppText variant="bodyLarge" style={{ fontWeight: "700" }}>
                  {longDate(prediction.predictedOvulationDate)}
                </AppText>
                {prediction.fertileWindowStart && (
                  <AppText variant="body" tone="textMuted">
                    Fertile window {shortDate(prediction.fertileWindowStart)} to {shortDate(prediction.fertileWindowEnd)}
                  </AppText>
                )}
              </View>
            )}
          </View>
          {planningMode && (
            <>
              <AppText variant="body" tone="textMuted">{FERTILE_WINDOW_DISCLAIMER}</AppText>
              <FertileWindowNotice onNavigate={onNavigate} />
            </>
          )}
        </Card>
      )}

      {/* ---------- Day log ---------- */}
      <Card style={{ gap: space.md }}>
        <AppText variant="title" heading>
          {t("cycle.log.title")}
        </AppText>
        <AppText variant="body" tone="textMuted">{t("cycle.log.intro")}</AppText>

        <CycleWeekStrip today={today} selected={selectedDate} onSelect={setSelectedDate} loggedDays={loggedDays} periodDays={periodDays} />

        <AppText variant="bodyStrong" accessibilityLiveRegion="polite">
          {longDate(selectedDate)}
        </AppText>

        {canLogSelectedAsStart && (
          <Button
            title={`${t("cycle.log.started_here")}: ${shortDate(selectedDate)}`}
            variant="ghost"
            fullWidth={false}
            onPress={() => void withAction(() => logPeriod({ patientId, organisationId, periodStartDate: selectedDate }))}
          />
        )}

        <CycleActionButton
          title={t("cycle.log.open")}
          onPress={() => {
            setSavedNote("idle");
            setLogOpen(true);
          }}
        />
        <CycleSaveNote state={savedNote} pending={pendingLogs} />
      </Card>

      <Sheet visible={logOpen} avoidKeyboard onClose={() => setLogOpen(false)} title={`${t("cycle.log.title")}: ${shortDate(selectedDate)}`}>
        <DayLogForm
          key={selectedDate}
          patientId={patientId}
          organisationId={organisationId}
          date={selectedDate}
          draft={draftFor(drafts, selectedDate, selectedLog)}
          onDraft={(draft) => setDrafts((d) => withDraft(d, selectedDate, draft))}
          onSaved={async (outcome) => {
            if (outcome === "saved") {
              setDrafts((d) => withoutDraft(d, selectedDate));
              setSavedNote("saved");
              setLogOpen(false);
              await refresh();
            }
          }}
          planningMode={planningMode}
          onNavigate={onNavigate}
        />
      </Sheet>

      {/* ---------- Patterns ---------- */}
      {prediction.stats.usedCycles > 0 && (
        <Card style={{ gap: space.md }}>
          <AppText variant="title" heading>
            Your patterns
          </AppText>
          <AppText variant="body" tone="textMuted">
            Measured from the {prediction.stats.usedCycles} most recent cycle
            {prediction.stats.usedCycles === 1 ? "" : "s"} you logged.
          </AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg }}>
            <View style={{ flexBasis: "28%", flexGrow: 1 }}>
              <AppText variant="body" tone="textMuted">Average cycle</AppText>
              <AppText variant="bodyLarge" style={{ fontWeight: "700" }}>
                {prediction.stats.averageCycleLengthDays} days
              </AppText>
              {prediction.stats.shortestCycleDays !== null && (
                <AppText variant="body" tone="textMuted">
                  {prediction.stats.shortestCycleDays}–{prediction.stats.longestCycleDays} days
                </AppText>
              )}
            </View>
            <View style={{ flexBasis: "28%", flexGrow: 1 }}>
              <AppText variant="body" tone="textMuted">Period length</AppText>
              <AppText variant="bodyLarge" style={{ fontWeight: "700" }}>
                {prediction.stats.averagePeriodDurationDays !== null ? `${prediction.stats.averagePeriodDurationDays} days` : "Not logged"}
              </AppText>
            </View>
            <View style={{ flexBasis: "28%", flexGrow: 1 }}>
              <AppText variant="body" tone="textMuted">Regularity</AppText>
              <AppText variant="bodyLarge" style={{ fontWeight: "700" }}>
                {prediction.stats.regularity === "regular" ? "Regular" : prediction.stats.regularity === "irregular" ? "Variable" : "Not enough data"}
              </AppText>
            </View>
          </View>
        </Card>
      )}

      {/* ---------- History ---------- */}
      {hasHistory && (
        <Card style={{ gap: space.md }}>
          <AppText variant="title" heading>
            Periods you have logged
          </AppText>
          <AppText variant="body" tone="textMuted">
            Remove any that were logged by mistake. A wrong start date changes every estimate that comes after it.
          </AppText>
          {cycles.slice(0, 12).map((cycle) => (
            <View key={cycle.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
              <AppText variant="body" style={{ flex: 1 }}>
                {longDate(cycle.period_start_date)}
                {cycle.period_end_date ? ` to ${shortDate(cycle.period_end_date)}` : " (open)"}
              </AppText>
              <Button
                title="Remove"
                variant="ghost"
                fullWidth={false}
                accessibilityLabel={`Remove the period logged on ${longDate(cycle.period_start_date)}`}
                onPress={() => void withAction(() => deletePeriod(cycle.id))}
              />
            </View>
          ))}
        </Card>
      )}

      <AppText variant="caption" tone="textSubtle">
        Your cycle information is part of your health record. Your care team can see it; nobody else can. It plays no part in scoring your health risk.
      </AppText>
    </View>
  );
}

/**
 * S85 D2 / OQ-12: the words every screen that shows the fertile window or a temperature-based ovulation confirmation
 * must carry. The text comes from the one wording source in `@tarragon/i18n` (CMO signature pending), never typed here.
 * A missing label is the unsafe state, so there is no prop that hides it.
 */
function FertileWindowNotice({ onNavigate }: { onNavigate: (section: SectionId) => void }) {
  return (
    <View testID="fertile-window-notice" style={{ gap: space.xs }}>
      <AppText variant="bodyStrong">{FERTILE_WINDOW_LABEL}</AppText>
      <Button title={FERTILE_WINDOW_LINK_TEXT} variant="ghost" fullWidth={false} onPress={() => onNavigate("womensHealth")} />
    </View>
  );
}

function PlanningModeSwitch({ enabled, pending, error, onChange }: { enabled: boolean; pending: boolean; error: boolean; onChange: (next: boolean) => void }) {
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong">{en["cycle.planning_mode.title"]}</AppText>
          <AppText variant="body" tone="textMuted">{en["cycle.planning_mode.description"]}</AppText>
          {enabled && <AppText variant="body" tone="textMuted">{en["cycle.planning_mode.on_note"]}</AppText>}
        </View>
        <Switch value={enabled} disabled={pending} onValueChange={onChange} accessibilityLabel={en["cycle.planning_mode.title"]} />
      </View>
      {error && (
        <AppText variant="body" tone="dangerText" accessibilityRole="alert">
          {en["cycle.planning_mode.error"]}
        </AppText>
      )}
    </View>
  );
}

/**
 * Flags the engine raised. An urgent flag is a true clinical alert, so it keeps the red edge and follows the alert template
 * (what we noticed, what it may mean, one step, a message button). Everything else is a calm "worth mentioning" card with no red.
 */
function FlagsCard({ flags, onNavigate }: { flags: CycleClinicalFlag[]; onNavigate: (section: SectionId) => void }) {
  const { colors } = useTheme();
  if (flags.length === 0) return null;
  const urgent = flags.filter((f) => f.severity === "urgent");
  const rest = flags.filter((f) => f.severity !== "urgent");

  return (
    <View style={{ gap: space.md }}>
      {urgent.map((flag) => (
        <Card key={flag.id} style={{ gap: space.sm, borderLeftWidth: 4, borderLeftColor: colors.dangerText }}>
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
            <Icon name="alert" size={18} tone="dangerText" />
            <AppText variant="bodyStrong" tone="dangerText" style={{ flex: 1 }}>
              {flag.label}
            </AppText>
          </View>
          <AppText variant="body">{flag.detail}</AppText>
          <CycleActionButton title={t("cycle.danger.message_button")} variant="secondary" onPress={() => onNavigate("messages")} />
        </Card>
      ))}
      {rest.length > 0 && (
        <Card style={{ gap: space.sm }}>
          <AppText variant="title" heading>
            Worth mentioning to your care team
          </AppText>
          <AppText variant="body" tone="textMuted">These are patterns we noticed in what you logged. None of them is an emergency.</AppText>
          {rest.map((flag) => (
            <View key={flag.id}>
              <AppText variant="bodyStrong">{flag.label}</AppText>
              <AppText variant="body" tone="textMuted">{flag.detail}</AppText>
            </View>
          ))}
          <CycleActionButton title={t("cycle.danger.message_button")} variant="secondary" onPress={() => onNavigate("messages")} />
        </Card>
      )}
    </View>
  );
}

function GroupHeading({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }} accessibilityRole="header">
      <Icon name={icon} size={18} tone="brandText" />
      <AppText variant="bodyStrong">{label}</AppText>
    </View>
  );
}

function DayLogForm({
  patientId,
  organisationId,
  date,
  draft,
  onDraft,
  onSaved,
  planningMode,
  onNavigate,
}: {
  patientId: string;
  organisationId: string;
  date: string;
  /** The choices so far (saved log or unsaved draft). Held by the screen so closing the sheet keeps them. */
  draft: DayDraft;
  onDraft: (draft: DayDraft) => void;
  onSaved: (outcome: SaveFeedback) => Promise<void>;
  /** "Planning a pregnancy" (S85 D2). Off hides the sentence that reads a temperature rise as ovulation. */
  planningMode: boolean;
  onNavigate: (section: SectionId) => void;
}) {
  const { height } = useWindowDimensions();
  const flow = draft.flow as MenstrualFlowLevel | null;
  const symptoms = draft.symptoms as MenstrualSymptom[];
  const moods = draft.moods as MenstrualMood[];
  const ovulationTest = draft.ovulationTest as MenstrualOvulationTestResult | null;
  const { notes, bbt } = draft;
  const setFlow = (v: MenstrualFlowLevel | null) => onDraft({ ...draft, flow: v });
  const setSymptoms = (f: (c: MenstrualSymptom[]) => MenstrualSymptom[]) => onDraft({ ...draft, symptoms: f(symptoms) });
  const setMoods = (f: (c: MenstrualMood[]) => MenstrualMood[]) => onDraft({ ...draft, moods: f(moods) });
  const setNotes = (v: string) => onDraft({ ...draft, notes: v });
  const setBbt = (v: string) => onDraft({ ...draft, bbt: v });
  const setOvulationTest = (v: MenstrualOvulationTestResult | null) => onDraft({ ...draft, ovulationTest: v });
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<SaveFeedback | "idle">("idle");

  async function submit() {
    if (!date) return;
    setFeedback("idle");
    setSubmitting(true);
    let result: { ok: boolean; error?: string };
    try {
      result = await saveDailyLog({
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
    } catch {
      result = { ok: false };
    }
    // Nothing is held on the phone yet (OQ-727), so an offline failure honestly says "not sent" and keeps the choices (they are in the draft).
    const offline = result.ok ? false : (await getConnectionKind()) === "none";
    const outcome = saveFeedback({ ok: result.ok, heldOnPhone: false, offline });
    setSubmitting(false);
    setFeedback(outcome);
    await onSaved(outcome);
  }

  return (
    <View style={{ gap: space.md }}>
      <ScrollView style={{ maxHeight: height * 0.55 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.lg, paddingBottom: space.md }}>
        <AppText variant="body" tone="textMuted">{t("cycle.log.intro")}</AppText>

        <View style={{ gap: space.sm }}>
          <GroupHeading icon="glucose" label={t("cycle.log.group_flow")} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {FLOW_VALUES.map((value) => (
              <CycleChip key={value} group label={t(`cycle.flow.${value}` as const)} selected={flow === value} onPress={() => setFlow(flow === value ? null : value)} />
            ))}
          </View>
        </View>

        <View style={{ gap: space.sm }}>
          <GroupHeading icon="symptoms" label={t("cycle.log.group_physical")} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {SYMPTOM_VALUES.map((value) => (
              <CycleChip key={value} label={t(`cycle.symptom.${value}` as const)} selected={symptoms.includes(value)} onPress={() => setSymptoms((c) => toggle(c, value))} />
            ))}
          </View>
        </View>

        <View style={{ gap: space.sm }}>
          <GroupHeading icon="mood" label={t("cycle.log.group_mood")} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {MOOD_VALUES.map((value) => (
              <CycleChip key={value} label={t(`cycle.mood.${value}` as const)} selected={moods.includes(value)} onPress={() => setMoods((c) => toggle(c, value))} />
            ))}
          </View>
        </View>

        {/* S85 D2: temperature and ovulation-test logging is fertility tracking, so it appears only while "Planning a
            pregnancy" is on. Values already saved for the day are kept (the state above is seeded from them). */}
        {planningMode && (
          <View style={{ gap: space.sm }}>
            <GroupHeading icon="heart" label={t("cycle.log.group_ovulation_test")} />
            <Field label={t("cycle.log.temperature_label")} value={bbt} onChangeText={setBbt} placeholder="36.50" keyboardType="decimal-pad" />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {OVULATION_TEST_VALUES.map((value) => (
                <CycleChip key={value} group label={t(`cycle.ovulation_test.${value}` as const)} selected={ovulationTest === value} onPress={() => setOvulationTest(ovulationTest === value ? null : value)} />
              ))}
            </View>
            <AppText variant="body" tone="textMuted">Take your temperature before getting out of bed. {THERMAL_SHIFT_EXPLAINER}</AppText>
            <FertileWindowNotice onNavigate={onNavigate} />
          </View>
        )}

        <Field label={t("cycle.log.notes_label")} value={notes} onChangeText={setNotes} placeholder={t("cycle.log.notes_placeholder")} multiline />
      </ScrollView>

      {/* Pinned: the save sits outside the scrolling part, so it is always on screen. */}
      <CycleSaveNote state={feedback === "saved" ? "idle" : feedback} pending={0} />
      <CycleActionButton title={t("cycle.log.save")} onPress={() => void submit()} loading={submitting} />
    </View>
  );
}

/** S47d: the screen opens only once the person has said yes to reproductive health data; until then it asks. */
export function CycleScreen(props: CycleScreenProps) {
  return (
    <FeatureConsentGate dataType="reproductive" title="Your cycle">
      <CycleScreenInner {...props} />
    </FeatureConsentGate>
  );
}
