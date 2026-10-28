import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { asLocale, en, t, type MessageKey } from "@tarragon/i18n";
import { fallbackRefundPolicy, type RefundPolicy } from "@tarragon/shared";
import { formatNaira } from "@tarragon/commerce";
import { loadMyRefunds, loadRefundPolicy } from "@/lib/commerce/api";
import { REFUND_STEP_KEY, refundRuleFor, refundTimingNote, type MyRefund } from "@/lib/commerce/refund-view";
import { useUiLanguage } from "@/lib/ui-language";
import { useLegacyColors } from "@/ui/design";
import { Card, MutedText } from "@/ui/legacy-kit";

const isKey = (k: string): k is MessageKey => Object.hasOwn(en, k);

/** The refund numbers: the registry values on the first paint (so the rule is on the screen at once), then the database's answer, the same one the website reads. */
function useRefundPolicy(): RefundPolicy {
  const [policy, setPolicy] = useState<RefundPolicy>(() => fallbackRefundPolicy());
  useEffect(() => {
    let live = true;
    void loadRefundPolicy().then((p) => { if (live) setPolicy(p); });
    return () => { live = false; };
  }, []);
  return policy;
}

/**
 * The refund and cancellation rule in plain words at checkout (S71, A3), the phone's copy of the website's rule. Every number of days is the active
 * configuration's, never typed here, and the lines promise only what the database enforces.
 */
export function RefundRuleBlock({ kind }: { kind: "consultation" | "care_pack" | "lab_panel" | "membership" | "home_kit" }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const policy = useRefundPolicy();
  const lines = refundRuleFor(policy, { kind });
  return (
    <View style={{ gap: 4, marginTop: 8 }} accessibilityRole="summary">
      <Text accessibilityRole="header" style={{ fontWeight: "600", color: colors.ink }}>{t("refund.rule.title", locale)}</Text>
      {lines.map((l) => (
        <MutedText key={l.key}>{`• ${t(l.key as MessageKey, locale, { ...l.params })}`}</MutedText>
      ))}
    </View>
  );
}

/** Every refund the person asked for: the steps so far, the answer time or the bank days, and the reason when it was declined (A3). Nothing when there are none. */
export function RefundStatusCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const policy = useRefundPolicy();
  const [rows, setRows] = useState<MyRefund[]>([]);
  useEffect(() => {
    let live = true;
    void loadMyRefunds().then((r) => { if (live && r.ok) setRows(r.data); });
    return () => { live = false; };
  }, [refreshKey]);
  if (rows.length === 0) return null;
  return (
    <Card>
      <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{t("refund.status.title", locale)}</Text>
      {rows.map((r) => {
        const note = refundTimingNote(r.state, policy);
        return (
          <View key={r.id} style={{ paddingVertical: 8, gap: 4 }}>
            {isKey(r.nameKey) ? <Text style={{ color: colors.ink, fontWeight: "600" }}>{t(r.nameKey, locale)}</Text> : null}
            <MutedText>{t("refund.status.amount", locale, { amount: `₦${formatNaira(r.amountKobo)}` })}</MutedText>
            {r.steps.map((s, i) => (
              <Text key={`${s.step}-${s.createdAt}`} style={{ color: colors.ink, fontWeight: i === r.steps.length - 1 ? "700" : "400" }}>
                {t(REFUND_STEP_KEY[s.step], locale)}
              </Text>
            ))}
            {note?.key === "refund.status.sla" ? <MutedText>{t("refund.status.sla", locale, note.params)}</MutedText> : null}
            {note?.key === "refund.status.bank" ? <MutedText>{t("refund.status.bank", locale, note.params)}</MutedText> : null}
            {r.state === "rejected" && r.decisionNote ? (
              <Text style={{ color: colors.ink }}>{`${t("refund.status.reason_label", locale)}: ${r.decisionNote}`}</Text>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}
