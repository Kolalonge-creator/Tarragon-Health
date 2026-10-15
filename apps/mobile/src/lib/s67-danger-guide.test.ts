import { DANGER_GUIDE_ACTION, DANGER_GUIDE_REVIEW_STATE, pregnancyDangerGuide } from "./pregnancy-danger-guide";

jest.mock("./supabase", () => ({ supabase: {} }));

describe("the offline pregnancy danger-sign guide", () => {
  it("lists every sign the red-flag check can report, including a fit and passing out", () => {
    const signs = pregnancyDangerGuide().map((e) => e.sign);
    expect(signs).toEqual(expect.arrayContaining(["vaginal_bleeding", "reduced_or_no_baby_movement", "waters_broken", "convulsion_or_fit", "loss_of_consciousness"]));
    expect(pregnancyDangerGuide().every((e) => e.label.length > 0)).toBe(true);
  });
  it("is bundled data with no network call, marked draft pending review, and never says wait", () => {
    expect(DANGER_GUIDE_REVIEW_STATE).toBe("draft_pending_cmo");
    expect(DANGER_GUIDE_ACTION).not.toMatch(/wait|tomorrow|[–—]/i);
    expect(DANGER_GUIDE_ACTION).toMatch(/now/);
  });
});
