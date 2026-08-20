import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { supabase } from "@/lib/supabase";
import { SECTIONS, type SectionId } from "@/lib/sections";
import { getActingFor, stopActingFor, type ActingFor } from "@/lib/acting";
import { TopBar } from "@/ui/top-bar";
import { NavDrawer } from "@/ui/nav-drawer";
import { ActingForBanner } from "@/ui/acting-for-banner";
import { colors } from "@/ui/theme";
import { WebViewScreen } from "@/screens/webview-screen";
import { OverviewScreen } from "@/screens/sections/overview-screen";
import { VitalsScreen } from "@/screens/sections/vitals-screen";
import { MedicationsScreen } from "@/screens/sections/medications-screen";
import { LabsScreen } from "@/screens/sections/labs-screen";
import { MessagesScreen } from "@/screens/sections/messages-screen";
import { HealthPassportScreen } from "@/screens/sections/health-passport-screen";
import { EmergencyCardScreen } from "@/screens/sections/emergency-card-screen";
import { SettingsScreen } from "@/screens/sections/settings-screen";
import { SupportingScreen } from "@/screens/sections/supporting-screen";

interface HomeShellProps {
  userId: string;
  organisationId: string;
  patientName: string;
  patientNumber: string | null;
  initials: string;
}

/**
 * The authenticated "Home" tab: top bar + drawer + one of the eleven
 * sections from docs/MOBILE_APP_SPEC.md §2 — native screens render directly,
 * the rest embed the matching web page. Mirrors the Claude Design
 * prototype's drawer + section-router structure.
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
 * - Settings and Emergency card stay on userId on purpose, not because of
 *   an RLS gap: Settings is device/account configuration, not patient
 *   record data, and Emergency card is meant to represent whoever is
 *   physically holding the phone for a first responder — neither should
 *   ever track a transient acting-for state.
 */
export function HomeShell({ userId, organisationId, patientName, patientNumber, initials }: HomeShellProps) {
  const [section, setSection] = useState<SectionId>("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [acting, setActing] = useState<ActingFor | null>(null);

  const refreshActing = useCallback(() => {
    getActingFor().then(setActing);
  }, []);

  useEffect(() => {
    refreshActing();
  }, [refreshActing]);

  function handleSelect(id: SectionId) {
    setSection(id);
    setDrawerOpen(false);
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
        {section === "emergency" && <EmergencyCardScreen patientId={userId} />}
        {section === "settings" && <SettingsScreen />}
        {(section === "care" || section === "prevention" || section === "family") && (
          <WebViewScreen path={SECTIONS.find((s) => s.id === section)!.webviewPath!} />
        )}
      </View>

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
