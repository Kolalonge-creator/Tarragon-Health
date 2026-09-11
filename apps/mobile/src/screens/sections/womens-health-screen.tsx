import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { supabase } from "@/lib/supabase";
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
import type { SectionId } from "@/lib/sections";
import { CycleScreen } from "@/screens/sections/cycle-screen";
import { EmergencyGuidanceModal } from "@/screens/emergency-guidance-modal";
import { colors, radius, spacing } from "@/ui/theme";
import { Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/components";

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/**
 * `appointments` has no category/specialty column, so there is no real
 * field marking an appointment as "women's health" — mirrors the same
 * heuristic in apps/web/.../womens-health/page.tsx. A keyword match over
 * the free-text reason/service columns, not a guarantee; only affects
 * what this stat highlights, never what the patient can book or see on
 * the real Appointments screen.
 */
const WOMENS_HEALTH_APPOINTMENT_KEYWORDS = [
  "women",
  "gyn",
  "pregnan",
  "antenatal",
  "prenatal",
  "postnatal",
  "postpartum",
  "cervical",
  "breast",
  "menstrual",
  "period",
  "contracept",
  "menopause",
  "fertility",
  "pelvic",
  "obstetric",
] as const;

function isWomensHealthAppointment(appt: { reason: string | null; service: string | null }): boolean {
  const text = `${appt.reason ?? ""} ${appt.service ?? ""}`.toLowerCase();
  return WOMENS_HEALTH_APPOINTMENT_KEYWORDS.some((keyword) => text.includes(keyword));
}

const textInputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 14,
  color: colors.ink,
} as const;

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Text
      onPress={onPress}
      style={{
        fontSize: 12.5,
        fontWeight: "600",
        paddingVertical: 7,
        paddingHorizontal: 11,
        borderRadius: 999,
        backgroundColor: active ? colors.brand : colors.groupBg,
        color: active ? "#FFFFFF" : colors.ink,
      }}
    >
      {label}
    </Text>
  );
}

