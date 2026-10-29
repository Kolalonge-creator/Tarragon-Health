import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  EXERCISE_EFFORTS,
  EXERCISE_KINDS,
  deleteExerciseSession,
  logExerciseSession,
  type ExerciseEnrollment,
  type ExerciseSessionLog,
} from "@/lib/exercise";
import { todayDateInput } from "@/lib/care";
import { dailyBars, programmeProgress, weekTotals, weeksInARow } from "@tarragon/clinical/exercise-progress";
import { radius } from "@/ui/theme";
import { useLegacyColors, useTheme } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, SecondaryButton, SectionLabel } from "@/ui/legacy-kit";

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function weekdayLetter(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
/** Length of a programme's own week-by-week plan; the catalogue carries no other schedule. */
function planWeeks(weeklyPlan: unknown): number {
  return Array.isArray(weeklyPlan) ? weeklyPlan.length : 0;
}

/** Last 7 days, counted only from logged sessions. With none logged it says so; no target is shown because none exists. */
export function ExerciseProgressHero({ sessions }: { sessions: readonly ExerciseSessionLog[] }) {
  const colors = useLegacyColors();
  const today = todayDateInput();
  const bars = useMemo(() => dailyBars(sessions, today), [sessions, today]);
  const totals = weekTotals(bars);
  const run = weeksInARow(sessions, today);
  const peak = Math.max(1, ...bars.map((b) => b.minutes));
  return (
    <Card style={{ gap: 12 }}>
      <SectionLabel>Last 7 days</SectionLabel>
      <View>
        <Text style={{ fontSize: sessions.length === 0 ? 22 : 36, fontWeight: "700", color: colors.ink }}>
          {sessions.length === 0 ? "No sessions logged yet" : `${totals.minutes} min`}
        </Text>
        <MutedText>
          {sessions.length === 0
            ? "Log a session below and your week will start to fill in."
            : totals.sessions === 0
              ? "Nothing logged this week yet. A short walk counts."
              : `${plural(totals.sessions, "session", "sessions")} on ${plural(totals.activeDays, "day", "days")}.`}
        </MutedText>
      </View>
      <View
        style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, height: 84 }}
        accessible
        accessibilityLabel={`Minutes of exercise per day, last 7 days: ${bars.map((b) => `${weekdayLetter(b.date)} ${b.minutes}`).join(", ")}`}
      >
        {bars.map((b) => (
          <View key={b.date} style={{ flex: 1, alignItems: "center", gap: 4 }}>
            <View style={{ height: 62, width: "100%", justifyContent: "flex-end" }}>
              <View
                style={{
                  width: "100%",
                  height: b.minutes > 0 ? Math.max(8, Math.round((b.minutes / peak) * 62)) : 4,
                  borderTopLeftRadius: 5,
                  borderTopRightRadius: 5,
                  backgroundColor: b.minutes > 0 ? colors.brand : colors.border,
                }}
              />
            </View>
            <Text style={{ fontSize: 11, color: colors.subtle }}>{weekdayLetter(b.date)}</Text>
          </View>
        ))}
      </View>
      {run > 0 && totals.sessions > 0 ? <Badge tone="brand">{run === 1 ? "Active this week" : `Active ${run} weeks in a row`}</Badge> : null}
    </Card>
  );
}

/** Where the person is in one programme's own plan, and what they logged against it. */
export function EnrolmentProgress({ enrollment, sessions }: { enrollment: ExerciseEnrollment; sessions: readonly ExerciseSessionLog[] }) {
  const colors = useLegacyColors();
  const weeks = planWeeks(enrollment.programme?.weekly_plan);
  if (enrollment.status !== "active" || weeks === 0) return null;
  const startedOn = new Date(enrollment.started_at).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const p = programmeProgress(startedOn, weeks, sessions, enrollment.id, todayDateInput());
  const elapsed = p.planLengthElapsed ? 100 : Math.round(((p.currentWeek - 1) / p.totalWeeks) * 100);
  return (
    <View style={{ gap: 6, paddingBottom: 6 }}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" }}>
        <View style={{ height: 6, width: `${Math.max(4, elapsed)}%`, backgroundColor: colors.brand }} />
      </View>
      <MutedText>
        {p.planLengthElapsed ? `You have reached the end of the ${p.totalWeeks}-week plan. ` : `Week ${p.currentWeek} of ${p.totalWeeks}. `}
        {p.sessionsLogged === 0
          ? "No sessions logged against it yet."
          : `${plural(p.sessionsLogged, "session", "sessions")}, ${p.minutesLogged} minutes logged.`}
      </MutedText>
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = useLegacyColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      style={{ paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.control, backgroundColor: selected ? colors.brand : colors.groupBg }}
    >
      <Text style={{ fontSize: 14, fontWeight: "600", color: selected ? "#FFFFFF" : colors.ink }}>{label}</Text>
    </Pressable>
  );
}

const DAY_CHOICES = [
  { back: 0, label: "Today" },
  { back: 1, label: "Yesterday" },
  { back: 2, label: "2 days ago" },
  { back: 3, label: "3 days ago" },
];

