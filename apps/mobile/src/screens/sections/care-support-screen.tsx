import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  loadMyAsyncConsults,
  submitAsyncConsult,
  ASYNC_CONSULT_CATEGORIES,
  ASK_A_DOCTOR_CREDIT_REQUIRED_MARKER,
  loadMyNavigationRequests,
  createNavigationRequest,
  submitNavigationRequestFeedback,
  NAVIGATION_REQUEST_CATEGORIES,
  NAVIGATION_REQUEST_CATEGORY_LABEL,
  NAVIGATION_REQUEST_STATUS_LABEL,
  type AsyncConsultWithAnswerer,
  type NavigationRequest,
  type NavigationRequestCategory,
} from "@/lib/care-support";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, radius, spacing } from "@/ui/theme";
import {
  Badge,
  CalloutCard,
  Card,
  ErrorText,
  MutedText,
  PrimaryButton,
  SecondaryButton,
} from "@/ui/components";
import { WebViewScreen } from "@/screens/webview-screen";

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
}

const textInputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 14,
  color: colors.ink,
} as const;

interface CareSupportScreenProps {
  patientId: string;
  organisationId: string;
}

/**
 * Basic native Care & support — the web /patient/care hub is a 20-component
 * kitchen sink (care plan tasks, chronic programme, referrals, vouchers,
 * wellness points…); rebuilding all of it natively is a different-scale
 * project. This screen picks the two genuinely self-contained, "support"-
 * shaped pieces — Ask a doctor and I-need-help requests — and gives them
 * real native forms; everything else stays one tap away in the full hub
 * (WebView), same "one real native win, browser for the rest" shape as
 * Labs/Appointments/Prevention.
 */
export function CareSupportScreen({ patientId, organisationId }: CareSupportScreenProps) {
  const [hubOpen, setHubOpen] = useState(false);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 22 }}
    >
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Care & support</Text>
        <MutedText>Ask a doctor a written question, or get help with something non-clinical.</MutedText>
      </View>

      <AskADoctorSection patientId={patientId} organisationId={organisationId} />
      <NeedHelpSection patientId={patientId} />

      <CalloutCard
        icon="help-buoy-outline"
        title="Your care plan & more"
        subtitle="Care plan tasks, your chronic programme, referrals, video visits, and second opinions."
        ctaLabel="Open the full hub"
        onPress={() => setHubOpen(true)}
      />

      <Modal visible={hubOpen} animationType="slide" onRequestClose={() => setHubOpen(false)}>
        <View style={{ flex: 1 }}>
          <View style={{ padding: spacing.screen, paddingTop: 56 }}>
            <SecondaryButton title="Close" onPress={() => setHubOpen(false)} />
          </View>
          <WebViewScreen path="/patient/care" />
        </View>
      </Modal>
    </ScrollView>
  );
}

