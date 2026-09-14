import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import {
  READINESS_QUESTIONS,
  clearsForModerate,
  clearsForVigorous,
  loadExerciseProgrammes,
  loadLatestReadinessScreen,
  loadExerciseEnrollments,
  submitReadinessScreen,
  enrollExerciseProgramme,
  type ExerciseProgramme,
  type ExerciseReadinessScreen,
  type ExerciseEnrollment,
  type ReadinessAnswers,
} from "@/lib/exercise";
import { colors, radius, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton, SectionLabel } from "@/ui/components";

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
  const [loading, setLoading] = useState(true);
  const [programmes, setProgrammes] = useState<ExerciseProgramme[]>([]);
  const [screen, setScreen] = useState<ExerciseReadinessScreen | null>(null);
  const [enrollments, setEnrollments] = useState<ExerciseEnrollment[]>([]);

  const [screenOpen, setScreenOpen] = useState(false);
  const [answers, setAnswers] = useState<ReadinessAnswers>(EMPTY_ANSWERS);
  const [screenSubmitting, setScreenSubmitting] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);

  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [justEnrolled, setJustEnrolled] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [programmesResult, screenResult, enrollmentsResult] = await Promise.all([
      loadExerciseProgrammes(),
      loadLatestReadinessScreen(patientId),
      loadExerciseEnrollments(patientId),
    ]);
    if (programmesResult.ok) setProgrammes(programmesResult.data);
    if (screenResult.ok) setScreen(screenResult.data);
    if (enrollmentsResult.ok) setEnrollments(enrollmentsResult.data);
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

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
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
                    lineHeight: 20,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: "700",
                  }}
                >
                  {answers[q.name] ? "✓" : ""}
                </Text>
                <Text style={{ flex: 1, fontSize: 13.5, color: colors.ink }} onPress={() => setAnswers((a) => ({ ...a, [q.name]: !a[q.name] }))}>
                  {q.label}
                </Text>
              </View>
            ))}
            <TextInput
              placeholder="Anything else your care team should know? (optional)"
              placeholderTextColor={colors.faint}
              value={answers.other_concern}
              onChangeText={(v) => setAnswers((a) => ({ ...a, other_concern: v }))}
              maxLength={300}
              multiline
              numberOfLines={2}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10, fontSize: 14, color: colors.ink }}
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
            <View key={e.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}>
              <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>{e.programme?.title}</Text>
              <Badge tone={e.status === "active" ? "brand" : "neutral"}>{e.status}</Badge>
            </View>
          ))}
        </Card>
      )}

      <Card style={{ gap: 10 }}>
        <SectionLabel>Programme catalogue</SectionLabel>
        {programmes.map((p) => {
          const cleared = p.intensity_level === "beginner" || (p.intensity_level === "moderate" ? okModerate : okVigorous);
          return (
            <View key={p.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 12, gap: 8 }}>
              <View>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>{p.title}</Text>
                <MutedText>{p.summary}</MutedText>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  <Badge tone="neutral">{INTENSITY_LABEL[p.intensity_level]}</Badge>
                  {!p.clinician_reviewed && <Badge tone="neutral">Not yet clinically reviewed</Badge>}
                </View>
              </View>
              <SecondaryButton
                title={cleared ? "Start" : "Needs clearance"}
                disabled={!cleared}
                loading={enrolling === p.id}
                onPress={() => void handleEnroll(p)}
              />
              {justEnrolled === p.id && <MutedText>Started.</MutedText>}
            </View>
          );
        })}
        {enrollError ? <ErrorText>{enrollError}</ErrorText> : null}
      </Card>
    </ScrollView>
  );
}
