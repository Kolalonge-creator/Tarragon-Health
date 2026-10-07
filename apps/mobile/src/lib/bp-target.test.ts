import { __reset, __seedRaw } from "../test/mocks/async-storage";
import { loadBpTarget, toServerTarget, toTarget } from "./bp-target";

let mockResult: { data: unknown; error: { message: string } | null } | "throw" = { data: null, error: null };
const mockSelected: string[] = [];
let mockRpcResult: { data: unknown; error: { message: string; code?: string } | null } | "throw" = { data: null, error: { message: "x", code: "PGRST202" } };
const mockRpcCalls: string[] = [];

jest.mock("./supabase", () => ({
  supabase: {
    rpc: async (name: string) => {
      mockRpcCalls.push(name);
      if (mockRpcResult === "throw") throw new Error("Network request failed");
      return mockRpcResult;
    },
    from: () => {
      const q: Record<string, unknown> = {
        select: (cols: string) => (mockSelected.push(cols), q),
        eq: () => q,
        maybeSingle: async () => {
          if (mockResult === "throw") throw new Error("Network request failed");
          return mockResult;
        },
      };
      return q;
    },
  },
}));

const ROW = { home_systolic: 130, home_diastolic: 80, set_by: "staff-1", updated_at: "2026-09-30T09:00:00Z" };

beforeEach(() => {
  __reset();
  mockResult = { data: null, error: null };
  mockSelected.length = 0;
  mockRpcCalls.length = 0;
  mockRpcResult = { data: null, error: { message: "Could not find the function public.my_home_bp_target", code: "PGRST202" } }; // not on the server yet
});

describe("toTarget", () => {
  it("maps the row, keeping who set it and when so the card can tell confirmed from not", () => {
    expect(toTarget(ROW)).toEqual({ systolicBelow: 130, diastolicBelow: 80, setBy: "staff-1", setAt: "2026-09-30T09:00:00Z" });
    expect(toTarget({ ...ROW, set_by: null })).toMatchObject({ setBy: null });
  });

  it("is null for no row or unusable numbers", () => {
    expect(toTarget(null)).toBeNull();
    expect(toTarget({ ...ROW, home_systolic: null })).toBeNull();
  });
});

describe("loadBpTarget", () => {
  it("reads only the four columns the card needs, never the free-text rationale", async () => {
    mockResult = { data: ROW, error: null };
    await loadBpTarget("u1", "p1");
    expect(mockSelected[0]).toBe("home_systolic, home_diastolic, set_by, updated_at");
    expect(mockSelected[0]).not.toMatch(/rationale/);
  });

  it("returns the target from the server", async () => {
    mockResult = { data: ROW, error: null };
    expect(await loadBpTarget("u1", "p1")).toMatchObject({ fromCache: false, target: { systolicBelow: 130 } });
  });

  it("returns null, not an invented target, when there is no row", async () => {
    expect(await loadBpTarget("u1", "p1")).toEqual({ target: null, fromCache: false });
  });

  it("falls back to the copy on the phone when the server cannot be reached", async () => {
    mockResult = { data: ROW, error: null };
    await loadBpTarget("u1", "p1");
    mockResult = "throw";
    expect(await loadBpTarget("u1", "p1")).toMatchObject({ fromCache: true, target: { systolicBelow: 130, diastolicBelow: 80 } });
    mockResult = { data: null, error: { message: "boom" } };
    expect(await loadBpTarget("u1", "p1")).toMatchObject({ fromCache: true, target: { systolicBelow: 130 } });
  });

  it("forgets a target the care team removed", async () => {
    mockResult = { data: ROW, error: null };
    await loadBpTarget("u1", "p1");
    mockResult = { data: null, error: null };
    await loadBpTarget("u1", "p1");
    mockResult = "throw";
    expect((await loadBpTarget("u1", "p1")).target).toBeNull();
  });

  it("never shows one account's cached target to another, or one person's to another", async () => {
    mockResult = { data: ROW, error: null };
    await loadBpTarget("u1", "p1");
    mockResult = "throw";
    expect((await loadBpTarget("u2", "p1")).target).toBeNull();
    expect((await loadBpTarget("u1", "p2")).target).toBeNull();
  });

  it("is null with nothing cached and no connection, and ignores a corrupt copy", async () => {
    mockResult = "throw";
    expect(await loadBpTarget("u1", "p1")).toEqual({ target: null, fromCache: true });
    __seedRaw("@tarragon/bp-target/v1:u1:p1", "{not json");
    expect((await loadBpTarget("u1", "p1")).target).toBeNull();
  });
});

