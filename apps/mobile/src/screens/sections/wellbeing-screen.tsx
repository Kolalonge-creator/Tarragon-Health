import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, View } from "react-native";
import { postMentalHealthScreen } from "@/lib/api";
import { TherapyNetworkScreen } from "@/screens/sections/therapy-network-screen";
import {
  loadLatestWellbeingCheckin,
  loadWellbeingCheckinFrequencyDays,
  loadNextReviewDue,
  submitWellbeingCheckin,
  updateWellbeingCheckinFrequency,
  bandHigherIsBetter,
  bandLowerIsBetter,
  wellbeingBandLabel,
  WELLBEING_SCALE_QUESTIONS,
  type WellbeingCheckin,
} from "@/lib/wellbeing";
import {
  loadLatestMentalHealthScreens,
  FREQUENCY_OPTIONS,
  PHQ9_QUESTIONS,
  GAD7_QUESTIONS,
  AUDITC_QUESTIONS,
  EPDS_QUESTIONS,
  PHQ9_BAND_LABEL,
  GAD7_BAND_LABEL,
  AUDITC_BAND_LABEL,
  EPDS_BAND_LABEL,
  type MentalHealthScreen,
} from "@/lib/mental-health";
import type { SectionId } from "@/lib/sections";
import { colors, radius, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/components";

const textInputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  paddingHorizontal: 10,
  paddingVertical: 8,
  borderRadius: radius.control,
  fontSize: 14,
  color: colors.ink,
} as const;

function ScalePicker({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Text
          key={n}
          onPress={() => onChange(n)}
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            textAlign: "center",
            textAlignVertical: "center",
            lineHeight: 34,
            fontSize: 13,
            fontWeight: "700",
            backgroundColor: value === n ? colors.brand : colors.groupBg,
            color: value === n ? "#FFFFFF" : colors.ink,
            overflow: "hidden",
          }}
        >
          {n}
        </Text>
      ))}
    </View>
  );
}

function OptionPicker({ options, value, onChange }: { options: readonly string[]; value: number | null; onChange: (v: number) => void }) {
  return (
    <View style={{ gap: 6 }}>
      {options.map((label, v) => (
        <Text
          key={v}
          onPress={() => onChange(v)}
          style={{
            fontSize: 12.5,
            paddingVertical: 7,
            paddingHorizontal: 10,
            borderRadius: radius.control,
            borderWidth: 1,
            borderColor: value === v ? colors.brand : colors.border,
            backgroundColor: value === v ? colors.brandTint : "transparent",
            color: colors.ink,
          }}
        >
          {label}
        </Text>
      ))}
    </View>
  );
}

interface WellbeingScreenProps {
  patientId: string;
  organisationId: string;
  onNavigate: (section: SectionId) => void;
}

/**
 * "Track how you're doing, take a mental health check-in, and learn ways to
 * support yourself" — mirrors apps/web/.../(sections)/wellbeing/page.tsx:
 * wellbeing tiles, the quick self check-in, the mental-health summary, and
 * the full PHQ-9/GAD-7/AUDIT-C/EPDS screen. The screen's scoring and crisis
 * routing go through /api/mobile/mental-health-screen (see api.ts) — that
 * logic is never duplicated client-side. "Book a therapy session" opens the
 * native TherapyNetworkScreen (mirrors therapy-network.tsx) — it used to
 * just navigate to the generic Appointments screen, which has no
 * therapist-picking logic at all, so the button promised a flow that did not
 * exist. The education feed stays on web for now; medications link to its
 * already-native screen.
 */
