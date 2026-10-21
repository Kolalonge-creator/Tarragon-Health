import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { loadLowCarb, lowCarbPanels, respondToLowCarbOffer, stopLowCarbProgramme, type LowCarbView } from "@/lib/lowcarb";
import { useUiLanguage } from "@/lib/ui-language";
import { EmergencyGuidanceModal } from "@/screens/emergency-guidance-modal";
import type { SectionId } from "@/lib/sections";
import { space } from "@/ui/design";
import { AppText, Badge, Button, Card, InlineAlert, Screen } from "@/ui/kit";

const CHECKIN_LABEL = { glucose: "lowcarb.checkin.glucose", ketones: "lowcarb.checkin.ketones", weight: "lowcarb.checkin.weight" } as const;
const CHECKIN_STATUS = { on_track: "lowcarb.checkin.on_track", due: "lowcarb.checkin.due", overdue: "lowcarb.checkin.overdue" } as const;
const CHECKIN_TONE = { on_track: "positive", due: "warn", overdue: "neutral" } as const;

interface LowCarbScreenProps {
  patientId: string;
  /** Answering is the person's own yes, so nothing is shown while acting for someone else. */
  acting?: boolean;
  onNavigate?: (id: SectionId) => void;
}

/**
 * The phone equivalent of /patient/lowcarb (S50b). It shows the offer, today's check-in, what to do if a reading is low and how to reach the care
 * team, and it never says why a programme was paused. Logging a reading goes to the existing Vitals screen (the offline outbox, idempotent client ids).
 * Equal-weight yes and no, no countdown, nothing pre-ticked. The Stop button stays for anyone on the programme, whatever the guard says.
 */
export function LowCarbScreen({ patientId, acting = false, onNavigate }: LowCarbScreenProps) {
  const locale = asLocale(useUiLanguage());
  const tr = useCallback((key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params), [locale]);
  const [view, setView] = useState<LowCarbView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [guidance, setGuidance] = useState(false);

  const load = useCallback(async () => {
    setView(await loadLowCarb(patientId));
  }, [patientId]);

  useEffect(() => {
    if (!acting) void load();
  }, [acting, load]);

  if (acting) return null;
  const show = lowCarbPanels(view);
  if (view === null) {
    return (
      <Screen>
        <AppText variant="headline" heading>
          {tr("lowcarb.title")}
        </AppText>
        <AppText variant="body" tone="textMuted">
          {tr("lowcarb.loading")}
        </AppText>
      </Screen>
    );
  }

  async function answer(accept: boolean) {
    if (busy || view?.kind !== "ok") return;
    setBusy(true);
    setMessage(null);
    const result = await respondToLowCarbOffer(view.enrolmentId, accept);
    setBusy(false);
    if (!result.ok) return setMessage(result.key);
    setMessage(result.outcome === "active" ? "lowcarb.offer.accepted" : result.outcome === "declined" ? "lowcarb.offer.declined" : "lowcarb.offer.unavailable");
    await load();
  }

  async function stop() {
    if (busy || view?.kind !== "ok") return;
    setBusy(true);
    setMessage(null);
    const result = await stopLowCarbProgramme(view.enrolmentId);
    setBusy(false);
    if (!result.ok) return setMessage(result.key);
    setMessage("lowcarb.stopped");
    await load();
  }

  return (
    <Screen>
      <AppText variant="headline" heading>
        {tr("lowcarb.title")}
      </AppText>

      {show.error && view.kind === "error" ? (
        // A failed load is its own state: never worded as "nothing here", because that would hide the low-sugar card and Stop from someone on the programme.
        <Card style={{ gap: space.sm }}>
          <InlineAlert tone="warn" message={view.offline ? tr("lowcarb.offline.load") : tr("lowcarb.error.load")} />
          <Button title={tr("lowcarb.retry")} variant="secondary" onPress={() => void load()} />
        </Card>
      ) : null}

      {show.unavailable ? (
        <AppText variant="body" tone="textMuted">
          {message ? tr(message) : tr("lowcarb.offer.unavailable")}
        </AppText>
      ) : null}

      {show.offer && view.kind === "ok" ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="title" heading>
            {tr("lowcarb.offer.title")}
          </AppText>
          <AppText variant="body">{tr("lowcarb.offer.body")}</AppText>
          <AppText variant="body">{tr("lowcarb.food.body")}</AppText>
          <Button title={tr("lowcarb.offer.accept")} variant="secondary" disabled={busy} loading={busy} onPress={() => void answer(true)} />
          <Button title={tr("lowcarb.offer.decline")} variant="secondary" disabled={busy} onPress={() => void answer(false)} />
        </Card>
      ) : null}

      {show.checkin && view.kind === "ok" ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="title" heading>
            {tr("lowcarb.checkin.title")}
          </AppText>
          <AppText variant="body">{tr("lowcarb.checkin.body")}</AppText>
          {view.checkins
            ? view.checkins.map((c) => (
                <View key={c.metric} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
                  <AppText variant="body">{`${tr(CHECKIN_LABEL[c.metric])}: ${tr("lowcarb.checkin.count", { done: c.countThisWeek, expected: c.expected })}`}</AppText>
                  <Badge tone={CHECKIN_TONE[c.status]} label={tr(CHECKIN_STATUS[c.status])} />
                </View>
              ))
            : null}
          {onNavigate ? <Button title={tr("lowcarb.log")} onPress={() => onNavigate("vitals")} /> : null}
        </Card>
      ) : null}

      {show.paused ? (
        <Card style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Badge tone="warn" label={tr("lowcarb.paused.badge")} />
            <AppText variant="title" heading>
              {tr("lowcarb.paused.title")}
            </AppText>
          </View>
          <AppText variant="body">{tr("lowcarb.paused.body")}</AppText>
        </Card>
      ) : null}

      {show.lowCard && view.kind === "ok" ? (
        <>
          <Card style={{ gap: space.sm }}>
            <AppText variant="title" heading>
              {tr("lowcarb.low.title")}
            </AppText>
            <AppText variant="body">{tr("lowcarb.low.body", { line: view.lowLine })}</AppText>
            <Button title={tr("lowcarb.emergency.button")} variant="secondary" onPress={() => setGuidance(true)} />
          </Card>
          <Card style={{ gap: space.sm }}>
            <AppText variant="title" heading>
              {tr("lowcarb.contact.title")}
            </AppText>
            <AppText variant="body">{tr("lowcarb.contact.body")}</AppText>
            <AppText variant="body">{tr("lowcarb.food.body")}</AppText>
            {onNavigate ? <Button title={tr("lowcarb.contact.button")} variant="secondary" onPress={() => onNavigate("messages")} /> : null}
          </Card>
          <Card style={{ gap: space.sm }}>
            <AppText variant="body">{tr("lowcarb.stop.confirm")}</AppText>
            <Button title={tr("lowcarb.stop.button")} variant="secondary" disabled={busy} onPress={() => void stop()} />
          </Card>
        </>
      ) : null}

      {message && view.kind === "ok" ? <InlineAlert tone="info" message={tr(message)} /> : null}

      <EmergencyGuidanceModal visible={guidance} detail={tr("lowcarb.emergency.detail")} synced emergencyContact={null} onDismiss={() => setGuidance(false)} />
    </Screen>
  );
}
