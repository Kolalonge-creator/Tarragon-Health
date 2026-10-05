import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { GLUCOSE_UNIT_LABEL } from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { useGlucoseDisplayUnit } from "@/lib/glucose-unit";
import { BP_THRESHOLDS, classifyBpLevel, type BpLevel, type BpThresholds } from "@/lib/bp-classification";
import { summariseTrend, windowReadings, type TrendWindowDays } from "@/lib/bp-trend";
import { loadActiveThresholds } from "@/lib/threshold-sync";
import { BP_CHECKLIST_SYMPTOMS, planBpLog, redFlagsAmong, type BpChecklistSymptom } from "@/lib/bp-checklist";
import { logBpWithExtras } from "@/lib/bp-log";
import { refreshApprovedRuleSet, refreshPatientFacts, resolveExpiredRecheck, type DeviceTriage } from "@/lib/triage-device";
import { loadBpSymptomChecklist, loadHomeProtocol } from "@/lib/s07-config";
import {
  validateOtherEntry,
  type GlucoseUnit,
  type OtherVitalType,
} from "@/lib/vitals-entry";
import {
  classifyVitalOffline,
  computeSevenDayAverage,
  loadRecentBpReadings,
  logOtherVital,
  type BpReading,
} from "@/lib/vitals";
import type { VitalReadingPayload } from "@/lib/api";
import { loadCachedEmergencyFacts, type EmergencyContact } from "@/lib/emergency";
import { clearDraft, loadDraft, saveDraft } from "@/lib/drafts";
import { space, radii, useTheme } from "@/ui/design";
import {
  AppText,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  InlineAlert,
  Icon,
  ListItem,
  Screen,
  SegmentedControl,
  Skeleton,
  SkeletonGroup,
  TrendChart,
  useToast,
  type BadgeTone,
} from "@/ui/kit";
import { EmergencyGuidanceModal } from "@/screens/emergency-guidance-modal";
import { MIN_READINGS_FOR_CHART, useTrendInsights } from "@/lib/use-trend-insights";
import { TrendInsightsCard } from "@/screens/sections/trend-insights-card";
import { SyncBanner } from "@/screens/sync-banner";
import { SymptomScreen } from "@/screens/sections/symptom-screen";
import { MonitoringCoverCard } from "@/screens/sections/monitoring-cover-card";
import { SymptomChecklist, TechniqueGuide } from "@/screens/sections/bp-extras";

// Versioned S07 values (rest time, gap between readings, severity recorded for a ticked symptom).
const HOME_PROTOCOL = loadHomeProtocol();
const SYMPTOM_CHECKLIST = loadBpSymptomChecklist();

interface GuidanceState {
  detail: string;
  synced: boolean;
}

interface VitalsScreenProps {
  patientId: string;
  /** Set when the signed-in user currently has this patient's account open
   * (lib/acting.ts), passed through to the write API so the reading is logged for
   * them, not the caller. Undefined when logging for yourself. */
  beneficiaryProfileId?: string;
}

const LEVEL_TONE: Record<BpLevel, BadgeTone> = {
  green: "positive",
  amber: "warn",
  red: "danger",
  emergency: "emergency",
  unknown: "neutral",
};

/** 30 days at up to four readings a day. */
const HISTORY_LIMIT = 120;

const OTHER_VITAL_TYPES: { id: OtherVitalType; unit: string }[] = [
  // Glucose's unit follows the patient's own toggle, see OtherVitalCard.
  { id: "glucose", unit: "mg/dL" },
  { id: "weight", unit: "kg" },
  { id: "temperature", unit: "°C" },
  { id: "spo2", unit: "%" },
  { id: "pulse", unit: "bpm" },
];

type GlucoseContext = Extract<VitalReadingPayload, { vital_type: "glucose" }>["glucose_context"];
const GLUCOSE_CONTEXTS: GlucoseContext[] = ["random", "fasting", "pre_meal", "post_meal", "bedtime", "night"];

