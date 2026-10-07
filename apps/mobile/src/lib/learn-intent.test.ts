import { requestLesson, takeRequestedLesson } from "./learn-intent";

describe("learn intent", () => {
  it("hands a requested lesson over once", () => {
    requestLesson("bpc_01");
    expect(takeRequestedLesson()).toBe("bpc_01");
    expect(takeRequestedLesson()).toBeNull();
  });
  it("is empty when nothing was requested", () => {
    expect(takeRequestedLesson()).toBeNull();
  });
});