describe("the server's own target (my_home_bp_target)", () => {
  const SERVER = { systolic: 125, diastolic: 78, source: "explicit", set_at: "2026-09-30T09:00:00Z" };

  it("maps an attributed explicit target to the care team's, and everything else to the standard starting target", () => {
    expect(toServerTarget(SERVER)).toMatchObject({ systolicBelow: 125, diastolicBelow: 78, origin: "care_team", setAt: "2026-09-30T09:00:00Z" });
    for (const source of ["explicit_unattributed", "derived_standard", "derived_high_risk", "something_new", null]) {
      expect(toServerTarget({ ...SERVER, source })).toMatchObject({ origin: "standard", setAt: null });
    }
    expect(toServerTarget(null)).toBeNull();
    expect(toServerTarget({ ...SERVER, systolic: null })).toBeNull();
  });

  it("asks the server for her own account and does not read the table", async () => {
    mockRpcResult = { data: [SERVER], error: null };
    const out = await loadBpTarget("u1", "u1");
    expect(mockRpcCalls).toEqual(["my_home_bp_target"]);
    expect(mockSelected).toEqual([]);
    expect(out).toMatchObject({ fromCache: false, target: { systolicBelow: 125, origin: "care_team" } });
  });

  it("labels the derived target as the standard one, not the care team's", async () => {
    mockRpcResult = { data: [{ systolic: 130, diastolic: 80, source: "derived_high_risk", set_at: null }], error: null };
    expect((await loadBpTarget("u1", "u1")).target).toMatchObject({ systolicBelow: 130, origin: "standard" });
  });

  it("does not use the function for someone else's account, which it cannot answer for", async () => {
    mockRpcResult = { data: [SERVER], error: null };
    mockResult = { data: ROW, error: null };
    const out = await loadBpTarget("u1", "p-other");
    expect(mockRpcCalls).toEqual([]);
    expect(out.target).toMatchObject({ systolicBelow: 130 });
    expect(out.target?.origin).toBeUndefined();
  });

  it("falls back to the explicit row when the function is not on the server yet", async () => {
    mockResult = { data: ROW, error: null };
    const out = await loadBpTarget("u1", "u1");
    expect(mockRpcCalls).toEqual(["my_home_bp_target"]);
    expect(mockSelected[0]).toBe("home_systolic, home_diastolic, set_by, updated_at");
    expect(out).toMatchObject({ fromCache: false, target: { systolicBelow: 130 } });
  });

  it("uses the copy on the phone, not the table, when the function fails for another reason", async () => {
    mockRpcResult = { data: [SERVER], error: null };
    await loadBpTarget("u1", "u1");
    mockRpcResult = { data: null, error: { message: "boom", code: "XX000" } };
    mockResult = { data: { ...ROW, home_systolic: 99 }, error: null };
    const out = await loadBpTarget("u1", "u1");
    expect(mockSelected).toEqual([]);
    expect(out).toMatchObject({ fromCache: true, target: { systolicBelow: 125, origin: "care_team" } });
    mockRpcResult = "throw";
    expect(await loadBpTarget("u1", "u1")).toMatchObject({ fromCache: true, target: { systolicBelow: 125 } });
  });

  it("keeps the label through the copy on the phone and never shows one account's copy to another", async () => {
    mockRpcResult = { data: [{ systolic: 135, diastolic: 85, source: "derived_standard", set_at: null }], error: null };
    await loadBpTarget("u1", "u1");
    mockRpcResult = "throw";
    expect((await loadBpTarget("u1", "u1")).target).toMatchObject({ origin: "standard" });
    expect((await loadBpTarget("u2", "u2")).target).toBeNull();
  });
});
