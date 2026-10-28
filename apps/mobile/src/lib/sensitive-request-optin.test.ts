import { describe, expect, it } from "@jest/globals";
import { sensitiveOptinView } from "./sensitive-request-optin";

describe("sensitiveOptinView (mobile)", () => {
  it("is hidden until the feature is available, unless the patient already opted in", () => {
    expect(sensitiveOptinView(null)).toBe("hidden");
    expect(sensitiveOptinView({ available: false, optedIn: false })).toBe("hidden");
    expect(sensitiveOptinView({ available: true, optedIn: false })).toBe("off");
    expect(sensitiveOptinView({ available: true, optedIn: true })).toBe("on");
    expect(sensitiveOptinView({ available: false, optedIn: true })).toBe("on");
  });
});
