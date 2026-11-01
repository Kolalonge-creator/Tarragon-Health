import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { todayIsoDate } from "@/lib/medications";
import { computeGestationalEstimate } from "@/lib/gestational-age";
import { contraceptionCautionNote, menopauseTreatmentCautionNote, type CarePlanCondition } from "@/lib/womens-health-intersections";
import { computeCycleNudges, type ReproductiveLifeStage } from "@/lib/cycle-nudges";
import {
  BREASTFEEDING_LABEL,
  BREASTFEEDING_STATUSES,
  BREAST_SYMPTOM_LABEL,
  BREAST_SYMPTOM_TYPES,
  CHECKIN_LABEL,
  CHECKIN_WINDOWS,
  MENOPAUSE_SYMPTOM_LABEL,
  MENOPAUSE_SYMPTOM_TYPES,
  PREGNANCY_DANGER_SIGNS,
  PREGNANCY_DANGER_SIGN_LABEL,
  fertilityStatusLabel,
  loadAntenatalVisits,
  loadBreastSymptomReports,
  loadFertilityAssessmentRequests,
  loadMenopauseSymptomLogs,
  loadPostnatalCheckins,
  loadPostnatalProfiles,
  loadPregnancy,
  loadPregnancyEmergencyContext,
  loadReproductiveHealthProfile,
  logMenopauseSymptoms,
  logPostnatalCheckin,
  recordDelivery,
  reportBreastSymptoms,
  reportPregnancyDangerSigns,
  requestFertilityAssessment,
  saveContraceptionMethod,
  saveReproductiveHealthProfile,
  setLastMenstrualPeriod,
  type AntenatalVisit,
  type BreastSymptomReport,
  type BreastSymptomType,
  type BreastfeedingStatus,
  type CheckinWindow,
  type FertilityAssessmentRequest,
  type MenopauseSymptomLog,
  type MenopauseSymptomType,
  type PatientPregnancy,
  type PostnatalCheckin,
  type PostnatalProfile,
  type PregnancyDangerSign,
  type ReproductiveHealthProfile,
} from "@/lib/womens-health";
import { t } from "@tarragon/i18n";
import { ContraceptionEducation } from "@/ui/contraception-education";
import { PrivateSection } from "@/ui/private-section";
import { CycleDangerSigns } from "@/ui/cycle-danger-signs";
import type { SectionId } from "@/lib/sections";
import { CycleScreen } from "@/screens/sections/cycle-screen";
import { EmergencyGuidanceModal } from "@/screens/emergency-guidance-modal";
import { PregnancyDangerGuideCard, PregnancyTools } from "@/screens/sections/pregnancy-tools";
import { FeedLogCardMobile, LifecycleCardMobile } from "@/screens/sections/maternal-child-card";
import { radius, spacing } from "@/ui/theme";
import { useLegacyColors, useTextInputStyle, useTheme, placeholderColorFor, textStyles } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { Button, Disclosure, Skeleton, SkeletonGroup } from "@/ui/kit";
import { AppText } from "@/ui/kit/AppText";
import { FeatureConsentGate } from "@/ui/feature-consent-gate";

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

interface NextScreening {
  screenTypeName: string;
  dueDate: string;
  isOverdue: boolean;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useLegacyColors();
  return (
    <Text
      onPress={onPress}
      style={{
        ...textStyles.label,
        
        paddingVertical: 7,
        paddingHorizontal: 11,
        borderRadius: 999,
        backgroundColor: active ? colors.brand : colors.groupBg,
        color: active ? colors.onBrand : colors.ink,
      }}
    >
      {label}
    </Text>
  );
}

function CautionNote({ text }: { text: string }) {
  const colors = useLegacyColors();
  return (
    <View style={{ backgroundColor: colors.status.warnBg, borderRadius: radius.control, padding: 10, gap: 2 }}>
      <AppText variant="label" tone="warnText">Worth discussing with your care team</AppText>
      <AppText variant="body">{text}</AppText>
    </View>
  );
}

interface WomensHealthScreenProps {
  patientId: string;
  organisationId: string;
  onNavigate: (section: SectionId) => void;
}

/**
 * "Women's Health" (spec §44) — one destination for prevention, reproductive
 * health, pregnancy, postnatal care, and long-term conditions, mirroring
 * apps/web/.../patient/(sections)/womens-health/page.tsx. Only sections
 * relevant to the patient's self-reported life stage/pregnancy status
 * render, same signal as web. **The cycle tracker (/patient/cycle) is now a
 * real native screen (screens/sections/cycle-screen.tsx, lib/cycle.ts,
 * lib/cycle-prediction.ts)** — converted from the WebView modal this
 * comment used to describe, per the platform-wide "eliminate every
 * WebView-wrapped section" effort. Its calendar-grid visual and the
 * pattern-over-time/thermal-shift insights cards were deliberately left
 * for a follow-up pass (see cycle-screen.tsx's own header); period
 * logging, the day log, predictions and clinical flags are fully native.
 * **Read docs/mobile-native-conversion/womens-health.md's
 * reproductive-health safety notes before changing anything here, in
 * lib/womens-health.ts, or in lib/cycle.ts/cycle-screen.tsx.**
 */
