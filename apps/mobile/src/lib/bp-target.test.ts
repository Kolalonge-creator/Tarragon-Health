import { __reset, __seedRaw } from "../test/mocks/async-storage";
import { loadBpTarget, toTarget } from "./bp-target";

let mockResult: { data: unknown; error: { message: string } | null } | "throw" = { data: null, error: null };
const selected: string[] = [];

jest.mock("./supabase", () => ({
  supabase: {
    from: () => {
      const q: Record<string, unknown> = {
        select: (cols: string) => (selected.push(cols), q),
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
  selected.length = 0;
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
    expect(selected[0]).toBe("home_systolic, home_diastolic, set_by, updated_at");
    expect(selected[0]).not.toMatch(/rationale/);
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
