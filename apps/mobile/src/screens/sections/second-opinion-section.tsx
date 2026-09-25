import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  loadMySecondOpinionRequests,
  submitSecondOpinionRequest,
  SECOND_OPINION_CREDIT_REQUIRED_MARKER,
  SECOND_OPINION_CREDIT_CODE,
  type SecondOpinionRequestWithAnswerer,
} from "@/lib/second-opinion";
import { trySpendPlatformCreditForService } from "@/lib/platform-credit";
import { formatCareDate } from "@/lib/care";
import { formatDoctorName } from "@/lib/doctor-name";
import { PLATFORM_URL } from "@/lib/platform-url";
import { koboToNaira } from "@tarragon/shared";
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
 * second-opinion-request.tsx. Submits the request directly; if the DB
 * trigger rejects it for lack of a credit, this now settles it in-app from
 * the patient's platform credit balance when that already covers the price
 * (trySpendPlatformCreditForService) and retries — no browser trip. Only
 * when the balance is short (or something else goes wrong) does this fall
 * back to the system browser, same as before — buying a credit still
 * requires Paystack checkout, which stays web-only (App Store 3.1.1).
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
  const [creditShortfallKobo, setCreditShortfallKobo] = useState<number | null>(null);

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
    setCreditShortfallKobo(null);
    setSent(false);

    const input = {
      patientId,
      organisationId,
      existingDiagnosisOrResult: existingDiagnosisOrResult.trim(),
      sourceDescription: sourceDescription.trim() || undefined,
      specificQuestion: specificQuestion.trim() || undefined,
    };
    let result = await submitSecondOpinionRequest(input);

    if (!result.ok && result.error.includes(SECOND_OPINION_CREDIT_REQUIRED_MARKER)) {
      // Already have enough platform credit to cover this? Spend it and
      // retry right here, in-app — no browser trip. Only a short balance
      // (or a spend-level failure) falls through to the "buy a credit"
      // browser fallback below.
      const spend = await trySpendPlatformCreditForService(SECOND_OPINION_CREDIT_CODE, patientId);
      if (spend.spent) {
        result = await submitSecondOpinionRequest(input);
      } else {
        setSubmitting(false);
        setNeedsCredit(true);
        setCreditShortfallKobo(spend.shortfallKobo ?? null);
        if (spend.error) setError(spend.error);
        return;
      }
    }

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
            {creditShortfallKobo
              ? `You need ₦${koboToNaira(creditShortfallKobo).toLocaleString()} more platform credit to send this request.`
              : "Buy a second opinion credit to send this request."}
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
                        Answered by {formatDoctorName(r.answerer.full_name)} on {formatCareDate(r.answered_at)}
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
