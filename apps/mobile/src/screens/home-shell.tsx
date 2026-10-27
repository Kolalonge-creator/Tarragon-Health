import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppState, View } from "react-native";
import type { Tables } from "@tarragon/shared";
import { supabase } from "@/lib/supabase";
import type { SectionId } from "@/lib/sections";
import { expoNotificationTapPort, startNotificationTaps } from "@/lib/notification-tap";
import { getActingFor, stopActingFor, type ActingFor } from "@/lib/acting";
import { registerPushToken } from "@/lib/push-registration";
import { replanDoseReminders } from "@/lib/dose-reminders";
import { CatchUpSheet } from "@/screens/catch-up-sheet";
import { TopBar } from "@/ui/top-bar";
import { NavDrawer } from "@/ui/nav-drawer";
import { JoinInviteModal } from "@/screens/sections/join-invite-modal";
import { loadOpenAlerts, loadUnanswered } from "@/lib/care-circle/api";
import { CheckInCard } from "@/screens/sections/care-circle-section";
import { needsAttentionCount } from "@/lib/care-circle/parse";
import { BottomTabBar } from "@/ui/bottom-tab-bar";
import { ScreenHelp } from "@/ui/screen-help";
import { ActingForBanner } from "@/ui/acting-for-banner";
import { useTheme } from "@/ui/design";
import { OverviewScreen } from "@/screens/sections/overview-screen";
import { VitalsScreen } from "@/screens/sections/vitals-screen";
import { MedicationsScreen } from "@/screens/sections/medications-screen";
import { LabsScreen } from "@/screens/sections/labs-screen";
import { AppointmentsScreen } from "@/screens/sections/appointments-screen";
import { PreventionScreen } from "@/screens/sections/prevention-screen";
import { CareSupportScreen } from "@/screens/sections/care-support-screen";
import { AiCoachScreen } from "@/screens/sections/ai-coach-screen";
import { ActionsScreen } from "@/screens/sections/actions-screen";
import { DevicesScreen } from "@/screens/devices-screen";
import { SyncScreen } from "@/screens/sync-screen";
import { startWrittenQuestionFlushing } from "@/lib/written-questions/queue-flush";
import { MessagesScreen } from "@/screens/sections/messages-screen";
import { HealthPassportScreen } from "@/screens/sections/health-passport-screen";
import { RecordsRequestsScreen } from "@/screens/sections/records-requests-screen";
import { EmergencyCardScreen } from "@/screens/sections/emergency-card-screen";
import { SettingsScreen } from "@/screens/sections/settings-screen";
import { SupportingScreen } from "@/screens/sections/supporting-screen";
import { ReceiptsScreen } from "@/screens/sections/receipts-screen";
import { PaymentRequestsScreen } from "@/screens/sections/payment-requests-screen";
import { NotificationSettingsScreen } from "@/screens/sections/notification-settings-screen";
import { RemindersScreen } from "@/screens/sections/reminders-screen";
import { TechnicalSupportScreen } from "@/screens/sections/technical-support-screen";
import { HealthSummaryScreen } from "@/screens/sections/health-summary-screen";
import { BpHistoryScreen } from "@/screens/sections/bp-history-screen";
import { MonthlyReportScreen } from "@/screens/sections/monthly-report-screen";
import { HealthReportScreen } from "@/screens/sections/health-report-screen";
import { ProgrammesScreen } from "@/screens/sections/programmes-screen";
import { TimelineScreen } from "@/screens/sections/timeline-screen";
import { DocumentsScreen } from "@/screens/sections/documents/documents-screen";
import { DataExchangeScreen } from "@/screens/sections/data-exchange-screen";
import { BiomarkersScreen } from "@/screens/sections/biomarkers-screen";
import { HealthHistoryScreen } from "@/screens/sections/health-history-screen";
import { SymptomJournalScreen } from "@/screens/sections/symptom-journal-screen";
import { MyHealthScreen } from "@/screens/sections/my-health-screen";
import { RecordShareScreen } from "@/screens/sections/record-share-screen";
import { MyPhonesScreen } from "@/screens/sections/my-phones-screen";
import { ExerciseScreen } from "@/screens/sections/exercise-screen";
import { LowCarbScreen } from "@/screens/sections/lowcarb-screen";
import { FastingScreen } from "@/screens/sections/fasting-screen";
import { VideoVisitScreen } from "@/screens/sections/video-visit-screen";
import { ConsultationRoomScreen } from "@/screens/sections/consultation-room-screen";
import { DirectoryScreen } from "@/screens/sections/directory-screen";
import { FindASpecialistScreen } from "@/screens/sections/find-a-specialist-screen";
import { ScreeningDaysScreen } from "@/screens/sections/screening-days-screen";
import { TestingDaysScreen } from "@/screens/sections/testing-days-screen";
import { FinancialProfileScreen } from "@/screens/sections/financial-profile-screen";
import { WeightManagementScreen } from "@/screens/sections/weight-management-screen";
import { WellbeingScreen } from "@/screens/sections/wellbeing-screen";
import { HealthyAgeingScreen } from "@/screens/sections/healthy-ageing-screen";
import { WellnessScreen } from "@/screens/sections/wellness-screen";
import { HealthCheckScreen } from "@/screens/sections/health-check-screen";
import { WomensHealthScreen } from "@/screens/sections/womens-health-screen";
import { FamilyScreen } from "@/screens/sections/family-screen";
import { CommunityScreen } from "@/screens/sections/community/community-screen";
import { CommunityNotOpen } from "@/screens/sections/community/not-open";
import { useCommunityEntry } from "@/lib/community/use-community-entry";
import { SexualHealthScreen } from "@/screens/sections/sexual-health-screen";
import { LifestyleScreen } from "@/screens/sections/lifestyle-screen";
import {
  ActivityScreen,
  AlcoholScreen,
  MealsScreen,
  SleepScreen,
  SmokingScreen,
} from "@/screens/sections/tracker-screens";
import { ServicesScreen } from "@/screens/sections/services-screen";
import { LearnScreen } from "@/screens/sections/learn-screen";
import { PrivacyScreen } from "@/screens/sections/privacy-screen";