function AskADoctorSection({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const [consults, setConsults] = useState<AsyncConsultWithAnswerer[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState(ASYNC_CONSULT_CATEGORIES[0].value);
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsCredit, setNeedsCredit] = useState(false);

  const refresh = useCallback(async () => {
    const result = await loadMyAsyncConsults(patientId);
    if (result.ok) setConsults(result.data);
  }, [patientId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function submit() {
    if (question.trim().length < 10) {
      setError("Tell us a little more so the doctor can actually help");
      return;
    }
    setSubmitting(true);
    setError(null);
    setNeedsCredit(false);
    const result = await submitAsyncConsult({ patientId, organisationId, category, question: question.trim() });
    setSubmitting(false);
    if (!result.ok) {
      if (result.error.includes(ASK_A_DOCTOR_CREDIT_REQUIRED_MARKER)) {
        setNeedsCredit(true);
      } else {
        setError(result.error);
      }
      return;
    }
    setQuestion("");
    void refresh();
  }

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Ask a doctor</Text>
      <MutedText>
        Send a written question and a doctor on your care team answers here, usually within 72
        hours. Not for emergencies.
      </MutedText>

      {needsCredit && (
        <Card style={{ gap: 8, backgroundColor: colors.brandTint }}>
          <Text style={{ fontSize: 13, color: colors.brandPressed }}>
            Ask a doctor isn&apos;t included on your current plan. Buy a one-off credit to send
            this question.
          </Text>
          <SecondaryButton
            title="Buy a credit in the browser"
            onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/care#ask-a-doctor`)}
          />
        </Card>
      )}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {ASYNC_CONSULT_CATEGORIES.map((c) => {
          const selected = c.value === category;
          return (
            <Pressable
              key={c.value}
              onPress={() => setCategory(c.value)}
              style={{
                borderRadius: 999,
                paddingVertical: 7,
                paddingHorizontal: 12,
                backgroundColor: selected ? colors.brand : colors.groupBg,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: selected ? "#FFFFFF" : colors.ink }}>
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        value={question}
        onChangeText={setQuestion}
        placeholder="e.g. I've felt dizzy in the mornings since my dose changed. Is that expected?"
        multiline
        numberOfLines={3}
        style={[textInputStyle, { minHeight: 70, textAlignVertical: "top" }]}
      />
      {error && <ErrorText>{error}</ErrorText>}
      <PrimaryButton title="Send to my care team" onPress={submit} loading={submitting} />

      {loading && <ActivityIndicator color={colors.brand} />}
      {consults.length > 0 && (
        <View style={{ gap: 10, marginTop: 4 }}>
          {consults.map((c) => {
            const answered = c.status === "answered" || c.status === "closed";
            return (
              <Card key={c.id} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink, flex: 1 }}>
                    {c.question}
                  </Text>
                  <Badge tone={answered ? "brand" : "neutral"}>{answered ? "Answered" : "With your care team"}</Badge>
                </View>
                {answered && c.answer && (
                  <>
                    <Text style={{ fontSize: 13.5, color: colors.ink }}>{c.answer}</Text>
                    {c.answerer && c.answered_at && (
                      <MutedText>
                        Answered by Dr. {c.answerer.full_name} on {when(c.answered_at)}
                      </MutedText>
                    )}
                  </>
                )}
              </Card>
            );
          })}
        </View>
      )}
    </View>
  );
}

function NeedHelpSection({ patientId }: { patientId: string }) {
  const [requests, setRequests] = useState<NavigationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<NavigationRequestCategory>("appointment");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadMyNavigationRequests(patientId);
    if (result.ok) setRequests(result.data);
  }, [patientId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    const result = await createNavigationRequest({ patientId, category, description, isComplaint: false });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDescription("");
    setOpen(false);
    void refresh();
  }

  async function rate(requestId: string, rating: number) {
    await submitNavigationRequestFeedback(requestId, rating);
    void refresh();
  }

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Need help with something?</Text>
        {!open && <SecondaryButton title="I need help" onPress={() => setOpen(true)} />}
      </View>
      <MutedText>
        Appointments, pharmacy, labs, insurance, referrals, or payments — a navigator helps sort it
        out.
      </MutedText>

      {open && (
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {NAVIGATION_REQUEST_CATEGORIES.map((c) => {
              const selected = c === category;
              return (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  style={{
                    borderRadius: 999,
                    paddingVertical: 7,
                    paddingHorizontal: 12,
                    backgroundColor: selected ? colors.brand : colors.groupBg,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "600", color: selected ? "#FFFFFF" : colors.ink }}>
                    {NAVIGATION_REQUEST_CATEGORY_LABEL[c]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. My pharmacy doesn't have my usual medicine in stock"
            multiline
            numberOfLines={3}
            style={[textInputStyle, { minHeight: 70, textAlignVertical: "top" }]}
          />
          {error && <ErrorText>{error}</ErrorText>}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <PrimaryButton title="Send" onPress={submit} loading={submitting} />
            <SecondaryButton title="Cancel" onPress={() => setOpen(false)} disabled={submitting} />
          </View>
        </Card>
      )}

      {loading && <ActivityIndicator color={colors.brand} />}
      {!loading && requests.length === 0 && !open && (
        <MutedText>No requests yet — if something's getting in the way, let us know above.</MutedText>
      )}
      {requests.length > 0 && (
        <View style={{ gap: 10 }}>
          {requests.map((r) => (
            <Card key={r.id} style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>
                  {NAVIGATION_REQUEST_CATEGORY_LABEL[r.category]}
                </Text>
                <Badge tone={r.status === "resolved" ? "brand" : "neutral"}>
                  {NAVIGATION_REQUEST_STATUS_LABEL[r.status]}
                </Badge>
              </View>
              <Text style={{ fontSize: 13.5, color: colors.ink }}>{r.description}</Text>
              <MutedText>Sent {when(r.created_at)}</MutedText>
              {r.status === "resolved" && r.resolution_note && (
                <Text style={{ fontSize: 13, color: colors.ink, backgroundColor: colors.groupBg, padding: 8, borderRadius: radius.control }}>
                  {r.resolution_note}
                </Text>
              )}
              {r.status === "resolved" && r.satisfaction_rating === null && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <MutedText>How did we do?</MutedText>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => void rate(r.id, n)}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 13,
                        borderWidth: 1,
                        borderColor: colors.border,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ fontSize: 12, color: colors.ink }}>{n}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}
