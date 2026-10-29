import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import {
  READINESS_QUESTIONS,
  clearsForModerate,
  clearsForVigorous,
  loadExerciseProgrammes,
  loadLatestReadinessScreen,
  loadExerciseEnrollments,
  loadExerciseSessions,
  type ExerciseSessionLog,
  loadActivityGate,
  loadWorkoutPlans,
  type WorkoutPlan,
  submitReadinessScreen,
  enrollExerciseProgramme,
  type ExerciseProgramme,
  type ExerciseReadinessScreen,
  type ExerciseEnrollment,
  type ReadinessAnswers,
} from "@/lib/exercise";
import { t } from "@tarragon/i18n";
import { getProposedConfig } from "@tarragon/shared";
import { intensityAllowed, type ActivityGateResult } from "@tarragon/clinical/activity-gate";
import { orderPlans, type WorkoutPlanDisplayConfig } from "@tarragon/clinical/workout-plans";
import { usePatientAge } from "@/lib/use-patient-age";
import { ActivityGateCard } from "@/screens/sections/movement-extras";
import { EnrolmentProgress, ExerciseProgressHero, LogSessionCard, RecentSessions } from "@/screens/sections/exercise-sessions";
import { radius, spacing } from "@/ui/theme";
import { useLegacyColors, useTheme, textStyles } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton, SectionLabel } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

const INTENSITY_LABEL: Record<string, string> = {
  beginner: "Beginner",
  moderate: "Moderate",
  vigorous: "Vigorous",
};

const EMPTY_ANSWERS: ReadinessAnswers = {
  chest_pain: false,
  dizziness_or_balance: false,
  joint_bone_problem: false,
  doctor_advised_limit: false,
  heart_or_bp_condition: false,
  other_concern: "",
};

interface ExerciseScreenProps {
  patientId: string;
  organisationId: string;
}

/**
 * Native equivalent of apps/web/.../patient/exercise (spec §18.5/§18.6). No
 * entitlement gate: has_feature_access('lifestyle_coaching') resolves true
 * for every patient today (private.patient_has_feature_access's free-tier
 * allowlist), matching native lifestyle-screen.tsx's own precedent of
 * omitting the check rather than duplicating a gate that always passes.
 * The readiness screen and enrollment are plain RLS-scoped writes --
 * private.enforce_exercise_readiness is the real safety gate and is never
 * re-implemented here.
 */
