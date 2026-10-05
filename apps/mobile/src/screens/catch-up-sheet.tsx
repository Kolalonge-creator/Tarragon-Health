import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { lagosLocalDate } from "@tarragon/medicines";
import { useUiLanguage } from "@/lib/ui-language";
import { type DoseChecklistItem } from "@/lib/medications";
import { answerCatchUp, catchUpKey, retryDelayMs, runCatchUpCheck, saveDismissed, saveLastOffered, type CatchUpChoice } from "@/lib/catch-up";
import { space, useTheme } from "@/ui/design";
import { AppText, Button, InlineAlert, Sheet } from "@/ui/kit";

interface CatchUpSheetProps {
  /** The device owner's own account. Doses of someone being acted for are not asked about here. */
  patientId: string;
  organisationId: string;
  enabled: boolean;
}

/**
 * Asked for once when the app opens or returns to the foreground, only when doses closed with no
 * answer. Every dose can be answered three ways or left; "Not now" remembers what was shown so it
 * does not come back. The Today list is unaffected either way.
 */
export function CatchUpSheet({ patientId, organisationId, enabled }: CatchUpSheetProps) {
  const { colors } = useTheme();
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const [items, setItems] = useState<DoseChecklistItem[]>([]);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const shown = useRef<string[]>([]);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(
    async (attempt = 0) => {
      if (!enabled) return;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      const result = await runCatchUpCheck(patientId, Date.now());
      if (result.status === "failed") {
        // A failed read is not "nothing to catch up": try again a few times, then wait for the next open.
        const delay = retryDelayMs(attempt);
        if (delay !== null) retryTimer.current = setTimeout(() => void check(attempt + 1), delay);
        return;
      }
      if (result.status !== "show") return;
      shown.current = result.items.map(catchUpKey);
      void saveLastOffered(Date.now());
      setItems(result.items);
      setFailed(false);
      setVisible(true);
    },
    [enabled, patientId]
  );

  useEffect(() => {
    // Turned off (the account is now being acted for): close it rather than leave it over the banner.
    if (!enabled) setVisible(false);
    void check();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => {
      sub.remove();
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [check, enabled]);

  function dismiss() {
    // Whatever was not answered is not asked about again.
    void saveDismissed(shown.current);
    setVisible(false);
  }

  async function answer(item: DoseChecklistItem, choice: CatchUpChoice) {
    const key = catchUpKey(item);
    if (busy) return;
    setBusy(key);
    setFailed(false);
    const res = await answerCatchUp(patientId, organisationId, item, choice);
    setBusy(null);
    if (res.error) {
      setFailed(true);
      return;
    }
    const rest = items.filter((i) => catchUpKey(i) !== key);
    setItems(rest);
    if (rest.length === 0) setVisible(false);
  }

  const today = lagosLocalDate(Date.now());

  return (
    <Sheet visible={visible} onClose={dismiss} title={tr("meds.catchup.title")}>
      <View style={{ gap: space.md }}>
        <AppText variant="body" tone="textMuted">
          {tr("meds.catchup.body")}
        </AppText>
        {failed ? <InlineAlert tone="info" message={tr("meds.catchup.failed")} /> : null}
        {items.map((item) => {
          const key = catchUpKey(item);
          return (
            <View key={key} style={{ gap: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
              <AppText variant="bodyStrong">
                {item.date === today ? tr("meds.catchup.today") : tr("meds.catchup.yesterday")} · {item.time}
              </AppText>
              <AppText variant="caption" tone="textMuted">
                {[item.drugName, item.doseText ?? item.doseLabel ?? null].filter(Boolean).join(" · ")}
              </AppText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                <Button title={tr("meds.catchup.took")} fullWidth={false} disabled={busy !== null} onPress={() => void answer(item, "took")} />
                <Button title={tr("meds.catchup.skipped")} variant="secondary" fullWidth={false} disabled={busy !== null} onPress={() => void answer(item, "skipped")} />
                <Button title={tr("meds.catchup.not_taken")} variant="secondary" fullWidth={false} disabled={busy !== null} onPress={() => void answer(item, "not_taken")} />
              </View>
            </View>
          );
        })}
        <Button title={tr("meds.catchup.not_now")} variant="ghost" onPress={dismiss} />
      </View>
    </Sheet>
  );
}
