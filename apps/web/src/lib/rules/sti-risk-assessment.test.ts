import { scoreStiRiskCheck } from "./sti-risk-assessment";
import type { StiRiskCheckInput } from "@/lib/validation/sti-risk-check";

function baseInput(overrides: Partial<StiRiskCheckInput> = {}): StiRiskCheckInput {
  return {
    sexually_active_12mo: true,
    new_partner_3mo: false,
    partner_count_12mo: "1",
    condom_use: "always",
    symptoms: ["none"],
    prior_sti_diagnosis: false,
    partner_diagnosed_sti: false,
    ...overrides,
  };
}

describe("scoreStiRiskCheck", () => {
  it("short-circuits to low/no symptoms/no recommendations when not sexually active", () => {
    const result = scoreStiRiskCheck(
      baseInput({
        sexually_active_12mo: false,
        // Even a maximal-looking answer set must be ignored once this is false.
        partner_diagnosed_sti: true,
        symptoms: ["discharge", "pelvic_pain"],
      })
    );
    expect(result).toEqual({ riskLevel: "low", symptomFlag: false, recommendedScreenCodes: [] });
  });

  it("bands a clean, low-risk profile as low with no recommendations", () => {
    const result = scoreStiRiskCheck(baseInput());
    expect(result.riskLevel).toBe("low");
    expect(result.symptomFlag).toBe(false);
    expect(result.recommendedScreenCodes).toEqual([]);
  });

  it("bands a score of exactly 2 as moderate with the single-test recommendation", () => {
    // new_partner_3mo (+1) + condom_use never (+1) = 2.
    const result = scoreStiRiskCheck(
      baseInput({ new_partner_3mo: true, condom_use: "never" })
    );
    expect(result.riskLevel).toBe("moderate");
    expect(result.symptomFlag).toBe(false);
    expect(result.recommendedScreenCodes).toEqual(["hiv"]);
  });

  it("bands a score of exactly 3 as still moderate", () => {
    // partner_count_12mo 2_4 (+1) + condom_use never (+1) + prior_sti_diagnosis (+1) = 3.
    const result = scoreStiRiskCheck(
      baseInput({ partner_count_12mo: "2_4", condom_use: "never", prior_sti_diagnosis: true })
    );
    expect(result.riskLevel).toBe("moderate");
    expect(result.recommendedScreenCodes).toEqual(["hiv"]);
  });

  it("bands a score of exactly 4 as high with the full 3-test recommendation", () => {
    // partner_count_12mo 5_plus (+2) + condom_use never (+1) + new_partner_3mo (+1) = 4.
    const result = scoreStiRiskCheck(
      baseInput({ partner_count_12mo: "5_plus", condom_use: "never", new_partner_3mo: true })
    );
    expect(result.riskLevel).toBe("high");
    expect(result.symptomFlag).toBe(false);
    expect(result.recommendedScreenCodes).toEqual(["hiv", "hep_b", "hep_c"]);
  });

  it("forces at least moderate and the full recommendation list when a symptom is reported, regardless of an otherwise-zero point total", () => {
    const result = scoreStiRiskCheck(baseInput({ symptoms: ["discharge"] }));
    expect(result.symptomFlag).toBe(true);
    expect(result.riskLevel).toBe("moderate");
    expect(result.recommendedScreenCodes).toEqual(["hiv", "hep_b", "hep_c"]);
  });

  it("keeps the symptom flag independent of which non-'none' symptom(s) are picked", () => {
    const result = scoreStiRiskCheck(
      baseInput({ symptoms: ["pelvic_pain", "pain_during_sex"] })
    );
    expect(result.symptomFlag).toBe(true);
    expect(result.riskLevel).not.toBe("low");
  });

  it("never flags a symptom when only 'none' is selected", () => {
    const result = scoreStiRiskCheck(baseInput({ symptoms: ["none"] }));
    expect(result.symptomFlag).toBe(false);
  });
});
