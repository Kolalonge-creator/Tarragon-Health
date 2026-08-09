import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { BP_LEVEL_COLORS, BP_LEVEL_LABEL } from "@/lib/bp-classification";
import {
  computeSevenDayAverage,
  loadRecentBpReadings,
  logBpReading,
  logOtherVital,
  type BpReading,
} from "@/lib/vitals";
import type { VitalReadingPayload } from "@/lib/api";
import { colors, radius, spacing } from "@/ui/theme";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";
import { WebViewScreen } from "@/screens/webview-screen";

interface VitalsScreenProps {
  patientId: string;
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

export function VitalsScreen({ patientId }: VitalsScreenProps) {
  const [readings, setReadings] = useState<BpReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [sys, setSys] = useState("");
  const [dia, setDia] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symptomOpen, setSymptomOpen] = useState(false);

  const load = useCallback(async () => {
    setReadings(await loadRecentBpReadings(patientId));
  }, [patientId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function handleSave() {
    const systolic = parseInt(sys, 10);
    const diastolic = parseInt(dia, 10);
    if (!systolic || !diastolic) {
      setError("Enter both numbers.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await logBpReading(systolic, diastolic);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
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

      <Card style={{ gap: 4 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink, marginBottom: 6 }}>Recent readings</Text>
        {loading ? (
          <ActivityIndicator color={colors.brand} />
        ) : readings.length === 0 ? (
          <MutedText>No readings logged yet.</MutedText>
        ) : (
          readings.map((r, i) => {
            const c = BP_LEVEL_COLORS[r.level];
            return (
              <View
                key={r.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 8,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                }}
              >
                <View>
                  <Text style={{ fontSize: 13, fontWeight: "500", color: colors.ink }}>
                    {r.systolic}/{r.diastolic} mmHg
                  </Text>
                  <Text style={{ fontSize: 11.5, color: colors.faint }}>{new Date(r.takenAt).toLocaleString()}</Text>
                </View>
                <View style={{ backgroundColor: c.bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: c.text }}>{BP_LEVEL_LABEL[r.level]}</Text>
                </View>
              </View>
            );
          })
        )}
      </Card>

      <OtherVitalCard />

      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>Log a symptom</Text>
        <MutedText>Symptom logging opens in the full patient app.</MutedText>
        <SecondaryButton title="Log a symptom" onPress={() => setSymptomOpen(true)} />
      </Card>

      <Modal visible={symptomOpen} animationType="slide" onRequestClose={() => setSymptomOpen(false)}>
        <View style={{ flex: 1 }}>
          <View style={{ padding: spacing.screen, paddingTop: 56 }}>
            <SecondaryButton title="Close" onPress={() => setSymptomOpen(false)} />
          </View>
          <WebViewScreen path="/patient/vitals" />
        </View>
      </Modal>
    </ScrollView>
  );
}

/** Glucose, weight, temperature, SpO2, pulse — the rest of MOBILE_APP_SPEC.md
 * §2.2's native quick-log list, alongside the always-visible BP card above
 * (BP stays its own card since it's the highest-frequency write). */
function OtherVitalCard() {
  const [type, setType] = useState<OtherVitalType>("glucose");
  const [value, setValue] = useState("");
  const [glucoseUnit, setGlucoseUnit] = useState<"mmol_l" | "mg_dl">("mmol_l");
  const [glucoseContext, setGlucoseContext] = useState<GlucoseContext>("random");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  const selected = OTHER_VITAL_TYPES.find((t) => t.id === type)!;

  function resetForNewType(next: OtherVitalType) {
    setType(next);
    setValue("");
    setError(null);
    setSavedLabel(null);
  }

  async function handleSave() {
    const numeric = parseFloat(value);
    if (!numeric || numeric <= 0) {
      setError("Enter a value.");
      return;
    }
    setSaving(true);
    setError(null);
    setSavedLabel(null);

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

    const result = await logOtherVital(payload);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
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
            onPress={() => resetForNewType(t.id)}
            style={{
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderRadius: 999,
              backgroundColor: type === t.id ? colors.brand : "rgba(23,23,23,0.05)",
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
      <PrimaryButton title="Save reading" onPress={handleSave} loading={saving} />
    </Card>
  );
}