/** Africa/Lagos, per the platform's fixed timezone rule. */
function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function VitalsScreen({ patientId, beneficiaryProfileId }: VitalsScreenProps) {
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const { colors } = useTheme();
  const toast = useToast();

  const [rawReadings, setRawReadings] = useState<BpReading[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [thresholds, setThresholds] = useState<BpThresholds>(BP_THRESHOLDS);
  const [windowDays, setWindowDays] = useState<TrendWindowDays>(7);
  const [selected, setSelected] = useState<BpReading | null>(null);

  const [sys, setSys] = useState("");
  const [dia, setDia] = useState("");
  const [pulse, setPulse] = useState("");
  const [ticked, setTicked] = useState<BpChecklistSymptom[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [urgentBanner, setUrgentBanner] = useState<string | null>(null);
  const [triageCard, setTriageCard] = useState<{ message: string; tone: "warn" | "info" } | null>(null);
  const [symptomOpen, setSymptomOpen] = useState(false);
  const [guidance, setGuidance] = useState<GuidanceState | null>(null);
  const [emergencyContact, setEmergencyContact] = useState<EmergencyContact | null>(null);

  // The governed engine's message for a reading (S12). Emergency guidance has its own full-screen modal, so it
  // never also becomes a card. Colour is always paired with the words in the message.
  const showTriage = useCallback(
    (d: DeviceTriage | null | undefined) => {
      if (!d || d.severity === "emergency" || !d.message) {
        setTriageCard(null);
        return;
      }
      const tone = d.result.status === "recheck_required" || d.result.grade === "amber" ? "warn" : "info";
      setTriageCard({ message: `${t(d.message.title as MessageKey, locale)}. ${t(d.message.body as MessageKey, locale)}`, tone });
    },
    [locale],
  );
  useEffect(() => {
    // A first elevated reading whose repeat never came is graded as if repeated (spec 6.2); and the rules are kept fresh.
    void refreshApprovedRuleSet();
    void refreshPatientFacts(patientId);
    void resolveExpiredRecheck(patientId)
      .then((d) => d && showTriage(d))
      .catch(() => {});
  }, [patientId, showTriage]);

  const load = useCallback(async () => {
    // Enough for a 30 day chart even for someone who logs several times a day.
    const list = await loadRecentBpReadings(patientId, HISTORY_LIMIT);
    setRawReadings(list);
    setNowMs(Date.now());
  }, [patientId]);

  const draftKey = `bp:${patientId}`;
  const draftRestored = useRef(false);
  useEffect(() => {
    void loadDraft<{ sys: string; dia: string; pulse?: string; symptoms?: string[] }>(draftKey).then((d) => {
      if (d) {
        setSys((cur) => cur || d.sys);
        setDia((cur) => cur || d.dia);
        setPulse((cur) => cur || d.pulse || "");
        // Only symptoms that are still on the checklist come back from a draft.
        setTicked((cur) => (cur.length > 0 ? cur : BP_CHECKLIST_SYMPTOMS.filter((s) => d.symptoms?.includes(s))));
      }
      draftRestored.current = true;
    });
  }, [draftKey]);
  // Saved on every change, so a power cut or a killed app loses nothing typed.
  useEffect(() => {
    if (!draftRestored.current) return;
    if (sys === "" && dia === "" && pulse === "" && ticked.length === 0) void clearDraft(draftKey);
    else void saveDraft(draftKey, { sys, dia, pulse, symptoms: ticked });
  }, [sys, dia, pulse, ticked, draftKey]);

  useEffect(() => {
    load()
      .catch(() => {})
      .finally(() => setLoading(false));
    loadActiveThresholds()
      .then((active) => setThresholds(active.bp))
      .catch(() => {});
    loadCachedEmergencyFacts()
      .then((facts) => setEmergencyContact(facts?.emergencyContact ?? null))
      .catch(() => {});
  }, [load, patientId]);

  // The status badge and the chart's reference lines must agree, so every reading is
  // rated against the same (server-synced) thresholds the chart draws.
  const readings = useMemo(
    () => rawReadings.map((r) => ({ ...r, level: classifyBpLevel(r.systolic, r.diastolic, thresholds) })),
    [rawReadings, thresholds]
  );
  const amber = thresholds.amber;

  // The chart clears its own highlight when the data or window changes; clear the readout too.
  useEffect(() => setSelected(null), [windowDays, readings]);

  async function handleSave() {
    const plan = planBpLog({ systolic: sys, diastolic: dia, pulse, symptoms: ticked }, SYMPTOM_CHECKLIST.severity);
    const symptomList = (list: readonly BpChecklistSymptom[]) => list.map((s) => tr(`vitals.symptom.${s}` as MessageKey)).join(", ");
    if (!plan.ok) {
      // An implausible reading (out of range, or the second number higher than the first) is rejected with the
      // TRI-006 message and never graded (spec 6.2). Entry that is not numbers keeps its own message.
      const implausible = plan.field === "bp" && (plan.error === "range" || plan.error === "order");
      setSaveError(implausible ? `${tr("triage.tri_006.title")}. ${tr("triage.tri_006.body")}` : null);
      setErrorKey(
        implausible
          ? null
          : plan.field === "pulse"
            ? (plan.error === "number" ? "vitals.error.pulse_number" : "vitals.error.pulse_range")
            : (`vitals.error.${plan.error}` as MessageKey)
      );
      // Guidance for a ticked red-flag symptom never waits for a valid reading: someone with chest
      // pain who has not typed the numbers (or mistyped them) still sees it. Nothing was saved, so
      // the guidance says plainly that the care team has not been told.
      const flagged = redFlagsAmong(ticked);
      if (flagged.length > 0) setGuidance({ detail: tr("vitals.guidance.symptom_detail", { symptoms: symptomList(flagged) }), synced: false });
      return;
    }
    setSaving(true);
    setErrorKey(null);
    setSaveError(null);
    setUrgentBanner(null);
    setTriageCard(null);

    // The emergency guidance and the urgent banner come from the on-device check and appear at
    // once, before anything is sent: a crisis-range reading or a red-flag symptom is dangerous
    // whether or not the save reaches the server.
    const symptomLabels = symptomList(plan.redFlagTicked);
    const result = await logBpWithExtras(plan, beneficiaryProfileId, undefined, (outcome) => {
      if (outcome.severity === "emergency") {
        const detail = outcome.symptomFlag
          ? tr("vitals.guidance.symptom_detail", { symptoms: symptomLabels })
          : (outcome.bpFlag?.detail ?? "");
        setGuidance({ detail, synced: false });
      } else if (outcome.severity === "urgent" && outcome.bpFlag) {
        setUrgentBanner(outcome.bpFlag.detail);
      }
      showTriage(outcome.device);
    });
    setSaving(false);
    if (result.error) {
      setSaveError(result.error);
      // Deliberately NOT clearing the emergency guidance here: a crisis-range
      // reading is dangerous whether or not it saved, and the modal's synced:false
      // copy already tells the patient honestly that the care team has not been
      // notified yet.
      return;
    }
    if (result.outcome.severity === "emergency") {
      setGuidance((cur) => (cur ? { ...cur, synced: !!result.syncedAll } : cur));
    }
    if (result.rejectedSupportCodes && result.rejectedSupportCodes.length > 0) {
      setSaveError(t("outbox.rejected", locale, { count: result.rejectedSupportCodes.length, code: result.rejectedSupportCodes[0] ?? "" }));
    }
    toast.show(result.syncedAll ? { message: tr("vitals.log.saved"), tone: "success" } : { message: t("outbox.saved_on_phone", locale), tone: "info" });
    setSys("");
    setDia("");
    setPulse("");
    setTicked([]);
    await load();
  }

  const latest = readings[0] ?? null;
  const average = computeSevenDayAverage(readings);
  const windowed = useMemo(() => windowReadings(readings, windowDays, nowMs), [readings, windowDays, nowMs]);
  const insights = useTrendInsights(patientId, readings, nowMs, windowDays);
  const summary = useMemo(() => summariseTrend(windowed), [windowed]);
  const chartSummary = summary
    ? tr("vitals.trend.summary", {
        days: windowDays,
        count: summary.count,
        minS: summary.minSystolic,
        maxS: summary.maxSystolic,
        minD: summary.minDiastolic,
        maxD: summary.maxDiastolic,
        latest: tr("vitals.a11y.reading", { systolic: summary.latest.systolic, diastolic: summary.latest.diastolic }),
      })
    : "";
  const levelLabel = (level: BpLevel) => tr(`vitals.level.${level}` as MessageKey);

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <AppText variant="headline" heading>
          {tr("vitals.title")}
        </AppText>
        <AppText variant="body" tone="textMuted">
          {tr("vitals.subtitle")}
        </AppText>
      </View>

      <SyncBanner />

      {/* Latest reading: the one number that matters most, then the 7 day average. */}
      <Card level={2} style={{ gap: space.sm }}>
        <AppText variant="label" tone="textMuted">
          {tr("vitals.latest.title")}
        </AppText>
        {loading ? (
          <SkeletonGroup label={tr("vitals.latest.title")}>
            <Skeleton width={160} height={44} />
            <Skeleton width={110} height={22} radius={radii.pill} style={{ marginTop: space.sm }} />
          </SkeletonGroup>
        ) : latest ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
              <AppText variant="hero" accessibilityLabel={tr("vitals.a11y.reading", { systolic: latest.systolic, diastolic: latest.diastolic })}>
                {latest.systolic}/{latest.diastolic}
              </AppText>
              <AppText variant="body" tone="textMuted">
                mmHg
              </AppText>
            </View>
            <Badge label={levelLabel(latest.level)} tone={LEVEL_TONE[latest.level]} />
            <AppText variant="caption" tone="textSubtle">
              {formatWhen(latest.takenAt)}
              {latest.pending ? ` · ${t("outbox.row_waiting", locale)}` : ""}
            </AppText>
            {average ? (
              <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm, marginTop: space.xs }}>
                <AppText variant="bodyStrong">
                  {tr("vitals.latest.average", { days: 7 })}: {average.systolic}/{average.diastolic}
                </AppText>
                <AppText variant="caption" tone="textMuted">
                  {average.readingCount === 1 ? tr("vitals.latest.average_one") : tr("vitals.latest.average_other", { count: average.readingCount })}
                </AppText>
              </View>
            ) : null}
          </>
        ) : (
          <EmptyState icon="vitals" title={tr("vitals.latest.empty_title")} body={tr("vitals.latest.empty_body")} />
        )}
      </Card>

      {/* Trend */}
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
          <AppText variant="title" heading>
            {tr("vitals.trend.title")}
          </AppText>
          <View style={{ width: 170 }}>
            <SegmentedControl
              accessibilityLabel={tr("vitals.trend.control")}
              value={windowDays}
              onChange={setWindowDays}
              options={[
                { value: 7, label: tr("vitals.trend.days_7") },
                { value: 30, label: tr("vitals.trend.days_30") },
              ]}
            />
          </View>
        </View>
        {loading ? (
          <SkeletonGroup label={tr("vitals.trend.title")}>
            <Skeleton height={200} radius={radii.md} />
          </SkeletonGroup>
        ) : windowed.length === 0 ? (
          <AppText variant="body" tone="textMuted">
            {tr("vitals.trend.empty_window", { days: windowDays })}
          </AppText>
        ) : insights.displayMode === "list" ? null : (
          <>
            <TrendChart
              readings={windowed}
              windowDays={windowDays}
              nowMs={nowMs}
              thresholds={{ amber }}
              summary={chartSummary}
              onSelect={setSelected}
              formatDay={formatDay}
            />
            <View accessibilityLiveRegion="polite" style={{ minHeight: 22 }}>
              <AppText variant="bodyStrong">
                {selected ? tr("vitals.trend.selected", { value: `${selected.systolic}/${selected.diastolic}`, when: formatWhen(selected.takenAt) }) : tr("vitals.trend.hint")}
              </AppText>
            </View>
            <View style={{ gap: space.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <View style={{ width: 14, height: 4, borderRadius: 2, backgroundColor: colors.brandText }} />
                <AppText variant="caption" tone="textMuted">
                  {tr("vitals.trend.legend_sys")}
                </AppText>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <View style={{ width: 14, height: 4, borderRadius: 2, backgroundColor: colors.textMuted }} />
                <AppText variant="caption" tone="textMuted">
                  {tr("vitals.trend.legend_dia")}
                </AppText>
              </View>
              <AppText variant="caption" tone="textSubtle">
                {tr("vitals.trend.legend_ref", { sys: amber.systolic, dia: amber.diastolic })}
              </AppText>
            </View>
          </>
        )}
      </Card>

      {/* What the readings add up to, as words and a per-day list. Shown even with too few readings for a chart. */}
      {!loading && windowed.length > 0 ? (
        <TrendInsightsCard insights={insights} tr={tr} minReadingsForChart={MIN_READINGS_FOR_CHART} targetKnowable={!beneficiaryProfileId} />
      ) : null}

      {/* Log a reading */}
      <Card style={{ gap: space.md }}>
        <AppText variant="title" heading>
          {tr("vitals.log.title")}
        </AppText>
        <TechniqueGuide tr={tr} protocol={HOME_PROTOCOL} />
        <View style={{ flexDirection: "row", gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Field label={tr("vitals.log.systolic")} hint={tr("vitals.log.systolic_hint")} keyboardType="number-pad" value={sys} onChangeText={setSys} returnKeyType="next" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label={tr("vitals.log.diastolic")} hint={tr("vitals.log.diastolic_hint")} keyboardType="number-pad" value={dia} onChangeText={setDia} />
          </View>
        </View>
        <Field label={tr("vitals.log.pulse")} hint={tr("vitals.log.pulse_hint")} keyboardType="number-pad" value={pulse} onChangeText={setPulse} />
        <SymptomChecklist
          tr={tr}
          selected={ticked}
          onToggle={(sym) => setTicked((cur) => (cur.includes(sym) ? cur.filter((x) => x !== sym) : [...cur, sym]))}
        />
        {errorKey ? <InlineAlert tone="danger" message={tr(errorKey)} /> : null}
        {saveError ? <InlineAlert tone="danger" message={saveError} /> : null}
        {urgentBanner ? <InlineAlert tone="warn" message={urgentBanner} /> : null}
        {triageCard ? <InlineAlert tone={triageCard.tone} message={triageCard.message} /> : null}
        <Button title={tr("vitals.log.save")} onPress={handleSave} loading={saving} />
      </Card>

      <OtherVitalCard beneficiaryProfileId={beneficiaryProfileId} onEmergency={(detail, synced) => setGuidance({ detail, synced })} />

      {/* Recent readings */}
      <View style={{ gap: space.sm }}>
        <AppText variant="title" heading>
          {tr("vitals.recent.title")}
        </AppText>
        {loading ? (
          <SkeletonGroup label={tr("vitals.recent.title")}>
            <Card padded={false}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={{ padding: space.lg, gap: space.xs }}>
                  <Skeleton width={120} height={16} />
                  <Skeleton width={180} height={12} />
                </View>
              ))}
            </Card>
          </SkeletonGroup>
        ) : readings.length === 0 ? (
          <Card>
            <AppText variant="body" tone="textMuted">
              {tr("vitals.recent.empty")}
            </AppText>
          </Card>
        ) : (
          <Card padded={false}>
            {readings.slice(0, 10).map((r, i) => (
              <View key={r.id} style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}>
                <ListItem
                  title={`${r.systolic}/${r.diastolic} mmHg`}
                  subtitle={`${formatWhen(r.takenAt)}${r.pending ? ` · ${t("outbox.row_waiting", locale)}` : ""}`}
                  trailing={<Badge label={levelLabel(r.level)} tone={LEVEL_TONE[r.level]} />}
                />
              </View>
            ))}
          </Card>
        )}
      </View>

      <MonitoringCoverCard />

      {/* Symptoms */}
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Icon name="heart" size={20} tone="brandText" />
          <AppText variant="title" heading style={{ flex: 1 }}>
            {tr("vitals.symptom.title")}
          </AppText>
        </View>
        <AppText variant="body" tone="textMuted">
          {tr("vitals.symptom.body")}
        </AppText>
        <Button title={tr("vitals.symptom.cta")} variant="secondary" onPress={() => setSymptomOpen(true)} />
      </Card>

      <Modal visible={symptomOpen} animationType="slide" onRequestClose={() => setSymptomOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.canvas }}>
          <View style={{ padding: space.xl, paddingTop: 56 }}>
            <Button title={tr("vitals.symptom.close")} variant="secondary" onPress={() => setSymptomOpen(false)} />
          </View>
          <SymptomScreen patientId={patientId} beneficiaryProfileId={beneficiaryProfileId} />
        </View>
      </Modal>

      <EmergencyGuidanceModal
        visible={guidance !== null}
        detail={guidance?.detail ?? ""}
        synced={guidance?.synced ?? false}
        emergencyContact={emergencyContact}
        onDismiss={() => setGuidance(null)}
      />
    </Screen>
  );
}