type PatientDevice = Tables<"patient_devices">;

interface HomeShellProps {
  userId: string;
  organisationId: string;
  patientName: string;
  patientNumber: string | null;
  initials: string;
}

/**
 * The authenticated "Home" tab: top bar + bottom tab bar + drawer + one of the
 * sections in lib/sections.ts — native screens render directly, the rest embed
 * the matching web page through the signed-in WebView bridge.
 *
 * Navigation is a bottom tab bar for the everyday sections with the drawer
 * behind More, rather than the drawer alone: hiding every destination behind a
 * hamburger is a web pattern, and it cost a tap and a scan of a long list
 * before a patient could do the thing they opened the app for.
 *
 * Also resolves "acting for" — the native equivalent of web's
 * ActingForBanner/dashboard-context.ts (lib/acting.ts) — so that when this
 * device's signed-in user has a supported person's account open, native
 * screens read and write that person's record (subjectId) instead of the
 * device owner's own, matching what /patient/* already does on web. Which
 * screens get subjectId is decided per-table against the actual RLS, not
 * guessed, checked directly in supabase/migrations:
 *
 * - Overview, Vitals, Medications (today's doses), Health Passport:
 *   subjectId. Every table they touch is either can_act_for-gated for
 *   writes (vitals_readings, symptoms, medication_logs — 20260801110000,
 *   20260809232718) or can_read_clinical-gated for reads (vitals_readings,
 *   screening_schedules, screening_results, lab_analyte_readings, care_plans,
 *   medications, medication_logs, patient_risk_scores —
 *   20260731181143/20260731185243/20260809232718), so a consented supporter
 *   genuinely sees/writes the right thing, not silently nothing.
 *   medication_logs was the one table this didn't hold for until
 *   20260809232718 closed it — web's own /patient/medications page had
 *   already been passing subjectId through this whole time
 *   (medications/page.tsx → TodaysDoses → useLogDose), so it was silently
 *   broken there too (an empty checklist, a rejected toggle) until that
 *   migration landed; this mobile change and that migration are the same
 *   fix, not two separate ones. Unlike vitals/symptoms, a supporter may
 *   UPDATE a medication_logs row — but only one they themselves logged,
 *   never the patient's or another supporter's (same-day dose-toggle
 *   correction is normal here in a way revising a vitals reading isn't).
 *   The medicines cabinet (now native, medicine-cabinet-screen.tsx) still
 *   reads/writes as the device owner's own session, not the beneficiary's —
 *   it has no subjectId plumbed through, unrelated to this fix.
 * - Messages stays on userId: the real supporter-facing mechanism is the
 *   three-way conversation (care_messages/care_message_threads' own
 *   can_read_clinical-gated INSERT, 20260731185243), always in the
 *   supporter's own name — not "send as the patient," which is what
 *   routing through subjectId here would imply.
 * - Labs stays on userId: the native screen is camera-upload only, with no
 *   backend acting-for support on that write path (mirrors vitals' original
 *   gap, unaddressed here — same class of work as medication_logs was,
 *   budget separately if wanted).
 * - Devices stays on userId, same reasoning as Labs: patient_devices pairing
 *   has no can_act_for-gated write path, and a BLE device is physically
 *   paired to this handset — pairing "for" a supported person from the
 *   supporter's own phone isn't a scenario the RLS or the BLE flow accounts
 *   for yet.
 * - Appointments stays on userId, same reasoning as Labs/Devices:
 *   hold_appointment_slot/confirm_appointment_booking have no verified
 *   acting-for path exercised from this screen yet — budget separately if a
 *   supporter needs to book on someone else's behalf from their own phone.
 * - Care & support stays on userId, same reasoning as Messages: Ask a
 *   doctor and a navigation request are both first-person ("my question",
 *   "I need help"), not something exercised on a supported person's behalf
 *   from this screen.
 * - Sexual & reproductive health stays on userId: every table this module
 *   touches (sti_risk_checks, sti_case_episodes, fertility_assessments,
 *   sexual_health_screens, contraception_plans, emergency_contraception_
 *   requests, sexual_health_privacy_settings) is patient-self-or-org-staff
 *   only by construction, with no profile_access/supporter/can_act_for path
 *   at all — there is nothing for an acting-for resolution to route to even
 *   if implemented here.
 * - My actions uses subjectId: every source table it reads (medication_
 *   reviews, screening_schedules, vaccination_schedules, etc.) is already
 *   can_read_clinical-gated per the Overview/Vitals reasoning above.
 * - Settings and Emergency card stay on userId on purpose, not because of
 *   an RLS gap: Settings is device/account configuration, not patient
 *   record data, and Emergency card is meant to represent whoever is
 *   physically holding the phone for a first responder — neither should
 *   ever track a transient acting-for state.
 * - Healthy ageing uses subjectId: ageing_assessments/domain_results,
 *   falls_risk_assessments, and social_determinant_screenings are all
 *   can_act_for-gated for read (and insert, where patient/caregiver-
 *   writable at all) — same group as Overview/Vitals/Medications/Health
 *   Passport/My actions. One caveat inherited from web, not introduced
 *   here: patient_conditions' SELECT policy has no can_act_for clause, so
 *   the coordinated-care summary's active-condition count reads 0 for a
 *   caregiver acting for someone with real active conditions — see
 *   lib/healthy-ageing.ts's own comment on loadCoordinatedCareSummary.
 */
