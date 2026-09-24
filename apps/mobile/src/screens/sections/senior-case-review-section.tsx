import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { loadMySeniorCaseReviews, type SeniorCaseReviewWithReviewer } from "@/lib/senior-case-review";
import { formatCareDate } from "@/lib/care";
import { colors } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText } from "@/ui/components";

/**
 * Native "Senior case review" — retired from patient purchase 2026-09-24
 * (founder decision; see migration
 * 20260924055301_retire_senior_case_review_verified_documents_confidential_message.sql
 * and the matching change to
 * apps/web/src/app/(dashboard)/patient/senior-case-review-card.tsx). There is
 * no request form here any more, only a read-only history so a patient with
 * a review already requested or completed before the retirement still has
 * somewhere to find their written plan. Renders nothing once a patient has
 * no reviews at all.
 */
export function SeniorCaseReviewSection({ patientId }: { patientId: string }) {
  const [reviews, setReviews] = useState<SeniorCaseReviewWithReviewer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadMySeniorCaseReviews(patientId).then((result) => {
      if (cancelled) return;
      if (result.ok) setReviews(result.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  if (loading) return <ActivityIndicator color={colors.brand} />;
  if (reviews.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Senior case review</Text>
      <View style={{ gap: 10 }}>
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
    </View>
  );
}
