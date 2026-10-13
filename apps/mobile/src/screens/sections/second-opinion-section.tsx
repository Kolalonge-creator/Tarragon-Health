import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  loadMySecondOpinionRequests,
  submitSecondOpinionRequest,
  loadSecondOpinionPriceKobo,
  SECOND_OPINION_CREDIT_REQUIRED_MARKER,
  type SecondOpinionRequestWithAnswerer,
} from "@/lib/second-opinion";
import { formatCareDate } from "@/lib/care";
import { loadCanAddReviewNote } from "@/lib/review-note";
import { formatDoctorName } from "@/lib/doctor-name";
import { PLATFORM_URL } from "@/lib/platform-url";
import { useLegacyColors, useTextInputStyle, useTheme, placeholderColorFor } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

/**
 * Native "Second opinion", a Members-only extra (an extra 5,000 naira, read from the product row). Mirrors apps/web/src/app/(dashboard)/
 * patient/second-opinion-request.tsx. A Member submits the request; if they have no credit yet the DB trigger says so and the app sends
 * them to the system browser to pay (Paystack checkout stays web-only, App Store 3.1.1). Someone who is not a Member is told, in plain
 * words, that a second opinion is part of Membership; the server refuses the purchase for them, and no price is shown.
 */
export function SecondOpinionSection({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [requests, setRequests] = useState<SecondOpinionRequestWithAnswerer[]>([]);
  const [loading, setLoading] = useState(true);
  const [existingDiagnosisOrResult, setExistingDiagnosisOrResult] = useState("");
  const [sourceDescription, setSourceDescription] = useState("");
  const [specificQuestion, setSpecificQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [needsCredit, setNeedsCredit] = useState(false);
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [priceKobo, setPriceKobo] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadMySecondOpinionRequests(patientId);
    if (result.ok) setRequests(result.data);
  }, [patientId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    void loadCanAddReviewNote().then((member) => {
      if (!alive) return;
      setIsMember(member);
      if (member) void loadSecondOpinionPriceKobo().then((kobo) => alive && setPriceKobo(kobo));
    });
    return () => {
      alive = false;
    };
  }, []);

  async function submit() {
    if (existingDiagnosisOrResult.trim().length === 0) {
      setError("Describe the result or diagnosis you'd like a second opinion on");
      return;
    }
    setSubmitting(true);
    setError(null);
    setNeedsCredit(false);
    setSent(false);

    const input = {
      patientId,
      organisationId,
      existingDiagnosisOrResult: existingDiagnosisOrResult.trim(),
      sourceDescription: sourceDescription.trim() || undefined,
      specificQuestion: specificQuestion.trim() || undefined,
    };
    const result = await submitSecondOpinionRequest(input);

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

      {isMember === false && (
        <Card style={{ gap: 8, backgroundColor: colors.brandTint }}>
          <Text style={{ fontSize: 13, color: colors.brandPressed }}>A second opinion is part of Membership.</Text>
          <SecondaryButton
            title="Join Membership"
            onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/membership`)}
          />
        </Card>
      )}

      {isMember === true && priceKobo !== null && (
        <MutedText>A second opinion is an extra for Members: ₦{(priceKobo / 100).toLocaleString("en-NG")}.</MutedText>
      )}

      {needsCredit && isMember === true && (
        <Card style={{ gap: 8, backgroundColor: colors.brandTint }}>
          <Text style={{ fontSize: 13, color: colors.brandPressed }}>
            Pay for your second opinion to send this request.
          </Text>
          <SecondaryButton
            title="Pay in the browser"
            onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/care`)}
          />
        </Card>
      )}

      <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)}
        value={existingDiagnosisOrResult}
        onChangeText={setExistingDiagnosisOrResult}
        placeholder="e.g. My GP diagnosed me with X and suggested Y. I'd like another doctor's view."
        multiline
        numberOfLines={3}
        style={[textInputStyle, { minHeight: 70, textAlignVertical: "top" }]}
      />
      <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)}
        value={sourceDescription}
        onChangeText={setSourceDescription}
        placeholder="Where is this from? (optional)"
        style={textInputStyle}
      />
      <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)}
        value={specificQuestion}
        onChangeText={setSpecificQuestion}
        placeholder="A specific question? (optional)"
        style={textInputStyle}
      />
      {error && <ErrorText>{error}</ErrorText>}
      {sent && <MutedText>Sent. A doctor will answer here within 72 hours.</MutedText>}
      {isMember !== false && <PrimaryButton title="Send for review" onPress={submit} loading={submitting} />}

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
