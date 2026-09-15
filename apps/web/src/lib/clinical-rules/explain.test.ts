import { describe, expect, it } from "@jest/globals";
import { renderExplanation } from "./explain";

describe("renderExplanation", () => {
  it("interpolates flat and nested-path tokens", () => {
    expect(renderExplanation("{{name}} is {{age}}", { name: "Ada", age: 30 })).toBe("Ada is 30");
    expect(
      renderExplanation("{{window.count}} readings over {{window.threshold}}", {
        window: { count: 3, threshold: 160 },
      })
    ).toBe("3 readings over 160");
  });

  it("renders a visible placeholder for a missing token rather than throwing or silently dropping it", () => {
    expect(renderExplanation("value: {{missing}}", {})).toBe("value: {{missing: unavailable}}");
  });

  it("treats null the same as missing", () => {
    expect(renderExplanation("{{x}}", { x: null })).toBe("{{x: unavailable}}");
  });

  it("does not choke on a template with no tokens", () => {
    expect(renderExplanation("plain text, no tokens", {})).toBe("plain text, no tokens");
  });

  it("stringifies non-string values", () => {
    expect(renderExplanation("{{flag}}", { flag: true })).toBe("true");
  });
});
