import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { postLifestyleEnroll, postObesityEdScreenAndEnroll, postLifestyleLog } from "@/lib/api";
import {
  loadLifestyleState,
  loadObesityAssessment,
  loadBariatricReferral,
  createPersonalisedGoal,
  resolvePersonalisedGoal,
  type LifestyleEnrollment,
  type ObesityAssessment,
  type BariatricReferral,
  type LpeGoalModule,
} from "@/lib/weight-management";
import type { SectionId } from "@/lib/sections";
import { colors, radius, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/components";
import { SupervisedWeightManagementCard } from "@/screens/sections/supervised-weight-management-card";

const textInputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 14,
  color: colors.ink,
} as const;

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

const SCOFF_ITEMS: { key: "scoff_sick" | "scoff_control" | "scoff_one_stone" | "scoff_fat" | "scoff_food_dominates"; label: string }[] = [
  { key: "scoff_sick", label: "Do you make yourself sick because you feel uncomfortably full?" },
  { key: "scoff_control", label: "Do you worry you have lost control over how much you eat?" },
  { key: "scoff_one_stone", label: "Have you recently lost more than 6 kg in the last 3 months?" },
  { key: "scoff_fat", label: "Do you believe yourself to be fat when others say you are too thin?" },
  { key: "scoff_food_dominates", label: "Would you say that food dominates your life?" },
];

const DISORDERED_BEHAVIOURS: { code: string; label: string }[] = [
  { code: "binge", label: "Binge eating with loss of control" },
  { code: "purging", label: "Self-induced vomiting / laxative / diuretic misuse" },
  { code: "restriction", label: "Extreme restriction or fasting" },
  { code: "driven_exercise", label: "Driven, compulsive exercise" },
  { code: "night_eating", label: "Night eating" },
];

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

function Checkbox({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <Text onPress={onToggle} style={{ fontSize: 13, color: colors.ink, paddingVertical: 4 }}>
      <Text style={{ fontWeight: "700", color: checked ? colors.brand : colors.faint }}>{checked ? "☑ " : "☐ "}</Text>
      {label}
    </Text>
  );
}

