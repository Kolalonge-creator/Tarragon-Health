import { assessMaleFertility } from "./male-fertility-assessment";

describe("assessMaleFertility", () => {
  it("does not suggest analysis before 6 months with no risk factors", () => {
    expect(
      assessMaleFertility({ tryingToConceiveMonths: 5, riskFactors: [], priorSemenAnalysis: "none" })
    ).toEqual({ semenAnalysisSuggested: false });
  });

  it("suggests analysis at 6 months with a risk factor present", () => {
    expect(
      assessMaleFertility({
        tryingToConceiveMonths: 6,
        riskFactors: ["smoking"],
        priorSemenAnalysis: "none",
      })
    ).toEqual({ semenAnalysisSuggested: true });
  });

  it("suggests analysis at 12 months regardless of risk factors", () => {
    expect(
      assessMaleFertility({ tryingToConceiveMonths: 12, riskFactors: [], priorSemenAnalysis: "none" })
    ).toEqual({ semenAnalysisSuggested: true });
  });

  it("never re-suggests once a result is already on file or pending", () => {
    for (const priorSemenAnalysis of ["normal", "abnormal", "pending"] as const) {
      expect(
        assessMaleFertility({ tryingToConceiveMonths: 24, riskFactors: ["smoking"], priorSemenAnalysis })
      ).toEqual({ semenAnalysisSuggested: false });
    }
  });
});
