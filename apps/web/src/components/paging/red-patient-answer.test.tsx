import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { RedPatientAnswer } from "./red-patient-answer";
import { redPatientResponseSchema } from "@/lib/paging/schemas";

describe("RedPatientAnswer (CMO Q13)", () => {
  it("shows nothing when the patient has not answered", () => {
    expect(renderToStaticMarkup(<RedPatientAnswer answer={null} />)).toBe("");
  });
  it("shows what the patient said and says it does not stop the paging", () => {
    const html = renderToStaticMarkup(<RedPatientAnswer answer={{ response: "could_not_get_care", responded_at: "2026-10-14T09:00:00Z" }} />);
    expect(html).toContain("could not get care");
    expect(html).toContain("does not stop the paging");
    expect(html).not.toMatch(/acknowledg\w* this|close this/i);
  });
  it("shows the other answer too", () => {
    expect(renderToStaticMarkup(<RedPatientAnswer answer={{ response: "sought_care", responded_at: "2026-10-14T09:00:00Z" }} />)).toContain("has sought care");
  });
  it("says when a helper answered, not the patient, and still does not stop the paging", () => {
    const html = renderToStaticMarkup(<RedPatientAnswer answer={{ response: "sought_care", responded_at: "2026-10-14T09:00:00Z", answered_by_caregiver: true }} />);
    expect(html).toContain("A helper says");
    expect(html).toContain("not the patient");
    expect(html).toContain("does not stop the paging");
    expect(html).not.toContain("Patient says");
  });
  it("the schema keeps the helper flag instead of stripping it", () => {
    expect(redPatientResponseSchema.parse({ response: "sought_care", responded_at: "x", answered_by_caregiver: true })).toMatchObject({ answered_by_caregiver: true });
  });
  it("the schema accepts null and the two answers and nothing else", () => {
    expect(redPatientResponseSchema.safeParse(null).success).toBe(true);
    expect(redPatientResponseSchema.safeParse({ response: "sought_care", responded_at: "x" }).success).toBe(true);
    expect(redPatientResponseSchema.safeParse({ response: "maybe", responded_at: "x" }).success).toBe(false);
  });
});
