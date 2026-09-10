import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  loadSupervisedWeightManagementState,
  submitSupervisedWeightCheckin,
  type WeightManagementCheckin,
  type WeightManagementDoseStep,
  type WeightManagementEnrolment,
} from "@/lib/supervised-weight-management";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, radius } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";

const SYMPTOMS = [
  { key: "nausea", label: "Nausea" },
  { key: "vomiting", label: "Vomiting" },
  { key: "diarrhoea", label: "Diarrhoea" },
  { key: "constipation", label: "Constipation" },
  { key: "abdominalPain", label: "Stomach pain" },
] as const;

type SymptomKey = (typeof SYMPTOMS)[number]["key"];

const SEVERITY = ["None", "Mild", "Moderate", "Severe"] as const;

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

const textInputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  paddingHorizontal: 10,
  paddingVertical: 8,
  borderRadius: radius.control,
  fontSize: 14,
  color: colors.ink,
} as const;

/**
 * Supervised Weight Management, patient side — mirrors
 * apps/web/src/components/weight-management-panel.tsx. Rendered inside the
 * (free, unrelated) Lifestyle weight-management drawer screen rather than a
 * new top-level destination: mobile has no equivalent of web's separate
 * /patient/weight route this attaches to there, and a patient looking for
 * anything about weight already lands on this one drawer entry.
 *
 * The disclosure below is not marketing softening and must not be trimmed:
 * Tarragon supervises people taking medication they obtained themselves; it
 * does not prescribe or supply it, and the database refuses an enrolment
 * against a medication Tarragon started. Nothing here decides eligibility or
 * agrees a dose — both are a doctor's, enforced by RLS.
 */
