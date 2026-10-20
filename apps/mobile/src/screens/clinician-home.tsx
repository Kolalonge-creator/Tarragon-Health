import { useState } from "react";
import { Button, Screen } from "@/ui/kit";
import { OnCallScreen } from "@/screens/clinician/on-call-screen";
import { DeviceCheckScreen } from "@/screens/clinician/device-check-screen";

/**
 * What a signed-in clinician sees in the app (S19e): the On call page surface and the battery and alarm set-up. Patient records are
 * not shown here; the clinician console on the web is where a case is opened. The page route itself (alarm channel,
 * background task, receipts, repeats, heartbeat) is started by App.tsx for the whole signed-in session, so it keeps running if the
 * clinician opens their own record.
 */
export function ClinicianHome({ onSignOut, onOpenOwnRecord }: { onSignOut: () => void; onOpenOwnRecord: () => void }) {
  const [view, setView] = useState<"on-call" | "device-check">("on-call");

  return (
    <Screen>
      {view === "on-call" ? <OnCallScreen onOpenDeviceCheck={() => setView("device-check")} /> : <DeviceCheckScreen onBack={() => setView("on-call")} />}
      <Button title="Open my own health record" variant="ghost" onPress={onOpenOwnRecord} fullWidth={false} />
      <Button title="Sign out" variant="ghost" onPress={onSignOut} fullWidth={false} />
    </Screen>
  );
}
