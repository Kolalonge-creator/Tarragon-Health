import { describe, expect, it } from "@jest/globals";
import {
  getRoleHomePath,
  isPublicPath,
  isRoleHomePrefixed,
  pathMatchesRole,
} from "./roles";

describe("getRoleHomePath", () => {
  it("maps every role to its dashboard home", () => {
    expect(getRoleHomePath("patient")).toBe("/patient");
    expect(getRoleHomePath("clinician")).toBe("/clinician");
    expect(getRoleHomePath("doctor")).toBe("/doctor");
    expect(getRoleHomePath("admin")).toBe("/admin");
    expect(getRoleHomePath("hmo_admin")).toBe("/hmo");
    expect(getRoleHomePath("corporate_admin")).toBe("/corporate");
  });
});

describe("pathMatchesRole", () => {
  it("matches the exact home path", () => {
    expect(pathMatchesRole("/patient", "patient")).toBe(true);
  });

  it("matches nested paths under the home", () => {
    expect(pathMatchesRole("/clinician/worklist", "clinician")).toBe(true);
    expect(pathMatchesRole("/doctor/escalations", "doctor")).toBe(true);
  });

  it("rejects another role's path", () => {
    expect(pathMatchesRole("/admin", "patient")).toBe(false);
  });

  it("does not treat a prefix-sharing sibling as a match", () => {
    expect(pathMatchesRole("/patients-directory", "patient")).toBe(false);
  });
});

describe("isPublicPath", () => {
  it("allows the landing, login and signup pages", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/signup")).toBe(true);
  });

  it("allows anything under /auth/", () => {
    expect(isPublicPath("/auth/callback")).toBe(true);
  });

  it("rejects a protected dashboard path", () => {
    expect(isPublicPath("/patient")).toBe(false);
  });
});

describe("isRoleHomePrefixed", () => {
  it("recognises every role home and its sub-paths", () => {
    expect(isRoleHomePrefixed("/patient")).toBe(true);
    expect(isRoleHomePrefixed("/hmo/reports")).toBe(true);
    expect(isRoleHomePrefixed("/doctor")).toBe(true);
  });

  it("rejects public paths", () => {
    expect(isRoleHomePrefixed("/login")).toBe(false);
  });
});
