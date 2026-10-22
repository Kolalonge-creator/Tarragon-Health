import { describe, expect, it } from "@jest/globals";
import { planDoseNotifications, type ReminderMedicine } from "./reminders";
import {
  answerSelfTest,
  parseSelfTest,
  permissionGuidance,
  permissionState,
  selfTestOutcome,
  selfTestStep,
  startSelfTest,
  REMINDER_RELIABILITY_CONFIG,
  cappedPending,
} from "./reminder-reliability";
import { DOSE_REASONS, doseReason, isPrivateDoseReason, shouldOfferPharmacy, supporterMaySeeReason } from "./dose-reasons";
import { RUNWAY_CONFIG, runwayBar, stockLine } from "./runway";
import { NAFDAC_HELPER_CONFIG, nafdacHelperVisible, normaliseScratchCode, scratchCodeMessageLink } from "./nafdac-helper";

const base = { startDate: null, endDate: null, foodNote: null } as const;
const now = Date.parse("2026-10-05T05:00:00Z"); // 06:00 Lagos
const cfg = { maxPending: 60, horizonDays: 3, followUpMinWindowMinutes: 30, maxFollowUps: 8, unconfirmedFollowUpMinutes: 30 };

describe("unconfirmed-dose follow-up", () => {
  it("plans one follow-up 30 minutes after a dose with no window, with a generic kind and a distinct id", () => {
    const meds: ReminderMedicine[] = [{ id: "a", active: true, spec: { ...base, kind: "daily", times: ["08:00"], windowMinutes: 0 } }];
    const plan = planDoseNotifications(meds, new Set(), now, { ...cfg, horizonDays: 1 });
    const u = plan.filter((p) => p.kind === "unconfirmed");
    expect(u).toHaveLength(1);
    expect(u[0].id.endsWith("|u")).toBe(true);
    expect(u[0].fireAtMs - plan[0].fireAtMs).toBe(30 * 60000);
    expect(u[0].slotKeys).toEqual(["a|2026-10-05|08:00"]);
  });
  it("is off when the minutes are absent or 0", () => {
    const meds: ReminderMedicine[] = [{ id: "a", active: true, spec: { ...base, kind: "daily", times: ["08:00"] } }];
    expect(planDoseNotifications(meds, new Set(), now, { ...cfg, unconfirmedFollowUpMinutes: undefined }).some((p) => p.kind === "unconfirmed")).toBe(false);
    expect(planDoseNotifications(meds, new Set(), now, { ...cfg, unconfirmedFollowUpMinutes: 0 }).some((p) => p.kind === "unconfirmed")).toBe(false);
  });
  it("never gives one dose two follow-ups: a dose with a window gets only the window-middle one", () => {
    const meds: ReminderMedicine[] = [{ id: "a", active: true, spec: { ...base, kind: "daily", times: ["08:00"], windowMinutes: 60 } }];
    const plan = planDoseNotifications(meds, new Set(), now, { ...cfg, horizonDays: 1 });
    expect(plan.filter((p) => p.kind === "unconfirmed")).toHaveLength(0);
    expect(plan.filter((p) => p.kind === "follow_up")).toHaveLength(1);
  });
  it("skips an answered dose, a past time and anything past the horizon", () => {
    const meds: ReminderMedicine[] = [{ id: "a", active: true, spec: { ...base, kind: "daily", times: ["08:00"] } }];
    const closed = new Set(["a|2026-10-05|08:00"]);
    const plan = planDoseNotifications(meds, closed, now, { ...cfg, horizonDays: 1 });
    expect(plan.some((p) => p.slotKeys.includes("a|2026-10-05|08:00"))).toBe(false);
    const late = planDoseNotifications(meds, new Set(), Date.parse("2026-10-05T07:10:00Z"), { ...cfg, horizonDays: 0 });
    expect(late.some((p) => p.kind === "unconfirmed")).toBe(false);
  });
  it("counts against the follow-up budget so the rest of the cap stays for due reminders", () => {
    const meds: ReminderMedicine[] = [{ id: "a", active: true, spec: { ...base, kind: "daily", times: ["08:00"] } }];
    const plan = planDoseNotifications(meds, new Set(), now, { ...cfg, horizonDays: 3, maxFollowUps: 1 });
    expect(plan.filter((p) => p.kind === "unconfirmed")).toHaveLength(1);
    expect(plan.filter((p) => p.kind === "due").length).toBeGreaterThanOrEqual(3);
  });
  it("keeps the ios limit above the planner cap used on the phone", () => {
    expect(REMINDER_RELIABILITY_CONFIG.iosPendingLimit).toBe(64);
    expect(REMINDER_RELIABILITY_CONFIG.maxUnconfirmedFollowUpsPerDose).toBe(1);
  });
});

