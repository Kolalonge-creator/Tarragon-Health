import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Vibration, View } from "react-native";
import { AppText, Badge, Button, Card, InlineAlert } from "@/ui/kit";
import { space } from "@/ui/design";
import {
  acknowledgePage,
  acknowledgeTestPage,
  getDeviceId,
  getLastPing,
  loadActivePages,
  loadReadiness,
  recordPageShown,
  sendTestPage,
  type ActivePage,
  type Readiness,
} from "@/lib/paging/page-api";
import { expoAlarmPort } from "@/lib/paging/page-alarm";
import { needsAlarm, syncAlarm } from "@/lib/paging/page-surface";
import { failureText, gapLabel, pageCard, selfTestDue } from "@/lib/paging/on-call-model";

const POLL_MS = 10_000;
const VIBRATION = [0, 700, 500, 700, 500];

/**
 * The clinician's page screen (S19e). Shows the pages waiting for this clinician with an Acknowledge button, rings and vibrates while
 * one is unacknowledged and the app is open, and carries the readiness card with the test page and the weekly self-test prompt.
 * No patient, reading, condition or name is shown or fetched here (INV-07); after acknowledging, the case itself is opened in the
 * clinician console. Never run on a real device.
 */
export function OnCallScreen({ onOpenDeviceCheck }: { onOpenDeviceCheck: () => void }) {
  const [pages, setPages] = useState<ActivePage[] | null>(null);
  const [pagesError, setPagesError] = useState(false);
  const [unreadable, setUnreadable] = useState(0);
  const [ping, setPing] = useState<ReturnType<typeof getLastPing>>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [readinessError, setReadinessError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const reported = useRef(new Set<string>());
  const alarm = useRef(expoAlarmPort());

  const load = useCallback(async () => {
    const result = await loadActivePages();
    if (!result.ok) {
      setPagesError(true);
      // an unreadable answer changes nothing about a run that is already ringing, and starts none (an offline blip is not a page)
      await syncAlarm({ alarm: alarm.current, pages: async () => result });
    } else {
      setPagesError(false);
      setPages(result.data.pages);
      setUnreadable(result.data.dropped);
      if (needsAlarm(result.data.pages, result.data.dropped)) Vibration.vibrate(VIBRATION, true);
      else Vibration.cancel();
      await syncAlarm({ alarm: alarm.current, pages: async () => result });
      const deviceId = await getDeviceId();
      for (const p of result.data.pages) {
        if (p.acknowledged || p.role === "escalation" || reported.current.has(p.pageId)) continue;
        reported.current.add(p.pageId);
        const shown = await recordPageShown(p.pageId, deviceId);
        if (!shown.ok) reported.current.delete(p.pageId); // retried on the next poll
      }
    }
    setPing(getLastPing());
  }, []);

  const loadReadinessNow = useCallback(async () => {
    const r = await loadReadiness();
    if (r.ok) {
      setReadiness(r.data);
      setReadinessError(false);
    } else {
      setReadinessError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadReadinessNow();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void load();
    }, POLL_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        void load();
        void loadReadinessNow();
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
      Vibration.cancel();
    };
  }, [load, loadReadinessNow]);

  const run = async (key: string, action: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string | null) => {
    setBusy(key);
    setMessage(null);
    const r = await action();
    setBusy(null);
    setMessage(r.ok ? done : failureText(r.error));
    await load();
    await loadReadinessNow();
  };

  const due = readiness ? selfTestDue(readiness, Date.now()) : false;

  return (
    <View style={{ gap: space.lg }}>
      <AppText variant="headline" heading>
        On call
      </AppText>
      {message ? <InlineAlert message={message} tone="info" /> : null}
      {unreadable > 0 ? <InlineAlert message="A page could not be shown on this screen. Treat it as waiting and open the clinician console on the web." tone="danger" /> : null}
      {ping === "failed" ? <InlineAlert message="This phone could not tell the server it is reachable. Check your connection; the clinical lead may see this phone as offline." tone="warn" /> : null}
      {ping === "not_a_clinician" ? <InlineAlert message="Your account is not set up as a working clinician yet, so pages cannot be sent to this phone. Ask the clinical lead." tone="warn" /> : null}
      {pagesError ?<InlineAlert message="Pages could not be loaded. If you are on call, keep this app open and check your connection." tone="danger" /> : null}

      {pages === null && !pagesError ? (
        <AppText variant="body" tone="textMuted">
          Loading
        </AppText>
      ) : pages && pages.length === 0 ? (
        <Card>
          <AppText variant="body">No pages are waiting for you.</AppText>
        </Card>
      ) : (
        (pages ?? []).map((p) => {
          const c = pageCard(p);
          return (
            <Card key={p.pageId} style={{ gap: space.sm }}>
              <AppText variant="title" heading>
                {c.title}
              </AppText>
              <Badge label={c.status} tone={c.tone} />
              {c.canAcknowledge ? (
                <Button title="Acknowledge" loading={busy === p.pageId} onPress={() => void run(p.pageId, () => acknowledgePage(p.pageId), "Acknowledged. Open the clinician console to continue.")} />
              ) : null}
            </Card>
          );
        })
      )}

      <Card style={{ gap: space.sm }}>
        <AppText variant="title" heading>
          Is this phone ready?
        </AppText>
        {readinessError ? (
          <InlineAlert message="Your set-up could not be checked. Try again in a moment." tone="warn" />
        ) : readiness === null ? (
          <AppText variant="body" tone="textMuted">
            Loading
          </AppText>
        ) : (
          <>
            <Badge label={readiness.gaps.length === 0 ? "All set" : `${readiness.gaps.length} to do`} tone={readiness.gaps.length === 0 ? "positive" : "warn"} />
            {readiness.gaps.map((g) => (
              <AppText key={g} variant="body">
                {gapLabel(g)}
              </AppText>
            ))}
            {due ? <InlineAlert message="Your weekly test page is due. Send yourself one and acknowledge it when it arrives." tone="warn" /> : null}
            {readiness.pendingTestPageId ? (
              <>
                <AppText variant="body" tone="textMuted">
                  A test page was sent. When the notification arrives on this phone, open it, then acknowledge it here.
                </AppText>
                <Button
                  title="Acknowledge the test page"
                  loading={busy === "ack-test"}
                  onPress={() => void run("ack-test", () => acknowledgeTestPage(readiness.pendingTestPageId as string), "Test page acknowledged. Thank you.")}
                />
              </>
            ) : (
              <Button title="Send me a test page" variant={due ? "primary" : "secondary"} loading={busy === "send-test"} onPress={() => void run("send-test", () => sendTestPage(), "Test page sent. Wait for the notification.")} />
            )}
          </>
        )}
        <Button title="Battery and alarm set-up for this phone" variant="secondary" onPress={onOpenDeviceCheck} />
      </Card>
    </View>
  );
}
