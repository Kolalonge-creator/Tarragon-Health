import { errorDetail, pushSetupMessage } from "./setup-result";

describe("pushSetupMessage", () => {
  it("names the step and the detail", () => {
    expect(pushSetupMessage({ ok: false, step: "subscribe", detail: "AbortError: Registration failed" })).toBe(
      "The browser would not create an alert subscription: AbortError: Registration failed",
    );
  });

  it("drops an empty detail and collapses whitespace", () => {
    expect(pushSetupMessage({ ok: false, step: "save", detail: "" })).toBe("Your subscription could not be saved");
    expect(pushSetupMessage({ ok: false, step: "save", detail: "no\n  organisation" })).toBe("Your subscription could not be saved: no organisation");
  });

  it("caps a long detail", () => {
    expect(pushSetupMessage({ ok: false, step: "save", detail: "x".repeat(500) }).length).toBeLessThan(200);
  });
});

describe("errorDetail", () => {
  it("includes a DOMException-style name", () => {
    const e = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    expect(errorDetail(e)).toBe("NotAllowedError: denied");
  });

  it("handles a plain Error, a string and anything else", () => {
    expect(errorDetail(new Error("boom"))).toBe("boom");
    expect(errorDetail("text")).toBe("text");
    expect(errorDetail(42)).toBe("unknown error");
  });
});
