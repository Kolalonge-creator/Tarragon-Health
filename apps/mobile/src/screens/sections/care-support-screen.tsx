import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  loadMyAsyncConsults,
  submitAsyncConsult,
  ASYNC_CONSULT_CATEGORIES,
  ASK_A_DOCTOR_CREDIT_REQUIRED_MARKER,
  loadMyNavigationRequests,
  createNavigationRequest,
  submitNavigationRequestFeedback,
  NAVIGATION_REQUEST_CATEGORIES,
  NAVIGATION_REQUEST_CATEGORY_LABEL,
  NAVIGATION_REQUEST_STATUS_LABEL,
  type AsyncConsultWithAnswerer,
  type NavigationRequest,
  type NavigationRequestCategory,
} from "@/lib/care-support";
import {
  admissionDurationLabel,
  bucketCareTasks,
  completeCareTask,
  ESCALATION_STATUS_COPY,
  formatCareDate,
  getCarePlans,
  getCareGoals,
  getCareTasks,
  getEscalations,
  getHospitalAdmissions,
  getReferrals,
  hasCarePlanAccess,
  humanizeCareLabel,
  logHospitalAdmission,
  markAdmissionDischarged,
  REFERRAL_STATUS_COPY,
  todayDateInput,
  whatHappensNext,
  type CarePlanGoal,
  type CarePlanSummaryItem,
  type CareTask,
  type EscalationItem,
  type HospitalAdmission,
  type ReferralItem,
} from "@/lib/care";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, radius, spacing } from "@/ui/theme";
import {
  Badge,
  CalloutCard,
  Card,
  ErrorText,
  MutedText,
  PrimaryButton,
  SecondaryButton,
} from "@/ui/components";

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
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

const dateInputStyle = {
  ...textInputStyle,
  paddingVertical: 0,
  height: 38,
} as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface CareSupportScreenProps {
  patientId: string;
  organisationId: string;
}

/**
 * Native Care & support. The web /patient/care hub is a large kitchen sink
 * (care plan tasks, chronic programme, referrals, video visits, second
 * opinions, vouchers, wellness points…) — this screen covers the pieces a
 * patient checking in on their care actually needs most: the doctor-set
 * care plan (tasks + goals), care follow-ups/escalations, specialist
 * referrals, hospital admissions, asking a doctor a written question, and
 * getting non-clinical help — all real native reads/writes against
 * Supabase, no embedded WebView anywhere on this screen (that used to be a
 * "open the full hub" Modal wrapping WebViewScreen; removed in favour of
 * building the content natively).
 *
 * What's deliberately left as a system-browser hand-off, not rebuilt here:
 * the five one-off-paid, Paystack-checkout-shaped services (book a video
 * visit, second opinion, verified documents, senior case review, and
 * buying an Ask-a-doctor credit when one is needed) — same reasoning as
 * "My services" elsewhere in the app (App Store Review 3.1.1: embedding a
 * digital-purchase checkout in-app risks rejection, so checkout always
 * opens the system browser, never a WebView). Also left on web: proposing a
 * new care-plan goal (a form on top of an already sizeable screen) and the
 * discretionary/engagement cards (chronic programme timeline, care circle,
 * vouchers, wellness points, testimonials) that the web page itself treats
 * as lower priority than the content above.
 */
