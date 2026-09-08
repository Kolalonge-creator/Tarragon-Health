import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import type { Tables } from "@tarragon/shared";
import { supabase } from "@/lib/supabase";
import type { SectionId } from "@/lib/sections";
import { getActingFor, stopActingFor, type ActingFor } from "@/lib/acting";
import { TopBar } from "@/ui/top-bar";
import { NavDrawer } from "@/ui/nav-drawer";
import { BottomTabBar } from "@/ui/bottom-tab-bar";
import { ActingForBanner } from "@/ui/acting-for-banner";
import { colors } from "@/ui/theme";
import { OverviewScreen } from "@/screens/sections/overview-screen";
import { VitalsScreen } from "@/screens/sections/vitals-screen";
import { MedicationsScreen } from "@/screens/sections/medications-screen";
import { LabsScreen } from "@/screens/sections/labs-screen";
import { AppointmentsScreen } from "@/screens/sections/appointments-screen";
import { PreventionScreen } from "@/screens/sections/prevention-screen";
import { CareSupportScreen } from "@/screens/sections/care-support-screen";
import { ActionsScreen } from "@/screens/sections/actions-screen";
import { DevicesScreen } from "@/screens/devices-screen";
import { SyncScreen } from "@/screens/sync-screen";
import { MessagesScreen } from "@/screens/sections/messages-screen";
import { HealthPassportScreen } from "@/screens/sections/health-passport-screen";
import { EmergencyCardScreen } from "@/screens/sections/emergency-card-screen";
import { SettingsScreen } from "@/screens/sections/settings-screen";
import { SupportingScreen } from "@/screens/sections/supporting-screen";
import { ReceiptsScreen } from "@/screens/sections/receipts-screen";
import { NotificationSettingsScreen } from "@/screens/sections/notification-settings-screen";
import { TechnicalSupportScreen } from "@/screens/sections/technical-support-screen";
import { HealthSummaryScreen } from "@/screens/sections/health-summary-screen";
import { FindASpecialistScreen } from "@/screens/sections/find-a-specialist-screen";
import { ScreeningDaysScreen } from "@/screens/sections/screening-days-screen";
import { FinancialProfileScreen } from "@/screens/sections/financial-profile-screen";
import { WeightManagementScreen } from "@/screens/sections/weight-management-screen";
import { WellbeingScreen } from "@/screens/sections/wellbeing-screen";
import { HealthyAgeingScreen } from "@/screens/sections/healthy-ageing-screen";
import { WellnessScreen } from "@/screens/sections/wellness-screen";
import { HealthCheckScreen } from "@/screens/sections/health-check-screen";
import { WomensHealthScreen } from "@/screens/sections/womens-health-screen";
import { FamilyScreen } from "@/screens/sections/family-screen";
import { SexualHealthScreen } from "@/screens/sections/sexual-health-screen";
import { LifestyleScreen } from "@/screens/sections/lifestyle-screen";
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
 *   The "medicines cabinet" WebView button now opens signed in (the general
 *   native/WebView SSO gap was closed via /auth/mobile-bridge — see
 *   webview-screen.tsx) but still as the device owner's own session, not the
 *   beneficiary's — WebViewScreen has no subjectId to hand across the
 *   bridge, unrelated to this fix.
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
  const [section, setSection] = useState<SectionId>("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [acting, setActing] = useState<ActingFor | null>(null);
  const [openDevice, setOpenDevice] = useState<PatientDevice | null>(null);

  const refreshActing = useCallback(() => {
    // Best-effort: a failed read (e.g. SecureStore hiccup) falls back to the
    // device owner's own account rather than crashing with an unhandled
    // rejection — the safe default for whose record gets written.
    getActingFor()
      .then(setActing)
      .catch(() => setActing(null));
  }, []);

  useEffect(() => {
    refreshActing();
  }, [refreshActing]);

  function handleSelect(id: SectionId) {
    setSection(id);
    setDrawerOpen(false);
    if (id !== "devices") setOpenDevice(null);
  }

  const subjectId = acting?.profileId ?? userId;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar
        userId={userId}
        patientName={patientName}
        initials={initials}
        onOpenDrawer={() => setDrawerOpen(true)}
        onOpenSettings={() => setSection("settings")}
        onSignOut={() => supabase.auth.signOut()}
      />

      {(section === "overview" || section === "vitals" || section === "medications" || section === "passport") && (
        <ActingForBanner
          acting={acting}
          onStop={() => {
            void stopActingFor().then(refreshActing);
          }}
        />
      )}

      <View style={{ flex: 1 }}>
        {section === "overview" && (
          <OverviewScreen
            patientId={subjectId}
            patientName={acting?.fullName ?? patientName}
            onNavigate={handleSelect}
          />
        )}
        {section === "vitals" && <VitalsScreen patientId={subjectId} beneficiaryProfileId={acting?.profileId} />}
        {section === "medications" && (
          <MedicationsScreen
            patientId={subjectId}
            organisationId={organisationId}
            subjectName={acting?.fullName ?? undefined}
          />
        )}
        {section === "labs" && <LabsScreen />}
        {section === "appointments" && (
          <AppointmentsScreen patientId={userId} organisationId={organisationId} />
        )}
        {section === "prevention" && (
          <PreventionScreen patientId={subjectId} organisationId={organisationId} />
        )}
        {section === "care" && (
          <CareSupportScreen patientId={userId} organisationId={organisationId} />
        )}
        {section === "myActions" && <ActionsScreen patientId={subjectId} onNavigate={handleSelect} />}
        {section === "healthSummary" && (
          <HealthSummaryScreen patientId={subjectId} onNavigate={handleSelect} />
        )}
        {section === "devices" &&
          (openDevice ? (
            <SyncScreen device={openDevice} onBack={() => setOpenDevice(null)} />
          ) : (
            <DevicesScreen
              patientId={userId}
              organisationId={organisationId}
              onOpenDevice={setOpenDevice}
            />
          ))}
        {section === "messages" && <MessagesScreen patientId={userId} />}
        {section === "supporting" && (
          <SupportingScreen userId={userId} acting={acting} onActingChange={refreshActing} />
        )}
        {section === "passport" && (
          <HealthPassportScreen
            patientId={subjectId}
            organisationId={organisationId}
            subjectName={acting?.fullName ?? undefined}
          />
        )}
        {section === "receipts" && <ReceiptsScreen />}
        {section === "notificationSettings" && (
          <NotificationSettingsScreen patientId={userId} organisationId={organisationId} />
        )}
        {section === "technicalSupport" && (
          <TechnicalSupportScreen patientId={userId} organisationId={organisationId} />
        )}
        {section === "emergency" && <EmergencyCardScreen patientId={userId} />}
        {section === "settings" && (
          <SettingsScreen patientName={patientName} initials={initials} onNavigate={handleSelect} />
        )}
        {section === "womensHealth" && (
          <WomensHealthScreen patientId={subjectId} organisationId={organisationId} onNavigate={handleSelect} />
        )}
        {section === "sexualHealth" && (
          <SexualHealthScreen userId={userId} organisationId={organisationId} onNavigate={handleSelect} />
        )}
        {section === "wellbeing" && (
          <WellbeingScreen patientId={userId} organisationId={organisationId} onNavigate={handleSelect} />
        )}
        {section === "healthCheck" && <HealthCheckScreen patientId={userId} onNavigate={handleSelect} />}
        {section === "findASpecialist" && <FindASpecialistScreen patientId={userId} />}
        {section === "healthyAgeing" && (
          <HealthyAgeingScreen patientId={subjectId} organisationId={organisationId} onNavigate={handleSelect} />
        )}
        {section === "lifestyle" && <LifestyleScreen patientId={userId} onNavigate={handleSelect} />}
        {section === "weightManagement" && (
          <WeightManagementScreen userId={userId} onNavigate={handleSelect} />
        )}
        {section === "learn" && <LearnScreen userId={userId} organisationId={organisationId} />}
        {section === "wellness" && (
          <WellnessScreen patientId={userId} organisationId={organisationId} onNavigate={handleSelect} />
        )}
        {section === "family" && <FamilyScreen userId={userId} onNavigate={handleSelect} />}
        {section === "screeningDays" && <ScreeningDaysScreen />}
        {section === "financialProfile" && <FinancialProfileScreen userId={userId} />}
        {section === "privacy" && <PrivacyScreen userId={userId} organisationId={organisationId} onNavigate={handleSelect} />}
        {section === "services" && <ServicesScreen />}
      </View>

      {/* handleSelect, not setSection: switching tabs must also close the
          drawer and clear any open device detail, same as every other
          navigation entry point. */}
      <BottomTabBar
        activeSection={section}
        onSelect={handleSelect}
        onMore={() => setDrawerOpen(true)}
      />

      <NavDrawer
        visible={drawerOpen}
        activeSection={section}
        patientName={patientName}
        patientNumber={patientNumber}
        initials={initials}
        onSelect={handleSelect}
        onClose={() => setDrawerOpen(false)}
        onSignOut={() => {
          setDrawerOpen(false);
          void supabase.auth.signOut();
        }}
      />
    </View>
  );
}
