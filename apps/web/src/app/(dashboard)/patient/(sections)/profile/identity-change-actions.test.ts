/**
 * P21: a name or date-of-birth change is a REQUEST for staff to verify (data_correction_requests), never a direct edit of the profile.
 * Input is validated before the database is asked; a supporter acting for someone is refused; a failed write is never reported as sent.
 */
const insert = jest.fn();
const fromCalls: string[] = [];
const profileRead = jest.fn();
const getCurrentUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      fromCalls.push(table);
      if (table === "profiles") return { select: () => ({ eq: () => ({ maybeSingle: () => profileRead() }) }) };
      return { insert: (row: unknown) => insert(table, row) };
    },
  }),
  getCurrentUser: () => getCurrentUser(),
}));
const getActingFor = jest.fn();
jest.mock("@/lib/acting/acting-for", () => ({ getActingFor: () => getActingFor() }));
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { requestIdentityChangeAction } from "./identity-change-actions";
import { identityChangeSchema } from "./identity-change";

function fd(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

beforeEach(() => {
  insert.mockReset();
  insert.mockResolvedValue({ error: null });
  profileRead.mockReset();
  profileRead.mockResolvedValue({ data: { organisation_id: "org1" }, error: null });
  getCurrentUser.mockReset();
  getCurrentUser.mockResolvedValue({ id: "u1" });
  getActingFor.mockReset();
  getActingFor.mockResolvedValue(null);
  revalidatePath.mockReset();
  fromCalls.length = 0;
});

describe("requestIdentityChangeAction", () => {
  it("opens a correction request for a name change, and never touches the profile row", async () => {
    const r = await requestIdentityChangeAction(undefined, fd({ field: "full_name", newValue: "  Adaeze Okafor  ", reason: "Married name" }));
    expect(r).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith("data_correction_requests", {
      organisation_id: "org1",
      patient_id: "u1",
      record_description: "Name on my account",
      what_is_wrong: "Married name",
      requested_change: "Adaeze Okafor",
    });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/patient/privacy");
  });

  it("a date of birth change with no reason gets a plain default line", async () => {
    await requestIdentityChangeAction(undefined, fd({ field: "date_of_birth", newValue: "1971-03-14" }));
    expect(insert).toHaveBeenCalledWith("data_correction_requests", expect.objectContaining({
      record_description: "Date of birth on my account",
      what_is_wrong: "I would like my date of birth changed.",
      requested_change: "1971-03-14",
    }));
  });

  it("refuses bad input without asking the database", async () => {
    for (const bad of [
      { field: "role", newValue: "admin" },
      { field: "full_name", newValue: "A" },
      { field: "full_name", newValue: "" },
      { field: "date_of_birth", newValue: "14/03/1971" },
      { field: "date_of_birth", newValue: "1971-02-30" },
      { field: "date_of_birth", newValue: "2999-01-01" },
      { field: "date_of_birth", newValue: "1850-01-01" },
    ]) {
      expect(await requestIdentityChangeAction(undefined, fd(bad))).toEqual({ ok: false, error: "invalid" });
    }
    expect(fromCalls).toEqual([]);
  });

  it("refuses while a supporter is acting for someone, so nothing lands on the supporter's own record", async () => {
    getActingFor.mockResolvedValue({ profileId: "p2", fullName: "Mum" });
    expect(await requestIdentityChangeAction(undefined, fd({ field: "full_name", newValue: "Someone Else" }))).toEqual({ ok: false, error: "acting" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses when signed out", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect(await requestIdentityChangeAction(undefined, fd({ field: "full_name", newValue: "Ada Obi" }))).toEqual({ ok: false, error: "not_signed_in" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("never reports a failed write, or a failed profile read, as sent", async () => {
    insert.mockResolvedValue({ error: { message: "rls" } });
    expect(await requestIdentityChangeAction(undefined, fd({ field: "full_name", newValue: "Ada Obi" }))).toEqual({ ok: false, error: "failed" });
    profileRead.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await requestIdentityChangeAction(undefined, fd({ field: "full_name", newValue: "Ada Obi" }))).toEqual({ ok: false, error: "failed" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("identityChangeSchema", () => {
  it("accepts today and refuses tomorrow as a date of birth", () => {
    expect(identityChangeSchema("2026-11-07").safeParse({ field: "date_of_birth", newValue: "2026-11-07" }).success).toBe(true);
    expect(identityChangeSchema("2026-11-07").safeParse({ field: "date_of_birth", newValue: "2026-11-08" }).success).toBe(false);
  });
});
