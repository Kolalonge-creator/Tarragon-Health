import { describe, expect, it } from "@jest/globals";
import { formatWaiting, nextPollMs, pageHeadline, pagesNeedingAction, POLL_QUIET_MS, POLL_RINGING_MS } from "./alarm";
import { activePagesSchema, pagingOverviewSchema, READINESS_ITEMS, readinessOverviewSchema, myReadinessSchema, type ActivePage } from "./schemas";

const id = "11111111-1111-4111-8111-111111111111";
const page = (over: Partial<ActivePage> = {}): ActivePage => ({
  page_id: id, root_id: id, role: "primary", escalation_level: 0, sent_at: "2026-10-06T10:00:00Z", acknowledged_at: null, patient_id: id, seconds_waiting: 0, ...over,
});

describe("alarm logic", () => {
  it("rings only for pages nobody has acknowledged", () => {
    expect(pagesNeedingAction([page(), page({ acknowledged_at: "2026-10-06T10:01:00Z" })])).toHaveLength(1);
    expect(pagesNeedingAction([])).toEqual([]);
  });
  it("formats the waiting time and never goes negative", () => {
    expect(formatWaiting(0)).toBe("0 min 00 s");
    expect(formatWaiting(185)).toBe("3 min 05 s");
    expect(formatWaiting(-4)).toBe("0 min 00 s");
    expect(formatWaiting(61.9)).toBe("1 min 01 s");
  });
  it("says what is wanted without naming a patient or a reason (INV-07)", () => {
    for (const role of ["primary", "backup", "escalation"] as const) {
      expect(pageHeadline({ role, escalation_level: 0 })).not.toMatch(/blood|pressure|reading|result|glucose|symptom|hypertens|diabet/i);
    }
    expect(pageHeadline({ role: "escalation", escalation_level: 2 })).toMatch(/not been picked up/);
    expect(pageHeadline({ role: "backup", escalation_level: 1 })).toMatch(/Backup/);
    expect(pageHeadline({ role: "primary", escalation_level: 0 })).toMatch(/needs you now/);
  });
  it("asks more often while a page rings", () => {
    expect(nextPollMs(true)).toBe(POLL_RINGING_MS);
    expect(nextPollMs(false)).toBe(POLL_QUIET_MS);
    expect(POLL_RINGING_MS).toBeLessThan(POLL_QUIET_MS);
  });
});

describe("answers from the database are parsed, not trusted", () => {
  it("accepts a real list, including a level 2 row with no patient reference", () => {
    const parsed = activePagesSchema.parse([{ page_id: id, root_id: id, role: "escalation", escalation_level: 2, sent_at: "2026-10-06T10:00:00Z", acknowledged_at: null, patient_id: null, seconds_waiting: 700 }]);
    expect(parsed[0]?.patient_id).toBeNull();
  });
  it("refuses a role or level it does not know", () => {
    expect(activePagesSchema.safeParse([{ ...page(), role: "friend" }]).success).toBe(false);
    expect(activePagesSchema.safeParse([{ ...page(), escalation_level: 3 }]).success).toBe(false);
  });
  it("parses the overview", () => {
    expect(pagingOverviewSchema.parse([{ root_id: id, sent_at: "2026-10-06T10:00:00Z", no_cover: false, max_level: 2, acknowledged_at: null, acknowledged_by_name: null, closed_at: null, backup_paged_at: "2026-10-06T10:05:00Z", lead_alerted_at: "2026-10-06T10:10:00Z", seconds_waiting: 700 }])).toHaveLength(1);
    expect(pagingOverviewSchema.safeParse([{ root_id: "x" }]).success).toBe(false);
  });
});

describe("on-call readiness checklist (S19b)", () => {
  it("lists exactly the five items the database requires, each with wording", () => {
    expect(Object.keys(READINESS_ITEMS).sort()).toEqual(["battery_saving_off", "cover_plan", "data_and_power", "email_opens", "notifications_on"]);
    for (const text of Object.values(READINESS_ITEMS)) expect(text.length).toBeGreaterThan(20);
  });
  it("uses no clinical wording and no em dash (INV-07, copy rule)", () => {
    for (const text of Object.values(READINESS_ITEMS)) {
      expect(text).not.toMatch(/blood|pressure|reading|result|glucose|symptom|hypertens|diabet|\u2014/i);
    }
  });
  it("parses what the database returns", () => {
    expect(myReadinessSchema.parse({ version: 1, items: ["a"], confirmed_at: null, on_call_clinician: true }).confirmed_at).toBeNull();
    expect(readinessOverviewSchema.parse([{ clinician_id: id, name: "A", ready: false, confirmed_at: null }])).toHaveLength(1);
    expect(() => readinessOverviewSchema.parse([{ clinician_id: "x", name: "A", ready: false, confirmed_at: null }])).toThrow();
  });
});