function CautionNote({ text }: { text: string }) {
  return (
    <View style={{ backgroundColor: colors.status.warnBg, borderRadius: radius.control, padding: 10, gap: 2 }}>
      <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.status.warn }}>Worth discussing with your care team</Text>
      <Text style={{ fontSize: 13, color: colors.ink }}>{text}</Text>
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
export function WomensHealthScreen({ patientId, organisationId, onNavigate }: WomensHealthScreenProps) {
  const [loading, setLoading] = useState(true);
  const [sex, setSex] = useState<string | null>(null);
  const [reproProfile, setReproProfile] = useState<ReproductiveHealthProfile | null>(null);
  const [reproUnknown, setReproUnknown] = useState(false);
  const [pregnancy, setPregnancy] = useState<PatientPregnancy | null>(null);
  const [pregnancyUnknown, setPregnancyUnknown] = useState(false);
  const [activeConditions, setActiveConditions] = useState<CarePlanCondition[]>([]);
  const [nextAppointment, setNextAppointment] = useState<string | null>(null);
  const [cycleTrackerOpen, setCycleTrackerOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [profileRes, pregnancyRes, plansRes, appointmentRes] = await Promise.all([
      loadReproductiveHealthProfile(patientId).then(
        (data) => ({ ok: true as const, data }),
        (e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })
      ),
      loadPregnancy(patientId),
      supabase.from("care_plans").select("condition").eq("patient_id", patientId).eq("status", "active"),
      supabase
        .from("appointments")
        .select("scheduled_for, reason, service")
        .eq("patient_id", patientId)
        .neq("status", "cancelled")
        .gte("scheduled_for", new Date().toISOString())
        .order("scheduled_for", { ascending: true })
        .limit(20),
    ]);

    setReproUnknown(!profileRes.ok);
    setReproProfile(profileRes.ok ? profileRes.data : null);
    setPregnancyUnknown(!pregnancyRes.ok);
    setPregnancy(pregnancyRes.ok ? pregnancyRes.data : null);
    setActiveConditions(((plansRes.data ?? []) as { condition: CarePlanCondition }[]).map((p) => p.condition));
    const nextWomensHealthAppointment = ((appointmentRes.data ?? []) as { scheduled_for: string; reason: string | null; service: string | null }[]).find(
      isWomensHealthAppointment
    );
    setNextAppointment(nextWomensHealthAppointment?.scheduled_for ?? null);
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
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (sex !== "female") {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
        <ScreenTitle>Women&apos;s Health</ScreenTitle>
        <Card style={{ gap: 10 }}>
          <MutedText>
            {sex === null
              ? "This section covers cycle tracking, contraception, pregnancy, postnatal care and menopause for female patients. We don't have a sex recorded on your health profile yet, so we can't tell whether it applies to you. Add it on your profile and this section will open up if it's relevant."
              : "This section covers cycle tracking, contraception, pregnancy, postnatal care and menopause, so it doesn't apply to your health profile. Everything here is built around care that's specific to female patients."}
          </MutedText>
          <Text onPress={() => onNavigate("prevention")} style={{ fontSize: 13, fontWeight: "700", color: colors.brand }}>
            The screenings and checks relevant to you live in Prevention →
          </Text>
        </Card>
      </ScrollView>
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
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
      <View>
        <ScreenTitle>Women&apos;s Health</ScreenTitle>
        <MutedText>Prevention, reproductive health, pregnancy, postnatal care and long-term health, in one place.</MutedText>
      </View>

      <Card style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
        <View style={{ flexBasis: "30%", flexGrow: 1 }}>
          <MutedText>Cycle</MutedText>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
            {reproUnknown ? "Not available" : reproProfile?.last_period_date ? "Tracked" : "Not tracked"}
          </Text>
        </View>
        {gestationalEstimate && (
          <View style={{ flexBasis: "30%", flexGrow: 1 }}>
            <MutedText>Antenatal</MutedText>
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Week {gestationalEstimate.weeks}</Text>
          </View>
        )}
        <Pressable style={{ flexBasis: "30%", flexGrow: 1 }} onPress={() => onNavigate("appointments")}>
          <MutedText>Next appointment</MutedText>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.brand }}>
            {nextAppointment ? when(nextAppointment) : "Book a women's health visit"}
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
          <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>
            We couldn&apos;t load your reproductive health profile just now
          </Text>
          <MutedText>
            Your cycle, contraception and life stage are stored, we simply couldn&apos;t read them on this
            screen. Anything below that depends on them is hidden rather than guessed at. Please refresh and
            try again.
          </MutedText>
        </Card>
      )}

      {pregnancyUnknown && (
        <Card style={{ gap: 6 }}>
          <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>
            We couldn&apos;t load your pregnancy record just now
          </Text>
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
          <PregnancyRedFlagCheck patientId={patientId} organisationId={organisationId} />
        </>
      )}

      {showPostnatal && <PostnatalCard patientId={patientId} organisationId={organisationId} onNavigate={onNavigate} />}

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
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Your cycle & life stage</Text>
      <MutedText>
        Tell us where you are so we can give a useful nudge, never a diagnosis, and you can change this any
        time.
      </MutedText>

      <Text
        onPress={onOpenCycleTracker}
        style={{ borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.brandTint, borderRadius: radius.control, padding: 12 }}
      >
        <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>Open your cycle tracker</Text>
        {"\n"}
        <Text style={{ fontSize: 12, color: colors.muted }}>
          Log your period, see what to expect next, and track how you feel.
        </Text>
      </Text>

      {nudges.length > 0 && (
        <View style={{ backgroundColor: colors.brandTint, borderRadius: radius.control, padding: 10, gap: 4 }}>
          {nudges.map((n) => (
            <Text key={n.id} style={{ fontSize: 12, color: colors.ink }}>
              {n.label}
            </Text>
          ))}
        </View>
      )}

      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Life stage</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(Object.keys(LIFE_STAGE_LABEL) as ReproductiveLifeStage[]).map((stage) => (
          <Chip key={stage} label={LIFE_STAGE_LABEL[stage]} active={lifeStage === stage} onPress={() => setLifeStage(stage)} />
        ))}
      </View>

      {lifeStage === "menstruating" && (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Last period start date</Text>
            <TextInput value={lastPeriodDate} onChangeText={setLastPeriodDate} placeholder="YYYY-MM-DD" style={textInputStyle} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Avg. cycle length (days)</Text>
            <TextInput value={cycleLength} onChangeText={setCycleLength} placeholder="28" keyboardType="numeric" style={textInputStyle} />
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
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Contraception</Text>
      <MutedText>
        Learn about your options, and let us know what you&apos;re currently using so your care team has the
        full picture.
      </MutedText>
      {cautionNote && <CautionNote text={cautionNote} />}
      <TextInput value={method} onChangeText={setMethod} placeholder="e.g. combined pill, implant, condoms, none" style={textInputStyle} />
      {error && <ErrorText>{error}</ErrorText>}
      {saved && <MutedText>Saved.</MutedText>}
      <SecondaryButton title="Save" onPress={submit} loading={submitting} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
        <Text onPress={() => onNavigate("learn")} style={{ fontSize: 12.5, fontWeight: "700", color: colors.brand }}>
          Read about contraception options
        </Text>
        <Text onPress={() => onNavigate("appointments")} style={{ fontSize: 12.5, fontWeight: "700", color: colors.brand }}>
          Book a contraception consultation
        </Text>
      </View>
    </Card>
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
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Antenatal care</Text>
      <MutedText>Track your appointments, investigations, scans and vaccinations through pregnancy.</MutedText>

      {pregnancy.high_risk && (
        <CautionNote text="Keep your antenatal appointments and reach out if anything changes." />
      )}

      {estimate ? (
        <Text style={{ fontSize: 13, color: colors.ink }}>
          Estimated {estimate.weeks} weeks pregnant. This is an estimate, not a confirmed clinical dating.
          Estimated due date: {when(estimate.estimatedDueDate)}.
        </Text>
      ) : (
        <MutedText>Add your last menstrual period date for a gestational-age estimate.</MutedText>
      )}

      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Last menstrual period date</Text>
          <TextInput value={lmp} onChangeText={setLmp} placeholder="YYYY-MM-DD" style={textInputStyle} />
        </View>
        <SecondaryButton title="Save" onPress={submit} loading={submitting} />
      </View>
      {error && <ErrorText>{error}</ErrorText>}

      {visits.length > 0 && (
        <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, color: colors.muted }}>
            Antenatal visits
          </Text>
          {visits.map((visit) => (
            <View key={visit.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>
                  {visit.gestational_week_at_visit != null ? `Week ${visit.gestational_week_at_visit}` : `Visit ${visit.visit_number ?? ""}`}
                </Text>
                <MutedText>{visit.status}</MutedText>
              </View>
              {visit.findings && <Text style={{ fontSize: 12.5, color: colors.muted }}>{visit.findings}</Text>}
            </View>
          ))}
        </View>
      )}

      <Text onPress={() => onNavigate("appointments")} style={{ fontSize: 12.5, fontWeight: "700", color: colors.brand }}>
        Book your next antenatal visit
      </Text>
    </Card>
  );
}

