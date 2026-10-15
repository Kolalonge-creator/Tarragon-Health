import { useState } from "react";
import { Text } from "react-native";
import { pickHandoffScreen } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { supabase } from "@/lib/supabase";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton } from "@/ui/legacy-kit";
import type { MentalHealthScreen } from "@/lib/mental-health";

/**
 * Hand-off from a screen to a consultation (function 10.13). The patient chooses to send their latest answers; a task is raised for the
 * care team (request_mental_health_handoff, a SECURITY DEFINER function that takes only the patient's own screen). Onward referral to
 * local mental health services (Module 15) is not built: the hand-off row is the documented seam it will read.
 */
export function MentalHealthHandoffCard({ screens }: { screens: Partial<Record<string, MentalHealthScreen>> }) {
  const colors = useLegacyColors();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const screen = pickHandoffScreen(Object.values(screens).filter((s): s is MentalHealthScreen => Boolean(s)));
  if (!screen) return null;

  async function send() {
    setState("sending");
    const { error } = await supabase.rpc("request_mental_health_handoff", { p_screen: screen?.id });
    setState(error ? "error" : "sent");
  }

  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("crisis.handoff_title")}</Text>
      <MutedText>{t("crisis.handoff_body")}</MutedText>
      {state === "sent" ? (
        <Text accessibilityRole="alert" style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>{t("crisis.handoff_sent")}</Text>
      ) : (
        <PrimaryButton title={t("crisis.handoff_button")} onPress={send} loading={state === "sending"} />
      )}
      {state === "error" && <ErrorText>{t("crisis.handoff_error")}</ErrorText>}
    </Card>
  );
}
