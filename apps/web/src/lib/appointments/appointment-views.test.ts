import { cancelOutcomeLines, HISTORY_STATUSES, CHANGEABLE_STATUSES } from "./appointment-views";

const NOW = Date.parse("2026-11-10T10:00:00Z");
const at = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();
const terms = { cancel_window_hours: 2, late_cancel_credit_returned: false };

describe("cancelOutcomeLines", () => {
  it("returns the credit for a paid consultation cancelled in time", () => {
    const lines = cancelOutcomeLines({ consultationMethod: "telemedicine", paymentStatus: "paid", scheduledFor: at(5), nowMs: NOW, terms });
    expect(lines.join(" ")).toMatch(/visit credit comes back/);
  });

  it("says the credit is kept back for a late cancel, and that rescheduling keeps it", () => {
    const lines = cancelOutcomeLines({ consultationMethod: "telemedicine", paymentStatus: "paid", scheduledFor: at(1), nowMs: NOW, terms });
    expect(lines.join(" ")).toMatch(/less than 2 hours before the visit, so the visit credit is not returned\. Rescheduling keeps it/);
  });

  it("returns the credit late when the policy says so", () => {
    const lines = cancelOutcomeLines({
      consultationMethod: "telemedicine",
      paymentStatus: "paid",
      scheduledFor: at(1),
      nowMs: NOW,
      terms: { ...terms, late_cancel_credit_returned: true },
    });
    expect(lines.join(" ")).toMatch(/visit credit comes back/);
  });

  it("charges nothing for an unpaid visit and never mentions a refund", () => {
    const lines = cancelOutcomeLines({ consultationMethod: "telemedicine", paymentStatus: "pending", scheduledFor: at(1), nowMs: NOW, terms });
    expect(lines.join(" ")).toMatch(/nothing is charged/);
    expect(lines.join(" ")).not.toMatch(/refund/i);
  });

  it("says the rule could not be loaded rather than guessing", () => {
    const lines = cancelOutcomeLines({ consultationMethod: "telemedicine", paymentStatus: "paid", scheduledFor: at(1), nowMs: NOW, terms: null });
    expect(lines.join(" ")).toMatch(/could not load the cancellation rule/);
  });

  it("leaves a paid non-consultation to the care team", () => {
    const lines = cancelOutcomeLines({ consultationMethod: "in_person", paymentStatus: "paid", scheduledFor: at(48), nowMs: NOW, terms });
    expect(lines.join(" ")).toMatch(/care team will tell you/);
  });
});

describe("view statuses", () => {
  it("never lists a rescheduled row in any history view", () => {
    expect(Object.values(HISTORY_STATUSES).flat()).not.toContain("rescheduled");
  });

  it("matches the statuses cancel_appointment and reschedule_appointment accept", () => {
    expect([...CHANGEABLE_STATUSES]).toEqual(["held", "booked", "confirmed"]);
  });
});
