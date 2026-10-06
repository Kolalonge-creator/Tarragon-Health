import { isTerminalWrittenQuestionError, mapWrittenQuestionError } from "./errors";

describe("mapWrittenQuestionError", () => {
  it("maps the three refusals by message", () => {
    expect(mapWrittenQuestionError("Written messages to your care team are part of Membership.")).toBe("wq.members_only");
    expect(mapWrittenQuestionError("Written questions are for adults. Please call.")).toBe("wq.adults_only");
    expect(mapWrittenQuestionError("You have used your written messages for this month.")).toBe("wq.allowance.none");
  });
  it("falls back to the generic message", () => {
    expect(mapWrittenQuestionError("network request failed")).toBe("wq.error.generic");
    expect(mapWrittenQuestionError(null)).toBe("wq.error.generic");
    expect(mapWrittenQuestionError(undefined)).toBe("wq.error.generic");
  });
  it("treats the three refusals as terminal and the generic one as retryable", () => {
    expect(isTerminalWrittenQuestionError("wq.members_only")).toBe(true);
    expect(isTerminalWrittenQuestionError("wq.error.generic")).toBe(false);
  });
});