export function CareSupportScreen({ patientId, organisationId }: CareSupportScreenProps) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 22 }}
    >
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Care & support</Text>
        <MutedText>Your care plan, reviews, and referrals.</MutedText>
      </View>

      <CarePlanSection patientId={patientId} />
      <EscalationsSection patientId={patientId} />
      <ReferralsSection patientId={patientId} />
      <HospitalAdmissionsSection patientId={patientId} organisationId={organisationId} />
      <AskADoctorSection patientId={patientId} organisationId={organisationId} />
      <NeedHelpSection patientId={patientId} />

      <CalloutCard
        icon="medkit-outline"
        title="More ways to get care"
        subtitle="Book a video visit, get a second opinion, or verify a document — one-off paid services, opened in your browser."
        ctaLabel="Open"
        onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/care`)}
      />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Your care plan — mirrors apps/web/src/app/(dashboard)/patient/my-care-plan-tasks.tsx,
// gated the same way (RequiresEntitlement("clinician_review")).
// ---------------------------------------------------------------------------

function CarePlanSection({ patientId }: { patientId: string }) {
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [plans, setPlans] = useState<CarePlanSummaryItem[]>([]);
  const [tasks, setTasks] = useState<CareTask[]>([]);
  const [goals, setGoals] = useState<CarePlanGoal[]>([]);

  const refreshTasks = useCallback(async () => {
    const res = await getCareTasks(patientId);
    if (res.ok) setTasks(res.data);
  }, [patientId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([hasCarePlanAccess(), getCarePlans(patientId), getCareTasks(patientId), getCareGoals(patientId)]).then(
      ([access, planRes, taskRes, goalRes]) => {
        if (cancelled) return;
        if (access.ok) setHasAccess(access.data);
        if (planRes.ok) setPlans(planRes.data);
        if (taskRes.ok) setTasks(taskRes.data);
        if (goalRes.ok) setGoals(goalRes.data);
        setLoading(false);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  if (loading) {
    return (
      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Your care plan</Text>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (!hasAccess) {
    return (
      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Your care plan</Text>
        <Card style={{ gap: 8, borderStyle: "dashed" }}>
          <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>
            A doctor-set care plan is a paid service
          </Text>
          <MutedText>
            Your readings are checked against care protocols whatever you pay, and a dangerous one gets
            you clear guidance and a specific next step right away. What a doctor adds is a care plan set
            for your condition and reviewed on a schedule, as part of the 12-week doctor-supported
            programme.
          </MutedText>
          <SecondaryButton
            title="See what this costs"
            onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/subscription`)}
          />
        </Card>
      </View>
    );
  }

  const buckets = bucketCareTasks(tasks, new Date());
  const totalTasks = buckets.overdue.length + buckets.today.length + buckets.thisWeek.length + buckets.upcoming.length;

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Your care plan</Text>
      <Card style={{ gap: 12 }}>
        {plans.length === 0 ? (
          <MutedText>
            No care plan yet. A plan is written when your care team is actively managing a condition
            with you. Keep logging your readings and adding results, and anything set up for you shows
            up here.
          </MutedText>
        ) : (
          <View style={{ gap: 8 }}>
            {plans.length > 1 ? (
              <MutedText>
                Managed together as one coordinated plan: {plans.map((p) => p.condition).join(", ")}.
              </MutedText>
            ) : null}
            {plans.map((plan) => (
              <View key={plan.id} style={{ gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>{plan.condition}</Text>
                  <Badge tone="brand">Active</Badge>
                </View>
                <MutedText>
                  {plan.clinicianName ? `Managed by ${plan.clinicianName}` : "Not yet assigned to a doctor"}
                </MutedText>
                {plan.targetRanges.length > 0 ? (
                  <Text style={{ fontSize: 12, color: colors.muted }}>
                    {plan.targetRanges.map(([k, v]) => `${k}: ${v}`).join("; ")}
                  </Text>
                ) : null}
                {plan.notes ? <Text style={{ fontSize: 12, color: colors.muted }}>{plan.notes}</Text> : null}
              </View>
            ))}
          </View>
        )}

        {totalTasks === 0 ? (
          <MutedText>No tasks yet. Your care team will add these as your plan is set up.</MutedText>
        ) : (
          <View style={{ gap: 12 }}>
            <TaskGroup title="Overdue" tasks={buckets.overdue} onChanged={refreshTasks} />
            <TaskGroup title="Today" tasks={buckets.today} onChanged={refreshTasks} />
            <TaskGroup title="This week" tasks={buckets.thisWeek} onChanged={refreshTasks} />
            <TaskGroup title="Upcoming" tasks={buckets.upcoming} onChanged={refreshTasks} />
          </View>
        )}

        {goals.length > 0 ? (
          <View style={{ gap: 6 }}>
            <Text
              style={{
                fontSize: 11.5,
                fontWeight: "700",
                color: colors.muted,
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
            >
              Your goals
            </Text>
            {goals.map((goal) => (
              <View key={goal.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Badge tone={goal.status === "proposed" ? "neutral" : "brand"}>
                  {goal.status === "proposed" ? "Pending review" : "Active"}
                </Badge>
                <Text style={{ flex: 1, fontSize: 13, color: colors.ink }}>{goal.description}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

function TaskGroup({ title, tasks, onChanged }: { title: string; tasks: CareTask[]; onChanged: () => void }) {
  if (tasks.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{ fontSize: 11.5, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.4 }}
      >
        {title}
      </Text>
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} onChanged={onChanged} />
      ))}
    </View>
  );
}

function TaskRow({ task, onChanged }: { task: CareTask; onChanged: () => void }) {
  const [showUnable, setShowUnable] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const due = task.due_at ? formatCareDate(task.due_at) : null;

  async function submit(status: "completed" | "unable_to_complete") {
    setSaving(true);
    setRowError(null);
    const res = await completeCareTask(task.id, status, status === "unable_to_complete" ? reason : undefined);
    setSaving(false);
    if (!res.ok) {
      setRowError(res.error);
      return;
    }
    onChanged();
  }

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Text style={{ flex: 1, fontSize: 14, fontWeight: "500", color: colors.ink }}>{task.title}</Text>
        {task.status === "missed" ? <Badge tone="neutral">Overdue</Badge> : null}
        {due ? <Text style={{ fontSize: 11, color: colors.faint }}>Due {due}</Text> : null}
      </View>
      {task.description ? <MutedText>{task.description}</MutedText> : null}
      {!showUnable ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <SecondaryButton title="Done" onPress={() => void submit("completed")} loading={saving} />
          <SecondaryButton title="Can't do this" onPress={() => setShowUnable(true)} disabled={saving} />
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          <TextInput
            style={textInputStyle}
            placeholder="What's stopping you? (optional)"
            placeholderTextColor={colors.faint}
            value={reason}
            onChangeText={setReason}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SecondaryButton title="Tell my care team" onPress={() => void submit("unable_to_complete")} loading={saving} />
            <SecondaryButton title="Cancel" onPress={() => setShowUnable(false)} disabled={saving} />
          </View>
        </View>
      )}
      {rowError ? <ErrorText>{rowError}</ErrorText> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Care follow-ups — mirrors apps/web/src/components/patient-escalations.tsx
// ---------------------------------------------------------------------------

function EscalationsSection({ patientId }: { patientId: string }) {
  const [escalations, setEscalations] = useState<EscalationItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEscalations(patientId).then((res) => {
      if (!cancelled && res.ok) setEscalations(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  if (!escalations || escalations.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Care follow-ups</Text>
      <Card style={{ gap: 0 }}>
        {escalations.map((escalation, i) => (
          <View
            key={escalation.id}
            style={{ paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border, gap: 3 }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ flex: 1, fontSize: 13.5, color: colors.ink }}>{escalation.reason}</Text>
              <Text style={{ fontSize: 11, color: colors.faint }}>{formatCareDate(escalation.createdAt)}</Text>
            </View>
            <MutedText>{ESCALATION_STATUS_COPY[escalation.status]}</MutedText>
            {(() => {
              const next = whatHappensNext(escalation.status, escalation.slaDueAt);
              return next ? <Text style={{ fontSize: 12, color: colors.faint }}>{next}</Text> : null;
            })()}
          </View>
        ))}
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Specialist referrals — mirrors apps/web/src/components/your-referrals.tsx
// ---------------------------------------------------------------------------

function ReferralsSection({ patientId }: { patientId: string }) {
  const [referrals, setReferrals] = useState<ReferralItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getReferrals(patientId).then((res) => {
      if (!cancelled && res.ok) setReferrals(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  if (!referrals || referrals.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Specialist referrals</Text>
      <Card style={{ gap: 0 }}>
        {referrals.map((referral, i) => (
          <View
            key={referral.id}
            style={{ paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border, gap: 3 }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ flex: 1, fontSize: 13.5, color: colors.ink }}>
                {humanizeCareLabel(referral.specialistType)}
              </Text>
              <Text style={{ fontSize: 11, color: colors.faint }}>{formatCareDate(referral.createdAt)}</Text>
            </View>
            <MutedText>{REFERRAL_STATUS_COPY[referral.status]}</MutedText>
            {referral.appointmentDate ? (
              <Text style={{ fontSize: 12, color: colors.muted }}>
                Appointment: {formatCareDate(referral.appointmentDate)}
              </Text>
            ) : null}
            {referral.status === "closed" && referral.carePlanUpdateNote ? (
              <Text style={{ fontSize: 12, color: colors.ink }}>What changed: {referral.carePlanUpdateNote}</Text>
            ) : (
              <Text style={{ fontSize: 11.5, color: colors.faint, lineHeight: 16 }}>
                Take this to any {referral.specialistType.replace(/_/g, " ")} you like — you pay that clinic
                directly. Download your referral letter and upload what they give you back on web.
              </Text>
            )}
          </View>
        ))}
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Hospital admissions — mirrors apps/web/src/app/(dashboard)/patient/hospital-admissions-card.tsx
// ---------------------------------------------------------------------------

function HospitalAdmissionsSection({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const [loading, setLoading] = useState(true);
  const [admissions, setAdmissions] = useState<HospitalAdmission[]>([]);
  const [formOpen, setFormOpen] = useState(false);

  const refresh = useCallback(async () => {
    const res = await getHospitalAdmissions(patientId);
    if (res.ok) setAdmissions(res.data);
  }, [patientId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Hospital admissions</Text>
        {!formOpen && <SecondaryButton title="Log admission" onPress={() => setFormOpen(true)} />}
      </View>
      <MutedText>
        Let your care team know if you&apos;ve been admitted to hospital. What you enter here is
        self-reported; your care team reviews it and updates your care plan if needed.
      </MutedText>

      {formOpen ? (
        <HospitalAdmissionForm
          patientId={patientId}
          organisationId={organisationId}
          onDone={() => {
            setFormOpen(false);
            void refresh();
          }}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}

      {loading && <ActivityIndicator color={colors.brand} />}
      {!loading && admissions.length === 0 && !formOpen && <MutedText>No admissions recorded.</MutedText>}
      {admissions.length > 0 ? (
        <Card style={{ gap: 0 }}>
          {admissions.map((admission, i) => (
            <AdmissionRow key={admission.id} admission={admission} first={i === 0} onDischarged={refresh} />
          ))}
        </Card>
      ) : null}
    </View>
  );
}

function HospitalAdmissionForm({
  patientId,
  organisationId,
  onDone,
  onCancel,
}: {
  patientId: string;
  organisationId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [admittedOn, setAdmittedOn] = useState("");
  const [dischargedOn, setDischargedOn] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const admitted = admittedOn.trim();
    const discharged = dischargedOn.trim();
    if (!DATE_RE.test(admitted)) {
      setError("Enter the admission date as YYYY-MM-DD.");
      return;
    }
    if (admitted > todayDateInput()) {
      setError("Admission date can't be in the future.");
      return;
    }
    if (discharged) {
      if (!DATE_RE.test(discharged)) {
        setError("Enter the discharge date as YYYY-MM-DD, or leave it blank.");
        return;
      }
      if (discharged < admitted) {
        setError("Discharge date can't be before the admission date.");
        return;
      }
    }
    setSaving(true);
    const res = await logHospitalAdmission({
      patientId,
      organisationId,
      admittedOn: admitted,
      dischargedOn: discharged || null,
      facilityName: facilityName.trim() || null,
      selfReportedDiagnosis: diagnosis.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDone();
  }

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>Admission date (YYYY-MM-DD)</Text>
        <TextInput
          style={dateInputStyle}
          placeholder={todayDateInput()}
          placeholderTextColor={colors.faint}
          value={admittedOn}
          onChangeText={setAdmittedOn}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
      </View>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>Discharge date (optional)</Text>
        <TextInput
          style={dateInputStyle}
          placeholder="Leave blank if still admitted"
          placeholderTextColor={colors.faint}
          value={dischargedOn}
          onChangeText={setDischargedOn}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
      </View>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>Hospital (optional)</Text>
        <TextInput
          style={textInputStyle}
          placeholderTextColor={colors.faint}
          value={facilityName}
          onChangeText={setFacilityName}
          maxLength={200}
        />
      </View>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>
          What were you admitted for? (optional)
        </Text>
        <TextInput
          style={textInputStyle}
          placeholderTextColor={colors.faint}
          value={diagnosis}
          onChangeText={setDiagnosis}
          maxLength={500}
        />
        <MutedText>In your own words: this is recorded as self-reported, not a diagnosis.</MutedText>
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <PrimaryButton title="Log admission" onPress={() => void submit()} loading={saving} />
        <SecondaryButton title="Cancel" onPress={onCancel} disabled={saving} />
      </View>
    </Card>
  );
}

function AdmissionRow({
  admission,
  first,
  onDischarged,
}: {
  admission: HospitalAdmission;
  first: boolean;
  onDischarged: () => void;
}) {
  const [dischargedOn, setDischargedOn] = useState("");
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const value = dischargedOn.trim();
    if (!DATE_RE.test(value)) {
      setError("Enter the discharge date as YYYY-MM-DD.");
      return;
    }
    if (value < admission.admitted_on) {
      setError("Discharge date can't be before the admission date.");
      return;
    }
    setSaving(true);
    const res = await markAdmissionDischarged(admission.id, value, summary.trim() || undefined);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDischarged();
  }

  return (
    <View style={{ paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderTopColor: colors.border, gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>
            {admission.facility_name ?? "Hospital admission"}
          </Text>
          <Badge tone={admission.is_current ? "brand" : "neutral"}>
            {admission.is_current ? "Currently admitted" : "Discharged"}
          </Badge>
        </View>
        <Text style={{ fontSize: 11, color: colors.faint }}>{admissionDurationLabel(admission)}</Text>
      </View>
      <MutedText>
        Admitted {formatCareDate(admission.admitted_on)}
        {admission.discharged_on ? ` · discharged ${formatCareDate(admission.discharged_on)}` : ""}
      </MutedText>
      {admission.self_reported_diagnosis ? (
        <Text style={{ fontSize: 12, color: colors.muted }}>
          Reason (self-reported): {admission.self_reported_diagnosis}
        </Text>
      ) : null}
      {admission.discharge_summary ? (
        <Text style={{ fontSize: 12, color: colors.muted }}>Discharge notes: {admission.discharge_summary}</Text>
      ) : null}
      {admission.source === "staff_recorded" ? <MutedText>Recorded by your care team.</MutedText> : null}

      {admission.is_current ? (
        <View style={{ gap: 6, marginTop: 4 }}>
          <TextInput
            style={dateInputStyle}
            placeholder="Discharge date (YYYY-MM-DD)"
            placeholderTextColor={colors.faint}
            value={dischargedOn}
            onChangeText={setDischargedOn}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          <TextInput
            style={textInputStyle}
            placeholder="Discharge notes (optional)"
            placeholderTextColor={colors.faint}
            value={summary}
            onChangeText={setSummary}
            multiline
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <View style={{ alignSelf: "flex-start" }}>
            <SecondaryButton title="Mark discharged" onPress={() => void submit()} loading={saving} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Ask a doctor — async written Q&A (unchanged from before this pass).
// ---------------------------------------------------------------------------

function AskADoctorSection({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const [consults, setConsults] = useState<AsyncConsultWithAnswerer[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState(ASYNC_CONSULT_CATEGORIES[0].value);
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsCredit, setNeedsCredit] = useState(false);

  const refresh = useCallback(async () => {
    const result = await loadMyAsyncConsults(patientId);
    if (result.ok) setConsults(result.data);
  }, [patientId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function submit() {
    if (question.trim().length < 10) {
      setError("Tell us a little more so the doctor can actually help");
      return;
    }
    setSubmitting(true);
    setError(null);
    setNeedsCredit(false);
    const result = await submitAsyncConsult({ patientId, organisationId, category, question: question.trim() });
    setSubmitting(false);
    if (!result.ok) {
      if (result.error.includes(ASK_A_DOCTOR_CREDIT_REQUIRED_MARKER)) {
        setNeedsCredit(true);
      } else {
        setError(result.error);
      }
      return;
    }
    setQuestion("");
    void refresh();
  }

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Ask a doctor</Text>
      <MutedText>
        Send a written question and a doctor on your care team answers here, usually within 72
        hours. Not for emergencies.
      </MutedText>

      {needsCredit && (
        <Card style={{ gap: 8, backgroundColor: colors.brandTint }}>
          <Text style={{ fontSize: 13, color: colors.brandPressed }}>
            Ask a doctor isn&apos;t included on your current plan. Buy a one-off credit to send
            this question.
          </Text>
          <SecondaryButton
            title="Buy a credit in the browser"
            onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/care#ask-a-doctor`)}
          />
        </Card>
      )}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {ASYNC_CONSULT_CATEGORIES.map((c) => {
          const selected = c.value === category;
          return (
            <Pressable
              key={c.value}
              onPress={() => setCategory(c.value)}
              style={{
                borderRadius: 999,
                paddingVertical: 7,
                paddingHorizontal: 12,
                backgroundColor: selected ? colors.brand : colors.groupBg,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: selected ? "#FFFFFF" : colors.ink }}>
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        value={question}
        onChangeText={setQuestion}
        placeholder="e.g. I've felt dizzy in the mornings since my dose changed. Is that expected?"
        multiline
        numberOfLines={3}
        style={[textInputStyle, { minHeight: 70, textAlignVertical: "top" }]}
      />
      {error && <ErrorText>{error}</ErrorText>}
      <PrimaryButton title="Send to my care team" onPress={submit} loading={submitting} />

      {loading && <ActivityIndicator color={colors.brand} />}
      {consults.length > 0 && (
        <View style={{ gap: 10, marginTop: 4 }}>
          {consults.map((c) => {
            const answered = c.status === "answered" || c.status === "closed";
            return (
              <Card key={c.id} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink, flex: 1 }}>
                    {c.question}
                  </Text>
                  <Badge tone={answered ? "brand" : "neutral"}>{answered ? "Answered" : "With your care team"}</Badge>
                </View>
                {answered && c.answer && (
                  <>
                    <Text style={{ fontSize: 13.5, color: colors.ink }}>{c.answer}</Text>
                    {c.answerer && c.answered_at && (
                      <MutedText>
                        Answered by Dr. {c.answerer.full_name} on {when(c.answered_at)}
                      </MutedText>
                    )}
                  </>
                )}
              </Card>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Need help — non-clinical navigation requests (unchanged from before this pass).
// ---------------------------------------------------------------------------

function NeedHelpSection({ patientId }: { patientId: string }) {
  const [requests, setRequests] = useState<NavigationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<NavigationRequestCategory>("appointment");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadMyNavigationRequests(patientId);
    if (result.ok) setRequests(result.data);
  }, [patientId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    const result = await createNavigationRequest({ patientId, category, description, isComplaint: false });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDescription("");
    setOpen(false);
    void refresh();
  }

  async function rate(requestId: string, rating: number) {
    await submitNavigationRequestFeedback(requestId, rating);
    void refresh();
  }

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Need help with something?</Text>
        {!open && <SecondaryButton title="I need help" onPress={() => setOpen(true)} />}
      </View>
      <MutedText>
        Appointments, pharmacy, labs, insurance, referrals, or payments — a navigator helps sort it
        out.
      </MutedText>

      {open && (
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {NAVIGATION_REQUEST_CATEGORIES.map((c) => {
              const selected = c === category;
              return (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  style={{
                    borderRadius: 999,
                    paddingVertical: 7,
                    paddingHorizontal: 12,
                    backgroundColor: selected ? colors.brand : colors.groupBg,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "600", color: selected ? "#FFFFFF" : colors.ink }}>
                    {NAVIGATION_REQUEST_CATEGORY_LABEL[c]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. My pharmacy doesn't have my usual medicine in stock"
            multiline
            numberOfLines={3}
            style={[textInputStyle, { minHeight: 70, textAlignVertical: "top" }]}
          />
          {error && <ErrorText>{error}</ErrorText>}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <PrimaryButton title="Send" onPress={submit} loading={submitting} />
            <SecondaryButton title="Cancel" onPress={() => setOpen(false)} disabled={submitting} />
          </View>
        </Card>
      )}

      {loading && <ActivityIndicator color={colors.brand} />}
      {!loading && requests.length === 0 && !open && (
        <MutedText>No requests yet — if something's getting in the way, let us know above.</MutedText>
      )}
      {requests.length > 0 && (
        <View style={{ gap: 10 }}>
          {requests.map((r) => (
            <Card key={r.id} style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>
                  {NAVIGATION_REQUEST_CATEGORY_LABEL[r.category]}
                </Text>
                <Badge tone={r.status === "resolved" ? "brand" : "neutral"}>
                  {NAVIGATION_REQUEST_STATUS_LABEL[r.status]}
                </Badge>
              </View>
              <Text style={{ fontSize: 13.5, color: colors.ink }}>{r.description}</Text>
              <MutedText>Sent {when(r.created_at)}</MutedText>
              {r.status === "resolved" && r.resolution_note && (
                <Text style={{ fontSize: 13, color: colors.ink, backgroundColor: colors.groupBg, padding: 8, borderRadius: radius.control }}>
                  {r.resolution_note}
                </Text>
              )}
              {r.status === "resolved" && r.satisfaction_rating === null && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <MutedText>How did we do?</MutedText>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => void rate(r.id, n)}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 13,
                        borderWidth: 1,
                        borderColor: colors.border,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ fontSize: 12, color: colors.ink }}>{n}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}
