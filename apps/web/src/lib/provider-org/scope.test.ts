jest.mock("server-only", () => ({}));

let role = "admin";
let replies: Record<string, { data: unknown; error: { message: string } | null }> = {};
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: async () => ({ role }) }));
jest.mock("@/lib/supabase/server", () => {
  const { fakeSupabase } = jest.requireActual("@/lib/institutions/fake-supabase");
  return { createClient: async () => fakeSupabase(replies) };
});

import { getProviderOrgOptions, resolveSelectedProviderOrg } from "./scope";

const ok = (data: unknown) => ({ data, error: null });
const fails = { data: null, error: { message: "boom" } };

describe("provider organisation scope", () => {
  beforeEach(() => {
    role = "admin";
    replies = {};
  });

  it("lists every provider organisation for a superadmin and picks the only one", async () => {
    replies = { provider_organisations: ok([{ organisation_id: "o1", display_name: null, legal_name: "Reddington" }]) };
    expect((await resolveSelectedProviderOrg(undefined)).selected).toEqual({ id: "o1", name: "Reddington" });
  });

  it("throws, rather than reporting 'no organisation is set up', when the read fails (superadmin)", async () => {
    replies = { provider_organisations: fails };
    await expect(getProviderOrgOptions()).rejects.toBeDefined();
  });

  it("throws when the seat read fails (staff)", async () => {
    role = "provider_org_staff";
    replies = { provider_org_members: fails };
    await expect(getProviderOrgOptions()).rejects.toBeDefined();
  });

  it("returns the staff member's organisations when the read works", async () => {
    role = "provider_org_staff";
    replies = { provider_org_members: ok([{ organisation_id: "o1", organisations: { name: "Reddington" } }]) };
    expect(await getProviderOrgOptions()).toEqual([{ id: "o1", name: "Reddington" }]);
  });
});
