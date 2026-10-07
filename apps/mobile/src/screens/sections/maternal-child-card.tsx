import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { t } from "@tarragon/i18n";
import { availableLifecycleKinds, type LifecycleKind } from "@tarragon/shared";
import { confirmLifecycleEvent, loadFeedLog, loadMyLifecycle, logFeed, requestTrackerDeletion, type FeedLogRow, type MyLifecycle } from "@/lib/maternal-child";
import { radius } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

const STAGE_KEY = { tracking: "mch.life.stage_tracking", trying: "mch.life.stage_trying", pregnant: "mch.life.stage_pregnant", postnatal: "mch.life.stage_postnatal", parenting: "mch.life.stage_parenting" } as const;
const KIND_KEY: Record<LifecycleKind, Parameters<typeof t>[0]> = {
  start_trying: "mch.life.act_start_trying", stop_trying: "mch.life.act_stop_trying", pregnancy_confirmed: "mch.life.act_pregnancy_confirmed",
  delivery_recorded: "mch.life.act_delivery_recorded", pregnancy_loss_recorded: "mch.life.act_pregnancy_loss_recorded",
  postnatal_period_ended: "mch.life.act_postnatal_period_ended", parenting_ended: "mch.life.act_parenting_ended",
};
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Where you are now: each button is a person confirming something that has happened, dated today. A different date is set on the web. */
export function LifecycleCardMobile() {
  const colors = useLegacyColors();
  const [life, setLife] = useState<MyLifecycle | null>(null);
  const [pending, setPending] = useState<LifecycleKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => { loadMyLifecycle().then(setLife).catch(() => {}); }, []);
  useEffect(() => refresh(), [refresh]);
  if (!life) return null;
  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("mch.life.title")}</Text>
      <MutedText>{t("mch.life.intro")}</MutedText>
      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>{t(STAGE_KEY[life.stage])}</Text>
      {life.baby_content_hidden && <MutedText>{t("mch.life.loss_note")}</MutedText>}
      {pending === null ? (
        availableLifecycleKinds(life.stage).map((k) => <SecondaryButton key={k} title={t(KIND_KEY[k])} onPress={() => { setError(null); setPending(k); }} />)
      ) : (
        <View style={{ gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}>
          <MutedText>{t("mch.life.only_what_happened")}</MutedText>
          {error && <ErrorText>{error}</ErrorText>}
          <PrimaryButton
            title={t("mch.life.confirm")}
            onPress={async () => {
              const r = await confirmLifecycleEvent(pending, todayIso());
              if (!r.ok) { setError(r.error === "not_open" ? t("mch.life.not_open") : t("mch.life.unavailable")); return; }
              setPending(null); refresh();
            }}
          />
          <SecondaryButton title={t("common.cancel")} onPress={() => setPending(null)} />
        </View>
      )}
    </Card>
  );
}

const FEED_CHOICES: { value: FeedLogRow["feed_type"]; key: Parameters<typeof t>[0] }[] = [
  { value: "breast_left", key: "mch.feed.type_breast_left" }, { value: "breast_right", key: "mch.feed.type_breast_right" },
  { value: "expressed_milk", key: "mch.feed.type_expressed_milk" }, { value: "formula", key: "mch.feed.type_formula" },
];

/** A one-tap feed log and the delete request. The feed log is closed (a calm line) until the care team switches maternal care on. */
export function FeedLogCardMobile({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const colors = useLegacyColors();
  const [rows, setRows] = useState<FeedLogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const refresh = useCallback(() => { loadFeedLog(patientId).then(setRows).catch(() => {}); }, [patientId]);
  useEffect(() => refresh(), [refresh]);
  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("mch.feed.title")}</Text>
      <MutedText>{t("mch.feed.intro")}</MutedText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {FEED_CHOICES.map((c) => (
          <SecondaryButton
            key={c.value}
            title={t(c.key)}
            onPress={async () => {
              setError(null);
              const r = await logFeed(patientId, organisationId, { feed_type: c.value, duration_minutes: null, amount_ml: null });
              if (!r.ok) { setError(r.error === "not_open" ? t("mch.feed.not_open") : t("mch.life.unavailable")); return; }
              refresh();
            }}
          />
        ))}
      </View>
      {error && <ErrorText>{error}</ErrorText>}
      {rows.length === 0 ? <MutedText>{t("mch.feed.empty")}</MutedText> : rows.slice(0, 5).map((r) => (
        <Text key={r.id} style={{ fontSize: 13, color: colors.ink }}>{new Date(r.fed_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
      ))}
      <MutedText>{t("mch.feed.support_pending")}</MutedText>
      {!deleted ? (
        <SecondaryButton title={t("mch.delete.request")} onPress={async () => { const r = await requestTrackerDeletion("feed_log"); if (r.ok) setDeleted(true); }} />
      ) : (
        <MutedText>{t("mch.delete.pending", "en", { date: "in a few days" })}</MutedText>
      )}
    </Card>
  );
}
