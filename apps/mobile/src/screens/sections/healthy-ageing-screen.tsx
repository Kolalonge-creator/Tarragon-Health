import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, ScrollView, TextInput, View } from "react-native";
import {
  DOMAIN_LABEL,
  FALLS_PATHWAY_STAGE_LABEL,
  HOME_CARE_STATUS_LABEL,
  OUTCOME_COPY,
  fallsRiskDisplay,
  isPolypharmacy,
  loadCoordinatedCareSummary,
  loadIsOlderAdultFraming,
  loadLatestAgeingAssessment,
  loadLatestSocialDeterminantScreening,
  loadOpenFallsRisk,
  loadOpenHomeCareRequest,
  missingDomains,
  submitAgeingAssessmentDomains,
  submitFallsRiskCheck,
  submitHomeCareRequest,
  submitSocialDeterminantsCheck,
  type AgeingAssessmentDomain,
  type AgeingAssessmentOutcome,
  type AgeingAssessmentView,
  type CoordinatedCareSummary,
  type FallsRiskCheckInput,
  type FallsRiskView,
  type HomeCareRequestView,
  type SocialDeterminantsCheckInput,
  type SocialDeterminantView,
} from "@/lib/healthy-ageing";
import type { SectionId } from "@/lib/sections";
import { colors, radius, spacing } from "@/ui/theme";
import { Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/components";

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/** Mobile has only Badge's brand/neutral tones; this local helper reproduces
 * web's green/amber/red/grey status colours (falls-risk level, check-in
 * outcome) without extending the shared component for one screen's needs. */
const TONE_COLOR: Record<"brand" | "warn" | "danger" | "neutral", { bg: string; text: string }> = {
  brand: { bg: colors.brandTint, text: colors.brandPressed },
  warn: { bg: colors.status.warnBg, text: colors.status.warn },
  danger: { bg: "#FBE9E7", text: colors.danger },
  neutral: { bg: colors.groupBg, text: colors.muted },
};

function StatusBadge({ text, tone }: { text: string; tone: "brand" | "warn" | "danger" | "neutral" }) {
  const c = TONE_COLOR[tone];
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: c.text }}>{text}</Text>
    </View>
  );
}

function Checkbox({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <Text onPress={onToggle} style={{ fontSize: 13, color: colors.ink, paddingVertical: 4 }}>
      <Text style={{ fontWeight: "700", color: checked ? colors.brand : colors.faint }}>{checked ? "☑ " : "☐ "}</Text>
      {label}
    </Text>
  );
}

function Stat({ label, value, badge }: { label: string; value: string; badge?: { text: string; tone: "brand" | "warn" | "danger" | "neutral" } }) {
  return (
    <View style={{ flexBasis: "47%", flexGrow: 1, gap: 4 }}>
      <Text style={{ fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, color: colors.muted }}>
        {label}
      </Text>
      <Text style={{ fontSize: 17, fontWeight: "700", color: colors.ink }}>{value}</Text>
      {badge && <StatusBadge text={badge.text} tone={badge.tone} />}
    </View>
  );
}

interface HealthyAgeingScreenProps {
  patientId: string;
  organisationId: string;
  onNavigate: (section: SectionId) => void;
}

/**
 * "Healthy ageing" (spec §50) — a snapshot tile, coordinated-care action
 * list, comprehensive check-in, falls-risk pathway, social-determinants
 * screen, and home-visit request, mirroring
 * apps/web/.../patient/(sections)/healthy-ageing/page.tsx 1:1. No API
 * routes: every mutation here is a plain RLS-scoped insert/upsert, same as
 * healthy-ageing-actions.ts does server-side (see lib/healthy-ageing.ts's
 * own header comments). VitalsTrendChart is deliberately NOT ported —
 * mobile has no charting library yet — replaced with a link to Vitals.
 */