export function LogSessionCard({
  patientId,
  organisationId,
  enrollments,
  onLogged,
}: {
  patientId: string;
  organisationId: string;
  enrollments: readonly ExerciseEnrollment[];
  onLogged: () => Promise<void>;
}) {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const active = enrollments.filter((e) => e.status === "active");
  const [back, setBack] = useState(0);
  const [minutes, setMinutes] = useState("");
  const [kind, setKind] = useState<(typeof EXERCISE_KINDS)[number]["value"]>("walking");
  const [effort, setEffort] = useState<(typeof EXERCISE_EFFORTS)[number]["value"] | null>(null);
  const [enrollmentId, setEnrollmentId] = useState<string | null>(active.length === 1 ? active[0].id : null);
  const [symptom, setSymptom] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ symptom: boolean } | null>(null);

  async function submit() {
    setError(null);
    setDone(null);
    const n = Number(minutes);
    setSaving(true);
    const res = await logExerciseSession(patientId, organisationId, {
      performedOn: shiftDate(todayDateInput(), -back),
      minutes: n,
      kind,
      effort,
      symptomDuring: symptom,
      enrollmentId,
      note,
    });
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setDone({ symptom });
    setMinutes("");
    setEffort(null);
    setSymptom(false);
    setNote("");
    setBack(0);
    await onLogged();
  }

  return (
    <Card style={{ gap: 12 }}>
      <SectionLabel>Log a session</SectionLabel>
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>Day</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {DAY_CHOICES.map((c) => (
            <Chip key={c.back} label={c.label} selected={back === c.back} onPress={() => setBack(c.back)} />
          ))}
        </View>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>Minutes</Text>
        <TextInput
          keyboardAppearance={scheme}
          accessibilityLabel="Minutes"
          value={minutes}
          onChangeText={(v) => setMinutes(v.replace(/[^0-9]/g, "").slice(0, 3))}
          keyboardType="number-pad"
          placeholder="e.g. 20"
          placeholderTextColor={colors.subtle}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 12, fontSize: 16, color: colors.ink, backgroundColor: colors.card }}
        />
      </View>
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>What did you do?</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {EXERCISE_KINDS.map((k) => (
            <Chip key={k.value} label={k.label} selected={kind === k.value} onPress={() => setKind(k.value)} />
          ))}
        </View>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>How did it feel? (optional)</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {EXERCISE_EFFORTS.map((e) => (
            <Chip key={e.value} label={e.label} selected={effort === e.value} onPress={() => setEffort(effort === e.value ? null : e.value)} />
          ))}
        </View>
      </View>
      {active.length > 1 ? (
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>Part of a programme? (optional)</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {active.map((e) => (
              <Chip
                key={e.id}
                label={e.programme?.title ?? "Programme"}
                selected={enrollmentId === e.id}
                onPress={() => setEnrollmentId(enrollmentId === e.id ? null : e.id)}
              />
            ))}
          </View>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: symptom }}
        onPress={() => setSymptom((v) => !v)}
        style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}
      >
        <Text style={{ fontWeight: "700", fontSize: 16, color: symptom ? colors.brandPressed : colors.faint }}>{symptom ? "☑" : "☐"}</Text>
        <Text style={{ flex: 1, fontSize: 14, color: colors.ink }}>I had chest pain, dizziness or unusual breathlessness during it</Text>
      </Pressable>
      <TextInput
        keyboardAppearance={scheme}
        accessibilityLabel="Note"
        value={note}
        onChangeText={setNote}
        maxLength={300}
        placeholder="Note (optional)"
        placeholderTextColor={colors.subtle}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 12, fontSize: 14, color: colors.ink, backgroundColor: colors.card }}
      />
      <PrimaryButton title="Log session" onPress={() => void submit()} loading={saving} disabled={!minutes} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {done?.symptom ? (
        <MutedText>
          Thank you for telling us. Please stop and rest now. If the chest pain, dizziness or breathlessness has not eased, or you feel faint, go to the
          nearest hospital now. Even if it passes, mention it to your care team before your next session.
        </MutedText>
      ) : done ? (
        <MutedText>Logged. Well done.</MutedText>
      ) : null}
    </Card>
  );
}

export function RecentSessions({ patientId, sessions, onChanged }: { patientId: string; sessions: readonly ExerciseSessionLog[]; onChanged: () => Promise<void> }) {
  const colors = useLegacyColors();
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recent = sessions.slice(0, 10);
  if (recent.length === 0) return null;
  async function remove(id: string) {
    setError(null);
    setRemoving(id);
    const res = await deleteExerciseSession(patientId, id);
    setRemoving(null);
    if (res.error) setError(res.error);
    await onChanged();
  }
  return (
    <Card style={{ gap: 8 }}>
      <SectionLabel>Recent sessions</SectionLabel>
      {recent.map((s) => (
        <View key={s.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>
              {`${s.performed_on}: ${s.duration_minutes} min, ${EXERCISE_KINDS.find((k) => k.value === s.kind)?.label.toLowerCase() ?? s.kind}`}
            </Text>
            {s.effort || s.symptom_during ? (
              <MutedText>
                {[s.effort ? EXERCISE_EFFORTS.find((e) => e.value === s.effort)?.label : null, s.symptom_during ? "You noted a symptom" : null]
                  .filter(Boolean)
                  .join(" · ")}
              </MutedText>
            ) : null}
          </View>
          <SecondaryButton title="Remove" onPress={() => void remove(s.id)} disabled={removing === s.id} />
        </View>
      ))}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}
