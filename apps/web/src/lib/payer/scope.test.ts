jest.mock("server-only", () => ({}));

let role = "admin";
let replies: Record<string, { data: unknown; error: { message: string } | null }> = {};
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: async () => ({ role }) }));
jest.mock("@/lib/supabase/server", () => {
  const { fakeSupabase } = jest.requireActual("@/lib/institutions/fake-supabase");
  return { createClient: async () => fakeSupabase(replies) };
});

import { getPayerInsurerOptions, resolveSelectedInsurer } from "./scope";

const ok = (data: unknown) => ({ data, error: null });
const fails = { data: null, error: { message: "boom" } };

describe("payer scope", () => {
  beforeEach(() => {
    role = "admin";
    replies = {};
  });

  it("lists every insurer for a superadmin and picks the only one", async () => {
    replies = { insurers: ok([{ id: "i1", name: "Avon" }]) };
    expect((await resolveSelectedInsurer(undefined)).selected).toEqual({ id: "i1", name: "Avon" });
  });

  it("throws, rather than reporting 'no insurer is set up', when the read fails (superadmin)", async () => {
    replies = { insurers: fails };
    await expect(getPayerInsurerOptions()).rejects.toBeDefined();
  });

  it("throws when the seat read fails (payer admin)", async () => {
    role = "payer_admin";
    replies = { payer_administrators: fails };
    await expect(getPayerInsurerOptions()).rejects.toBeDefined();
  });

  it("returns the seat-holder's insurers when the read works", async () => {
    role = "payer_admin";
    replies = { payer_administrators: ok([{ insurer_id: "i1", insurers: { id: "i1", name: "Avon" } }]) };
    expect(await getPayerInsurerOptions()).toEqual([{ id: "i1", name: "Avon" }]);
  });
});
