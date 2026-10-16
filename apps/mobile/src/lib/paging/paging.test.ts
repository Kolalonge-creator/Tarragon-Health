/**
 * S19e: the phone's side of the on-call page route. Receipt reporting and its retry, payload reading, the repeat alarm, the
 * decisions that start and stop it, the response parsers, the self-test prompt, and the guard rails (neutral wording, critical
 * alerts off, no full-screen intent).
 */
import { readFileSync } from "node:fs";
import { parseActivePage, parseReadiness, loadActivePages, type ActivePage, type Rpc } from "./page-api";
import { REPEAT_BODY, REPEAT_COUNT, REPEAT_PREFIX, REPEAT_TITLE, startPageRepeats, stopPageRepeats, repeatsPending, type AlarmPort } from "./page-alarm";
import { PAGE_URL, readPagePush } from "./page-push";
import { flushPageReceipts, reportPageReceipt, type PendingReceipt, type ReceiptDeps } from "./page-receipts";
import { handlePagePayload, needsAlarm, recoverPresentedPages, syncAlarm } from "./page-surface";
import { failureText, gapLabel, pageCard, selfTestDue, waitingLabel } from "./on-call-model";
import { criticalAlertsRequested } from "./critical-alerts";
import { channelSettingsIntent } from "./device-check-model";

const ID = "3f2b8a52-7a9e-4c1d-9b0e-5d6f7a8b9c0d";
const OK = { ok: true as const, data: true };

describe("readPagePush", () => {
  it("reads a foreground notification, a tap, and both background-task shapes", () => {
    const data = { url: PAGE_URL, notificationId: ID };
    expect(readPagePush({ request: { content: { data } } })).toEqual({ notificationId: ID, isTest: false });
    expect(readPagePush({ notification: { request: { content: { data } } } })).toEqual({ notificationId: ID, isTest: false });
    expect(readPagePush({ data: { dataString: JSON.stringify(data) } })).toEqual({ notificationId: ID, isTest: false });
    expect(readPagePush({ data: { body: JSON.stringify(data) } })).toEqual({ notificationId: ID, isTest: false });
  });
  it("ignores anything that is not a page push", () => {
    expect(readPagePush({ request: { content: { data: { url: "/patient/vitals", notificationId: ID } } } })).toBeNull();
    expect(readPagePush({ request: { content: { data: { url: PAGE_URL, notificationId: "nope" } } } })).toBeNull();
    expect(readPagePush({ request: { content: { data: { url: PAGE_URL, kind: "page_repeat" } } } })).toBeNull();
    expect(readPagePush({ data: { dataString: "{not json" } })).toBeNull();
    for (const v of [null, undefined, 3, "x", [], {}]) expect(readPagePush(v)).toBeNull();
  });
  it("does not search forever in a hostile nested payload", () => {
    let o: Record<string, unknown> = { url: PAGE_URL, notificationId: ID };
    for (let i = 0; i < 20; i += 1) o = { data: o };
    expect(readPagePush(o)).toBeNull();
  });
});

function receiptDeps(sendResults: Array<{ ok: true; data: boolean } | { ok: false; error: string }>, initial: PendingReceipt[] = [], failSave = false) {
  let stored = [...initial];
  let now = 1_000_000;
  const sent: string[] = [];
  const deps: ReceiptDeps = {
    send: async (id) => {
      sent.push(id);
      return sendResults.shift() ?? OK;
    },
    load: async () => [...stored],
    save: async (p) => {
      if (failSave) throw new Error("full");
      stored = [...p];
    },
    now: () => now,
  };
  return { deps, sent, stored: () => stored, advance: (ms: number) => (now += ms) };
}

