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
  it("the schema accepts null and the two answers and nothing else", () => {
    expect(redPatientResponseSchema.safeParse(null).success).toBe(true);
    expect(redPatientResponseSchema.safeParse({ response: "sought_care", responded_at: "x" }).success).toBe(true);
    expect(redPatientResponseSchema.safeParse({ response: "maybe", responded_at: "x" }).success).toBe(false);
  });
});
