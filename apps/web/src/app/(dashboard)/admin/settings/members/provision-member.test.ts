/**
 * provisionMemberAction() creates the auth user through the service-role admin
 * API, and the handle_new_user trigger turns the metadata role / organisation
 * into the profile. The service role bypasses every database policy, so this
 * action's caller check is the only enforcement. Probed against production on
 * 2026-10-04: a login created with metadata `role: admin` becomes an admin
 * profile, and nothing here stopped a delegated users.provision holder asking
 * for one.
 *
 * What matters most is that a refusal happens BEFORE anything is created, so
 * every refusal case asserts createUser was never called.
 */

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

type Caller = { id: string; role: string; organisation_id: string | null };
const DELEGATE: Caller = { id: "33333333-3333-4333-8333-333333333333", role: "clinician", organisation_id: ORG_A };
const SUPER_ADMIN: Caller = { id: "44444444-4444-4444-8444-444444444444", role: "admin", organisation_id: null };

let caller: Caller = DELEGATE;

jest.mock("@/lib/auth/permissions", () => ({
  hasPermission: jest.fn().mockResolvedValue(true),
}));
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: jest.fn(async () => caller),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({}),
}));

const createUser = jest.fn();
const auditInsert = jest.fn();

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: jest.fn(() => ({
    auth: { admin: { createUser } },
    from: (table: string) => {
      if (table === "audit_log") return { insert: auditInsert };
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

import { provisionMemberAction } from "./actions";

function form(over: Record<string, string> = {}) {
  const fd = new FormData();
  const base: Record<string, string> = {
    email: "new.person@example.test",
    fullName: "New Person",
    phone: "+2348012345678",
    role: "clinician",
    organisationId: ORG_A,
    password: "a-long-enough-password",
    ...over,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

describe("provisionMemberAction caller scope", () => {
  beforeEach(() => {
    caller = DELEGATE;
    createUser.mockReset().mockResolvedValue({ data: { user: { id: "55555555-5555-4555-8555-555555555555" } }, error: null });
    auditInsert.mockReset().mockResolvedValue({ error: null });
  });

  describe("a delegated users.provision holder", () => {
    it("cannot create a Super Admin login, and nothing is created", async () => {
      const result = await provisionMemberAction(undefined, form({ role: "admin", organisationId: ORG_A }));

      expect(result?.error).toMatch(/Super Admin/);
      expect(createUser).not.toHaveBeenCalled();
      expect(auditInsert).not.toHaveBeenCalled();
    });

    it("cannot create a Super Admin login with no organisation either", async () => {
      const result = await provisionMemberAction(undefined, form({ role: "admin", organisationId: "" }));

      expect(result?.error).toMatch(/Super Admin/);
      expect(createUser).not.toHaveBeenCalled();
    });

    it("cannot create a login in another organisation", async () => {
      const result = await provisionMemberAction(undefined, form({ organisationId: ORG_B }));

      expect(result?.error).toMatch(/own organisation/);
      expect(createUser).not.toHaveBeenCalled();
    });

    it("cannot create a login with no organisation", async () => {
      const result = await provisionMemberAction(undefined, form({ organisationId: "" }));

      expect(result?.error).toMatch(/organisation/i);
      expect(createUser).not.toHaveBeenCalled();
    });

    it.each(["finance", "analyst", "pharmacist", "lab_partner", "corporate_admin"])(
      "cannot create a %s login even in their own organisation",
      async (role) => {
        const result = await provisionMemberAction(undefined, form({ role }));

        expect(result?.error).toMatch(/Super Admin/);
        expect(createUser).not.toHaveBeenCalled();
      }
    );

    it("can create a clinician in their own organisation, with exactly that role and organisation", async () => {
      const result = await provisionMemberAction(undefined, form({ role: "clinician", organisationId: ORG_A }));

      expect(result?.error).toBeUndefined();
      expect(createUser).toHaveBeenCalledTimes(1);
      expect(createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          app_metadata: { role: "clinician", organisation_id: ORG_A },
        })
      );
      expect(auditInsert).toHaveBeenCalledWith(
        expect.objectContaining({ action: "member.provisioned", actor_id: DELEGATE.id })
      );
    });

    it("can create a care coordinator in their own organisation", async () => {
      const result = await provisionMemberAction(
        undefined,
        form({ role: "care_coordinator", phone: "", organisationId: ORG_A })
      );

      expect(result?.error).toBeUndefined();
      expect(createUser).toHaveBeenCalledTimes(1);
    });
  });

  describe("a Super Admin", () => {
    beforeEach(() => {
      caller = SUPER_ADMIN;
    });

    it("can still create a Super Admin login", async () => {
      const result = await provisionMemberAction(undefined, form({ role: "admin", organisationId: "" }));

      expect(result?.error).toBeUndefined();
      expect(createUser).toHaveBeenCalledWith(
        expect.objectContaining({ app_metadata: { role: "admin", organisation_id: null } })
      );
    });

    it("can still create a partner login with no organisation, and a login in any organisation", async () => {
      await provisionMemberAction(undefined, form({ role: "lab_partner", organisationId: "" }));
      await provisionMemberAction(undefined, form({ role: "clinician", organisationId: ORG_B }));

      expect(createUser).toHaveBeenCalledTimes(2);
    });
  });

  it("SABOTAGE: the identical Super Admin request is refused for a delegate and allowed for a Super Admin", async () => {
    const request = () => form({ role: "admin", organisationId: "" });

    caller = DELEGATE;
    const refused = await provisionMemberAction(undefined, request());
    expect(refused?.error).toBeDefined();
    expect(createUser).not.toHaveBeenCalled();

    caller = SUPER_ADMIN;
    const allowed = await provisionMemberAction(undefined, request());
    expect(allowed?.error).toBeUndefined();
    expect(createUser).toHaveBeenCalledTimes(1);
  });
});
