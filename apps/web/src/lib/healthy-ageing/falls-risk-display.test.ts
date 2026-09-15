import { fallsRiskDisplay } from "./falls-risk-display";

/**
 * The one thing worth locking down here: an ungraded falls risk must never
 * render as a reassuring green "Low". Everything else is labelling.
 */

describe("fallsRiskDisplay", () => {
  it("never presents an ungraded risk as low", () => {
    const display = fallsRiskDisplay({ riskLevel: null });
    expect(display.value).toBe("Awaiting review");
    expect(display.badge).toEqual({ text: "Awaiting review", variant: "grey" });
    expect(display.badge?.variant).not.toBe("green");
  });

  it("distinguishes 'nothing open' from 'open but ungraded'", () => {
    expect(fallsRiskDisplay(null)).toEqual({ value: "Not checked", badge: undefined });
    expect(fallsRiskDisplay({ riskLevel: null }).value).toBe("Awaiting review");
  });

  it("keeps the graded levels on the clinical status palette", () => {
    expect(fallsRiskDisplay({ riskLevel: "low" })).toEqual({
      value: "Low",
      badge: { text: "Low", variant: "green" },
    });
    expect(fallsRiskDisplay({ riskLevel: "moderate" })).toEqual({
      value: "Moderate",
      badge: { text: "Moderate", variant: "amber" },
    });
    expect(fallsRiskDisplay({ riskLevel: "high" })).toEqual({
      value: "High",
      badge: { text: "High", variant: "red" },
    });
  });
});
