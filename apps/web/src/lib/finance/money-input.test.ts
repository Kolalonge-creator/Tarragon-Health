import { parseMoneyInput, parseOptionalMoney } from "./money-input";

const minor = (raw: string | number, opts?: { allowZero?: boolean }) => {
  const r = parseMoneyInput(raw, opts);
  return r.ok ? r.minor : `ERR:${r.error}`;
};

describe("parseMoneyInput", () => {
  it.each([
    ["1500000", 150000000],
    ["1,500,000", 150000000],
    ["1,500,000.50", 150000050],
    ["₦5000", 500000],
    ["₦ 5,000", 500000],
    ["$12.5", 1250],
    ["0.29", 29],
    [".5", 50],
    ["  250  ", 25000],
    ["0", 0],
  ])("reads %s as %d minor units", (raw, expected) => {
    expect(minor(raw)).toBe(expected);
  });

  it("never goes through floating point: 0.29 and 1.15 are exact", () => {
    expect(minor("0.29")).toBe(29);
    expect(minor("1.15")).toBe(115);
    expect(minor("1234567.89")).toBe(123456789);
  });

  it("reads a typed number the same way", () => {
    expect(minor(12.5)).toBe(1250);
    expect(minor(0)).toBe(0);
    expect(String(minor(-1))).toMatch(/^ERR:/);
    expect(String(minor(Number.NaN))).toMatch(/^ERR:/);
  });

  describe("refuses, with a reason, what the old parser guessed at", () => {
    it.each([
      ["abc", /is not an amount/],
      ["1,50", /is not an amount/],
      ["5 000", /is not an amount/],
      ["1e3", /is not an amount/],
      ["12,34,567", /is not an amount/],
      ["1,5000", /is not an amount/],
      ["1.2.3", /is not an amount/],
      ["₦", /Enter an amount|is not an amount/],
      [".", /is not an amount/],
      ["-200", /negative/],
      ["-₦200", /negative|is not an amount/],
      ["12.345", /more than two decimal places/],
      ["", /Enter an amount/],
      ["   ", /Enter an amount/],
      ["99999999999999999999", /too large/],
    ])("%j", (raw, why) => {
      const r = parseMoneyInput(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(why);
    });

    it("the amount that used to become one naira now says what is wrong", () => {
      expect(minor("1,500,00")).toMatch(/^ERR:/);
      expect(minor("1,500,000")).toBe(150000000);
    });
  });

  it("refuses zero only when asked to", () => {
    expect(minor("0")).toBe(0);
    expect(minor("0", { allowZero: false })).toBe("ERR:The amount must be more than zero.");
    expect(minor("0.00", { allowZero: false })).toBe("ERR:The amount must be more than zero.");
    expect(minor("0.01", { allowZero: false })).toBe(1);
  });
});

describe("parseOptionalMoney", () => {
  it("treats a blank field as no amount, not as zero", () => {
    expect(parseOptionalMoney("")).toEqual({ ok: true, minor: null });
    expect(parseOptionalMoney("   ")).toEqual({ ok: true, minor: null });
  });
  it("reads a filled field exactly as strictly as parseMoneyInput", () => {
    expect(parseOptionalMoney("1,000")).toEqual({ ok: true, minor: 100000 });
    expect(parseOptionalMoney("abc").ok).toBe(false);
    expect(parseOptionalMoney("0", { allowZero: false }).ok).toBe(false);
  });
});