export function HealthyAgeingScreen({ patientId, organisationId, onNavigate }: HealthyAgeingScreenProps) {
  const [loading, setLoading] = useState(true);
  const [isOlderAdult, setIsOlderAdult] = useState(true);
  const [summary, setSummary] = useState<CoordinatedCareSummary | null>(null);
  const [assessment, setAssessment] = useState<AgeingAssessmentView | null>(null);
  const [fallsRisk, setFallsRisk] = useState<FallsRiskView | null>(null);
  const [social, setSocial] = useState<SocialDeterminantView | null>(null);
  const [homeCare, setHomeCare] = useState<HomeCareRequestView | null>(null);

  const refresh = useCallback(async () => {
    const [olderAdult, careSummary, ageing, falls, socialScreening, homeCareRequest] = await Promise.all([
      loadIsOlderAdultFraming(patientId),
      loadCoordinatedCareSummary(patientId),
      loadLatestAgeingAssessment(patientId),
      loadOpenFallsRisk(patientId),
      loadLatestSocialDeterminantScreening(patientId),
      loadOpenHomeCareRequest(patientId),
    ]);
    setIsOlderAdult(olderAdult);
    setSummary(careSummary);
    setAssessment(ageing);
    setFallsRisk(falls);
    setSocial(socialScreening);
    setHomeCare(homeCareRequest);
  }, [patientId]);

  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refresh]);

  if (loading || !summary) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const missing = missingDomains(assessment);
  const checkInComplete = assessment?.status === "completed";
  const falls = fallsRiskDisplay(fallsRisk);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 16 }}
    >
      <View>
        <ScreenTitle>Healthy ageing</ScreenTitle>
        <MutedText>
          {isOlderAdult
            ? "Independence, prevention, and coordinated care, not just a list of conditions."
            : "Built with older adults and the people who care for them in mind, and still useful for anyone tracking mobility, falls risk, or support at home."}
        </MutedText>
      </View>

      <Card style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
        <Stat label="Conditions" value={`${summary.activeConditionCount} active`} />
        <Stat
          label="Medications"
          value={`${summary.activeMedicationCount} medicine${summary.activeMedicationCount === 1 ? "" : "s"}`}
          badge={isPolypharmacy(summary.activeMedicationCount) ? { text: "Polypharmacy", tone: "warn" } : undefined}
        />
        <Stat label="Falls risk" value={falls.value} badge={falls.badge} />
        <Stat
          label="Check-in"
          value={checkInComplete ? "Up to date" : missing.length === 9 ? "Not started" : `${9 - missing.length}/9 sections`}
        />
      </Card>

      {(summary.activeConditionCount > 0 || summary.actions.length > 0) && (
        <Card style={{ gap: 8 }}>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Coordinated care</Text>
          <MutedText>
            {summary.activeConditionCount > 1
              ? `${summary.activeConditionCount} conditions being managed together: one view, not ${summary.activeConditionCount} separate ones.`
              : "What's active across your care right now."}
          </MutedText>
          {summary.actions.length === 0 ? (
            <MutedText>Nothing needs attention right now.</MutedText>
          ) : (
            <View style={{ gap: 8 }}>
              {summary.actions.map((action) => (
                <View key={action.key} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{action.label}</Text>
                  <MutedText>{action.detail}</MutedText>
                </View>
              ))}
            </View>
          )}
        </Card>
      )}

      <AgeingAssessmentCard assessment={assessment} missing={missing} patientId={patientId} organisationId={organisationId} onChanged={refresh} />

      <FallsRiskCard fallsRisk={fallsRisk} patientId={patientId} organisationId={organisationId} onChanged={refresh} />

      <SocialDeterminantsCard social={social} patientId={patientId} organisationId={organisationId} onChanged={refresh} />

      <SecondaryButton title="See your vitals trends" onPress={() => onNavigate("vitals")} />

      <HomeCareCard homeCare={homeCare} patientId={patientId} organisationId={organisationId} onChanged={refresh} />

      <Card style={{ gap: 6 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Related</Text>
        <Text onPress={() => onNavigate("emergency")} style={{ fontSize: 13, fontWeight: "600", color: colors.brand, paddingVertical: 3 }}>
          Emergency card: allergies, medicines, and contacts for a stranger to find →
        </Text>
        <Text onPress={() => onNavigate("lifestyle")} style={{ fontSize: 13, fontWeight: "600", color: colors.brand, paddingVertical: 3 }}>
          Nutrition and lifestyle coaching →
        </Text>
        <Text onPress={() => onNavigate("prevention")} style={{ fontSize: 13, fontWeight: "600", color: colors.brand, paddingVertical: 3 }}>
          Vaccinations and preventive screening →
        </Text>
        <Text onPress={() => onNavigate("family")} style={{ fontSize: 13, fontWeight: "600", color: colors.brand, paddingVertical: 3 }}>
          Caregivers who can help manage this →
        </Text>
      </Card>
    </ScrollView>
  );
}

const OUTCOME_OPTIONS: { value: AgeingAssessmentOutcome; label: string }[] = [
  { value: "no_concern", label: "No concerns" },
  { value: "monitor", label: "Something to keep an eye on" },
  { value: "further_assessment_suggested", label: "I'd like this looked at more closely" },
];

const OUTCOME_BADGE_TONE: Record<AgeingAssessmentOutcome, "brand" | "warn" | "neutral"> = {
  no_concern: "brand",
  monitor: "warn",
  further_assessment_suggested: "neutral",
};

