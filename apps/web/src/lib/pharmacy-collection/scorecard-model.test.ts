import { describe, expect, it } from "@jest/globals";
import { en } from "@tarragon/i18n";
import { flagKey, licenceTone, orderForReview, parseScorecard, type ScorecardRow } from "./scorecard-model";

const ID = "11111111-1111-4111-8111-111111111111";
const row = (over: Partial<ScorecardRow> = {}): ScorecardRow => ({
  partner_id: ID, partner_name: "A Pharmacy", is_active: true, work_state: "open", reason_codes: [], override_until: null, score: 90, suggestions: [], review_suggested: false,
  licence_state: "current", licence_expires_at: "2027-01-01T00:00:00Z", licence_days_left: 200, dispense_target_hours: 72, dispense_median_hours: 20, pct_within_target: 95,
  dispenses_measured: 12, sent_measured: 14, flags_raised: 1, out_of_stock_flags: 0, complaints_upheld: 0, complaints_open: 0, computed_at: "2026-10-16T05:45:00Z", ...over,
});

describe("pharmacy scorecard model (S28e, spec 21.7)", () => {
  it("reads a full answer and refuses a malformed one: an unreadable answer is a failed read, never an empty list", () => {
    expect(parseScorecard([row()])).toHaveLength(1);
    expect(parseScorecard(null)).toBeNull();
    expect(parseScorecard([{ partner_id: ID }])).toBeNull();
    expect(parseScorecard("none")).toBeNull();
  });
  it("every suggestion code the database can raise has its own sentence, and an unknown one is still shown", () => {
    for (const code of ["licence_expired", "licence_expiring", "complaints_upheld_limit", "dispense_turnaround_slow", "out_of_stock_often", "score_below_floor"]) {
      expect(flagKey(code)).not.toBe("pharmscore.review");
      expect(en[flagKey(code)]).toBeTruthy();
    }
    expect(flagKey("something_new")).toBe("pharmscore.review");
  });
  it("the wording says a flag is a suggestion and never claims a pharmacy was removed", () => {
    const text = [en["pharmscore.intro"], ...["licence_expired", "dispense_turnaround_slow", "out_of_stock_often"].map((c) => en[flagKey(c)])].join(" ");
    expect(en["pharmscore.intro"]).toMatch(/suggestion/i);
    expect(en["pharmscore.intro"]).toMatch(/you decide/i);
    expect(text).not.toMatch(/removed|suspended automatically|automatically/i);
    expect(text).not.toMatch(/[—–]/);
  });
  it("the licence reads red when expired, amber when close, grey with no date, green otherwise", () => {
    expect(licenceTone(row({ licence_state: "expired", licence_days_left: -3 }))).toBe("red");
    expect(licenceTone(row({ licence_state: "current", licence_days_left: -1 }))).toBe("red");
    expect(licenceTone(row({ licence_state: "expiring", licence_days_left: 10 }))).toBe("amber");
    expect(licenceTone(row({ licence_state: "unverified", licence_days_left: null }))).toBe("grey");
    expect(licenceTone(row({ licence_state: "current", licence_days_left: null }))).toBe("grey");
    expect(licenceTone(row())).toBe("green");
  });
  it("puts what needs a look first, then paused, then the rest by name", () => {
    const rows = [
      row({ partner_id: "a", partner_name: "Zed" }),
      row({ partner_id: "b", partner_name: "Beta", work_state: "suspended" }),
      row({ partner_id: "c", partner_name: "Cee", review_suggested: true, suggestions: ["out_of_stock_often"] }),
      row({ partner_id: "d", partner_name: "Alpha" }),
    ];
    expect(orderForReview(rows).map((r) => r.partner_name)).toEqual(["Cee", "Beta", "Alpha", "Zed"]);
    // the input is not changed
    expect(rows[0].partner_name).toBe("Zed");
  });
});