function WomensHealthScreenInner({ patientId, organisationId, onNavigate }: WomensHealthScreenProps) {
  const [accountId, setAccountId] = useState(patientId);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user?.id) setAccountId(data.user.id);
    });
  }, []);
  const colors = useLegacyColors();
  const [loading, setLoading] = useState(true);
  const [sex, setSex] = useState<string | null>(null);
  const [reproProfile, setReproProfile] = useState<ReproductiveHealthProfile | null>(null);
  const [reproUnknown, setReproUnknown] = useState(false);
  const [pregnancy, setPregnancy] = useState<PatientPregnancy | null>(null);
  const [pregnancyUnknown, setPregnancyUnknown] = useState(false);
  const [activeConditions, setActiveConditions] = useState<CarePlanCondition[]>([]);
  const [nextScreening, setNextScreening] = useState<NextScreening | null>(null);
  const [cycleTrackerOpen, setCycleTrackerOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [profileRes, pregnancyRes, plansRes, screeningRes] = await Promise.all([
      loadReproductiveHealthProfile(patientId).then(
        (data) => ({ ok: true as const, data }),
        (e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })
      ),
      loadPregnancy(patientId),
      supabase.from("care_plans").select("condition").eq("patient_id", patientId).eq("status", "active"),
      // Real, non-heuristic scoping: screen_types.sex_applicability is an
      // actual enum column ('all'|'male'|'female'), not a guess over free
      // text. Mirrors the web page's query and PreventiveScreeningCalendar's
      // "actionable" status set (pending/booked/overdue).
      supabase
        .from("screening_schedules")
        .select("due_date, status, screen_type:screen_types!inner(name, sex_applicability)")
        .eq("patient_id", patientId)
        .eq("screen_type.sex_applicability", "female")
        .in("status", ["pending", "booked", "overdue"])
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    setReproUnknown(!profileRes.ok);
    setReproProfile(profileRes.ok ? profileRes.data : null);
    setPregnancyUnknown(!pregnancyRes.ok);
    setPregnancy(pregnancyRes.ok ? pregnancyRes.data : null);
    setActiveConditions(((plansRes.data ?? []) as { condition: CarePlanCondition }[]).map((p) => p.condition));
    const screeningRow = screeningRes.data as {
      due_date: string;
      screen_type: { name: string } | null;
    } | null;
    const today = todayIsoDate();
    setNextScreening(
      screeningRow
        ? {
            screenTypeName: screeningRow.screen_type?.name ?? "Screening",
            dueDate: screeningRow.due_date,
            isOverdue: screeningRow.due_date < today,
          }
        : null
    );
  }, [patientId]);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("sex")
      .eq("id", patientId)
      .maybeSingle()
      .then(({ data }) => setSex(data?.sex ?? null));
  }, [patientId]);

  useEffect(() => {
    if (sex !== "female") {
      setLoading(false);
      return;
    }
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sex, refresh]);

  if (sex === null && loading) {
    return (
      <View style={{ flex: 1, padding: spacing.screen, backgroundColor: colors.background }}>
        <SkeletonGroup label="Loading Women's Health">
          <View style={{ gap: 12 }}>
            <Skeleton height={28} width="60%" />
            <Skeleton height={88} radius={16} />
            <Skeleton height={88} radius={16} />
          </View>
        </SkeletonGroup>
      </View>
    );
  }

  if (sex !== "female") {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
        <AppText variant="headline" heading>
          Women&apos;s Health
        </AppText>
        <Card style={{ gap: 10 }}>
          <AppText variant="body" tone="textMuted">
            {sex === null
              ? "This section covers cycle tracking, contraception, pregnancy, postnatal care and menopause for female patients. We do not have a sex recorded on your health profile yet, so we cannot tell whether it applies to you. Add it on your profile and this section will open up if it is relevant."
              : "This section covers cycle tracking, contraception, pregnancy, postnatal care and menopause, so it does not apply to your health profile. Everything here is built around care that is specific to female patients."}
          </AppText>
          <Button variant="ghost" title="Screenings and checks relevant to you: Prevention" onPress={() => onNavigate("prevention")} />
        </Card>
      </ScrollView>
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, padding: spacing.screen, backgroundColor: colors.background }}>
        <SkeletonGroup label="Loading Women's Health">
          <View style={{ gap: 12 }}>
            <Skeleton height={28} width="60%" />
            <Skeleton height={88} radius={16} />
            <Skeleton height={88} radius={16} />
          </View>
        </SkeletonGroup>
      </View>
    );
  }

  const lifeStage: ReproductiveLifeStage = reproProfile?.life_stage ?? "not_applicable";
  const activePregnancy = !pregnancyUnknown && pregnancy?.is_pregnant ? pregnancy : null;
  const gestationalEstimate = activePregnancy
    ? computeGestationalEstimate({
        lastMenstrualPeriodDate: activePregnancy.last_menstrual_period_date,
        estimatedDueDate: activePregnancy.estimated_due_date,
      })
    : null;

  const showContraception = !pregnancyUnknown && !reproUnknown && !activePregnancy && lifeStage !== "postpartum";
  const showFertility = !reproUnknown && lifeStage === "trying_to_conceive";
  const showMenopause = !reproUnknown && (lifeStage === "perimenopausal" || lifeStage === "menopausal");
  const showPostnatal = !reproUnknown && lifeStage === "postpartum";
  const menopauseCaution = showMenopause ? menopauseTreatmentCautionNote(activeConditions) : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <View style={{ gap: 4 }}>
        <AppText variant="headline" heading>
          Women&apos;s Health
        </AppText>
        <AppText variant="body" tone="textMuted">
          Prevention, reproductive health, pregnancy, postnatal care and long-term health, in one place.
        </AppText>
      </View>

      {/* S66: sits behind the same section PIN as the cycle tracker. Only emergency content stays outside it: the danger signs and the
          pregnancy red-flag check. */}
      <PrivateSection
        accountId={accountId}
        title="Your health tracker"
        outside={
          <>
            <CycleDangerSigns />
            {activePregnancy && <PregnancyRedFlagCheck patientId={patientId} organisationId={organisationId} />}
            {/* S67: bundled danger-sign guide, readable with no signal and no PIN (INV-06). */}
            {activePregnancy && <PregnancyDangerGuideCard />}
          </>
        }
      >
        <View style={{ gap: 16 }}>

      <Card style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
        <View style={{ flexBasis: "30%", flexGrow: 1 }}>
          <MutedText>Cycle</MutedText>
          <AppText variant="bodyLargeStrong">
            {reproUnknown ? "Not available" : reproProfile?.last_period_date ? "Tracked" : "Not tracked"}
          </AppText>
        </View>
        {gestationalEstimate && (
          <View style={{ flexBasis: "30%", flexGrow: 1 }}>
            <MutedText>Antenatal</MutedText>
            <AppText variant="bodyLargeStrong">Week {gestationalEstimate.weeks}</AppText>
          </View>
        )}
        <Pressable accessibilityRole="button" style={{ flexBasis: "30%", flexGrow: 1 }} onPress={() => onNavigate("prevention")}>
          <MutedText>Next screening</MutedText>
          <Text
            style={{
              ...textStyles.bodyLargeStrong,
              
              color: nextScreening?.isOverdue ? colors.danger : colors.brandPressed,
            }}
          >
            {nextScreening
              ? `${nextScreening.screenTypeName} · ${nextScreening.isOverdue ? "Overdue" : when(nextScreening.dueDate)}`
              : "No screening due"}
          </Text>
        </Pressable>
      </Card>

      <ReproductiveHealthCard
        patientId={patientId}
        organisationId={organisationId}
        profile={reproProfile}
        onChanged={refresh}
        onOpenCycleTracker={() => setCycleTrackerOpen(true)}
      />
      <Modal visible={cycleTrackerOpen} animationType="slide" onRequestClose={() => setCycleTrackerOpen(false)}>
        <View style={{ flex: 1 }}>
          <View style={{ padding: spacing.screen, paddingTop: 56 }}>
            <SecondaryButton title="Close" onPress={() => setCycleTrackerOpen(false)} />
          </View>
          <CycleScreen patientId={patientId} organisationId={organisationId} onNavigate={onNavigate} />
        </View>
      </Modal>

      {reproUnknown && (
        <Card style={{ gap: 6 }}>
          <AppText variant="bodyStrong">
            We couldn&apos;t load your reproductive health profile just now
          </AppText>
          <MutedText>
            Your cycle, contraception and life stage are stored, we simply couldn&apos;t read them on this
            screen. Anything below that depends on them is hidden rather than guessed at. Please refresh and
            try again.
          </MutedText>
        </Card>
      )}

      {pregnancyUnknown && (
        <Card style={{ gap: 6 }}>
          <AppText variant="bodyStrong">
            We couldn&apos;t load your pregnancy record just now
          </AppText>
          <MutedText>
            That is not the same as there being nothing there, so nothing below assumes either way. Please
            refresh and try again. If you are pregnant and something doesn&apos;t feel right, message your
            care team or go to your nearest hospital rather than waiting for this screen.
          </MutedText>
        </Card>
      )}

      {activePregnancy && (
        <>
          <AntenatalCard patientId={patientId} organisationId={organisationId} pregnancy={activePregnancy} onNavigate={onNavigate} />
          {/* S67 (OQ-346): inside the section PIN lock, and shown only once the maternal_enabled guard is open for this person. */}
          <PregnancyTools
            subjectId={patientId}
            organisationId={organisationId}
            lmp={activePregnancy.last_menstrual_period_date}
            edd={activePregnancy.estimated_due_date}
          />
        </>
      )}

      {showPostnatal && <PostnatalCard patientId={patientId} organisationId={organisationId} onNavigate={onNavigate} />}
      {showPostnatal && <FeedLogCardMobile patientId={patientId} organisationId={organisationId} />}
      {!reproUnknown && <LifecycleCardMobile />}

      {showContraception && (
        <ContraceptionCard
          patientId={patientId}
          organisationId={organisationId}
          initialMethod={reproProfile?.current_contraception_method ?? null}
          cautionNote={contraceptionCautionNote(activeConditions)}
          onNavigate={onNavigate}
        />
      )}

      {showFertility && <FertilityRequestCard patientId={patientId} organisationId={organisationId} onNavigate={onNavigate} />}

      {showMenopause && <MenopauseSymptomCard patientId={patientId} organisationId={organisationId} />}
      {menopauseCaution && (
        <Card>
          <CautionNote text={menopauseCaution} />
        </Card>
      )}

      <BreastSymptomCard patientId={patientId} organisationId={organisationId} />
        </View>
      </PrivateSection>
    </ScrollView>
  );
}

