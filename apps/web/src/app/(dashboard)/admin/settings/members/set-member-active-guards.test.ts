/**
 * setMemberActiveAction() is the new /admin/settings/members control that
 * suspends or reinstates a staff/partner login (profiles.is_active), which
 * 20260925093444_enforce_profiles_is_active_in_core_authz.sql made a real
 * RLS-level access boundary (private.is_org_staff/is_admin/has_permission all
 * gate on it now) rather than a cosmetic badge. Two hard-stop guards exist
 * specifically because this action can lock a real person out of the whole
 * platform: an admin can't suspend their own account, and the platform's
 * last remaining active Super Admin can't be suspended by anyone (there
 * would be nobody left holding is_admin()/users.suspend to undo it). This
 * proves both guards actually block the write, that an ordinary suspend/
 * reinstate still goes through, and — a sabotage control — that the
 * last-admin guard is genuinely reading the live count rather than always
 * refusing.
 */

jest.mock("@/lib/auth/permissions", () => ({
  hasPermission: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: jest.fn().mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", organisation_id: "org-1" }),
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const profilesUpdate = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return { update: (vals: unknown) => ({ eq: (_col: string, id: string) => profilesUpdate(vals, id) }) };
    },
  }),
}));

let targetRole = "clinician";
let activeAdminCountExcludingTarget = 0;
const auditInsert = jest.fn().mockResolvedValue({ error: null });

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: (table: string) => {
      if (table === "audit_log") return { insert: auditInsert };
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.count) {
            // The last-active-admin count query: .select(...).eq().eq().neq()
            const chain = {
              eq: () => chain,
              neq: () => Promise.resolve({ count: activeAdminCountExcludingTarget }),
            };
            return chain;
          }
          // The target's own role lookup: .select("role").eq().single()
          const chain = {
            eq: () => chain,
            single: () => Promise.resolve({ data: { role: targetRole } }),
          };
          return chain;
        },
      };
    },
  })),
}));

import { setMemberActiveAction } from "./actions";

function formDataFor(memberId: string, active: boolean) {
  const fd = new FormData();
  fd.set("memberId", memberId);
  fd.set("active", active ? "true" : "false");
  return fd;
}

describe("setMemberActiveAction — lockout guards", () => {
  beforeEach(() => {
    profilesUpdate.mockReset().mockResolvedValue({ error: null });
    auditInsert.mockReset().mockResolvedValue({ error: null });
    targetRole = "clinician";
    activeAdminCountExcludingTarget = 0;
  });

  it("refuses to suspend your own account", async () => {
    const result = await setMemberActiveAction(undefined, formDataFor("11111111-1111-4111-8111-111111111111", false));

    expect(result?.error).toBe("You can't suspend your own account.");
    expect(profilesUpdate).not.toHaveBeenCalled();
  });

  it("refuses to suspend the last remaining active Super Admin", async () => {
    targetRole = "admin";
    activeAdminCountExcludingTarget = 0; // no OTHER active admin would remain

    const result = await setMemberActiveAction(undefined, formDataFor("22222222-2222-4222-8222-222222222222", false));

    expect(result?.error).toBe("Can't suspend the last remaining active Super Admin.");
    expect(profilesUpdate).not.toHaveBeenCalled();
  });

  it("SABOTAGE: allows suspending an admin when another active admin remains", async () => {
    targetRole = "admin";
    activeAdminCountExcludingTarget = 1; // a real fellow admin stays active

    const result = await setMemberActiveAction(undefined, formDataFor("22222222-2222-4222-8222-222222222222", false));

    expect(result?.message).toBe("Login suspended.");
    expect(profilesUpdate).toHaveBeenCalledWith({ is_active: false }, "22222222-2222-4222-8222-222222222222");
  });

  it("suspends a non-admin member and records the audit entry", async () => {
    targetRole = "clinician";

    const result = await setMemberActiveAction(undefined, formDataFor("22222222-2222-4222-8222-222222222222", false));

    expect(result?.message).toBe("Login suspended.");
    expect(profilesUpdate).toHaveBeenCalledWith({ is_active: false }, "22222222-2222-4222-8222-222222222222");
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "member.suspended", entity_id: "22222222-2222-4222-8222-222222222222" })
    );
  });

  it("reinstates a suspended login without consulting the admin-count guard", async () => {
    const result = await setMemberActiveAction(undefined, formDataFor("22222222-2222-4222-8222-222222222222", true));

    expect(result?.message).toBe("Login reinstated.");
    expect(profilesUpdate).toHaveBeenCalledWith({ is_active: true }, "22222222-2222-4222-8222-222222222222");
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "member.reinstated", entity_id: "22222222-2222-4222-8222-222222222222" })
    );
  });
});
