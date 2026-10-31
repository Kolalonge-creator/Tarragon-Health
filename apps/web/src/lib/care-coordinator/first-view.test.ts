import { coordinatorFirstView } from "./first-view";

describe("coordinatorFirstView", () => {
  it("leads with act-first tasks, then awaited results", () => {
    const v = coordinatorFirstView({ state: "ready", actFirst: 2, followUps: 4 });
    if (v.kind !== "items") throw new Error("expected items");
    expect(v.top.key).toBe("act-first");
    expect(v.top.text).toBe("2 outreach tasks are marked act-first");
    expect(v.rest.map((i) => i.key)).toEqual(["follow-ups"]);
  });

  it("leads with awaited results when nothing is act-first, using singular wording", () => {
    const v = coordinatorFirstView({ state: "ready", actFirst: 0, followUps: 1 });
    if (v.kind !== "items") throw new Error("expected items");
    expect(v.top.text).toBe("1 test result is still awaited");
    expect(v.rest).toEqual([]);
  });

  it("is clear only when the read arrived and both counts are zero", () => {
    expect(coordinatorFirstView({ state: "ready", actFirst: 0, followUps: 0 })).toEqual({ kind: "clear" });
  });

  it("never says clear when the read failed, even with no counts", () => {
    expect(coordinatorFirstView({ state: "failed", actFirst: undefined, followUps: undefined })).toEqual({
      kind: "unknown",
    });
  });

  it("a failure outranks any counts left over", () => {
    expect(coordinatorFirstView({ state: "failed", actFirst: 0, followUps: 0 })).toEqual({ kind: "unknown" });
  });

  it("keeps the numbers when a background refresh failed (stale)", () => {
    const v = coordinatorFirstView({ state: "stale", actFirst: 3, followUps: 0 });
    expect(v.kind).toBe("items");
  });

  it("waits while the read is loading, and does not call it clear", () => {
    expect(coordinatorFirstView({ state: "loading", actFirst: undefined, followUps: undefined })).toEqual({
      kind: "loading",
    });
  });
});