const LIFE_STAGE_LABEL: Record<ReproductiveLifeStage, string> = {
  menstruating: "Menstruating",
  trying_to_conceive: "Trying to conceive",
  pregnant: "Pregnant",
  postpartum: "Postpartum (within the last year)",
  perimenopausal: "Perimenopausal",
  menopausal: "Menopausal",
  not_applicable: "Prefer not to say / not applicable",
};

function ReproductiveHealthCard({
  patientId,
  organisationId,
  profile,
  onChanged,
  onOpenCycleTracker,
}: {
  patientId: string;
  organisationId: string;
  profile: ReproductiveHealthProfile | null;
  onChanged: () => void;
  onOpenCycleTracker: () => void;
}) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [lifeStage, setLifeStage] = useState<ReproductiveLifeStage>(profile?.life_stage ?? "not_applicable");
  const [lastPeriodDate, setLastPeriodDate] = useState(profile?.last_period_date ?? "");
  const [cycleLength, setCycleLength] = useState(profile?.average_cycle_length_days?.toString() ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const nudges = computeCycleNudges({
    lifeStage,
    lastPeriodDate: lastPeriodDate || null,
    averageCycleLengthDays: cycleLength ? Number(cycleLength) : null,
  });

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await saveReproductiveHealthProfile(patientId, organisationId, {
      life_stage: lifeStage,
      last_period_date: lastPeriodDate || null,
      average_cycle_length_days: cycleLength ? Number(cycleLength) : null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="bodyStrong">Your cycle & life stage</AppText>
      <MutedText>
        Tell us where you are so we can give a useful nudge, not a diagnosis, and you can change this at any
        time.
      </MutedText>

      <Text
        onPress={onOpenCycleTracker}
        style={{ borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.brandTint, borderRadius: radius.control, padding: 12 }}
      >
        <AppText variant="bodyStrong">Open your cycle tracker</AppText>
        {"\n"}
        <AppText variant="caption" tone="textMuted">
          Log your period, see what to expect next, and track how you feel.
        </AppText>
      </Text>

      {nudges.length > 0 && (
        <View style={{ backgroundColor: colors.brandTint, borderRadius: radius.control, padding: 10, gap: 4 }}>
          {nudges.map((n) => (
            <AppText variant="caption" key={n.id}>
              {n.label}
            </AppText>
          ))}
        </View>
      )}

      <AppText variant="label">Life stage</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(Object.keys(LIFE_STAGE_LABEL) as ReproductiveLifeStage[]).map((stage) => (
          <Chip key={stage} label={LIFE_STAGE_LABEL[stage]} active={lifeStage === stage} onPress={() => setLifeStage(stage)} />
        ))}
      </View>

      {lifeStage === "menstruating" && (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="label">Last period start date</AppText>
            <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={lastPeriodDate} onChangeText={setLastPeriodDate} placeholder="YYYY-MM-DD" style={textInputStyle} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="label">Avg. cycle length (days)</AppText>
            <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={cycleLength} onChangeText={setCycleLength} placeholder="28" keyboardType="numeric" style={textInputStyle} />
          </View>
        </View>
      )}

      {error && <ErrorText>{error}</ErrorText>}
      {saved && <MutedText>Saved.</MutedText>}
      <SecondaryButton title="Save" onPress={submit} loading={submitting} />
    </Card>
  );
}