export function SupervisedWeightManagementCard({
  organisationId,
  patientId,
}: {
  organisationId: string;
  patientId: string;
}) {
  const [enrolment, setEnrolment] = useState<WeightManagementEnrolment | null | undefined>(undefined);
  const [checkins, setCheckins] = useState<WeightManagementCheckin[]>([]);
  const [doseSteps, setDoseSteps] = useState<WeightManagementDoseStep[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [scores, setScores] = useState<Record<SymptomKey, number>>({
    nausea: 0,
    vomiting: 0,
    diarrhoea: 0,
    constipation: 0,
    abdominalPain: 0,
  });
  const [weight, setWeight] = useState("");
  const [poorOralIntake, setPoorOralIntake] = useState(false);
  const [redFlag, setRedFlag] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const refresh = useCallback(async () => {
    const result = await loadSupervisedWeightManagementState(patientId);
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    setEnrolment(result.data.enrolment);
    setCheckins(result.data.checkins);
    setDoseSteps(result.data.doseSteps);
  }, [patientId]);

  useEffect(() => {
    refresh().catch(() => setLoadError("Could not load this just now."));
  }, [refresh]);

  if (enrolment === undefined) return null;

  if (loadError) {
    return (
      <Card style={{ gap: 6 }}>
        <ErrorText>{loadError}</ErrorText>
      </Card>
    );
  }

  if (!enrolment) {
    return (
      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>
          Losing weight on medication?
        </Text>
        <MutedText>
          If you are taking weight-loss medication, or thinking about it, a doctor can supervise how
          it is used: whether it is right for you, at what dose, and what to do when something
          changes.
        </MutedText>
        <MutedText>
          Tarragon does not prescribe, sell or supply weight-loss medication, and is not a pharmacy.
          You obtain your own prescription and your own medicine. What you would be paying for is a
          doctor taking responsibility for how it is used.
        </MutedText>
        <SecondaryButton
          title="See Supervised Weight Management"
          onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/subscription`)}
        />
      </Card>
    );
  }

  const awaitingEligibility = enrolment.status === "pending_eligibility";
  const latest = checkins[0];

  async function submit() {
    if (!enrolment) return;
    setSubmitting(true);
    setSubmitError(null);
    const result = await submitSupervisedWeightCheckin({
      organisationId,
      enrolmentId: enrolment.id,
      patientId,
      weightKg: weight ? Number(weight) : null,
      nausea: scores.nausea,
      vomiting: scores.vomiting,
      diarrhoea: scores.diarrhoea,
      constipation: scores.constipation,
      abdominalPain: scores.abdominalPain,
      poorOralIntake,
      redFlagReported: redFlag,
      patientNote: note.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }
    setSubmitted(true);
    setScores({ nausea: 0, vomiting: 0, diarrhoea: 0, constipation: 0, abdominalPain: 0 });
    setWeight("");
    setPoorOralIntake(false);
    setRedFlag(false);
    setNote("");
    void refresh();
  }

  return (
    <Card style={{ gap: 12 }}>
      <View>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Supervised Weight Management</Text>
        <MutedText>
          {awaitingEligibility
            ? "A doctor is reviewing whether this is right for you. Nothing starts until they have."
            : `Supervised until ${shortDate(enrolment.ends_at) ?? "the end of your term"}.`}
        </MutedText>
      </View>

      {awaitingEligibility ? (
        <View style={{ backgroundColor: colors.status.warnBg, borderRadius: radius.control, padding: 10 }}>
          <Text style={{ fontSize: 12.5, color: colors.status.warn, lineHeight: 18 }}>
            Your doctor needs a recorded assessment and your own prescription details before
            supervision can start. They will be in touch. If the honest answer turns out to be that
            this is not right for you, they will tell you that instead.
          </Text>
        </View>
      ) : null}

      {doseSteps.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase" }}>
            Your dose plan
          </Text>
          {doseSteps.map((step) => (
            <View key={step.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: colors.ink }}>{step.dose_label}</Text>
                <MutedText>From {shortDate(step.planned_from)}</MutedText>
              </View>
              {/* Null-gated: a step nobody has agreed is a plan, not an
                  instruction, and must never read as one. */}
              {step.agreed_by ? (
                <Badge tone={step.reached_at ? "brand" : "neutral"}>
                  {step.reached_at ? "Reached" : "Agreed with your doctor"}
                </Badge>
              ) : (
                <Badge>Planned, not yet agreed</Badge>
              )}
            </View>
          ))}
        </View>
      ) : null}

      {!awaitingEligibility ? (
        <View style={{ gap: 10 }}>
          <View>
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase" }}>
              How are you tolerating it?
            </Text>
            <MutedText>
              {latest
                ? `Last check-in ${shortDate(latest.checked_in_at)}. ${latest.reviewed_at ? "A clinician has read it." : "Not yet read by a clinician."}`
                : "Every two weeks is about right."}
            </MutedText>
          </View>

          {SYMPTOMS.map((symptom) => (
            <View key={symptom.key} style={{ gap: 6 }}>
              <Text style={{ fontSize: 13, color: colors.ink }}>{symptom.label}</Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {SEVERITY.map((label, score) => (
                  <Text
                    key={label}
                    onPress={() => setScores((prev) => ({ ...prev, [symptom.key]: score }))}
                    style={{
                      fontSize: 11.5,
                      paddingVertical: 6,
                      paddingHorizontal: 9,
                      borderRadius: 999,
                      backgroundColor: scores[symptom.key] === score ? colors.navy : colors.groupBg,
                      color: scores[symptom.key] === score ? "#FFFFFF" : colors.ink,
                      overflow: "hidden",
                    }}
                  >
                    {label}
                  </Text>
                ))}
              </View>
            </View>
          ))}

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 13, color: colors.ink }}>Weight today, in kg (optional)</Text>
            <TextInput
              value={weight}
              onChangeText={setWeight}
              keyboardType="decimal-pad"
              style={[textInputStyle, { maxWidth: 140 }]}
            />
          </View>

          <Text
            onPress={() => setPoorOralIntake((v) => !v)}
            style={{ fontSize: 13, color: colors.ink }}
          >
            <Text style={{ fontWeight: "700" }}>{poorOralIntake ? "☑ " : "☐ "}</Text>
            I am struggling to keep food or fluids down
          </Text>

          {/* Asked explicitly rather than inferred from the severity scores,
              because inferring it would mean deciding on the patient's
              behalf what counts as severe. */}
          <Text
            onPress={() => setRedFlag((v) => !v)}
            style={{ fontSize: 13, color: colors.ink, backgroundColor: "#FDECEC", borderRadius: radius.control, padding: 8 }}
          >
            <Text style={{ fontWeight: "700" }}>{redFlag ? "☑ " : "☐ "}</Text>
            I have severe stomach pain that will not go away, or that goes through to my back
          </Text>

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 13, color: colors.ink }}>Anything else you want your doctor to know</Text>
            <TextInput value={note} onChangeText={setNote} style={textInputStyle} />
          </View>

          {submitError ? <ErrorText>{submitError}</ErrorText> : null}
          {submitted ? (
            <MutedText>
              Sent.{" "}
              {redFlag || poorOralIntake
                ? "Because of what you have told us, someone will come back to you quickly. If it gets worse before then, go to the nearest hospital."
                : "Your doctor will read it before your next review."}
            </MutedText>
          ) : null}

          {submitting ? (
            <ActivityIndicator color={colors.brand} />
          ) : (
            <PrimaryButton title="Send this check-in" onPress={submit} />
          )}
        </View>
      ) : null}
    </Card>
  );
}
