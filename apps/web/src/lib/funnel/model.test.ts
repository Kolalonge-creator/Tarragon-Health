import { FALLBACK_LABEL, parseCareFunnel, percent, perAlert } from "./model";

const good = {
  days: 30,
  since: "2026-09-15T00:00:00Z",
  alerts: 10,
  pages: 4,
  doctor_reviews: 7,
  emergencies: 1,
  ratios: { pages_per_alert: 0.4, reviews_per_alert: 0.7, emergencies_per_alert: 0.1 },
  continuity: { completed_with_lead: 5, handled_by_lead: 1, share: 0.2, completed_without_lead: 2, fallback_reasons: { lead_handed_back: 1, escalated: 1 } },
};

describe("care funnel model", () => {
  it("parses a good reply", () => {
    expect(parseCareFunnel(good)?.continuity.share).toBe(0.2);
  });
  it("accepts null ratios (no alerts, no tasks)", () => {
    const empty = { ...good, alerts: 0, ratios: { pages_per_alert: null, reviews_per_alert: null, emergencies_per_alert: null }, continuity: { ...good.continuity, share: null } };
    expect(parseCareFunnel(empty)).not.toBeNull();
  });
  it("refuses a malformed or error reply rather than showing partial numbers", () => {
    expect(parseCareFunnel({ error: "not authorised" })).toBeNull();
    expect(parseCareFunnel({ ...good, alerts: "10" })).toBeNull();
    expect(parseCareFunnel(null)).toBeNull();
  });
  it("formats shares and ratios", () => {
    expect(percent(0.2)).toBe("20%");
    expect(percent(0.3333)).toBe("33.3%");
    expect(percent(null)).toBe("No data yet");
    expect(perAlert(0.4)).toBe("0.40");
    expect(perAlert(null)).toBe("No alerts in this period");
  });
  it("names every fallback reason the database can return", () => {
    for (const reason of ["lead_handed_back", "lead_claim_expired", "escalated", "offer_not_taken"]) expect(FALLBACK_LABEL[reason]).toBeTruthy();
  });
});
