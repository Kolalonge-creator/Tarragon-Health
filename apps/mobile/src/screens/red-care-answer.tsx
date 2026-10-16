import { useState } from "react";
import { Text, View } from "react-native";
import { t } from "@tarragon/i18n";
import { colors } from "@/ui/theme";
import { SecondaryButton } from "@/ui/components";
import { supabase } from "@/lib/supabase";
import { answerRedCare, type RedCareAnswer as Answer, type RedCareOutcome } from "@/lib/red-care";

/**
 * Two buttons under the red guidance (S13 R4, CMO Q13): "I have sought care" and "I could not get care". Saved on the phone
 * first, so it works with no signal, and sent when there is one. The care team sees the answer; it never stops them calling.
 * It is offered to anyone whose red alert reaches a doctor, or when that is not known yet (offline). A Free patient has their
 * own check-in instead and is not shown this.
 */
export function RedCareAnswer() {
  const [state, setState] = useState<{ answer: Answer; outcome: RedCareOutcome } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function send(answer: Answer) {
    if (busy) return;
    setBusy(true);
    let outcome: RedCareOutcome = "failed";
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (uid) outcome = await answerRedCare(uid, answer);
    } catch {
      outcome = "failed";
    }
    setBusy(false);
    setFailed(outcome === "failed");
    setState(outcome === "failed" ? null : { answer, outcome });
  }

  if (state) {
    return (
      <Text accessibilityLiveRegion="polite" style={{ fontSize: 13.5, lineHeight: 20, color: colors.ink }}>
        {state.outcome === "queued" ? t("redcare.queued", "en") : state.answer === "could_not_get_care" ? t("redcare.saved_could_not", "en") : t("redcare.saved", "en")}
      </Text>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>{t("redcare.question", "en")}</Text>
      <SecondaryButton title={t("redcare.sought", "en")} onPress={() => void send("sought_care")} />
      <SecondaryButton title={t("redcare.could_not", "en")} onPress={() => void send("could_not_get_care")} />
      {failed ? <Text accessibilityRole="alert" style={{ fontSize: 12.5, color: colors.status.warn }}>{t("redcare.failed", "en")}</Text> : null}
    </View>
  );
}