export function WellbeingScreen({ patientId, organisationId, onNavigate }: WellbeingScreenProps) {
  const [checkin, setCheckin] = useState<WellbeingCheckin | null>(null);
  const [therapyOpen, setTherapyOpen] = useState(false);
  const [frequencyDays, setFrequencyDays] = useState(7);
  const [nextReviewDue, setNextReviewDue] = useState<string | null>(null);
  const [screens, setScreens] = useState<Partial<Record<string, MentalHealthScreen>>>({});
  const [loading, setLoading] = useState(true);
  const [showScreenForm, setShowScreenForm] = useState(false);

  const refresh = useCallback(async () => {
    const [c, f, r, s] = await Promise.all([
      loadLatestWellbeingCheckin(patientId),
      loadWellbeingCheckinFrequencyDays(patientId),
      loadNextReviewDue(patientId),
      loadLatestMentalHealthScreens(patientId),
    ]);
    setCheckin(c);
    setFrequencyDays(f);
    setNextReviewDue(r);
    setScreens(s);
  }, [patientId]);

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

  const daysSince = checkin ? Math.floor((Date.now() - new Date(checkin.checked_in_at).getTime()) / 86400000) : null;
  const isDue = daysSince === null || daysSince >= frequencyDays;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 16 }}
    >
      <View>
        <ScreenTitle>Wellbeing</ScreenTitle>
        <MutedText>Track how you&apos;re doing, take a mental health check-in, and learn ways to support yourself.</MutedText>
      </View>

      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Your wellbeing</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Tile label="Mood" value={checkin ? wellbeingBandLabel(bandHigherIsBetter(checkin.mood_score)) : null} />
          <Tile label="Stress" value={checkin ? wellbeingBandLabel(bandLowerIsBetter(checkin.stress_score)) : null} />
          <Tile label="Sleep" value={checkin ? wellbeingBandLabel(bandHigherIsBetter(checkin.sleep_quality)) : null} />
          <Tile label="Check-in" value={isDue ? "Due" : "Up to date"} />
        </View>
        {nextReviewDue && <MutedText>Next review: {new Date(nextReviewDue).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}</MutedText>}
        {!checkin && <MutedText>Log your first check-in below to see your mood, stress and sleep at a glance.</MutedText>}
      </Card>

      <CheckinForm
        patientId={patientId}
        organisationId={organisationId}
        frequencyDays={frequencyDays}
        onSaved={refresh}
      />

      <MentalHealthSummaryCard screens={screens} />

      {showScreenForm ? (
        <MentalHealthScreenForm onDone={() => { setShowScreenForm(false); void refresh(); }} />
      ) : (
        <SecondaryButton title="Take the full mental wellbeing check-in" onPress={() => setShowScreenForm(true)} />
      )}

      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Talk to someone</Text>
        <MutedText>Book a session with one of our therapists, over telemedicine or in person, whichever suits you.</MutedText>
        <SecondaryButton title="Book a therapy session" onPress={() => setTherapyOpen(true)} />
      </Card>

      <Card style={{ gap: 6 }}>
        <MutedText>
          Any medicine your care team has started for you (including for your mental wellbeing) is tracked with
          your other medications: adherence, side effects, and reviews all in one place.
        </MutedText>
        <SecondaryButton title="View your medications" onPress={() => onNavigate("medications")} />
      </Card>

      <SecondaryButton title="See the full Learn library" onPress={() => onNavigate("learn")} />

      <Modal visible={therapyOpen} animationType="slide" onRequestClose={() => setTherapyOpen(false)}>
        <TherapyNetworkScreen
          organisationId={organisationId}
          patientId={patientId}
          onClose={() => setTherapyOpen(false)}
        />
      </Modal>
    </ScrollView>
  );
}

function Tile({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10, minWidth: 110 }}>
      <Text style={{ fontSize: 10.5, textTransform: "uppercase", color: colors.muted }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink, marginTop: 2 }}>{value ?? "No check-in yet"}</Text>
    </View>
  );
}

