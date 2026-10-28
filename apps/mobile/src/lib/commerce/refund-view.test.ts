import { describe, expect, it } from "@jest/globals";
import { en, t } from "@tarragon/i18n";
import { fallbackRefundPolicy, parseRefundPolicy } from "@tarragon/shared";
import { orderSplit, parseMyRefunds, refundRuleFor, refundTimingNote, REFUND_STEP_KEY } from "./refund-view";

const POLICY = parseRefundPolicy({ cooling_off_days: 10, membership_window_days: 30, decision_sla_days: 2, bank_days_min: 3, bank_days_max: 7, grace_days: 5 });

describe("refundRuleFor (A3): the phone quotes the web's numbers", () => {
  it("a Membership uses its own window and the answer time and bank days come from the policy", () => {
    const lines = refundRuleFor(POLICY, { kind: "membership" });
    expect(lines[0]).toEqual({ key: "refund.rule.window_membership", params: { days: 30 } });
    expect(lines[1]).toEqual({ key: "refund.rule.timing", params: { sla: 2, min: 3, max: 7 } });
    expect(t("refund.rule.timing", "en", { ...lines[1]!.params })).toBe("Your care team answers within 2 days. If it is approved, the money goes back to the card you paid with and usually reaches your bank in 3 to 7 business days. We message you at each step.");
  });
  it("any other item uses the cooling-off window; a pack adds the read-only grace", () => {
    expect(refundRuleFor(POLICY, { kind: "consultation" })[0]).toEqual({ key: "refund.rule.window", params: { days: 10 } });
    expect(refundRuleFor(POLICY, { kind: "care_pack" }).some((l) => l.key === "refund.rule.grace")).toBe(true);
    expect(refundRuleFor(POLICY, { kind: "consultation" }).some((l) => l.key === "refund.rule.grace")).toBe(false);
  });
  it("with no database answer yet it uses the shared registry values, never a typed number", () => {
    expect(refundRuleFor(null, { kind: "membership" })).toEqual(refundRuleFor(fallbackRefundPolicy(), { kind: "membership" }));
  });
  it("every key it can return exists in the catalogue", () => {
    for (const kind of ["membership", "care_pack", "consultation"] as const) for (const l of refundRuleFor(POLICY, { kind })) expect(Object.hasOwn(en, l.key)).toBe(true);
    for (const k of Object.values(REFUND_STEP_KEY)) expect(Object.hasOwn(en, k)).toBe(true);
  });
});

describe("refundTimingNote (A3)", () => {
  it("a waiting request shows the answer time, one on its way shows the bank days, a finished or declined one shows neither", () => {
    expect(refundTimingNote("pending", POLICY)).toEqual({ key: "refund.status.sla", params: { days: 2 } });
    expect(refundTimingNote("approved", POLICY)).toEqual({ key: "refund.status.bank", params: { min: 3, max: 7 } });
    expect(refundTimingNote("processing", POLICY)).toEqual({ key: "refund.status.bank", params: { min: 3, max: 7 } });
    expect(refundTimingNote("completed", POLICY)).toBeNull();
    expect(refundTimingNote("rejected", POLICY)).toBeNull();
  });
});

describe("parseMyRefunds", () => {
  const row = {
    id: "r1", order_id: "o1", amount_kobo: 500_000, state: "pending", decision_note: null,
    order: { catalog_item: { code: "proof_consult", name_key: "catalog.consultation_single.name" } },
    steps: [{ step: "approved", created_at: "2026-10-02T10:00:00Z" }, { step: "requested", created_at: "2026-10-01T10:00:00Z" }, { step: "nonsense", created_at: "2026-10-03T10:00:00Z" }],
  };
  it("keeps the steps oldest first and drops a step it does not know", () => {
    const [r] = parseMyRefunds([row]);
    expect(r?.steps.map((s) => s.step)).toEqual(["requested", "approved"]);
    expect(r).toMatchObject({ amountKobo: 500_000, state: "pending", nameKey: "catalog.consultation_single.name", decisionNote: null });
  });
  it("drops a malformed row and gives nothing for a bad reply", () => {
    expect(parseMyRefunds([row, { ...row, state: "weird" }, { ...row, amount_kobo: 1.5 }, 7])).toHaveLength(1);
    expect(parseMyRefunds(null)).toEqual([]);
  });
  it("keeps the reason a refund was declined for", () => {
    expect(parseMyRefunds([{ ...row, state: "rejected", decision_note: "Outside the window" }])[0]).toMatchObject({ state: "rejected", decisionNote: "Outside the window" });
  });
});

describe("orderSplit (A4): You pay X. {Sponsor} pays Y.", () => {
  const o = { amountKobo: 300_000, totalKobo: null, sponsorShareKobo: 200_000, sponsorName: "Acme Ltd" };
  it("part-covered: both parts in integer kobo, and the line reads right", () => {
    const s = orderSplit(o);
    expect(s).toEqual({ youKobo: 300_000, sponsorKobo: 200_000, sponsorName: "Acme Ltd" });
    expect(t("sponsor.split", "en", { you: "₦3,000", name: s!.sponsorName!, amount: "₦2,000" })).toBe("You pay ₦3,000. Acme Ltd pays ₦2,000.");
  });
  it("uses the total the person was charged when there is one", () => {
    expect(orderSplit({ ...o, totalKobo: 307_500 })?.youKobo).toBe(307_500);
  });
  it("keeps a hidden sponsor hidden: a null name stays null so the caller uses the generic words", () => {
    expect(orderSplit({ ...o, sponsorName: null })?.sponsorName).toBeNull();
    expect(t("sponsor.name_generic", "en")).toBe("Your sponsor");
  });
  it("no line when the person pays everything or the sponsor pays everything", () => {
    expect(orderSplit({ ...o, sponsorShareKobo: 0 })).toBeNull();
    expect(orderSplit({ ...o, amountKobo: 0 })).toBeNull();
  });
});
