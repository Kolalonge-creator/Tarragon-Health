import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { loadTodaysDoses, logDose, type DoseChecklistItem, type DoseStatus } from "@/lib/medications";
import { syncDoseReminders } from "@/lib/dose-reminders";
import { colors, spacing } from "@/ui/theme";
import { Card, MutedText, SecondaryButton } from "@/ui/components";
import { WebViewScreen } from "@/screens/webview-screen";

interface MedicationsScreenProps {
  patientId: string;
  organisationId: string;
}

export function MedicationsScreen({ patientId, organisationId }: MedicationsScreenProps) {
  const [doses, setDoses] = useState<DoseChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cabinetOpen, setCabinetOpen] = useState(false);

  const load = useCallback(async () => {
    const today = await loadTodaysDoses(patientId);
    setDoses(today);
    void syncDoseReminders(today);
  }, [patientId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function toggle(item: DoseChecklistItem) {
    const nextStatus: Exclude<DoseStatus, "pending"> = item.status === "taken" ? "missed" : "taken";
    // Optimistic — this is the highest-frequency native write in the app.
    const next: DoseChecklistItem[] = doses.map((d) => (d === item ? { ...d, status: nextStatus } : d));
    setDoses(next);
    void syncDoseReminders(next);
    const result = await logDose(patientId, organisationId, item, nextStatus);
    if (result.error) await load();
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Medications</Text>
        <MutedText>Today&apos;s doses and your medicines cabinet.</MutedText>
      </View>

      <Card style={{ gap: 4 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink, marginBottom: 6 }}>Today&apos;s doses</Text>
        {loading ? (
          <ActivityIndicator color={colors.brand} />
        ) : doses.length === 0 ? (
          <MutedText>No scheduled doses today.</MutedText>
        ) : (
          doses.map((item, i) => (
            <Pressable
              key={`${item.medicationId}-${item.time}`}
              accessibilityRole="button"
              onPress={() => toggle(item)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingVertical: 8,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: colors.border,
              }}
            >
              {item.status === "taken" ? (
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="checkmark" size={13} color="#fff" />
                </View>
              ) : (
                <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "rgba(23,23,23,0.15)" }} />
              )}
              <View>
                <Text style={{ fontSize: 13.5, fontWeight: "500", color: colors.ink }}>{item.drugName}</Text>
                <Text style={{ fontSize: 11.5, color: colors.faint }}>{item.time}</Text>
              </View>
            </Pressable>
          ))
        )}
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>Your medicines cabinet</Text>
        <MutedText>Active medications, refill status, and &quot;check my pack&quot; open in the full patient app.</MutedText>
        <SecondaryButton title="Open medicines cabinet" onPress={() => setCabinetOpen(true)} />
      </Card>

      <Modal visible={cabinetOpen} animationType="slide" onRequestClose={() => setCabinetOpen(false)}>
        <View style={{ flex: 1 }}>
          <View style={{ padding: spacing.screen, paddingTop: 56 }}>
            <SecondaryButton title="Close" onPress={() => setCabinetOpen(false)} />
          </View>
          <WebViewScreen path="/patient/medications" />
        </View>
      </Modal>
    </ScrollView>
  );
}
