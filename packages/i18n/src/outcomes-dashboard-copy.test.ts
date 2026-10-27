import { describe, expect, it } from "@jest/globals";
import { outcomesDashboardCopy, outcomesDashText } from "./outcomes-dashboard-copy";
import { en, t } from "./index";

const entries = Object.entries(outcomesDashboardCopy);

// The same word list private.causal_wording_hits checks in the database (S75c), applied here to EVERY sentence with no negation exception:
// this page has no sentence that needs one.
const CAUSAL = /\b(caused|causes|causing|because of the programme|due to the programme|as a result of the programme|thanks to the programme|led to|leads to|resulted in|results in|attributable to|attributed to|proves|proved|proven|demonstrates that|demonstrated that|saved|savings|return on investment|roi|prevented|reduced the risk|impact of the programme|improved because)\b/i;
// wording that could be lifted into marketing
const MARKETING = /\b(improv\w*|reduc\w*|boost\w*|cure\w*|transform\w*|guarantee\w*|breakthrough|clinically proven|doctor-led)\b/i;

describe("outcomes dashboard copy", () => {
  it("is part of the English catalogue under outcomes.dash.*", () => {
    expect(t("outcomes.dash.title")).toBe("Engagement and outcomes");
    expect(Object.keys(en).filter((k) => k.startsWith("outcomes.dash.")).length).toBe(entries.length);
  });

  it("has no em dash or en dash, and never says 'your doctor'", () => {
    for (const [k, v] of entries) {
      expect(`${k}: ${v}`).not.toMatch(/[–—]/);
      expect(v.toLowerCase()).not.toContain("your doctor");
    }
  });

  it("makes no causal claim in any sentence", () => {
    for (const [k, v] of entries) expect([k, CAUSAL.test(v)]).toEqual([k, false]);
  });

  it("holds nothing that could be lifted into marketing", () => {
    for (const [k, v] of entries) expect([k, MARKETING.test(v)]).toEqual([k, false]);
  });

  it("always states that it is internal, that groups differ, and that a difference is an association and not proof", () => {
    expect(outcomesDashboardCopy["outcomes.dash.internal"]).toMatch(/internal only/i);
    expect(outcomesDashboardCopy["outcomes.dash.internal"]).toMatch(/not for employers, sponsors, insurers or HMOs/i);
    expect(outcomesDashboardCopy["outcomes.dash.internal"]).toMatch(/published|marketing/i);
    expect(outcomesDashboardCopy["outcomes.dash.caveat.selection"]).toMatch(/different from people who take part less/i);
    expect(outcomesDashboardCopy["outcomes.dash.caveat.selection"]).toMatch(/association/i);
    expect(outcomesDashboardCopy["outcomes.dash.caveat.association"]).toMatch(/not proof/i);
    expect(outcomesDashboardCopy["outcomes.dash.caveat.trial"]).toMatch(/differ from those who do not/i);
    expect(outcomesDashboardCopy["outcomes.dash.caveat.trial"]).not.toMatch(/illinois|randomised/i);
    expect(outcomesDashboardCopy["outcomes.dash.compare.note"]).toMatch(/regression to the mean/i);
    expect(outcomesDashboardCopy["outcomes.dash.caveat.measured"]).toMatch(/worst-case/i);
    expect(outcomesDashboardCopy["outcomes.dash.caveat.bp_excluded"]).toMatch(/check-ins/i);
  });

  it("keeps engagement and clinical outcomes as two separate panels and never offers a combined score", () => {
    expect(outcomesDashboardCopy["outcomes.dash.intro"]).toMatch(/never added together into one score/i);
    expect(outcomesDashboardCopy["outcomes.dash.engagement.title"]).toMatch(/engagement/i);
    expect(outcomesDashboardCopy["outcomes.dash.outcomes.title"]).toMatch(/clinical outcomes/i);
    for (const [k, v] of entries) expect([k, /\b(overall score|health index|composite|combined score|impact score)\b/i.test(v)]).toEqual([k, false]);
  });

  it("says plainly that held-back figures are held back, and calmly that data is not enough yet", () => {
    expect(outcomesDashboardCopy["outcomes.dash.not_enough"]).toMatch(/^Not enough data yet\./);
    expect(outcomesDashboardCopy["outcomes.dash.withheld_neighbour"]).toMatch(/subtraction/i);
  });

  it("fills placeholders and leaves a missing one visible", () => {
    expect(outcomesDashText("outcomes.dash.cut_at", { date: "2026-09-30" })).toBe("Outcome figures cover people due up to 2026-09-30.");
    expect(outcomesDashText("outcomes.dash.cut_at")).toContain("{date}");
    expect(outcomesDashText("outcomes.dash.compare.threshold", { n: 30 })).toBe("A group needs at least 30 people measured at both ends before it is shown.");
  });
});
