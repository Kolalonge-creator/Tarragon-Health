import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, View } from "react-native";
import { BP_LEVEL_COLORS, BP_LEVEL_LABEL } from "@/lib/bp-classification";
import { computeSevenDayAverage, loadRecentBpReadings, logBpReading, type BpReading } from "@/lib/vitals";
import { colors, radius, spacing } from "@/ui/theme";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";
import { WebViewScreen } from "@/screens/webview-screen";

interface VitalsScreenProps {
  patientId: string;
}

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
