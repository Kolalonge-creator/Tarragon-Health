/**
 * Security audit 2026-11-05, H-1: invitePayerAdminAction and inviteProviderOrgStaffAction used to
 * create a confirmed, privileged-role login BEFORE anything checked the caller's authority, and kept it
 * when the seat insert was then refused. These tests prove that:
 *   - a caller the pre-flight RPC refuses never reaches auth.admin.createUser;
 *   - a refused or failed pre-flight RPC is treated as "no";
 *   - when the seat insert is refused after the login was created, the login is deleted again.
 */

jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: jest.fn().mockResolvedValue({ id: "actor-1", organisation_id: "org-1" }),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const rpc = jest.fn();
const seatInsert = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockImplementation(async () => ({
    rpc,
    from: () => ({ insert: seatInsert }),
  })),
}));

const createUser = jest.fn();
const deleteUser = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ auth: { admin: { createUser, deleteUser } } }),
}));

import { invitePayerAdminAction } from "@/app/(dashboard)/payer/team/actions";
import { inviteProviderOrgStaffAction } from "@/app/(dashboard)/provider-org/staff/actions";

const INSURER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

function payerForm() {
  const fd = new FormData();
  fd.set("insurerId", INSURER);
  fd.set("email", "victim@example.com");
  fd.set("fullName", "Victim Person");
  fd.set("password", "attacker-chosen-1");
  fd.set("payerRole", "owner");
  return fd;
}

function providerForm() {
  const fd = new FormData();
  fd.set("organisationId", ORG);
  fd.set("email", "victim@example.com");
  fd.set("fullName", "Victim Person");
  fd.set("password", "attacker-chosen-1");
  fd.set("orgRole", "owner");
  return fd;
}

const cases = [
  { name: "invitePayerAdminAction", run: () => invitePayerAdminAction(undefined, payerForm()), fn: "can_manage_payer_seats", args: { p_insurer_id: INSURER } },
  { name: "inviteProviderOrgStaffAction", run: () => inviteProviderOrgStaffAction(undefined, providerForm()), fn: "can_manage_provider_org_seats", args: { p_organisation_id: ORG } },
];

describe.each(cases)("$name: authority is checked before a login is created", ({ run, fn, args }) => {
  beforeEach(() => {
    rpc.mockReset();
    seatInsert.mockReset();
    createUser.mockReset();
    deleteUser.mockReset();
  });

  it("refuses an unauthorised caller without creating any login", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const result = await run();
    expect(rpc).toHaveBeenCalledWith(fn, args);
    expect(result).toEqual({ error: "You don't have access to do that" });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("treats a failed pre-flight check as a refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await run();
    expect(result).toEqual({ error: "You don't have access to do that" });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("deletes the new login when the seat insert is refused", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    createUser.mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
    seatInsert.mockResolvedValue({ error: { message: "new row violates row-level security policy" } });
    const result = await run();
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith("new-user");
    expect(result).toEqual({ error: "new row violates row-level security policy" });
  });

  it("keeps the login when the seat is created", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    createUser.mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
    seatInsert.mockResolvedValue({ error: null });
    const result = await run();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(result).toEqual({ message: "Victim Person added." });
  });
});
