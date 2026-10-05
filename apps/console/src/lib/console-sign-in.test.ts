import { describe, expect, it } from "@jest/globals";
import type { UserRole } from "@tarragon/shared";
import { canSignInToConsole, resolveConsoleDestination } from "./console-sign-in";

describe("canSignInToConsole", () => {
  it("admits a role whose home is an extracted area", () => {
    expect(canSignInToConsole("ngo_admin")).toBe(true);
  });

  it("refuses a patient and every staff role whose area has not moved yet", () => {
    for (const role of ["patient", "clinician", "finance", "analyst", "pharmacist", "care_coordinator"] as UserRole[]) {
      expect(canSignInToConsole(role)).toBe(false);
    }
  });
});

describe("resolveConsoleDestination", () => {
  it("honours a same-area redirect", () => {
    expect(resolveConsoleDestination("ngo_admin", "/ngo?tab=roster")).toBe("/ngo?tab=roster");
  });

  it("falls back to the role home for an open-redirect attempt", () => {
    expect(resolveConsoleDestination("ngo_admin", "//evil.example")).toBe("/ngo");
    expect(resolveConsoleDestination("ngo_admin", "https://evil.example")).toBe("/ngo");
  });

  it("falls back to the role home for a path the role may not open", () => {
    expect(resolveConsoleDestination("ngo_admin", "/clinician")).toBe("/ngo");
    expect(resolveConsoleDestination("ngo_admin", "/login")).toBe("/ngo");
  });

  it("falls back to the role home when nothing was asked for", () => {
    expect(resolveConsoleDestination("ngo_admin", null)).toBe("/ngo");
    expect(resolveConsoleDestination("ngo_admin", "")).toBe("/ngo");
  });
});
