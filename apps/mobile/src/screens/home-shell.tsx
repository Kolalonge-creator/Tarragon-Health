import { useEffect, useState } from "react";
import { View } from "react-native";
import { supabase } from "@/lib/supabase";
import { SECTIONS, type SectionId } from "@/lib/sections";
import type { DeepLinkDestination } from "@/lib/push-notifications";
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
  /** Set when a push notification was tapped (see App.tsx) — routes to the
   * matching native section, or opens the raw path as a WebView if no
   * native section owns it. */
  deepLink?: DeepLinkDestination | null;
  onDeepLinkHandled?: () => void;
}

/**
 * The authenticated "Home" tab: top bar + drawer + one of the ten sections
 * from docs/MOBILE_APP_SPEC.md §2 — native screens render directly, the rest
 * embed the matching web page. Mirrors the Claude Design prototype's drawer
 * + section-router structure.
 */
export function HomeShell({
  userId,
  organisationId,
  patientName,
  patientNumber,
  initials,
  deepLink,
  onDeepLinkHandled,
}: HomeShellProps) {
  const [section, setSection] = useState<SectionId>("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [webviewOverride, setWebviewOverride] = useState<string | null>(null);

  useEffect(() => {
    if (!deepLink) return;
    if (deepLink.kind === "section") {
      setWebviewOverride(null);
      setSection(deepLink.section);
    } else {
      setWebviewOverride(deepLink.path);
    }
    onDeepLinkHandled?.();
  }, [deepLink, onDeepLinkHandled]);

  function handleSelect(id: SectionId) {
    setWebviewOverride(null);
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
        {webviewOverride ? (
          // A push tap resolved to a path with no native section (e.g.
          // /patient/subscription) — open it directly rather than forcing it
          // into one of the named sections below.
          <WebViewScreen path={webviewOverride} />
        ) : (
          <>
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
          </>
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