export function ExerciseScreen({ patientId, organisationId }: ExerciseScreenProps) {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [programmes, setProgrammes] = useState<ExerciseProgramme[]>([]);
  const [screen, setScreen] = useState<ExerciseReadinessScreen | null>(null);
  const [enrollments, setEnrollments] = useState<ExerciseEnrollment[]>([]);
  const [sessions, setSessions] = useState<ExerciseSessionLog[]>([]);
  // null until the gate has answered; nothing is offered before then. An unreadable answer is the fail-closed one, never a permissive guess.
  const [gate, setGate] = useState<{ gate: ActivityGateResult; unavailable: boolean } | null>(null);
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const age = usePatientAge(patientId, Date.now());

  const [screenOpen, setScreenOpen] = useState(false);
  const [answers, setAnswers] = useState<ReadinessAnswers>(EMPTY_ANSWERS);
  const [screenSubmitting, setScreenSubmitting] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);

  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [justEnrolled, setJustEnrolled] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [programmesResult, screenResult, enrollmentsResult, gateResult, planResult, sessionsResult] = await Promise.all([
      loadExerciseProgrammes(),
      loadLatestReadinessScreen(patientId),
      loadExerciseEnrollments(patientId),
      loadActivityGate(),
      loadWorkoutPlans(),
      loadExerciseSessions(patientId),
    ]);
    setGate(gateResult);
    setPlans(planResult);
    if (programmesResult.ok) setProgrammes(programmesResult.data);
    if (screenResult.ok) setScreen(screenResult.data);
    if (enrollmentsResult.ok) setEnrollments(enrollmentsResult.data);
    if (sessionsResult.ok) setSessions(sessionsResult.data);
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const okModerate = clearsForModerate(screen);
  const okVigorous = clearsForVigorous(screen);

  async function handleSubmitReadiness() {
    setScreenSubmitting(true);
    setScreenError(null);
    const res = await submitReadinessScreen(patientId, organisationId, answers);
    setScreenSubmitting(false);
    if (res.error) {
      setScreenError(res.error);
      return;
    }
    setScreenOpen(false);
    setAnswers(EMPTY_ANSWERS);
    await load();
  }

  async function handleEnroll(programme: ExerciseProgramme) {
    setEnrolling(programme.id);
    setEnrollError(null);
    setJustEnrolled(null);
    const res = await enrollExerciseProgramme(patientId, organisationId, programme.id);
    setEnrolling(null);
    if (res.error) {
      setEnrollError(res.error);
      return;
    }
    setJustEnrolled(programme.id);
    await load();
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const resting = gate?.gate.decision === "rest";
  const displayCfg = getProposedConfig("activity.workout_plans").value as unknown as WorkoutPlanDisplayConfig;
  const orderedPlans = orderPlans(plans, age, displayCfg);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <ExerciseProgressHero sessions={sessions} />
      <ActivityGateCard gate={gate} />
      <LogSessionCard patientId={patientId} organisationId={organisationId} enrollments={enrollments} onLogged={load} />
      <RecentSessions patientId={patientId} sessions={sessions} onChanged={load} />
      <View>
        <ScreenTitle>Exercise programmes</ScreenTitle>
        <MutedText>
          Structured plans to build activity safely: a walking programme is open to anyone; anything more intensive
          asks a few safety questions first.
        </MutedText>
      </View>

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <SectionLabel>Exercise readiness</SectionLabel>
          <SecondaryButton
            title={screenOpen ? "Close" : screen ? "Retake" : "Take the screen"}
            onPress={() => setScreenOpen((v) => !v)}
          />
        </View>

        {screen && !screenOpen && (
          <MutedText>
            {screen.cleared_for_intensive
              ? "Your care team has cleared you for a more intensive programme."
              : screen.any_flag
                ? "You flagged something worth a clinician's look before starting a moderate or vigorous programme. Your care team will review it."
                : "No concerns flagged. You're clear to start a moderate-intensity programme. Vigorous programmes still need a clinician's sign-off."}
          </MutedText>
        )}
        {!screen && !screenOpen && (
          <MutedText>
            A beginner programme (walking, mobility) needs no screen. Anything more intensive asks a few quick
            safety questions first.
          </MutedText>
        )}

        {screenOpen && (
          <View style={{ gap: 10 }}>
            {READINESS_QUESTIONS.map((q) => (
              <View key={q.name} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <Text
                  onPress={() => setAnswers((a) => ({ ...a, [q.name]: !a[q.name] }))}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 5,
                    borderWidth: 1.5,
                    borderColor: answers[q.name] ? colors.brand : colors.border,
                    backgroundColor: answers[q.name] ? colors.brand : "transparent",
                    textAlign: "center",
                    ...textStyles.label,
                    lineHeight: 20,
                    color: "#fff",
                    
                  }}
                >
                  {answers[q.name] ? "✓" : ""}
                </Text>
                <AppText variant="body" onPress={() => setAnswers((a) => ({ ...a, [q.name]: !a[q.name] }))} style={{ flex: 1 }}>
                  {q.label}
                </AppText>
              </View>
            ))}
            <TextInput keyboardAppearance={scheme}
              placeholder="Anything else your care team should know? (optional)"
              placeholderTextColor={colors.subtle}
              value={answers.other_concern}
              onChangeText={(v) => setAnswers((a) => ({ ...a, other_concern: v }))}
              maxLength={300}
              multiline
              numberOfLines={2}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10, ...textStyles.body, color: colors.ink }}
            />
            {screenError ? <ErrorText>{screenError}</ErrorText> : null}
            <PrimaryButton title="Submit" loading={screenSubmitting} onPress={() => void handleSubmitReadiness()} />
          </View>
        )}
      </Card>

      {enrollments.length > 0 && (
        <Card style={{ gap: 8 }}>
          <SectionLabel>Your programmes</SectionLabel>
          {enrollments.map((e) => (
            <View key={e.id} style={{ paddingVertical: 4, gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>{e.programme?.title}</Text>
                <Badge tone={e.status === "active" ? "brand" : "neutral"}>{e.status}</Badge>
              </View>
              <EnrolmentProgress enrollment={e} sessions={sessions} />
            </View>
          ))}
        </Card>
      )}

      {plans.length > 0 && !resting ? (
        <Card style={{ gap: 10 }}>
          <SectionLabel>{t("activity.plans.title")}</SectionLabel>
          {orderedPlans.map((plan) => (
            <View key={plan.code} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 12, gap: 6 }}>
              <AppText variant="bodyStrong">{plan.title}</AppText>
              <Badge tone="neutral">{plan.format === "chair_class" ? t("activity.plans.chair") : t("activity.plans.home")}</Badge>
              {plan.sessions.map((s, i) => (
                <View key={i} style={{ gap: 2 }}>
                  <MutedText>{`${s.minutes} ${t("activity.plans.minutes")}`}</MutedText>
                  {s.steps.map((step, j) => (
                    <AppText variant="body" key={j}>{`${j + 1}. ${step}`}</AppText>
                  ))}
                </View>
              ))}
            </View>
          ))}
        </Card>
      ) : null}

      {!resting && gate ? (
      <Card style={{ gap: 10 }}>
        <SectionLabel>Programme catalogue</SectionLabel>
        {programmes.map((p) => {
          const cleared = p.intensity_level === "beginner" || (p.intensity_level === "moderate" ? okModerate : okVigorous);
          const gateAllows = intensityAllowed(gate.gate, p.intensity_level === "beginner" ? "gentle" : p.intensity_level);
          return (
            <View key={p.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 12, gap: 8 }}>
              <View>
                <AppText variant="bodyStrong">{p.title}</AppText>
                <MutedText>{p.summary}</MutedText>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  <Badge tone="neutral">{INTENSITY_LABEL[p.intensity_level]}</Badge>
                  {!p.clinician_reviewed && <Badge tone="neutral">Not yet clinically reviewed</Badge>}
                </View>
              </View>
              <SecondaryButton
                title={!gateAllows ? "Not right now" : cleared ? "Start" : "Needs clearance"}
                disabled={!cleared || !gateAllows}
                loading={enrolling === p.id}
                onPress={() => void handleEnroll(p)}
              />
              {justEnrolled === p.id && <MutedText>Started.</MutedText>}
            </View>
          );
        })}
        {enrollError ? <ErrorText>{enrollError}</ErrorText> : null}
      </Card>
      ) : null}
    </ScrollView>
  );
}
