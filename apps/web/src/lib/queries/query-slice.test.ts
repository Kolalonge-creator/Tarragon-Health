import { fromQueryResult, sliceState, sliceText, sliceTile, unknownHint, type QuerySlice } from "./query-slice";

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

describe("sliceTile with its own wording for a figure with no value", () => {
  it("uses the caller's words only when the data was read", () => {
    const noValue = slice({ data: { n: null as number | null } });
    expect(sliceTile(noValue, (d) => d.n, "Not enough data yet")).toEqual({ empty: { hint: "Not enough data yet" } });
    // No data is never the caller's words: it is loading or could not be loaded.
    expect(sliceTile(slice<number>({ isLoading: true }), (n) => n, "Not enough data yet")).toEqual({ empty: { hint: "Loading…" } });
    expect(sliceTile(slice<number>({ isError: true }), (n) => n, "Not enough data yet")).toEqual({ empty: { hint: "Could not be loaded" } });
  });
});

describe("sliceText", () => {
  it("shows the read value, including a real zero", () => {
    expect(sliceText(slice({ data: 7 }), (n) => String(n))).toBe("7");
    expect(sliceText(slice({ data: 0 }), (n) => String(n))).toBe("0");
  });
  it("says the caller's words when the data has no value, and the default when none are given", () => {
    const noValue = slice({ data: { s: null as string | null } });
    expect(sliceText(noValue, (d) => d.s, "No open period")).toBe("No open period");
    expect(sliceText(noValue, (d) => d.s)).toBe("Not recorded");
  });
  it("shows the unknown hint, never a value, when there is no data", () => {
    expect(sliceText(slice<number>({ isLoading: true }), (n) => String(n))).toBe("Loading…");
    expect(sliceText(slice<number>({ isError: true }), (n) => String(n))).toBe("Could not be loaded");
    expect(sliceText(slice<number>({ data: undefined, isError: true }), (n) => String(n), "No open period")).toBe("Could not be loaded");
  });
});

describe("fromQueryResult", () => {
  const result = (r: { data?: number; isPending: boolean; isError: boolean }) => fromQueryResult({ data: r.data, isPending: r.isPending, isError: r.isError });

  it("reads a first read still in flight as loading", () => {
    expect(sliceState(result({ isPending: true, isError: false }))).toBe("loading");
  });
  it("reads a first read that failed as failed, and a failed refresh with data as stale", () => {
    expect(sliceState(result({ isPending: false, isError: true }))).toBe("failed");
    expect(sliceState(result({ data: 1, isPending: false, isError: true }))).toBe("stale");
  });
  it("reads a current read as ready", () => {
    expect(sliceState(result({ data: 1, isPending: false, isError: false }))).toBe("ready");
  });
  it("passes the data through untouched", () => {
    expect(result({ data: 0, isPending: false, isError: false }).data).toBe(0);
  });
});
