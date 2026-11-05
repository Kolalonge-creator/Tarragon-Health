import { describe, expect, it } from "@jest/globals";
import { governedModelId } from "./model-id";

describe("governedModelId", () => {
  it("uses the approved model from configuration when there is one", () => {
    expect(governedModelId({ expected_model_identifier: "claude-sonnet-5-5" }, "claude-sonnet-5")).toBe(
      "claude-sonnet-5-5"
    );
  });

  it("falls back to the in-code model when nothing is approved", () => {
    expect(governedModelId({ expected_model_identifier: null }, "claude-haiku-4-5")).toBe("claude-haiku-4-5");
    expect(governedModelId({ expected_model_identifier: "   " }, "claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });

  it("falls back when there is no config at all (governance unreadable, fails open)", () => {
    expect(governedModelId(null, "claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(governedModelId(undefined, "claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  it("ignores an approved model from a different vendor rather than sending it to the wrong API", () => {
    expect(governedModelId({ expected_model_identifier: "voyage-3-large" }, "claude-sonnet-5")).toBe(
      "claude-sonnet-5"
    );
    expect(governedModelId({ expected_model_identifier: "tarragon-ml-service-0.1.0" }, "claude-haiku-4-5")).toBe(
      "claude-haiku-4-5"
    );
  });

  it("trims the approved identifier", () => {
    expect(governedModelId({ expected_model_identifier: " claude-haiku-4-5 " }, "claude-sonnet-5")).toBe(
      "claude-haiku-4-5"
    );
  });
});
