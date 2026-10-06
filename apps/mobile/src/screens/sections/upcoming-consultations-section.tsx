import { useCallback, useEffect, useState } from "react";
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

type ListState = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; rows: UpcomingConsultation[] };

/**
 * "Your consultations" in the Care area (S21 follow-up, OQ-158): the signed-in patient's coming consultations from
 * my_upcoming_encounters(), each opening the consultation room. Reloads when the app returns to the foreground rather than on a
 * timer, which keeps data use low. A failed load says so (and that nothing is lost); it never shows as "nothing coming up".
 * NOT run on a real phone: no EAS dev-client build exists yet.
 */
export function UpcomingConsultationsSection({ onOpenConsultation }: UpcomingConsultationsSectionProps) {
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const [state, setState] = useState<ListState>({ kind: "loading" });

  const load = useCallback(async () => {
    const res = await loadUpcomingConsultations();
    setState(res.ok ? { kind: "ready", rows: res.data } : { kind: "failed" });
  }, []);

  useEffect(() => {
    void load();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void load();
    });
    return () => sub.remove();
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
    </Card>
  );
}
