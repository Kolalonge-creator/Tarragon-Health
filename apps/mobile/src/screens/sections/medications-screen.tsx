import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { loadTodaysDoses, logDose, type DoseChecklistItem, type DoseStatus } from "@/lib/medications";
import { syncDoseReminders } from "@/lib/dose-reminders";
import { colors, inkAlpha, spacing } from "@/ui/theme";
import { CalloutCard, Card, GroupedList, GroupedListRow, MutedText, SecondaryButton, SectionLabel } from "@/ui/components";
import { WebViewScreen } from "@/screens/webview-screen";

interface MedicationsScreenProps {
  patientId: string;
  organisationId: string;
  /** Set to the supported person's name when acting for someone
   * (home-shell.tsx), so the heading never implies these are the device
   * owner's own doses while marking somebody else's. */
  subjectName?: string;
}

export function MedicationsScreen({ patientId, organisationId, subjectName }: MedicationsScreenProps) {
  const [doses, setDoses] = useState<DoseChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed dose fetch must never render as "No scheduled doses today" —
  // that reads as a clinical fact. loadError renders an explicit retry
  // state in place of both the list and the empty state.
  const [loadError, setLoadError] = useState(false);
  const [cabinetOpen, setCabinetOpen] = useState(false);
  // medication_logs is append-only (20260830224528): a rapid double-tap used
  // to converge to one upserted row for the same slot; now each tap is its
  // own permanent row, so a double-tap here would leave a duplicate in the
  // clinician's dose log history rather than being harmlessly absorbed.
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  // Per-row save failures — the optimistic tick used to just silently
  // revert, which reads as the app ignoring the tap.
  const [rowErrors, setRowErrors] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const result = await loadTodaysDoses(patientId);
    if (!result.ok) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setDoses(result.data);
    void syncDoseReminders(result.data);
  }, [patientId]);

  useEffect(() => {
    load()
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [load]);

  function retryLoad() {
    setLoading(true);
    load()
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }

  async function toggle(item: DoseChecklistItem) {
    const key = `${item.medicationId}-${item.time}`;
    if (pendingKeys.has(key)) return;
    setPendingKeys((prev) => new Set(prev).add(key));
    setRowErrors((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

    const nextStatus: Exclude<DoseStatus, "pending"> = item.status === "taken" ? "missed" : "taken";
    // Optimistic — this is the highest-frequency native write in the app.
    const next: DoseChecklistItem[] = doses.map((d) => (d === item ? { ...d, status: nextStatus } : d));
    setDoses(next);
    void syncDoseReminders(next);
    try {
      const result = await logDose(patientId, organisationId, item, nextStatus);
      if (result.error) {
        // Revert to what the server actually has, and say so — a silent
        // revert looks like the tap never registered.
        setRowErrors((prev) => new Set(prev).add(key));
        await load();
      }
    } catch {
      setRowErrors((prev) => new Set(prev).add(key));
      await load().catch(() => {});
    } finally {
      setPendingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>
          {subjectName ? `${subjectName}'s medications` : "Medications"}
        </Text>
        <MutedText>
          {subjectName
            ? `${subjectName}'s doses today and their medicines cabinet.`
            : "Today's doses and your medicines cabinet."}
        </MutedText>
      </View>

      <View style={{ gap: 10 }}>
        <SectionLabel>Today&apos;s doses</SectionLabel>
        {loading ? (
          <ActivityIndicator color={colors.brand} />
        ) : loadError ? (
          <Pressable accessibilityRole="button" accessibilityLabel="We couldn't load your doses right now. Tap to retry." onPress={retryLoad}>
            <Card style={{ alignItems: "center", gap: 8 }}>
              <Ionicons name="cloud-offline-outline" size={22} color={colors.faint} />
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>
                We couldn&apos;t load this right now
              </Text>
              <MutedText>Your dose list is safe. Tap to retry.</MutedText>
            </Card>
          </Pressable>
        ) : doses.length === 0 ? (
          <Card>
            <MutedText>No scheduled doses today.</MutedText>
          </Card>
        ) : (
          <GroupedList>
            {doses.map((item) => {
              const key = `${item.medicationId}-${item.time}`;
              return (
                <View key={key}>
                  <GroupedListRow
                    title={item.drugName}
                    subtitle={item.time}
                    trailing="none"
                    onPress={() => toggle(item)}
                    disabled={pendingKeys.has(key)}
                    leading={
                      item.status === "taken" ? (
                        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name="checkmark" size={13} color="#fff" />
                        </View>
                      ) : (
                        <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: inkAlpha(0.15) }} />
                      )
                    }
                  />
                  {rowErrors.has(key) ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Couldn't save ${item.drugName}. Tap to try again.`}
                      onPress={() => toggle(item)}
                      style={{ paddingHorizontal: spacing.card, paddingBottom: 10 }}
                    >
                      <Text style={{ fontSize: 12.5, color: colors.danger }}>
                        Couldn&apos;t save that. Tap to try again.
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </GroupedList>
        )}
      </View>

      <CalloutCard
        icon="medkit-outline"
        title="Your medicines cabinet"
        subtitle='Active medications, refill status, and "check my pack" open in the full patient app.'
        ctaLabel="Open cabinet"
        onPress={() => setCabinetOpen(true)}
      />

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
