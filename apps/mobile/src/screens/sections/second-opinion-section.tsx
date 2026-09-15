import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  loadMySecondOpinionRequests,
  submitSecondOpinionRequest,
  SECOND_OPINION_CREDIT_REQUIRED_MARKER,
  type SecondOpinionRequestWithAnswerer,
} from "@/lib/second-opinion";
import { formatCareDate } from "@/lib/care";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, radius } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";

const textInputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 14,
  color: colors.ink,
} as const;

/**
 * Native "Second opinion" — mirrors apps/web/src/app/(dashboard)/patient/
 * second-opinion-request.tsx. Payment stays on the web (App Store 3.1.1):
 * this submits the request directly and, only if the DB trigger rejects for
 * lack of a credit, offers to buy one in the system browser — same pattern
 * as AskADoctorSection in care-support-screen.tsx.
 */
export function SecondOpinionSection({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const [requests, setRequests] = useState<SecondOpinionRequestWithAnswerer[]>([]);
  const [loading, setLoading] = useState(true);
  const [existingDiagnosisOrResult, setExistingDiagnosisOrResult] = useState("");
  const [sourceDescription, setSourceDescription] = useState("");
  const [specificQuestion, setSpecificQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [needsCredit, setNeedsCredit] = useState(false);

  const refresh = useCallback(async () => {
    const result = await loadMySecondOpinionRequests(patientId);
    if (result.ok) setRequests(result.data);
  }, [patientId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function submit() {
    if (existingDiagnosisOrResult.trim().length === 0) {
      setError("Describe the result or diagnosis you'd like a second opinion on");
      return;
    }
    setSubmitting(true);
    setError(null);
    setNeedsCredit(false);
    setSent(false);
    const result = await submitSecondOpinionRequest({
      patientId,
      organisationId,
      existingDiagnosisOrResult: existingDiagnosisOrResult.trim(),
      sourceDescription: sourceDescription.trim() || undefined,
      specificQuestion: specificQuestion.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      if (result.error.includes(SECOND_OPINION_CREDIT_REQUIRED_MARKER)) {
        setNeedsCredit(true);
      } else {
        setError(result.error);
      }
      return;
    }
    setExistingDiagnosisOrResult("");
    setSourceDescription("");
    setSpecificQuestion("");
    setSent(true);
    void refresh();
  }

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Second opinion</Text>
      <MutedText>
        Already have a result or diagnosis from somewhere else? A doctor on your care team reviews
        it and writes back their own assessment, no visit needed.
      </MutedText>

      {needsCredit && (
        <Card style={{ gap: 8, backgroundColor: colors.brandTint }}>
          <Text style={{ fontSize: 13, color: colors.brandPressed }}>
            Buy a second opinion credit to send this request.
          </Text>
          <SecondaryButton
            title="Buy a credit in the browser"
            onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/care`)}
          />
        </Card>
      )}

      <TextInput
        value={existingDiagnosisOrResult}
        onChangeText={setExistingDiagnosisOrResult}
        placeholder="e.g. My GP diagnosed me with X and suggested Y. I'd like another doctor's view."
        multiline
        numberOfLines={3}
        style={[textInputStyle, { minHeight: 70, textAlignVertical: "top" }]}
      />
      <TextInput
        value={sourceDescription}
        onChangeText={setSourceDescription}
        placeholder="Where is this from? (optional)"
        style={textInputStyle}
      />
      <TextInput
        value={specificQuestion}
        onChangeText={setSpecificQuestion}
        placeholder="A specific question? (optional)"
        style={textInputStyle}
      />
      {error && <ErrorText>{error}</ErrorText>}
      {sent && <MutedText>Sent. A doctor will answer here within 72 hours.</MutedText>}
      <PrimaryButton title="Send for review" onPress={submit} loading={submitting} />

      {loading && <ActivityIndicator color={colors.brand} />}
      {requests.length > 0 && (
        <View style={{ gap: 10, marginTop: 4 }}>
          {requests.map((r) => {
            const answered = r.status === "answered" || r.status === "closed";
            return (
              <Card key={r.id} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink, flex: 1 }}>
                    {r.existing_diagnosis_or_result}
                  </Text>
                  <Badge tone={answered ? "brand" : "neutral"}>
                    {answered ? "Answered" : "With your care team"}
                  </Badge>
                </View>
                {answered && r.answer && (
                  <>
                    <Text style={{ fontSize: 13.5, color: colors.ink }}>{r.answer}</Text>
                    {r.answerer && r.answered_at && (
                      <MutedText>
                        Answered by Dr. {r.answerer.full_name} on {formatCareDate(r.answered_at)}
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
