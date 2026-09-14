/**
 * upsertEmployerContractAction() decides whether to UPDATE the employer's
 * existing active contract or INSERT a new one based on a lookup query. A
 * silently-swallowed error on that lookup used to fall through to the insert
 * branch, creating a second "active" corporate_contracts row instead of
 * updating the real one — a real, not just cosmetic, billing-reconciliation
 * risk. This proves a failed lookup now stops before either write runs.
 */

jest.mock("@/lib/auth/permissions", () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: jest.fn().mockResolvedValue({ id: "actor-1", organisation_id: "org-1" }),
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const insert = jest.fn();
const update = jest.fn();
const maybeSingle = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    from: (table: string) => {
      if (table !== "corporate_contracts") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({ maybeSingle }),
              }),
            }),
          }),
        }),
        insert,
        update: () => ({ eq: update }),
      };
    },
  }),
}));

import { upsertEmployerContractAction } from "./actions";

function formDataFor(organisationId: string) {
  const fd = new FormData();
  fd.set("organisationId", organisationId);
  fd.set("billingModel", "per_employee");
  fd.set("billingRateNaira", "5000");
  fd.set("billingInterval", "monthly");
  return fd;
}

describe("upsertEmployerContractAction — existing-contract lookup failure", () => {
  beforeEach(() => {
    insert.mockReset();
    update.mockReset();
    maybeSingle.mockReset();
  });

  it("does not insert a duplicate active contract when the lookup errors", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "RLS denied" } });

    const result = await upsertEmployerContractAction(
      undefined,
      formDataFor("11111111-1111-4111-8111-111111111111")
    );

    expect(result).toEqual({ error: "RLS denied" });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("still updates the existing contract when the lookup succeeds and finds one", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "contract-1" }, error: null });
    update.mockResolvedValue({ error: null });

    const result = await upsertEmployerContractAction(
      undefined,
      formDataFor("11111111-1111-4111-8111-111111111111")
    );

    expect(result?.error).toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });
});
