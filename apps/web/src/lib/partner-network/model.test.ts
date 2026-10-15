import { breachLabel, describePartnerError, messageSchema, monthLabel, overviewSchema, partnerQualitySchema, recordSourcingSchema, statementsSchema, termsSchema } from "./model";

describe("partner network model", () => {
  it("reads a partner quality answer and refuses a malformed one", () => {
    const ok = partnerQualitySchema.safeParse({
      partner_kind: "lab", work_state: "open", reason_codes: [], score: 91.5, breaches: [], licence_state: "current", licence_expires_at: null,
      turnaround_target_hours: 72, turnaround_median_hours: 40, pct_within_target: 96, orders_measured: 22, complaints_upheld: 0, complaints_open: 1,
      complaints: [{ category: "late_result", state: "open", opened: "2026-10-01", resolved: null }], computed_at: "2026-10-07T05:45:00Z",
    });
    expect(ok.success).toBe(true);
    expect(partnerQualitySchema.safeParse({ partner_kind: "shop", work_state: "open" }).success).toBe(false);
  });

  it("an overview with a bad row fails as a whole (a load failure, never a shorter list)", () => {
    expect(overviewSchema.safeParse([{ partner_kind: "lab" }]).success).toBe(false);
  });

  it("a statement can be issued, disputed or paid but never a draft (partners never see drafts)", () => {
    const row = { settlement_id: "11111111-1111-4111-8111-111111111111", period_month: "2026-09-01", amount_kobo: 150000, item_count: 3, issued_at: null, settled_at: null, external_reference: null, disputed_at: null };
    expect(statementsSchema.safeParse([{ ...row, state: "issued" }]).success).toBe(true);
    expect(statementsSchema.safeParse([{ ...row, state: "draft" }]).success).toBe(false);
  });

  it("money in a statement must be whole kobo", () => {
    const row = { settlement_id: "11111111-1111-4111-8111-111111111111", period_month: "2026-09-01", amount_kobo: 150000.5, item_count: 3, state: "issued", issued_at: null, settled_at: null, external_reference: null, disputed_at: null };
    expect(statementsSchema.safeParse([row]).success).toBe(false);
  });

  it("labels breach codes in plain words and falls back to a readable form", () => {
    expect(breachLabel("licence_expired")).toBe("Licence expired");
    expect(breachLabel("something_new")).toBe("something new");
    expect(monthLabel("2026-09-01")).toBe("September 2026");
  });

  it("maps database errors to plain words and never shows a code", () => {
    expect(describePartnerError({ message: "licence_expired_renew_first" })).toMatch(/Renew it first/);
    expect(describePartnerError({ message: "settlement_guard_off" })).toMatch(/not switched on/);
    expect(describePartnerError({ message: "chat_closed" })).toMatch(/closed/);
    expect(describePartnerError({ message: "XX000 internal" })).toBe("That did not work. Please try again.");
    expect(describePartnerError(null)).toBe("That did not work. Please try again.");
  });

  it("a NAFDAC number must have the registered shape", () => {
    expect(recordSourcingSchema.safeParse({ dispense: "11111111-1111-4111-8111-111111111111", nafdac: "a4-1234", supplier: "Acme Pharma" }).success).toBe(true);
    expect(recordSourcingSchema.safeParse({ dispense: "11111111-1111-4111-8111-111111111111", nafdac: "not a number", supplier: "Acme Pharma" }).success).toBe(false);
  });

  it("a message is 1 to 1000 characters", () => {
    const rx = "11111111-1111-4111-8111-111111111111";
    expect(messageSchema.safeParse({ prescription: rx, body: "  " }).success).toBe(false);
    expect(messageSchema.safeParse({ prescription: rx, body: "x".repeat(1001) }).success).toBe(false);
    expect(messageSchema.safeParse({ prescription: rx, body: "Is this strength right?" }).success).toBe(true);
  });

  it("settlement terms can never name a laboratory", () => {
    const base = { partner: "11111111-1111-4111-8111-111111111111", catalogCode: "care_pack_90", source: "sponsor_paid_item", basis: "basis_points", value: 500, reason: "Agreed with the pharmacy in writing on 1 October" };
    expect(termsSchema.safeParse({ ...base, kind: "pharmacy" }).success).toBe(true);
    expect(termsSchema.safeParse({ ...base, kind: "lab" }).success).toBe(false);
  });
});
