import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import { canReportLost, phoneState, sortPhones, type PhoneLeaseRow } from "@tarragon/shared";
import { describePhone, t } from "@tarragon/i18n";
import { listMyPhoneLeases, requestPhoneWipe, reportThisPhoneLostNow, thisPhoneDeviceId } from "@/lib/device-lease";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, SecondaryButton } from "@/ui/legacy-kit";

/**
 * "My phones" (S06x follow-up), inside My Health: the phones that keep a saved, encrypted copy of this person's entries, with
 * "this phone was lost". Own account only (the caller does not render it while acting for someone else). The state is always in words,
 * so colour is never the only signal. Reporting the phone in hand asks first, then clears it now (one last upload attempt, then signs out).
 */
export function MyPhonesCard({ userId }: { userId: string }) {
  const colors = useLegacyColors();
  const [phones, setPhones] = useState<PhoneLeaseRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [thisPhone, setThisPhone] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, mine] = await Promise.all([listMyPhoneLeases(), thisPhoneDeviceId(userId)]);
    setThisPhone(mine);
    if (list.ok) {
      setPhones(list.phones);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const report = (deviceId: string) => {
    const mine = deviceId === thisPhone;
    Alert.alert(t("phones.lost.title"), `${t("phones.lost.body")}${mine ? `\n\n${t("phones.lost.body_this_phone")}` : ""}`, [
      { text: t("phones.lost.cancel"), style: "cancel" },
      {
        text: t("phones.lost.confirm"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            const accepted = mine ? await reportThisPhoneLostNow(deviceId) : await requestPhoneWipe(deviceId);
            setBusy(false);
            setNotice(accepted ? t("phones.lost.done") : t("phones.lost.failed"));
            if (accepted) await load();
          })();
        },
      },
    ]);
  };

  const now = Date.now();
  return (
    <View style={{ gap: 8 }}>
      <View>
        <Text style={{ color: colors.ink, fontWeight: "600", fontSize: 18 }}>{t("phones.title")}</Text>
        <MutedText>{t("phones.description")}</MutedText>
      </View>
      {phones === null && !failed ? (
        <ActivityIndicator color={colors.brand} />
      ) : failed ? (
        <ErrorText>{t("phones.load_failed")}</ErrorText>
      ) : phones && phones.length === 0 ? (
        <Card>
          <MutedText>{t("phones.empty")}</MutedText>
        </Card>
      ) : (
        sortPhones(phones ?? [], now).map((p) => {
          const state = phoneState(p, now);
          const copy = describePhone({
            state,
            platform: p.platform,
            lastCheckinAt: p.last_checkin_at,
            leaseExpiresAt: p.lease_expires_at,
            wipeConfirmedAt: p.wipe_confirmed_at,
            unsentAtWipe: p.unsent_at_wipe,
            dangerAtWipe: p.danger_at_wipe,
          });
          return (
            <Card key={p.device_id}>
              <Text style={{ color: colors.ink, fontWeight: "600" }}>
                {copy.name}
                {p.device_id === thisPhone ? ` (${t("phones.this_phone")})` : ""}
              </Text>
              <MutedText>{copy.stateLine}</MutedText>
              {copy.clearedLines.map((line) => (
                <MutedText key={line}>{line}</MutedText>
              ))}
              <MutedText>{copy.lastSeen}</MutedText>
              {canReportLost(state) ? <SecondaryButton title={t("phones.lost.button")} disabled={busy} onPress={() => report(p.device_id)} /> : null}
            </Card>
          );
        })
      )}
      {notice ? <MutedText>{notice}</MutedText> : null}
    </View>
  );
}
