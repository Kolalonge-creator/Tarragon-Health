import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { loadUpcomingConsultations } from "@/lib/consultations";
import { formatWhen, type UpcomingConsultation } from "@/lib/consultation-room-model";
import { space } from "@/ui/design";
import { AppText, Button, Card, InlineAlert } from "@/ui/kit";

interface UpcomingConsultationsSectionProps {
  onOpenConsultation: (encounterId: string) => void;
}

/** `stale` is true when the last reload failed and the rows are from an earlier load. */
type ListState = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; rows: UpcomingConsultation[]; stale: boolean };

/**
 * "Your consultations" in the Care area (S21 follow-up, OQ-158): the signed-in patient's coming consultations from
 * my_upcoming_encounters(), each opening the consultation room. Reloads when the app returns to the foreground rather than on a
 * timer, which keeps data use low. A failed load says so (and that nothing is lost); it never shows as "nothing coming up", and a
 * list that already loaded stays (marked as possibly out of date) so someone about to join keeps their way in.
 * NOT run on a real phone: no EAS dev client build exists yet.
 */
export function UpcomingConsultationsSection({ onOpenConsultation }: UpcomingConsultationsSectionProps) {
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const [state, setState] = useState<ListState>({ kind: "loading" });

  // Loads can overlap (foreground event plus retry) and resolve out of order, so an answer is applied only if no NEWER load has
  // already succeeded. A failure never discards good data from an earlier or later load.
  const issued = useRef(0);
  const lastSuccess = useRef(0);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    const mine = ++issued.current;
    const res = await loadUpcomingConsultations();
    if (!mounted.current || mine < lastSuccess.current) return;
    if (res.ok) {
      lastSuccess.current = mine;
      setState({ kind: "ready", rows: res.data, stale: false });
    } else if (lastSuccess.current === 0) {
      setState({ kind: "failed" });
    } else {
      setState((prev) => (prev.kind === "ready" ? { ...prev, stale: true } : prev));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void load();
    });
    return () => {
      mounted.current = false;
      sub.remove();
    };
  }, [load]);

  // Nothing coming up and nothing to show: stay out of the way rather than add an empty card to the Care screen.
  if (state.kind === "ready" && state.rows.length === 0) return null;

  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title" heading>
        {tr("consult.room.list_title")}
      </AppText>
      {state.kind === "loading" ? (
        <AppText variant="body" tone="textMuted" accessibilityLiveRegion="polite">
          {tr("consult.mobile.loading")}
        </AppText>
      ) : null}
      {state.kind === "failed" ? (
        <View style={{ gap: space.sm }}>
          <InlineAlert tone="info" message={tr("consult.mobile.offline")} />
          <Button title={tr("consult.mobile.retry")} variant="secondary" onPress={() => void load()} />
        </View>
      ) : null}
      {state.kind === "ready" && state.stale ? <InlineAlert tone="info" message={tr("consult.mobile.offline")} /> : null}
      {state.kind === "ready"
        ? state.rows.map((row) => (
            <View key={row.encounter_id} style={{ gap: space.xs }}>
              <AppText variant="body">{formatWhen(row.scheduled_at)}</AppText>
              <Button
                title={tr("consult.room.open")}
                variant="secondary"
                onPress={() => onOpenConsultation(row.encounter_id)}
                accessibilityHint={formatWhen(row.scheduled_at)}
              />
            </View>
          ))
        : null}
      {state.kind === "ready" && state.stale ? (
        <Button title={tr("consult.mobile.retry")} variant="secondary" onPress={() => void load()} />
      ) : null}
    </Card>
  );
}