describe("reminder self-test", () => {
  const t0 = 1_000_000;
  it("is due after the delay and asks only after the answer window", () => {
    const rec = startSelfTest(t0);
    expect(rec.dueAtMs).toBe(t0 + 60_000);
    expect(selfTestStep(rec, t0 + 100_000)).toBe("wait");
    expect(selfTestStep(rec, t0 + 60_000 + 120_000)).toBe("ask");
    expect(selfTestOutcome(rec, t0 + 1)).toBe("pending");
    expect(selfTestOutcome(null, t0)).toBe("never_tested");
  });
  it("stores the answer and says working or needs help, then asks for a new test when old", () => {
    const rec = startSelfTest(t0);
    const saw = answerSelfTest(rec, "saw", t0 + 200_000);
    expect(selfTestStep(saw, t0 + 300_000)).toBe("done");
    expect(selfTestOutcome(saw, t0 + 300_000)).toBe("working");
    expect(selfTestOutcome(answerSelfTest(rec, "not_seen", t0 + 200_000), t0 + 300_000)).toBe("needs_help");
    expect(selfTestOutcome(saw, t0 + 200_000 + 31 * 86_400_000)).toBe("retest");
    expect(selfTestOutcome({ ...saw, answeredAtMs: null }, t0 + 31 * 86_400_000 + 1)).toBe("retest");
  });
  it("reads a stored record and treats anything malformed as no record", () => {
    const rec = answerSelfTest(startSelfTest(t0), "saw", t0 + 5);
    expect(parseSelfTest(JSON.stringify(rec))).toEqual(rec);
    expect(parseSelfTest(JSON.stringify(startSelfTest(t0)))).toEqual(startSelfTest(t0));
    expect(parseSelfTest(null)).toBeNull();
    expect(parseSelfTest("{nope")).toBeNull();
    expect(parseSelfTest("5")).toBeNull();
    expect(parseSelfTest("null")).toBeNull();
    expect(parseSelfTest(JSON.stringify({ ...rec, startedAtMs: "x" }))).toBeNull();
    expect(parseSelfTest(JSON.stringify({ ...rec, dueAtMs: null }))).toBeNull();
    expect(parseSelfTest(JSON.stringify({ ...rec, answer: "maybe" }))).toBeNull();
    expect(parseSelfTest(JSON.stringify({ ...rec, answeredAtMs: "x" }))).toBeNull();
  });
});

describe("notification permission guidance", () => {
  it("maps the states, including iPhone provisional", () => {
    expect(permissionState({ granted: true, canAskAgain: true, iosStatus: 3 })).toBe("provisional");
    expect(permissionState({ granted: true, canAskAgain: true })).toBe("allowed");
    expect(permissionState({ granted: false, canAskAgain: true, iosStatus: 0 })).toBe("undetermined");
    expect(permissionState({ granted: false, canAskAgain: true })).toBe("denied_can_ask");
    expect(permissionState({ granted: false, canAskAgain: false, iosStatus: 1 })).toBe("denied_settings");
  });
  it("asks when it still can, sends to Settings when it cannot, and is silent when allowed", () => {
    expect(permissionGuidance("allowed")).toEqual({ action: "none" });
    expect(permissionGuidance("undetermined").action).toBe("ask");
    expect(permissionGuidance("denied_can_ask").action).toBe("ask");
    expect(permissionGuidance("provisional")).toEqual({ action: "open_settings", messageKey: "reliability.permission.provisional" });
    expect(permissionGuidance("denied_settings")).toEqual({ action: "open_settings", messageKey: "reliability.permission.denied" });
  });
});

