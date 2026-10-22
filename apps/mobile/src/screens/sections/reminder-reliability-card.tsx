import { useCallback, useEffect, useState } from "react";
import { AppState, Platform, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import {
  answerSelfTest,
  permissionGuidance,
  selfTestOutcome,
  selfTestStep,
  type PermissionState,
  type SelfTestRecord,
} from "@tarragon/medicines";
import { ensureDoseReminderPermission, startReminderSelfTest } from "@/lib/dose-reminders";
import { androidManufacturer, keepStepsFor, openAppSettings, openBatterySettings } from "@/lib/keep-reminders";
import { consumeFirstRun, readPermissionState, readSelfTest, writeSelfTest } from "@/lib/reminder-reliability";
import { loadReminderReliability } from "@/lib/medicines-config";
import { useUiLanguage } from "@/lib/ui-language";
import { space } from "@/ui/design";
import { AppText, Button, Card, InlineAlert } from "@/ui/kit";

/**
 * "Make reminders reliable" (item 4), the same on Android and iPhone. It opens by itself the first time, and sits folded on the
 * Medications screen and in Settings afterwards. Three things: a calm note and a button when notifications are off or only quiet
 * (iPhone provisional), a one minute self-test ("did you see it?") whose answer is kept on the phone, and the steps for this phone
 * when the test did not arrive. Everything works offline. Not run on a real Android phone or iPhone yet.
 */
export function ReminderReliabilityCard() {
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<PermissionState>("allowed");
  const [rec, setRec] = useState<SelfTestRecord | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);

  const refresh = useCallback(async () => {
    setPermission(await readPermissionState());
    setRec(await readSelfTest());
    setNow(Date.now());
  }, []);

  useEffect(() => {
    let alive = true;
    void refresh();
    void consumeFirstRun().then((first) => {
      if (alive && first) setOpen(true);
    });
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [refresh]);

  // While a test is out, look at the clock every few seconds so "did you see it?" appears by itself.
  const pending = rec !== null && rec.answer === null;
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [pending]);

  const guidance = permissionGuidance(permission);
  const cfg = loadReminderReliability();
  const outcome = selfTestOutcome(rec, now, cfg);
  const step = rec ? selfTestStep(rec, now, cfg) : "wait";
  const needsSteps = outcome === "needs_help";

  async function allow() {
    await ensureDoseReminderPermission();
    await refresh();
  }

  async function start() {
    setFailed(false);
    const started = await startReminderSelfTest();
    if (started === null) {
      setFailed(true);
      await refresh();
      return;
    }
    setRec(started);
    setNow(Date.now());
  }

  async function answer(saw: boolean) {
    if (!rec) return;
    const next = answerSelfTest(rec, saw ? "saw" : "not_seen", Date.now());
    setRec(next);
    await writeSelfTest(next);
  }

  async function openSettings() {
    setOpenFailed(!(await openAppSettings()));
  }

  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="bodyStrong">{tr("reliability.title")}</AppText>
      {guidance.action !== "none" ? (
        <View style={{ gap: space.xs }}>
          <InlineAlert tone="info" message={tr(guidance.messageKey)} />
          {guidance.action === "ask" ? (
            <Button title={tr("reliability.permission.allow")} variant="secondary" onPress={() => void allow()} />
          ) : (
            <Button title={tr("reliability.open_settings")} variant="secondary" onPress={() => void openSettings()} />
          )}
          {openFailed ? <InlineAlert tone="info" message={tr("meds.keep.opening_failed")} /> : null}
        </View>
      ) : null}

      {open ? (
        <View style={{ gap: space.sm }}>
          <AppText variant="body" tone="textMuted">
            {tr("reliability.intro")}
          </AppText>
          <AppText variant="caption" tone="textMuted">
            {tr("reliability.follow_up_note")}
          </AppText>
        </View>
      ) : null}

      <AppText variant="body" accessibilityLiveRegion="polite">
        {tr(
          outcome === "never_tested"
            ? "reliability.test.never"
            : outcome === "pending"
              ? "reliability.test.pending"
              : outcome === "working"
                ? "reliability.test.working"
                : outcome === "needs_help"
                  ? "reliability.test.needs_help"
                  : "reliability.test.retest"
        )}
      </AppText>
      {outcome === "pending" && step === "ask" ? (
        <View style={{ gap: space.xs }}>
          <AppText variant="bodyStrong">{tr("reliability.test.ask")}</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            <Button title={tr("reliability.test.yes")} fullWidth={false} onPress={() => void answer(true)} />
            <Button title={tr("reliability.test.no")} variant="secondary" fullWidth={false} onPress={() => void answer(false)} />
          </View>
        </View>
      ) : null}
      {outcome === "pending" && step === "wait" ? (
        <AppText variant="caption" tone="textMuted">
          {tr("reliability.test.started")}
        </AppText>
      ) : null}
      {failed ? <InlineAlert tone="info" message={tr("reliability.test.failed")} /> : null}
      {outcome !== "pending" ? (
        <Button title={tr("reliability.test.start")} variant={needsSteps ? "primary" : "secondary"} onPress={() => void start()} />
      ) : null}

      {needsSteps ? (
        <View style={{ gap: space.xs }}>
          {Platform.OS === "android" ? (
            <>
              {keepStepsFor(androidManufacturer()).map((key, i) => (
                <AppText key={key} variant="caption" tone="textMuted">{`${i + 1}. ${tr(key)}`}</AppText>
              ))}
              <Button title={tr("meds.keep.open_battery")} variant="secondary" onPress={() => void openBatterySettings().then((ok) => setOpenFailed(!ok))} />
            </>
          ) : (
            <>
              <AppText variant="caption" tone="textMuted">
                {tr("reliability.ios_steps")}
              </AppText>
              <Button title={tr("reliability.open_settings")} variant="secondary" onPress={() => void openSettings()} />
            </>
          )}
        </View>
      ) : null}

      <Button title={open ? tr("reliability.hide") : tr("reliability.show")} variant="ghost" fullWidth={false} onPress={() => setOpen((v) => !v)} />
    </Card>
  );
}
