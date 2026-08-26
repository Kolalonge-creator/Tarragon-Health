import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  loadTodaysDoses,
  logDose,
  type DoseChecklistItem,
  type MedicationLogReasonCode,
} from "@/lib/medications";
import { syncDoseReminders } from "@/lib/dose-reminders";
import { colors, radius, spacing } from "@/ui/theme";
import { CalloutCard, Card, ChoiceChip, GroupedList, GroupedListRow, MutedText, SecondaryButton, SectionLabel } from "@/ui/components";
import { WebViewScreen } from "@/screens/webview-screen";

/** Same non-judgmental quick-pick as apps/web/src/app/(dashboard)/patient/
 * todays-doses.tsx's REASON_OPTIONS — 'felt_fine' is the one deliberate-skip
 * option (logs status='skipped'), everything else is an unintentional miss
 * (logs status='missed', still counted by the coach/doctor escalation
 * ladder). */
const REASON_OPTIONS: {
  code: MedicationLogReasonCode;
  label: string;
  status: "missed" | "skipped";
}[] = [
  { code: "forgot", label: "Forgot", status: "missed" },
  { code: "ran_out", label: "Ran out", status: "missed" },
  { code: "side_effects", label: "Side effects", status: "missed" },
  { code: "cost", label: "Couldn't afford it", status: "missed" },
  { code: "felt_fine", label: "Chose to skip", status: "skipped" },
  { code: "other", label: "Other reason", status: "missed" },
];

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
  // The dose currently being "un-taken" — reason-picker modal is open for it.
  const [reasonPickerFor, setReasonPickerFor] = useState<DoseChecklistItem | null>(null);

  const load = useCallback(async () => {
    const today = await loadTodaysDoses(patientId);
    setDoses(today);
    void syncDoseReminders(today);
  }, [patientId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function commit(
    item: DoseChecklistItem,
    status: "taken" | "missed" | "skipped",
    reasonCode?: MedicationLogReasonCode
  ) {
    // Optimistic — this is the highest-frequency native write in the app.
    const next: DoseChecklistItem[] = doses.map((d) => (d === item ? { ...d, status } : d));
    setDoses(next);
    void syncDoseReminders(next);
    setReasonPickerFor(null);
    const result = await logDose(patientId, organisationId, item, status, reasonCode);
    if (result.error) await load();
  }

  /** Marking a dose taken stays the frictionless one-tap gesture it always
   * was. Un-marking a taken dose (or logging any not-yet-taken slot as
   * NOT taken) opens the reason picker instead of silently writing
   * status='missed' with no context — same non-judgmental design as the web
   * "Didn't take it" flow. */
  function toggle(item: DoseChecklistItem) {
    if (item.status !== "taken") {
      void commit(item, "taken");
      return;
    }
    setReasonPickerFor(item);
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
            {doses.map((item) => {
              const statusSuffix =
                item.status === "unconfirmed"
                  ? " · Unconfirmed"
                  : item.status === "missed"
                    ? " · Missed"
                    : item.status === "skipped"
                      ? " · Skipped"
                      : "";
              return (
                <GroupedListRow
                  key={`${item.medicationId}-${item.time}`}
                  title={item.drugName}
                  subtitle={`${item.time}${statusSuffix}`}
                  // "Didn't take it" opens the reason picker directly, with no
                  // wrong intermediate write — the row's own tap stays the
                  // frictionless one-tap "mark taken" path for the common case.
                  trailing={
                    item.status === "taken" ? (
                      "none"
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setReasonPickerFor(item)}
                        hitSlop={8}
                      >
                        <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.muted }}>
                          Didn&apos;t take it
                        </Text>
                      </Pressable>
                    )
                  }
                  onPress={() => toggle(item)}
                  leading={
                    item.status === "taken" ? (
                      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name="checkmark" size={13} color="#fff" />
                      </View>
                    ) : item.status === "unconfirmed" ? (
                      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.muted, alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name="help" size={12} color={colors.muted} />
                      </View>
                    ) : (
                      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "rgba(23,23,23,0.15)" }} />
                    )
                  }
                />
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

      <Modal
        visible={reasonPickerFor !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setReasonPickerFor(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(23,23,23,0.35)", justifyContent: "flex-end" }}
          onPress={() => setReasonPickerFor(null)}
        >
          <Pressable
            style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: radius.card,
              borderTopRightRadius: radius.card,
              padding: spacing.screen,
              gap: 10,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
              {reasonPickerFor ? `Didn't take ${reasonPickerFor.drugName}?` : ""}
            </Text>
            <MutedText>No judgment — just helps your care team know what&apos;s going on.</MutedText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
              {REASON_OPTIONS.map((option) => (
                <ChoiceChip
                  key={option.code}
                  title={option.label}
                  onPress={() => {
                    if (reasonPickerFor) void commit(reasonPickerFor, option.status, option.code);
                  }}
                />
              ))}
            </View>
            <SecondaryButton title="Cancel" onPress={() => setReasonPickerFor(null)} />
          </Pressable>
        </Pressable>
      </Modal>

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