function CheckinForm({
  patientId,
  organisationId,
  frequencyDays,
  onSaved,
}: {
  patientId: string;
  organisationId: string;
  frequencyDays: number;
  onSaved: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freq, setFreq] = useState(frequencyDays);
  const [savingFreq, setSavingFreq] = useState(false);

  async function submit() {
    setError(null);
    setMessage(null);
    if (WELLBEING_SCALE_QUESTIONS.some((q) => !answers[q.name])) {
      setError("Please answer every question");
      return;
    }
    setSubmitting(true);
    const result = await submitWellbeingCheckin({
      patientId,
      organisationId,
      moodScore: answers.mood_score,
      stressScore: answers.stress_score,
      sleepQuality: answers.sleep_quality,
      activityLevel: answers.activity_level,
      note: note.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("Check-in saved.");
    setAnswers({});
    setNote("");
    onSaved();
  }

  async function saveFrequency(days: number) {
    setFreq(days);
    setSavingFreq(true);
    await updateWellbeingCheckinFrequency(patientId, organisationId, days);
    setSavingFreq(false);
  }

  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>How are you doing today?</Text>
      {WELLBEING_SCALE_QUESTIONS.map((q) => (
        <View key={q.name} style={{ gap: 6 }}>
          <Text style={{ fontSize: 13, color: colors.ink }}>{q.prompt}</Text>
          <ScalePicker value={answers[q.name] ?? null} onChange={(v) => setAnswers((prev) => ({ ...prev, [q.name]: v }))} />
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <MutedText>{q.low}</MutedText>
            <MutedText>{q.high}</MutedText>
          </View>
        </View>
      ))}
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 13, color: colors.ink }}>Anything else you&apos;d like to note? (optional)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          multiline
          numberOfLines={2}
          maxLength={500}
          style={[textInputStyle, { minHeight: 60, textAlignVertical: "top" }]}
        />
      </View>
      {error && <ErrorText>{error}</ErrorText>}
      {message && <MutedText>{message}</MutedText>}
      <PrimaryButton title="Save check-in" onPress={submit} loading={submitting} />

      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, gap: 8 }}>
        <Text style={{ fontSize: 13, color: colors.ink }}>Remind me to check in every</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {[
            { value: 1, label: "Day" },
            { value: 3, label: "3 days" },
            { value: 7, label: "Week" },
            { value: 14, label: "2 weeks" },
            { value: 30, label: "Month" },
          ].map((o) => (
            <Text
              key={o.value}
              onPress={() => void saveFrequency(o.value)}
              style={{
                fontSize: 12,
                fontWeight: "600",
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 999,
                backgroundColor: freq === o.value ? colors.brand : colors.groupBg,
                color: freq === o.value ? "#FFFFFF" : colors.ink,
                opacity: savingFreq ? 0.6 : 1,
              }}
            >
              {o.label}
            </Text>
          ))}
        </View>
      </View>
    </Card>
  );
}

function MentalHealthSummaryCard({ screens }: { screens: Partial<Record<string, MentalHealthScreen>> }) {
  const { phq9, gad7, auditc, epds } = screens;
  if (!phq9 && !gad7 && !auditc && !epds) return null;

  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Mental wellbeing</Text>
      {phq9 && (
        <SummaryRow label="Mood (PHQ-9)" bandLabel={PHQ9_BAND_LABEL[phq9.severity_band] ?? phq9.severity_band} flagged={phq9.crisis_flagged} />
      )}
      {gad7 && <SummaryRow label="Anxiety (GAD-7)" bandLabel={GAD7_BAND_LABEL[gad7.severity_band] ?? gad7.severity_band} />}
      {auditc && (
        <SummaryRow
          label="Alcohol (AUDIT-C)"
          bandLabel={AUDITC_BAND_LABEL[auditc.severity_band] ?? auditc.severity_band}
          flagged={auditc.hazardous}
          flagLabel="Higher risk"
        />
      )}
      {epds && (
        <SummaryRow
          label="Postnatal wellbeing (EPDS)"
          bandLabel={EPDS_BAND_LABEL[epds.severity_band] ?? epds.severity_band}
          flagged={epds.crisis_flagged}
        />
      )}
      <MutedText>Your care team can see these and will reach out if anything needs support.</MutedText>
    </Card>
  );
}

function SummaryRow({
  label,
  bandLabel,
  flagged,
  flagLabel = "Needs attention",
}: {
  label: string;
  bandLabel: string;
  flagged?: boolean | null;
  flagLabel?: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ fontSize: 13, color: colors.ink }}>{label}</Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {flagged && <Badge>{flagLabel}</Badge>}
        <Badge tone="neutral">{bandLabel}</Badge>
      </View>
    </View>
  );
}

