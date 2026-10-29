import {
  defaultMealType,
  mealPhotoProblem,
  MEAL_PHOTO_MAX_BYTES,
} from "./photo-first";

describe("defaultMealType (Lagos hour, UTC+1)", () => {
  const at = (utc: string) =>
    defaultMealType(new Date(`2026-10-29T${utc}:00Z`));
  it("maps the day to a likely meal", () => {
    expect(at("06:30")).toBe("breakfast"); // 07:30 Lagos
    expect(at("12:00")).toBe("lunch"); // 13:00
    expect(at("16:00")).toBe("snack"); // 17:00
    expect(at("18:30")).toBe("dinner"); // 19:30
    expect(at("22:30")).toBe("snack"); // 23:30
    expect(at("23:30")).toBe("snack"); // 00:30 next day
  });
  it("uses Lagos, not UTC, at the edges", () => {
    expect(at("09:59")).toBe("breakfast"); // 10:59 Lagos
    expect(at("10:00")).toBe("lunch"); // 11:00 Lagos
  });
});

describe("mealPhotoProblem", () => {
  it("accepts a normal photo and a missing type (some cameras omit it)", () => {
    expect(
      mealPhotoProblem({ size: 2_000_000, type: "image/jpeg" }),
    ).toBeNull();
    expect(mealPhotoProblem({ size: 2_000_000, type: "" })).toBeNull();
  });
  it("refuses an oversize or non-image file with a plain message", () => {
    expect(
      mealPhotoProblem({ size: MEAL_PHOTO_MAX_BYTES + 1, type: "image/png" }),
    ).toMatch(/10 MB/);
    expect(mealPhotoProblem({ size: 100, type: "application/pdf" })).toMatch(
      /JPEG/,
    );
  });
});
