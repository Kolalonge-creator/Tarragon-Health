import { describe, expect, it } from "@jest/globals";
import { defaultMealType } from "./default-meal-type";

describe("defaultMealType (Lagos hour, UTC+1)", () => {
  const at = (utc: string) => defaultMealType(new Date(`2026-10-29T${utc}:00Z`));
  it("maps the Lagos time of day to a likely meal", () => {
    expect(at("06:30")).toBe("breakfast"); // 07:30 Lagos
    expect(at("12:00")).toBe("lunch"); // 13:00
    expect(at("16:00")).toBe("snack"); // 17:00
    expect(at("18:30")).toBe("dinner"); // 19:30
    expect(at("22:30")).toBe("snack"); // 23:30
    expect(at("23:30")).toBe("snack"); // 00:30 next day
  });
  it("uses Lagos, not UTC, at the edges", () => {
    expect(at("02:59")).toBe("snack"); // 03:59 Lagos, before breakfast starts
    expect(at("03:00")).toBe("breakfast"); // 04:00 Lagos
    expect(at("09:59")).toBe("breakfast"); // 10:59 Lagos
    expect(at("10:00")).toBe("lunch"); // 11:00 Lagos
  });
});
