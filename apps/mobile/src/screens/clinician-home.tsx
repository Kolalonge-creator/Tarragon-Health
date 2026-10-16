import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { Button, Screen } from "@/ui/kit";
import { startPageSurface } from "@/lib/paging/page-native";
import { OnCallScreen } from "@/screens/clinician/on-call-screen";
import { DeviceCheckScreen } from "@/screens/clinician/device-check-screen";

/**
 * What a signed-in clinician sees in the app (S19e): the On call page surface and the battery and alarm set-up. Patient records are
 * not shown here; the clinician console on the web is where a case is opened. Starting the surface creates the alarm channel,
 * registers the notification background task and starts the receipts, repeats and heartbeat (page-native.ts).
 */
export function ClinicianHome({ onSignOut }: { onSignOut: () => void }) {
  const [view, setView] = useState<"on-call" | "device-check">("on-call");

  useEffect(() => {
    const handle = startPageSurface(() => AppState.currentState === "active");
    return () => handle.stop();
  }, []);

  return (
    <Screen>
      {view === "on-call" ? <OnCallScreen onOpenDeviceCheck={() => setView("device-check")} /> : <DeviceCheckScreen onBack={() => setView("on-call")} />}
      <Button title="Sign out" variant="ghost" onPress={onSignOut} fullWidth={false} />
    </Screen>
  );
}
