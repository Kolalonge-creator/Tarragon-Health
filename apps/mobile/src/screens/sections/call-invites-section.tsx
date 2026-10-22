import { useCallback, useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { PLATFORM_URL } from "@/lib/platform-url";
import { answerCallInvite, callInviteWebPath, loadMyCallInvites, type CallInvite } from "@/lib/care-circle/call-invites";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * CGJ: the supporter's own calls they have been invited to join, one call at a time. Accept or say no here; the call itself opens in
 * the web browser because this app has no call SDK (OQ-158). Shows a first name and a time only. Renders nothing without a live invite.
 * NOT run on a real phone.
 */
export function CallInvitesSection() {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [invites, setInvites] = useState<CallInvite[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await loadMyCallInvites();
    if (r.ok) setInvites(r.data);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (invites.length === 0) return null;
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}>{t("consult.cg.invites_title", locale)}</Text>
      {invites.map((i) => (
        <Card key={i.pass_id} style={{ gap: 8 }}>
          <Text style={{ fontWeight: "700", color: colors.ink }}>{t("consult.cg.invited_on", locale, { name: i.patient_first_name, when: when(i.scheduled_at) })}</Text>
          {i.state === "invited" ? (
            <View style={{ gap: 8 }}>
              <PrimaryButton
                title={t("consult.cg.accept", locale)}
                disabled={busy}
                onPress={() => {
                  setBusy(true);
                  setFailed(false);
                  void answerCallInvite(i.pass_id, true).then(async (r) => {
                    if (r !== "ok") setFailed(true);
                    await refresh();
                    setBusy(false);
                  });
                }}
              />
              <SecondaryButton
                title={t("consult.cg.decline", locale)}
                disabled={busy}
                onPress={() => {
                  setBusy(true);
                  setFailed(false);
                  void answerCallInvite(i.pass_id, false).then(async (r) => {
                    if (r !== "ok") setFailed(true);
                    await refresh();
                    setBusy(false);
                  });
                }}
              />
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              <MutedText>{t("consult.cg.mobile_note", locale)}</MutedText>
              <PrimaryButton
                title={t("consult.cg.open_in_browser", locale)}
                onPress={() => void Linking.openURL(`${PLATFORM_URL}${callInviteWebPath(i.encounter_id)}`).catch(() => {})}
              />
            </View>
          )}
        </Card>
      ))}
      {failed ? <ErrorText>{t("consult.cg.error", locale)}</ErrorText> : null}
    </View>
  );
}
