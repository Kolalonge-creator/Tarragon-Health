import { useCallback, useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { t } from "@tarragon/i18n";
import { supabase } from "@/lib/supabase";
import { PLATFORM_URL } from "@/lib/platform-url";
import { Card, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

/**
 * Two-tier (founder 2026-10-12): the Free rule's follow-up on the phone. Calm guidance after an amber event or a rapid weight
 * gain, and the "did you get care" check-in after a red event. Everything is read and answered through the patient's own
 * session; nothing reaches a doctor. Renders nothing when there is nothing to show.
 */
type Guidance = { id: string; kind: string };
const ANSWERS = ["got_care", "going_now", "not_yet"] as const;
type Answer = (typeof ANSWERS)[number];

export function FreeFollowUpCard() {
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [checkinId, setCheckinId] = useState<string | null>(null);
  const [done, setDone] = useState<Answer | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const g = await supabase.rpc("my_free_guidance");
      setGuidance(!g.error && g.data?.[0] ? { id: g.data[0].id, kind: g.data[0].kind } : null);
      const c = await supabase.rpc("my_free_red_checkin");
      setCheckinId(!c.error && c.data?.[0] ? c.data[0].id : null);
    } catch {
      // offline: show nothing, the web card and the server record are unaffected
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function answer(a: Answer) {
    if (!checkinId) return;
    setFailed(false);
    const { error } = await supabase.rpc("answer_free_red_checkin", { p_id: checkinId, p_answer: a });
    if (error) {
      setFailed(true);
      return;
    }
    setDone(a);
    setCheckinId(null);
  }

  async function acknowledge() {
    if (!guidance) return;
    const { error } = await supabase.rpc("acknowledge_free_guidance", { p_id: guidance.id });
    if (!error) setGuidance(null);
  }

  if (!guidance && !checkinId && !done) return null;

  return (
    <Card style={{ gap: 10 }}>
      {guidance ? (
        <View style={{ gap: 8 }}>
          <AppText variant="body">
            {guidance.kind === "heart_failure" ? t("freered.heart_failure.body", "en") : t("freered.amber.body", "en")}
          </AppText>
          <AppText variant="label">{t("freered.no_doctor", "en")}</AppText>
          <SecondaryButton title={t("freered.join", "en")} onPress={() => Linking.openURL(`${PLATFORM_URL}/patient/membership`)} />
          <SecondaryButton title={t("freered.guidance.ok", "en")} onPress={acknowledge} />
        </View>
      ) : null}
      {checkinId ? (
        <View style={{ gap: 8 }}>
          <AppText variant="bodyStrong">{t("freered.checkin.title", "en")}</AppText>
          <AppText variant="body">{t("freered.checkin.question", "en")}</AppText>
          {ANSWERS.map((a) => (
            <SecondaryButton key={a} title={t(`freered.checkin.${a}`, "en")} onPress={() => answer(a)} />
          ))}
          {failed ? <AppText variant="body">{t("freered.checkin.error", "en")}</AppText> : null}
        </View>
      ) : null}
      {done ? (
        <View style={{ gap: 6 }}>
          <AppText variant="body">{t("freered.checkin.thanks", "en")}</AppText>
          {done === "not_yet" ? <AppText variant="bodyStrong">{t("freered.checkin.not_yet_note", "en")}</AppText> : null}
        </View>
      ) : null}
    </Card>
  );
}
