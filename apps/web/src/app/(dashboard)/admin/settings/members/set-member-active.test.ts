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
 * The RPC now also scopes a delegated users.suspend holder to their own
 * organisation and writes the audit_log row itself, in the same transaction
 * (20261004194229_set_member_active_scope_and_audit.sql).
 *
 * This test covers the action's own remaining jobs: call the RPC with the
 * right arguments; surface an RPC-raised error as {error} WITHOUT reaching the
 * auth ban (the RPC is what authorises the caller); ban the auth user after a
 * suspend and lift the ban after a reinstate, so a still-valid session cannot
 * keep refreshing; and report a failed auth call honestly rather than as a
 * clean success. The audit row is the RPC's job and is no longer written here.
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

const updateUserById = jest.fn();
const auditInsert = jest.fn();

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: jest.fn(() => ({
    auth: { admin: { updateUserById } },
    from: (table: string) => {
      // The audit row is written by the RPC now; any TS-side write is a regression.
      if (table === "audit_log") return { insert: auditInsert };
      throw new Error(`unexpected table ${table}`);
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
    updateUserById.mockReset().mockResolvedValue({ error: null });
    auditInsert.mockReset();
  });

  it("calls set_member_active with the parsed member id and flag, then bans the auth user on a suspend", async () => {
    rpc.mockResolvedValue({ error: null });

    const result = await setMemberActiveAction(undefined, formDataFor(TARGET_ID, false));

    expect(rpc).toHaveBeenCalledWith("set_member_active", { p_member_id: TARGET_ID, p_active: false });
    expect(updateUserById).toHaveBeenCalledWith(TARGET_ID, { ban_duration: "876000h" });
    expect(result?.message).toBe("Login suspended.");
  });

  it("lifts the auth ban on a reinstate", async () => {
    rpc.mockResolvedValue({ error: null });

    const result = await setMemberActiveAction(undefined, formDataFor(TARGET_ID, true));

    expect(rpc).toHaveBeenCalledWith("set_member_active", { p_member_id: TARGET_ID, p_active: true });
    expect(updateUserById).toHaveBeenCalledWith(TARGET_ID, { ban_duration: "none" });
    expect(result?.message).toBe("Login reinstated.");
  });

  it("does not write the audit row itself any more (the RPC writes it in the same transaction)", async () => {
    rpc.mockResolvedValue({ error: null });
    await setMemberActiveAction(undefined, formDataFor(TARGET_ID, false));
    await setMemberActiveAction(undefined, formDataFor(TARGET_ID, true));
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it("surfaces a guard raised by the RPC (self-suspend, last admin, out of scope) as {error} and never reaches the auth ban", async () => {
    rpc.mockResolvedValue({ error: { message: "You can only suspend or reinstate members of your own organisation." } });

    const result = await setMemberActiveAction(undefined, formDataFor(TARGET_ID, false));

    expect(result?.error).toBe("You can only suspend or reinstate members of your own organisation.");
    expect(result?.message).toBeUndefined();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("an out-of-scope REINSTATE is refused by the RPC before any ban is lifted", async () => {
    rpc.mockResolvedValue({ error: { message: "Only a Super Admin can suspend or reinstate a Super Admin." } });

    const result = await setMemberActiveAction(undefined, formDataFor(TARGET_ID, true));

    expect(result?.error).toMatch(/Super Admin/);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("reports a failed ban honestly: the suspension is in effect, the session was not revoked, and it is not a clean success", async () => {
    rpc.mockResolvedValue({ error: null });
    updateUserById.mockResolvedValue({ error: { message: "auth unavailable" } });

    const result = await setMemberActiveAction(undefined, formDataFor(TARGET_ID, false));

    expect(result?.message).toBeUndefined();
    expect(result?.error).toMatch(/suspended and database access is blocked/i);
    expect(result?.error).toMatch(/auth unavailable/);
  });

  it("reports a failed unban on a reinstate as an error, since sign-in would still be blocked", async () => {
    rpc.mockResolvedValue({ error: null });
    updateUserById.mockResolvedValue({ error: { message: "auth unavailable" } });

    const result = await setMemberActiveAction(undefined, formDataFor(TARGET_ID, true));

    expect(result?.message).toBeUndefined();
    expect(result?.error).toMatch(/sign-in could not be re-enabled/i);
  });

  it("SABOTAGE: the ban is conditional on the RPC succeeding, not skipped unconditionally", async () => {
    rpc.mockResolvedValue({ error: null });
    await setMemberActiveAction(undefined, formDataFor(TARGET_ID, false));
    expect(updateUserById).toHaveBeenCalledTimes(1);
  });
});
