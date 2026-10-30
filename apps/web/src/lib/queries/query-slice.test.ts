import { sliceState, sliceTile, unknownHint, type QuerySlice } from "./query-slice";

const slice = <T,>(s: Partial<QuerySlice<T>>): QuerySlice<T> => ({
  data: undefined,
  isLoading: false,
  isError: false,
  ...s,
});

describe("sliceState", () => {
  it("separates loading, failed, stale and ready", () => {
    expect(sliceState(slice({ isLoading: true }))).toBe("loading");
    expect(sliceState(slice({ isError: true }))).toBe("failed");
    expect(sliceState(slice({ data: [1], isError: true }))).toBe("stale");
    expect(sliceState(slice({ data: [1] }))).toBe("ready");
  });

  it("counts a successful empty read, an empty list or null, as ready", () => {
    expect(sliceState(slice({ data: [] }))).toBe("ready");
    expect(sliceState(slice<null>({ data: null }))).toBe("ready");
  });
});

describe("unknownHint", () => {
  it("says loading until the read has failed", () => {
    expect(unknownHint(slice({ isLoading: true }))).toBe("Loading…");
    expect(unknownHint(slice({ isError: true }))).toBe("Could not be loaded");
  });
});

describe("sliceTile", () => {
  it("shows the read value, including a real zero", () => {
    expect(sliceTile(slice({ data: 7 }), (n) => n)).toEqual({ value: "7" });
    expect(sliceTile(slice({ data: 0 }), (n) => n)).toEqual({ value: "0" });
  });

  it("shows a hint, never a value, when there is no data", () => {
    expect(sliceTile(slice<number>({ isLoading: true }), (n) => n)).toEqual({ empty: { hint: "Loading…" } });
    expect(sliceTile(slice<number>({ isError: true }), (n) => n)).toEqual({ empty: { hint: "Could not be loaded" } });
  });

  it("says not recorded when the data has no value for this figure", () => {
    expect(sliceTile(slice({ data: { n: null as number | null } }), (d) => d.n)).toEqual({
      empty: { hint: "Not recorded" },
    });
  });
});
