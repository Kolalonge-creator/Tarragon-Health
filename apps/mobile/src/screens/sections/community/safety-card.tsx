import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, findNodeHandle, View } from "react-native";
import { radii, space, useTheme } from "@/ui/design";
import { useT } from "@/lib/ui-language";
import { AppText, Button } from "@/ui/kit";
import { useCopy } from "./common";
import { alertEmergencyContactFromCard, getAccessToken } from "@/lib/community/api";

/**
 * Shown INSTEAD of a post when the words suggested an emergency or that the person may be thinking of harming themselves. The post was
 * not published and nothing was kept. The tone is care, never rejection. Nothing here is sent anywhere by itself: "Alert my emergency
 * contact" runs only on the person's own tap (a phrase match cannot tell "my chest is tight now" from "my mum had chest pain last
 * year", docs/COMMUNITY_SPEC.md 4.4). It records an emergency, messages the saved contact through the server, and then opens the app's own
 * Emergency card, which confirms the alert or says what is missing.
 */
export function SafetyCard({
  kind,
  onDismiss,
  onOpenEmergency,
  onOpenMessages,
}: {
  kind: "emergency" | "self_harm";
  onDismiss: () => void;
  onOpenEmergency: () => void;
  onOpenMessages: () => void;
}) {
  const copy = useCopy();
  const tr = useT();
  const { colors } = useTheme();
  const ref = useRef<View>(null);
  const [busy, setBusy] = useState(false);

  async function alertContact() {
    setBusy(true);
    await alertEmergencyContactFromCard(await getAccessToken());
    setBusy(false);
    onOpenEmergency();
  }

  // Moves screen-reader focus to the card so it is met before anything else on the screen.
  useEffect(() => {
    const node = ref.current ? findNodeHandle(ref.current) : null;
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);

  const emergency = kind === "emergency";
  return (
    <View
      ref={ref}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={{ gap: space.md, borderWidth: 2, borderColor: colors.brand, backgroundColor: colors.brandTint, borderRadius: radii.lg, padding: space.lg }}
    >
      <AppText variant="title" heading>
        {copy(emergency ? "community.safety.emergency.title" : "community.safety.self_harm.title")}
      </AppText>
      <AppText variant="bodyLarge">{copy(emergency ? "community.safety.emergency.body" : "community.safety.self_harm.body")}</AppText>
      {emergency ? (
        <Button title={copy("community.safety.emergency.contact")} onPress={() => void alertContact()} disabled={busy} accessibilityHint={tr("Messages your saved emergency contact now and opens your emergency card.")} />
      ) : (
        <Button title={copy("community.safety.self_harm.care_team")} onPress={onOpenMessages} />
      )}
      <Button title={copy("community.safety.dismiss")} onPress={onDismiss} variant="secondary" />
    </View>
  );
}
