import { describe, expect, it } from "@jest/globals";
import { formatNairaForPatient, formatKobo } from "./format-money";

describe("formatNairaForPatient (design principle 4)", () => {
  it("prints whole naira without decimals and groups thousands", () => {
    expect(formatNairaForPatient(1_250_000)).toBe("₦12,500");
    expect(formatNairaForPatient(500_000_00)).toBe("₦500,000");
    expect(formatNairaForPatient(0)).toBe("₦0");
  });

  it("keeps kobo visible when there is a kobo part", () => {
    expect(formatNairaForPatient(1_250_050)).toBe("₦12,500.50");
    expect(formatNairaForPatient(5)).toBe("₦0.05");
  });

  it("refuses a negative, fractional or non-finite amount instead of showing a wrong price", () => {
    expect(() => formatNairaForPatient(-1)).toThrow(RangeError);
    expect(() => formatNairaForPatient(10.5)).toThrow(RangeError);
    expect(() => formatNairaForPatient(Number.NaN)).toThrow(RangeError);
  });

  it("agrees with the staff formatter on the number (only the decimals differ)", () => {
    expect(formatKobo(1_250_000)).toBe("₦12,500.00");
  });
});
