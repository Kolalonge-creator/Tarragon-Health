import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import {
  createSupportTicket,
  loadMySupportTickets,
  TICKET_STATUS_LABEL,
  type SupportTicket,
  type SupportTicketStatus,
} from "@/lib/technical-support";
import { loadCachedEmergencyFacts, type EmergencyContact } from "@/lib/emergency";
import { loadPatientState } from "@/lib/vitals";
import { EmergencyGuidanceModal } from "@/screens/emergency-guidance-modal";
import { colors, radius, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SectionDivider } from "@/ui/components";

const STATUS_TONE: Record<SupportTicketStatus, "brand" | "neutral"> = {
  new: "neutral",
  assigned: "neutral",
  in_progress: "neutral",
  awaiting_patient: "brand",
  resolved: "brand",
  closed: "neutral",
};

const textInputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 14,
  color: colors.ink,
} as const;

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
}

interface TechnicalSupportScreenProps {
  patientId: string;
  organisationId: string;
}

/**
 * Technical support ticket form + list — mirrors apps/web/.../(sections)/
 * support/create-ticket-form.tsx and ticket-list.tsx, narrowed the same way:
 * technical/app issues only (the web page's separate complaint/FAQ flows
 * aren't ported here yet). Free text is scanned by the same
 * detectDangerSigns() keyword net used on web (ported verbatim into
 * lib/technical-support.ts) before it ever becomes a ticket — a match never
 * creates one at all, it raises an emergency_events row server-side instead,
 * surfaced here with the same EmergencyGuidanceModal a red-flag vitals
 * reading shows, not a form error.
 */
export function TechnicalSupportScreen({ patientId, organisationId }: TechnicalSupportScreenProps) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [emergencyVisible, setEmergencyVisible] = useState(false);
  const [emergencyContact, setEmergencyContact] = useState<EmergencyContact | null>(null);
  const [patientState, setPatientState] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadMySupportTickets(patientId);
    if (result.ok) setTickets(result.data);
  }, [patientId]);

  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
    loadCachedEmergencyFacts()
      .then((facts) => setEmergencyContact(facts?.emergencyContact ?? null))
      .catch(() => {});
    loadPatientState(patientId).then(setPatientState);
  }, [refresh, patientId]);

  async function submit() {
    setError(null);
    setSent(false);
    setSubmitting(true);
    const result = await createSupportTicket({ patientId, organisationId, subject, description });
    setSubmitting(false);
    if (result.kind === "error") {
      setError(result.error);
      return;
    }
    setSubject("");
    setDescription("");
    if (result.kind === "emergency") {
      setEmergencyVisible(true);
      return;
    }
    setSent(true);
    void refresh();
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 16 }}
    >
      <View>
        <ScreenTitle>Technical support</ScreenTitle>
        <MutedText>Tell us about an app or technical issue and we&apos;ll get back to you.</MutedText>
      </View>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>Subject</Text>
        <TextInput
          value={subject}
          onChangeText={setSubject}
          placeholder="Short summary of the issue"
          maxLength={200}
          style={textInputStyle}
        />
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>Tell us what&apos;s happening</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. The app crashes every time I try to log a blood pressure reading."
          multiline
          numberOfLines={4}
          maxLength={4000}
          style={[textInputStyle, { minHeight: 90, textAlignVertical: "top" }]}
        />
        {error && <ErrorText>{error}</ErrorText>}
        {sent && (
          <MutedText>Sent — our support team will get back to you soon.</MutedText>
        )}
        <PrimaryButton title="Send" onPress={submit} loading={submitting} />
      </Card>

      <View>
        <SectionDivider />
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink, marginBottom: 8 }}>
          Your tickets
        </Text>
        {loading && <ActivityIndicator color={colors.brand} />}
        {!loading && tickets.length === 0 && <MutedText>No support tickets yet.</MutedText>}
        {tickets.map((t) => (
          <Card key={t.id} style={{ gap: 4, marginBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink, flex: 1 }}>{t.subject}</Text>
              <Badge tone={STATUS_TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</Badge>
            </View>
            <MutedText>{when(t.created_at)}</MutedText>
          </Card>
        ))}
      </View>

      <EmergencyGuidanceModal
        visible={emergencyVisible}
        detail="What you described may be a medical emergency."
        synced
        emergencyContact={emergencyContact}
        state={patientState}
        onDismiss={() => setEmergencyVisible(false)}
      />
    </ScrollView>
  );
}
