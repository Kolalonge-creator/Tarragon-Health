import { defaultMealType } from "./lifestyle-trackers";

jest.mock("./supabase", () => ({ supabase: {} }));

describe("defaultMealType (Lagos hour, UTC+1)", () => {
  const at = (utc: string) => defaultMealType(new Date(`2026-10-29T${utc}:00Z`));
  it("maps the Lagos time of day to a likely meal", () => {
    expect(at("06:30")).toBe("breakfast");
    expect(at("09:59")).toBe("breakfast");
    expect(at("10:00")).toBe("lunch");
    expect(at("16:00")).toBe("snack");
    expect(at("18:30")).toBe("dinner");
    expect(at("23:30")).toBe("snack");
  });
});