function ContraceptionCard({
  patientId,
  organisationId,
  initialMethod,
  cautionNote,
  onNavigate,
}: {
  patientId: string;
  organisationId: string;
  initialMethod: string | null;
  cautionNote: string | null;
  onNavigate: (section: SectionId) => void;
}) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [method, setMethod] = useState(initialMethod ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await saveContraceptionMethod(patientId, organisationId, method);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
  }

  return (
    <>
      {/* The condition caution stays visible; only the options and the method note fold away. */}
      {cautionNote && (
        <Card>
          <CautionNote text={cautionNote} />
        </Card>
      )}
      <Disclosure title="Contraception" hint="Options, and the method you use now">
      <MutedText>
        Learn about your options, and let us know what you&apos;re currently using so your care team has the
        full picture.
      </MutedText>
      <ContraceptionEducation />
      <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={method} onChangeText={setMethod} placeholder="e.g. combined pill, implant, condoms, none" style={textInputStyle} />
      {error && <ErrorText>{error}</ErrorText>}
      {saved && <MutedText>Saved.</MutedText>}
      <SecondaryButton title="Save" onPress={submit} loading={submitting} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
        <AppText variant="label" tone="brandText" onPress={() => onNavigate("learn")}>
          Read about contraception options
        </AppText>
        <AppText variant="label" tone="brandText" onPress={() => onNavigate("appointments")}>
          Book a contraception consultation
        </AppText>
      </View>
      </Disclosure>
    </>
  );
}

