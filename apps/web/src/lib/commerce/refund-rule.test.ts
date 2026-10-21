import { en } from "@tarragon/i18n";
import { fallbackRefundPolicy, parseRefundPolicy, refundRuleLines } from "./refund-rule";

describe("parseRefundPolicy", () => {
  it("reads the database answer", () => {
    expect(
      parseRefundPolicy({ cooling_off_days: 10, membership_window_days: 30, decision_sla_days: 2, bank_days_min: 3, bank_days_max: 7, grace_days: 5 }),
    ).toEqual({ coolingOffDays: 10, membershipWindowDays: 30, decisionSlaDays: 2, bankDaysMin: 3, bankDaysMax: 7, graceDays: 5 });
  });

  it("falls back to the registry values, field by field, for anything malformed", () => {
    const base = fallbackRefundPolicy();
    expect(parseRefundPolicy(null)).toEqual(base);
    expect(parseRefundPolicy("x")).toEqual(base);
    expect(parseRefundPolicy({ cooling_off_days: -1, decision_sla_days: "3", grace_days: 1.5 })).toEqual(base);
    expect(parseRefundPolicy({ cooling_off_days: 9 }).coolingOffDays).toBe(9);
    expect(parseRefundPolicy({ cooling_off_days: 9 }).decisionSlaDays).toBe(base.decisionSlaDays);
  });

  it("the registry values are the proposed ones: 14 day cooling off, 21 day Membership window, 7 days of grace", () => {
    const p = fallbackRefundPolicy();
    expect([p.coolingOffDays, p.membershipWindowDays, p.graceDays]).toEqual([14, 21, 7]);
  });
});

describe("refundRuleLines", () => {
  const p = fallbackRefundPolicy();

  it("an ordinary order quotes the cooling-off window, the timing in days, the decline promise and no auto-renewal", () => {
    const lines = refundRuleLines(p, { membership: false, pack: false });
    expect(lines.map((l) => l.key)).toEqual(["refund.rule.window", "refund.rule.timing", "refund.rule.declined", "refund.rule.no_renew"]);
    expect(lines[0]?.params).toEqual({ days: p.coolingOffDays });
    expect(lines[1]?.params).toEqual({ sla: p.decisionSlaDays, min: p.bankDaysMin, max: p.bankDaysMax });
  });

  it("a Membership quotes its own window", () => {
    const lines = refundRuleLines(p, { membership: true, pack: false });
    expect(lines[0]).toEqual({ key: "refund.rule.window_membership", params: { days: p.membershipWindowDays } });
  });

  it("a pack adds the grace line, and a zero grace removes it", () => {
    expect(refundRuleLines(p, { membership: false, pack: true }).map((l) => l.key)).toContain("refund.rule.grace");
    expect(refundRuleLines({ ...p, graceDays: 0 }, { membership: false, pack: true }).map((l) => l.key)).not.toContain("refund.rule.grace");
  });

  it("every key exists in the catalogue and every placeholder has a number (no raw key or {braces} can reach a screen)", () => {
    for (const kind of [{ membership: false, pack: true }, { membership: true, pack: false }]) {
      for (const l of refundRuleLines(p, kind)) {
        const text = (en as Record<string, string>)[l.key];
        expect(text).toBeDefined();
        const needed = [...(text ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        for (const n of needed) expect(Object.keys(l.params)).toContain(n);
      }
    }
  });

  it("uses no em dash in the wording", () => {
    for (const k of Object.keys(en).filter((k) => k.startsWith("refund.rule.") || k.startsWith("refund.step.") || k.startsWith("refund.status."))) {
      expect((en as Record<string, string>)[k]).not.toMatch(/—/);
    }
  });
});
