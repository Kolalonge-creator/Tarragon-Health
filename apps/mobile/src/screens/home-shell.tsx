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
 * device's signed-in user has a supported person's account open, Overview
 * and Vitals read and write that person's record (subjectId) instead of the
 * device owner's own, exactly like every /patient/* route already does on
 * web. Medications, Messages, Labs, Health Passport, Emergency card and
 * Settings deliberately stay on the device owner's own userId: web's own
 * acting-for backend (private.can_act_for) only covers vitals/symptoms/
 * risk-assessment/emergency-events/hospital-admissions, so extending it to
 * those other native screens would need new backend support that doesn't
 * exist yet, not just a mobile-side change.
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

      {(section === "overview" || section === "vitals") && (
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
        {section === "medications" && <MedicationsScreen patientId={userId} organisationId={organisationId} />}
        {section === "labs" && <LabsScreen />}
        {section === "messages" && <MessagesScreen patientId={userId} />}
        {section === "supporting" && (
          <SupportingScreen userId={userId} acting={acting} onActingChange={refreshActing} />
        )}
        {section === "passport" && <HealthPassportScreen patientId={userId} organisationId={organisationId} />}
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
