import { supabase } from "./supabase";
import { isOnWaitlist, setOnWaitlist } from "./feature-waitlist";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn() } } }));
const from = supabase.from as unknown as jest.Mock;
const getUser = supabase.auth.getUser as unknown as jest.Mock;

/** A thenable query builder: every chained call returns itself and awaiting it gives `result`. */
function chain(result: unknown) {
  const b: Record<string, unknown> = { then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res) };
  for (const m of ["select", "eq", "insert", "delete", "single", "maybeSingle"]) b[m] = () => b;
  return b;
}

describe("isOnWaitlist", () => {
  it("is true or false from the row, and null (unknown) when the read fails", async () => {
    from.mockReturnValueOnce(chain({ data: { id: "1" }, error: null }));
    expect(await isOnWaitlist("directory")).toBe(true);
    from.mockReturnValueOnce(chain({ data: null, error: null }));
    expect(await isOnWaitlist("directory")).toBe(false);
    from.mockReturnValueOnce(chain({ data: null, error: { message: "x" } }));
    expect(await isOnWaitlist("directory")).toBeNull();
  });
});

describe("setOnWaitlist", () => {
  it("joins for the signed-in patient, treating an existing row (23505) as joined", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    from.mockReturnValueOnce(chain({ data: { organisation_id: "o1" }, error: null })).mockReturnValueOnce(chain({ error: { code: "23505" } }));
    expect(await setOnWaitlist("community", true)).toBe(true);
  });
  it("fails (false) when not signed in, when the profile has no organisation, or on a real error", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });
    expect(await setOnWaitlist("community", true)).toBe(false);
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    from.mockReturnValueOnce(chain({ data: { organisation_id: null }, error: null }));
    expect(await setOnWaitlist("community", true)).toBe(false);
    from.mockReturnValueOnce(chain({ data: { organisation_id: "o1" }, error: null })).mockReturnValueOnce(chain({ error: { code: "42501" } }));
    expect(await setOnWaitlist("community", true)).toBe(false);
  });
  it("leaves the list", async () => {
    from.mockReturnValueOnce(chain({ error: null }));
    expect(await setOnWaitlist("community", false)).toBe(true);
    from.mockReturnValueOnce(chain({ error: { message: "x" } }));
    expect(await setOnWaitlist("community", false)).toBe(false);
  });
});