function AgeingAssessmentCard({
  assessment,
  missing,
  patientId,
  organisationId,
  onChanged,
}: {
  assessment: AgeingAssessmentView | null;
  missing: AgeingAssessmentDomain[];
  patientId: string;
  organisationId: string;
  onChanged: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, { outcome: AgeingAssessmentOutcome | null; note: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answeredCount = missing.filter((d) => answers[d]?.outcome).length;

  async function submit() {
    const payload = missing
      .filter((d) => answers[d]?.outcome)
      .map((d) => ({ domain: d, outcome: answers[d]!.outcome!, note: answers[d]?.note || undefined }));
    setError(null);
    setSubmitting(true);
    const result = await submitAgeingAssessmentDomains(patientId, organisationId, payload);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAnswers({});
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Comprehensive check-in</Text>
      <MutedText>
        A few honest answers across the areas that matter most as you age: mobility, cognition, nutrition,
        vision and hearing, and more. This isn&apos;t a diagnosis; anything worth a closer look gets flagged
        for your care team to follow up on.
      </MutedText>

      {assessment && assessment.domainResults.length > 0 && (
        <View style={{ gap: 8 }}>
          {assessment.domainResults.map((d) => (
            <View
              key={d.id}
              style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{DOMAIN_LABEL[d.domain]}</Text>
                <MutedText>{OUTCOME_COPY[d.outcome]}</MutedText>
              </View>
              <StatusBadge text={d.clinicianReviewedAt ? "Reviewed" : "Recorded"} tone={OUTCOME_BADGE_TONE[d.outcome]} />
            </View>
          ))}
        </View>
      )}

      {missing.length > 0 ? (
        <View style={{ gap: 12 }}>
          {missing.map((domain) => (
            <View key={domain} style={{ gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>{DOMAIN_LABEL[domain]}</Text>
              {OUTCOME_OPTIONS.map((opt) => (
                <Checkbox
                  key={opt.value}
                  checked={answers[domain]?.outcome === opt.value}
                  onToggle={() => setAnswers((prev) => ({ ...prev, [domain]: { outcome: opt.value, note: prev[domain]?.note ?? "" } }))}
                  label={opt.label}
                />
              ))}
              {answers[domain]?.outcome && answers[domain]?.outcome !== "no_concern" && (
                <TextInput
                  placeholder="Anything you'd like your care team to know (optional)"
                  maxLength={500}
                  multiline
                  value={answers[domain]?.note ?? ""}
                  onChangeText={(text) => setAnswers((prev) => ({ ...prev, [domain]: { outcome: prev[domain]?.outcome ?? null, note: text } }))}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 8, fontSize: 13, color: colors.ink, minHeight: 50, textAlignVertical: "top" }}
                />
              )}
            </View>
          ))}
          {error && <ErrorText>{error}</ErrorText>}
          <PrimaryButton
            title={`Save ${answeredCount || ""} answer${answeredCount === 1 ? "" : "s"}`}
            onPress={submit}
            disabled={answeredCount === 0}
            loading={submitting}
          />
        </View>
      ) : (
        <MutedText>All sections answered for this check-in. Your care team will follow up on anything flagged.</MutedText>
      )}
    </Card>
  );
}

const FALLS_FACTORS: { key: keyof FallsRiskCheckInput; label: string }[] = [
  { key: "previous_falls_12mo", label: "A fall in the last 12 months" },
  { key: "mobility_impairment", label: "Trouble with balance or walking" },
  { key: "high_risk_medications", label: "On medication that can affect balance or alertness" },
  { key: "environmental_hazards", label: "Loose rugs, poor lighting, or stairs without rails at home" },
  { key: "balance_concern", label: "Feeling unsteady on your feet" },
];

const FALLS_LEVEL_TONE: Record<"low" | "moderate" | "high", "brand" | "warn" | "danger"> = {
  low: "brand",
  moderate: "warn",
  high: "danger",
};

function FallsRiskCard({
  fallsRisk,
  patientId,
  organisationId,
  onChanged,
}: {
  fallsRisk: FallsRiskView | null;
  patientId: string;
  organisationId: string;
  onChanged: () => void;
}) {
  const [factors, setFactors] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await submitFallsRiskCheck(patientId, organisationId, {
      previous_falls_12mo: !!factors.previous_falls_12mo,
      mobility_impairment: !!factors.mobility_impairment,
      high_risk_medications: !!factors.high_risk_medications,
      environmental_hazards: !!factors.environmental_hazards,
      balance_concern: !!factors.balance_concern,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Falls risk</Text>
      <MutedText>A few quick questions to flag anything worth a closer look.</MutedText>
      {fallsRisk ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}>
          <View>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{FALLS_PATHWAY_STAGE_LABEL[fallsRisk.pathwayStage]}</Text>
            <MutedText>Flagged {when(fallsRisk.identifiedAt)}</MutedText>
          </View>
          {fallsRisk.riskLevel && (
            <StatusBadge
              text={fallsRisk.riskLevel.charAt(0).toUpperCase() + fallsRisk.riskLevel.slice(1)}
              tone={FALLS_LEVEL_TONE[fallsRisk.riskLevel]}
            />
          )}
        </View>
      ) : (
        <View style={{ gap: 4 }}>
          {FALLS_FACTORS.map((f) => (
            <Checkbox
              key={f.key}
              checked={!!factors[f.key]}
              onToggle={() => setFactors((prev) => ({ ...prev, [f.key]: !prev[f.key] }))}
              label={f.label}
            />
          ))}
          {error && <ErrorText>{error}</ErrorText>}
          <SecondaryButton title="Save" onPress={submit} loading={submitting} />
        </View>
      )}
    </Card>
  );
}

const SOCIAL_FACTORS: { key: keyof SocialDeterminantsCheckInput; label: string }[] = [
  { key: "living_alone", label: "I live alone" },
  { key: "transport_difficulty", label: "Getting to appointments is difficult" },
  { key: "financial_barrier", label: "Cost makes it hard to get care or medication" },
  { key: "caregiver_limitation", label: "The people who usually help me have limited time or ability" },
  { key: "healthcare_access_difficulty", label: "It's generally hard for me to reach healthcare" },
];

function SocialDeterminantsCard({
  social,
  patientId,
  organisationId,
  onChanged,
}: {
  social: SocialDeterminantView | null;
  patientId: string;
  organisationId: string;
  onChanged: () => void;
}) {
  const [factors, setFactors] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await submitSocialDeterminantsCheck(patientId, organisationId, {
      living_alone: !!factors.living_alone,
      transport_difficulty: !!factors.transport_difficulty,
      financial_barrier: !!factors.financial_barrier,
      caregiver_limitation: !!factors.caregiver_limitation,
      healthcare_access_difficulty: !!factors.healthcare_access_difficulty,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSubmitted(true);
    setFactors({});
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Support at home</Text>
      <MutedText>
        A few questions about day-to-day life. These help us connect you with the right support, not just
        record them.
      </MutedText>
      {social?.needsNavigationSupport && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}>
          <Text style={{ fontSize: 13, color: colors.ink }}>
            {social.followUpStatus === "resolved" ? "Follow-up completed" : "A care coordinator will follow up"}
          </Text>
          <StatusBadge
            text={social.followUpStatus === "pending" ? "Pending" : social.followUpStatus === "contacted" ? "Contacted" : "Resolved"}
            tone={social.followUpStatus === "resolved" ? "brand" : "warn"}
          />
        </View>
      )}
      <View style={{ gap: 4 }}>
        {SOCIAL_FACTORS.map((f) => (
          <Checkbox
            key={f.key}
            checked={!!factors[f.key]}
            onToggle={() => setFactors((prev) => ({ ...prev, [f.key]: !prev[f.key] }))}
            label={f.label}
          />
        ))}
        {submitted && <MutedText>Thanks. Recorded.</MutedText>}
        {error && <ErrorText>{error}</ErrorText>}
        <SecondaryButton title="Save" onPress={submit} loading={submitting} />
      </View>
    </Card>
  );
}

function HomeCareCard({
  homeCare,
  patientId,
  organisationId,
  onChanged,
}: {
  homeCare: HomeCareRequestView | null;
  patientId: string;
  organisationId: string;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await submitHomeCareRequest(patientId, organisationId, reason);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReason("");
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Home visit</Text>
      <MutedText>If getting to a clinic is difficult, ask your care coordinator about a home visit.</MutedText>
      {homeCare ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}>
          <Text style={{ fontSize: 13, color: colors.ink }}>{HOME_CARE_STATUS_LABEL[homeCare.status]}</Text>
          <StatusBadge text="In progress" tone="neutral" />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>What&apos;s going on?</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            maxLength={500}
            multiline
            numberOfLines={3}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 8, fontSize: 13, color: colors.ink, minHeight: 70, textAlignVertical: "top" }}
          />
          {error && <ErrorText>{error}</ErrorText>}
          <PrimaryButton title="Request a home visit" onPress={submit} disabled={!reason.trim()} loading={submitting} />
        </View>
      )}
    </Card>
  );
}
