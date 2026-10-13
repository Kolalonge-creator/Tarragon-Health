import { z } from "zod";
import { sponsorReportRows, sponsorReportSchema, withheldText, type SponsorReport } from "./report";

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

const monthName = (p: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${p}T00:00:00Z`));

/**
 * The wording of one month for a page: a title and the lines under it. A held-back month is one sentence and no numbers; a withheld figure
 * is worded as withheld, never as zero. Web and console both render this, so they cannot say different things about the same month.
 */
export function describeMonth(m: StaffMonth): { title: string; heldBack: string | null; lines: string[] } {
  const title = monthName(m.period);
  const f = m.figures;
  if (isHeldBack(f)) return { title, heldBack: "Held back: only a few people changed since the last figure, so it is not shown yet. It will appear once enough has changed.", lines: [] };
  return {
    title, heldBack: null,
    lines: [
      f.members.suppressed ? `Members who agreed: ${withheldText(f.members)}` : `Members who agreed to share: ${f.members.agreed_to_share} of ${f.members.joined} (${f.members.agreed_pct}%)`,
      f.bp_control_90d.suppressed ? `Blood pressure under control at 90 days: ${withheldText(f.bp_control_90d)}` : `Blood pressure under control at 90 days: ${f.bp_control_90d.rate_strict_pct}% of ${f.bp_control_90d.n} people`,
      f.change_among_measured.suppressed ? `Average change from day 0: ${withheldText(f.change_among_measured)}` : `Average change from day 0: ${f.change_among_measured.mean_systolic_change} / ${f.change_among_measured.mean_diastolic_change} mmHg (systolic / diastolic)`,
      f.adherence_separate.suppressed ? `Medicines taken as planned (kept separate): ${withheldText(f.adherence_separate)}` : `Medicines taken as planned (kept separate): ${f.adherence_separate.mean_pct}%`,
      f.engagement_separate.suppressed ? `Logged a reading in the last 30 days (kept separate): ${withheldText(f.engagement_separate)}` : `Logged a reading in the last 30 days (kept separate): ${f.engagement_separate.logged_a_reading_in_30_days_pct}%`,
    ],
  };
}