describe("reportPageReceipt", () => {
  it("reports at once and keeps nothing when it lands", async () => {
    const t = receiptDeps([OK]);
    await expect(reportPageReceipt(ID, t.deps)).resolves.toBe("sent");
    expect(t.stored()).toEqual([]);
  });
  it("keeps a receipt that failed for a reason that can pass, once", async () => {
    const t = receiptDeps([{ ok: false, error: "network down" }, { ok: false, error: "network down" }]);
    await expect(reportPageReceipt(ID, t.deps)).resolves.toBe("kept");
    await expect(reportPageReceipt(ID, t.deps)).resolves.toBe("kept");
    expect(t.stored()).toHaveLength(1);
  });
  it("keeps a receipt that failed because the access token had expired (it refreshes; the retry passes)", async () => {
    const t = receiptDeps([{ ok: false, error: "JWT expired" }]);
    await expect(reportPageReceipt(ID, t.deps)).resolves.toBe("kept");
  });
  it("a receipt kept while a flush is running is not overwritten by the flush", async () => {
    const t = receiptDeps([], [{ notificationId: "old", at: 1_000_000 }]);
    const realSend = t.deps.send;
    let first = true;
    const racing: ReceiptDeps = {
      ...t.deps,
      send: async (id) => {
        if (first) {
          first = false;
          // while the flush is mid-send, a new push fails transiently and is kept
          await reportPageReceipt("fresh", { ...t.deps, send: async () => ({ ok: false, error: "net" }) });
        }
        return realSend(id);
      },
    };
    await flushPageReceipts(racing);
    expect(t.stored().map((p) => p.notificationId)).toEqual(["fresh"]);
  });
  it("drops a receipt the server refuses (not authorised), never retrying it", async () => {
    const t = receiptDeps([{ ok: false, error: "not authorised" }]);
    await expect(reportPageReceipt(ID, t.deps)).resolves.toBe("dropped");
    expect(t.stored()).toEqual([]);
  });
  it("says dropped (not kept) when storage is full, so nothing claims a retry that cannot happen", async () => {
    const t = receiptDeps([{ ok: false, error: "network down" }], [], true);
    await expect(reportPageReceipt(ID, t.deps)).resolves.toBe("dropped");
  });
  it("keeps at most 20", async () => {
    const t = receiptDeps(Array.from({ length: 25 }, () => ({ ok: false as const, error: "net" })));
    for (let i = 0; i < 25; i += 1) await reportPageReceipt(`3f2b8a52-7a9e-4c1d-9b0e-5d6f7a8b${String(i).padStart(4, "0")}`, t.deps);
    expect(t.stored().length).toBe(20);
  });
});

describe("flushPageReceipts", () => {
  it("sends what is kept, leaves transient failures, drops refused and expired ones", async () => {
    const t = receiptDeps([OK, { ok: false, error: "net" }, { ok: false, error: "unknown page" }], [
      { notificationId: "a", at: 1_000_000 },
      { notificationId: "b", at: 1_000_000 },
      { notificationId: "c", at: 1_000_000 },
      { notificationId: "old", at: 1_000_000 - 25 * 3600_000 },
    ]);
    await expect(flushPageReceipts(t.deps)).resolves.toEqual({ sent: 1, left: 1 });
    expect(t.sent).toEqual(["a", "b", "c"]); // the expired one is never sent
    expect(t.stored().map((p) => p.notificationId)).toEqual(["b"]);
  });
  it("does nothing when nothing is kept", async () => {
    const t = receiptDeps([]);
    await expect(flushPageReceipts(t.deps)).resolves.toEqual({ sent: 0, left: 0 });
    expect(t.sent).toEqual([]);
  });
});

function fakeAlarm(): AlarmPort & { ids: Map<string, number>; failSchedule: boolean } {
  const ids = new Map<string, number>();
  const port = {
    ids,
    failSchedule: false,
    schedule: async (id: string, s: number) => {
      if (port.failSchedule) throw new Error("native");
      ids.set(id, s);
    },
    cancel: async (id: string) => void ids.delete(id),
    scheduledIdentifiers: async () => [...ids.keys(), "dose|other"],
  };
  return port;
}

describe("page repeats", () => {
  it("schedules a bounded run, once (a second start replaces, never doubles)", async () => {
    const a = fakeAlarm();
    await expect(startPageRepeats(a)).resolves.toBe(REPEAT_COUNT);
    await startPageRepeats(a);
    expect(a.ids.size).toBe(REPEAT_COUNT);
    expect(Math.max(...a.ids.values())).toBe(REPEAT_COUNT * 60); // 8 minutes at most
  });
  it("stops only its own notifications", async () => {
    const a = fakeAlarm();
    await startPageRepeats(a);
    await stopPageRepeats(a);
    expect(a.ids.size).toBe(0);
    expect(await repeatsPending(a)).toBe(false);
    expect([...a.ids.keys()].every((k) => k.startsWith(REPEAT_PREFIX))).toBe(true);
  });
  it("never throws when the phone refuses", async () => {
    const a = fakeAlarm();
    a.failSchedule = true;
    await expect(startPageRepeats(a)).resolves.toBe(0);
  });
  it("uses fixed neutral words (INV-07)", () => {
    for (const text of [REPEAT_TITLE, REPEAT_BODY]) {
      expect(text).not.toMatch(/\d|blood|pressure|glucose|sugar|diabet|hypert|patient|reading|mmhg|emergency/i);
    }
  });
});

