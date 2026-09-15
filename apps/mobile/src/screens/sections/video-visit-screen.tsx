import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, Text, TextInput, View } from "react-native";
import {
  loadVideoConsultation,
  loadConsultationSummary,
  submitConsultationPrep,
  type VideoConsultation,
  type ConsultationSummary,
} from "@/lib/video-visit";
import { startThread } from "@/lib/messages";
import { colors, radius, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton, SectionLabel } from "@/ui/components";

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface VideoVisitScreenProps {
  consultationId: string;
  onBack: () => void;
}

/**
 * Native equivalent of apps/web/.../patient/video-visit/[consultationId] --
 * see lib/video-visit.ts's header for what's scoped down and why. Joining
 * itself is already native (Overview's "Join call" banner); this covers
 * visit details, prep notes, the post-visit summary, and reporting a
 * technical problem via the existing in-app Messages thread (never
 * WhatsApp -- see CLAUDE.md's Non-Negotiable Business Rules).
 */
export function VideoVisitScreen({ consultationId, onBack }: VideoVisitScreenProps) {
  const [loading, setLoading] = useState(true);
  const [consult, setConsult] = useState<VideoConsultation | null>(null);
  const [summary, setSummary] = useState<ConsultationSummary | null>(null);

  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesMessage, setNotesMessage] = useState<string | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [consultResult, summaryResult] = await Promise.all([
      loadVideoConsultation(consultationId),
      loadConsultationSummary(consultationId),
    ]);
    if (consultResult.ok && consultResult.data) {
      setConsult(consultResult.data);
      setNotes(consultResult.data.patient_prep_notes ?? "");
    }
    if (summaryResult.ok) setSummary(summaryResult.data);
    setLoading(false);
  }, [consultationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSaveNotes() {
    setSavingNotes(true);
    setNotesMessage(null);
    setNotesError(null);
    const res = await submitConsultationPrep(consultationId, notes);
    setSavingNotes(false);
    if (res.error) {
      setNotesError(res.error);
      return;
    }
    setNotesMessage("Saved. Your care team will see this before the visit.");
  }

  async function handleSendReport() {
    setReportSending(true);
    setReportError(null);
    try {
      await startThread(
        "Technical problem: video visit",
        `Consultation ${consultationId}: ${reportText.trim()}`
      );
      setReportSent(true);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : String(e));
    } finally {
      setReportSending(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (!consult) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
        <SecondaryButton title="Back" onPress={onBack} />
        <MutedText>Visit not found.</MutedText>
      </ScrollView>
    );
  }

  const isCancelled = consult.status === "cancelled";
  const isPast = consult.status !== "scheduled";

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <SecondaryButton title="Back" onPress={onBack} />

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <ScreenTitle>Your video visit</ScreenTitle>
          <Badge tone={isCancelled ? "neutral" : "brand"}>
            {isCancelled ? "Cancelled" : consult.status === "completed" ? "Completed" : "Confirmed"}
          </Badge>
        </View>
        <MutedText>{consult.scheduled_at ? formatSlot(consult.scheduled_at) : "Time to be confirmed"}</MutedText>

        <View style={{ backgroundColor: "#FEF2F2", borderRadius: radius.card, padding: 12 }}>
          <Text style={{ color: "#B91C1C", fontSize: 13.5, fontWeight: "600" }}>
            Not for emergencies. If this is an emergency, go to the nearest emergency department now.
          </Text>
        </View>
        <MutedText>
          Join a few minutes early so there&apos;s time to sort out any camera or microphone issues before your
          doctor arrives.
        </MutedText>
        {!isPast && consult.join_url ? (
          <PrimaryButton title="Join the call" onPress={() => void Linking.openURL(consult.join_url!).catch(() => {})} />
        ) : !isPast ? (
          <MutedText>Your join link will appear here once it&apos;s ready. Check back closer to your visit.</MutedText>
        ) : null}
      </Card>

      {consult.status === "completed" && summary && (
        <Card style={{ gap: 8 }}>
          <SectionLabel>Your visit summary</SectionLabel>
          <View>
            <Text style={{ fontSize: 12, color: colors.faint }}>What we discussed</Text>
            <Text style={{ fontSize: 13.5, color: colors.ink }}>{summary.what_we_discussed}</Text>
          </View>
          {summary.what_you_need_to_do && (
            <View>
              <Text style={{ fontSize: 12, color: colors.faint }}>What you need to do</Text>
              <Text style={{ fontSize: 13.5, color: colors.ink }}>{summary.what_you_need_to_do}</Text>
            </View>
          )}
          {summary.medicines_note && (
            <View>
              <Text style={{ fontSize: 12, color: colors.faint }}>Medicines</Text>
              <Text style={{ fontSize: 13.5, color: colors.ink }}>{summary.medicines_note}</Text>
            </View>
          )}
          {summary.tests_note && (
            <View>
              <Text style={{ fontSize: 12, color: colors.faint }}>Tests</Text>
              <Text style={{ fontSize: 13.5, color: colors.ink }}>{summary.tests_note}</Text>
            </View>
          )}
          {summary.next_appointment_note && (
            <View>
              <Text style={{ fontSize: 12, color: colors.faint }}>Next appointment</Text>
              <Text style={{ fontSize: 13.5, color: colors.ink }}>{summary.next_appointment_note}</Text>
            </View>
          )}
        </Card>
      )}

      {!isPast && (
        <Card style={{ gap: 14 }}>
          <SectionLabel>Before you join</SectionLabel>

          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>
              What would you like to talk about? (optional)
            </Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Reason for the visit, symptoms, anything you want your doctor to know beforehand…"
              placeholderTextColor={colors.faint}
              multiline
              numberOfLines={3}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10, fontSize: 14, color: colors.ink }}
            />
            <SecondaryButton title="Save" loading={savingNotes} onPress={() => void handleSaveNotes()} />
            {notesMessage ? <MutedText>{notesMessage}</MutedText> : null}
            {notesError ? <ErrorText>{notesError}</ErrorText> : null}
          </View>

          <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
            <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>Having connection trouble?</Text>
            <MutedText>
              If your video keeps freezing, try turning your camera off and continuing on audio only. The call
              itself doesn&apos;t need video to work. If sound is unreliable too, end the call and your care team
              will follow up by phone instead.
            </MutedText>
            {reportSent ? (
              <MutedText>Reported. Your care team will follow up in Messages.</MutedText>
            ) : reportOpen ? (
              <View style={{ gap: 8 }}>
                <TextInput
                  value={reportText}
                  onChangeText={setReportText}
                  placeholder="What's going wrong? (e.g. camera won't turn on, can't hear the doctor)"
                  placeholderTextColor={colors.faint}
                  multiline
                  numberOfLines={2}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10, fontSize: 14, color: colors.ink }}
                />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <SecondaryButton
                    title="Send to care team"
                    disabled={reportText.trim().length === 0}
                    loading={reportSending}
                    onPress={() => void handleSendReport()}
                  />
                  <SecondaryButton title="Cancel" onPress={() => setReportOpen(false)} />
                </View>
                {reportError ? <ErrorText>{reportError}</ErrorText> : null}
              </View>
            ) : (
              <SecondaryButton title="Report a technical problem" onPress={() => setReportOpen(true)} />
            )}
          </View>
        </Card>
      )}
    </ScrollView>
  );
}
