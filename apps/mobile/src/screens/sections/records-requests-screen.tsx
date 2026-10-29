import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { t } from "@tarragon/i18n";
import {
  formatRequestDate,
  listRecordsRequests,
  markRequestReceived,
  withdrawRequest,
  type RecordsRequestResult,
  type RecordsRequestRow,
} from "@/lib/records-requests";
import { spacing } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, SecondaryButton, SectionLabel } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

/**
 * Your records requests: the list, and for each the plain state and the next step. The letter is made and printed on the web; nothing here contacts a
 * facility. Failure and empty states say what is true, and a failed read never shows an empty list as if there were none.
 */
export function RecordsRequestsScreen({ actingForOther = false }: { actingForOther?: boolean }) {
  const colors = useLegacyColors();
  const [rows, setRows] = useState<RecordsRequestRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (actingForOther) return;
    setLoadError(false);
    listRecordsRequests()
      .then(setRows)
      .catch(() => setLoadError(true));
  }, [actingForOther]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<RecordsRequestResult>) => {
    setBusy(true);
    setMessage(null);
    const r = await fn().catch((): RecordsRequestResult => ({ ok: false, reason: "failed" }));
    setBusy(false);
    if (r.ok) load();
    else setMessage(t("records_request.failed"));
  };

  // These requests are the signed-in person's own, so they are not shown while acting for someone else.
  if (actingForOther) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: spacing.screen, backgroundColor: colors.background }}>
        <MutedText>{t("records_request.own_only")}</MutedText>
      </View>
    );
  }
  if (loadError) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.screen, gap: 12, backgroundColor: colors.background }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }}>{t("records_request.load_failed")}</Text>
        <PrimaryButton title={t("records_request.try_again")} onPress={load} />
      </View>
    );
  }
  if (!rows) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const open = rows.find((r) => r.id === openId) ?? null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
      <View>
        <AppText variant="title">{t("records_request.title")}</AppText>
        <MutedText>{t("records_request.description")}</MutedText>
      </View>
      <MutedText>{t("records_request.mobile_hint")}</MutedText>

      {open ? (
        <Card>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{open.facility_name}</Text>
          <MutedText>{t(`records_request.state.${open.state}`)}</MutedText>
          {open.requested_at ? <MutedText>{t("records_request.asked_on", undefined, { date: formatRequestDate(open.requested_at) })}</MutedText> : null}
          {open.is_overdue && open.due_at ? <AppText variant="body">{t("records_request.overdue", undefined, { date: formatRequestDate(open.due_at) })}</AppText> : null}
          {open.state === "sent" && !open.is_overdue && open.due_at ? <MutedText>{t("records_request.due_on", undefined, { date: formatRequestDate(open.due_at) })}</MutedText> : null}
          {open.state === "sent" ? <MutedText>{t("records_request.reply_date_note")}</MutedText> : null}
          {open.state === "received" ? <MutedText>{t("records_request.received_next")}</MutedText> : null}
          {open.state === "prepared" || open.state === "sent" ? (
            <View style={{ gap: 8, marginTop: 8 }}>
              <PrimaryButton title={t("records_request.mark_received")} disabled={busy} onPress={() => void act(() => markRequestReceived(open.id))} />
              <SecondaryButton title={t("records_request.withdraw")} disabled={busy} onPress={() => void act(() => withdrawRequest(open.id))} />
            </View>
          ) : null}
          <SecondaryButton title={t("records_request.back")} onPress={() => setOpenId(null)} />
          {message ? <ErrorText>{message}</ErrorText> : null}
        </Card>
      ) : (
        <View style={{ gap: 10 }}>
          <SectionLabel>{t("records_request.list_title")}</SectionLabel>
          {rows.length === 0 ? (
            <Card>
              <MutedText>{t("records_request.none")}</MutedText>
            </Card>
          ) : (
            rows.map((r) => (
              <Card key={r.id}>
                <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>{r.facility_name}</Text>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <Badge tone={r.is_overdue ? "brand" : "neutral"}>{r.is_overdue ? t("records_request.state.overdue") : t(`records_request.state.${r.state}`)}</Badge>
                </View>
                <SecondaryButton title={t("records_request.open")} onPress={() => setOpenId(r.id)} />
              </Card>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}
