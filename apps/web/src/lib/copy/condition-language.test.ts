import { describe, expect, it } from "@jest/globals";
import { obesityLabel, obesityLabelTitleCase } from "./condition-language";

describe("obesityLabel / obesityLabelTitleCase", () => {
  it("defaults to gentle wording when no preference is set", () => {
    expect(obesityLabel(null)).toBe("weight");
    expect(obesityLabel(undefined)).toBe("weight");
    expect(obesityLabelTitleCase(null)).toBe("Weight");
  });

  it("uses gentle wording explicitly", () => {
    expect(obesityLabel("gentle")).toBe("weight");
    expect(obesityLabelTitleCase("gentle")).toBe("Weight");
  });

  it("uses clinical wording when a patient opts in", () => {
    expect(obesityLabel("clinical")).toBe("obesity");
    expect(obesityLabelTitleCase("clinical")).toBe("Obesity");
  });
});
