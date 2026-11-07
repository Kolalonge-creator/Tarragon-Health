import { z } from "zod";

/** P21: what a "change my name or date of birth" request must look like before it is sent to staff to verify. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Lagos calendar date for a given moment, as YYYY-MM-DD. */
export function lagosDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export type IdentityField = "full_name" | "date_of_birth";

export function identityChangeSchema(today: string) {
  return z
    .object({
      field: z.enum(["full_name", "date_of_birth"]),
      newValue: z.string().trim().min(1).max(120),
      reason: z.string().trim().max(500).optional(),
    })
    .superRefine((v, ctx) => {
      if (v.field === "date_of_birth") {
        const d = new Date(`${v.newValue}T00:00:00Z`);
        if (!ISO_DATE.test(v.newValue) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v.newValue) {
          ctx.addIssue({ code: "custom", path: ["newValue"], message: "date" });
        } else if (v.newValue > today || v.newValue < "1900-01-01") {
          ctx.addIssue({ code: "custom", path: ["newValue"], message: "date_range" });
        }
      } else if (v.newValue.length < 2) {
        ctx.addIssue({ code: "custom", path: ["newValue"], message: "name" });
      }
    });
}

/** How the request reads in the staff review queue (data_correction_requests.record_description / what_is_wrong). */
export const IDENTITY_RECORD_DESCRIPTION: Record<IdentityField, string> = {
  full_name: "Name on my account",
  date_of_birth: "Date of birth on my account",
};

export function defaultWhatIsWrong(field: IdentityField): string {
  return `I would like my ${field === "full_name" ? "name" : "date of birth"} changed.`;
}
