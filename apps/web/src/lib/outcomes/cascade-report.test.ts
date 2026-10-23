import { attributeLabel, isAwaitingSignature, isStageShown, parseCascadeReport, parseSelectionPanel, stageWithheldText } from "./cascade-report";
import { assertNoCausalWording, packRows } from "./pack";

const shown = (code: string, n: number, step: string | null) => ({ code, label: code, definition: "d", suppressed: false as const, n, pct_of_enrolled: 50, step_of: step, pct_of_step: step ? 50 : null });
const report = {
  condition: "hypertension", config_version: 1, minimum_cell: 20,
  total: {
    suppressed: false,
    stages: [shown("enrolled", 40, null), { code: "screened", label: "s", definition: "d", suppressed: true, reason: "small_difference", minimum: 20 }, shown("diagnosed", 30, "enrolled")],
    control_among_treated: [{ key: "controlled", suppressed: false, n: 12, pct_of_treated: 50 }, { key: "unknown", suppressed: false, n: 6, pct_of_treated: 25 }],
  },
  by_month_of_joining: [{ month: "2026-04-01", suppressed: true, reason: "under_minimum", minimum: 20 }],
  not_available: [{ item: "Prevalence", reason: "Not a population." }],
  note: "A cascade of Tarragon Members, not of a population.",
  difference_from_bp_outcome_reports: "The two measures can differ.",
  comparison_group: "none", not_a_causal_claim: true,
};

describe("parseCascadeReport", () => {
  it("reads a report where one stage is withheld and carries no number for it", () => {
    const r = parseCascadeReport(report);
    expect(r).not.toBeNull();
    if (!r || isAwaitingSignature(r) || r.total.suppressed) throw new Error("unexpected");
    const withheld = r.total.stages.filter((s) => !isStageShown(s));
    expect(withheld).toHaveLength(1);
    expect(JSON.stringify(withheld[0])).not.toMatch(/"n"/);
  });
  it("reads the unsigned reply as awaiting signature and nothing else", () => {
    const r = parseCascadeReport({ withheld: true, reason: "awaiting_cmo_signature", condition: "diabetes" });
    expect(r && isAwaitingSignature(r)).toBe(true);
  });
  it("refuses a reply that does not match (shown as not available, never half-rendered)", () => {
    expect(parseCascadeReport({ ...report, comparison_group: "yes" })).toBeNull();
    expect(parseCascadeReport(null)).toBeNull();
  });
  it("explains a withheld figure without hinting at a number", () => {
    expect(stageWithheldText("small_difference", 20)).toMatch(/smaller than 20/);
    expect(stageWithheldText("under_minimum", 20)).toMatch(/Fewer than 20/);
  });
  it("the cascade text passes the causal wording check", () => {
    expect(() => assertNoCausalWording(packRows(report as unknown as Record<string, unknown>))).not.toThrow();
  });
});

describe("parseSelectionPanel", () => {
  const cat = { category: "female", group_a: { suppressed: false, n: 9, pct: 50 }, group_b: { suppressed: true, reason: "small_cell" } };
  const panel = {
    config_version: 1, minimum_cell: 20, audience: "sponsor",
    who_is_in_the_figures: { suppressed: false, in_figures: 40 },
    eligible_roster: { available: false, reason: "Tarragon holds no list." },
    seats: { suppressed: false, seats_offered: 100, members_joined: 45, take_up_pct_of_seats: 45, note: "Seats are codes handed out." },
    comparisons: {
      in_figures_vs_other_members: { group_a_is: "a", group_b_is: "b", result: { suppressed: false, group_a_total: 40, group_b_total: 80, attributes: [{ attribute: "sex", categories: [cat] }] } },
      in_figures_vs_joined_not_agreed: { withheld: true, reason: "not_shown_to_sponsors" },
    },
    intent_to_treat_and_completers: {
      day_90: {
        day: 90, suppressed: false, everyone_who_joined: { suppressed: false, n: 40 }, day_not_due_yet: { suppressed: false, n: 0 },
        intent_to_treat: { suppressed: false, n: 40, controlled: 10, uncontrolled: 5, insufficient_data: 25, rate_strict_pct: 25, rate_among_measured_pct: 66.7, missing_pct: 62.5 },
        completers_only: { note: "n", rate_pct: 66.7 },
        missing_split: [{ key: "membership_ended", suppressed: false, n: 8 }, { key: "still_a_member_no_reading", suppressed: false, n: 17 }],
      },
    },
    note: "These comparisons are descriptive, not causal.", comparison_group: "none", not_a_causal_claim: true,
  };
  it("reads a sponsor-audience panel with missing shown beside the completers", () => {
    expect(parseSelectionPanel(panel)).not.toBeNull();
  });
  it("refuses a panel that drops the not-causal flag", () => {
    expect(parseSelectionPanel({ ...panel, not_a_causal_claim: false })).toBeNull();
  });
  it("labels attributes in plain words", () => {
    expect(attributeLabel("baseline_bp")).toBe("Blood pressure in the first week");
  });
  it("no key in the panel names a clinician", () => {
    expect(JSON.stringify(panel)).not.toMatch(/"[a-z_]*(clinician|doctor|tier|assigned)[a-z_]*"\s*:/);
  });
});
