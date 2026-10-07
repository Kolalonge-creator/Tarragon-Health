import { describe, expect, it } from "@jest/globals";
import { extractSafetyLines } from "./safety-lines";

describe("extractSafetyLines (S64, 15.4)", () => {
  it("puts allergy lines before medicine lines, whatever order the draft has them in", () => {
    const lines = extractSafetyLines({
      plan: "Start amlodipine 5 mg once daily. Review in two weeks.",
      history: "Reports a rash after penicillin, probable allergy. Headaches for three days.",
    });
    expect(lines.map((l) => [l.kind, l.section])).toEqual([
      ["allergy", "history"],
      ["medicine", "plan"],
    ]);
  });

  it("finds doses written without a space, and common medicine names", () => {
    const lines = extractSafetyLines({ plan: "Metformin 500mg twice daily.\nParacetamol when needed.\nDrink more water." });
    expect(lines.map((l) => l.text)).toEqual(["Metformin 500mg twice daily.", "Paracetamol when needed."]);
  });

  it("shows a line that mentions both an allergy and a medicine once, as an allergy", () => {
    const lines = extractSafetyLines({ history: "Allergic to ibuprofen." });
    expect(lines).toEqual([{ kind: "allergy", section: "history", text: "Allergic to ibuprofen." }]);
  });

  it("does not repeat the same line found in two sections", () => {
    expect(extractSafetyLines({ history: "No known allergies.", assessment: "No known allergies." })).toHaveLength(1);
  });

  it("returns nothing for a draft with neither, and ignores empty sections", () => {
    expect(extractSafetyLines({ history: "Cough for two days.", plan: "", assessment: undefined })).toEqual([]);
  });

  it("a plain statement that no allergies are known is still shown, because a wrong denial is the dangerous line", () => {
    expect(extractSafetyLines({ history: "Denies any drug allergy." }).map((l) => l.kind)).toEqual(["allergy"]);
  });

  it("also catches drugs it has no name for, by class ending and by a start/stop/switch with a frequency", () => {
    const lines = extractSafetyLines({ plan: "Start atorvastatin at night.\nSwitch to gliclazide twice daily.\nBook a review." });
    expect(lines.map((l) => l.text)).toEqual(["Start atorvastatin at night.", "Switch to gliclazide twice daily."]);
  });
});