const page = (over: Partial<ActivePage> = {}): ActivePage => ({
  pageId: "p1", rootId: "r1", role: "primary", level: 0, sentAt: "2026-10-16T10:00:00Z", acknowledged: false, secondsWaiting: 30, delivered: false, expired: false, ...over,
});
const pagesOf = (...p: ActivePage[]) => async () => ({ ok: true as const, data: { pages: p, dropped: 0 } });

describe("syncAlarm and handlePagePayload", () => {
  it("rings while any page is unacknowledged and stops when all are acknowledged", async () => {
    const a = fakeAlarm();
    await expect(syncAlarm({ alarm: a, pages: pagesOf(page()) })).resolves.toBe("ringing");
    expect(a.ids.size).toBe(REPEAT_COUNT);
    await expect(syncAlarm({ alarm: a, pages: pagesOf(page({ acknowledged: true })) })).resolves.toBe("stopped");
    expect(a.ids.size).toBe(0);
  });
  it("a closed or empty list stops it too", async () => {
    const a = fakeAlarm();
    await startPageRepeats(a);
    await expect(syncAlarm({ alarm: a, pages: pagesOf() })).resolves.toBe("stopped");
    expect(a.ids.size).toBe(0);
  });
  const offline = async () => ({ ok: false as const, error: "offline" });
  it("an unreadable answer from a poll changes nothing: it neither starts an alarm nor silences one", async () => {
    const a = fakeAlarm();
    await expect(syncAlarm({ alarm: a, pages: offline })).resolves.toBe("unchanged");
    expect(a.ids.size).toBe(0);
    await startPageRepeats(a);
    await expect(syncAlarm({ alarm: a, pages: offline })).resolves.toBe("unchanged");
    expect(a.ids.size).toBe(REPEAT_COUNT);
  });
  it("right after a page push, an unreadable answer still rings (a missed real page is the worse mistake)", async () => {
    const a = fakeAlarm();
    await expect(syncAlarm({ alarm: a, pages: offline }, { assumePage: true })).resolves.toBe("ringing_unverified");
    expect(a.ids.size).toBe(REPEAT_COUNT);
  });
  it("a poll does not slide the run forward; a new page push does", async () => {
    const a = fakeAlarm();
    await syncAlarm({ alarm: a, pages: pagesOf(page()) });
    a.ids.set(`${REPEAT_PREFIX}1`, 5); // pretend time has passed for the first repeat
    await syncAlarm({ alarm: a, pages: pagesOf(page()) });
    expect(a.ids.get(`${REPEAT_PREFIX}1`)).toBe(5);
    await startPageRepeats(a, true);
    expect(a.ids.get(`${REPEAT_PREFIX}1`)).toBe(60);
  });
  it("a row that could not be read counts as an unacknowledged page", async () => {
    const a = fakeAlarm();
    const unreadable = async () => ({ ok: true as const, data: { pages: [page({ acknowledged: true })], dropped: 1 } });
    await expect(syncAlarm({ alarm: a, pages: unreadable })).resolves.toBe("ringing");
    expect(needsAlarm([], 1)).toBe(true);
  });
  it("an offline page push is reported, kept for a retry, and rings", async () => {
    const t = receiptDeps([{ ok: false, error: "network" }]);
    const a = fakeAlarm();
    await handlePagePayload({ request: { content: { data: { url: PAGE_URL, notificationId: ID } } } }, { alarm: a, pages: offline, receipts: t.deps });
    expect(t.stored()).toHaveLength(1);
    expect(a.ids.size).toBe(REPEAT_COUNT);
  });
  it("a page push is reported first, then the alarm is aligned; any other payload touches nothing", async () => {
    const t = receiptDeps([OK]);
    const a = fakeAlarm();
    const deps = { alarm: a, pages: pagesOf(page()), receipts: t.deps };
    await expect(handlePagePayload({ request: { content: { data: { url: PAGE_URL, notificationId: ID } } } }, deps)).resolves.toBe("handled");
    expect(t.sent).toEqual([ID]);
    expect(a.ids.size).toBe(REPEAT_COUNT);
    const t2 = receiptDeps([]);
    await expect(handlePagePayload({ request: { content: { data: { url: "/patient/vitals", notificationId: ID } } } }, { ...deps, receipts: t2.deps })).resolves.toBe("ignored");
    expect(t2.sent).toEqual([]);
  });
  it("a test page push (nothing waiting) is reported and does not leave the alarm ringing", async () => {
    const t = receiptDeps([OK]);
    const a = fakeAlarm();
    await handlePagePayload({ request: { content: { data: { url: PAGE_URL, notificationId: ID } } } }, { alarm: a, pages: pagesOf(), receipts: t.deps });
    expect(t.sent).toEqual([ID]);
    expect(a.ids.size).toBe(0);
  });
  it("a failed receipt is kept for a retry and the alarm still runs", async () => {
    const t = receiptDeps([{ ok: false, error: "network" }]);
    const a = fakeAlarm();
    await handlePagePayload({ request: { content: { data: { url: PAGE_URL, notificationId: ID } } } }, { alarm: a, pages: pagesOf(page()), receipts: t.deps });
    expect(t.stored()).toHaveLength(1);
    expect(a.ids.size).toBe(REPEAT_COUNT);
  });
  it("recovers pushes found in the tray", async () => {
    const t = receiptDeps([OK, OK]);
    const n = (id: string) => ({ request: { content: { data: { url: PAGE_URL, notificationId: id } } } });
    const handled = await recoverPresentedPages([n(ID), { request: { content: { data: { url: "/x" } } } }, n("3f2b8a52-7a9e-4c1d-9b0e-5d6f7a8b9c0e")], { alarm: fakeAlarm(), pages: pagesOf(), receipts: t.deps });
    expect(handled).toBe(2);
    expect(t.sent).toHaveLength(2);
  });
  it("needsAlarm", () => {
    expect(needsAlarm([])).toBe(false);
    expect(needsAlarm([page({ acknowledged: true }), page()])).toBe(true);
  });
});