function AntenatalCard({
  patientId,
  organisationId,
  pregnancy,
  onNavigate,
}: {
  patientId: string;
  organisationId: string;
  pregnancy: PatientPregnancy;
  onNavigate: (section: SectionId) => void;
}) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [visits, setVisits] = useState<AntenatalVisit[]>([]);
  const [lmp, setLmp] = useState(pregnancy.last_menstrual_period_date ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAntenatalVisits(patientId)
      .then(setVisits)
      .catch(() => {});
  }, [patientId]);

  const estimate = computeGestationalEstimate({
    lastMenstrualPeriodDate: pregnancy.last_menstrual_period_date,
    estimatedDueDate: pregnancy.estimated_due_date,
  });

  async function submit() {
    setError(null);
    if (!lmp || Number.isNaN(Date.parse(lmp))) {
      setError("Enter a valid date");
      return;
    }
    setSubmitting(true);
    const result = await setLastMenstrualPeriod(patientId, organisationId, lmp);
    setSubmitting(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="bodyStrong">Antenatal care</AppText>
      <MutedText>Track your appointments, investigations, scans and vaccinations through pregnancy.</MutedText>

      {pregnancy.high_risk && (
        <CautionNote text="Keep your antenatal appointments and reach out if anything changes." />
      )}

      {estimate ? (
        <AppText variant="body">
          Estimated {estimate.weeks} weeks pregnant. This is an estimate, not a confirmed clinical dating.
          Estimated due date: {when(estimate.estimatedDueDate)}.
        </AppText>
      ) : (
        <MutedText>Add your last menstrual period date for a gestational-age estimate.</MutedText>
      )}

      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="label">Last menstrual period date</AppText>
          <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={lmp} onChangeText={setLmp} placeholder="YYYY-MM-DD" style={textInputStyle} />
        </View>
        <SecondaryButton title="Save" onPress={submit} loading={submitting} />
      </View>
      {error && <ErrorText>{error}</ErrorText>}

      {visits.length > 0 && (
        <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
          <AppText variant="label" tone="textMuted" style={{ textTransform: "uppercase", letterSpacing: 0.3 }}>
            Antenatal visits
          </AppText>
          {visits.map((visit) => (
            <View key={visit.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <AppText variant="label">
                  {visit.gestational_week_at_visit != null ? `Week ${visit.gestational_week_at_visit}` : `Visit ${visit.visit_number ?? ""}`}
                </AppText>
                <MutedText>{visit.status}</MutedText>
              </View>
              {visit.findings && <AppText variant="body" tone="textMuted">{visit.findings}</AppText>}
            </View>
          ))}
        </View>
      )}

      <AppText variant="label" tone="brandText" onPress={() => onNavigate("appointments")}>
        Book your next antenatal visit
      </AppText>
    </Card>
  );
}

function PregnancyRedFlagCheck({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const colors = useLegacyColors();
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<PregnancyDangerSign>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guidanceVisible, setGuidanceVisible] = useState(false);
  const [detail, setDetail] = useState("");
  const [emergencyContact, setEmergencyContact] = useState<{ name: string; phone: string | null; relationship: string | null } | null>(null);

  function toggle(sign: PregnancyDangerSign) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sign)) next.delete(sign);
      else next.add(sign);
      return next;
    });
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    const signs = [...selected];
    const result = await reportPregnancyDangerSigns(patientId, organisationId, signs);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const context = await loadPregnancyEmergencyContext(patientId).catch(() => null);
    setEmergencyContact(context?.emergencyContact ?? null);
    setDetail(`Pregnancy warning sign(s): ${signs.map((s) => PREGNANCY_DANGER_SIGN_LABEL[s]).join(", ")}`);
    setSelected(new Set());
    setExpanded(false);
    setGuidanceVisible(true);
  }

  return (
    <Card style={{ borderColor: colors.danger, gap: 10 }}>
      <AppText variant="bodyStrong" tone="dangerText" onPress={() => setExpanded((v) => !v)}>
        ⚠ Any pregnancy warning signs? {expanded ? "(Hide)" : "(Check now)"}
      </AppText>

      {expanded && (
        <View style={{ gap: 10 }}>
          <MutedText>
            Tap anything you&apos;re experiencing. These need urgent assessment during pregnancy. We&apos;ll
            tell you what to do; TarragonHealth does not provide emergency care, so you should go to your
            nearest hospital.
          </MutedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {PREGNANCY_DANGER_SIGNS.map((sign) => (
              <Chip key={sign} label={PREGNANCY_DANGER_SIGN_LABEL[sign]} active={selected.has(sign)} onPress={() => toggle(sign)} />
            ))}
          </View>
          {error && <ErrorText>{error}</ErrorText>}
          <PrimaryButton title="Get emergency guidance" onPress={submit} disabled={selected.size === 0} loading={submitting} />
        </View>
      )}

      <EmergencyGuidanceModal
        visible={guidanceVisible}
        detail={detail}
        synced
        emergencyContact={emergencyContact}
        onDismiss={() => setGuidanceVisible(false)}
      />
    </Card>
  );
}

