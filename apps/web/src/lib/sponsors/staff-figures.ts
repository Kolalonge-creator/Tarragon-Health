import { z } from "zod";
import { sponsorReportRows, sponsorReportSchema, type SponsorReport } from "./report";

/**
 * What a sponsor's own staff read on the web (S38f): their programmes, and for each the frozen monthly figures the database wrote after the
 * month closed. Parsed, never trusted. A month is either a full report, or held back because it would differ from the last published one by only
 * a few people. Nothing here holds a person.
 */
const programmesSchema = z.object({
  sponsor: z.string(),
  programmes: z.array(z.object({
    id: z.string().uuid(), name: z.string(), code: z.string().nullable(), valid_from: z.string(), valid_to: z.string(),
    status: z.enum(["active", "closed"]), latest_period: z.string().nullable(),
  })),
});
export type StaffProgrammes = z.infer<typeof programmesSchema>;
export function parseStaffProgrammes(data: unknown): StaffProgrammes | null {
  const r = programmesSchema.safeParse(data);
  return r.success ? r.data : null;
}

const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const heldBack = z.object({ held_back: z.literal(true), reason: z.string(), minimum: z.number().int(), limitations: z.string() });
const monthSchema = z.object({ period: plainDate, generated_at: z.string(), figures: z.union([sponsorReportSchema, heldBack]) });
const figuresSchema = z.object({ ok: z.literal(true), months: z.array(monthSchema) });
export type StaffMonth = z.infer<typeof monthSchema>;

export function parseStaffFigures(data: unknown): StaffMonth[] | null {
  const r = figuresSchema.safeParse(data);
  return r.success ? r.data.months : null;
}

export const isHeldBack = (f: StaffMonth["figures"]): f is z.infer<typeof heldBack> => "held_back" in f;

/** Escapes one CSV cell and neutralises a leading formula character. */
function cell(v: string | number): string {
  let t = String(v);
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** One file with a period column. A held-back month says so and carries no numbers. The programme name comes from the figures themselves. */
export function staffFiguresToCsv(months: StaffMonth[]): string {
  const name = months.map((m) => (isHeldBack(m.figures) ? null : m.figures.cohort.name)).find((n) => n) ?? "programme";
  const rows = ["period,section,item,value", `all,programme,name,${cell(name)}`];
  for (const m of months) {
    if (isHeldBack(m.figures)) {
      rows.push(`${m.period},report,status,held_back`, `${m.period},report,reason,${cell(m.figures.reason)}`, `${m.period},report,minimum_group_size,${m.figures.minimum}`);
      continue;
    }
    for (const line of sponsorReportRows(m.figures as SponsorReport).slice(1)) rows.push(`${m.period},${line}`);
  }
  return rows.join("\r\n") + "\r\n";
}
