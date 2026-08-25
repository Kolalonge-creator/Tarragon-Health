import { describe, expect, it } from "@jest/globals";
import { rollupBiomarkerCategories } from "./biomarker-categories";

describe("rollupBiomarkerCategories", () => {
  it("returns every category as unreviewed (null status) with no orders", () => {
    const result = rollupBiomarkerCategories([]);
    expect(result).toHaveLength(4);
    expect(result.every((c) => c.status === null && c.reviewedCount === 0)).toBe(true);
  });

  it("marks a category good when its only reviewed order was normal", () => {
    const result = rollupBiomarkerCategories([
      { resultStatus: "normal", testCodes: ["creatinine", "urea"] }, // renal -> kidney
    ]);
    const kidney = result.find((c) => c.key === "kidney");
    expect(kidney).toMatchObject({ status: "good", reviewedCount: 1, needsAttentionCount: 0 });
    const heart = result.find((c) => c.key === "heart");
    expect(heart).toMatchObject({ status: null, reviewedCount: 0 });
  });

  it("marks a category needing attention on any non-normal reviewed order", () => {
    const result = rollupBiomarkerCategories([
      { resultStatus: "abnormal", testCodes: ["hba1c"] }, // glycaemic -> blood_sugar
    ]);
    const bloodSugar = result.find((c) => c.key === "blood_sugar");
    expect(bloodSugar).toMatchObject({ status: "needs_attention", needsAttentionCount: 1 });
  });

  it("never averages down: one abnormal among several normals still needs attention", () => {
    const result = rollupBiomarkerCategories([
      { resultStatus: "normal", testCodes: ["hba1c"] },
      { resultStatus: "normal", testCodes: ["fasting_glucose"] },
      { resultStatus: "critical", testCodes: ["hba1c"] },
    ]);
    const bloodSugar = result.find((c) => c.key === "blood_sugar");
    expect(bloodSugar).toMatchObject({ status: "needs_attention", reviewedCount: 3, needsAttentionCount: 1 });
  });

  it("a single order spanning two categories counts toward both", () => {
    // A panel covering both a renal and a lipid analyte in one order.
    const result = rollupBiomarkerCategories([
      { resultStatus: "borderline", testCodes: ["creatinine", "ldl_cholesterol"] },
    ]);
    expect(result.find((c) => c.key === "kidney")).toMatchObject({ status: "needs_attention" });
    expect(result.find((c) => c.key === "heart")).toMatchObject({ status: "needs_attention" });
  });

  it("ignores an analyte code with no known category mapping (e.g. haematology)", () => {
    const result = rollupBiomarkerCategories([{ resultStatus: "normal", testCodes: ["haemoglobin"] }]);
    expect(result.every((c) => c.reviewedCount === 0)).toBe(true);
  });
});
