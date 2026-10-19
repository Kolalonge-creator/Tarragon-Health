/** S19e review fixes: each test is one finding from the second /code-review pass and fails if the fix is reverted. */
import { readFileSync } from "node:fs";
import { Platform } from "react-native";
import { __resetPingForTests, getLastPing, pingDevice, type Rpc } from "./page-api";
import { REPEAT_BODY, REPEAT_COUNT, type AlarmPort } from "./page-alarm";
import { readPagePush, PAGE_URL } from "./page-push";
import type { ReceiptDeps } from "./page-receipts";
import { handlePagePayload } from "./page-surface";
import { runsPatientWork } from "@/lib/sponsor-figures";

const ID = "3f2b8a52-7a9e-4c1d-9b0e-5d6f7a8b9c0d";
const data = (extra: Record<string, unknown> = {}) => ({ request: { content: { data: { url: PAGE_URL, notificationId: ID, ...extra } } } });
const offline = async () => ({ ok: false as const, error: "offline" });

function alarm(): AlarmPort & { ids: Set<string> } {
  const ids = new Set<string>();
  return { ids, schedule: async (id) => void ids.add(id), cancel: async (id) => void ids.delete(id), scheduledIdentifiers: async () => [...ids] };
}
const receipts: ReceiptDeps = { send: async () => ({ ok: true, data: true }), load: async () => [], save: async () => {}, now: () => 0 };

describe("test pages and old pushes never start an alarm", () => {
  it("the sender names a test page in the push data and the app reads it", () => {
    expect(readPagePush(data({ template: "on_call_test_page" }))).toEqual({ notificationId: ID, isTest: true });
    expect(readPagePush(data({ template: "on_call_page" }))).toEqual({ notificationId: ID, isTest: false });
    expect(readPagePush(data())).toEqual({ notificationId: ID, isTest: false });
    expect(readFileSync("../../supabase/functions/send-pending-notifications/index.ts", "utf8")).toContain("PAGE_ALARM_TEMPLATES.includes(template)");
  });
  it("a test page is reported and rings nothing, even when the pages cannot be read", async () => {
    const a = alarm();
    await expect(handlePagePayload(data({ template: "on_call_test_page" }), { alarm: a, pages: offline, receipts })).resolves.toBe("handled");
    expect(a.ids.size).toBe(0);
  });
  it("a replayed tap (mode seen) with the pages unreadable rings nothing; an arrival with the pages unreadable does", async () => {
    const a = alarm();
    await handlePagePayload(data(), { alarm: a, pages: offline, receipts }, "seen");
    expect(a.ids.size).toBe(0);
    await handlePagePayload(data(), { alarm: a, pages: offline, receipts }, "arrival");
    expect(a.ids.size).toBe(REPEAT_COUNT);
  });
  it("the repeat text does not claim a page is certainly waiting (it may have been acknowledged on the web)", () => {
    expect(REPEAT_BODY).toMatch(/may/);
  });
});

describe("heartbeat status", () => {
  beforeEach(() => __resetPingForTests());
  it("tells a set-up problem from a connection problem", async () => {
    Platform.OS = "android";
    const fail = (message: string): Rpc => async () => ({ data: null, error: { message } });
    await expect(pingDevice("device-12345", fail("not authorised"))).resolves.toBe(false);
    expect(getLastPing()).toBe("not_a_clinician");
    await expect(pingDevice("device-12345", fail("fetch failed"))).resolves.toBe(false);
    expect(getLastPing()).toBe("failed");
    await expect(pingDevice("device-12345", async () => ({ data: null, error: null }))).resolves.toBe(true);
    expect(getLastPing()).toBe("ok");
  });
});

describe("app wiring", () => {
  it("a clinician gets the patient background work only after opening their own record", () => {
    expect(runsPatientWork("patient", false)).toBe(true);
    expect(runsPatientWork("clinician", false)).toBe(false);
    expect(runsPatientWork("clinician", true)).toBe(true);
    expect(runsPatientWork("hmo_admin", true)).toBe(false);
  });
  it("the page route is keyed on who is signed in, not on the session object", () => {
    const src = readFileSync("App.tsx", "utf8");
    expect(src).toContain("[session?.user.id, identity?.role, identity?.organisationId]");
  });
  it("registration retries without the new column only when the column is missing", () => {
    const src = readFileSync("src/lib/push-registration.ts", "utf8");
    expect(src).toContain('first.error.code === "42703"');
  });
  it("the alarm channel is reported ready only when the phone actually created it", () => {
    expect(readFileSync("src/lib/paging/page-channel.ts", "utf8")).toContain("return created != null;");
  });
});
