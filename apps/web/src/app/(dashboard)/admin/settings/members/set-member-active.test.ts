/**
 * setMemberActiveAction() is the /admin/settings/members control that
 * suspends or reinstates a staff/partner login (profiles.is_active), which
 * 20260925093444_enforce_profiles_is_active_in_core_authz.sql made a real
 * RLS-level access boundary (private.is_org_staff/is_admin/has_permission all
 * gate on it now) rather than a cosmetic badge.
 *
 * The action's original implementation did the self-suspend guard, the
 * last-active-admin guard, and the actual write as three separate round
 * trips through the RLS-scoped client. A code review caught that the write
 * silently no-op'd (reported success, changed nothing) against any target
 * whose organisation_id is null — Super Admin peers and lab_partner/
 * payer_admin/provider_org_staff/ngo_admin accounts all are, by design — plus
 * a TOCTOU race in the last-admin guard and a fail-open on a swallowed lookup
 * error. All three guards + the write now live in one atomic, self-
 * authorizing SECURITY DEFINER RPC, public.set_member_active (see
 * 20260925100329_set_member_active_atomic_rpc.sql for that fix's own live,
 * rolled-back proof against real accounts).
 *
 * This test covers the action's own remaining job: call the RPC with the
 * right arguments, surface an RPC-raised error as {error} without touching
 * the audit log, and record the audit entry + revalidate only on success.
 */

jest.mock("@/lib/auth/permissions", () => ({
  hasPermission: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: jest
    .fn()
    .mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", organisation_id: "org-1" }),
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const rpc = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc }),
}));

const auditInsert = jest.fn().mockResolvedValue({ error: null });

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: (table: string) => {
      if (table !== "audit_log") throw new Error(`unexpected table ${table}`);
      return { insert: auditInsert };
    },
  })),
}));

import { setMemberActiveAction } from "./actions";

const TARGET_ID = "22222222-2222-4222-8222-222222222222";

function formDataFor(memberId: string, active: boolean) {
  const fd = new FormData();
  fd.set("memberId", memberId);
  fd.set("active", active ? "true" : "false");
  return fd;
}

describe("setMemberActiveAction", () => {
  beforeEach(() => {
    rpc.mockReset();
    auditInsert.mockReset().mockResolvedValue({ error: null });
  });

  it("calls set_member_active with the parsed member id and active flag, then records the audit entry", async () => {
    rpc.mockResolvedValue({ error: null });

    const result = await setMemberActiveAction(undefined, formDataFor(TARGET_ID, false));

    expect(rpc).toHaveBeenCalledWith("set_member_active", { p_member_id: TARGET_ID, p_active: false });
    expect(result?.message).toBe("Login suspended.");
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "member.suspended", entity_id: TARGET_ID })
    );
  });

  it("reinstates and records the corresponding audit action", async () => {
    rpc.mockResolvedValue({ error: null });

    const result = await setMemberActiveAction(undefined, formDataFor(TARGET_ID, true));

    expect(rpc).toHaveBeenCalledWith("set_member_active", { p_member_id: TARGET_ID, p_active: true });
    expect(result?.message).toBe("Login reinstated.");
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "member.reinstated", entity_id: TARGET_ID })
    );
  });

  it("surfaces a guard raised by the RPC (e.g. self-suspend, last-admin) as {error} and never records an audit entry", async () => {
    rpc.mockResolvedValue({ error: { message: "You can't suspend your own account." } });

    const result = await setMemberActiveAction(undefined, formDataFor(TARGET_ID, false));

    expect(result?.error).toBe("You can't suspend your own account.");
    expect(result?.message).toBeUndefined();
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it("SABOTAGE: proves the audit-skip is conditional on the RPC error, not always skipped", async () => {
    rpc.mockResolvedValue({ error: null });
    await setMemberActiveAction(undefined, formDataFor(TARGET_ID, false));
    expect(auditInsert).toHaveBeenCalledTimes(1);
  });
});