/** Glucose, weight, temperature, SpO2, pulse: the rest of the native quick-log list,
 * alongside the always-visible BP card above (BP stays its own card since it is the
 * highest-frequency write). */
function OtherVitalCard({
  beneficiaryProfileId,
  onEmergency,
}: {
  beneficiaryProfileId?: string;
  onEmergency: (detail: string, synced: boolean) => void;
}) {
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const toast = useToast();
  const [type, setType] = useState<OtherVitalType>("glucose");
  const [value, setValue] = useState("");
  // Defaults to the unit this patient's own meter reads (see lib/glucose-unit.ts). It
  // arrives asynchronously, so it seeds the field only while the patient has not
  // already touched the toggle themselves; otherwise the preference landing a moment
  // later would yank the unit out from under a deliberate choice mid-entry.
  const preferredUnit = useGlucoseDisplayUnit();
  const [glucoseUnit, setGlucoseUnit] = useState<GlucoseUnit>(preferredUnit);
  const [unitTouched, setUnitTouched] = useState(false);
  useEffect(() => {
    if (!unitTouched) setGlucoseUnit(preferredUnit);
  }, [preferredUnit, unitTouched]);
  const [glucoseContext, setGlucoseContext] = useState<GlucoseContext>("random");
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [urgentBanner, setUrgentBanner] = useState<string | null>(null);

  const unit = type === "glucose" ? GLUCOSE_UNIT_LABEL[glucoseUnit] : OTHER_VITAL_TYPES.find((v) => v.id === type)!.unit;

  function resetForNewType(next: OtherVitalType) {
    setType(next);
    setValue("");
    setErrorKey(null);
    setSaveError(null);
    setUrgentBanner(null);
  }

  async function handleSave() {
    const entry = validateOtherEntry(type, value, glucoseUnit);
    if (!entry.ok) {
      setSaveError(null);
      setErrorKey(`vitals.other.error.${entry.error}` as MessageKey);
      return;
    }
    const numeric = entry.value;
    setSaving(true);
    setErrorKey(null);
    setSaveError(null);
    setUrgentBanner(null);

    let payload: Exclude<VitalReadingPayload, { vital_type: "blood_pressure" }>;
    switch (type) {
      case "glucose":
        payload = { vital_type: "glucose", glucose_value: numeric, glucose_unit: glucoseUnit, glucose_context: glucoseContext };
        break;
      case "weight":
        payload = { vital_type: "weight", weight_kg: numeric };
        break;
      case "temperature":
        payload = { vital_type: "temperature", temperature_c: numeric };
        break;
      case "spo2":
        payload = { vital_type: "spo2", spo2_pct: numeric };
        break;
      case "pulse":
        payload = { vital_type: "pulse", pulse_bpm: numeric };
        break;
    }

    // Only glucose has an offline red-flag path today (see classifyVitalOffline):
    // weight, temperature, SpO2 and pulse still get the offline write queue below,
    // just no on-device guidance or banner.
    const flag = type === "glucose" ? await classifyVitalOffline(payload) : null;
    if (flag?.severity === "emergency") onEmergency(flag.detail, false);
    if (flag?.severity === "urgent") setUrgentBanner(flag.detail);

    const result = await logOtherVital(payload, beneficiaryProfileId);
    setSaving(false);
    if (result.error) {
      setSaveError(result.error);
      return;
    }
    if (flag?.severity === "emergency") onEmergency(flag.detail, !!result.synced);
    toast.show(
      result.synced
        ? { message: tr("vitals.other.saved", { value, unit }), tone: "success" }
        : { message: t("outbox.saved_on_phone", locale), tone: "info" }
    );
    setValue("");
  }

  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title" heading>
        {tr("vitals.other.title")}
      </AppText>

      <View accessibilityRole="radiogroup" accessibilityLabel={tr("vitals.other.group")} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {OTHER_VITAL_TYPES.map((v) => (
          <Chip key={v.id} label={tr(`vitals.type.${v.id}` as MessageKey)} selected={type === v.id} onPress={() => resetForNewType(v.id)} />
        ))}
      </View>

      <Field label={tr("vitals.other.value_label", { unit })} keyboardType="decimal-pad" value={value} onChangeText={setValue} />

      {type === "glucose" ? (
        <>
          <SegmentedControl
            accessibilityLabel={tr("vitals.glucose.unit_a11y", {
              current: glucoseUnit === "mmol_l" ? tr("vitals.glucose.mmol_name") : tr("vitals.glucose.mgdl_name"),
              other: glucoseUnit === "mmol_l" ? tr("vitals.glucose.mgdl_name") : tr("vitals.glucose.mmol_name"),
            })}
            value={glucoseUnit}
            onChange={(next) => {
              setUnitTouched(true);
              setGlucoseUnit(next);
            }}
            options={[
              { value: "mmol_l" as GlucoseUnit, label: "mmol/L" },
              { value: "mg_dl" as GlucoseUnit, label: "mg/dL" },
            ]}
          />
          <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {GLUCOSE_CONTEXTS.map((c) => {
              const label = tr(`vitals.glucose.context.${c}` as MessageKey);
              return (
                <Chip
                  key={c}
                  label={label}
                  accessibilityLabel={tr("vitals.glucose.context_a11y", { label })}
                  selected={glucoseContext === c}
                  onPress={() => setGlucoseContext(c)}
                />
              );
            })}
          </View>
        </>
      ) : null}

      {errorKey ? <InlineAlert tone="danger" message={tr(errorKey)} /> : null}
      {saveError ? <InlineAlert tone="danger" message={saveError} /> : null}
      {urgentBanner ? <InlineAlert tone="warn" message={urgentBanner} /> : null}
      <Button title={tr("vitals.other.save")} onPress={handleSave} loading={saving} />
    </Card>
  );
}
