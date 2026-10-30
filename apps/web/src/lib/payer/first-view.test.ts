import { payerFirstView } from "./first-view";

const none = { preauthPending: 0, claimsToAdjudicate: 0, claimsToPay: 0 };

describe("payerFirstView", () => {
  it("leads with pre-authorisations, then claims to adjudicate, then claims to pay", () => {
    const v = payerFirstView({ preauthPending: 2, claimsToAdjudicate: 5, claimsToPay: 1 }, "ins-1");
    if (v.kind !== "items") throw new Error("expected items");
    expect(v.top.text).toBe("2 pre-authorisations are waiting for a decision");
    expect(v.rest.map((i) => i.key)).toEqual(["adjudicate", "pay"]);
    expect(v.incomplete).toBe(false);
  });

  it("uses singular wording", () => {
    const v = payerFirstView({ ...none, claimsToPay: 1 }, "ins-1");
    if (v.kind !== "items") throw new Error("expected items");
    expect(v.top.text).toBe("1 approved claim is waiting to be paid");
  });

  it("keeps the selected insurer on every link", () => {
    const v = payerFirstView({ preauthPending: 1, claimsToAdjudicate: 1, claimsToPay: 1 }, "a b/c");
    if (v.kind !== "items") throw new Error("expected items");
    const hrefs = [v.top, ...v.rest].map((i) => i.href);
    expect(hrefs).toEqual([
      "/payer/preauthorizations?insurer=a%20b%2Fc",
      "/payer/claims?insurer=a%20b%2Fc",
      "/payer/claims?insurer=a%20b%2Fc",
    ]);
  });

  it("is clear only when every queue was read and is empty", () => {
    expect(payerFirstView(none, "ins-1")).toEqual({ kind: "clear" });
  });

  it("never says clear when a queue read failed", () => {
    expect(payerFirstView({ ...none, claimsToPay: null }, "ins-1")).toEqual({ kind: "unknown" });
    expect(payerFirstView({ preauthPending: null, claimsToAdjudicate: null, claimsToPay: null }, "ins-1")).toEqual({
      kind: "unknown",
    });
  });

  it("marks a list incomplete when something showed but another queue failed", () => {
    const v = payerFirstView({ preauthPending: 3, claimsToAdjudicate: null, claimsToPay: 0 }, "ins-1");
    expect(v).toMatchObject({ kind: "items", incomplete: true });
  });
});