interface WeightManagementScreenProps {
  userId: string;
  organisationId: string;
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
 * are plain RLS-scoped RPCs, called directly.
 */
export function WeightManagementScreen({ userId, organisationId, onNavigate }: WeightManagementScreenProps) {
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

      {/* A separate, paid track from the free lifestyle coaching below: a
          doctor supervising weight-loss medication you obtained yourself.
          Placed first so the two don't get confused — mirrors
          weight-management-panel.tsx, which lives on its own web route. */}
      <SupervisedWeightManagementCard organisationId={organisationId} patientId={userId} />

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
        <EnrollCta onEnrolled={refresh} />
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

function EnrollCta({ onEnrolled }: { onEnrolled: () => void }) {
  const [consented, setConsented] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [needsEdScreen, setNeedsEdScreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await postLifestyleEnroll("obesity", consented);
    setSubmitting(false);
    if (result.needsEdScreen) {
      setNeedsEdScreen(true);
      return;
    }
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessage(result.message ?? null);
    setTimeout(onEnrolled, 800);
  }

  if (needsEdScreen) {
    return <EdScreenForm consented={consented} onDone={onEnrolled} />;
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Start your weight management programme</Text>
      <MutedText>A structured programme with goals you set, weekly check-ins, and doctor review, at your pace.</MutedText>
      {message && <MutedText>{message}</MutedText>}
      {error && <ErrorText>{error}</ErrorText>}
      <Checkbox
        checked={consented}
        onToggle={() => setConsented((v) => !v)}
        label="I agree that my logged readings and check-ins can be reviewed by my Tarragon care team to support this programme, and I can withdraw at any time."
      />
      <PrimaryButton title="Start now" onPress={submit} disabled={!consented} loading={submitting} />
    </Card>
  );
}

function EdScreenForm({ consented, onDone }: { consented: boolean; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [behaviours, setBehaviours] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleBehaviour(code: string) {
    setBehaviours((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await postObesityEdScreenAndEnroll({
      consent: consented,
      scoff_sick: answers.scoff_sick,
      scoff_control: answers.scoff_control,
      scoff_one_stone: answers.scoff_one_stone,
      scoff_fat: answers.scoff_fat,
      scoff_food_dominates: answers.scoff_food_dominates,
      self_harm_risk: answers.self_harm_risk,
      low_mood: answers.low_mood,
      disordered_behaviours: behaviours,
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setTimeout(onDone, 800);
  }

  return (
    <Card style={{ gap: 10 }}>
      <MutedText>
        Before we start on weight or eating goals, a few quick questions: this is just so your care team can
        support you well from day one.
      </MutedText>

      {SCOFF_ITEMS.map((item) => (
        <Checkbox
          key={item.key}
          checked={!!answers[item.key]}
          onToggle={() => setAnswers((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
          label={item.label}
        />
      ))}

      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink, marginTop: 6 }}>Any of these lately?</Text>
      {DISORDERED_BEHAVIOURS.map((b) => (
        <Checkbox key={b.code} checked={behaviours.includes(b.code)} onToggle={() => toggleBehaviour(b.code)} label={b.label} />
      ))}

      <Checkbox
        checked={!!answers.low_mood}
        onToggle={() => setAnswers((prev) => ({ ...prev, low_mood: !prev.low_mood }))}
        label="Feeling low, hopeless, or more anxious than usual lately"
      />
      <Checkbox
        checked={!!answers.self_harm_risk}
        onToggle={() => setAnswers((prev) => ({ ...prev, self_harm_risk: !prev.self_harm_risk }))}
        label="Any thoughts of harming yourself"
      />

      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink, marginTop: 4 }}>
        Anything else you&apos;d like your care team to know?
      </Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        numberOfLines={2}
        style={[textInputStyle, { minHeight: 60, textAlignVertical: "top" }]}
      />

      {error && <ErrorText>{error}</ErrorText>}
      <PrimaryButton title="Continue" onPress={submit} loading={submitting} />
    </Card>
  );
}

function EnrollmentCard({ enrollment, onChanged }: { enrollment: LifestyleEnrollment; onChanged: () => void }) {
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
          {enrollment.programmeName ?? enrollment.condition}
        </Text>
        <Badge tone={enrollment.status === "active" ? "brand" : "neutral"}>{enrollment.status}</Badge>
      </View>

      {enrollment.status === "paused" ? (
        <MutedText>This programme is paused while your care team checks in with you. We&apos;re here to support you.</MutedText>
      ) : (
        <>
          {enrollment.currentPhaseName && (
            <Text style={{ fontSize: 13, color: colors.ink }}>
              Current phase: <Text style={{ fontWeight: "700" }}>{enrollment.currentPhaseName}</Text>
            </Text>
          )}
          {enrollment.goals.map((g) => (
            <GoalRow key={g.id} goal={g} onChanged={onChanged} />
          ))}
          {enrollment.nextReviewDue && (
            <MutedText>Next care-team review: {when(enrollment.nextReviewDue)}</MutedText>
          )}
          <QuickCheckIn enrollment={enrollment} />
          <AddGoalForm enrollmentId={enrollment.id} onAdded={onChanged} />
        </>
      )}
    </Card>
  );
}

function GoalRow({ goal, onChanged }: { goal: { id: string; module: string; title: string; personalised: boolean }; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function resolve(status: "achieved" | "abandoned") {
    setBusy(true);
    const result = await resolvePersonalisedGoal(goal.id, status);
    setBusy(false);
    if (result.ok) {
      setDone(status === "achieved" ? "Nice work, marked as achieved." : "Goal removed.");
      onChanged();
    }
  }

  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <Text style={{ fontSize: 13, color: colors.ink, flex: 1 }}>
        <Text style={{ color: colors.muted, textTransform: "capitalize" }}>{goal.module}</Text> {goal.title}
      </Text>
      {done ? (
        <MutedText>{done}</MutedText>
      ) : goal.personalised ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Text onPress={() => !busy && resolve("achieved")} style={{ fontSize: 12, fontWeight: "600", color: colors.brand }}>
            Mark achieved
          </Text>
          <Text onPress={() => !busy && resolve("abandoned")} style={{ fontSize: 12, color: colors.muted }}>
            Let this go
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function QuickCheckIn({ enrollment }: { enrollment: LifestyleEnrollment }) {
  const [type, setType] = useState<"mood" | "weight" | "activity_minutes">("mood");
  const [value, setValue] = useState("");
  const [strugglingWithFood, setStrugglingWithFood] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const TYPE_LABEL: Record<typeof type, string> = {
    mood: "How I'm feeling",
    weight: "Weight (kg)",
    activity_minutes: "Active minutes",
  };

  async function submit() {
    setError(null);
    setMessage(null);
    setSubmitting(true);
    const result = await postLifestyleLog({
      enrollmentId: enrollment.id,
      conditionKey: "obesity",
      type,
      value: value ? Number(value) : undefined,
      strugglingWithFood,
    });
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessage(result.message ?? "Logged.");
    setValue("");
    setStrugglingWithFood(false);
  }

  return (
    <View style={{ gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 10 }}>
      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>Quick check-in</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["mood", "weight", "activity_minutes"] as const).map((t) => (
          <Text
            key={t}
            onPress={() => setType(t)}
            style={{
              fontSize: 12,
              fontWeight: "600",
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 999,
              backgroundColor: type === t ? colors.brand : colors.groupBg,
              color: type === t ? "#FFFFFF" : colors.ink,
            }}
          >
            {TYPE_LABEL[t]}
          </Text>
        ))}
      </View>
      <TextInput value={value} onChangeText={setValue} placeholder="Value (e.g. 3)" keyboardType="numeric" style={textInputStyle} />
      <Checkbox
        checked={strugglingWithFood}
        onToggle={() => setStrugglingWithFood((v) => !v)}
        label="I've been struggling with food or eating lately"
      />
      {message && <MutedText>{message}</MutedText>}
      {error && <ErrorText>{error}</ErrorText>}
      <SecondaryButton title="Log check-in" onPress={submit} loading={submitting} />
    </View>
  );
}

const GOAL_MODULES: LpeGoalModule[] = ["diet", "activity", "behaviour", "sleep", "stress", "smoking"];

function AddGoalForm({ enrollmentId, onAdded }: { enrollmentId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [module, setModule] = useState<LpeGoalModule>("diet");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await createPersonalisedGoal({ enrollmentId, module, title });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTitle("");
    setOpen(false);
    onAdded();
  }

  if (!open) {
    return (
      <Text onPress={() => setOpen(true)} style={{ fontSize: 13, fontWeight: "600", color: colors.brand }}>
        + Add a goal
      </Text>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {GOAL_MODULES.map((m) => (
          <Text
            key={m}
            onPress={() => setModule(m)}
            style={{
              fontSize: 12,
              fontWeight: "600",
              paddingVertical: 5,
              paddingHorizontal: 9,
              borderRadius: 999,
              backgroundColor: module === m ? colors.brand : colors.groupBg,
              color: module === m ? "#FFFFFF" : colors.ink,
              textTransform: "capitalize",
            }}
          >
            {m}
          </Text>
        ))}
      </View>
      <TextInput value={title} onChangeText={setTitle} placeholder="Describe your goal" style={textInputStyle} />
      {error && <ErrorText>{error}</ErrorText>}
      <SecondaryButton title="Save goal" onPress={submit} loading={submitting} />
    </View>
  );
}
