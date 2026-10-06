import { nextGate, redFlagForQuestion } from "./red-flag";

describe("red-flag gate (offline, deterministic)", () => {
  it("catches a danger phrase in the question", () => {
    expect(redFlagForQuestion("I have chest pain when I walk", "")).toBe(true);
  });
  it("catches a danger phrase in the duration note, with a curly apostrophe", () => {
    expect(redFlagForQuestion("A question about my tablets", "since I can’t breathe well")).toBe(true);
  });
  it("lets an ordinary question through", () => {
    expect(redFlagForQuestion("Can I take my tablet with food?", "two weeks")).toBe(false);
  });
  it("holds the send until acknowledged, and never blocks a clear question", () => {
    expect(nextGate(true, false)).toBe("blocked");
    expect(nextGate(true, true)).toBe("acknowledged");
    expect(nextGate(false, false)).toBe("clear");
  });
});