describe("parsers", () => {
  const row = { page_id: "p", root_id: "r", role: "primary", escalation_level: 0, sent_at: "t", acknowledged_at: null, seconds_waiting: 12, delivered_at: null, expired_at: null };
  it("parses a my_active_pages row and reads no patient field", () => {
    expect(parseActivePage({ ...row, patient_id: "SECRET" })).toEqual({ pageId: "p", rootId: "r", role: "primary", level: 0, sentAt: "t", acknowledged: false, secondsWaiting: 12, delivered: false, expired: false });
    expect(JSON.stringify(parseActivePage({ ...row, patient_id: "SECRET" }))).not.toContain("SECRET");
  });
  it("rejects malformed rows", () => {
    expect(parseActivePage({ ...row, role: "boss" })).toBeNull();
    expect(parseActivePage({ ...row, seconds_waiting: "12" })).toBeNull();
    expect(parseActivePage(null)).toBeNull();
  });
  it("loadActivePages is an error, never an empty list, when the call fails or every row is unreadable", async () => {
    const fail: Rpc = async () => ({ data: null, error: { message: "boom" } });
    await expect(loadActivePages(fail)).resolves.toEqual({ ok: false, error: "boom" });
    const bad: Rpc = async () => ({ data: [{ nonsense: 1 }], error: null });
    await expect(loadActivePages(bad)).resolves.toMatchObject({ ok: false });
    const mixed: Rpc = async () => ({ data: [row, { nonsense: 1 }], error: null });
    await expect(loadActivePages(mixed)).resolves.toMatchObject({ ok: true, data: { dropped: 1 } });
    const empty: Rpc = async () => ({ data: [], error: null });
    await expect(loadActivePages(empty)).resolves.toEqual({ ok: true, data: { pages: [], dropped: 0 } });
    const notArray: Rpc = async () => ({ data: { a: 1 }, error: null });
    await expect(loadActivePages(notArray)).resolves.toMatchObject({ ok: false });
  });
  it("parses readiness", () => {
    expect(parseReadiness({ gaps: ["test_page"], last_test_page_acknowledged_at: null, pending_test_page_id: "t", test_page_days: 7, objective_required: true })).toEqual({
      gaps: ["test_page"], lastTestPageAcknowledgedAt: null, pendingTestPageId: "t", testPageDays: 7, objectiveRequired: true,
    });
    expect(parseReadiness({ gaps: [1], test_page_days: 7 })).toBeNull();
    expect(parseReadiness({ gaps: [], test_page_days: 0 })).toBeNull();
  });
});

