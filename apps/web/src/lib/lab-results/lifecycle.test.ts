import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyteLabel,
  criticalCallsSchema,
  describeLifecycleError,
  formatWaiting,
  holdClockSchema,
  myTrendsSchema,
  reviewContextSchema,
  trendNoteSchema,
} from "./lifecycle";
import { LAB_FALLBACK_WORDING } from "./fallback-wording";
import { describe as describeInApp } from "@/lib/notifications/describe-in-app";
import { CORRECTION_KINDS } from "./structured";
import { t } from "@tarragon/i18n";

const id = "11111111-1111-4111-8111-111111111111";

describe("formatWaiting", () => {
  it("speaks in minutes, hours and days", () => {
    expect(formatWaiting(45)).toBe("45 min");
    expect(formatWaiting(60)).toBe("1 h");
    expect(formatWaiting(200)).toBe("3 h 20 min");
    expect(formatWaiting(60 * 49)).toBe("2 days 1 h");
    expect(formatWaiting(-5)).toBe("0 min");
  });
});

describe("the S27h parsers fail closed", () => {
  it("accepts the shapes the database returns", () => {
    expect(
      reviewContextSchema.safeParse({
        report_status: "preliminary",
        corrects_preliminary: false,
        delta_flags: [{ analyte_code: "creatinine", current: 1.8, previous: 1, previous_released_at: "2026-10-01T00:00:00Z", percent_change: 80, threshold_percent: 30 }],
        critical_call: null,
        hold: { received_at: "2026-10-16T00:00:00Z", expected_at: "2026-10-17T00:00:00Z", lead_escalated: false },
      }).success,
    ).toBe(true);
    expect(criticalCallsSchema.safeParse([{ call_id: id, lab_result_id: id, called_at: "x", due_at: "y", acknowledged_at: null, minutes_open: 3, overdue: false, my_role: "called", no_cover: false }]).success).toBe(true);
    expect(holdClockSchema.safeParse([]).success).toBe(true);
  });
  it("rejects a report status the database does not have, so an unknown state never reads as final", () => {
    expect(reviewContextSchema.safeParse({ report_status: "draft", corrects_preliminary: false, delta_flags: [], critical_call: null, hold: { received_at: "a", expected_at: "b", lead_escalated: false } }).success).toBe(false);
  });
  it("a trend carries values and dates only: a range or a flag is not part of the contract", () => {
    const row = { analyte_code: "creatinine", unit: "mg/dL", latest: { value: 1, released_at: "x" }, previous: { value: 0.9, released_at: "y" }, direction: "higher", note: null };
    expect(myTrendsSchema.safeParse([row]).success).toBe(true);
    expect(myTrendsSchema.safeParse([{ ...row, direction: "worse" }]).success).toBe(false);
    expect(Object.keys(myTrendsSchema.parse([row])[0]!.latest)).toEqual(["value", "released_at"]);
  });
});

describe("trend notes", () => {
  it("need 3 to 300 characters and a coded analyte", () => {
    expect(trendNoteSchema.safeParse({ resultId: id, analyte: "creatinine", note: "ok" }).success).toBe(false);
    expect(trendNoteSchema.safeParse({ resultId: id, analyte: "creatinine", note: "x".repeat(301) }).success).toBe(false);
    expect(trendNoteSchema.safeParse({ resultId: id, analyte: "Creatinine!", note: "A fine note" }).success).toBe(false);
    expect(trendNoteSchema.safeParse({ resultId: id, analyte: "creatinine", note: "A fine note" }).success).toBe(true);
  });
});

describe("words", () => {
  it("the direction words never judge", () => {
    for (const k of ["labtrend.higher", "labtrend.lower", "labtrend.same", "labtrend.intro"] as const) expect(t(k, "en")).not.toMatch(/better|worse|bad|good|improv|risk/i);
  });
  it("labels an analyte without underscores", () => {
    expect(analyteLabel("total_cholesterol")).toBe("total cholesterol");
  });
  it("maps the stable error codes and falls back for the rest", () => {
    expect(describeLifecycleError({ message: "boom lab_trend_note_length" })).toMatch(/300/);
    expect(describeLifecycleError({ message: "lab_result_preliminary_not_releasable" })).toMatch(/preliminary/);
    expect(describeLifecycleError({ message: "unknown" })).toBe("That did not work. Please try again.");
  });
  it("finalised is a correction kind the partner portal can send", () => {
    expect(CORRECTION_KINDS).toContain("finalised");
  });
});

describe("the fallback wording the CMO signs is the wording the patient sees", () => {
  it("is pinned to the in-app notice, and names no test, value or condition", () => {
    const text = describeInApp({ template: "lab_result_contact_us", payload: {} }).text;
    expect(text).toBe(LAB_FALLBACK_WORDING.v1);
    expect(LAB_FALLBACK_WORDING.v1).not.toMatch(/hiv|hepatitis|positive|reactive|result|test|screen|blood|value/i);
  });
  it("the migration's in-app template body carries the same sentence, so the signature covers every copy the patient can see", () => {
    const dir = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");
    const file = readdirSync(dir).find((f) => f.endsWith("_s27h_lab_lifecycle_and_quality.sql"));
    const sql = readFileSync(join(dir, file ?? ""), "utf8");
    const body = /\('lab_result_contact_us', 'en', 'in_app', '[^']*', '([^']+)'\)/.exec(sql)?.[1] ?? "";
    expect(body).toBe(`${LAB_FALLBACK_WORDING.v1}.`);
  });
  it("the sender renderer carries the same sentence", () => {
    const src = readFileSync(join(__dirname, "..", "..", "..", "..", "..", "supabase", "functions", "send-pending-notifications", "templates.ts"), "utf8");
    const block = /lab_result_contact_us: \(\) => \(\{\s*smsText: "([^"]+)"/.exec(src)?.[1] ?? "";
    expect(block).toContain("Your care team would like to speak with you.");
    expect(block).toContain("send them a message when you can");
  });
});

describe("no code in the S27h lifecycle path releases a result", () => {
  it("the lifecycle actions call no release, disclosure or withhold function", () => {
    const src = readFileSync(join(__dirname, "lifecycle-actions.ts"), "utf8");
    expect(src).not.toMatch(/release_lab_result|record_lab_disclosure\b|withhold_lab_result/);
  });
});