function PostnatalCard({
  patientId,
  organisationId,
  onNavigate,
}: {
  patientId: string;
  organisationId: string;
  onNavigate: (section: SectionId) => void;
}) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [profiles, setProfiles] = useState<PostnatalProfile[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<"vaginal" | "assisted" | "caesarean" | "unknown">("unknown");
  const [complications, setComplications] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    loadPostnatalProfiles(patientId)
      .then(setProfiles)
      .catch(() => {});
  }, [patientId]);

  useEffect(() => refresh(), [refresh]);

  const latest = profiles[0];

  async function submit() {
    setError(null);
    if (!deliveryDate || Number.isNaN(Date.parse(deliveryDate))) {
      setError("Enter a valid date");
      return;
    }
    setSubmitting(true);
    const result = await recordDelivery(patientId, organisationId, {
      delivery_date: deliveryDate,
      delivery_mode: deliveryMode,
      complications: complications.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setShowForm(false);
    setDeliveryDate("");
    setComplications("");
    refresh();
  }

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="bodyStrong">Postnatal care</AppText>
      <MutedText>Maternal recovery, breastfeeding support and follow-up after delivery.</MutedText>

      {latest ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}>
          <AppText variant="label">Delivered {when(latest.delivery_date)}</AppText>
          <MutedText>{latest.delivery_mode.replace("_", " ")}</MutedText>
        </View>
      ) : (
        <MutedText>No delivery recorded yet.</MutedText>
      )}

      {!showForm ? (
        <SecondaryButton title={latest ? "Record another delivery" : "Record a delivery"} onPress={() => setShowForm(true)} />
      ) : (
        <View style={{ gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}>
          <MutedText>This also updates your pregnancy status to &quot;not pregnant&quot;.</MutedText>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="label">Delivery date</AppText>
              <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={deliveryDate} onChangeText={setDeliveryDate} placeholder="YYYY-MM-DD" style={textInputStyle} />
            </View>
          </View>
          <AppText variant="label">Delivery mode</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {(["unknown", "vaginal", "assisted", "caesarean"] as const).map((m) => (
              <Chip key={m} label={m === "unknown" ? "Prefer not to say" : m} active={deliveryMode === m} onPress={() => setDeliveryMode(m)} />
            ))}
          </View>
          <AppText variant="label">Complications (optional)</AppText>
          <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={complications} onChangeText={setComplications} style={textInputStyle} />
          {error && <ErrorText>{error}</ErrorText>}
          <PrimaryButton title="Save" onPress={submit} loading={submitting} />
        </View>
      )}

      {latest && <PostnatalCheckinSection patientId={patientId} organisationId={organisationId} postnatalProfileId={latest.id} />}

      <AppText variant="label" tone="brandText" onPress={() => onNavigate("wellbeing")}>
        Mental wellbeing check-in (already in Wellbeing) →
      </AppText>
    </Card>
  );
}

