import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  loadTodaysDoses,
  logDose,
  MISSED_DOSE_REASON_OPTIONS,
  type DoseChecklistItem,
  type DoseStatus,
  type MissedDoseReason,
} from "@/lib/medications";
import { syncDoseReminders } from "@/lib/dose-reminders";
import { colors, spacing } from "@/ui/theme";
import { CalloutCard, Card, ChoiceChip, GroupedList, GroupedListRow, MutedText, SecondaryButton, SectionLabel } from "@/ui/components";
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
  const [cabinetOpen, setCabinetOpen] = useState(false);
  // Pathway §65.9 — asked before a "missed" write, not after: the escalation
  // trigger only reacts to INSERT, so the reason has to be on the row from
  // the start rather than added by a follow-up update.
  const [reasonPromptItem, setReasonPromptItem] = useState<DoseChecklistItem | null>(null);

  const load = useCallback(async () => {
    const today = await loadTodaysDoses(patientId);
    setDoses(today);
    void syncDoseReminders(today);
  }, [patientId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function applyStatus(
    item: DoseChecklistItem,
    nextStatus: Exclude<DoseStatus, "pending">,
    missedReason?: MissedDoseReason
  ) {
    // Optimistic — this is the highest-frequency native write in the app.
    const next: DoseChecklistItem[] = doses.map((d) => (d === item ? { ...d, status: nextStatus } : d));
    setDoses(next);
    void syncDoseReminders(next);
    const result = await logDose(patientId, organisationId, item, nextStatus, missedReason);
    if (result.error) await load();
  }

  function toggle(item: DoseChecklistItem) {
    const nextStatus: Exclude<DoseStatus, "pending"> = item.status === "taken" ? "missed" : "taken";
    if (nextStatus === "missed") {
      setReasonPromptItem(item);
      return;
    }
    void applyStatus(item, nextStatus);
  }

  function pickMissedReason(reason?: MissedDoseReason) {
    const item = reasonPromptItem;
    setReasonPromptItem(null);
    if (item) void applyStatus(item, "missed", reason);
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
        ) : doses.length === 0 ? (
          <Card>
            <MutedText>No scheduled doses today.</MutedText>
          </Card>
        ) : (
          <GroupedList>
            {doses.map((item) => (
              <GroupedListRow
                key={`${item.medicationId}-${item.time}`}
                title={item.drugName}
                subtitle={item.time}
                trailing="none"
                onPress={() => toggle(item)}
                leading={
                  item.status === "taken" ? (
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="checkmark" size={13} color="#fff" />
                    </View>
                  ) : (
                    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "rgba(23,23,23,0.15)" }} />
                  )
                }
              />
            ))}
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

      <Modal
        visible={reasonPromptItem !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setReasonPromptItem(null)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.screen, gap: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>
              What got in the way?
            </Text>
            <MutedText>Optional — helps your care team help you.</MutedText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {MISSED_DOSE_REASON_OPTIONS.map((option) => (
                <ChoiceChip key={option.value} title={option.label} onPress={() => pickMissedReason(option.value)} />
              ))}
            </View>
            <SecondaryButton title="Skip" onPress={() => pickMissedReason(undefined)} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
