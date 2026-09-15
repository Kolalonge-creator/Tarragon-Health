import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  loadMySeniorCaseReviews,
  submitSeniorCaseReview,
  SENIOR_CASE_REVIEW_CREDIT_REQUIRED_MARKER,
  type SeniorCaseReviewWithReviewer,
} from "@/lib/senior-case-review";
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
 * Native "Senior case review" — mirrors apps/web/src/app/(dashboard)/
 * patient/senior-case-review-card.tsx. Payment stays on the web (App Store
 * 3.1.1): this submits the request directly and, only if the DB trigger
 * rejects for lack of a credit, offers to buy one in the system browser —
 * same pattern as AskADoctorSection in care-support-screen.tsx.
 */
export function SeniorCaseReviewSection({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const [reviews, setReviews] = useState<SeniorCaseReviewWithReviewer[]>([]);
  const [loading, setLoading] = useState(true);
  const [situationSummary, setSituationSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [needsCredit, setNeedsCredit] = useState(false);

  const refresh = useCallback(async () => {
    const result = await loadMySeniorCaseReviews(patientId);
    if (result.ok) setReviews(result.data);
  }, [patientId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function submit() {
    if (situationSummary.trim().length < 20) {
      setError("Tell us a bit more about your situation so a senior doctor can prepare properly");
      return;
    }
    setSubmitting(true);
    setError(null);
    setNeedsCredit(false);
    setSent(false);
    const result = await submitSeniorCaseReview({
      patientId,
      organisationId,
      situationSummary: situationSummary.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
      if (result.error.includes(SENIOR_CASE_REVIEW_CREDIT_REQUIRED_MARKER)) {
        setNeedsCredit(true);
      } else {
        setError(result.error);
      }
      return;
    }
    setSituationSummary("");
    setSent(true);
    void refresh();
  }

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Senior case review</Text>
      <MutedText>
        Managing more than one condition, or feel your plan isn&apos;t quite right? A senior
        doctor reviews your whole record and sends you a written plan, coordinated across
        everything you&apos;re managing.
      </MutedText>

      {needsCredit && (
        <Card style={{ gap: 8, backgroundColor: colors.brandTint }}>
          <Text style={{ fontSize: 13, color: colors.brandPressed }}>
            Buy a credit to request a review.
          </Text>
          <SecondaryButton
            title="Buy a credit in the browser"
            onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/care`)}
          />
        </Card>
      )}

      <TextInput
        value={situationSummary}
        onChangeText={setSituationSummary}
        placeholder="e.g. I'm managing diabetes and hypertension together and my energy levels have dropped since my last medication change. I'd like someone to look at the whole picture."
        multiline
        numberOfLines={4}
        style={[textInputStyle, { minHeight: 90, textAlignVertical: "top" }]}
      />
      {error && <ErrorText>{error}</ErrorText>}
      {sent && <MutedText>Sent to a senior doctor. Expect a written plan within 5 days.</MutedText>}
      <PrimaryButton title="Request review" onPress={submit} loading={submitting} />

      {loading && <ActivityIndicator color={colors.brand} />}
      {reviews.length > 0 && (
        <View style={{ gap: 10, marginTop: 4 }}>
          {reviews.map((r) => {
            const completed = r.status === "completed";
            return (
              <Card key={r.id} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink, flex: 1 }}>
                    {r.situation_summary}
                  </Text>
                  <Badge tone={completed ? "brand" : "neutral"}>
                    {completed ? "Plan ready" : r.status === "declined" ? "Declined" : "With a senior doctor"}
                  </Badge>
                </View>
                {r.status === "declined" && r.declined_reason && <ErrorText>{r.declined_reason}</ErrorText>}
                {completed && r.written_plan && (
                  <>
                    <Text style={{ fontSize: 13.5, color: colors.ink }}>{r.written_plan}</Text>
                    {r.reviewer && r.reviewed_at && (
                      <MutedText>
                        Dr. {r.reviewer.full_name} · {formatCareDate(r.reviewed_at)}
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
