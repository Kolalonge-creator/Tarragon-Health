import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { statusAgainstTarget } from "@tarragon/clinical";
import { useUiLanguage } from "@/lib/ui-language";
import { clearHomeCheck, loadHomeBpConfig, loadHomeCheck, requestSend, startHomeCheck, type HomeCheckLoad } from "@/lib/home-check";
import { todayLine, type SentResult } from "@/lib/home-check-model";
import { useBpTarget } from "@/lib/use-bp-target";
import { radii, space, useTheme } from "@/ui/design";
import { AppText, Badge, Button, Card, InlineAlert } from "@/ui/kit";

type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

const CONFIG = loadHomeBpConfig();

/**
 * "Start a home check" and its progress (S07x, decisions C1 and C2). It sits on the Home and Vitals screens, not in the Today list itself (that is S47).
 * It shows nothing unless the server's go-live guard is open for this person, counts everything from readings already on this phone, and says
 * "with your care team" only after the server confirmed the result. A short protocol never shows an average. No streak, score or "missed" wording.
 */
export function HomeCheckCard({ patientId, reloadToken }: { patientId: string; reloadToken?: number }) {
  const language = asLocale(useUiLanguage());
  const tr: Tr = (key, params) => t(key, language, params);
  const [load, setLoad] = useState<HomeCheckLoad | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"queued" | "failed" | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const personal = useBpTarget(patientId);
  const { colors } = useTheme();

  const refresh = useCallback(async () => {
    try {
      setLoad(await loadHomeCheck(patientId, Date.now()));
    } catch {
      setLoad(null);
    }
  }, [patientId]);

  useEffect(() => {
    void refresh();
  }, [refresh, reloadToken]);

  if (!load || load.view.kind === "hidden") return null;
  const view = load.view;

  const send = async () => {
    setBusy(true);
    setNotice(null);
    const outcome = await requestSend(patientId);
    setBusy(false);
    if (outcome.kind === "offline") setNotice("queued");
    else if (outcome.kind === "not_enough" || outcome.kind === "closed") setNotice("failed");
    await refresh();
  };

  const bandLine = (r: SentResult | { systolic: number; diastolic: number; band: SentResult["band"] }) => {
    // A care-team-set personal target wins; a standard starting suggestion is labelled as one and never called the care team's.
    if (personal && personal.origin === "care_team") {
      const s = statusAgainstTarget(r.systolic, r.diastolic, { systolic: personal.systolicBelow, diastolic: personal.diastolicBelow, confirmed: true });
      return tr(s.status === "above_target" ? "hc.target.above" : "hc.target.within");
    }
    return tr(`hc.band.${r.band}` as MessageKey);
  };

  const guide = (
    <View style={{ gap: space.sm }}>
      <Button variant="secondary" fullWidth={false} title={guideOpen ? tr("hc.cuff.hide") : tr("hc.cuff.toggle")} onPress={() => setGuideOpen((v) => !v)} />
      {guideOpen ? (
        <View accessibilityLabel={tr("hc.cuff.title")} style={{ gap: space.sm, padding: space.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }}>
          <AppText variant="bodyStrong" heading>
            {tr("hc.cuff.title")}
          </AppText>
          {(["hc.cuff.device", "hc.cuff.fit", "hc.cuff.battery", "hc.cuff.arm", "hc.cuff.no_wrist", "hc.cuff.pregnancy"] as const).map((k, i) => (
            <View key={k} style={{ flexDirection: "row", gap: space.sm }}>
              <AppText variant="bodyStrong" tone="textMuted">
                {i + 1}.
              </AppText>
              <View style={{ flex: 1 }}>
                <AppText variant="body">{tr(k)}</AppText>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="title" heading>
        {tr("hc.title")}
      </AppText>

      {view.kind === "start" ? (
        <>
          <AppText variant="body">{tr("hc.intro")}</AppText>
          <AppText variant="caption" tone="textMuted">
            {tr("hc.how")}
          </AppText>
          <Button title={tr("hc.start")} onPress={() => void startHomeCheck(patientId, Date.now()).then(refresh)} />
          {guide}
        </>
      ) : null}

      {view.kind === "running" ? (
        <>
          <Badge label={tr("hc.day_of", { day: view.assessment.dayNumber, total: CONFIG.protocol.targetDays })} tone="neutral" />
          <AppText variant="body">{tr("hc.counts", { readings: view.assessment.readings, days: view.assessment.days })}</AppText>
          <AppText variant="bodyStrong">{tr(`hc.today_${todayLine(view.assessment)}` as MessageKey)}</AppText>
          {/* No average yet: the gate is not met, so the screen says what is missing and nothing else. */}
          <AppText variant="caption" tone="textMuted">
            {view.assessment.shortfall && view.assessment.shortfall.moreReadings > 0 && view.assessment.shortfall.moreDays > 0
              ? tr("hc.not_enough", { readings: view.assessment.shortfall.moreReadings, days: view.assessment.shortfall.moreDays })
              : view.assessment.shortfall && view.assessment.shortfall.moreReadings > 0
                ? tr("hc.not_enough_readings", { readings: view.assessment.shortfall.moreReadings })
                : tr("hc.not_enough_days", { days: view.assessment.shortfall?.moreDays ?? 0 })}
          </AppText>
          {guide}
        </>
      ) : null}

      {view.kind === "ready" && view.assessment.mean ? (
        <>
          <AppText variant="body">
            {tr("hc.enough", { sys: view.assessment.mean.systolic, dia: view.assessment.mean.diastolic, readings: view.assessment.readings, days: view.assessment.days })}
          </AppText>
          {view.assessment.band ? <AppText variant="bodyStrong">{bandLine({ ...view.assessment.mean, band: view.assessment.band })}</AppText> : null}
          {personal && personal.origin !== "care_team" ? (
            <AppText variant="caption" tone="textMuted">
              {tr("hc.target.suggestion")}
            </AppText>
          ) : null}
          {!view.assessment.windowOver ? <AppText variant="caption" tone="textMuted">{tr("hc.enough_more", { total: CONFIG.protocol.targetDays })}</AppText> : null}
          {view.queued ? <InlineAlert tone="info" message={tr("hc.queued")} /> : null}
          {notice === "failed" ? <InlineAlert tone="warn" message={tr("hc.send_failed")} /> : null}
          <Button title={busy ? tr("hc.sending") : tr("hc.send")} disabled={busy} onPress={() => void send()} />
          {guide}
        </>
      ) : null}

      {view.kind === "ended_short" ? (
        <>
          <AppText variant="body">{tr("hc.ended_short")}</AppText>
          <Button title={tr("hc.restart")} onPress={() => void startHomeCheck(patientId, Date.now()).then(refresh)} />
          {guide}
        </>
      ) : null}

      {view.kind === "sent" ? (
        <>
          <AppText variant="bodyStrong">{tr("hc.sent")}</AppText>
          <AppText variant="body">{tr("hc.enough", { sys: view.result.systolic, dia: view.result.diastolic, readings: view.result.readings, days: view.result.days })}</AppText>
          <AppText variant="body">{bandLine(view.result)}</AppText>
          <AppText variant="caption" tone="textMuted">
            {tr("hc.sent_detail")}
          </AppText>
          <Button variant="secondary" fullWidth={false} title={tr("hc.new")} onPress={() => void clearHomeCheck(patientId).then(refresh)} />
        </>
      ) : null}
    </Card>
  );
}
