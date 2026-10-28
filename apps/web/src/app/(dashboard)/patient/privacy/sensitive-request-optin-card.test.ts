import { describe, expect, it } from "@jest/globals";
import { sensitiveOptinView } from "./sensitive-request-optin-card";

describe("sensitiveOptinView (web)", () => {
  it("is hidden until the feature is available, so a patient is never offered a switch that does nothing", () => {
    expect(sensitiveOptinView(undefined)).toBe("hidden");
    expect(sensitiveOptinView({ available: false, opted_in: false })).toBe("hidden");
  });
  it("shows the current choice once available", () => {
    expect(sensitiveOptinView({ available: true, opted_in: false })).toBe("off");
    expect(sensitiveOptinView({ available: true, opted_in: true })).toBe("on");
  });
  it("still lets a patient who opted in turn it off after the feature is withdrawn", () => {
    expect(sensitiveOptinView({ available: false, opted_in: true })).toBe("on");
  });
});