export function HomeShell({ userId, organisationId, patientName, patientNumber, initials }: HomeShellProps) {
  const { colors: theme } = useTheme();
  const [section, setSection] = useState<SectionId>("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [acting, setActing] = useState<ActingFor | null>(null);
  // Whether the acting-for lookup has finished: until then "no acting-for" is only a guess.
  const [actingChecked, setActingChecked] = useState(false);
  const [openDevice, setOpenDevice] = useState<PatientDevice | null>(null);
  const [openVideoVisitId, setOpenVideoVisitId] = useState<string | null>(null);
  // S21 follow-up (OQ-158): the consultation room opened from the Care area's "Your consultations" card.
  const [openConsultationId, setOpenConsultationId] = useState<string | null>(null);

  const refreshActing = useCallback(() => {
    // Best-effort: a failed read (e.g. SecureStore hiccup) falls back to the
    // device owner's own account rather than crashing with an unhandled
    // rejection — the safe default for whose record gets written.
    getActingFor()
      .then(setActing)
      .catch(() => setActing(null))
      .finally(() => setActingChecked(true));
  }, []);

  useEffect(() => {
    refreshActing();
  }, [refreshActing]);

  useEffect(() => {
    // Once per app session, on the device owner's own userId/organisationId
    // (never the acting-for subject — a push token belongs to the physical
    // device/login, not whichever profile is currently being viewed).
    // registerPushToken() was already fully built (push-registration.ts) but
    // had no caller anywhere in the app until now — see that file's own
    // comment for the full mechanism. Best-effort: never blocks or throws
    // into this render.
    void registerPushToken(userId, organisationId);
  }, [userId, organisationId]);

  useEffect(() => {
    // Dose reminders are a rolling plan held on the phone (S08). Rebuild it when the
    // app opens and every time it returns to the foreground, so a reminder never
    // depends on the Medications screen having been visited. Always the device
    // owner's own medicines, not the acting-for subject's. Never throws.
    void replanDoseReminders(userId);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void replanDoseReminders(userId);
    });
    return () => sub.remove();
  }, [userId]);

  useEffect(() => {
    // Written questions saved on this phone (S22) are sent whenever this patient is signed in,
    // not only while that screen is open. Only this account's own items are ever touched.
    return startWrittenQuestionFlushing(userId);
  }, [userId]);
  // A tap on a reminder or a push opens the right screen (the blood pressure screen for a recheck), from closed or running.
  useEffect(() => {
    try {
      return startNotificationTaps(expoNotificationTapPort(), (id) => {
        setSection(id);
        setDrawerOpen(false);
      });
    } catch {
      return undefined;
    }
  }, []);

  function handleSelect(id: SectionId) {
    setSection(id);
    setDrawerOpen(false);
    if (id !== "devices") setOpenDevice(null);
  }

  const subjectId = acting?.profileId ?? userId;

  // Community is the person's own account only, and only while it is open for an adult: the menu entry is hidden for someone with a
  // supported person's account open, for a supporter-only account, while the go-live guard is off, and for anyone under 18.
  const communityVisible = useCommunityEntry(userId, acting !== null, actingChecked);
  const hiddenSections: SectionId[] = communityVisible ? [] : ["community"];
  // S29e: people who need a supporter's attention, shown as a count on "People you support" in the menu. The backup for the push:
  // read on open, on a light timer and whenever the app comes back. A failed read leaves the last known count (never invents one).
  const [attentionCount, setAttentionCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void Promise.all([loadOpenAlerts(), loadUnanswered()]).then(([a, u]) => {
        // both reads must work: a failed one leaves the last known count rather than quietly lowering it
        if (alive && a.ok && u.ok) setAttentionCount(needsAttentionCount(a.data, u.data));
      });
    };
    refresh();
    const timer = setInterval(refresh, 60_000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") refresh(); });
    return () => {
      alive = false;
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  // One renderer per SectionId, keyed by a Record rather than a chain of
  // `section === "x" &&` branches: TypeScript refuses to compile this object
  // unless every value in the SectionId union has an entry, so a new section
  // added to lib/sections.ts without a matching renderer here is a build
  // error rather than a blank content area at runtime. Values are functions,
  // not JSX, so adding a section costs no extra render work — only the one
  // matching `section` is ever invoked, same as the branch chain this
  // replaces.
  const sectionRenderers: Record<SectionId, () => ReactNode> = {
    overview: () =>
      openVideoVisitId ? (
        <VideoVisitScreen consultationId={openVideoVisitId} onBack={() => setOpenVideoVisitId(null)} />
      ) : (
        <OverviewScreen
          patientId={subjectId}
          patientName={acting?.fullName ?? patientName}
          onNavigate={handleSelect}
          onOpenVideoVisit={setOpenVideoVisitId}
          organisationId={acting ? undefined : organisationId}
        />
      ),
    vitals: () => <VitalsScreen patientId={subjectId} beneficiaryProfileId={acting?.profileId} />,
    bpHistory: () => <BpHistoryScreen patientId={subjectId} userId={userId} organisationId={organisationId} />,
    // A summary belongs to the person it is about: while acting for someone else the screen says so and reads nothing.
    monthlySummary: () => <MonthlyReportScreen acting={!!acting} />,
    healthReport: () => <HealthReportScreen acting={!!acting} />,
    // Joining a programme is the person's own choice: nothing changes while acting for someone else.
    programmes: () => <ProgrammesScreen acting={!!acting} />,
    medications: () => (
      <MedicationsScreen
        patientId={subjectId}
        organisationId={organisationId}
        subjectName={acting?.fullName ?? undefined}
        onNavigate={handleSelect}
      />
    ),
    labs: () => <LabsScreen />,
    appointments: () => <AppointmentsScreen patientId={userId} organisationId={organisationId} />,
    prevention: () => <PreventionScreen patientId={subjectId} organisationId={organisationId} />,
    care: () =>
      openConsultationId ? (
        <ConsultationRoomScreen encounterId={openConsultationId} onBack={() => setOpenConsultationId(null)} />
      ) : openVideoVisitId ? (
        <VideoVisitScreen consultationId={openVideoVisitId} onBack={() => setOpenVideoVisitId(null)} />
      ) : (
        <CareSupportScreen
          patientId={userId}
          organisationId={organisationId}
          onOpenVideoVisit={setOpenVideoVisitId}
          onOpenConsultation={setOpenConsultationId}
        />
      ),
    myActions: () => <ActionsScreen patientId={subjectId} onNavigate={handleSelect} />,
    healthSummary: () => <HealthSummaryScreen patientId={subjectId} onNavigate={handleSelect} />,
    timeline: () => <TimelineScreen patientId={subjectId} acting={acting != null} onNavigate={handleSelect} />,
    shareRecords: () => <RecordShareScreen userId={userId} acting={acting != null} />,
    biomarkers: () => <BiomarkersScreen key={subjectId} subjectId={subjectId} userId={userId} />,
    documents: () => <DocumentsScreen userId={userId} organisationId={organisationId} acting={acting != null} />,
    dataExchange: () => <DataExchangeScreen userId={userId} acting={acting != null} />,
    myHealth: () => <MyHealthScreen userId={userId} acting={acting != null} onNavigate={handleSelect} />,
    healthHistory: () => <HealthHistoryScreen subjectId={subjectId} userId={userId} organisationId={organisationId} />,
    symptomJournal: () => <SymptomJournalScreen subjectId={subjectId} acting={acting != null} onNavigate={handleSelect} />,
    myPhones: () => <MyPhonesScreen userId={userId} acting={acting != null} />,
    exercise: () => <ExerciseScreen patientId={subjectId} organisationId={organisationId} />,
    // The programme is the person's own (their own yes), so nothing is shown while acting for someone else.
    lowCarb: () => <LowCarbScreen patientId={userId} acting={acting != null} onNavigate={handleSelect} />,
    fasting: () => <FastingScreen acting={acting != null} onNavigate={handleSelect} />,
    devices: () =>
      openDevice ? (
        <SyncScreen device={openDevice} onBack={() => setOpenDevice(null)} />
      ) : (
        <DevicesScreen patientId={userId} organisationId={organisationId} onOpenDevice={setOpenDevice} />
      ),
    messages: () => <MessagesScreen patientId={userId} />,
    aiCoach: () => <AiCoachScreen patientId={userId} onNavigate={handleSelect} />,
    supporting: () => (
      <SupportingScreen
        userId={userId}
        organisationId={organisationId}
        acting={acting}
        onActingChange={refreshActing}
      />
    ),
    passport: () => (
      <HealthPassportScreen
        patientId={subjectId}
        organisationId={organisationId}
        subjectName={acting?.fullName ?? undefined}
      />
    ),
    recordsRequests: () => <RecordsRequestsScreen actingForOther={subjectId !== userId} />,
    receipts: () => <ReceiptsScreen />,
    paymentRequests: () => <PaymentRequestsScreen />,
    reminders: () => <RemindersScreen userId={userId} />,
    notificationSettings: () => (
      <NotificationSettingsScreen patientId={userId} organisationId={organisationId} />
    ),
    technicalSupport: () => (
      <TechnicalSupportScreen patientId={userId} organisationId={organisationId} />
    ),
    emergency: () => <EmergencyCardScreen patientId={userId} organisationId={organisationId} />,
    settings: () => (
      <SettingsScreen patientName={patientName} initials={initials} accountId={userId} onNavigate={handleSelect} />
    ),
    womensHealth: () => (
      <WomensHealthScreen patientId={subjectId} organisationId={organisationId} onNavigate={handleSelect} />
    ),
    sexualHealth: () => (
      <SexualHealthScreen userId={userId} organisationId={organisationId} onNavigate={handleSelect} />
    ),
    wellbeing: () => (
      <WellbeingScreen patientId={userId} organisationId={organisationId} onNavigate={handleSelect} />
    ),
    healthCheck: () => <HealthCheckScreen patientId={userId} onNavigate={handleSelect} />,
    findASpecialist: () => <FindASpecialistScreen patientId={userId} />,
    directory: () => <DirectoryScreen />,
    healthyAgeing: () => (
      <HealthyAgeingScreen patientId={subjectId} organisationId={organisationId} onNavigate={handleSelect} />
    ),
    lifestyle: () => <LifestyleScreen patientId={userId} onNavigate={handleSelect} />,
    meals: () => <MealsScreen patientId={subjectId} acting={acting != null} />,
    sleep: () => <SleepScreen patientId={subjectId} />,
    activity: () => <ActivityScreen patientId={subjectId} organisationId={organisationId} />,
    smoking: () => <SmokingScreen patientId={subjectId} />,
    alcohol: () => <AlcoholScreen patientId={subjectId} />,
    weightManagement: () => <WeightManagementScreen userId={userId} onNavigate={handleSelect} />,
    learn: () => <LearnScreen userId={userId} organisationId={organisationId} />,
    wellness: () => (
      <WellnessScreen patientId={userId} organisationId={organisationId} onNavigate={handleSelect} />
    ),
    family: () => <FamilyScreen userId={userId} onNavigate={handleSelect} />,
    // Reached by a notice tap while the entry is hidden: one calm line, nothing else (no group list, no calls).
    community: () => (communityVisible ? <CommunityScreen onNavigate={handleSelect} /> : <CommunityNotOpen />),
    screeningDays: () => <ScreeningDaysScreen />,
    testingDays: () => <TestingDaysScreen />,
    financialProfile: () => <FinancialProfileScreen userId={userId} />,
    privacy: () => (
      <PrivacyScreen userId={userId} organisationId={organisationId} onNavigate={handleSelect} />
    ),
    services: () => <ServicesScreen />,
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.canvas }}>
      <TopBar
        userId={userId}
        patientName={patientName}
        initials={initials}
        onOpenDrawer={() => setDrawerOpen(true)}
        onOpenSettings={() => setSection("settings")}
        onSignOut={() => supabase.auth.signOut()}
        onNavigate={handleSelect}
      />

      {(section === "overview" || section === "vitals" || section === "medications" || section === "passport") && (
        <ActingForBanner
          acting={acting}
          onStop={() => {
            void stopActingFor().then(refreshActing);
          }}
        />
      )}

      {/* S29e: a supporter asked for a check-in; the patient's own account only, and only while a question waits. */}
      {acting === null ? <CheckInCard /> : null}

      {/* D.2: "What is this?" for the screen and a one-time offer of a short tour on the four bottom tabs. Words only; nothing autoplays. */}
      <ScreenHelp section={section} />

      <View style={{ flex: 1 }}>{sectionRenderers[section]()}</View>

      {/* handleSelect, not setSection: switching tabs must also close the
          drawer and clear any open device detail, same as every other
          navigation entry point. */}
      <BottomTabBar
        activeSection={section}
        onSelect={handleSelect}
        onMore={() => setDrawerOpen(true)}
      />

      {/* S08b: doses from yesterday and today that closed with no answer, asked about once. The
          device owner's own medicines only, never the person being acted for. */}
      <CatchUpSheet patientId={userId} organisationId={organisationId} enabled={actingChecked && acting === null} />

      <JoinInviteModal onJoined={() => handleSelect("supporting")} />

      <NavDrawer
        visible={drawerOpen}
        activeSection={section}
        patientName={patientName}
        patientNumber={patientNumber}
        initials={initials}
        onSelect={handleSelect}
        hiddenSections={hiddenSections}
        badges={{ supporting: attentionCount }}
        onClose={() => setDrawerOpen(false)}
        onSignOut={() => {
          setDrawerOpen(false);
          void supabase.auth.signOut();
        }}
      />
    </View>
  );
}
