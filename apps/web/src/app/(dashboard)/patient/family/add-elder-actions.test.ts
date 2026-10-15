/**
 * OQ-47 (S04b-1): adding an adult who has not agreed to anything must not hand the proxy their health information.
 * Pinned here: the grant written for the new record carries payments only (never a clinical permission), and a number
 * that already has an account is refused so the person keeps control through the two-sided request flow.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const getCurrentProfileMock = jest.fn();
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => getCurrentProfileMock() }));

const foundProfile = { current: null as { id: string; full_name: string } | null };
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: () => ({ maybeSingle: async () => ({ data: foundProfile.current }) }),
  }),
}));

const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    auth: { admin: { createUser: async () => ({ data: { user: { id: "elder-1" } }, error: null }) } },
    rpc: async () => ({ error: null }),
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return { error: null };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({ eq: () => ({ single: async () => ({ data: { phone: "+2348000000000" } }) }) }),
    }),
  }),
}));

import { addElderProxyDependentAction } from "./add-elder-actions";

const INPUT = {
  full_name: "Chief Okafor",
  phone: "+2348031234567",
  relationship: "father",
  date_of_birth: "1948-03-02",
  confirmed_consent: true,
};

beforeEach(() => {
  inserts.length = 0;
  foundProfile.current = null;
  getCurrentProfileMock.mockReset().mockResolvedValue({ id: "proxy-1", organisation_id: "org-1", full_name: "Ada Okafor" });
});

describe("addElderProxyDependentAction", () => {
  it("grants payments only: no clinical permission before the adult has agreed", async () => {
    const result = await addElderProxyDependentAction(INPUT);
    expect(result).toMatchObject({ profileId: "elder-1" });
    const grant = inserts.find((i) => i.table === "profile_access");
    expect(grant?.row).toMatchObject({ profile_id: "elder-1", grantee_user_id: "proxy-1", permissions: ["manage_payments"] });
    const permissions = grant?.row.permissions as string[];
    for (const clinical of ["view_medication", "view_results", "view_care_plan", "view_appointments", "communicate_with_care_team"]) {
      expect(permissions).not.toContain(clinical);
    }
  });

  it("does not tell the proxy they can book, log or manage care for the person", async () => {
    const result = await addElderProxyDependentAction(INPUT);
    expect("message" in result && result.message).toMatch(/pay for their care/);
    expect("message" in result && result.message).toMatch(/say yes on their own phone/);
  });

  it("refuses a number that already has an account", async () => {
    foundProfile.current = { id: "someone", full_name: "Chief Okafor" };
    const result = await addElderProxyDependentAction(INPUT);
    expect(result).toMatchObject({ error: expect.stringContaining("already has a Tarragon account") });
    expect(inserts).toHaveLength(0);
  });
});
