import { describe, expect, it, jest } from "@jest/globals";

const mockEq = jest.fn();
const mockGetUser = jest.fn<() => Promise<{ data: { user: { id: string } | null } }>>();
jest.mock("./supabase", () => ({
  supabase: {
    auth: { getUser: () => mockGetUser() },
    from: () => ({ select: () => ({ eq: (...a: unknown[]) => { mockEq(...a); return { order: async () => ({ data: [], error: null }) }; } }) }),
  },
}));

import { loadMyTherapySessions } from "./therapy";

/** Regression (S56 review): since a Care Circle supporter with the mental_health consent can read the patient's therapy rows, "my sessions" must filter by the signed-in user. */
describe("loadMyTherapySessions", () => {
  it("asks for the signed-in user's own rows only", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "me" } } });
    const res = await loadMyTherapySessions();
    expect(res.ok).toBe(true);
    expect(mockEq).toHaveBeenCalledWith("patient_id", "me");
  });
  it("is an error, not an empty list, when nobody is signed in", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await loadMyTherapySessions();
    expect(res.ok).toBe(false);
  });
});
