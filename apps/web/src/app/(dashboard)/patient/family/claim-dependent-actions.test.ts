/**
 * Security audit 2026-11-05, M-1: claimDependentAccountAction used to accept ANY 'view' grant, so a relative given
 * view access could attach their own phone to a dependant's login and sign in as that person. Now a 'view' grant
 * counts only when it is the guardian's own original grant (granted_by = themselves), which the 18th-birthday job
 * stepped down from 'manage'.
 */

const parent = { id: "parent-1", organisation_id: "org-1" };
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: jest.fn(async () => parent) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

let grantRow: { id: string; permission_level: string; granted_by: string } | null = null;
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    from: (table: string) => {
      if (table === "profile_access") {
        const chain = { select: () => chain, eq: () => chain, in: () => chain, maybeSingle: async () => ({ data: grantRow }) };
        return chain;
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({
          data: { full_name: "Ada", is_dependent_account: true, dependent_kind: "minor_child", majority_review_at: "2026-11-01" },
        }),
      };
      return chain;
    },
    rpc: () => ({ maybeSingle: async () => ({ data: null }) }),
  })),
}));

const updateUserById = jest.fn(async () => ({ error: null }));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    auth: { admin: { updateUserById } },
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }), insert: async () => ({ error: null }) }),
  }),
}));

import { claimDependentAccountAction } from "./claim-dependent-actions";

const input = { dependent_id: "33333333-3333-4333-8333-333333333333", phone: "+2348012345678" };

describe("claimDependentAccountAction: who may claim", () => {
  beforeEach(() => updateUserById.mockClear());

  it("refuses a view-level relative whose grant someone else gave them", async () => {
    grantRow = { id: "g1", permission_level: "view", granted_by: "someone-else" };
    expect(await claimDependentAccountAction(input)).toEqual({ error: "You don't have access to this record" });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("allows the original guardian after the 18th-birthday step-down to view", async () => {
    grantRow = { id: "g1", permission_level: "view", granted_by: parent.id };
    const result = await claimDependentAccountAction(input);
    expect(result).not.toHaveProperty("error");
    expect(updateUserById).toHaveBeenCalledTimes(1);
  });

  it("allows a manage-level grantee", async () => {
    grantRow = { id: "g1", permission_level: "manage", granted_by: "someone-else" };
    const result = await claimDependentAccountAction(input);
    expect(result).not.toHaveProperty("error");
    expect(updateUserById).toHaveBeenCalledTimes(1);
  });

  it("refuses someone with no grant", async () => {
    grantRow = null;
    expect(await claimDependentAccountAction(input)).toEqual({ error: "You don't have access to this record" });
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
