import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { BP_LEVEL_COLORS, BP_LEVEL_LABEL } from "@/lib/bp-classification";
import {
  classifyVitalOffline,
  computeSevenDayAverage,
  loadPatientState,
  loadRecentBpReadings,
  logBpReading,
  logOtherVital,
  type BpReading,
} from "@/lib/vitals";
import type { VitalReadingPayload } from "@/lib/api";
import { getPendingCount } from "@/lib/offline-vitals-queue";
import { loadCachedEmergencyFacts, type EmergencyContact } from "@/lib/emergency";
import { colors, inkAlpha, radius, spacing } from "@/ui/theme";
import {
  CalloutCard,
  Card,
  ErrorText,
  GroupedList,
  GroupedListRow,
  MutedText,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
} from "@/ui/components";
import { WebViewScreen } from "@/screens/webview-screen";
import { EmergencyGuidanceModal } from "@/screens/emergency-guidance-modal";

interface GuidanceState {
  detail: string;
  synced: boolean;
}

function UrgentBanner({ detail }: { detail: string }) {
  return (
    <View
      style={{
        backgroundColor: colors.status.warnBg,
        borderRadius: radius.control,
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <Text style={{ fontSize: 12.5, color: colors.status.warn, lineHeight: 18 }}>{detail}</Text>
    </View>
  );
}

interface VitalsScreenProps {
  patientId: string;
  /** Set when the signed-in user currently has this patient's account open
   * (lib/acting.ts) — passed through to the write API so the reading is
   * logged for them, not the caller. Undefined when logging for yourself. */
  beneficiaryProfileId?: string;
}

const inputStyle = {
  flex: 1,
  height: 38,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 10,
  fontSize: 14,
  color: colors.ink,
} as const;

type OtherVitalType = "glucose" | "weight" | "temperature" | "spo2" | "pulse";

const OTHER_VITAL_TYPES: { id: OtherVitalType; label: string; unit: string }[] = [
  { id: "glucose", label: "Glucose", unit: "mmol/L" },
  { id: "weight", label: "Weight", unit: "kg" },
  { id: "temperature", label: "Temperature", unit: "°C" },
  { id: "spo2", label: "SpO2", unit: "%" },
  { id: "pulse", label: "Pulse", unit: "bpm" },
];

type GlucoseContext = Extract<VitalReadingPayload, { vital_type: "glucose" }>["glucose_context"];

const GLUCOSE_CONTEXTS: { id: GlucoseContext; label: string }[] = [
  { id: "random", label: "Random" },
  { id: "fasting", label: "Fasting" },
  { id: "pre_meal", label: "Before meal" },
  { id: "post_meal", label: "After meal" },
  { id: "bedtime", label: "Bedtime" },
  { id: "night", label: "Night" },
];

/** Strict Number() parse: trims, accepts a comma decimal separator (some
 * Android decimal-pads emit one), rejects empty input and trailing garbage
 * ("12abc" is null here, not 12 as with parseInt), rejects NaN/Infinity. */
function parseStrictNumber(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (normalized === "") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Entry-time plausibility bounds — typo gating only, NOT clinical logic.
 * Deliberately far wider than any classification threshold (bp-classification
 * .ts, glucose-red-flags.ts), so a genuinely dangerous reading always
 * submits and still triggers the existing emergency guidance; only values no
 * live human could produce are stopped. Each carries its own warm inline
 * message so the fix is obvious without fear-based wording.
 */
const BP_BOUNDS = {
  systolic: { min: 40, max: 300 },
  diastolic: { min: 20, max: 200 },
} as const;

const OTHER_VITAL_BOUNDS: Record<Exclude<OtherVitalType, "glucose">, { min: number; max: number; message: string }> = {
  weight: {
    min: 2,
    max: 500,
    message: "That doesn't look like a usual weight in kg. Check the number and try again?",
  },
  temperature: {
    min: 30,
    max: 45,
    message: "That doesn't look like a usual body temperature in °C. Check the number and try again?",
  },
  spo2: {
    min: 40,
    max: 100,
    message: "SpO2 is a percentage, up to 100. Check the number and try again?",
  },
  pulse: {
    min: 20,
    max: 300,
    message: "That doesn't look like a usual pulse. Check the number and try again?",
  },
};

/** A glucose value out of range for one unit is very often a correct value
 * in the other (mg/dL is 18x mmol/L), so the message points at the unit
 * toggle rather than just saying "too high" — a mg/dL number submitted as
 * mmol/L would otherwise fire the emergency modal on a plain typo. */
const GLUCOSE_BOUNDS: Record<"mmol_l" | "mg_dl", { min: number; max: number; message: string }> = {
  mmol_l: {
    min: 0.5,
    max: 55,
    message: "That looks unusual for mmol/L. If your meter shows mg/dL, switch the unit and try again?",
  },
  mg_dl: {
    min: 10,
    max: 1000,
    message: "That looks unusual for mg/dL. If your meter shows mmol/L, switch the unit and try again?",
  },
};

export function VitalsScreen({ patientId, beneficiaryProfileId }: VitalsScreenProps) {
  const [readings, setReadings] = useState<BpReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [sys, setSys] = useState("");
  const [dia, setDia] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symptomOpen, setSymptomOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [guidance, setGuidance] = useState<GuidanceState | null>(null);
  const [urgentBanner, setUrgentBanner] = useState<string | null>(null);
  const [emergencyContact, setEmergencyContact] = useState<EmergencyContact | null>(null);
  const [patientState, setPatientState] = useState<string | null>(null);

  const load = useCallback(async () => {
    setReadings(await loadRecentBpReadings(patientId));
  }, [patientId]);

  const refreshPending = useCallback(async () => {
    setPendingCount(await getPendingCount());
  }, []);

  useEffect(() => {
    load()
      .catch(() => {})
      .finally(() => setLoading(false));
    refreshPending().catch(() => {});
    loadCachedEmergencyFacts()
      .then((facts) => setEmergencyContact(facts?.emergencyContact ?? null))
      .catch(() => {});
    // Best-effort — already null on failure/offline, which resolves to the
    // national emergency line in EmergencyGuidanceModal either way.
    loadPatientState(patientId).then(setPatientState);
  }, [load, refreshPending, patientId]);

  async function handleSave() {
    const systolic = parseStrictNumber(sys);
    const diastolic = parseStrictNumber(dia);
    if (systolic === null || diastolic === null) {
      setError("Enter both numbers, using digits only.");
      return;
    }
    if (
      systolic < BP_BOUNDS.systolic.min ||
      systolic > BP_BOUNDS.systolic.max ||
      diastolic < BP_BOUNDS.diastolic.min ||
      diastolic > BP_BOUNDS.diastolic.max
    ) {
      setError("That doesn't look like a usual blood pressure reading. Check the numbers and try again?");
      return;
    }
    if (systolic <= diastolic) {
      setError("The first (systolic) number is usually the higher one. Check which number is which and try again?");
      return;
    }
    setSaving(true);
    setError(null);
    setUrgentBanner(null);

    const payload: VitalReadingPayload = { vital_type: "blood_pressure", systolic, diastolic };
    const flag = await classifyVitalOffline(payload);
    if (flag?.severity === "emergency") setGuidance({ detail: flag.detail, synced: false });
    if (flag?.severity === "urgent") setUrgentBanner(flag.detail);

    const result = await logBpReading(systolic, diastolic, beneficiaryProfileId);
    setSaving(false);
    await refreshPending();
    if (result.error) {
      setError(result.error);
      // Deliberately NOT clearing the emergency guidance here: a crisis-range
      // reading is dangerous whether or not it saved, and the modal's
      // synced:false copy already tells the patient honestly that the care
      // team hasn't been notified yet.
      return;
    }
    if (flag?.severity === "emergency") setGuidance({ detail: flag.detail, synced: !!result.synced });
    setSys("");
    setDia("");
    await load();
  }

  const average = computeSevenDayAverage(readings);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Vitals &amp; symptoms</Text>
        <MutedText>Log readings and see how they trend over time.</MutedText>
      </View>

      {pendingCount > 0 ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: colors.groupBg,
            borderRadius: radius.control,
            paddingVertical: 8,
            paddingHorizontal: 12,
          }}
        >
          <ActivityIndicator size="small" color={colors.muted} />
          <Text style={{ fontSize: 12.5, color: colors.muted }}>
            {pendingCount} reading{pendingCount === 1 ? "" : "s"} saved on this device, waiting to sync.
          </Text>
        </View>
      ) : null}

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>Log a blood pressure reading</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <TextInput
            placeholder="Systolic"
            placeholderTextColor={colors.faint}
            keyboardType="number-pad"
            value={sys}
            onChangeText={setSys}
            style={inputStyle}
          />
          <TextInput
            placeholder="Diastolic"
            placeholderTextColor={colors.faint}
            keyboardType="number-pad"
            value={dia}
            onChangeText={setDia}
            style={inputStyle}
          />
        </View>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {urgentBanner ? <UrgentBanner detail={urgentBanner} /> : null}
        <PrimaryButton title="Save reading" onPress={handleSave} loading={saving} />
      </Card>

      {average ? (
        <Card style={{ gap: 4 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>Your 7-day home BP average</Text>
          <Text style={{ fontSize: 24, fontWeight: "700", color: colors.ink }}>
            {average.systolic}/{average.diastolic} <Text style={{ fontSize: 12, fontWeight: "400", color: colors.faint }}>mmHg</Text>
          </Text>
          <MutedText>Average of {average.readingCount} reading{average.readingCount === 1 ? "" : "s"} over the last 7 days.</MutedText>
        </Card>
      ) : null}

      <View style={{ gap: 10 }}>
        <SectionLabel>Recent readings</SectionLabel>
        {loading ? (
          <ActivityIndicator color={colors.brand} />
        ) : readings.length === 0 ? (
          <Card>
            <MutedText>No readings logged yet.</MutedText>
          </Card>
        ) : (
          <GroupedList>
            {readings.map((r) => {
              const c = BP_LEVEL_COLORS[r.level];
              return (
                <GroupedListRow
                  key={r.id}
                  title={`${r.systolic}/${r.diastolic} mmHg`}
                  subtitle={new Date(r.takenAt).toLocaleString()}
                  trailing={
                    <View style={{ backgroundColor: c.bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: c.text }}>{BP_LEVEL_LABEL[r.level]}</Text>
                    </View>
                  }
                />
              );
            })}
          </GroupedList>
        )}
      </View>

      <OtherVitalCard
        beneficiaryProfileId={beneficiaryProfileId}
        onLogged={async () => {
          await refreshPending();
        }}
        onEmergency={(detail, synced) => setGuidance({ detail, synced })}
      />

      <CalloutCard
        icon="clipboard-outline"
        title="Log a symptom"
        subtitle="Symptom logging opens in the full patient app."
        ctaLabel="Log a symptom"
        onPress={() => setSymptomOpen(true)}
      />

      <Modal visible={symptomOpen} animationType="slide" onRequestClose={() => setSymptomOpen(false)}>
        <View style={{ flex: 1 }}>
          <View style={{ padding: spacing.screen, paddingTop: 56 }}>
            <SecondaryButton title="Close" onPress={() => setSymptomOpen(false)} />
          </View>
          <WebViewScreen path="/patient/vitals" />
        </View>
      </Modal>

      <EmergencyGuidanceModal
        visible={guidance !== null}
        detail={guidance?.detail ?? ""}
        synced={guidance?.synced ?? false}
        emergencyContact={emergencyContact}
        state={patientState}
        onDismiss={() => setGuidance(null)}
      />
    </ScrollView>
  );
}

/** Glucose, weight, temperature, SpO2, pulse — the rest of MOBILE_APP_SPEC.md
 * §2.2's native quick-log list, alongside the always-visible BP card above
 * (BP stays its own card since it's the highest-frequency write). */
function OtherVitalCard({
  beneficiaryProfileId,
  onLogged,
  onEmergency,
}: {
  beneficiaryProfileId?: string;
  onLogged: () => void;
  onEmergency: (detail: string, synced: boolean) => void;
}) {
  const [type, setType] = useState<OtherVitalType>("glucose");
  const [value, setValue] = useState("");
  const [glucoseUnit, setGlucoseUnit] = useState<"mmol_l" | "mg_dl">("mmol_l");
  const [glucoseContext, setGlucoseContext] = useState<GlucoseContext>("random");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);
  const [urgentBanner, setUrgentBanner] = useState<string | null>(null);

  const selected = OTHER_VITAL_TYPES.find((t) => t.id === type)!;

  function resetForNewType(next: OtherVitalType) {
    setType(next);
    setValue("");
    setError(null);
    setSavedLabel(null);
    setUrgentBanner(null);
  }

  async function handleSave() {
    const numeric = parseStrictNumber(value);
    if (numeric === null) {
      setError("Enter a value, using digits only.");
      return;
    }
    const bounds = type === "glucose" ? GLUCOSE_BOUNDS[glucoseUnit] : OTHER_VITAL_BOUNDS[type];
    if (numeric < bounds.min || numeric > bounds.max) {
      setError(bounds.message);
      return;
    }
    setSaving(true);
    setError(null);
    setSavedLabel(null);
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

    // Only glucose has an offline red-flag path today (see
    // classifyVitalOffline) — weight/temperature/spo2/pulse still get the
    // offline write queue below, just no on-device guidance/banner.
    const flag = type === "glucose" ? await classifyVitalOffline(payload) : null;
    if (flag?.severity === "emergency") onEmergency(flag.detail, false);
    if (flag?.severity === "urgent") setUrgentBanner(flag.detail);

    const result = await logOtherVital(payload, beneficiaryProfileId);
    setSaving(false);
    onLogged();
    if (result.error) {
      setError(result.error);
      return;
    }
    if (flag?.severity === "emergency") onEmergency(flag.detail, !!result.synced);
    setSavedLabel(`Saved: ${value} ${selected.unit}`);
    setValue("");
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>Log another vital</Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {OTHER_VITAL_TYPES.map((t) => (
          <Pressable
            key={t.id}
            accessibilityRole="radio"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: type === t.id, checked: type === t.id }}
            hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
            onPress={() => resetForNewType(t.id)}
            style={{
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderRadius: 999,
              backgroundColor: type === t.id ? colors.brand : inkAlpha(0.05),
            }}
          >
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: type === t.id ? "#FFFFFF" : colors.muted }}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <TextInput
          placeholder={`Value (${selected.unit})`}
          placeholderTextColor={colors.faint}
          keyboardType="decimal-pad"
          value={value}
          onChangeText={setValue}
          style={inputStyle}
        />
        {type === "glucose" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Glucose unit: ${glucoseUnit === "mmol_l" ? "millimoles per litre" : "milligrams per decilitre"}. Switches to ${glucoseUnit === "mmol_l" ? "milligrams per decilitre" : "millimoles per litre"}.`}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            onPress={() => setGlucoseUnit((u) => (u === "mmol_l" ? "mg_dl" : "mmol_l"))}
            style={{
              height: 38,
              paddingHorizontal: 12,
              borderRadius: radius.control,
              borderWidth: 1,
              borderColor: colors.border,
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>
              {glucoseUnit === "mmol_l" ? "mmol/L" : "mg/dL"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {type === "glucose" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {GLUCOSE_CONTEXTS.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="radio"
              accessibilityLabel={`${c.label} glucose reading`}
              accessibilityState={{ selected: glucoseContext === c.id, checked: glucoseContext === c.id }}
              hitSlop={{ top: 9, bottom: 9, left: 2, right: 2 }}
              onPress={() => setGlucoseContext(c.id)}
              style={{
                paddingVertical: 5,
                paddingHorizontal: 10,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: glucoseContext === c.id ? colors.brand : colors.border,
              }}
            >
              <Text
                style={{
                  fontSize: 11.5,
                  fontWeight: "600",
                  color: glucoseContext === c.id ? colors.brand : colors.muted,
                }}
              >
                {c.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}
      {savedLabel ? <MutedText>{savedLabel}</MutedText> : null}
      {urgentBanner ? <UrgentBanner detail={urgentBanner} /> : null}
      <PrimaryButton title="Save reading" onPress={handleSave} loading={saving} />
    </Card>
  );
}