function PregnancyRedFlagCheck({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<PregnancyDangerSign>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guidanceVisible, setGuidanceVisible] = useState(false);
  const [detail, setDetail] = useState("");
  const [emergencyContact, setEmergencyContact] = useState<{ name: string; phone: string | null; relationship: string | null } | null>(null);
  const [state, setState] = useState<string | null>(null);

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
    setState(context?.state ?? null);
    setDetail(`Pregnancy warning sign(s): ${signs.map((s) => PREGNANCY_DANGER_SIGN_LABEL[s]).join(", ")}`);
    setSelected(new Set());
    setExpanded(false);
    setGuidanceVisible(true);
  }

  return (
    <Card style={{ borderColor: colors.danger, gap: 10 }}>
      <Text onPress={() => setExpanded((v) => !v)} style={{ fontSize: 14, fontWeight: "700", color: colors.danger }}>
        ⚠ Any pregnancy warning signs? {expanded ? "(Hide)" : "(Check now)"}
      </Text>

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
        state={state}
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
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Postnatal care</Text>
      <MutedText>Maternal recovery, breastfeeding support and follow-up after delivery.</MutedText>

      {latest ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Delivered {when(latest.delivery_date)}</Text>
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
              <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Delivery date</Text>
              <TextInput value={deliveryDate} onChangeText={setDeliveryDate} placeholder="YYYY-MM-DD" style={textInputStyle} />
            </View>
          </View>
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Delivery mode</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {(["unknown", "vaginal", "assisted", "caesarean"] as const).map((m) => (
              <Chip key={m} label={m === "unknown" ? "Prefer not to say" : m} active={deliveryMode === m} onPress={() => setDeliveryMode(m)} />
            ))}
          </View>
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Complications (optional)</Text>
          <TextInput value={complications} onChangeText={setComplications} style={textInputStyle} />
          {error && <ErrorText>{error}</ErrorText>}
          <PrimaryButton title="Save" onPress={submit} loading={submitting} />
        </View>
      )}

      {latest && <PostnatalCheckinSection patientId={patientId} organisationId={organisationId} postnatalProfileId={latest.id} />}

      <Text onPress={() => onNavigate("wellbeing")} style={{ fontSize: 12.5, fontWeight: "700", color: colors.brand }}>
        Mental wellbeing check-in (already in Wellbeing) →
      </Text>
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
      <Text style={{ fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, color: colors.muted }}>Check-ins</Text>
      {checkins.map((c) => (
        <Text key={c.id} style={{ fontSize: 13, color: colors.ink }}>
          {CHECKIN_LABEL[c.checkin_window as CheckinWindow]}
          {c.breastfeeding_status ? ` · ${BREASTFEEDING_LABEL[c.breastfeeding_status as BreastfeedingStatus]}` : ""}
          {c.contraception_discussed ? " · Contraception discussed" : ""}
        </Text>
      ))}

      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Check-in</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {CHECKIN_WINDOWS.map((w) => (
          <Chip key={w} label={CHECKIN_LABEL[w]} active={window === w} onPress={() => setWindowValue(w)} />
        ))}
      </View>
      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Breastfeeding</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Chip label="Not recorded" active={breastfeeding === ""} onPress={() => setBreastfeeding("")} />
        {BREASTFEEDING_STATUSES.map((s) => (
          <Chip key={s} label={BREASTFEEDING_LABEL[s]} active={breastfeeding === s} onPress={() => setBreastfeeding(s)} />
        ))}
      </View>
      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>How are you recovering?</Text>
      <TextInput value={notes} onChangeText={setNotes} style={textInputStyle} />
      <Text
        onPress={() => setDiscussed((v) => !v)}
        style={{ fontSize: 13, color: colors.ink }}
      >
        <Text style={{ fontWeight: "700", color: discussed ? colors.brand : colors.faint }}>{discussed ? "☑ " : "☐ "}</Text>
        We discussed contraception at this check-in
      </Text>
      {error && <ErrorText>{error}</ErrorText>}
      <SecondaryButton title="Log check-in" onPress={submit} loading={submitting} />
    </View>
  );
}

