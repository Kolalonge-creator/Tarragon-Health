import { whatHappensNext } from "./what-happens-next";

describe("whatHappensNext", () => {
  it("returns null for a resolved escalation", () => {
    expect(whatHappensNext("resolved", null)).toBeNull();
  });

  it("returns null for a referred escalation", () => {
    expect(whatHappensNext("referred", new Date(Date.now() + 3_600_000).toISOString())).toBeNull();
  });

  it("names a real due-by time for an open escalation with a future SLA", () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const result = whatHappensNext("open", future);
    expect(result).toMatch(/^Your care team aims to get back to you by /);
  });

  it("names a real due-by time for an under_review escalation with a future SLA", () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const result = whatHappensNext("under_review", future);
    expect(result).toMatch(/^Your care team aims to get back to you by /);
  });

  it("falls back to calm reassurance when the SLA has already breached", () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    expect(whatHappensNext("open", past)).toBe("Your care team is following up on this as a priority.");
  });

  it("falls back to calm reassurance when there is no SLA on record", () => {
    expect(whatHappensNext("open", null)).toBe("Your care team is following up on this as a priority.");
  });
});
