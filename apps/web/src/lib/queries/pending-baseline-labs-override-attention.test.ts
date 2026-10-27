jest.mock("server-only", () => ({}));
import { baselineLabsOverrideItem, readBaselineLabsOverrideAttention } from "./pending-baseline-labs-override-attention";

function client(res: { data: unknown; error: unknown } | "throw") {
  return {
    rpc: () => {
      if (res === "throw") throw new Error("boom");
      return Promise.resolve(res);
    },
  } as never;
}

describe("readBaselineLabsOverrideAttention", () => {
  it("reads the two counts", async () => {
    expect(await readBaselineLabsOverrideAttention(client({ data: { overdue: 2, used_30d: 5 }, error: null }))).toEqual({ overdue: 2, used30d: 5, failed: false });
  });
  it("says it failed on an error, a throw or a malformed answer, never nothing-outstanding", async () => {
    for (const r of [{ data: null, error: { code: "42501" } }, { data: { overdue: "x", used_30d: 1 }, error: null }, { data: null, error: null }, { data: { overdue: -1, used_30d: 0 }, error: null }, "throw" as const]) {
      expect(await readBaselineLabsOverrideAttention(client(r))).toMatchObject({ failed: true });
    }
  });
});

describe("baselineLabsOverrideItem", () => {
  it("is null with nothing overdue and a line with the counts otherwise", () => {
    expect(baselineLabsOverrideItem({ overdue: 0, used30d: 3, failed: false })).toBeNull();
    const one = baselineLabsOverrideItem({ overdue: 1, used30d: 1, failed: false });
    expect(one).toMatchObject({ key: "baseline_labs_override_followup", count: 1 });
    expect(one?.detail).toMatch(/1 medicine was started/);
    expect(baselineLabsOverrideItem({ overdue: 3, used30d: 7, failed: false })?.detail).toMatch(/3 medicines were started.*7 overrides used/);
  });
});