function MentalHealthScreenForm({ onDone }: { onDone: () => void }) {
  const [phq9, setPhq9] = useState<(number | null)[]>(Array(9).fill(null));
  const [gad7, setGad7] = useState<(number | null)[]>(Array(7).fill(null));
  const [auditc, setAuditc] = useState<(number | null)[]>(Array(3).fill(null));
  const [isPerinatal, setIsPerinatal] = useState(false);
  const [epds, setEpds] = useState<(number | null)[]>(Array(10).fill(null));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ crisis?: boolean } | null>(null);

  async function submit() {
    setError(null);
    if (phq9.some((v) => v === null) || gad7.some((v) => v === null) || auditc.some((v) => v === null)) {
      setError("Please answer every question");
      return;
    }
    if (isPerinatal && epds.some((v) => v === null)) {
      setError("Please answer every postnatal question, or uncheck that box");
      return;
    }
    setSubmitting(true);
    const answers: Record<string, number | boolean> = { is_perinatal: isPerinatal };
    phq9.forEach((v, i) => (answers[`phq9_${i + 1}`] = v!));
    gad7.forEach((v, i) => (answers[`gad7_${i + 1}`] = v!));
    auditc.forEach((v, i) => (answers[`auditc_${i + 1}`] = v!));
    if (isPerinatal) epds.forEach((v, i) => (answers[`epds_${i + 1}`] = v!));
    const res = await postMentalHealthScreen(answers);
    setSubmitting(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setResult({ crisis: res.crisis });
  }

  if (result) {
    return (
      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Thanks for checking in</Text>
        <MutedText>Your answers are saved and your care team can see them.</MutedText>
        {result.crisis && (
          <View style={{ backgroundColor: "#FDECEC", borderRadius: radius.card, padding: 10 }}>
            <Text style={{ fontSize: 13, color: colors.status.critical }}>
              You told us you have had thoughts of harming yourself. You are not alone. A member of your care
              team will reach out. If you are in immediate danger, please contact emergency services or go to
              the nearest hospital now.
            </Text>
          </View>
        )}
        <SecondaryButton title="Close" onPress={onDone} />
      </Card>
    );
  }

  return (
    <Card style={{ gap: 14 }}>
      <MutedText>
        Over the last two weeks, how often have you been bothered by the following? This is a normal part of a
        whole-body check, and your answers stay private to your care team.
      </MutedText>

      <Section title="How you have been feeling">
        {PHQ9_QUESTIONS.map((q, i) => (
          <FrequencyQuestion key={i} prompt={q} value={phq9[i]} onChange={(v) => setPhq9((prev) => prev.map((p, idx) => (idx === i ? v : p)))} />
        ))}
      </Section>

      <Section title="Worry and anxiety">
        {GAD7_QUESTIONS.map((q, i) => (
          <FrequencyQuestion key={i} prompt={q} value={gad7[i]} onChange={(v) => setGad7((prev) => prev.map((p, idx) => (idx === i ? v : p)))} />
        ))}
      </Section>

      <Section title="Alcohol">
        {AUDITC_QUESTIONS.map((q, i) => (
          <View key={i} style={{ gap: 6 }}>
            <Text style={{ fontSize: 13, color: colors.ink }}>{q.prompt}</Text>
            <OptionPicker options={q.options} value={auditc[i]} onChange={(v) => setAuditc((prev) => prev.map((p, idx) => (idx === i ? v : p)))} />
          </View>
        ))}
      </Section>

      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 10, gap: 10 }}>
        <Text onPress={() => setIsPerinatal((v) => !v)} style={{ fontSize: 13, color: colors.ink }}>
          <Text style={{ fontWeight: "700" }}>{isPerinatal ? "☑ " : "☐ "}</Text>
          I am currently pregnant, or have given birth in the last 12 months
        </Text>
        {isPerinatal && (
          <Section title="How you have been feeling since your pregnancy or birth">
            {EPDS_QUESTIONS.map((q, i) => (
              <View key={i} style={{ gap: 6 }}>
                <Text style={{ fontSize: 13, color: colors.ink }}>{q.prompt}</Text>
                <OptionPicker options={q.options} value={epds[i]} onChange={(v) => setEpds((prev) => prev.map((p, idx) => (idx === i ? v : p)))} />
              </View>
            ))}
          </Section>
        )}
      </View>

      {error && <ErrorText>{error}</ErrorText>}
      <PrimaryButton title="Save check-in" onPress={submit} loading={submitting} />
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontSize: 11, fontWeight: "700", color: colors.brand, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function FrequencyQuestion({ prompt, value, onChange }: { prompt: string; value: number | null; onChange: (v: number) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, color: colors.ink }}>{prompt}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {FREQUENCY_OPTIONS.map((opt) => (
          <Text
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={{
              fontSize: 11.5,
              paddingVertical: 6,
              paddingHorizontal: 9,
              borderRadius: radius.control,
              borderWidth: 1,
              borderColor: value === opt.value ? colors.brand : colors.border,
              backgroundColor: value === opt.value ? colors.brandTint : "transparent",
              color: colors.ink,
            }}
          >
            {opt.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
