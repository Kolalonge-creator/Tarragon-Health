import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Text, TextInput, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { HMO_RESULT_KEYS, hmoErrorKey, isPlausibleMemberNumber, loadHmoPlans, loadMyHmoChecks, requestHmoCheck, type HmoCheckRow, type HmoPlan } from "@/lib/commerce/hmo";
import { useLegacyColors } from "@/ui/design";
import { Card, ChoiceChip, ErrorText, MutedText, PrimaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

function lagos(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/**
 * Check my health plan (S71, 19.6), the same words as the web. Shown only when a health plan has a Tarragon programme, and not at all while the
 * sponsor go-live guard is off or the list cannot be read (fails closed). The member number lives only in this screen's memory: it is cleared as soon as
 * it is sent, when the app goes to the background, and when the screen closes, so nothing is left behind on a shared phone. The history lists the plan,
 * the result and the date, never the number. A check the HMO cannot answer is left for our team and says so; nobody is told "no" because a connection failed.
 */
export function HmoEligibilitySection({ onChecked }: { onChecked?: () => void }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const tr = useCallback((key: MessageKey) => t(key, locale), [locale]);
  const [plans, setPlans] = useState<HmoPlan[] | null>(null);
  const [checks, setChecks] = useState<HmoCheckRow[]>([]);
  const [hmoId, setHmoId] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultKey, setResultKey] = useState<MessageKey | null>(null);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const [p, c] = await Promise.all([loadHmoPlans(), loadMyHmoChecks()]);
    if (!alive.current) return;
    setPlans(p.ok ? p.data : []);
    if (c.ok) setChecks(c.data);
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    // shared-phone safety: the typed number never survives the app leaving the foreground, or the screen closing
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") setNumber("");
    });
    return () => {
      alive.current = false;
      sub.remove();
      setNumber("");
    };
  }, [refresh]);

  if (plans === null || plans.length === 0) return null;
  const selected = hmoId || plans[0]!.hmoId;
  const canSend = !busy && isPlausibleMemberNumber(number);

  async function submit() {
    setErrorKey(null);
    setResultKey(null);
    setBusy(true);
    const r = await requestHmoCheck(selected, number);
    if (!alive.current) return;
    setBusy(false);
    if (!r.ok) {
      setErrorKey(hmoErrorKey(r.code));
      return;
    }
    // sent: forget the number now
    setNumber("");
    setResultKey(HMO_RESULT_KEYS[r.result]);
    await refresh();
    // a pass changes the quote for every item, so the shop asks again
    onChecked?.();
  }

  return (
    <Card>
      <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{tr("hmo.title")}</Text>
      <MutedText>{tr("hmo.intro")}</MutedText>
      <AppText variant="bodyStrong" style={{ marginTop: 8 }}>{tr("hmo.field.plan")}</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {plans.map((p) => (
          <ChoiceChip key={p.hmoId} title={p.hmoId === selected ? `✓ ${p.name}` : p.name} onPress={() => setHmoId(p.hmoId)} />
        ))}
      </View>
      <AppText variant="bodyStrong" style={{ marginTop: 8 }}>{tr("hmo.field.number")}</AppText>
      <TextInput
        value={number}
        onChangeText={setNumber}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        maxLength={60}
        // no stored suggestions or text-service learning of a member number
        importantForAutofill="no"
        textContentType="none"
        accessibilityLabel={tr("hmo.field.number")}
        accessibilityHint={tr("hmo.hint.number")}
        style={{ minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, color: colors.ink }}
      />
      <MutedText>{tr("hmo.hint.number")}</MutedText>
      <PrimaryButton title={busy ? tr("hmo.submitting") : tr("hmo.submit")} onPress={() => void submit()} disabled={!canSend} />
      {resultKey ? <AppText variant="body" accessibilityLiveRegion="polite">{tr(resultKey)}</AppText> : null}
      {errorKey ? <ErrorText>{tr(errorKey)}</ErrorText> : null}
      <AppText variant="bodyStrong" style={{ marginTop: 8 }}>{tr("hmo.history.title")}</AppText>
      {checks.length === 0 ? <MutedText>{tr("hmo.history.empty")}</MutedText> : null}
      {checks.map((c) => (
        <View key={c.checkId} style={{ paddingVertical: 4 }}>
          <AppText variant="body">{c.hmoName}</AppText>
          <MutedText>{`${tr(HMO_RESULT_KEYS[c.result])} ${lagos(c.decidedAt ?? c.checkedAt)}`}</MutedText>
        </View>
      ))}
    </Card>
  );
}
