/**
 * Regression coverage for the admin/support "view as" feature
 * (20260922175144_support_view_as.sql, PR building the read-only support
 * debugging tool a 2026-09-18 admin/ops maturity audit found missing).
 *
 * Proves the page-guard mirror of the real DB authority: `admin` holds
 * support.view_as implicitly (isSuperAdmin short-circuit, same as every other
 * capability); a non-admin with no grant is refused; a non-admin with a
 * direct user_permission_grants row for exactly this key is admitted; and a
 * signed-out caller is refused. The real enforcement is
 * private.enforce_support_view_session_rules() in the database — this test
 * is for the page-level gate that decides whether to show the tool at all,
 * not a substitute for the DB-level proof in
 * packages/db/tests/support_view_as_sessions.sql.
 */

let currentUser: { id: string } | null = { id: "caller-1" };
let profileRow: { id: string; role: string; custom_role_id: string | null } | null = {
  id: "caller-1",
  role: "clinician",
  custom_role_id: null,
};
let grantRows: { permission_key: string }[] = [];
let rolePermissionRows: { permission_key: string }[] = [];

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockImplementation(async () => ({
    auth: {
      getUser: async () => ({ data: { user: currentUser } }),
    },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: profileRow }),
            }),
          }),
        };
      }
      if (table === "user_permission_grants") {
        return {
          select: () => ({
            eq: () => ({
              is: async () => ({ data: grantRows, error: null }),
            }),
          }),
        };
      }
      if (table === "role_permissions") {
        return {
          select: () => ({
            eq: async () => ({ data: rolePermissionRows, error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
  getCurrentUser: jest.fn(async () => currentUser),
}));

import { canStartSupportViewAs, hasPermission } from "./permissions";

describe("support.view_as permission gate", () => {
  beforeEach(() => {
    currentUser = { id: "caller-1" };
    profileRow = { id: "caller-1", role: "clinician", custom_role_id: null };
    grantRows = [];
    rolePermissionRows = [];
  });

  it("admits admin implicitly, without needing a grant row", async () => {
    profileRow = { id: "caller-1", role: "admin", custom_role_id: null };
    await expect(canStartSupportViewAs()).resolves.toBe(true);
  });

  it("refuses a non-admin with no support.view_as grant and no custom role", async () => {
    await expect(canStartSupportViewAs()).resolves.toBe(false);
  });

  it("admits a non-admin holding a direct support.view_as grant", async () => {
    grantRows = [{ permission_key: "support.view_as" }];
    await expect(canStartSupportViewAs()).resolves.toBe(true);
  });

  it("does not admit a non-admin holding an unrelated grant", async () => {
    grantRows = [{ permission_key: "support.manage" }];
    await expect(hasPermission("support.view_as")).resolves.toBe(false);
  });

  it("admits a non-admin whose custom role bundle carries support.view_as", async () => {
    profileRow = { id: "caller-1", role: "clinician", custom_role_id: "role-1" };
    rolePermissionRows = [{ permission_key: "support.view_as" }];
    await expect(canStartSupportViewAs()).resolves.toBe(true);
  });

  it("refuses a signed-out caller", async () => {
    currentUser = null;
    await expect(canStartSupportViewAs()).resolves.toBe(false);
  });

  it("SABOTAGE: proves the test actually discriminates — a revoked-looking grant set must not read as granted", async () => {
    // Same shape as the "admits a direct grant" case but for a DIFFERENT key —
    // if this passed as true, the earlier "refuses with no grant" assertion
    // would be meaningless (any non-empty grant list would pass regardless
    // of which key it names).
    grantRows = [{ permission_key: "finance.view" }];
    await expect(canStartSupportViewAs()).resolves.toBe(false);
  });
});