function PostnatalCheckinSection({
  patientId,
  organisationId,
  postnatalProfileId,
}: {
  patientId: string;
  organisationId: string;
  postnatalProfileId: string;
}) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [checkins, setCheckins] = useState<PostnatalCheckin[]>([]);
  const [window, setWindowValue] = useState<CheckinWindow>("week_1");
  const [breastfeeding, setBreastfeeding] = useState<BreastfeedingStatus | "">("");
  const [notes, setNotes] = useState("");
  const [discussed, setDiscussed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    loadPostnatalCheckins(postnatalProfileId)
      .then(setCheckins)
      .catch(() => {});
  }, [postnatalProfileId]);

  useEffect(() => refresh(), [refresh]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await logPostnatalCheckin(patientId, organisationId, postnatalProfileId, {
      checkin_window: window,
      breastfeeding_status: breastfeeding || undefined,
      maternal_recovery_notes: notes.trim() || undefined,
      contraception_discussed: discussed,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotes("");
    setDiscussed(false);
    refresh();
  }

  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
      <AppText variant="label" tone="textMuted" style={{ textTransform: "uppercase", letterSpacing: 0.3 }}>Check-ins</AppText>
      {checkins.map((c) => (
        <AppText variant="body" key={c.id}>
          {CHECKIN_LABEL[c.checkin_window as CheckinWindow]}
          {c.breastfeeding_status ? ` · ${BREASTFEEDING_LABEL[c.breastfeeding_status as BreastfeedingStatus]}` : ""}
          {c.contraception_discussed ? " · Contraception discussed" : ""}
        </AppText>
      ))}

      <AppText variant="label">Check-in</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {CHECKIN_WINDOWS.map((w) => (
          <Chip key={w} label={CHECKIN_LABEL[w]} active={window === w} onPress={() => setWindowValue(w)} />
        ))}
      </View>
      <AppText variant="label">Breastfeeding</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Chip label="Not recorded" active={breastfeeding === ""} onPress={() => setBreastfeeding("")} />
        {BREASTFEEDING_STATUSES.map((s) => (
          <Chip key={s} label={BREASTFEEDING_LABEL[s]} active={breastfeeding === s} onPress={() => setBreastfeeding(s)} />
        ))}
      </View>
      <AppText variant="label">How are you recovering?</AppText>
      <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={notes} onChangeText={setNotes} style={textInputStyle} />
      <AppText variant="body" onPress={() => setDiscussed((v) => !v)}>
        <Text style={{ fontWeight: "700", color: discussed ? colors.brandPressed : colors.faint }}>{discussed ? "☑ " : "☐ "}</Text>
        We discussed contraception at this check-in
      </AppText>
      {error && <ErrorText>{error}</ErrorText>}
      <SecondaryButton title="Log check-in" onPress={submit} loading={submitting} />
    </View>
  );
}

