import { describe, expect, it } from "@jest/globals";
import { screeningRequestPhase } from "./prevention";

describe("screeningRequestPhase (mobile)", () => {
  it("mirrors the web states", () => {
    expect(screeningRequestPhase(undefined)).toBe("none");
    expect(screeningRequestPhase({ uploadCount: 0, doctorReviewed: false })).toBe("awaiting_result");
    expect(screeningRequestPhase({ uploadCount: 1, doctorReviewed: false })).toBe("result_received");
    expect(screeningRequestPhase({ uploadCount: 1, doctorReviewed: true })).toBe("reviewed");
  });
});