describe("on-call model", () => {
  const base = { gaps: [], lastTestPageAcknowledgedAt: null, pendingTestPageId: null, testPageDays: 7, objectiveRequired: true };
  const now = Date.parse("2026-10-16T12:00:00Z");
  it("the weekly self-test is due with no test, or one day before the 7-day window ends", () => {
    expect(selfTestDue(base, now)).toBe(true);
    expect(selfTestDue({ ...base, lastTestPageAcknowledgedAt: "2026-10-15T12:00:00Z" }, now)).toBe(false);
    expect(selfTestDue({ ...base, lastTestPageAcknowledgedAt: "2026-10-10T12:00:00Z" }, now)).toBe(true);
    expect(selfTestDue({ ...base, lastTestPageAcknowledgedAt: "garbage" }, now)).toBe(true);
  });
  it("labels gaps, with a safe default for an unknown code", () => {
    expect(gapLabel("push_subscription")).toMatch(/notifications/i);
    expect(gapLabel("something_new")).toMatch(/clinical lead/i);
  });
  it("cards: unacknowledged can be acknowledged; acknowledged cannot; expired is loud but still acknowledgeable", () => {
    expect(pageCard(page()).canAcknowledge).toBe(true);
    expect(pageCard(page({ acknowledged: true })).canAcknowledge).toBe(false);
    expect(pageCard(page({ expired: true }))).toMatchObject({ canAcknowledge: true, tone: "danger" });
    expect(pageCard(page({ secondsWaiting: 400 })).tone).toBe("danger");
    expect(waitingLabel(30)).toMatch(/less than a minute/);
    expect(waitingLabel(125)).toBe("Waiting 2 minutes");
  });
  it("shows no raw database message", () => {
    expect(failureText("relation public.pages does not exist")).not.toMatch(/relation|public/);
    expect(failureText("the test page has not been shown on your phone")).toMatch(/has not reached this phone/);
  });
  it("every string a clinician or a lock screen can read is neutral (INV-07)", () => {
    const words = [
      pageCard(page()).title, pageCard(page()).status, pageCard(page({ role: "escalation" })).title, pageCard(page({ acknowledged: true })).status,
      pageCard(page({ expired: true })).status, ...["push_subscription", "verified_email", "test_page", "x"].map(gapLabel),
      failureText("a"), failureText("not authorised"), failureText("wait a little"), failureText("not been shown"),
    ];
    for (const w of words) expect(w).not.toMatch(/blood|pressure|glucose|sugar|diabet|hypert|mmhg|reading|spo2|oxygen|pregnan|patient/i);
  });
});

describe("guard rails", () => {
  it("critical alerts are off unless the build asks for them", () => {
    expect(criticalAlertsRequested(undefined)).toBe(false);
    expect(criticalAlertsRequested({})).toBe(false);
    expect(criticalAlertsRequested({ iosCriticalAlerts: "1" })).toBe(false);
    expect(criticalAlertsRequested({ iosCriticalAlerts: true })).toBe(true);
  });
  it("the channel-settings intent targets the page channel", () => {
    expect(channelSettingsIntent("com.x", "on_call_page").extras).toEqual([
      { key: "android.provider.extra.APP_PACKAGE", value: "com.x" },
      { key: "android.provider.extra.CHANNEL_ID", value: "on_call_page" },
    ]);
  });
  it("no full-screen intent anywhere in the paging code or the app config", () => {
    const files = ["page-channel", "page-alarm", "page-native", "page-surface"].map((f) => readFileSync(`src/lib/paging/${f}.ts`, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));
    expect(files.join("\n") + readFileSync("app.json", "utf8")).not.toMatch(/USE_FULL_SCREEN_INTENT|fullScreenIntent/i);
  });
  it("the Android permission that lets the app appear in Do Not Disturb access is declared, and the runtime version moved", () => {
    const app = JSON.parse(readFileSync("app.json", "utf8")) as { expo: { runtimeVersion: string; android: { permissions: string[] } } };
    expect(app.expo.android.permissions).toContain("android.permission.ACCESS_NOTIFICATION_POLICY");
    expect(app.expo.runtimeVersion).toBe("0.1.0-native7");
  });
  it("registration reports the alarm channel only for a clinician, and the critical-alert permission only behind the flag", () => {
    const src = readFileSync("src/lib/push-registration.ts", "utf8");
    expect(src).toContain("options.clinician === true ? await ensurePageChannel() : false");
    expect(src).toContain("criticalAlertsRequested()");
    expect(src).toContain("page_channel_ready: pageChannelReady");
  });
  it("the page push is never sent as an SMS or voice route by this app and no WhatsApp appears in the paging code", () => {
    const all = ["page-api", "page-native", "page-surface", "on-call-model"].map((f) => readFileSync(`src/lib/paging/${f}.ts`, "utf8")).join("\n");
    expect(all).not.toMatch(/whatsapp|sms|termii/i);
  });
});
