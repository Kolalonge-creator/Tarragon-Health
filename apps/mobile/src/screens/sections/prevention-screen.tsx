import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  loadScreeningSchedules,
  confirmScreeningDone,
  declineScreening,
  type ScreeningSchedule,
} from "@/lib/prevention";
import { todayIsoDate } from "@/lib/medications";
import { colors, radius, spacing } from "@/ui/theme";
import {
  Badge,
  CalloutCard,
  Card,
  ErrorText,
  GroupedList,
  MutedText,
  PrimaryButton,
  SecondaryButton,
} from "@/ui/components";
import { WebViewScreen } from "@/screens/webview-screen";

const STATUS_BADGE: Record<string, { label: string; tone: "brand" | "neutral" }> = {
  pending: { label: "Pending", tone: "neutral" },
  booked: { label: "Booked", tone: "neutral" },
  completed: { label: "Completed", tone: "brand" },
  overdue: { label: "Overdue", tone: "neutral" },
  declined: { label: "Declined", tone: "neutral" },
};

function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

interface PreventionScreenProps {
  patientId: string;
  organisationId: string;
}

/**
 * Basic native Prevention & Health Check — the screening calendar (what's
 * due, overdue, or already done), with the two lightweight patient actions
 * that don't need the lab catalogue/pricing/partner-billing machinery:
 * confirming a screening was done elsewhere, or declining it with a reason.
 * Actually generating a lab request for a due screening, the Annual Health
 * Check journey, vaccinations, and risk assessment all stay in the full hub
 * (WebView) — the same "one real native win, browser for the rest" shape as
 * Labs' camera capture and Appointments' booking flow.
 */
export function PreventionScreen({ patientId, organisationId }: PreventionScreenProps) {
  const [schedules, setSchedules] = useState<ScreeningSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hubOpen, setHubOpen] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadScreeningSchedules(patientId);
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    setSchedules(result.data);
  }, [patientId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const today = todayIsoDate();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 18 }}
    >
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Prevention</Text>
        <MutedText>Your personal screening calendar — what's due, overdue, or already done.</MutedText>
      </View>

      {loading && <ActivityIndicator color={colors.brand} />}
      {loadError && <ErrorText>{loadError}</ErrorText>}
      {!loading && !loadError && schedules.length === 0 && (
        <MutedText>
          No screenings scheduled yet. Complete your health profile in the full Prevention hub and
          your personal calendar builds itself from your age, sex, and history.
        </MutedText>
      )}

      {schedules.length > 0 && (
        <GroupedList>
          {schedules.map((schedule) => {
            const isOverdue = schedule.due_date < today && (schedule.status === "pending" || schedule.status === "booked");
            const badge = STATUS_BADGE[isOverdue ? "overdue" : schedule.status] ?? STATUS_BADGE.pending;
            const canAct = schedule.status === "pending" || schedule.status === "booked" || schedule.status === "overdue" || isOverdue;
            const open = openRow === schedule.id;
            return (
              <View key={schedule.id} style={{ padding: spacing.card, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ fontSize: 14.5, fontWeight: "600", color: colors.ink, flex: 1 }}>
                    {schedule.screen_type?.name ?? "Screening"}
                  </Text>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </View>
                <MutedText>Due {formatDue(schedule.due_date)}</MutedText>
                {schedule.status === "declined" && schedule.declined_reason && (
                  <MutedText>You declined this: {schedule.declined_reason}</MutedText>
                )}
                {canAct && !open && (
                  <Pressable onPress={() => setOpenRow(schedule.id)}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.brand }}>
                      I've had this done / Not right for me
                    </Text>
                  </Pressable>
                )}
                {canAct && open && (
                  <ScreeningRowActions
                    schedule={schedule}
                    patientId={patientId}
                    organisationId={organisationId}
                    onDone={() => {
                      setOpenRow(null);
                      void refresh();
                    }}
                    onCancel={() => setOpenRow(null)}
                  />
                )}
              </View>
            );
          })}
        </GroupedList>
      )}

      <CalloutCard
        icon="shield-checkmark-outline"
        title="Prevention & Health Check"
        subtitle="Book a test for a due screening, your yearly Health Check, vaccinations, and risk assessment."
        ctaLabel="Open the full hub"
        onPress={() => setHubOpen(true)}
      />

      <Modal visible={hubOpen} animationType="slide" onRequestClose={() => setHubOpen(false)}>
        <View style={{ flex: 1 }}>
          <View style={{ padding: spacing.screen, paddingTop: 56 }}>
            <SecondaryButton title="Close" onPress={() => setHubOpen(false)} />
          </View>
          <WebViewScreen path="/patient/prevention" />
        </View>
      </Modal>
    </ScrollView>
  );
}

function ScreeningRowActions({
  schedule,
  patientId,
  organisationId,
  onDone,
  onCancel,
}: {
  schedule: ScreeningSchedule;
  patientId: string;
  organisationId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"pick" | "confirm" | "decline">("pick");
  const [performedDate, setPerformedDate] = useState(todayIsoDate());
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitConfirm() {
    setSubmitting(true);
    setError(null);
    const result = await confirmScreeningDone({
      patientId,
      organisationId,
      screenTypeId: schedule.screen_type_id,
      scheduleId: schedule.id,
      performedDate,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone();
  }

  async function submitDecline() {
    setSubmitting(true);
    setError(null);
    const result = await declineScreening(patientId, schedule.id, reason);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone();
  }

  if (mode === "pick") {
    return (
      <View style={{ flexDirection: "row", gap: 10 }}>
        <SecondaryButton title="I've had this done" onPress={() => setMode("confirm")} />
        <Pressable onPress={() => setMode("decline")}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, paddingVertical: 13 }}>
            Not right for me
          </Text>
        </Pressable>
      </View>
    );
  }

  if (mode === "confirm") {
    return (
      <Card style={{ gap: 8 }}>
        <MutedText>When was it done?</MutedText>
        <TextInput
          value={performedDate}
          onChangeText={setPerformedDate}
          placeholder="YYYY-MM-DD"
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.control,
            paddingHorizontal: 10,
            paddingVertical: 8,
            fontSize: 14,
            color: colors.ink,
          }}
        />
        {error && <ErrorText>{error}</ErrorText>}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <PrimaryButton title="Confirm" onPress={submitConfirm} loading={submitting} />
          <SecondaryButton title="Cancel" onPress={onCancel} disabled={submitting} />
        </View>
      </Card>
    );
  }

  return (
    <Card style={{ gap: 8 }}>
      <MutedText>Let us know why (e.g. already had this elsewhere, not applicable to me)</MutedText>
      <TextInput
        value={reason}
        onChangeText={setReason}
        multiline
        numberOfLines={2}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.control,
          paddingHorizontal: 10,
          paddingVertical: 8,
          fontSize: 14,
          color: colors.ink,
          minHeight: 60,
          textAlignVertical: "top",
        }}
      />
      {error && <ErrorText>{error}</ErrorText>}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <PrimaryButton title="Confirm decline" onPress={submitDecline} loading={submitting} />
        <SecondaryButton title="Cancel" onPress={onCancel} disabled={submitting} />
      </View>
    </Card>
  );
}
