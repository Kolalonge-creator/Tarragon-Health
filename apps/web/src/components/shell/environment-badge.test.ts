import { describe, expect, it } from "@jest/globals";
import { environmentBadgeLabel } from "./environment-badge";

describe("environmentBadgeLabel", () => {
  it("draws nothing on production, even when built in development mode", () => {
    expect(environmentBadgeLabel("production", "production")).toBeNull();
    expect(environmentBadgeLabel("production", "development")).toBeNull();
  });
  it("labels a preview deployment", () => {
    expect(environmentBadgeLabel("preview", "production")).toBe("Preview: test environment");
  });
  it("labels local development with or without the Vercel variable", () => {
    expect(environmentBadgeLabel("development", "development")).toBe("Local development");
    expect(environmentBadgeLabel(undefined, "development")).toBe("Local development");
  });
  it("draws nothing for an unknown build with no signal", () => {
    expect(environmentBadgeLabel(undefined, "production")).toBeNull();
  });
});
