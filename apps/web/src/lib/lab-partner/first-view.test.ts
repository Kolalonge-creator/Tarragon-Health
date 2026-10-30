import { labPartnerFirstView } from "./first-view";

const ok = { delayedFailed: false };

describe("labPartnerFirstView", () => {
  it("leads with delayed samples, then orders awaiting a result", () => {
    const v = labPartnerFirstView({ awaiting: 4, delayed: 2, ...ok });
    expect(v).toMatchObject({ kind: "items", incomplete: false });
    if (v.kind !== "items") throw new Error("expected items");
    expect(v.top.key).toBe("delayed");
    expect(v.top.text).toBe("2 samples are past turnaround");
    expect(v.rest.map((i) => i.key)).toEqual(["awaiting"]);
  });

  it("leads with awaiting orders when nothing is delayed, using singular wording", () => {
    const v = labPartnerFirstView({ awaiting: 1, delayed: 0, ...ok });
    if (v.kind !== "items") throw new Error("expected items");
    expect(v.top.text).toBe("1 order needs a result");
    expect(v.rest).toEqual([]);
  });

  it("is clear only when both counts are known and zero", () => {
    expect(labPartnerFirstView({ awaiting: 0, delayed: 0, ...ok })).toEqual({ kind: "clear" });
  });

  it("never says clear when the orders read failed", () => {
    expect(labPartnerFirstView({ awaiting: null, delayed: 0, ...ok })).toEqual({ kind: "unknown" });
  });

  it("never says clear when the sample counts failed", () => {
    expect(labPartnerFirstView({ awaiting: 0, delayed: undefined, delayedFailed: true })).toEqual({ kind: "unknown" });
  });

  it("marks a list incomplete when something showed but another source failed", () => {
    const v = labPartnerFirstView({ awaiting: 3, delayed: undefined, delayedFailed: true });
    expect(v).toMatchObject({ kind: "items", incomplete: true });
  });

  it("waits while the sample counts are only loading", () => {
    expect(labPartnerFirstView({ awaiting: 0, delayed: undefined, delayedFailed: false })).toEqual({ kind: "loading" });
  });

  it("a failure outranks loading", () => {
    expect(labPartnerFirstView({ awaiting: null, delayed: undefined, delayedFailed: false })).toEqual({ kind: "unknown" });
  });
});
