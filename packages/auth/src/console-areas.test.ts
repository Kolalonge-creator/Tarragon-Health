import { describe, expect, it } from "@jest/globals";
import { CONSOLE_AREAS, consoleRoles, evaluateConsoleAccess, isConsolePath } from "./console-areas";
import { ROLE_HOME_PATH } from "./roles";
import type { UserRole } from "@tarragon/shared";

const ALL_ROLES = Object.keys(ROLE_HOME_PATH) as UserRole[];

describe("isConsolePath", () => {
  it("matches an extracted area and anything beneath it", () => {
    expect(isConsolePath("/ngo")).toBe(true);
    expect(isConsolePath("/ngo/roster")).toBe(true);
  });

  it("does not match a lookalike prefix or a non-extracted area", () => {
    expect(isConsolePath("/ngo-partners")).toBe(false);
    expect(isConsolePath("/clinician")).toBe(false);
    expect(isConsolePath("/patient")).toBe(false);
    expect(isConsolePath("/")).toBe(false);
  });
});

describe("consoleRoles", () => {
  it("is exactly the roles whose home is an extracted area, and never a patient", () => {
    const roles = consoleRoles();
    expect(roles).toContain("ngo_admin");
    expect(roles).not.toContain("patient");
    for (const role of roles) {
      expect(CONSOLE_AREAS.some((a) => ROLE_HOME_PATH[role] === a)).toBe(true);
    }
  });
});

describe("evaluateConsoleAccess", () => {
  it("lets a role open its own extracted home and nested pages", () => {
    expect(evaluateConsoleAccess("/ngo", "ngo_admin")).toEqual({ allowed: true });
    expect(evaluateConsoleAccess("/ngo/anything", "ngo_admin")).toEqual({ allowed: true });
  });

  it("lets the super admin traverse an extracted area for oversight", () => {
    expect(evaluateConsoleAccess("/ngo", "admin")).toEqual({ allowed: true });
  });

  it("refuses every other role, including a patient", () => {
    for (const role of ALL_ROLES) {
      if (role === "ngo_admin" || role === "admin") continue;
      expect(evaluateConsoleAccess("/ngo", role)).toEqual({
        allowed: false,
        reason: "role_not_permitted",
      });
    }
  });

  it("is default-deny for anything that has not been extracted", () => {
    for (const role of ALL_ROLES) {
      for (const path of ["/clinician", "/admin", "/patient", "/finance/ledger", "/login", "/"]) {
        expect(evaluateConsoleAccess(path, role)).toEqual({
          allowed: false,
          reason: "not_console_area",
        });
      }
    }
  });
});
