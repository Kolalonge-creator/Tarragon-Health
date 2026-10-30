import { useEffect, useState } from "react";
import { View } from "react-native";
import { isOnWaitlist, setOnWaitlist, type WaitlistFeature } from "@/lib/feature-waitlist";
import { space } from "@/ui/design";
import { AppText, Button } from "@/ui/kit";

/**
 * Sits under a "not open yet" notice so a closed feature is not a dead end. It records interest only and promises no message: the line
 * says the screen will change when it opens. While the state is unknown (loading, or the read failed) it shows nothing.
 */
export function JoinWaitlist({ feature }: { feature: WaitlistFeature }) {
  const [joined, setJoined] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void isOnWaitlist(feature).then((v) => {
      if (!cancelled) setJoined(v);
    });
    return () => {
      cancelled = true;
    };
  }, [feature]);

  if (joined === null) return null;

  async function toggle() {
    setBusy(true);
    setFailed(false);
    const ok = await setOnWaitlist(feature, !joined);
    setBusy(false);
    if (ok) setJoined(!joined);
    else setFailed(true);
  }

  return (
    <View style={{ gap: space.sm }}>
      {joined ? <AppText variant="body">You are on the list. This screen will change as soon as it opens.</AppText> : null}
      <Button title={joined ? "Take me off the list" : "Keep me on the list"} variant={joined ? "secondary" : "primary"} fullWidth={false} onPress={() => void toggle()} disabled={busy} loading={busy} />
      {failed ? <AppText variant="body" tone="dangerText">We could not save that just now. Please try again in a moment.</AppText> : null}
    </View>
  );
}