function BreastSymptomCard({ patientId, organisationId }: { patientId: string; organisationId: string }) {
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
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Breast health: report a symptom</Text>
      <MutedText>
        Noticed something new? Report it here for clinical assessment, separate from your routine breast
        screening.
      </MutedText>

      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>What have you noticed?</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {BREAST_SYMPTOM_TYPES.map((t) => (
          <Chip key={t} label={BREAST_SYMPTOM_LABEL[t]} active={types.has(t)} onPress={() => toggle(t)} />
        ))}
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Side</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {(["", "left", "right", "both"] as const).map((s) => (
              <Chip key={s} label={s === "" ? "Not sure" : s} active={laterality === s} onPress={() => setLaterality(s)} />
            ))}
          </View>
        </View>
      </View>
      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>How long?</Text>
      <TextInput value={duration} onChangeText={setDuration} placeholder="e.g. about a week" style={textInputStyle} />
      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Anything else?</Text>
      <TextInput value={notes} onChangeText={setNotes} style={textInputStyle} />

      {error && <ErrorText>{error}</ErrorText>}
      {saved && <MutedText>Reported. Your care team has been notified for clinical assessment.</MutedText>}
      <PrimaryButton title="Report symptom" onPress={submit} disabled={types.size === 0} loading={submitting} />

      {reports.length > 0 && (
        <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, color: colors.muted }}>
            Past reports
          </Text>
          {reports.slice(0, 5).map((r) => (
            <Text key={r.id} style={{ fontSize: 13, color: colors.ink }}>
              {when(r.created_at)}: {(r.symptom_types as BreastSymptomType[]).map((t) => BREAST_SYMPTOM_LABEL[t]).join(", ")}
            </Text>
          ))}
        </View>
      )}
    </Card>
  );
}