function BreastSymptomCard({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [reports, setReports] = useState<BreastSymptomReport[]>([]);
  const [types, setTypes] = useState<Set<BreastSymptomType>>(new Set());
  const [laterality, setLaterality] = useState<"left" | "right" | "both" | "unsure" | "">("");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(() => {
    loadBreastSymptomReports(patientId)
      .then(setReports)
      .catch(() => {});
  }, [patientId]);

  useEffect(() => refresh(), [refresh]);

  function toggle(type: BreastSymptomType) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  async function submit() {
    setError(null);
    setSaved(false);
    setSubmitting(true);
    const result = await reportBreastSymptoms(patientId, organisationId, {
      symptom_types: [...types],
      laterality: laterality || undefined,
      duration_note: duration.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    setTypes(new Set());
    setDuration("");
    setNotes("");
    refresh();
  }

  return (
    <Disclosure title="Breast health: report a symptom" hint="Report something new, and see past reports">
      <MutedText>
        Noticed something new? Report it here for clinical assessment, separate from your routine breast
        screening.
      </MutedText>

      <AppText variant="label">What have you noticed?</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {BREAST_SYMPTOM_TYPES.map((t) => (
          <Chip key={t} label={BREAST_SYMPTOM_LABEL[t]} active={types.has(t)} onPress={() => toggle(t)} />
        ))}
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="label">Side</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {(["", "left", "right", "both"] as const).map((s) => (
              <Chip key={s} label={s === "" ? "Not sure" : s} active={laterality === s} onPress={() => setLaterality(s)} />
            ))}
          </View>
        </View>
      </View>
      <AppText variant="label">How long?</AppText>
      <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={duration} onChangeText={setDuration} placeholder="e.g. about a week" style={textInputStyle} />
      <AppText variant="label">Anything else?</AppText>
      <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={notes} onChangeText={setNotes} style={textInputStyle} />

      {error && <ErrorText>{error}</ErrorText>}
      {saved && <MutedText>Reported. Your care team has been notified for clinical assessment.</MutedText>}
      <PrimaryButton title="Report symptom" onPress={submit} disabled={types.size === 0} loading={submitting} />

      {reports.length > 0 && (
        <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
          <AppText variant="label" tone="textMuted" style={{ textTransform: "uppercase", letterSpacing: 0.3 }}>
            Past reports
          </AppText>
          {reports.slice(0, 5).map((r) => (
            <AppText variant="body" key={r.id}>
              {when(r.created_at)}: {(r.symptom_types as BreastSymptomType[]).map((t) => BREAST_SYMPTOM_LABEL[t]).join(", ")}
            </AppText>
          ))}
        </View>
      )}
    </Disclosure>
  );
}

function MenopauseSymptomCard({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [logs, setLogs] = useState<MenopauseSymptomLog[]>([]);
  const [types, setTypes] = useState<Set<MenopauseSymptomType>>(new Set());
  const [severity, setSeverity] = useState("");
  const [bleeding, setBleeding] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(() => {
    loadMenopauseSymptomLogs(patientId)
      .then(setLogs)
      .catch(() => {});
  }, [patientId]);

  useEffect(() => refresh(), [refresh]);

  function toggle(type: MenopauseSymptomType) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  async function submit() {
    setError(null);
    setSaved(false);
    setSubmitting(true);
    const result = await logMenopauseSymptoms(patientId, organisationId, {
      symptom_types: [...types],
      severity: severity ? Number(severity) : undefined,
      postmenopausal_bleeding: bleeding,
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    setTypes(new Set());
    setSeverity("");
    setBleeding(false);
    setNotes("");
    refresh();
  }

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="bodyStrong">Menopause</AppText>
      <MutedText>Track symptoms so you and your care team can see patterns over time.</MutedText>

      <AppText variant="label">Symptoms today</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {MENOPAUSE_SYMPTOM_TYPES.map((t) => (
          <Chip key={t} label={MENOPAUSE_SYMPTOM_LABEL[t]} active={types.has(t)} onPress={() => toggle(t)} />
        ))}
      </View>

      <AppText variant="label">Overall severity (0 to 10)</AppText>
      <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={severity} onChangeText={setSeverity} keyboardType="numeric" style={[textInputStyle, { maxWidth: 90 }]} />

      <AppText variant="body" onPress={() => setBleeding((v) => !v)}>
        <Text style={{ fontWeight: "700", color: bleeding ? colors.brandPressed : colors.faint }}>{bleeding ? "☑ " : "☐ "}</Text>
        I&apos;ve had bleeding since menopause
      </AppText>
      {bleeding && (
        <AppText variant="label" tone="warnText" accessibilityRole="alert">
          {t("menopause.bleeding_urgent")}
        </AppText>
      )}

      <AppText variant="label">Notes (optional)</AppText>
      <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={notes} onChangeText={setNotes} style={textInputStyle} />

      {error && <ErrorText>{error}</ErrorText>}
      {saved && <MutedText>Logged.</MutedText>}
      <PrimaryButton title="Log symptoms" onPress={submit} disabled={types.size === 0 && !bleeding} loading={submitting} />

      {logs.length > 0 && (
        <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
          <AppText variant="label" tone="textMuted" style={{ textTransform: "uppercase", letterSpacing: 0.3 }}>Recent</AppText>
          {logs.slice(0, 5).map((log) => (
            <AppText variant="body" key={log.id}>
              {when(log.logged_at)}: {(log.symptom_types as MenopauseSymptomType[]).map((t) => MENOPAUSE_SYMPTOM_LABEL[t]).join(", ") || "no symptoms"}
              {log.postmenopausal_bleeding ? " · bleeding reported" : ""}
            </AppText>
          ))}
        </View>
      )}
    </Card>
  );
}

function FertilityRequestCard({
  patientId,
  organisationId,
  onNavigate,
}: {
  patientId: string;
  organisationId: string;
  onNavigate: (section: SectionId) => void;
}) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [requests, setRequests] = useState<FertilityAssessmentRequest[]>([]);
  const [months, setMonths] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    loadFertilityAssessmentRequests(patientId)
      .then(setRequests)
      .catch(() => {});
  }, [patientId]);

  useEffect(() => refresh(), [refresh]);

  const hasOpenRequest = requests.some((r) => r.status !== "closed");

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await requestFertilityAssessment(patientId, organisationId, {
      trying_duration_months: months ? Number(months) : undefined,
      concern_notes: notes.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMonths("");
    setNotes("");
    refresh();
  }

  return (
    <Disclosure title="Fertility" hint="Request an assessment, and read the basics">
      <MutedText>
        Fertility assessment involves your history, some tests and, where appropriate, a specialist review,
        rather than a guaranteed outcome or a fixed timeline.
      </MutedText>
      <AppText variant="label" tone="brandText" onPress={() => onNavigate("learn")}>
        Read fertility basics and preconception health
      </AppText>

      {requests.length > 0 && (
        <View style={{ gap: 4 }}>
          {requests.map((r) => (
            <AppText variant="body" key={r.id}>
              {when(r.created_at)}: {fertilityStatusLabel(r.status)}
            </AppText>
          ))}
        </View>
      )}

      {!hasOpenRequest && (
        <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
          <AppText variant="label">
            How many months have you been trying to conceive? (optional)
          </AppText>
          <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={months} onChangeText={setMonths} keyboardType="numeric" style={[textInputStyle, { maxWidth: 110 }]} />
          <AppText variant="label">
            What would you like your care team to know? (optional)
          </AppText>
          <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={notes} onChangeText={setNotes} style={textInputStyle} />
          {error && <ErrorText>{error}</ErrorText>}
          <PrimaryButton title="Request a fertility assessment" onPress={submit} loading={submitting} />
        </View>
      )}
    </Disclosure>
  );
}

/** S47d: the screen opens only once the person has said yes to reproductive health data; until then it asks. */
export function WomensHealthScreen(props: WomensHealthScreenProps) {
  return (
    <FeatureConsentGate dataType="reproductive" title="Women's Health">
      <WomensHealthScreenInner {...props} />
    </FeatureConsentGate>
  );
}
