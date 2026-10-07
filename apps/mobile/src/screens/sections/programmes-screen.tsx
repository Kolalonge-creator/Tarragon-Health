import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { joinProgramme, leaveProgramme, loadMemberships, loadSharingText, setSharing, type MembershipsLoad } from "@/lib/programmes";
import { useUiLanguage } from "@/lib/ui-language";
import { space } from "@/ui/design";
import { AppText, Button, Card, EmptyState, Field, InlineAlert, Screen, Skeleton, SkeletonGroup } from "@/ui/kit";

const JOIN_MESSAGE: Record<string, MessageKey> = { joined: "programme.joined", already: "programme.already", code_invalid: "programme.code_invalid", error: "programme.error" };

/**
 * Programmes (S38e on the phone): join with a code, see the programmes you are in, choose whether to share group figures with each one, and
 * leave. Joining shares nothing; sharing is off until turned on, can be turned off at any time, and ends on leaving. A person's own account
 * only: nothing is changed while acting for someone else.
 */
export function ProgrammesScreen({ acting = false }: { acting?: boolean }) {
  const locale = asLocale(useUiLanguage());
  const [data, setData] = useState<MembershipsLoad | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharingText, setSharingText] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, text] = await Promise.all([loadMemberships(), loadSharingText()]);
    setData(m);
    setSharingText(text);
  }, []);
  useEffect(() => {
    if (!acting) void load();
  }, [load, acting]);

  const run = useCallback(async (job: () => Promise<MessageKey | null>) => {
    setBusy(true);
    const m = await job();
    if (m) setMessage(m);
    await load();
    setBusy(false);
  }, [load]);

  if (acting) {
    return (
      <Screen>
        <EmptyState icon="heart" title={t("programme.title", locale)} body={t("programme.own_only", locale)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <AppText variant="headline" heading>
          {t("programme.title", locale)}
        </AppText>
        <AppText variant="body" tone="textMuted">
          {t("programme.subtitle", locale)}
        </AppText>
      </View>
      {message ? <InlineAlert tone={message === "programme.error" || message === "programme.code_invalid" ? "warn" : "info"} message={t(message, locale)} /> : null}
      <Card style={{ gap: space.md }}>
        <Field label={t("programme.code_label", locale)} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={20} />
        <Button
          title={t("programme.join", locale)}
          disabled={busy || code.trim().length < 4}
          onPress={() => void run(async () => {
            const r = await joinProgramme(code);
            if (r === "joined" || r === "already") setCode("");
            return JOIN_MESSAGE[r];
          })}
        />
      </Card>
      {data === null ? (
        <SkeletonGroup label={t("programme.title", locale)}>
          <Skeleton width="100%" height={120} />
        </SkeletonGroup>
      ) : !data.ok ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="body">{t("programme.error", locale)}</AppText>
          <Button title={t("history.retry", locale)} onPress={() => void load()} variant="secondary" />
        </Card>
      ) : data.memberships.length === 0 ? (
        <AppText variant="body" tone="textMuted">
          {t("programme.none", locale)}
        </AppText>
      ) : (
        data.memberships.map((m) => (
          <Card key={m.cohortId} style={{ gap: space.sm }}>
            <AppText variant="title" heading>
              {m.name}
            </AppText>
            <AppText variant="body" tone="textMuted">
              {t("programme.from", locale, { sponsor: m.sponsor })}
            </AppText>
            <AppText variant="body" heading>
              {t("programme.share_title", locale)}
            </AppText>
            <AppText variant="body">{sharingText ?? t("programme.share_body", locale, { sponsor: m.sponsor })}</AppText>
            <AppText variant="body">{t(m.sharing ? "programme.share_on" : "programme.share_off", locale)}</AppText>
            {!m.sharing && (!m.sharingOpen || sharingText === null) ? (
              <AppText variant="body" tone="textMuted">
                {t("programme.share_unavailable", locale)}
              </AppText>
            ) : (
              <Button
                title={t(m.sharing ? "programme.share_turn_off" : "programme.share_turn_on", locale)}
                variant="secondary"
                disabled={busy}
                onPress={() => void run(async () => {
                  const r = await setSharing(m.cohortId, !m.sharing);
                  return r === "saved" ? "programme.saved" : r === "unavailable" ? "programme.share_unavailable" : "programme.error";
                })}
              />
            )}
            <AppText variant="body" tone="textMuted">
              {t("programme.leave_note", locale)}
            </AppText>
            <Button
              title={t("programme.leave", locale)}
              variant="secondary"
              disabled={busy}
              onPress={() => void run(async () => ((await leaveProgramme(m.cohortId)) === "saved" ? "programme.saved" : "programme.error"))}
            />
          </Card>
        ))
      )}
    </Screen>
  );
}
