import { z } from "zod";

export const rosterMemberSchema = z
  .object({
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9][0-9]{7,14}$/, "Use E.164 format, e.g. +2348012345678")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    email: z
      .string()
      .trim()
      .email("Enter a valid email address")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    full_name: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
    department_id: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
    location_id: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
    employment_status: z
      .enum(["full_time", "part_time", "contract", "nysc", "intern"])
      .optional()
      .or(z.literal("").transform(() => undefined)),
    eligible_from: z.string().optional().or(z.literal("").transform(() => undefined)),
    eligible_until: z.string().optional().or(z.literal("").transform(() => undefined)),
  })
  // §26.4: a roster row needs at least one way to reach the person.
  .refine((v) => !!v.phone || !!v.email, {
    message: "Enter a phone number or an email address",
    path: ["phone"],
  });
export type RosterMemberInput = z.infer<typeof rosterMemberSchema>;

/** §26.4 bulk upload — one line per employee, comma-separated. Deliberately
 * forgiving of blank lines/whitespace; per-row validation happens server-side
 * in public.employer_bulk_upsert_roster, whose per-row skip reasons are the
 * ones actually shown to the admin. */
export const bulkRosterRowSchema = z.object({
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  full_name: z.string().trim().optional(),
  department: z.string().trim().optional(),
  location: z.string().trim().optional(),
  employment_status: z.string().trim().optional(),
});
export type BulkRosterRow = z.infer<typeof bulkRosterRowSchema>;

/** Parses the pasted-CSV textarea into row objects, tolerating a header row
 * (phone,email,full_name,department,location,employment_status) or its
 * absence — a row is treated as a header only if its first cell is literally
 * "phone". */
export function parseBulkRosterInput(raw: string): BulkRosterRow[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const rows: BulkRosterRow[] = [];
  for (const [i, line] of lines.entries()) {
    const cells = line.split(",").map((c) => c.trim());
    if (i === 0 && cells[0]?.toLowerCase() === "phone") continue;
    const [phone, email, full_name, department, location, employment_status] = cells;
    rows.push({ phone, email, full_name, department, location, employment_status });
  }
  return rows;
}
