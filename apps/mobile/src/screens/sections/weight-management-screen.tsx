import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import {
  loadLifestyleState,
  loadObesityAssessment,
  loadBariatricReferral,
  type LifestyleEnrollment,
  type ObesityAssessment,
  type BariatricReferral,
} from "@/lib/weight-management";
import { EnrollCta, EnrollmentCard, when } from "@/screens/sections/lifestyle-shared";
import type { SectionId } from "@/lib/sections";
import { colors, spacing } from "@/ui/theme";
import { Badge, Card, MutedText, ScreenTitle, SecondaryButton } from "@/ui/components";

const OBESITY_STATUS_COPY: Record<string, string> = {
  preclinical:
    "Your care team sees this as a risk state to get ahead of, with steady lifestyle support as the focus to keep you well.",
  clinical: "Your care team is managing this as an ongoing condition, with your lifestyle programme at the centre of your plan.",
};

const REFERRAL_STATUS_COPY: Record<string, string> = {
  proposed: "Your care team has proposed a specialist assessment.",
  referred: "You've been referred for a specialist assessment.",
  workup: "Your work-up for the specialist assessment is in progress.",
  scheduled: "Your specialist appointment is scheduled.",
  completed: "Your specialist assessment is complete.",
  declined: "This referral was declined.",
  not_eligible: "This wasn't a fit right now, based on your current assessment.",
};

interface WeightManagementScreenProps {
  userId: string;
  onNavigate: (section: SectionId) => void;
}

/**
 * "Your assessment, your programme, your trackers, and what your care team
 * is doing for you" — mirrors apps/web/.../weight-management/page.tsx:
 * doctor's obesity assessment, the obesity lifestyle programme (enrollment,
 * ED/mental-health screen gate, goals, quick check-in), bariatric-referral
 * status, and a pointer to the Learn library rather than a duplicated
 * education feed. Enrollment/ED-screen/logging route through
 * /api/mobile/lifestyle/* (see api.ts) since the underlying service
 * functions are either service-role-only or run clinical red-flag
 * evaluation that must not be reimplemented client-side; goal create/resolve
 * are plain RLS-scoped RPCs, called directly. Enrolment/check-in/goal UI is
 * shared with lifestyle-screen.tsx (htn/diabetes) via lifestyle-shared.tsx,
 * same discipline as the web app's own ConditionEnrollmentCard.
 */
export function WeightManagementScreen({ userId, onNavigate }: WeightManagementScreenProps) {
  const [assessment, setAssessment] = useState<ObesityAssessment | null>(null);
  const [referral, setReferral] = useState<BariatricReferral | null>(null);
  const [enrollment, setEnrollment] = useState<LifestyleEnrollment | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [assessmentResult, referralResult, stateResult] = await Promise.all([
      loadObesityAssessment(userId),
      loadBariatricReferral(userId),
      loadLifestyleState(userId),
    ]);
    setAssessment(assessmentResult);
    setReferral(referralResult);
    if (stateResult.ok) {
      setEnrollment(stateResult.data.find((e) => e.conditionKey === "obesity") ?? null);
    }
  }, [userId]);

  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refresh]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 16 }}
    >
      <View>
        <ScreenTitle>Weight management</ScreenTitle>
        <MutedText>Your assessment, your programme, your trackers, and what your care team is doing for you, all in one place.</MutedText>
      </View>

      {assessment && (
        <Card style={{ gap: 8 }}>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Your weight & health</Text>
          <MutedText>
            Your care team recorded this on {when(assessment.assessed_at)}. Weight is only one part of the
            picture, alongside your energy, sleep, blood pressure and how you feel, not a number on the scale.
          </MutedText>
          {assessment.clinical_status && OBESITY_STATUS_COPY[assessment.clinical_status] && (
            <Text style={{ fontSize: 13, color: colors.ink }}>{OBESITY_STATUS_COPY[assessment.clinical_status]}</Text>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {assessment.bmi != null && <Badge tone="brand">BMI {Number(assessment.bmi).toFixed(1)}</Badge>}
            {assessment.waist_risk && assessment.waist_risk !== "normal" && (
              <Badge>Waist: raised, worth tracking with your care team</Badge>
            )}
          </View>
        </Card>
      )}

      {enrollment ? (
        <EnrollmentCard enrollment={enrollment} onChanged={refresh} />
      ) : (
        <EnrollCta
          conditionKey="obesity"
          title="Start your weight management programme"
          description="A structured programme with goals you set, weekly check-ins, and doctor review, at your pace."
          onEnrolled={refresh}
        />
      )}

      {referral && (
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Specialist assessment</Text>
            <Badge tone={referral.status === "completed" ? "brand" : "neutral"}>{referral.status}</Badge>
          </View>
          <Text style={{ fontSize: 13, color: colors.ink }}>
            {REFERRAL_STATUS_COPY[referral.status] ?? "Your care team is coordinating a specialist assessment."}
          </Text>
          <MutedText>
            Raised {when(referral.referred_at)}. Questions about this are welcome, your care team can walk you
            through what happens next.
          </MutedText>
        </Card>
      )}

      <SecondaryButton title="See the full Learn library" onPress={() => onNavigate("learn")} />
    </ScrollView>
  );
}