function MenopauseSymptomCard({ patientId, organisationId }: { patientId: string; organisationId: string }) {
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
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Menopause</Text>
      <MutedText>Track symptoms so you and your care team can see patterns over time.</MutedText>

      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Symptoms today</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {MENOPAUSE_SYMPTOM_TYPES.map((t) => (
          <Chip key={t} label={MENOPAUSE_SYMPTOM_LABEL[t]} active={types.has(t)} onPress={() => toggle(t)} />
        ))}
      </View>

      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Overall severity (0–10)</Text>
      <TextInput value={severity} onChangeText={setSeverity} keyboardType="numeric" style={[textInputStyle, { maxWidth: 90 }]} />

      <Text
        onPress={() => setBleeding((v) => !v)}
        style={{ fontSize: 13, color: colors.ink }}
      >
        <Text style={{ fontWeight: "700", color: bleeding ? colors.brand : colors.faint }}>{bleeding ? "☑ " : "☐ "}</Text>
        I&apos;ve had bleeding since menopause
      </Text>
      {bleeding && (
        <Text style={{ fontSize: 12, color: colors.status.warn }}>
          Any bleeding after menopause always needs assessment. Reporting this notifies your care team.
        </Text>
      )}

      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Notes (optional)</Text>
      <TextInput value={notes} onChangeText={setNotes} style={textInputStyle} />

      {error && <ErrorText>{error}</ErrorText>}
      {saved && <MutedText>Logged.</MutedText>}
      <PrimaryButton title="Log symptoms" onPress={submit} disabled={types.size === 0 && !bleeding} loading={submitting} />

      {logs.length > 0 && (
        <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, color: colors.muted }}>Recent</Text>
          {logs.slice(0, 5).map((log) => (
            <Text key={log.id} style={{ fontSize: 13, color: colors.ink }}>
              {when(log.logged_at)}: {(log.symptom_types as MenopauseSymptomType[]).map((t) => MENOPAUSE_SYMPTOM_LABEL[t]).join(", ") || "no symptoms"}
              {log.postmenopausal_bleeding ? " · bleeding reported" : ""}
            </Text>
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
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Fertility</Text>
      <MutedText>
        Fertility assessment involves your history, some tests and, where appropriate, a specialist review,
        never a guaranteed outcome or a certain timeline.
      </MutedText>
      <Text onPress={() => onNavigate("learn")} style={{ fontSize: 12.5, fontWeight: "700", color: colors.brand }}>
        Read fertility basics and preconception health
      </Text>

      {requests.length > 0 && (
        <View style={{ gap: 4 }}>
          {requests.map((r) => (
            <Text key={r.id} style={{ fontSize: 13, color: colors.ink }}>
              {when(r.created_at)}: {fertilityStatusLabel(r.status)}
            </Text>
          ))}
        </View>
      )}

      {!hasOpenRequest && (
        <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>
            How many months have you been trying to conceive? (optional)
          </Text>
          <TextInput value={months} onChangeText={setMonths} keyboardType="numeric" style={[textInputStyle, { maxWidth: 110 }]} />
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>
            What would you like your care team to know? (optional)
          </Text>
          <TextInput value={notes} onChangeText={setNotes} style={textInputStyle} />
          {error && <ErrorText>{error}</ErrorText>}
          <PrimaryButton title="Request a fertility assessment" onPress={submit} loading={submitting} />
        </View>
      )}
    </Card>
  );
}