describe("dose reasons", () => {
  it("keeps ran out private and the others not", () => {
    expect(isPrivateDoseReason("ran_out")).toBe(true);
    expect(isPrivateDoseReason("side_effect")).toBe(false);
    expect(isPrivateDoseReason("nope")).toBe(false);
    expect(isPrivateDoseReason(null)).toBe(false);
    expect(doseReason("ran_out")?.status).toBe("not_available");
    expect(doseReason(undefined)).toBeNull();
    expect(DOSE_REASONS.filter((r) => r.private).map((r) => r.code)).toEqual(["ran_out"]);
  });
  it("shows a private reason to a supporter only after an opt-in for that exact reason, and never an unknown code", () => {
    expect(supporterMaySeeReason("ran_out", new Set())).toBe(false);
    expect(supporterMaySeeReason("ran_out", new Set(["other"]))).toBe(false);
    expect(supporterMaySeeReason("ran_out", new Set(["ran_out"]))).toBe(true);
    expect(supporterMaySeeReason("felt_well", new Set())).toBe(true);
    expect(supporterMaySeeReason("made_up", new Set(["made_up"]))).toBe(false);
  });
  it("offers the pharmacy page only for ran out, as an offer", () => {
    expect(shouldOfferPharmacy("ran_out")).toBe(true);
    expect(shouldOfferPharmacy("other")).toBe(false);
    expect(shouldOfferPharmacy(null)).toBe(false);
  });
});

describe("runway bar and stock freshness", () => {
  it("draws the bar from the existing days-left and offers the pharmacy page when close", () => {
    expect(runwayBar(null)).toBeNull();
    expect(runwayBar(-1)).toBeNull();
    expect(runwayBar(Number.NaN)).toBeNull();
    expect(runwayBar(45)).toEqual({ fraction: 1, tone: "ok", daysLeft: 45, offerCollect: false });
    expect(runwayBar(10.9)).toMatchObject({ tone: "soon", daysLeft: 10, offerCollect: true });
    expect(runwayBar(7)).toMatchObject({ tone: "low", offerCollect: true });
    expect(runwayBar(0)?.fraction).toBe(0);
  });
  it("never shows stock as available when the answer is older than the limit or from the future", () => {
    const n = Date.parse("2026-10-22T12:00:00Z");
    expect(stockLine(null, n)).toEqual({ kind: "unknown" });
    expect(stockLine(Number.NaN, n)).toEqual({ kind: "unknown" });
    expect(stockLine(n - 3_600_000, n).kind).toBe("confirmed");
    expect(stockLine(n - RUNWAY_CONFIG.maxStockAgeHours * 3_600_000, n).kind).toBe("confirmed");
    expect(stockLine(n - RUNWAY_CONFIG.maxStockAgeHours * 3_600_000 - 1, n).kind).toBe("ask_pharmacy");
    expect(stockLine(n + 1000, n).kind).toBe("ask_pharmacy");
  });
});

describe("NAFDAC helper", () => {
  it("accepts a 12 digit scratch code with spaces or dashes and nothing else", () => {
    expect(normaliseScratchCode("1234 5678-9012")).toBe("123456789012");
    expect(normaliseScratchCode("12345")).toBeNull();
    expect(normaliseScratchCode("12345678901a")).toBeNull();
  });
  it("builds a message link for the person to send, flagged unverified while the short code is", () => {
    const link = scratchCodeMessageLink("1234 5678 9012");
    expect(link).toEqual({ ok: true, uri: "sms:38353?&body=123456789012", unverified: true });
    expect(scratchCodeMessageLink("abc")).toEqual({ ok: false, reason: "bad_code" });
    const verified = { ...NAFDAC_HELPER_CONFIG, mas: { ...NAFDAC_HELPER_CONFIG.mas, verified: true } };
    expect(scratchCodeMessageLink("123456789012", verified)).toMatchObject({ unverified: false });
  });
  it("is hidden unless the guard is open", () => {
    expect(nafdacHelperVisible("open")).toBe(true);
    expect(nafdacHelperVisible("closed")).toBe(false);
    expect(nafdacHelperVisible("unknown")).toBe(false);
  });
});

describe("cappedPending", () => {
  it("holds iPhone under the 64 limit and leaves Android as configured", () => {
    expect(cappedPending(44, true)).toBe(44);
    expect(cappedPending(100, true)).toBe(56);
    expect(cappedPending(100, false)).toBe(100);
    expect(cappedPending(50, true, { iosPendingLimit: 40 }, 4)).toBe(36);
  });
});
