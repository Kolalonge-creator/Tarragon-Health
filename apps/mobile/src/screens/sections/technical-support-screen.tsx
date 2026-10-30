import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, TextInput, View } from "react-native";
import {
  createSupportTicket,
  loadMySupportTickets,
  TICKET_STATUS_LABEL,
  type SupportTicket,
  type SupportTicketStatus,
} from "@/lib/technical-support";
import { loadCachedEmergencyFacts, type EmergencyContact } from "@/lib/emergency";
import { takeSupportPrefill } from "@/lib/support-prefill";
import { EmergencyGuidanceModal } from "@/screens/emergency-guidance-modal";
import { spacing } from "@/ui/theme";
import { useLegacyColors, useTextInputStyle, useTheme, placeholderColorFor } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SectionDivider } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";
import { Card as KitCard } from "@/ui/kit/Card";
import { Disclosure } from "@/ui/kit/Disclosure";
import { ListItem } from "@/ui/kit/ListItem";
import type { SectionId } from "@/lib/sections";

const STATUS_TONE: Record<SupportTicketStatus, "brand" | "neutral"> = {
  new: "neutral",
  assigned: "neutral",
  in_progress: "neutral",
  awaiting_patient: "brand",
  resolved: "brand",
  closed: "neutral",
};

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
}

interface TechnicalSupportScreenProps {
  patientId: string;
  organisationId: string;
  /** Opens another section; used for the "Message your care team" row. Without it the row is left out. */
  onNavigate?: (id: SectionId) => void;
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
export function TechnicalSupportScreen({ patientId, organisationId, onNavigate }: TechnicalSupportScreenProps) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  // One-shot hand-off from the points screen (S58b); a plain visit gets empty fields.
  const [prefill] = useState(() => takeSupportPrefill());
  const [subject, setSubject] = useState(prefill?.subject ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [emergencyVisible, setEmergencyVisible] = useState(false);
  const [emergencyContact, setEmergencyContact] = useState<EmergencyContact | null>(null);

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
        <ScreenTitle>Help &amp; support</ScreenTitle>
        <MutedText>Message your care team about your health, or report a problem with the app.</MutedText>
      </View>

      {onNavigate ? (
        <KitCard padded={false}>
          <ListItem
            title="Message your care team"
            subtitle="For anything about your health, appointments, medicines or results."
            icon="messages"
            onPress={() => onNavigate("messages")}
          />
        </KitCard>
      ) : null}

      <Disclosure title="Report a problem with the app" hint="Something is broken or not working as it should." defaultOpen={Boolean(prefill)}>
      <View style={{ gap: 10 }}>
        <AppText variant="label">Subject</AppText>
        <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)}
          value={subject}
          onChangeText={setSubject}
          placeholder="Short summary of the issue"
          maxLength={200}
          style={textInputStyle}
        />
        <AppText variant="label">Tell us what&apos;s happening</AppText>
        <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)}
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
      </View>

      <View>
        <SectionDivider />
        <AppText variant="label" style={{ marginBottom: 8 }}>
          Your tickets
        </AppText>
        {loading && <ActivityIndicator color={colors.brand} />}
        {!loading && tickets.length === 0 && <MutedText>No support tickets yet.</MutedText>}
        {tickets.map((t) => (
          <Card key={t.id} style={{ gap: 4, marginBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <AppText variant="bodyStrong" style={{ flex: 1 }}>{t.subject}</AppText>
              <Badge tone={STATUS_TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</Badge>
            </View>
            <MutedText>{when(t.created_at)}</MutedText>
          </Card>
        ))}
      </View>
      </Disclosure>

      <EmergencyGuidanceModal
        visible={emergencyVisible}
        detail="What you described may be a medical emergency."
        synced
        emergencyContact={emergencyContact}
        onDismiss={() => setEmergencyVisible(false)}
      />
    </ScrollView>
  );
}
