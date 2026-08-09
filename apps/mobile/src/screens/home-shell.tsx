import { useState } from "react";
import { View } from "react-native";
import { supabase } from "@/lib/supabase";
import { SECTIONS, type SectionId } from "@/lib/sections";
import { TopBar } from "@/ui/top-bar";
import { NavDrawer } from "@/ui/nav-drawer";
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

interface HomeShellProps {
  userId: string;
  organisationId: string;
  patientName: string;
  patientNumber: string | null;
  initials: string;
}

/**
 * The authenticated "Home" tab: top bar + drawer + one of the ten sections
 * from docs/MOBILE_APP_SPEC.md §2 — native screens render directly, the rest
 * embed the matching web page. Mirrors the Claude Design prototype's drawer
 * + section-router structure.
 */
export function HomeShell({ userId, organisationId, patientName, patientNumber, initials }: HomeShellProps) {
  const [section, setSection] = useState<SectionId>("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);

  function handleSelect(id: SectionId) {
    setSection(id);
    setDrawerOpen(false);
  }

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

      <View style={{ flex: 1 }}>
        {section === "overview" && (
          <OverviewScreen patientId={userId} patientName={patientName} onNavigate={handleSelect} />
        )}
        {section === "vitals" && <VitalsScreen patientId={userId} />}
        {section === "medications" && <MedicationsScreen patientId={userId} organisationId={organisationId} />}
        {section === "labs" && <LabsScreen />}
        {section === "messages" && <MessagesScreen patientId={userId} />}
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
