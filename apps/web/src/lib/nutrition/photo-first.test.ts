import {
  mealPhotoProblem,
  MEAL_PHOTO_MAX_BYTES,
} from "./photo-first";

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
