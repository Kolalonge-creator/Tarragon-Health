import { describe, expect, it } from "@jest/globals";
import { dangerReportSchema, dangerSignsSummary } from "./emergency";

describe("dangerReportSchema", () => {
  it("accepts one or more known signs", () => {
    expect(dangerReportSchema.safeParse({ signs: ["chest_pain"] }).success).toBe(true);
    expect(
      dangerReportSchema.safeParse({ signs: ["chest_pain", "trouble_breathing"] }).success
    ).toBe(true);
  });

  it("rejects an empty selection", () => {
    expect(dangerReportSchema.safeParse({ signs: [] }).success).toBe(false);
  });

  it("rejects an unknown sign", () => {
    expect(dangerReportSchema.safeParse({ signs: ["stubbed_toe"] }).success).toBe(false);
  });
});

describe("dangerSignsSummary", () => {
  it("maps codes to human labels", () => {
    expect(dangerSignsSummary(["chest_pain", "seizure"])).toBe(
      "Chest pain or pressure, Seizure or convulsions"
    );
  });
});
